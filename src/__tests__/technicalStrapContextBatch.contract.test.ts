import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101009100_otimizar_correcao_contexto_tiras.sql',
  ),
  'utf8',
);
const lockOrderMigration = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101009200_alinhar_locks_correcao_tiras.sql',
  ),
  'utf8',
);

function sqlFunction(name: string, dollarTag: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.indexOf(marker);
  expect(start, `${name} deve existir na migration 091`).toBeGreaterThanOrEqual(0);

  const terminator = `$${dollarTag}$;`;
  const end = migration.indexOf(terminator, start);
  expect(end, `${name} deve terminar com ${terminator}`).toBeGreaterThan(start);
  return migration.slice(start, end + terminator.length);
}

function between(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `marcador inicial ausente: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `marcador final ausente: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

const occurrences = (source: string, token: string) => source.split(token).length - 1;

describe('correção estrutural de tiras — writer em lote 091', () => {
  const batch = sqlFunction(
    'resolve_technical_strap_context_from_sale_order',
    'resolve_context_batch',
  );
  const singleLine = sqlFunction(
    'resolve_technical_strap_line_migration',
    'resolve_single_line',
  );

  it('transforma concorrência e stale state em PGRST/409 sem SQLSTATE retryable', () => {
    expect(batch).toContain('pg_try_advisory_xact_lock(');
    expect(batch).toContain('FOR UPDATE NOWAIT');
    expect(batch).not.toContain('PERFORM pg_advisory_xact_lock(');
    expect(batch).toContain("RAISE SQLSTATE 'PGRST'");
    expect(batch).toContain('DETAIL = \'{"status":409}\'');
    expect(batch).toContain("'code', 'technical_sheet_stale'");
    expect(occurrences(batch, "'code', 'strap_pipeline_busy'")).toBe(2);
    expect(batch).not.toContain('strap_context_busy');
    expect(batch).not.toContain('technical_sheet_busy');
    expect(batch).not.toContain('40001');

    expect(singleLine).toContain("'code', 'technical_line_content_mismatch'");
    expect(singleLine).toContain('pg_try_advisory_xact_lock(');
    expect(singleLine).toContain("hashtextextended('strap-pv-auto-intent', 0)");
    expect(singleLine).toContain("'code', 'strap_pipeline_busy'");
    expect(singleLine).toContain("SET lock_timeout = '1500ms'");
    expect(singleLine).toContain("RAISE SQLSTATE 'PGRST'");
    expect(singleLine).toContain('DETAIL = \'{"status":409}\'');
    expect(singleLine).not.toContain('40001');
  });

  it('não volta ao helper N vezes e protege fatos comprometidos antes de criar mapa', () => {
    expect(batch).not.toContain(
      'PERFORM public.resolve_technical_strap_line_migration(',
    );

    const committedGuard = batch.indexOf(
      "sale_order.status IN ('Aprovado', 'Em Produção')",
    );
    const ensureIdentity = batch.indexOf(
      'v_line_id := public.ensure_technical_strap_line_identity(',
    );
    const insertMap = batch.indexOf(
      'INSERT INTO public.technical_strap_line_identity_map',
    );
    const updateMap = batch.indexOf(
      'UPDATE public.technical_strap_line_identity_map',
    );

    expect(committedGuard).toBeGreaterThanOrEqual(0);
    expect(committedGuard).toBeLessThan(ensureIdentity);
    expect(committedGuard).toBeLessThan(insertMap);
    expect(committedGuard).toBeLessThan(updateMap);
    expect(batch).toContain(
      'A linha possui snapshot em PV Aprovado/Em Producao; corrija pelo fluxo administrativo',
    );
  });

  it('retorna no-op antes de qualquer escrita quando linhas e base já coincidem', () => {
    const noOp = batch.indexOf('-- Repetição com snapshot renovado:');
    const noOpReturn = batch.indexOf('RETURN jsonb_build_object(', noOp);
    const committedGuard = batch.indexOf('-- Guarda set-based dos fatos comprometidos');
    const firstMapInsert = batch.indexOf(
      'INSERT INTO public.technical_strap_line_identity_map',
    );
    const firstMapUpdate = batch.indexOf(
      'UPDATE public.technical_strap_line_identity_map',
    );
    const firstSheetUpdate = batch.indexOf('UPDATE public.technical_sheets');
    const outerAudit = batch.indexOf('INSERT INTO public.audit_logs');

    expect(batch).toContain('jsonb_array_length(v_candidates) = 0');
    expect(batch).toContain(
      'v_sheet.strap_base_group_id IS NOT DISTINCT FROM',
    );
    expect(noOp).toBeGreaterThanOrEqual(0);
    expect(noOpReturn).toBeGreaterThan(noOp);
    expect(noOpReturn).toBeLessThan(committedGuard);
    expect(noOpReturn).toBeLessThan(firstMapInsert);
    expect(noOpReturn).toBeLessThan(firstMapUpdate);
    expect(noOpReturn).toBeLessThan(firstSheetUpdate);
    expect(noOpReturn).toBeLessThan(outerAudit);
  });

  it('limita a ficha e cada item a um UPDATE por ramo e um log agregado', () => {
    const sheetWrites = between(
      batch,
      '-- Exatamente um UPDATE de technical_sheets',
      '-- Cada item aberto é bloqueado uma vez',
    );
    expect(occurrences(sheetWrites, 'UPDATE public.technical_sheets')).toBe(2);
    expect(sheetWrites).toMatch(
      /IF jsonb_array_length\(v_resolutions\) > 0 THEN[\s\S]*?UPDATE public\.technical_sheets[\s\S]*?ELSE[\s\S]*?UPDATE public\.technical_sheets[\s\S]*?END IF;/,
    );

    const itemWrites = between(
      batch,
      '-- Cada item aberto é bloqueado uma vez',
      '-- Auditoria técnica permanece uma por linha',
    );
    expect(occurrences(itemWrites, 'UPDATE public.sale_order_items')).toBe(2);
    expect(occurrences(itemWrites, "'sale_order_item',")).toBe(1);
    expect(itemWrites).toMatch(
      /IF v_item_had_match THEN[\s\S]*?UPDATE public\.sale_order_items[\s\S]*?ELSE[\s\S]*?UPDATE public\.sale_order_items[\s\S]*?END IF;[\s\S]*?log_artisanal_strap_migration_event/,
    );
    expect(itemWrites).toMatch(
      /v_item_has_divergence := true;[\s\S]*?review_required[\s\S]*?CONTINUE;/,
    );
    expect(itemWrites).toContain(
      "WHEN v_item_has_divergence THEN 'review_required'",
    );
  });

  it('não cria um segundo índice para a FK reference_id já indexada em produção', () => {
    expect(migration).not.toContain('idx_sale_order_items_reference_id');
    expect(migration).not.toMatch(
      /CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*?ON public\.sale_order_items\s*\(reference_id\)/i,
    );
  });

  it('mantém o helper público e o batch sob o mesmo lock global em produção', () => {
    const wrapperStart = lockOrderMigration.indexOf(
      'CREATE FUNCTION public.resolve_technical_strap_line_migration(',
    );
    const advisoryLock = lockOrderMigration.indexOf(
      'pg_try_advisory_xact_lock(',
      wrapperStart,
    );
    const implementationCall = lockOrderMigration.indexOf(
      'resolve_technical_strap_line_migration_locked_impl_091(',
      wrapperStart,
    );

    expect(wrapperStart).toBeGreaterThanOrEqual(0);
    expect(advisoryLock).toBeGreaterThan(wrapperStart);
    expect(implementationCall).toBeGreaterThan(advisoryLock);
    expect(lockOrderMigration).toContain(
      "ALTER FUNCTION public.resolve_technical_strap_context_from_sale_order(\n  uuid, uuid, jsonb, text, timestamptz\n)\nSET lock_timeout TO '1500ms';",
    );
    expect(lockOrderMigration).toContain(
      'REVOKE ALL ON FUNCTION\n  public.resolve_technical_strap_line_migration_locked_impl_091(uuid, uuid, text)\nFROM PUBLIC, anon, authenticated, service_role;',
    );
  });
});
