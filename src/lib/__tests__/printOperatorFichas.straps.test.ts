import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { operatorStrapsHtml } from '@/lib/printOperatorFichas';

const UUID_STRAPS = [
  {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    technical_strap_line_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    label: 'TIRA 1',
    color: 'AZUL',
    group_name: 'TIRA OVERLOCK 5MM',
  },
  {
    id: '11111111-1111-4111-8111-111111111111',
    technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
    label: 'TIRA 2',
    color: '',
    group_name: 'TIRA OVERLOCK 5MM',
  },
];

describe('atalho legado da ficha de operador · sequência de tiras', () => {
  it('imprime o material-base efetivo sem decompor grupo composto', () => {
    const html = operatorStrapsHtml('Aviamento', [{ ...UUID_STRAPS[0],
      base_group_id: 'grupo-composto', base_group_name: 'NAPA SOFT + MASSABOX' }], 'PRETO');
    expect(html).toContain('NAPA SOFT + MASSABOX');
    expect(html).not.toContain('<td>TIRA OVERLOCK 5MM</td>');
  });

  it('imprime as posições UUID na ordem do snapshot e a cor efetiva por linha', () => {
    const html = operatorStrapsHtml('Aviamento', UUID_STRAPS, 'PRETO');

    expect(html).toContain('Sequência de tiras');
    expect(html.indexOf('TIRA 1')).toBeLessThan(html.indexOf('TIRA 2'));
    expect(html).toContain('AZUL');
    expect(html).toContain('PRETO');
    expect(html).toContain('data-strap-position="1"');
    expect(html).toContain('data-strap-position="2"');
  });

  it('não inventa COBRE para Strass sem cor própria no snapshot', () => {
    const html = operatorStrapsHtml('Aviamento', [{
      ...UUID_STRAPS[1], identity_basis: 'finished_product_group',
      identity_group_id: 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
      group_name: 'TIRA STRASS 6MM',
    }], 'COBRE');
    expect(html).toContain('TIRA STRASS 6MM');
    expect(html).toContain('<td class="sc">—</td>');
    expect(html).not.toContain('COBRE');
  });

  it('carrega o snapshot strap_colors nas consultas e no caller do atalho', () => {
    const shortcutSource = readFileSync(
      resolve(process.cwd(), 'src/lib/printOperatorFichas.ts'),
      'utf8',
    );
    const dialogSource = readFileSync(
      resolve(process.cwd(), 'src/components/sale-orders/OperatorFichasDialog.tsx'),
      'utf8',
    );

    expect(shortcutSource).toContain(
      ".select('color, grade, quantity, reference_id, production_excluded_at, strap_colors')",
    );
    expect(shortcutSource).toContain(
      ".select('id, grade, production_excluded_at, strap_colors')",
    );
    expect(dialogSource).toMatch(
      /sale_order_items!sale_order_item_id\(grade,\s*strap_colors,\s*production_excluded_at\)/,
    );
    expect(dialogSource).toContain(
      'strap_colors: row.sale_order_items?.strap_colors ?? []',
    );
  });

  it('não vaza a sequência para Corte Forração ou Montagem', () => {
    expect(operatorStrapsHtml('Corte Forração', UUID_STRAPS, 'PRETO')).toBe('');
    expect(operatorStrapsHtml('Montagem', UUID_STRAPS, 'PRETO')).toBe('');
  });

  it('escapa texto persistido antes de escrever no documento de impressão', () => {
    const html = operatorStrapsHtml('Aviamento', [{
      label: '<script>alert(1)</script>',
      color: 'AZUL & BRANCO',
      group_name: '<b>NAPA</b>',
    }], 'PRETO');

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>NAPA</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('AZUL &amp; BRANCO');
  });
});
