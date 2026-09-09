import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PartialPrintSelectionDialog } from '../PartialPrintSelectionDialog';
import type { PartialLabelPrintGroup } from '@/lib/labelPartialPrint';

const GROUPS: PartialLabelPrintGroup[] = [{
  groupKey: 'pv|nl01|capuccino',
  refCode: 'NL01',
  refName: 'NL01',
  colors: ['CAPUCCINO'],
  orderNumbers: ['OP-2026-03830'],
  aggregatedGrade: { '34': 3, '35': 6, '36': 9 },
}];

describe('PartialPrintSelectionDialog', () => {
  it('começa vazio e aplica somente a numeração e quantidade escolhidas', () => {
    const onApply = vi.fn();
    render(
      <PartialPrintSelectionDialog
        groups={GROUPS}
        initialSelection={{}}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );

    const applyButton = screen.getByRole('button', { name: 'Usar reimpressão parcial' });
    expect(applyButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Selecionar NL01, tamanho 34, até 3 etiquetas',
    }));
    const quantity = screen.getByRole('spinbutton', {
      name: 'Quantidade a reimprimir de NL01, tamanho 34',
    });
    expect(quantity).toHaveValue(3);
    fireEvent.change(quantity, { target: { value: '2' } });

    expect(screen.getByText('2 etiquetas')).toBeInTheDocument();
    fireEvent.click(applyButton);

    expect(onApply).toHaveBeenCalledWith({
      'pv|nl01|capuccino': { '34': 2 },
    });
  });

  it('limita a quantidade ao pedido e preserva seleção fora da busca', () => {
    const onApply = vi.fn();
    render(
      <PartialPrintSelectionDialog
        groups={GROUPS}
        initialSelection={{}}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Selecionar NL01, tamanho 34, até 3 etiquetas',
    }));
    const quantity = screen.getByRole('spinbutton', {
      name: 'Quantidade a reimprimir de NL01, tamanho 34',
    });
    fireEvent.change(quantity, { target: { value: '99' } });
    expect(quantity).toHaveValue(3);

    fireEvent.change(screen.getByPlaceholderText('Buscar referência, cor, numeração ou OP…'), {
      target: { value: '35' },
    });
    expect(screen.queryByRole('checkbox', {
      name: 'Selecionar NL01, tamanho 34, até 3 etiquetas',
    })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Usar reimpressão parcial' }));
    expect(onApply).toHaveBeenCalledWith({
      'pv|nl01|capuccino': { '34': 3 },
    });
  });

  it('selecionar exibidos preserva uma quantidade manual já informada', () => {
    const onApply = vi.fn();
    render(
      <PartialPrintSelectionDialog
        groups={GROUPS}
        initialSelection={{}}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Selecionar NL01, tamanho 34, até 3 etiquetas',
    }));
    fireEvent.change(screen.getByRole('spinbutton', {
      name: 'Quantidade a reimprimir de NL01, tamanho 34',
    }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar exibidos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Usar reimpressão parcial' }));

    expect(onApply).toHaveBeenCalledWith({
      'pv|nl01|capuccino': { '34': 1, '35': 6, '36': 9 },
    });
  });

  it('Enter na busca não aplica nem fecha a seleção', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <PartialPrintSelectionDialog
        groups={GROUPS}
        initialSelection={{ 'pv|nl01|capuccino': { '34': 1 } }}
        onApply={onApply}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(screen.getByPlaceholderText('Buscar referência, cor, numeração ou OP…'), {
      key: 'Enter',
      code: 'Enter',
    });

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
