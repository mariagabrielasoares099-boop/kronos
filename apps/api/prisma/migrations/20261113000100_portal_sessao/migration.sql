-- Entrada do candidato no portal (modulo 04): protocolo + CPF -> contexto de acesso (tenant + candidato).
--
-- Ainda nao se sabe de quem e a requisicao, entao o RLS nao tem contexto. Esta funcao SECURITY DEFINER e o unico
-- caminho: recebe protocolo e CPF, devolve no maximo UMA linha (tenant e candidato) e nada mais. Nao lista nem
-- diferencia "protocolo inexistente" de "CPF errado" (ambos devolvem zero linhas).
-- PRE-REQUISITO: o papel que roda a migration precisa de BYPASSRLS (candidates e tickets tem FORCE RLS).
-- Reversao: DROP FUNCTION auth_candidato(text, text).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'O papel % precisa de BYPASSRLS para criar a funcao de entrada do candidato', current_user;
  END IF;
END $$;

CREATE FUNCTION auth_candidato(p_protocolo text, p_cpf text)
RETURNS TABLE (tenant_id uuid, candidate_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.tenant_id, t.candidate_id
  FROM tickets t
  JOIN candidates c ON c.tenant_id = t.tenant_id AND c.id = t.candidate_id
  WHERE t.protocolo = p_protocolo AND c.cpf = p_cpf AND c.anonimizado_em IS NULL
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION auth_candidato(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_candidato(text, text) TO kronos_app;
