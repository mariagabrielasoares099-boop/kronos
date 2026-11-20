-- CPF e protocolo podem coincidir entre tenants. Nunca escolher um tenant por LIMIT 1.
-- Mantem assinatura, SECURITY DEFINER, search_path e privilegios da funcao original.
CREATE OR REPLACE FUNCTION auth_candidato(p_protocolo text, p_cpf text)
RETURNS TABLE (tenant_id uuid, candidate_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT encontrados.tenant_id, encontrados.candidate_id
  FROM (
    SELECT t.tenant_id, t.candidate_id, count(*) OVER () AS quantidade
    FROM tickets t
    JOIN candidates c ON c.tenant_id = t.tenant_id AND c.id = t.candidate_id
    WHERE t.protocolo = p_protocolo AND c.cpf = p_cpf AND c.anonimizado_em IS NULL
  ) encontrados
  WHERE encontrados.quantidade = 1
$$;
