BEGIN;

INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES
  ('20270101003000','artisanal_straps_catalog_core','{}'::text[]),
  ('20270101003050','artisanal_straps_catalog_postdeploy_hardening','{}'::text[]),
  ('20270101003100','artisanal_straps_operational_schema','{}'::text[]),
  ('20270101003200','artisanal_straps_operational_engine','{}'::text[]),
  ('20270101003300','artisanal_straps_legacy_migration_apply','{}'::text[]),
  ('20270101003400','timesheet_import_archive_permanent','{}'::text[]),
  ('20270101003500','artisanal_straps_postdeploy_acl_hardening','{}'::text[]),
  ('20270101004000','technical_sheet_industrial_readiness','{}'::text[]),
  ('20270101004100','sale_order_commercial_integrity','{}'::text[]),
  ('20270101004200','ponto_base_interna_incremental','{}'::text[])
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE v_missing text[];
BEGIN
  SELECT array_agg(v.version ORDER BY v.version) INTO v_missing
    FROM (VALUES
      ('20270101003000'),('20270101003050'),('20270101003100'),
      ('20270101003200'),('20270101003300'),('20270101003400'),
      ('20270101003500'),('20270101004000'),('20270101004100'),
      ('20270101004200')
    ) v(version)
   WHERE NOT EXISTS (
     SELECT 1 FROM supabase_migrations.schema_migrations m
      WHERE m.version=v.version
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Histórico ainda sem migrations verificadas: %',v_missing;
  END IF;
END;
$$;

COMMIT;

SELECT version,name,cardinality(statements) AS statement_count
  FROM supabase_migrations.schema_migrations
 WHERE version IN (
   '20270101003000','20270101003050','20270101003100','20270101003200',
   '20270101003300','20270101003400','20270101003500','20270101004000',
   '20270101004100','20270101004200'
 )
 ORDER BY version;
