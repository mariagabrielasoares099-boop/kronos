# API de chamados

Contrato completo (OpenAPI 3.1, gerado dos mesmos schemas Zod que validam a entrada):

    GET http://localhost:3000/openapi.json

Abre sem token. Para navegar de forma visual, cole a URL em qualquer visualizador OpenAPI (por exemplo o
editor online do Swagger ou a extensão do VS Code); a API não embute interface gráfica, para manter o CSP do
`helmet` restrito e zero dependência extra.

## Autenticação

Todas as rotas (exceto `/health`, `/openapi.json` e `/portal/sessao`) exigem `Authorization: Bearer <token>`.
Limite padrão: 60 requisições por minuto por IP e rota (`429` ao exceder).
Limites adicionais por usuário e tenant ainda estão pendentes no passo 3.

## Endpoints

| Método | Rota | Papéis | Resposta |
|--------|------|--------|----------|
| POST | `/chamados` | RECRUTADOR, DP | `201` chamado aberto |
| GET | `/chamados/:protocolo` | qualquer autenticado (o RLS filtra) | `200` / `404` |
| POST | `/chamados/:id/transicoes` | RECRUTADOR, DP | `200` / `409` |

### Entrada do candidato no portal

`POST /portal/sessao` (pública) recebe `{ "protocolo": "ADM-2026-000001", "cpf": "529.982.247-25" }` e devolve
`{ "token", "expiraEm" }`. O token vale 2 horas e carrega só tenant e candidato (sem papel de equipe), então abre
apenas o chamado do próprio candidato e seus documentos (`GET`/`POST /chamados/:id/documentos`,
`GET /documentos/:id/arquivo`); o RLS faz o resto. Protocolo inexistente, CPF de outra pessoa e CPF inválido
respondem o mesmo `401`. Limite de 5 tentativas por minuto por IP (`429`).

Limitação: protocolo + CPF é uma credencial fraca (o CPF é dado semipúblico e o protocolo é sequencial). Serve para a
demo; antes de uso real, trocar por link com código de uso único enviado por e-mail ao candidato.

Chamado sem permissão de leitura responde `404`, igual a chamado inexistente.
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
