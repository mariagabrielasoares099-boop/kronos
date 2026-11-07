-- Teste de isolamento: tenant, empresa (matriz/filial), pessoa autorizada e candidato.
-- Rodar como superusuario/migrator (com BYPASSRLS) num banco ja migrado.
-- Falha (RAISE EXCEPTION) se qualquer garantia for violada. Faz ROLLBACK ao final.
\set ON_ERROR_STOP on
BEGIN;

-- Define o contexto da transacao como a API faria (tenant, usuario, papel, candidato).
CREATE FUNCTION pg_temp.ctx(t uuid, u uuid DEFAULT NULL, r text DEFAULT NULL, c uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.tenant_id', coalesce(t::text, ''), true),
         set_config('app.user_id', coalesce(u::text, ''), true),
         set_config('app.user_role', coalesce(r, ''), true),
         set_config('app.candidate_id', coalesce(c::text, ''), true)
$$;

INSERT INTO tenants (id, nome) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'A'),
  ('00000000-0000-0000-0000-00000000000b', 'B');

SET LOCAL ROLE kronos_app;

DO $$
DECLARE
  ta  uuid := '00000000-0000-0000-0000-00000000000a';
  tb  uuid := '00000000-0000-0000-0000-00000000000b';
  adm uuid := '00000000-0000-0000-0000-0000000000e1';  -- ADMIN de A
  rhm uuid := '00000000-0000-0000-0000-0000000000e2';  -- RH vinculado a MATRIZ
  rhf uuid := '00000000-0000-0000-0000-0000000000e3';  -- RH vinculado a FILIAL
  rhx uuid := '00000000-0000-0000-0000-0000000000e4';  -- RH de OUTRA empresa
  rhn uuid := '00000000-0000-0000-0000-0000000000e5';  -- RH da matriz SEM atribuicao
  mat uuid := '00000000-0000-0000-0000-0000000000a1';  -- matriz
  fil uuid := '00000000-0000-0000-0000-0000000000a5';  -- filial da matriz
  oth uuid := '00000000-0000-0000-0000-0000000000a6';  -- outra empresa
  jf  uuid := '00000000-0000-0000-0000-0000000000b1';  -- vaga da filial
  jx  uuid := '00000000-0000-0000-0000-0000000000b2';  -- vaga da outra empresa
  c1  uuid := '00000000-0000-0000-0000-0000000000c1';  -- candidato da filial
  c2  uuid := '00000000-0000-0000-0000-0000000000c2';  -- candidato da outra empresa
  t1  uuid := '00000000-0000-0000-0000-0000000000d1';  -- chamado da filial
  t2  uuid := '00000000-0000-0000-0000-0000000000d2';  -- chamado da outra empresa
  d1  uuid := '00000000-0000-0000-0000-0000000000f1';  -- documento do chamado t1
  ub  uuid := '00000000-0000-0000-0000-0000000000e9';  -- admin de B
  b1  uuid := '00000000-0000-0000-0000-0000000000a9';  -- empresa de B
  n int;
