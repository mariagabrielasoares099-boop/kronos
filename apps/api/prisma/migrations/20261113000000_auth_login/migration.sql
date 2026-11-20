-- Login da equipe (modulo 01): senha + 2FA (TOTP), com bloqueio por tentativas e sem reuso de codigo.
--
-- A API nao le password_hash nem totp_secret (REVOKE em 20261109000100). O login le essas colunas SO por
-- estas funcoes SECURITY DEFINER, que devolvem apenas o necessario e nao aceitam tenant do cliente.
-- PRE-REQUISITO: o papel que roda a migration precisa de BYPASSRLS (users tem FORCE RLS), como em 20261107000300.
-- Reversao (so antes de haver dados): DROP das 4 funcoes e das 3 colunas de users.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'O papel % precisa de BYPASSRLS para criar as funcoes de autenticacao', current_user;
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN totp_ultimo_passo BIGINT,
  ADD COLUMN falhas_login      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN bloqueado_ate     TIMESTAMPTZ(3);

-- Credenciais por e-mail (pode haver o mesmo e-mail em tenants diferentes; limite de 5 linhas).
CREATE FUNCTION auth_credenciais(p_email text)
RETURNS TABLE (user_id uuid, tenant_id uuid, role text, password_hash text, totp_secret text,
               totp_ultimo_passo bigint, bloqueado_ate timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.tenant_id, u.role, u.password_hash, u.totp_secret, u.totp_ultimo_passo, u.bloqueado_ate
  FROM users u WHERE lower(u.email) = lower(p_email) ORDER BY u.created_at LIMIT 5
$$;

-- 5 falhas seguidas bloqueiam a conta por 15 minutos. Durante o bloqueio a contagem nao muda.
CREATE FUNCTION auth_registrar_falha(p_user uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE users SET
    falhas_login  = CASE WHEN falhas_login + 1 >= 5 THEN 0 ELSE falhas_login + 1 END,
    bloqueado_ate = CASE WHEN falhas_login + 1 >= 5 THEN now() + interval '15 minutes' ELSE bloqueado_ate END
  WHERE id = p_user AND (bloqueado_ate IS NULL OR bloqueado_ate <= now())
$$;

CREATE FUNCTION auth_registrar_sucesso(p_user uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE users SET falhas_login = 0, bloqueado_ate = NULL WHERE id = p_user
$$;

-- Aceita cada passo TOTP uma unica vez (atomico): devolve false se o codigo ja foi usado.
CREATE FUNCTION auth_consumir_passo_totp(p_user uuid, p_passo bigint) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (
    UPDATE users SET totp_ultimo_passo = p_passo
    WHERE id = p_user AND (totp_ultimo_passo IS NULL OR totp_ultimo_passo < p_passo)
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;

REVOKE ALL ON FUNCTION auth_credenciais(text), auth_registrar_falha(uuid), auth_registrar_sucesso(uuid),
  auth_consumir_passo_totp(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_credenciais(text), auth_registrar_falha(uuid), auth_registrar_sucesso(uuid),
  auth_consumir_passo_totp(uuid, bigint) TO kronos_app;
