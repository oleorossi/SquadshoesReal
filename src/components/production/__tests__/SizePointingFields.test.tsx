import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SizePointingFields } from '../SizePointingFields';
import { clampSizeQuantity, type SizeMap } from '@/lib/production/sizePointing';

const balance = {
  sizes: ['34', '35'],
  target: { '34': 75, '35': 12 },
  known: {},
  pending: { '34': 75, '35': 12 },
  legacyUnallocated: 0,
  pairRemaining: 87,
  launchable: 87,
};

function Harness() {
  const [value, setValue] = useState<SizeMap>({ '34': 75, '35': 12 });
  return (
    <SizePointingFields
      balance={balance}
      backward={false}
      value={value}
      onChange={(size, next, blocked) => {
        const cap = balance.pending[size] || 0;
        setValue(prev => ({ ...prev, [size]: blocked ? cap : clampSizeQuantity(next, cap) }));
      }}
    />
  );
}

describe('contador ao vivo da numeração', () => {
  it('abre preenchido com o saldo e mostra concluído', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Numeração 34')).toHaveValue('75');
    expect(screen.getAllByText('concluído').length).toBeGreaterThan(0);
  });

  it('ao digitar 60 no 34 mostra 60/15 com a falta em destaque', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Numeração 34'), { target: { value: '60' } });
    expect(screen.getByLabelText('Numeração 34')).toHaveValue('60');
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('15').className).toMatch(/amber/);
  });

  it('na faixa P mostra 40/12 e bloqueia com a mensagem da faixa', () => {
    function KnifeHarness() {
      const [value, setValue] = useState<SizeMap>({ P: 0 });
      return (
        <SizePointingFields
          kind="knife"
          hints={{ P: '34·35' }}
          balance={{
            sizes: ['P'],
            target: { P: 52 },
            known: {},
            pending: { P: 52 },
            legacyUnallocated: 0,
            pairRemaining: 52,
            launchable: 52,
          }}
          backward={false}
          value={value}
          onChange={(size, next) => {
            setValue(prev => ({ ...prev, [size]: clampSizeQuantity(next, 52) }));
          }}
        />
      );
    }
    render(<KnifeHarness />);
    expect(screen.getByText('34·35')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Faixa P'), { target: { value: '40' } });
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('12').className).toMatch(/amber/);
    fireEvent.change(screen.getByLabelText('Faixa P'), { target: { value: '60' } });
    expect(screen.getByLabelText('Faixa P')).toHaveValue('52');
    expect(screen.getByRole('alert')).toHaveTextContent('Faixa P: 60 passa o saldo de 52 pares.');
  });

  it('não deixa passar do saldo', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Numeração 34'), { target: { value: '80' } });
    expect(screen.getByLabelText('Numeração 34')).toHaveValue('75');
    expect(screen.getByRole('alert')).toHaveTextContent('O 34 só tem 75 pares');
  });

  it('a grade usa colunas responsivas, sem rolagem horizontal', () => {
    render(<Harness />);
    const grid = screen.getByTestId('size-pointing-grid');
    expect(grid.className).toMatch(/grid/);
    expect(grid.className).toMatch(/grid-cols-4/);
    expect(grid.className).toMatch(/xl:grid-cols-12/);
    expect(grid.className).not.toMatch(/overflow-x-auto/);
  });
});
