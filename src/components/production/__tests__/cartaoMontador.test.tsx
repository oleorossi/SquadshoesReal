import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CartaoMontador } from '@/components/production/CartaoMontador';

const base = {
  codigo: 'PM-000042',
  opNumber: 'OP-2026-06199',
  pvLabel: 'PV-00255',
  clientName: 'Loja Exemplo Ltda',
  referenceLabel: 'M100',
  color: 'OFF WHITE',
  fichaIndex: 1,
  totalFichas: 75,
  pares: 12,
  isSobra: false,
};

describe('CartaoMontador', () => {
  it('destaca o código único, o contador 01/75 e o QR com o mesmo valor', () => {
    const { container, getByText, getAllByText } = render(<CartaoMontador {...base} />);
    expect(getAllByText('PM-000042').length).toBeGreaterThanOrEqual(1);
    expect(getByText('01/75')).toBeTruthy();
    expect(getByText('OP-2026-06199')).toBeTruthy();
    expect(getByText('PV-00255')).toBeTruthy();
    expect(getByText('M100 · OFF WHITE')).toBeTruthy();
    expect(getByText('12')).toBeTruthy();
    expect(getByText('pares')).toBeTruthy();
    expect(getByText(/Montador:/)).toBeTruthy();
    const qr = container.querySelector('svg title');
    expect(qr?.textContent).toBe('PM-000042');
  });

  it('marca visualmente a ficha parcial como SOBRA com a quantidade exata', () => {
    const { getByText, queryByText } = render(
      <CartaoMontador {...base} fichaIndex={11} totalFichas={11} pares={5} isSobra />,
    );
    expect(getByText('11/11')).toBeTruthy();
    expect(getByText('Sobra · 5 pares')).toBeTruthy();
    expect(queryByText('Sobra · 12 pares')).toBeNull();
  });

  it('usa envelope de 96 mm com linha tracejada de recorte', () => {
    const { container } = render(<CartaoMontador {...base} />);
    const root = container.querySelector('.cartao-montador') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.width).toBe('96mm');
    expect(root.style.border).toContain('dashed');
  });
});
