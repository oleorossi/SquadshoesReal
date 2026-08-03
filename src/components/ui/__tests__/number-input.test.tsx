import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { NumberInput } from '../number-input';

/**
 * Regressão do NumberInput (2026-06-30). Bugs reportados na OS de terceirização:
 *   - não dava pra digitar número DEPOIS da vírgula (decimal travava);
 *   - o valor inicial não sumia ao começar a digitar (concatenava);
 *   - como o valor não entrava, o save travava (canSubmit exigia valor > 0) e o
 *     qty_good do recebimento entrava errado → pagar saía com valor unitário.
 * Causa: lógica frágil de `justFocused`/`diff`. Reescrito p/ aceitar vírgula,
 * estados intermediários ("12.", "0.0") e select-all no foco.
 */
function Controlled({ onVal, initial = 0 }: { onVal: (n: number) => void; initial?: number }) {
  const [v, setV] = useState(initial);
  return <NumberInput value={v} onChange={(n) => { setV(n); onVal(n); }} />;
}

function ControlledInt({ onVal, initial = 0 }: { onVal?: (n: number) => void; initial?: number }) {
  const [v, setV] = useState(initial);
  return <NumberInput value={v} decimals={0} onChange={(n) => { setV(n); onVal?.(n); }} />;
}

const inputOf = (c: HTMLElement) => c.querySelector('input') as HTMLInputElement;

describe('NumberInput', () => {
  it('aceita vírgula como separador decimal (locale BR)', () => {
    const onVal = vi.fn();
    const { container } = render(<Controlled onVal={onVal} />);
    fireEvent.change(inputOf(container), { target: { value: '0,05' } });
    expect(onVal).toHaveBeenLastCalledWith(0.05);
    expect(inputOf(container).value).toBe('0.05');
  });

  it('permite digitar o decimal DEPOIS do ponto (estado intermediário "12.")', () => {
    const onVal = vi.fn();
    const { container } = render(<Controlled onVal={onVal} />);
    const input = inputOf(container);
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.change(input, { target: { value: '12.' } });
    expect(input.value).toBe('12.'); // NÃO bloqueia o ponto
    fireEvent.change(input, { target: { value: '12.5' } });
    expect(onVal).toHaveBeenLastCalledWith(12.5);
    expect(input.value).toBe('12.5');
  });

  it('tira zeros à esquerda mas mantém "0.x"', () => {
    const onVal = vi.fn();
    const { container } = render(<Controlled onVal={onVal} />);
    const input = inputOf(container);
    fireEvent.change(input, { target: { value: '007' } });
    expect(input.value).toBe('7');
    fireEvent.change(input, { target: { value: '0.5' } });
    expect(input.value).toBe('0.5');
    expect(onVal).toHaveBeenLastCalledWith(0.5);
  });

  it('rejeita caractere não-numérico sem travar nem apagar o que já tinha', () => {
    const onVal = vi.fn();
    const { container } = render(<Controlled onVal={onVal} />);
    const input = inputOf(container);
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.change(input, { target: { value: '12a' } });
    expect(input.value).toBe('12'); // 'a' ignorado, valor preservado
  });

  it('campo vazio vira 0', () => {
    const onVal = vi.fn();
    const { container } = render(<Controlled onVal={onVal} initial={5} />);
    const input = inputOf(container);
    fireEvent.change(input, { target: { value: '' } });
    expect(onVal).toHaveBeenLastCalledWith(0);
  });

  /**
   * Regressão 2026-08-03 — a tela "Tempos-Padrão por Setor" mostrava "6 pares/dia"
   * onde o banco tinha 600, "35" onde tinha 350 e "5" onde tinha 500. Causa: o
   * formatValue usava /\.?0+$/ com o ponto OPCIONAL, então em decimals={0} (sem
   * ponto no toFixed) ele comia os zeros do próprio inteiro. Atingia os 29
   * call-sites com decimals={0} — capacidade por setor, matriz do PV, grade de
   * solado, apontamento do Kanban, reservas de estoque.
   */
  describe('inteiros terminados em zero (decimals={0})', () => {
    it.each([
      [600, '600'],
      [350, '350'],
      [500, '500'],
      [10, '10'],
      [1000, '1000'],
      [120, '120'],
      [7, '7'],
    ])('valor %i renderiza "%s"', (initial, esperado) => {
      const { container } = render(<ControlledInt initial={initial} />);
      expect(inputOf(container).value).toBe(esperado);
    });

    it('mantém o inteiro intacto depois do blur (era aí que truncava)', () => {
      const { container } = render(<ControlledInt initial={0} />);
      const input = inputOf(container);
      fireEvent.change(input, { target: { value: '600' } });
      fireEvent.blur(input);
      expect(input.value).toBe('600');
    });
  });

  it('ainda tira zero à direita de DECIMAL (não regride o caso que o regex resolvia)', () => {
    const cases: [number, number, string][] = [
      [1.5, 6, '1.5'],    // 1.500000 → 1.5
      [1.0, 6, '1'],      // 1.000000 → 1  (sem ponto órfão)
      [0.05, 6, '0.05'],
      [2.25, 2, '2.25'],
      [600.5, 2, '600.5'], // inteiro grande COM decimal: nem trunca nem sobra zero
    ];
    for (const [value, decimals, esperado] of cases) {
      const { container } = render(<NumberInput value={value} decimals={decimals} onChange={() => {}} />);
      expect(inputOf(container).value).toBe(esperado);
    }
  });
});
