-- Passo 1: so libera slots. Sem DDL pesado.
SET default_transaction_read_only = off;
SET transaction_read_only = off;

SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND usename = 'authenticator'
  AND query NOT ILIKE 'LISTEN%'
  AND (
    state LIKE 'idle in transaction%'
    OR (state = 'active' AND now() - query_start > interval '15 seconds')
    OR (state = 'idle' AND now() - state_change > interval '90 seconds')
  );

ALTER ROLE authenticator SET statement_timeout = 0;
ALTER ROLE authenticator SET lock_timeout = '60s';
ALTER ROLE authenticator SET pgrst.db_schemas = 'public';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

SELECT count(*) AS connections
FROM pg_stat_activity
WHERE datname = current_database();
