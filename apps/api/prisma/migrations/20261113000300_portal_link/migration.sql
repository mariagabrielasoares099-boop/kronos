-- Entrada do candidato por link de uso unico enviado ao e-mail cadastrado (modulo 04).
--
-- Protocolo + CPF deixam de ser credencial: servem so para PEDIR o link. Quem prova ser o candidato e quem le o
-- e-mail. O codigo (256 bits aleatorios) nunca e guardado: so o SHA-256 dele. Vale 15 min, uma unica vez, e um
-- novo pedido invalida os anteriores. Maximo de 1 link por minuto por candidato (evita spam no e-mail dele).
--
-- portal_links NAO e acessivel ao papel da API (RLS FORCE sem politica + REVOKE): so as funcoes SECURITY DEFINER
-- abaixo leem/gravam. PRE-REQUISITO: o papel que roda a migration precisa de BYPASSRLS (como em 20261113000100).
-- Reversao (so antes de haver uso): DROP das 2 funcoes, GRANT EXECUTE de auth_candidato a kronos_app, DROP TABLE portal_links.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'O papel % precisa de BYPASSRLS para criar as funcoes do link do candidato', current_user;
  END IF;
END $$;

CREATE TABLE portal_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  candidate_id uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  expira_em    timestamptz(3) NOT NULL,
  usado_em     timestamptz(3),
  criado_em    timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT portal_links_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT portal_links_candidato_fk FOREIGN KEY (tenant_id, candidate_id) REFERENCES candidates (tenant_id, id)
);
CREATE INDEX portal_links_candidato_idx ON portal_links (tenant_id, candidate_id, criado_em DESC);

ALTER TABLE portal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON portal_links FROM PUBLIC, kronos_app;

-- Pede o link: localiza o candidato (protocolo + CPF, sem ambiguidade), aplica o intervalo minimo, invalida os
-- links anteriores e grava o novo. Devolve e-mail e nome para a API enviar; zero linhas = nada a enviar
-- (a API responde igual nos dois casos, entao quem pede nao descobre se o protocolo existe).
CREATE FUNCTION auth_candidato_solicitar_link(p_protocolo text, p_cpf text, p_hash text, p_expira timestamptz)
RETURNS TABLE (email text, nome text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_cand   uuid;
BEGIN
  SELECT a.tenant_id, a.candidate_id INTO v_tenant, v_cand FROM auth_candidato(p_protocolo, p_cpf) a;
  IF v_cand IS NULL THEN RETURN; END IF;
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

-- Troca o codigo por tenant + candidato, uma unica vez e de forma atomica (duas requisicoes simultaneas: so uma vence).
CREATE FUNCTION auth_candidato_consumir_link(p_hash text)
RETURNS TABLE (tenant_id uuid, candidate_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE portal_links l SET usado_em = now()
  WHERE l.token_hash = p_hash AND l.usado_em IS NULL AND l.expira_em > now()
    AND EXISTS (SELECT 1 FROM candidates c
                WHERE c.tenant_id = l.tenant_id AND c.id = l.candidate_id AND c.anonimizado_em IS NULL)
  RETURNING l.tenant_id, l.candidate_id
$$;

REVOKE ALL ON FUNCTION auth_candidato_solicitar_link(text, text, text, timestamptz), auth_candidato_consumir_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_candidato_solicitar_link(text, text, text, timestamptz), auth_candidato_consumir_link(text) TO kronos_app;

-- Protocolo + CPF nao abrem mais sessao: a funcao antiga vira de uso interno (chamada por solicitar_link).
REVOKE EXECUTE ON FUNCTION auth_candidato(text, text) FROM kronos_app;
