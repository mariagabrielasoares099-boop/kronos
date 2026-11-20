# API de chamados

Contrato completo (OpenAPI 3.1, gerado dos mesmos schemas Zod que validam a entrada):

    GET http://localhost:3000/openapi.json

Abre sem token. Para navegar de forma visual, cole a URL em qualquer visualizador OpenAPI (por exemplo o
editor online do Swagger ou a extensão do VS Code); a API não embute interface gráfica, para manter o CSP do
`helmet` restrito e zero dependência extra.

## Autenticação

Todas as rotas (exceto `/health`, `/openapi.json`, `/auth/login`, `/portal/link` e `/portal/sessao`) exigem `Authorization: Bearer <token>`.
Limite padrão: 60 requisições por minuto por IP e rota (`429` ao exceder).
Limites adicionais por usuário e tenant ainda estão pendentes no passo 3.

### Login da equipe (`POST /auth/login`)

Corpo: `{ "email", "senha", "codigo"? }`. Resposta `200`: `{ "token", "expiraEm", "papel" }` (token de 8 h, usado como `Bearer`).

| Situação | Resposta |
|---|---|
| E-mail inexistente, senha ou código errados | `401` "Credenciais invalidas" (a mesma para os três) |
| Senha certa, RH sem `codigo` | `401` com `codigo2fa: true` |
| RH (ADMIN, RECRUTADOR, DP) sem 2FA cadastrado | `403` |
| 5 falhas seguidas | `429` por 15 minutos (conta bloqueada) |

Limite próprio: 5 tentativas por minuto por IP. O código TOTP (6 dígitos, 30 s) vale uma única vez. Senha em scrypt; segredo TOTP cifrado em AES-256-GCM com `ENCRYPTION_KEY`. A API lê hash e segredo só pelas funções `auth_*` do banco. Cadastro do primeiro usuário: `apps/api/scripts/criar-usuario.mjs`.

## Endpoints

| Método | Rota | Papéis | Resposta |
|--------|------|--------|----------|
| POST | `/chamados` | RECRUTADOR, DP | `201` chamado aberto |
| GET | `/chamados/:protocolo` | qualquer autenticado (o RLS filtra) | `200` / `404` |
| GET | `/chamados?status=&busca=&limite=` | equipe (RECRUTADOR, DP, GESTOR_VAGA, AVALIADOR, ALMOXARIFADO) | `200` fila por prazo de SLA, sem CPF/e-mail / `400` |
| GET | `/chamados/:protocolo/resumo` | equipe | `200` / `404` |
| GET | `/chamados/:id/eventos` | equipe | `200` linha do tempo / `404` |
| POST | `/chamados/:id/atribuicao` | RECRUTADOR, DP | `200` atribuído (ou já estava) / `400` / `404` / `409` |
| POST | `/chamados/:id/transicoes` | RECRUTADOR, DP | `200` / `409` |
| POST | `/chamados/:id/documentos` | candidato do chamado ou equipe atribuída (RLS) | `201` / `400` / `404` / `409` / `413` |
| GET | `/chamados/:id/documentos` | candidato do chamado ou equipe atribuída (RLS) | `200` documentos + checklist |
| GET | `/documentos/:id/arquivo` | candidato do chamado ou equipe atribuída (RLS) | `200` arquivo como anexo |
| PATCH | `/documentos/:id` | RECRUTADOR, DP atribuídos ao chamado | `200` / `409` já decidido |

### Painel da equipe no portal web

O portal web (`apps/web`) usa estas rotas fora do modo demo, sempre com o token da própria pessoa (cookie `kronos_equipe`,
HttpOnly): `POST /auth/login`, `GET /chamados`, `GET /chamados/:protocolo/resumo`, `GET /chamados/:id/eventos`,
`GET /chamados/:id/documentos`, `GET /documentos/:id/arquivo`, `PATCH /documentos/:id` e `POST /chamados/:id/transicoes`.
O portal não decide acesso: repassa o que a API responde (`401` volta ao login, `403` vira aviso, `404`/`409` viram mensagem).

- `GET /chamados` aceita `status`, `busca` (protocolo, nome ou CPF de 11 dígitos) e `limite` (1 a 200, padrão 100); qualquer
  outro parâmetro responde `400`. Ordena pelo prazo de SLA mais próximo (sem prazo por último). Vaga, candidato e responsável
  vêm como nome (ou `null` se o RLS esconder); **CPF e e-mail nunca saem nesta resposta**.
