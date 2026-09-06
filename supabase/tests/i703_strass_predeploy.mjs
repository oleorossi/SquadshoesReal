// Gera SQL para execute_sql/psql; não abre conexão nem aplica migrations.
// Uso: bun supabase/tests/i703_strass_predeploy.mjs > /tmp/i703-strass-predeploy.sql
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/20270101016600_enforce_strap_measure_catalog_identity.sql', import.meta.url), 'utf8');
const test = readFileSync(new URL('./i703_buy_ready_strass_identity.sql', import.meta.url), 'utf8')
  .replace(/^BEGIN;\s*$/m, '').replace(/^ROLLBACK;\s*$/m, '');

process.stdout.write(`BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE i703_backfill_before ON COMMIT DROP AS
  SELECT id, to_jsonb(sheet) AS row FROM public.technical_sheets sheet;
CREATE TEMP TABLE i703_history_before (scope text, digest text) ON COMMIT DROP;
DO $capture$
DECLARE v_table text; v_digest text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'technical_sheet_snapshots', 'sale_order_items', 'sale_orders', 'products',
    'artisanal_strap_variants', 'artisanal_strap_recipes', 'orders',
    'material_reservations', 'stock_movements', 'sale_order_strap_demands'
  ] LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' '' ORDER BY id),'''')) FROM public.%I t', v_table)
      INTO v_digest;
    INSERT INTO i703_history_before VALUES (v_table, v_digest);
  END LOOP;
END $capture$;

${migration}

CREATE TEMP TABLE i703_first_apply ON COMMIT DROP AS
  SELECT id, to_jsonb(sheet) AS row FROM public.technical_sheets sheet;
${migration}

DO $verify$
DECLARE v_table text; v_digest text; v_expected text;
BEGIN
  FOR v_table, v_expected IN SELECT scope, digest FROM i703_history_before LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' '' ORDER BY id),'''')) FROM public.%I t', v_table)
      INTO v_digest;
    IF v_digest IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'Historico/catalogo/estoque alterado: %', v_table;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.technical_sheets sheet JOIN i703_first_apply before USING (id)
     WHERE to_jsonb(sheet) IS DISTINCT FROM before.row
  ) THEN RAISE EXCEPTION 'Migration166 nao e idempotente'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.technical_sheets sheet JOIN i703_backfill_before before USING (id)
     WHERE (to_jsonb(sheet) - 'strap_colors' - 'updated_at')
       IS DISTINCT FROM (before.row - 'strap_colors' - 'updated_at')
  ) THEN RAISE EXCEPTION 'Outro campo da ficha foi alterado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.technical_sheets sheet JOIN i703_backfill_before before USING (id)
     WHERE upper(coalesce(nullif(to_jsonb(sheet)->>'code', ''), sheet.name)) <> 'I703'
       AND to_jsonb(sheet) IS DISTINCT FROM before.row
  ) THEN RAISE EXCEPTION 'Revisar escopo: outra ficha alem da I703 mudou'; END IF;
  IF (SELECT tgenabled FROM pg_trigger
       WHERE tgrelid = 'public.technical_sheets'::regclass
         AND tgname = 'trg_mark_so_costs_dirty_from_sheet') <> 'O' THEN
    RAISE EXCEPTION 'Trigger de custos nao foi restaurado';
  END IF;
END $verify$;

${test}
ROLLBACK;
`);
