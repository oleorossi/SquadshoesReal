import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const table = readFileSync(resolve(ROOT, 'src/components/inventory/ProductTable.tsx'), 'utf8');
const dialog = readFileSync(resolve(ROOT, 'src/components/inventory/ArtisanalProductDialog.tsx'), 'utf8');

describe('estoque — tira nominal comprada pronta', () => {
  it('classifica por UUID antes da variante canônica, preserva baixa e esconde ação artesanal', () => {
    expect(table).toContain('isNominalBuyReadyStrapIdentity(product.id, product.group_id)');
    expect(table).toContain('aria-label="Baixa manual"');
    expect(table).toContain('!isPurchasedReadyStrap && <Tooltip>');
    expect(table).toContain('COMPRADA PRONTA');
    expect(table).not.toContain('purchasedReadyProductIds.has(product.id)\n          && !product.is_artisanal');
  });

  it('encaminha identidade nominal ainda não resolvida ao Hub sem oferecer receita', () => {
    expect(dialog).toContain('isNominalBuyReadyStrapIdentity(target.id, target.group_id)');
    expect(dialog).toContain('Tira comprada pronta');
    expect(dialog).toContain('Resolver no Hub de Tiras');
    expect(dialog).toContain('não pode ser marcado como artesanal');
  });
});
