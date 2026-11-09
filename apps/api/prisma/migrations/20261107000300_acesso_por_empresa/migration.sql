-- Acesso por empresa e por pessoa autorizada (LGPD: minimo necessario).
--
-- Alem do isolamento por tenant, os dados de uma empresa ficam fechados para ela:
--  * usuario so enxerga empresas a que foi vinculado (user_companies);
--  * vinculado a MATRIZ enxerga matriz e filiais; vinculado a FILIAL enxerga so a propria;
--  * documentos exigem, alem do vinculo com a empresa, ATRIBUICAO ao chamado (ticket_assignments);
--  * o candidato enxerga apenas o proprio cadastro, chamados, documentos e mensagens nao internas.
--
-- A API informa o contexto por transacao, junto de app.tenant_id:
--   app.user_id, app.user_role (ADMIN, DP, ...), app.candidate_id (portal do candidato).
-- Sem contexto, nada e retornado (falha segura).
--
-- PRE-REQUISITO: o papel que roda a migration (kronos_migrator; no Supabase, postgres) precisa de
-- BYPASSRLS, porque as funcoes abaixo leem tabelas com FORCE RLS como dono.
-- Reversao (so antes de haver dados): DROP das politicas company_access, das funcoes, das
-- tabelas user_companies e ticket_assignments e da coluna companies.matriz_id.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'O papel % precisa de BYPASSRLS para criar as funcoes de politica', current_user;
  END IF;
END $$;

-- Matriz e filiais (um nivel) -----------------------------------------------------------------
ALTER TABLE companies ADD COLUMN matriz_id UUID;
ALTER TABLE companies ADD CONSTRAINT companies_tenant_id_matriz_id_fkey
  FOREIGN KEY (tenant_id, matriz_id) REFERENCES companies (tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE companies ADD CONSTRAINT companies_matriz_diferente_check CHECK (matriz_id IS NULL OR matriz_id <> id);
CREATE INDEX companies_tenant_id_matriz_id_idx ON companies (tenant_id, matriz_id);

-- users precisa de (tenant_id, id) unico para FKs compostas.
CREATE UNIQUE INDEX users_tenant_id_id_key ON users (tenant_id, id);

CREATE FUNCTION enforce_matriz_um_nivel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.matriz_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM companies WHERE id = NEW.matriz_id AND matriz_id IS NOT NULL) THEN
      RAISE EXCEPTION 'A matriz nao pode ser uma filial';
    END IF;
    IF EXISTS (SELECT 1 FROM companies WHERE matriz_id = NEW.id) THEN
      RAISE EXCEPTION 'Empresa com filiais nao pode virar filial';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER companies_matriz_um_nivel
  BEFORE INSERT OR UPDATE OF matriz_id ON companies
  FOR EACH ROW EXECUTE FUNCTION enforce_matriz_um_nivel();

