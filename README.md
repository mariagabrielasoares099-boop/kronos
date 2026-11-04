# KRONOS — ATS + Admissão

ATS em que **cada candidato é um chamado** com protocolo único (ex.: `ADM-2026-000123`), da candidatura até a admissão concluída na folha, integrado ao ERP de folha do cliente (Fortes, Domínio, Alterdata, Totvs, Senior…) por **conectores**.

- Escopo completo: [`docs/escopo-produto.pdf`](docs/escopo-produto.pdf)
- Arquitetura e stack: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
- Módulos: [`docs/modulos/`](docs/modulos/README.md)
- Os 10 passos (checklist transversal): [`docs/PASSOS.md`](docs/PASSOS.md)
- Segurança: [`SECURITY.md`](SECURITY.md)

## Fases
1. **MVP**: tenancy, chamados, vagas, portal, painel, documentos, admissão (export CSV/JSON), e-mail.
2. **Vendável**: planos/cobrança, WhatsApp, testes, assinatura digital, 1º conector ERP, relatórios.
3. **Escala**: parcerias/conectores de ERP, IA (OCR/triagem), API pública e webhooks.

Cada módulo tem sua milestone e issues no GitHub, e cada um mapeia os 10 passos.
