-- ADMIN administra cadastros, mas vinculo com empresa nao concede acesso a
-- vagas nem a dados pessoais. Mantem as migrations anteriores imutaveis.
-- As funcoes dependentes consultam can_see_job: a restricao tambem protege
-- chamados, candidatos, eventos, mensagens e documentos.
--
-- Antes: can_see_job/politica de jobs so exigiam vinculo com a empresa; um ADMIN vinculado a uma
-- empresa enxergava as vagas dela (contradizia docs/DADOS.md: "ADMIN nao ve vagas").
-- Agora o papel precisa ser operacional (RECRUTADOR, DP, GESTOR_VAGA, AVALIADOR, ALMOXARIFADO).
--
-- Reversao (so antes de haver dados): recriar can_see_job e a politica company_access de jobs como
-- na migration 20261107000300_acesso_por_empresa.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION can_see_job(j uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_role() IN ('RECRUTADOR', 'DP', 'GESTOR_VAGA', 'AVALIADOR', 'ALMOXARIFADO')
     AND EXISTS (SELECT 1 FROM jobs jb WHERE jb.id = j AND jb.tenant_id = app_tenant() AND can_see_company(jb.company_id))
$$;

-- A politica de jobs usa diretamente can_see_company, nao can_see_job.
DROP POLICY company_access ON jobs;
CREATE POLICY company_access ON jobs AS RESTRICTIVE
  USING (app_role() IN ('RECRUTADOR', 'DP', 'GESTOR_VAGA', 'AVALIADOR', 'ALMOXARIFADO') AND can_see_company(company_id));