-- Vinculos --------------------------------------------------------------------------------------
CREATE TABLE user_companies (
  tenant_id  UUID NOT NULL,
  user_id    UUID NOT NULL,
  company_id UUID NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_companies_pkey PRIMARY KEY (user_id, company_id),
  CONSTRAINT user_companies_tenant_id_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT user_companies_tenant_id_company_id_fkey FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE user_companies ADD CONSTRAINT user_companies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX user_companies_tenant_id_company_id_idx ON user_companies (tenant_id, company_id);

CREATE TABLE ticket_assignments (
  tenant_id  UUID NOT NULL,
  ticket_id  UUID NOT NULL,
  user_id    UUID NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ticket_assignments_pkey PRIMARY KEY (ticket_id, user_id),
  CONSTRAINT ticket_assignments_tenant_id_ticket_id_fkey FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets (tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ticket_assignments_tenant_id_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE ticket_assignments ADD CONSTRAINT ticket_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX ticket_assignments_tenant_id_user_id_idx ON ticket_assignments (tenant_id, user_id);

-- Contexto da transacao --------------------------------------------------------------------------
CREATE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_candidate() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.candidate_id', true), '')::uuid $$;
CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_role', true), '') $$;

-- Regras de visibilidade ----------------------------------------------------------------------------
-- O usuario u tem vinculo com a empresa c? Vinculo com a matriz vale para as filiais; o inverso nao.
CREATE FUNCTION user_has_company(u uuid, c uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM companies co
    JOIN user_companies uc ON uc.tenant_id = co.tenant_id
                          AND (uc.company_id = co.id OR uc.company_id = co.matriz_id)
    WHERE co.id = c AND co.tenant_id = app_tenant() AND uc.user_id = u
  )
$$;

CREATE FUNCTION can_see_company(c uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
  $$ SELECT app_user() IS NOT NULL AND user_has_company(app_user(), c) $$;

CREATE FUNCTION can_see_job(j uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM jobs jb WHERE jb.id = j AND jb.tenant_id = app_tenant() AND can_see_company(jb.company_id))
$$;

-- Equipe da empresa que opera o chamado.
CREATE FUNCTION staff_sees_ticket(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM tickets tk WHERE tk.id = t AND tk.tenant_id = app_tenant() AND can_see_job(tk.job_id))
$$;

CREATE FUNCTION candidate_owns_ticket(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_candidate() IS NOT NULL
     AND EXISTS (SELECT 1 FROM tickets tk WHERE tk.id = t AND tk.tenant_id = app_tenant() AND tk.candidate_id = app_candidate())
$$;

CREATE FUNCTION is_assigned(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_user() IS NOT NULL
     AND EXISTS (SELECT 1 FROM ticket_assignments ta
                 WHERE ta.ticket_id = t AND ta.user_id = app_user() AND ta.tenant_id = app_tenant())
$$;

CREATE FUNCTION staff_sees_candidate(cand uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM tickets tk
                 WHERE tk.candidate_id = cand AND tk.tenant_id = app_tenant() AND can_see_job(tk.job_id))
$$;

-- Atribuir um chamado nunca concede mais do que o vinculo com a empresa.
CREATE FUNCTION enforce_assignment_company() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tickets tk JOIN jobs jb ON jb.id = tk.job_id AND jb.tenant_id = tk.tenant_id
    WHERE tk.id = NEW.ticket_id AND tk.tenant_id = NEW.tenant_id
      AND user_has_company(NEW.user_id, jb.company_id)
  ) THEN
    RAISE EXCEPTION 'Usuario sem vinculo com a empresa do chamado' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ticket_assignments_company
  BEFORE INSERT ON ticket_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_assignment_company();

REVOKE ALL ON FUNCTION app_tenant(), app_user(), app_candidate(), app_role(), user_has_company(uuid, uuid),
  can_see_company(uuid), can_see_job(uuid), staff_sees_ticket(uuid), candidate_owns_ticket(uuid),
  is_assigned(uuid), staff_sees_candidate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant(), app_user(), app_candidate(), app_role(), user_has_company(uuid, uuid),
  can_see_company(uuid), can_see_job(uuid), staff_sees_ticket(uuid), candidate_owns_ticket(uuid),
  is_assigned(uuid), staff_sees_candidate(uuid) TO kronos_app;

-- RLS das tabelas novas (isolamento por tenant, como as demais) -----------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_companies','ticket_assignments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, DELETE ON user_companies, ticket_assignments TO kronos_app;

-- Politicas RESTRITIVAS: somam-se (AND) ao isolamento por tenant ----------------------------------
-- Cadastro de empresas e vinculos: o ADMIN gere, mas NAO ve chamados, candidatos nem documentos.
CREATE POLICY company_access ON companies AS RESTRICTIVE
  USING (app_role() = 'ADMIN' OR can_see_company(id));
-- Ler: o proprio vinculo (ou ADMIN). Escrever: so ADMIN. Ninguem se vincula sozinho.
CREATE POLICY company_access_select ON user_companies AS RESTRICTIVE FOR SELECT
  USING (app_role() = 'ADMIN' OR user_id = app_user());
CREATE POLICY company_access_insert ON user_companies AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_role() = 'ADMIN');
CREATE POLICY company_access_delete ON user_companies AS RESTRICTIVE FOR DELETE
  USING (app_role() = 'ADMIN');
-- Ler: as proprias atribuicoes (ou quem opera o chamado). Escrever: RECRUTADOR/DP que opera o chamado,
-- nunca em causa propria sem esse papel. O trigger ainda exige vinculo do atribuido com a empresa.
CREATE POLICY company_access_select ON ticket_assignments AS RESTRICTIVE FOR SELECT
  USING (user_id = app_user() OR (app_role() IN ('ADMIN','RECRUTADOR','DP') AND staff_sees_ticket(ticket_id)));
CREATE POLICY company_access_insert ON ticket_assignments AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_role() IN ('RECRUTADOR','DP') AND staff_sees_ticket(ticket_id));
CREATE POLICY company_access_delete ON ticket_assignments AS RESTRICTIVE FOR DELETE
  USING (app_role() IN ('RECRUTADOR','DP') AND staff_sees_ticket(ticket_id));

CREATE POLICY company_access ON jobs AS RESTRICTIVE
  USING (can_see_company(company_id));
CREATE POLICY company_access ON tickets AS RESTRICTIVE
  USING (can_see_job(job_id) OR candidate_id = app_candidate());
CREATE POLICY company_access ON ticket_events AS RESTRICTIVE
  USING (staff_sees_ticket(ticket_id));
CREATE POLICY company_access ON messages AS RESTRICTIVE
  USING (staff_sees_ticket(ticket_id) OR (NOT interno AND candidate_owns_ticket(ticket_id)));
CREATE POLICY company_access ON candidates AS RESTRICTIVE
  USING (id = app_candidate() OR staff_sees_candidate(id));
-- Documentos: vinculo com a empresa E atribuicao ao chamado (ou o proprio candidato).
CREATE POLICY company_access ON documents AS RESTRICTIVE
  USING ((staff_sees_ticket(ticket_id) AND is_assigned(ticket_id)) OR candidate_owns_ticket(ticket_id));
