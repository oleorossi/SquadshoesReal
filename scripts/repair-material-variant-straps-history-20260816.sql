BEGIN;

-- As migrations 04300 e 04400 sao aplicadas pelo workflow db-exec, que usa a
-- Management API e nao atualiza automaticamente o historico do Supabase CLI.
-- Registre somente depois de ambas terem sido aplicadas e verificadas no banco.
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES
  ('20270101004300', 'material_variant_commercial_identity', '{}'::text[]),
  ('20270101004400', 'straps_buy_ready_identity', '{}'::text[])
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(v.version ORDER BY v.version)
    INTO v_missing
  FROM (VALUES
    ('20270101004300'),
    ('20270101004400')
  ) AS v(version)
  WHERE NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations m
    WHERE m.version = v.version
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Historico ainda sem migrations verificadas: %', v_missing;
  END IF;
END;
$$;

COMMIT;

SELECT version, name, cardinality(statements) AS statement_count
FROM supabase_migrations.schema_migrations
WHERE version IN ('20270101004300', '20270101004400')
ORDER BY version;
