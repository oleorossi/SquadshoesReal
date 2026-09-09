import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101020000_per_pv_purchase_include_draft_targets.sql',
);
const dialog = read('src/components/purchase/GeneratePurchaseOrdersDialog.tsx');

describe('Compras por Pedido — PV Rascunho/Pendente entra no cálculo', () => {
  it('inclui o PV alvo em Rascunho/Pendente sem deixar rascunho alheio competir', () => {
    expect(migration).toContain('compute_allocated_per_pv_purchase_need_lines');
    expect(migration).toContain('compute_per_pv_packaging_purchase_needs_124');
    expect(migration).toContain("so.status IN ('Rascunho', 'Pendente')");
    expect(migration).toContain('so.id = ANY(COALESCE(p_target_pv_ids, ARRAY[]::uuid[]))');
    expect(migration).toContain('so.id = ANY(COALESCE(p_pv_ids, ARRAY[]::uuid[]))');
    // Competidores vivos continuam no filtro clássico.
    expect(migration).toContain("so.status IN ('Aprovado', 'Em Produção')");
    expect(migration).toContain('pg_get_functiondef');
  });

  it('não rotula 0 linhas da RPC como "estoque cobre"', () => {
    expect(dialog).toContain(
      'Nenhuma necessidade calculada para este(s) pedido(s). Confira se o PV tem itens e ficha técnica.',
    );
    expect(dialog).toContain('purchasableNeeds.length === 0 && needs.length === 0');
  });
});
