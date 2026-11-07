-- Plano e identidade do tenant pertencem ao provisionamento, nao a API.
-- Migration separada para nao alterar checksums de bancos ja migrados.
REVOKE UPDATE ON tenants FROM kronos_app;
GRANT UPDATE (nome, cnpj, config) ON tenants TO kronos_app;
