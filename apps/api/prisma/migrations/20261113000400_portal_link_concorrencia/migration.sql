-- Serializa pedidos do mesmo candidato antes de consultar o intervalo e invalidar links.
-- Sem esse lock, duas transacoes podem observar a ausencia de link e enviar dois e-mails.
CREATE OR REPLACE FUNCTION auth_candidato_solicitar_link(p_protocolo text, p_cpf text, p_hash text, p_expira timestamptz)
RETURNS TABLE (email text, nome text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_cand   uuid;
BEGIN
  SELECT a.tenant_id, a.candidate_id INTO v_tenant, v_cand FROM auth_candidato(p_protocolo, p_cpf) a;
  IF v_cand IS NULL THEN RETURN; END IF;
  PERFORM c.id FROM candidates c
  WHERE c.tenant_id = v_tenant AND c.id = v_cand AND c.anonimizado_em IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM portal_links l
             WHERE l.tenant_id = v_tenant AND l.candidate_id = v_cand AND l.criado_em > now() - interval '60 seconds') THEN
    RETURN;
  END IF;
  UPDATE portal_links l SET usado_em = now()
  WHERE l.tenant_id = v_tenant AND l.candidate_id = v_cand AND l.usado_em IS NULL;
  INSERT INTO portal_links (tenant_id, candidate_id, token_hash, expira_em)
  VALUES (v_tenant, v_cand, p_hash, LEAST(p_expira, now() + interval '15 minutes'));
  RETURN QUERY SELECT c.email, c.nome FROM candidates c WHERE c.tenant_id = v_tenant AND c.id = v_cand;
END
$$;
