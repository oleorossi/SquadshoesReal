import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contrato de ACL restaurado no cknb (20270101046100/46300): o browser não chama RPCs
// internalizadas — elas só devolveriam "permission denied".
describe('callers do browser × contrato de ACL', () => {
  it('faturamento não chama convert_reservation_to_out (baixa é do banco)', () => {
    const src = readFileSync(resolve('src/lib/releaseConsumption.ts'), 'utf8');
    expect(src).not.toMatch(/rpc\(\s*['"]convert_reservation_to_out['"]/);
    expect(src).toContain('settled_by_database');
  });

  it('hook morto de try_reserve_materials/release_order_reservations foi removido', () => {
    expect(existsSync(resolve('src/hooks/useTryReserve.ts'))).toBe(false);
  });

  it('punch_map_resolve fica fail-closed no browser até existir vigência', () => {
    const src = readFileSync(resolve('src/hooks/usePunchReconciliation.ts'), 'utf8');
    expect(src).toContain('PUNCH_MAP_WRITE_ENABLED = false');
    expect(src.match(/if \(!PUNCH_MAP_WRITE_ENABLED\) throw/g)?.length).toBe(2);
  });

  it('inventário aplica divergência via execute_stock_command, não adjust_stock', () => {
    const mig = readFileSync(
      resolve('supabase/migrations/20270101046700_inventario_aplica_via_execute_stock_command.sql'),
      'utf8',
    );
    expect(mig).toContain("public.execute_stock_command(\n      'adjust_products'");
    expect(mig).not.toMatch(/PERFORM public\.adjust_stock\(/);
  });
});