- **Documentos exigem atribuição:** quem enxerga o chamado mas não está atribuído a ele recebe `404` em
  `GET /chamados/:id/documentos` (regra do RLS). O painel avisa e oferece **"Assumir este chamado"**
  (`POST /chamados/:id/atribuicao`), sem tocar no banco.

#### `POST /chamados/:id/atribuicao`

Corpo opcional `{ "usuarioId": "<uuid>" }`; sem ele, a própria pessoa assume o chamado. Resposta `200`:
`{ "chamadoId", "usuarioId", "usuarioNome", "jaAtribuido" }` (repetir é idempotente: `jaAtribuido: true`, nada é gravado).

- **Quem chama:** só `RECRUTADOR` ou `DP` (`403` para os demais papéis e para o candidato; `401` sem token). O chamado precisa
  ser visível a quem atribui: chamado de outra empresa ou de outro tenant responde `404`, igual a inexistente.
- **Quem pode ser atribuído:** usuário do **mesmo tenant**, com papel `RECRUTADOR` ou `DP` (os que operam documentos) e
  **vínculo com a empresa do chamado**. Usuário de outro tenant ou inexistente: `404`. Sem vínculo com a empresa ou com outro
  papel: `409` (mesma mensagem, de propósito). O trigger `enforce_assignment_company` do banco repete a regra do vínculo.
- **Efeitos (uma transação):** linha em `ticket_assignments`, `tickets.responsavel` (o que a fila mostra) e evento de
  auditoria `ATRIBUICAO` em `ticket_events` com `autor` (quem atribuiu) e `payload` `{ usuarioId, usuarioNome }`. A linha do
  tempo (`GET /chamados/:id/eventos`) o devolve com `detalhe` (`"Atribuido a <nome>"`), `de`/`para` nulos.
- Não há rota para **remover** atribuição nem para listar quem pode ser atribuído; o painel só oferece "assumir".

### Entrada do candidato no portal

O candidato entra por um **link de uso único enviado ao e-mail cadastrado**. Protocolo + CPF servem só para *pedir* o
link (o CPF é dado semipúblico e o protocolo é sequencial, então não provam quem é a pessoa); quem prova é quem lê
o e-mail.

1. `POST /portal/link` (pública) recebe `{ "protocolo": "ADM-2026-000001", "cpf": "529.982.247-25" }` e responde `202`
   com a mesma mensagem em qualquer caso: protocolo inexistente, CPF errado, CPF inválido ou erro no envio. Quem pede
   não descobre se o protocolo existe. Se os dados conferem, o e-mail vai para o endereço cadastrado com um link
   `PORTAL_BASE_URL/chamado/<protocolo>/acesso/<codigo>`. Limite de 5 pedidos por minuto por IP (`429`) e de 1 e-mail por
   minuto por candidato (o pedido extra responde `202` e não envia nada).
2. `POST /portal/sessao` (pública) recebe `{ "codigo": "<do e-mail>" }` e devolve `{ "token", "expiraEm" }`. O código tem
   256 bits aleatórios, vale 15 minutos e **funciona uma única vez**; um novo pedido invalida o anterior. O banco guarda
   só o SHA-256 dele. Código inválido, vencido ou já usado responde o mesmo `401`.

O token vale 2 horas e carrega só tenant e candidato (sem papel de equipe), então abre apenas o chamado do próprio
candidato e seus documentos (`GET`/`POST /chamados/:id/documentos`, `GET /documentos/:id/arquivo`); o RLS faz o resto.

Se CPF e protocolo coincidirem em mais de um tenant, nenhum link é enviado: nunca se escolhe um tenant
arbitrariamente.

No portal, a página do link só mostra um botão de confirmação; o código é gasto no `POST` do botão. Assim, leitores de
e-mail e antivírus que pré-abrem links não consomem o acesso.

E-mail: `SMTP_URL` (obrigatória em produção; em desenvolvimento use o Mailpit do `docker-compose`, que mostra as mensagens em
`http://localhost:8025`), `EMAIL_FROM` e `PORTAL_BASE_URL`. Sem `SMTP_URL` fora de produção, a mensagem vai para o log
da API (contém o link: nunca usar assim em produção, o `parseEnv` impede). Limitação: o código aparece no caminho da URL
e pode ficar em log de acesso do servidor do portal. Antes do primeiro uso ou da expiração, quem obtiver esse código
pode trocá-lo por uma sessão. Uso único reduz a janela de exposição, mas não torna o log seguro. Não registrar o caminho
completo de `/chamado/*/acesso/*` no servidor, proxy ou APM; configurar redação ou desabilitar o access log dessas rotas
antes de publicar. As páginas do chamado usam `Cache-Control: no-store` e `Referrer-Policy: no-referrer`.

