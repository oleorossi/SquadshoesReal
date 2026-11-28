import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PacoteOpPrintPanel } from '../PacoteOpPrintPanel';
import {
  buildPacotePlano,
  normalizarSelecao,
  selecaoCompleta,
  type PacoteInventario,
  type PacoteSelecao,
} from '@/lib/pacoteOp';

const INV: PacoteInventario = { palmilhaFolhas: 2, fardoCartoes: 100, caixaFichas: [15, 15, 15, 15, 15, 15, 10] };
const QUANDO = new Date('2026-11-28T12:00:00-03:00');

function Harness({ onImprimir = () => {} }: { onImprimir?: () => void }) {
  const [sel, setSel] = useState<PacoteSelecao>(selecaoCompleta(INV));
  const plano = buildPacotePlano(INV, normalizarSelecao(INV, sel), QUANDO);
  return (
    <PacoteOpPrintPanel
      inventario={INV}
      selecao={sel}
      onSelecaoChange={setSel}
      plano={plano}
      gerando={false}
      onImprimir={onImprimir}
    />
  );
}

describe('PacoteOpPrintPanel', () => {
  it('abre com tudo marcado: botão de pacote completo, sem selo, 10 folhas', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /Imprimir pacote \(PDF\)/ })).toBeTruthy();
    expect(screen.getByText(/Total: 10 folhas no PDF/)).toBeTruthy();
    expect(screen.queryByText('2ª VIA · 28/11/2026')).toBeNull();
  });

  it('texto 1,5,10:15 em Fichas → prévia ao vivo e, ao aplicar, 2ª via com 4 folhas', () => {
    render(<Harness />);
    const campo = screen.getByPlaceholderText('1,5,10:15') as HTMLInputElement;
    fireEvent.change(campo, { target: { value: '1,5,10:15' } });
    expect(screen.getByText('Será impresso: fichas 1, 5 e 10 a 15 (8 de 100).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByText('2ª VIA · 28/11/2026')).toBeTruthy();
    expect(screen.getByText(/Total: 4 folhas no PDF/)).toBeTruthy();
    expect(screen.getByText('Fardo · cartões 1, 5 e 10 a 15 (8 de 100) em 1 folha (reempacotadas).')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reimprimir PDF/ })).toBeTruthy();
  });

  it('entrada inválida mostra o erro e bloqueia o Aplicar', () => {
    render(<Harness />);
    const campo = screen.getByPlaceholderText('1,5,10:15') as HTMLInputElement;
    fireEvent.change(campo, { target: { value: '15:10' } });
    expect(screen.getByRole('alert').textContent).toMatch(/invertido/);
    expect((screen.getByRole('button', { name: 'Aplicar' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(campo, { target: { value: '1,200' } });
    expect(screen.getByRole('alert').textContent).toMatch(/máximo é 100/);
  });

  it('desmarcar o tipo Fardo reduz o PDF; Marcar tudo restaura', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cartões do fardo' }));
    expect(screen.getByText('Fardo · fora do PDF.')).toBeTruthy();
    expect(screen.getByText(/Total: 4 folhas no PDF/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar tudo' }));
    expect(screen.getByText(/Total: 10 folhas no PDF/)).toBeTruthy();
  });

  it('clicar numa folha do fardo alterna os 18 cartões dela', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /FARDO\s*folha 2 de 6/i }));
    expect(screen.getByText(/82 de 100/)).toBeTruthy();
  });

  it('o botão chama onImprimir', () => {
    const onImprimir = vi.fn();
    render(<Harness onImprimir={onImprimir} />);
    fireEvent.click(screen.getByRole('button', { name: /Imprimir pacote \(PDF\)/ }));
    expect(onImprimir).toHaveBeenCalledTimes(1);
  });
});
