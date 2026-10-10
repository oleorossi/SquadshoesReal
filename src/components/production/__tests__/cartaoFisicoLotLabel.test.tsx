/**
 * Smoke: contador do maço (`lotCode` k/N) no rodapé; não no header sob a OP.
 * `lotLabel` ("k de N") fica só no builder — o cartão denso mostra só k/N.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CartaoFisico } from '@/components/production/CartaoFisico';

describe('CartaoFisico · lotCode', () => {
  it('mostra lotCode no rodapé e não no header', () => {
    const { container, getByText, queryByText } = render(
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

    expect(getByText('30/62')).toBeTruthy();
    // rótulo por extenso não entra no cartão denso
    expect(queryByText('30 de 62')).toBeNull();

    expect(getByText('pares').parentElement?.textContent).toContain('12');

    const header = container.querySelector('.cartao-fisico > div');
    expect(header?.textContent).toContain('OP-01001');
    expect(header?.textContent).not.toContain('30/62');
  });
});
