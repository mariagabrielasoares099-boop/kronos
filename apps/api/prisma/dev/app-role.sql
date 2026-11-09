-- Papel de LOGIN da API, so para desenvolvimento local. Rodar como administrador, depois das migrations
-- (kronos_app e criado em 20261105000100_rls_roles).
--
-- A API NAO pode conectar como superusuario, BYPASSRLS ou dono das tabelas: o banco ignoraria todo o
-- isolamento (e a API recusa subir assim). kronos_api herda os privilegios minimos de kronos_app.
-- Em producao/Supabase: crie um papel equivalente com senha propria (fora do repositorio):
--   CREATE ROLE kronos_api LOGIN PASSWORD '<segredo>' NOSUPERUSER NOBYPASSRLS IN ROLE kronos_app;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kronos_api') THEN
    CREATE ROLE kronos_api LOGIN PASSWORD 'kronos_api_dev'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE IN ROLE kronos_app;
  END IF;
END $$;
