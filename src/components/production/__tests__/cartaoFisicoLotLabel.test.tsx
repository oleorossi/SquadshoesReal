/**
 * Smoke: lotLabel aparece acima dos pares; lotCode no rodapé; sem duplicata no header.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CartaoFisico } from '@/components/production/CartaoFisico';

describe('CartaoFisico · lotLabel', () => {
  it('mostra lotLabel junto aos pares e lotCode no rodapé', () => {
    const { container, getByText, queryAllByText } = render(
      <CartaoFisico
        sectorName="Montagem"
        opNumber="OP-01001"
        pvLabel="PV-00160"
        title="OFF WHITE"
        sizes={['35', '36']}
        grade={{ '35': 6, '36': 6 }}
        totalPairs={12}
        lotLabel="30 de 62"
        lotCode="30/62"
      />,
    );

    expect(getByText('30 de 62')).toBeTruthy();
    expect(getByText('30/62')).toBeTruthy();
    // Uma vez só o rótulo por extenso (não no header sob a OP).
    expect(queryAllByText('30 de 62')).toHaveLength(1);

    const pairsBlock = getByText('pares').parentElement;
    expect(pairsBlock?.textContent).toContain('30 de 62');
    expect(pairsBlock?.textContent).toContain('12');

    // Header tem OP, não o lotLabel.
    const header = container.querySelector('.cartao-fisico > div');
    expect(header?.textContent).toContain('OP-01001');
    expect(header?.textContent).not.toContain('30 de 62');
  });
});
