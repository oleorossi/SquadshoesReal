import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101029200_propagate_sheet_straps_to_open_pvs.sql',
  ),
  'utf8',
);
const RESYNC = readFileSync(resolve(ROOT, 'src/lib/resyncOPs.ts'), 'utf8');
const CONSUMO_GAP = readFileSync(
  resolve(ROOT, 'src/__tests__/consumoSheetStrapGap.contract.test.ts'),
  'utf8',
);

/**
 * Troca de TIPO de tira (metragem igual) muda o rendimento → napa-base.
 * Save da ficha precisa realinhar strap_colors do PV e o Consumo precisa
 * overlayar estrutura também em Aprovado/Em Produção.
 */
describe('propagação de tipo de tira no save da ficha', () => {
  it('RPC propaga tiras antes do resync e devolve straps_updated', () => {
    expect(MIGRATION).toContain('propagate_sheet_straps_to_open_pvs');
    expect(MIGRATION).toContain('sheet_strap_propagate_on_save_292');
    expect(MIGRATION).toContain('straps_updated');
    expect(MIGRATION).toMatch(
      /v_straps\s*:=\s*public\.propagate_sheet_straps_to_open_pvs/,
    );
    expect(MIGRATION).toContain('strap_type_id');
    expect(MIGRATION).toContain("'Aprovado', 'Em Produção'");
  });

  it('merge detecta drift de tipo mesmo com consumption igual', () => {
    // Ordem load-bearing: strap_type_id entra no v_drift ANTES de consumptions
    // iguais poderem mascarar o tipo.
    const typeIdx = MIGRATION.indexOf("v_item_line ->> 'strap_type_id'");
    const consIdx = MIGRATION.indexOf("v_item_line ->> 'consumption'");
    expect(typeIdx).toBeGreaterThan(0);
    expect(consIdx).toBeGreaterThan(typeIdx);
  });

  it('re-resolve receita via prepare quando o tipo muda com metragem igual', () => {
    // clear_stale sozinho deixa o item sem cor/variante e o gatilho de
    // alinhamento recusa — prepare + force_revalidate é o caminho vivo.
    expect(MIGRATION).toContain('prepare_sale_order_item_internal_straps');
    expect(MIGRATION).toContain('sheet_strap_propagate_prepare_hotfix_292b');
    expect(MIGRATION).toContain('strap_line_productive_inputs_changed');
    expect(MIGRATION).toContain("app.strap_force_revalidate");
    expect(MIGRATION).toContain("app.strap_source_rpc");
    expect(MIGRATION).toContain('strap_sourcing = v_next_sourcing');
  });

  it('auto_resync sobe errors[] de propagate (receita ausente) no toast', () => {
    const toastMig = readFileSync(
      resolve(
        ROOT,
        'supabase/migrations/20270101029300_auto_resync_surface_strap_propagate_errors.sql',
      ),
      'utf8',
    );
    expect(toastMig).toContain('strap_propagate_err_toast_293');
    expect(toastMig).toContain('Tiras PV');
    expect(toastMig).toMatch(/v_errors\s*:=\s*v_errors\s*\|\|\s*\(/);
    expect(RESYNC).toContain("startsWith('Tiras PV')");
  });

  it('Consumo batch liga overlay em PV comprometido', () => {
    expect(MIGRATION).toContain('v_overlay_structure := true');
    expect(MIGRATION).toContain(
      'v_overlay_structure := NOT private.is_committed_sale_order_status',
    );
  });

  it('cliente expõe strapsUpdated no toast de propagação', () => {
    expect(RESYNC).toContain('strapsUpdated');
    expect(RESYNC).toContain('straps_updated');
    expect(RESYNC).toContain('tiras realinhadas');
  });

  it('contrato 231 continua documentando o gate antigo (histórico)', () => {
    // O teste 231 trava o arquivo histórico; a 292 é quem libera o overlay.
    expect(CONSUMO_GAP).toContain('is_committed_sale_order_status');
    expect(MIGRATION).toContain('calculate_consumption_report_batch');
  });
});
