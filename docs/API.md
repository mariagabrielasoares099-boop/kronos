# API de chamados

Contrato completo (OpenAPI 3.1, gerado dos mesmos schemas Zod que validam a entrada):

    GET http://localhost:3000/openapi.json

Abre sem token. Para navegar de forma visual, cole a URL em qualquer visualizador OpenAPI (por exemplo o
editor online do Swagger ou a extensão do VS Code); a API não embute interface gráfica, para manter o CSP do
`helmet` restrito e zero dependência extra.

## Autenticação

Todas as rotas (exceto `/health` e `/openapi.json`) exigem `Authorization: Bearer <token>`.
Limite padrão: 60 requisições por minuto por IP e rota (`429` ao exceder).
Limites adicionais por usuário e tenant ainda estão pendentes no passo 3.

## Endpoints

| Método | Rota | Papéis | Resposta |
|--------|------|--------|----------|
| POST | `/chamados` | RECRUTADOR, DP | `201` chamado aberto |
| GET | `/chamados/:protocolo` | qualquer autenticado (o RLS filtra) | `200` / `404` |
| POST | `/chamados/:id/transicoes` | RECRUTADOR, DP | `200` / `409` |
| POST | `/chamados/:id/documentos` | candidato do chamado ou equipe atribuída (RLS) | `201` / `400` / `404` / `409` / `413` |
| GET | `/chamados/:id/documentos` | candidato do chamado ou equipe atribuída (RLS) | `200` documentos + checklist |
| GET | `/documentos/:id/arquivo` | candidato do chamado ou equipe atribuída (RLS) | `200` arquivo como anexo |
| PATCH | `/documentos/:id` | RECRUTADOR, DP atribuídos ao chamado | `200` / `409` já decidido |

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
