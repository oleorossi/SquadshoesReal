import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { calculateGrade } from '@/lib/gradeCalculator';
import { GradeFormationMatrix } from '../GradeFormationMatrix';

const calculation = calculateGrade(
  [34, 35, 36],
  10,
  { '34': 1, '35': 2, '36': 1 },
  { '35': 5 },
);

function horizontalTable() {
  return screen.getByRole('table', { name: /formação da grade na horizontal/i });
}

function verticalTable() {
  return screen.getByRole('table', { name: /formação da grade na vertical/i });
}

describe('GradeFormationMatrix', () => {
  it('mostra as numerações nas colunas e destaca a linha A produzir no desktop e na impressão', () => {
    render(<GradeFormationMatrix calculation={calculation} onUpdateQuantity={vi.fn()} />);

    const table = horizontalTable();
    expect(table.closest('[data-grade-layout="horizontal"]')).toHaveClass('hidden', 'md:block', 'print:block');

    for (const size of ['34', '35', '36']) {
      expect(within(table).getByRole('columnheader', { name: size })).toBeInTheDocument();
    }
    expect(within(table).getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Por ficha' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Necessidade' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Já pronta' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'A produzir' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Sobra' })).toBeInTheDocument();

    const produceRow = within(table).getByRole('rowheader', { name: 'A produzir' }).closest('tr');
    expect(produceRow).toHaveClass('bg-muted');
    expect(produceRow).toHaveTextContent('10');
    expect(produceRow).toHaveTextContent('15');
    expect(produceRow).toHaveTextContent('10');
    expect(produceRow).toHaveTextContent('35');

    expect(within(table).getByLabelText('Quantidade por ficha da numeração 35')).toHaveValue(2);
    expect(within(table).getByLabelText('Palmilhas já prontas da numeração 35')).toHaveValue(5);
  });

  it('mostra a grade na vertical no celular, com os mesmos cálculos e sem pedir para deslizar', () => {
    render(<GradeFormationMatrix calculation={calculation} onUpdateQuantity={vi.fn()} />);

    const table = verticalTable();
    expect(table.closest('[data-grade-layout="vertical"]')).toHaveClass('md:hidden', 'print:hidden');

    expect(within(table).getByRole('columnheader', { name: 'Tamanho' })).toHaveTextContent('Tam.');
    expect(within(table).getByRole('columnheader', { name: 'Por ficha' })).toHaveTextContent('Ficha');
    expect(within(table).getByRole('columnheader', { name: 'Necessidade' })).toHaveTextContent('Nec.');
    expect(within(table).getByRole('columnheader', { name: 'Já pronta' })).toHaveTextContent('Pronta');
    expect(within(table).getByRole('columnheader', { name: 'A produzir' })).toHaveTextContent('Prod.');
    expect(within(table).getByRole('columnheader', { name: 'Sobra' })).toHaveTextContent('Sobra');

    for (const size of ['34', '35', '36']) {
      expect(within(table).getByRole('rowheader', { name: size })).toBeInTheDocument();
    }
    expect(within(table).getByRole('rowheader', { name: 'Total' })).toBeInTheDocument();

    const row35 = within(table).getByRole('rowheader', { name: '35' }).closest('tr');
    expect(row35).toHaveTextContent('20');
    expect(row35).toHaveTextContent('15');
    const produceCell = within(table).getByRole('rowheader', { name: '35' }).closest('tr')?.querySelector('td:nth-of-type(4)');
    expect(produceCell).toHaveClass('bg-muted');
    expect(produceCell).toHaveTextContent('15');

    const totalRow = within(table).getByRole('rowheader', { name: 'Total' }).closest('tr');
    expect(totalRow).toHaveTextContent('40');
    expect(totalRow).toHaveTextContent('35');

    expect(within(table).getByLabelText('Quantidade por ficha da numeração 35')).toHaveValue(2);
    expect(within(table).getByLabelText('Palmilhas já prontas da numeração 35')).toHaveValue(5);

    expect(screen.getByText(/coluna Prod\. \(A produzir\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/deslize a grade para o lado/i)).not.toBeInTheDocument();
  });

  it('sincroniza os inputs da visão vertical e da horizontal com o mesmo cálculo', () => {
    const onUpdateQuantity = vi.fn();
    render(<GradeFormationMatrix calculation={calculation} onUpdateQuantity={onUpdateQuantity} />);

    fireEvent.change(within(horizontalTable()).getByLabelText('Quantidade por ficha da numeração 34'), {
      target: { value: '3' },
    });
    expect(onUpdateQuantity).toHaveBeenCalledWith('needBySize', 34, '3');

    fireEvent.change(within(verticalTable()).getByLabelText('Palmilhas já prontas da numeração 36'), {
      target: { value: '4' },
    });
    expect(onUpdateQuantity).toHaveBeenCalledWith('readyBySize', 36, '4');
  });
});
