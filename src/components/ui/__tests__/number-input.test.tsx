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
});
