-- Passo 1: libera slots sem tocar em SUPERUSER (Management API nao e superuser).
SET default_transaction_read_only = off;
SET transaction_read_only = off;

DO $kill$
DECLARE
  r record;
  killed int := 0;
BEGIN
  FOR r IN
    SELECT a.pid
    FROM pg_stat_activity a
    JOIN pg_roles rol ON rol.rolname = a.usename
    WHERE a.datname = current_database()
      AND a.pid <> pg_backend_pid()
      AND NOT rol.rolsuper
      AND a.usename = 'authenticator'
      AND a.query NOT ILIKE 'LISTEN%'
      AND (
        a.state LIKE 'idle in transaction%'
        OR (a.state = 'active' AND now() - a.query_start > interval '15 seconds')
        OR (a.state = 'idle' AND now() - a.state_change > interval '90 seconds')
      )
  LOOP
    BEGIN
      PERFORM pg_terminate_backend(r.pid);
      killed := killed + 1;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
  RAISE NOTICE 'killed % authenticator backends', killed;
END;
$kill$;

ALTER ROLE authenticator SET statement_timeout = 0;
ALTER ROLE authenticator SET lock_timeout = '60s';
ALTER ROLE authenticator SET pgrst.db_schemas = 'public';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

SELECT count(*) AS connections
FROM pg_stat_activity
WHERE datname = current_database();
