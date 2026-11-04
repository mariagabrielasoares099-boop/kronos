# Segurança

- Repositório **privado**; nenhum segredo no código. Use `.env` local e cofre em produção.
- O CI roda **gitleaks** a cada push/PR.
- Reporte vulnerabilidades de forma privada ao responsável pelo repositório (não abra issue pública).
- Dados pessoais e sensíveis (ASO, dependentes, bancários): criptografia em trânsito e em repouso, URLs assinadas de curta duração, log de acesso.