Chamado sem permissão de leitura responde `404`, igual a chamado inexistente.

### Documentos

- **Envio:** `multipart/form-data` com `tipo` (`RG`, `CPF`, `COMPROVANTE_RESIDENCIA`, `CTPS`, `FOTO_3X4`, `OUTRO`) e o arquivo no campo `arquivo`. Até 5 MB (`413` acima disso). Só JPG, PNG ou PDF, conferidos pelo conteúdo: um HTML renomeado para `.pdf` recebe `400`. Até 30 documentos por chamado. Todo documento nasce `PENDENTE`.
- **Quem acessa:** o próprio candidato e a equipe **atribuída** ao chamado (`ticket_assignments`). Quem só tem vínculo com a empresa, mas não foi atribuído, recebe `404`. A atribuição será feita pela fila do RH (M1.3).
- **Checklist:** por enquanto é o mesmo para toda vaga (RG, CPF e comprovante de residência). Cada item mostra a situação do envio mais recente daquele tipo, ou `FALTANDO`.
- **Download:** sempre como anexo, com `Cache-Control: private, no-store`. Não existe URL pública; o arquivo fica em `STORAGE_DIR` (disco local).
- **Decisão:** `{"acao":"APROVAR"}` ou `{"acao":"RECUSAR","motivo":"..."}`. Cada decisão vira um evento na trilha do chamado (`DOCUMENTO_APROVADO` ou `DOCUMENTO_RECUSADO`). Documento recusado não é editado: o candidato envia um novo.
Erros `400` trazem `erros: [{ campo, problema }]`, nunca o valor recebido (pode ser dado pessoal).

### Limitação conhecida do M1: um candidato por CPF

`POST /chamados` cria um candidato novo a cada chamado, e o banco tem `unique(tenant_id, cpf)`. Quem já tem cadastro no tenant e se candidata a uma segunda vaga recebe `409` ("já existe candidato com este CPF"). Além disso, o `409` revela que o CPF existe no tenant mesmo quando o cadastro pertence a outra empresa (o RLS esconde a linha, a unique do banco não). Decisão do dono do produto: aceitar no M1. Correção prevista: localizar o candidato por CPF em função `SECURITY DEFINER` restrita e criar só o chamado.

## Exemplos

### Python

```python
import os
import requests

BASE = "http://localhost:3000"
H = {"Authorization": f"Bearer {os.environ['KRONOS_TOKEN']}"}

r = requests.post(f"{BASE}/chamados", headers=H, json={
    "jobId": "<uuid da vaga>",
    "candidato": {"nome": "Maria Souza", "email": "maria@example.com", "cpf": "529.982.247-25"},
    "consentimentoLgpd": True,
})
r.raise_for_status()
chamado = r.json()                      # {"id", "protocolo", "status", "jobId", "erpRef"}

requests.get(f"{BASE}/chamados/{chamado['protocolo']}", headers=H).raise_for_status()

requests.post(f"{BASE}/chamados/{chamado['id']}/transicoes", headers=H,
              json={"acao": "AVANCAR"}).raise_for_status()
# DEVOLVER so e permitido em VALIDACAO_DP ou ENVIO_ERP; fora deles retorna 409.
```

### Node.js (18+)

```js
const BASE = 'http://localhost:3000';
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.KRONOS_TOKEN}`,
};

const criar = await fetch(`${BASE}/chamados`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    jobId: '<uuid da vaga>',
    candidato: { nome: 'Maria Souza', email: 'maria@example.com', cpf: '529.982.247-25' },
    consentimentoLgpd: true,
  }),
});
if (!criar.ok) throw new Error(JSON.stringify(await criar.json()));
const chamado = await criar.json();

await fetch(`${BASE}/chamados/${chamado.protocolo}`, { headers });

await fetch(`${BASE}/chamados/${chamado.id}/transicoes`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ acao: 'REPROVAR', motivo: 'Perfil não aderente' }),
});
```

### curl

```bash
curl -s localhost:3000/chamados/ADM-2026-000001 -H "Authorization: Bearer $KRONOS_TOKEN"
```