BEGIN
  ---------------------------------------------------------------------------
  -- Preparacao (pelo caminho normal da API, com o papel kronos_app)
  ---------------------------------------------------------------------------
  PERFORM pg_temp.ctx(ta, adm, 'ADMIN');
  INSERT INTO users (id, tenant_id, nome, email, role, password_hash) VALUES
    (adm, ta, 'Admin', 'adm@a.com', 'ADMIN', 'x'),
    (rhm, ta, 'RH Matriz', 'm@a.com', 'RECRUTADOR', 'x'),
    (rhf, ta, 'RH Filial', 'f@a.com', 'RECRUTADOR', 'x'),
    (rhx, ta, 'RH Outra', 'x@a.com', 'RECRUTADOR', 'x'),
    (rhn, ta, 'RH Sem Atribuicao', 'n@a.com', 'RECRUTADOR', 'x');
  INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES (mat, ta, '11111111000111', 'Matriz A');
  INSERT INTO companies (id, tenant_id, cnpj, razao_social, matriz_id) VALUES (fil, ta, '11111111000222', 'Filial A', mat);
  INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES (oth, ta, '33333333000133', 'Outra A');
  INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES
    (ta, rhm, mat), (ta, rhn, mat), (ta, rhf, fil), (ta, rhx, oth);

  PERFORM pg_temp.ctx(ta, rhm, 'RECRUTADOR', c1);
  INSERT INTO jobs (id, tenant_id, company_id, titulo) VALUES (jf, ta, fil, 'Vaga filial');  -- matriz opera a filial
  INSERT INTO candidates (id, tenant_id, cpf, nome, email) VALUES (c1, ta, '12345678901', 'Cand 1', 'c1@x.com');
  INSERT INTO tickets (id, tenant_id, protocolo, job_id, candidate_id) VALUES (t1, ta, 'ADM-2026-000001', jf, c1);
  INSERT INTO ticket_events (id, tenant_id, ticket_id, tipo) VALUES (gen_random_uuid(), ta, t1, 'CRIADO');
  INSERT INTO messages (id, tenant_id, ticket_id, autor, canal, texto, interno) VALUES
    (gen_random_uuid(), ta, t1, 'rh', 'PORTAL', 'visivel ao candidato', false),
    (gen_random_uuid(), ta, t1, 'rh', 'PORTAL', 'nota interna', true);
  INSERT INTO ticket_assignments (tenant_id, ticket_id, user_id) VALUES (ta, t1, rhm), (ta, t1, rhf);

  PERFORM pg_temp.ctx(ta, rhx, 'RECRUTADOR', c2);
  INSERT INTO jobs (id, tenant_id, company_id, titulo) VALUES (jx, ta, oth, 'Vaga outra');
  INSERT INTO candidates (id, tenant_id, cpf, nome, email) VALUES (c2, ta, '98765432100', 'Cand 2', 'c2@x.com');
  INSERT INTO tickets (id, tenant_id, protocolo, job_id, candidate_id) VALUES (t2, ta, 'ADM-2026-000002', jx, c2);
  INSERT INTO ticket_assignments (tenant_id, ticket_id, user_id) VALUES (ta, t2, rhx);

  -- Documento enviado pelo proprio candidato (portal)
  PERFORM pg_temp.ctx(ta, NULL, NULL, c1);
  INSERT INTO documents (id, tenant_id, ticket_id, tipo, chave_storage, mime, tamanho_bytes, sha256)
    VALUES (d1, ta, t1, 'RG', ta || '/' || d1, 'image/jpeg', 10, repeat('a', 64));

  ---------------------------------------------------------------------------
  -- 1. Matriz e filial
  ---------------------------------------------------------------------------
  PERFORM pg_temp.ctx(ta, rhm, 'RECRUTADOR');
  SELECT count(*) INTO n FROM companies; IF n <> 2 THEN RAISE EXCEPTION 'matriz deveria ver matriz+filial, viu %', n; END IF;
  SELECT count(*) INTO n FROM tickets;   IF n <> 1 THEN RAISE EXCEPTION 'matriz deveria ver o chamado da filial: %', n; END IF;

  PERFORM pg_temp.ctx(ta, rhf, 'RECRUTADOR');
  SELECT count(*) INTO n FROM companies WHERE id = mat;
  IF n <> 0 THEN RAISE EXCEPTION 'filial enxergou a matriz'; END IF;
  SELECT count(*) INTO n FROM companies; IF n <> 1 THEN RAISE EXCEPTION 'filial deveria ver so a propria: %', n; END IF;
  SELECT count(*) INTO n FROM tickets;   IF n <> 1 THEN RAISE EXCEPTION 'filial deveria ver o proprio chamado: %', n; END IF;

  -- Matriz nao pode ser filial; filial nao pode ter filiais; sem auto-referencia.
  PERFORM pg_temp.ctx(ta, adm, 'ADMIN');
  BEGIN
    INSERT INTO companies (id, tenant_id, cnpj, razao_social, matriz_id)
      VALUES (gen_random_uuid(), ta, '44444444000144', 'Neta', fil);
    RAISE EXCEPTION 'filial de filial aceita';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'A matriz nao pode%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE companies SET matriz_id = oth WHERE id = mat;
    RAISE EXCEPTION 'matriz com filiais virou filial';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Empresa com filiais%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE companies SET matriz_id = id WHERE id = oth;
    RAISE EXCEPTION 'auto-referencia aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  ---------------------------------------------------------------------------
  -- 2. Empresa fechada para quem nao tem vinculo
  ---------------------------------------------------------------------------
  PERFORM pg_temp.ctx(ta, rhx, 'RECRUTADOR');
  SELECT count(*) INTO n FROM companies; IF n <> 1 THEN RAISE EXCEPTION 'RH de outra empresa viu % empresas', n; END IF;
  SELECT count(*) INTO n FROM tickets WHERE id = t1;     IF n <> 0 THEN RAISE EXCEPTION 'vazou chamado de outra empresa'; END IF;
  SELECT count(*) INTO n FROM candidates WHERE id = c1;  IF n <> 0 THEN RAISE EXCEPTION 'vazou candidato de outra empresa'; END IF;
  SELECT count(*) INTO n FROM documents;                 IF n <> 0 THEN RAISE EXCEPTION 'vazou documento de outra empresa'; END IF;
  SELECT count(*) INTO n FROM ticket_events;             IF n <> 0 THEN RAISE EXCEPTION 'vazou evento de outra empresa'; END IF;
  SELECT count(*) INTO n FROM messages;                  IF n <> 0 THEN RAISE EXCEPTION 'vazou mensagem de outra empresa'; END IF;
  BEGIN
    INSERT INTO tickets (id, tenant_id, protocolo, job_id, candidate_id) VALUES (gen_random_uuid(), ta, 'ADM-2026-000099', jf, c2);
    RAISE EXCEPTION 'abriu chamado em vaga de empresa sem vinculo';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE tickets SET status = 'REPROVADO' WHERE id = t1; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'alterou chamado de outra empresa'; END IF;

  -- ADMIN gere cadastro, mas nao ve chamados, candidatos nem documentos.
  PERFORM pg_temp.ctx(ta, adm, 'ADMIN');
  SELECT count(*) INTO n FROM companies; IF n <> 3 THEN RAISE EXCEPTION 'admin deveria gerir 3 empresas: %', n; END IF;
  SELECT count(*) INTO n FROM tickets;    IF n <> 0 THEN RAISE EXCEPTION 'admin viu chamados: %', n; END IF;
  SELECT count(*) INTO n FROM candidates; IF n <> 0 THEN RAISE EXCEPTION 'admin viu candidatos: %', n; END IF;
  SELECT count(*) INTO n FROM documents;  IF n <> 0 THEN RAISE EXCEPTION 'admin viu documentos: %', n; END IF;
  SELECT count(*) INTO n FROM jobs;       IF n <> 0 THEN RAISE EXCEPTION 'admin viu vagas: %', n; END IF;

  -- Sem usuario no contexto: falha segura.
  PERFORM pg_temp.ctx(ta);
  SELECT count(*) INTO n FROM companies; IF n <> 0 THEN RAISE EXCEPTION 'sem usuario viu empresas: %', n; END IF;
  SELECT count(*) INTO n FROM tickets;   IF n <> 0 THEN RAISE EXCEPTION 'sem usuario viu chamados: %', n; END IF;
  SELECT count(*) INTO n FROM documents; IF n <> 0 THEN RAISE EXCEPTION 'sem usuario viu documentos: %', n; END IF;

  ---------------------------------------------------------------------------
  -- 3. Documentos: vinculo com a empresa E atribuicao ao chamado
  ---------------------------------------------------------------------------
  PERFORM pg_temp.ctx(ta, rhn, 'RECRUTADOR');   -- vinculado a matriz, mas nao atribuido
  SELECT count(*) INTO n FROM tickets;   IF n <> 1 THEN RAISE EXCEPTION 'rhn deveria ver o chamado: %', n; END IF;
  SELECT count(*) INTO n FROM documents; IF n <> 0 THEN RAISE EXCEPTION 'sem atribuicao viu documento: %', n; END IF;

  PERFORM pg_temp.ctx(ta, rhm, 'RECRUTADOR');   -- atribuido
  SELECT count(*) INTO n FROM documents; IF n <> 1 THEN RAISE EXCEPTION 'atribuido nao viu o documento: %', n; END IF;
  PERFORM pg_temp.ctx(ta, rhf, 'RECRUTADOR');   -- atribuido (filial)
  SELECT count(*) INTO n FROM documents; IF n <> 1 THEN RAISE EXCEPTION 'atribuido da filial nao viu o documento: %', n; END IF;

  -- Atribuir nunca concede acesso a quem nao tem vinculo com a empresa.
  PERFORM pg_temp.ctx(ta, rhm, 'RECRUTADOR');
  BEGIN
    INSERT INTO ticket_assignments (tenant_id, ticket_id, user_id) VALUES (ta, t1, rhx);
    RAISE EXCEPTION 'atribuiu chamado a usuario de outra empresa';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Usuario sem vinculo/atribuicao nao se auto-atribui.
  PERFORM pg_temp.ctx(ta, rhx, 'RECRUTADOR');
  BEGIN
    INSERT INTO ticket_assignments (tenant_id, ticket_id, user_id) VALUES (ta, t1, rhx);
    RAISE EXCEPTION 'usuario se auto-atribuiu a chamado de outra empresa';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Quem nao e ADMIN nao altera vinculos.
  PERFORM pg_temp.ctx(ta, rhm, 'RECRUTADOR');
  BEGIN
    INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES (ta, rhm, oth);
    RAISE EXCEPTION 'RH se vinculou a outra empresa';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Metadados do documento sao imutaveis; so a decisao do RH atualiza.
  BEGIN
    UPDATE documents SET sha256 = repeat('b', 64); RAISE EXCEPTION 'app alterou metadados do documento';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM documents; RAISE EXCEPTION 'DELETE em documents permitido';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE documents SET status = 'RECUSADO'; RAISE EXCEPTION 'recusa sem motivo aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE documents SET status = 'RECUSADO', motivo = 'ilegivel'; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'decisao do RH nao gravou'; END IF;
  BEGIN
    INSERT INTO documents (id, tenant_id, ticket_id, tipo, chave_storage, mime, tamanho_bytes, sha256)
      VALUES (gen_random_uuid(), ta, t1, 'RG', 'k2', 'text/html', 10, repeat('a', 64));
    RAISE EXCEPTION 'mime invalido aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Quem nao esta atribuido nao envia documento em nome do chamado.
  PERFORM pg_temp.ctx(ta, rhn, 'RECRUTADOR');
  BEGIN
    INSERT INTO documents (id, tenant_id, ticket_id, tipo, chave_storage, mime, tamanho_bytes, sha256)
      VALUES (gen_random_uuid(), ta, t1, 'RG', 'k3', 'image/png', 10, repeat('a', 64));
    RAISE EXCEPTION 'usuario sem atribuicao inseriu documento';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  ---------------------------------------------------------------------------
  -- 4. Candidato: so o que e dele; mensagem interna fica oculta
  ---------------------------------------------------------------------------
  PERFORM pg_temp.ctx(ta, NULL, NULL, c1);
  SELECT count(*) INTO n FROM candidates; IF n <> 1 THEN RAISE EXCEPTION 'candidato deveria ver so a si: %', n; END IF;
  SELECT count(*) INTO n FROM tickets;    IF n <> 1 THEN RAISE EXCEPTION 'candidato deveria ver o proprio chamado: %', n; END IF;
  SELECT count(*) INTO n FROM documents;  IF n <> 1 THEN RAISE EXCEPTION 'candidato deveria ver o proprio documento: %', n; END IF;
  SELECT count(*) INTO n FROM messages;   IF n <> 1 THEN RAISE EXCEPTION 'candidato viu nota interna: %', n; END IF;
  SELECT count(*) INTO n FROM companies;  IF n <> 0 THEN RAISE EXCEPTION 'candidato viu empresas: %', n; END IF;
  SELECT count(*) INTO n FROM jobs;       IF n <> 0 THEN RAISE EXCEPTION 'candidato viu vagas: %', n; END IF;
  SELECT count(*) INTO n FROM ticket_events; IF n <> 0 THEN RAISE EXCEPTION 'candidato viu trilha interna: %', n; END IF;

  PERFORM pg_temp.ctx(ta, NULL, NULL, c2);
  SELECT count(*) INTO n FROM documents WHERE ticket_id = t1; IF n <> 0 THEN RAISE EXCEPTION 'candidato viu documento de outro'; END IF;
  SELECT count(*) INTO n FROM candidates WHERE id = c1;       IF n <> 0 THEN RAISE EXCEPTION 'candidato viu outro candidato'; END IF;

  ---------------------------------------------------------------------------
  -- 5. Isolamento entre tenants
  ---------------------------------------------------------------------------
  PERFORM pg_temp.ctx(tb, ub, 'ADMIN');
  INSERT INTO users (id, tenant_id, nome, email, role, password_hash) VALUES (ub, tb, 'Admin B', 'adm@b.com', 'ADMIN', 'x');
  INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES (b1, tb, '55555555000155', 'Empresa B');
  INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES (tb, ub, b1);

  SELECT count(*) INTO n FROM companies; IF n <> 1 THEN RAISE EXCEPTION 'B viu empresas de A: %', n; END IF;
  SELECT count(*) INTO n FROM users;     IF n <> 1 THEN RAISE EXCEPTION 'B viu usuarios de A: %', n; END IF;
  SELECT count(*) INTO n FROM tenants;   IF n <> 1 THEN RAISE EXCEPTION 'B deveria ver so o proprio tenant: %', n; END IF;
  UPDATE tenants SET nome = 'hack' WHERE id = ta; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B alterou o tenant A'; END IF;
  BEGIN
    INSERT INTO tenants (id, nome) VALUES (gen_random_uuid(), 'novo'); RAISE EXCEPTION 'app criou tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES (gen_random_uuid(), ta, '22222222000122', 'Intruso');
    RAISE EXCEPTION 'B conseguiu inserir em A';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE companies SET razao_social = 'hack' WHERE id = mat; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B alterou empresa de A'; END IF;
  -- Referencia cruzada: o banco recusa (RLS ou FK composta).
  BEGIN
    INSERT INTO jobs (id, tenant_id, company_id, titulo) VALUES (gen_random_uuid(), tb, mat, 'Referencia cruzada');
    RAISE EXCEPTION 'aceitou empresa de outro tenant';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES (tb, ub, mat);
    RAISE EXCEPTION 'vinculou usuario a empresa de outro tenant';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL;
  END;

  -- Sem tenant: zero linhas.
  PERFORM pg_temp.ctx(NULL);
  SELECT count(*) INTO n FROM tenants;   IF n <> 0 THEN RAISE EXCEPTION 'sem tenant leu tenants: %', n; END IF;
  SELECT count(*) INTO n FROM companies; IF n <> 0 THEN RAISE EXCEPTION 'sem tenant leu empresas: %', n; END IF;

  ---------------------------------------------------------------------------
  -- 6. Plano/identidade do tenant, trilha append-only e CHECKs de dominio
  ---------------------------------------------------------------------------
  PERFORM pg_temp.ctx(ta, rhm, 'RECRUTADOR');
  BEGIN
    UPDATE tenants SET plano = 'enterprise'; RAISE EXCEPTION 'app alterou o plano';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE tenants SET id = gen_random_uuid(); RAISE EXCEPTION 'app alterou a identidade do tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE tenants SET nome = 'Tenant A atualizado'; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'app nao atualizou nome do proprio tenant'; END IF;

  BEGIN
    UPDATE ticket_events SET tipo = 'X'; RAISE EXCEPTION 'UPDATE em ticket_events permitido';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM ticket_events; RAISE EXCEPTION 'DELETE em ticket_events permitido';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE ticket_events; RAISE EXCEPTION 'TRUNCATE em ticket_events permitido';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE tickets SET status = 'INVALIDO' WHERE id = t1; RAISE EXCEPTION 'status invalido aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM pg_temp.ctx(ta, rhm, 'RECRUTADOR', gen_random_uuid());
  BEGIN
    INSERT INTO candidates (id, tenant_id, cpf, nome, email)
      VALUES (app_candidate(), ta, '123', 'x', 'x@x.com');
    RAISE EXCEPTION 'CPF invalido aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'RLS OK: todas as garantias de isolamento passaram';
END $$;

ROLLBACK;
