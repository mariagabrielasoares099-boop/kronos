# 1. Subir o KRONOS no computador

Há dois modos. Para apresentar ou testar, use o **modo demonstração** (só Python). O **modo completo** exige API, banco e Docker e é opcional.

## Pré-requisitos

| Ferramenta | Versão | Para quê | Obrigatório |
|---|---|---|---|
| Git | qualquer | baixar o projeto | sim |
| Python | 3.11 ou mais novo (testado com 3.14) | rodar o portal e o painel | sim |
| Google Chrome | atual | abrir o sistema | recomendado |
| Ollama | atual | IA local da base de conhecimento | não |
| Node.js 20+ e Docker Desktop | | API e banco (modo completo) | não |

## Modo demonstração (recomendado)

### Windows (PowerShell)

```powershell
git clone <URL-do-repositório> kronos
cd kronos
git switch feat/portal-equipe

cd apps\web
python -m venv .venv
.venv\Scripts\Activate.ps1        # se o Windows bloquear: Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements.txt

$env:DEMO_MODE = 'true'
python -m uvicorn app.main:app --port 8000
```

### Mac ou Linux

```bash
git clone <URL-do-repositório> kronos && cd kronos
git switch feat/portal-equipe
cd apps/web
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DEMO_MODE=true python -m uvicorn app.main:app --port 8000
```

Abra **http://127.0.0.1:8000** no Chrome. Deixe esse terminal aberto; `Ctrl+C` encerra o servidor.

### Conferir se está tudo certo

Em outro terminal, na pasta `apps/web` com o ambiente virtual ativo:

```powershell
pip install pytest
python -m pytest -q          # deve terminar com "127 passed"
```

Se algum teste falhar, o ambiente não está igual ao esperado: veja a tabela de problemas abaixo.

## Cadastrar os dados de teste

Com o servidor rodando, em outro terminal na pasta `apps/web`:

```powershell
python scripts/semear_candidatos.py http://127.0.0.1:8000
```

Detalhes e a lista de usuários em [03-usuarios-de-teste.md](03-usuarios-de-teste.md).

## Ligar o login da área do RH (exposição)

Por padrão a área do RH abre direto. Para uma exposição em que o RH exija login:

```powershell
$env:DEMO_MODE = 'true'; $env:EXPO_LOGIN = 'true'
python -m uvicorn app.main:app --port 8000
```

A conta de teste aparece na tela de login (veja o arquivo 3). **Troque a senha** com `EXPO_SENHA` se o sistema ficar acessível fora da sua rede.

## Abrir a partir de outro aparelho (celular, outro computador)

Suba o servidor escutando na rede e use o IP do computador:

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
ipconfig                      # procure "Endereço IPv4", por exemplo 192.168.0.15
```

No celular, na **mesma rede Wi-Fi**, abra `http://192.168.0.15:8000`. Se não abrir, libere a porta 8000 no Firewall do Windows (redes privadas). Use isso só em rede de confiança: o demo não tem proteção de acesso e o login de exposição usa uma senha pública.

## Modo completo (API + banco), opcional

```powershell
cd <raiz do projeto>
Copy-Item .env.example .env          # troque JWT_SECRET e ENCRYPTION_KEY; nunca commite o .env
docker compose up -d                 # PostgreSQL, Redis e Mailpit
npm --prefix apps/api install
npm run dev:api                      # http://localhost:3000/health
```

Depois suba o portal com `DEMO_MODE=false`, `API_BASE_URL=http://localhost:3000` e `SESSION_SECRET` com 32 ou mais caracteres. Nesse modo o candidato entra por link enviado ao e-mail (caixa de teste do Mailpit em http://localhost:8025) e a equipe entra em `/login` com senha e 2FA. Guia da API: [`docs/API.md`](../docs/API.md).

## Problemas comuns

| Sintoma | Causa provável e solução |
|---|---|
| `python` não é reconhecido | Python não está no PATH; reinstale marcando "Add python.exe to PATH" ou use `py` |
| `ModuleNotFoundError` ao iniciar | ambiente virtual não ativado ou `pip install -r requirements.txt` não rodou |
| Porta 8000 ocupada | use `--port 8001` (e abra `http://127.0.0.1:8001`) |
| Scripts bloqueados no PowerShell | `Set-ExecutionPolicy -Scope Process Bypass` na mesma janela |
| A área do RH pede login | está com `EXPO_LOGIN=true`; use a conta do arquivo 3 ou desligue a variável |
| Tela mostra textos antigos | outro servidor ficou rodando na mesma porta; encerre-o e suba de novo |
| Os dados sumiram | normal: o demo guarda tudo em memória e zera ao reiniciar |
