import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const dialog = read('src/components/purchase/GeneratePurchaseOrdersDialog.tsx');
const hook = read('src/hooks/usePerPvPurchasing.ts');
const domain = read('src/lib/perPvPurchasing.ts');
const structuralGuard = domain.slice(
  domain.indexOf('export function isStructuralArtisanalStrapPurchaseItem'),
  domain.indexOf('export function partitionPerPvStrapPurchaseItems'),
);

describe('Compras por Pedido — cutover estrutural de tiras', () => {
  it('separa tiras no diálogo, mantém materiais comuns e aponta para o hub automático', () => {
    expect(dialog).toContain('useArtisanalStrapCatalog(true)');
    expect(dialog).toContain('partitionPerPvStrapPurchaseItems');
    expect(dialog).toContain('const purchasableNeeds = needsPartition.common');
    expect(dialog).toContain('const excludedStrapNeeds = needsPartition.straps');
    expect(dialog).toContain('/tiras-artesanais?tab=demandas');
    expect(dialog).toContain('Os materiais comuns abaixo continuam normalmente em Compras por Pedido.');
    expect(dialog).not.toContain('unrolledSuspects');
    expect(dialog).not.toContain('isSuspectUnrolledArtisanal');
    expect(dialog).not.toContain('marque o produto como artesanal');
  });

  it('revalida identidades no hook antes da RPC transacional e falha fechada', () => {
    expect(hook).toContain("rpc('list_artisanal_strap_catalog'");
    expect(hook).toContain("select('id, group_id, is_artisanal')");
    expect(hook).toContain("select('id, is_artisanal_strap')");
    expect(hook).toContain('excludeStrapsFromPerPvDrafts(submitted, strapIdentityGuard)');
    expect(hook).toContain('const valid = filtered.drafts');
    expect(hook).toContain('for (const d of valid)');
    expect(hook).toContain('Nenhuma OC foi gerada');
    expect(hook.indexOf('excludeStrapsFromPerPvDrafts(submitted, strapIdentityGuard)'))
      .toBeLessThan(hook.indexOf("rpc('create_per_pv_purchase_orders_atomic'"));
    expect(hook).not.toContain(".from('purchase_orders')\n          .insert");
  });

  it('classifica somente por identidade estrutural, sem regex de nome ou SKU', () => {
    expect(structuralGuard).toContain('technicalLineId');
    expect(structuralGuard).toContain('variantId');
    expect(structuralGuard).toContain('canonicalFinishedProductIds');
    expect(structuralGuard).toContain('canonicalStrapGroupIds');
    expect(structuralGuard).not.toContain('product_name');
    expect(structuralGuard).not.toContain('.name');
    expect(structuralGuard).not.toContain('sku');
    expect(structuralGuard).not.toMatch(/RegExp|\.match\(|\.includes\(/);
  });
});
