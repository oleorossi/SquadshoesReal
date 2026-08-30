import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/pages/TechnicalSheets.tsx'),
  'utf8',
);

const quickCreateStart = source.indexOf('function QuickCreateForm');
const quickCreateEnd = source.indexOf('/* ===== Completeness Indicator ===== */', quickCreateStart);
const quickCreate = source.slice(quickCreateStart, quickCreateEnd);

const pricingStart = source.indexOf('<TabsContent value="costs"');
const pricingEnd = source.indexOf('<TabsContent value="variants"', pricingStart);
const pricing = source.slice(pricingStart, pricingEnd);

describe('Ficha Técnica — preço-base comercial da referência', () => {
  it('permite informar o preço-base na criação rápida e envia o valor no cadastro', () => {
    expect(quickCreateStart).toBeGreaterThan(-1);
    expect(quickCreateEnd).toBeGreaterThan(quickCreateStart);
    expect(quickCreate).toContain('sale_price: 0');
    expect(quickCreate).toContain('id="qc-sale-price"');
    expect(quickCreate).toContain('sale_price: v');
    expect(quickCreate).toContain('Se nenhuma das três fontes tiver preço');
    expect(quickCreate).toContain('o valor positivo informado no item será aceito');
    expect(quickCreate).not.toContain('o pedido será bloqueado');
  });

  it('mantém o editor principal visível na aba Precificação mesmo sem BOM', () => {
    expect(pricingStart).toBeGreaterThan(-1);
    expect(pricingEnd).toBeGreaterThan(pricingStart);
    expect(pricing).toContain('Preço-base comercial da referência');
    expect(pricing).toContain("updateField('sale_price', v)");
    expect(pricing.indexOf("updateField('sale_price', v)"))
      .toBeLessThan(pricing.indexOf('<CostsTab'));
  });

  it('explica a precedência comercial sem transformar o preço da ficha em requisito universal', () => {
    expect(pricing).toContain(
      'Prioridade automática: tabela do cliente → variante de material → preço-base da referência.',
    );
    expect(pricing).toContain(
      'se também não houver tabela efetiva nem preço próprio da variante',
    );
    expect(pricing).toContain('sem validação de piso comercial');
    expect(pricing).toContain('Na ausência das três fontes');
    expect(pricing).not.toContain('serão bloqueados no lançamento');
  });
});
