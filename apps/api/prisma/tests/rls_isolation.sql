-- Teste de isolamento entre tenants. Rodar como superusuario/migrator num banco ja migrado.
-- Falha (RAISE EXCEPTION) se qualquer garantia for violada. Faz ROLLBACK ao final.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO tenants (id, nome) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'A'),
  ('00000000-0000-0000-0000-00000000000b', 'B');

SET LOCAL ROLE kronos_app;

DO $$
DECLARE n int;
BEGIN
  -- Tenant A cria dados
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-00000000000a', true);
  INSERT INTO companies (id, tenant_id, cnpj, razao_social)
    VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', '11111111000111', 'Empresa A');
  INSERT INTO candidates (id, tenant_id, cpf, nome, email)
    VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', '12345678901', 'Cand A', 'a@x.com');

  -- 1. Tenant B nao enxerga linhas de A
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-00000000000b', true);
  SELECT count(*) INTO n FROM companies;  IF n <> 0 THEN RAISE EXCEPTION 'vazamento em companies: %', n; END IF;
  SELECT count(*) INTO n FROM candidates; IF n <> 0 THEN RAISE EXCEPTION 'vazamento em candidates: %', n; END IF;

  SELECT count(*) INTO n FROM tenants; IF n <> 1 THEN RAISE EXCEPTION 'B deveria ver so o proprio tenant: %', n; END IF;
  UPDATE tenants SET nome = 'hack' WHERE id = '00000000-0000-0000-0000-00000000000a'; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B alterou o tenant A'; END IF;
  BEGIN
    INSERT INTO tenants (id, nome) VALUES (gen_random_uuid(), 'novo'); RAISE EXCEPTION 'app criou tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 2. Sem tenant definido: zero linhas (falha segura)
  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO n FROM tenants;    IF n <> 0 THEN RAISE EXCEPTION 'sem tenant leu tenants: %', n; END IF;
  SELECT count(*) INTO n FROM companies;  IF n <> 0 THEN RAISE EXCEPTION 'sem tenant retornou linhas: %', n; END IF;

  -- 3. B nao consegue inserir linha com tenant_id de A
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-00000000000b', true);
  BEGIN
    INSERT INTO companies (id, tenant_id, cnpj, razao_social)
      VALUES (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '22222222000122', 'Intruso');
    RAISE EXCEPTION 'B conseguiu inserir em A';
  EXCEPTION WHEN insufficient_privilege THEN NULL; -- violacao de policy RLS
  END;

  -- 4. B nao altera nem apaga dados de A
  UPDATE companies SET razao_social = 'hack'; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B alterou % linhas de A', n; END IF;
  DELETE FROM companies; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B apagou % linhas de A', n; END IF;

  -- 5. A ainda ve o proprio dado
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-00000000000a', true);
  SELECT count(*) INTO n FROM companies; IF n <> 1 THEN RAISE EXCEPTION 'A perdeu seus dados: %', n; END IF;

  -- Plano e identidade sao geridos pelo provisionamento.
  BEGIN
    UPDATE tenants SET plano = 'enterprise';
    RAISE EXCEPTION 'app alterou o plano';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE tenants SET id = gen_random_uuid();
    RAISE EXCEPTION 'app alterou a identidade do tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE tenants SET nome = 'Tenant A atualizado';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'app nao atualizou nome do proprio tenant'; END IF;

  -- 6. Trilha append-only: kronos_app nao altera/apaga eventos
  INSERT INTO jobs (id, tenant_id, company_id, titulo)
    VALUES ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','Vaga');
  INSERT INTO tickets (id, tenant_id, protocolo, job_id, candidate_id)
    VALUES ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-00000000000a','ADM-2026-000001','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a2');
  INSERT INTO ticket_events (id, tenant_id, ticket_id, tipo)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a4','CRIADO');
  BEGIN
    UPDATE ticket_events SET tipo = 'X'; RAISE EXCEPTION 'UPDATE em ticket_events permitido';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE ticket_events; RAISE EXCEPTION 'TRUNCATE em ticket_events permitido';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM ticket_events; RAISE EXCEPTION 'DELETE em ticket_events permitido';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- FKs devem rejeitar referencias cruzadas mesmo com tenant_id proprio.
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-00000000000b', true);
  BEGIN
    INSERT INTO jobs (id, tenant_id, company_id, titulo)
      VALUES (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b',
              '00000000-0000-0000-0000-0000000000a1', 'Referencia cruzada');
    RAISE EXCEPTION 'FK permitiu empresa de outro tenant';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-00000000000a', true);

  -- 7. CHECKs de dominio
  BEGIN
    UPDATE tickets SET status = 'INVALIDO'; RAISE EXCEPTION 'status invalido aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO candidates (id, tenant_id, cpf, nome, email)
      VALUES (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '123', 'x', 'x@x.com');
    RAISE EXCEPTION 'CPF invalido aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'RLS OK: todas as garantias de isolamento passaram';
END $$;

ROLLBACK;
