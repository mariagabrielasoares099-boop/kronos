-- Escrita separada de leitura nas politicas por empresa (achados da revisao do PR #37).
--
-- Problema: as politicas RESTRICTIVE `company_access` de tickets, candidates, documents e messages
-- eram FOR ALL. O ramo do candidato (`candidate_id = app_candidate()`, `candidate_owns_ticket()`) valia
-- tambem para INSERT/UPDATE/DELETE, entao, no banco, o candidato podia mudar o status do proprio chamado,
-- auto-aprovar documento, apagar o proprio cadastro e (via contexto com candidateId) criar chamado em
-- vaga de empresa sem vinculo. Hoje so a camada da API impedia isso.
--
-- Regra nova: o candidato LE o que e dele; ESCREVER exige vinculo da equipe com a empresa. Excecoes
-- explicitas: o candidato envia documento (sempre PENDENTE, sem revisor) e escreve mensagem nao interna.
-- LGPD (acesso/exclusao pelo titular) sera feita por funcao dedicada no M2, nao por DML direto.
--
-- Tambem: a aplicacao deixa de ler segredos de `users` e de atualizar colunas alem de `ultimo` em
-- protocol_counters.
--
-- Reversao (so antes de haver dados): recriar as politicas `company_access` FOR ALL da migration
-- 20261107000300 e devolver os grants de `users` e `protocol_counters`.

SET LOCAL lock_timeout = '5s';

DROP POLICY company_access ON tickets;
DROP POLICY company_access ON candidates;
DROP POLICY company_access ON documents;
DROP POLICY company_access ON messages;

-- tickets ---------------------------------------------------------------------------------------------
CREATE POLICY company_access_select ON tickets AS RESTRICTIVE FOR SELECT
  USING (can_see_job(job_id) OR candidate_id = app_candidate());
-- criar() informa candidateId no contexto so para o RETURNING enxergar a linha; isso nao libera a vaga.
CREATE POLICY company_access_insert ON tickets AS RESTRICTIVE FOR INSERT
  WITH CHECK (can_see_job(job_id));
CREATE POLICY company_access_update ON tickets AS RESTRICTIVE FOR UPDATE
  USING (can_see_job(job_id)) WITH CHECK (can_see_job(job_id));
CREATE POLICY company_access_delete ON tickets AS RESTRICTIVE FOR DELETE
  USING (can_see_job(job_id));

-- candidates ------------------------------------------------------------------------------------------
CREATE POLICY company_access_select ON candidates AS RESTRICTIVE FOR SELECT
  USING (id = app_candidate() OR staff_sees_candidate(id));
-- O candidato e criado antes do chamado (na mesma transacao); a vaga e conferida no INSERT do ticket.
CREATE POLICY company_access_insert ON candidates AS RESTRICTIVE FOR INSERT
  WITH CHECK (id = app_candidate() OR staff_sees_candidate(id));
CREATE POLICY company_access_update ON candidates AS RESTRICTIVE FOR UPDATE
  USING (staff_sees_candidate(id)) WITH CHECK (staff_sees_candidate(id));
CREATE POLICY company_access_delete ON candidates AS RESTRICTIVE FOR DELETE
  USING (staff_sees_candidate(id));

-- documents -------------------------------------------------------------------------------------------
CREATE POLICY company_access_select ON documents AS RESTRICTIVE FOR SELECT
  USING ((staff_sees_ticket(ticket_id) AND is_assigned(ticket_id)) OR candidate_owns_ticket(ticket_id));
-- O candidato so envia documento novo, pendente e sem revisor: nao nasce aprovado.
CREATE POLICY company_access_insert ON documents AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    (staff_sees_ticket(ticket_id) AND is_assigned(ticket_id))
    OR (candidate_owns_ticket(ticket_id) AND status = 'PENDENTE' AND revisado_por IS NULL AND motivo IS NULL)
  );
-- Aprovar/recusar: equipe atribuida ao chamado, em papel de RH.
CREATE POLICY company_access_update ON documents AS RESTRICTIVE FOR UPDATE
  USING (staff_sees_ticket(ticket_id) AND is_assigned(ticket_id) AND app_role() IN ('RECRUTADOR','DP'))
  WITH CHECK (staff_sees_ticket(ticket_id) AND is_assigned(ticket_id) AND app_role() IN ('RECRUTADOR','DP'));
-- Sem DELETE para a aplicacao (nao ha GRANT); a politica fecha a porta caso um GRANT apareca por engano.
CREATE POLICY company_access_delete ON documents AS RESTRICTIVE FOR DELETE USING (false);

-- messages --------------------------------------------------------------------------------------------
CREATE POLICY company_access_select ON messages AS RESTRICTIVE FOR SELECT
  USING (staff_sees_ticket(ticket_id) OR (NOT interno AND candidate_owns_ticket(ticket_id)));
CREATE POLICY company_access_insert ON messages AS RESTRICTIVE FOR INSERT
  WITH CHECK (staff_sees_ticket(ticket_id) OR (NOT interno AND candidate_owns_ticket(ticket_id)));
CREATE POLICY company_access_update ON messages AS RESTRICTIVE FOR UPDATE
  USING (staff_sees_ticket(ticket_id)) WITH CHECK (staff_sees_ticket(ticket_id));
CREATE POLICY company_access_delete ON messages AS RESTRICTIVE FOR DELETE
  USING (staff_sees_ticket(ticket_id));

-- users: a API nao le hash de senha nem segredo TOTP -----------------------------------------------------
-- Toda a equipe do tenant enxergava password_hash e totp_secret de todos os usuarios. O login futuro
-- deve ler essas colunas por funcao SECURITY DEFINER propria ou por papel de autenticacao separado.
REVOKE SELECT ON users FROM kronos_app;
GRANT SELECT (id, tenant_id, nome, email, role, created_at) ON users TO kronos_app;

-- protocol_counters: so o contador muda ------------------------------------------------------------------
REVOKE UPDATE ON protocol_counters FROM kronos_app;
GRANT UPDATE (ultimo) ON protocol_counters TO kronos_app;
