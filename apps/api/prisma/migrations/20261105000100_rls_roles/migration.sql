-- Row Level Security: isolamento por tenant (passo 5). Aplicar apos a migration das tabelas.
-- A aplicacao define o tenant da transacao com: SELECT set_config('app.tenant_id', '<uuid>', true);
-- A aplicacao deve conectar com um role SEM BYPASSRLS e que NAO seja dono das tabelas.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','users','jobs','candidates','tickets','ticket_events','messages']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;

-- tenants: cada tenant so enxerga a propria linha (id = tenant da transacao).
-- Criar/remover tenant e tarefa de provisionamento (kronos_migrator), nao da aplicacao.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ticket_events e append-only (trilha de auditoria).
CREATE OR REPLACE FUNCTION forbid_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ticket_events e append-only';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ticket_events_immutable ON ticket_events;
CREATE TRIGGER ticket_events_immutable
  BEFORE UPDATE OR DELETE ON ticket_events
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

-- Constraints de dominio (texto + CHECK em vez de ENUM: os valores ainda mudam).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('ADMIN','RECRUTADOR','DP','GESTOR_VAGA','AVALIADOR','ALMOXARIFADO'));

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('TRIAGEM','TESTES','ENTREVISTA','APROVADO','AGUARDANDO_CANDIDATO',
                    'VALIDACAO_DP','ASSINATURA','ENVIO_ERP','ADMITIDO','REPROVADO'));

ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_cpf_check;
ALTER TABLE candidates ADD CONSTRAINT candidates_cpf_check CHECK (cpf ~ '^[0-9]{11}$');

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_canal_check;
ALTER TABLE messages ADD CONSTRAINT messages_canal_check CHECK (canal IN ('EMAIL','WHATSAPP','PORTAL'));

-- Indice parcial para o painel de SLA (chamados em aberto).
CREATE INDEX IF NOT EXISTS tickets_sla_aberto_idx ON tickets (tenant_id, prazo_sla)
  WHERE status NOT IN ('ADMITIDO','REPROVADO');


-- Papeis (sem login por padrao; senha definida por ambiente fora do repositorio).
-- kronos_app: usado pela API. Sem BYPASSRLS, nao e dono das tabelas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kronos_app') THEN
    CREATE ROLE kronos_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO kronos_app;
GRANT SELECT, UPDATE ON tenants TO kronos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON companies, users, jobs, candidates, tickets, messages TO kronos_app;
-- Trilha de auditoria: so ler e inserir (trigger cobre linha; REVOKE cobre TRUNCATE).
GRANT SELECT, INSERT ON ticket_events TO kronos_app;
REVOKE UPDATE, DELETE, TRUNCATE ON ticket_events FROM kronos_app;
