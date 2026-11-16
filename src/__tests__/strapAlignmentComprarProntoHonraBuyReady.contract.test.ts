/**
 * Guarda de alinhamento × Comprar pronto (47000).
 *
 * Depois da 46900 a pré-checagem aceita buy_ready só com cor. O ramo
 * so-registra da 45300 ainda exigia pv_origem=sku_acabado pra rotear —
 * default Prestador do catálogo + sourcing buy_ready caía no ELSIF interno.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const FILE = '20270101047000_alinhamento-comprar-pronto-honra-buy-ready.sql';
const MARKER = 'strap_alinhamento_comprar_pronto_honra_buy_ready_20270101047000';
const migration = readFileSync(resolve(ROOT, 'supabase/migrations', FILE), 'utf8');
const guard = readFileSync(resolve(ROOT, 'src/lib/strapSnapshotGuard.ts'), 'utf8');

describe('Alinhamento — Comprar pronto roteia por buy_ready (47000)', () => {
  it('patcha o IF so-registra para aceitar source_mode=buy_ready', () => {
    expect(migration).toContain(MARKER);
    expect(migration).toContain('strap_comprar_pronto_so_registra_20270101045300');
    expect(migration).toContain('strap_alinhamento_comprar_pronto_so_registra_precheck_20270101046900');
    expect(migration).toContain("OR v_source_mode = 'buy_ready'");
    expect(migration).toContain("nullif(v_line ->> 'pv_origem', '') = 'sku_acabado'");
  });

  it('exige 45300 e 46900 no corpo vivo antes de patchar', () => {
    expect(migration).toContain('aplique a 45300 antes da 47000');
    expect(migration).toContain('aplique a 46900 antes da 47000');
  });

  it('o recover do submit alinha pv_origem ao buy_ready operacional', () => {
    expect(guard).toContain("mode === 'buy_ready' && line.pv_origem !== 'sku_acabado'");
    expect(guard).toContain("pv_origem: 'sku_acabado'");
  });
});
