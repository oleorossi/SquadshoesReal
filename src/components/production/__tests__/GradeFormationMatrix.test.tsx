import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { calculateGrade } from '@/lib/gradeCalculator';
import { GradeFormationMatrix } from '../GradeFormationMatrix';

const calculation = calculateGrade(
  [34, 35, 36],
  10,
  { '34': 1, '35': 2, '36': 1 },
  { '35': 5 },
);

describe('GradeFormationMatrix', () => {
  it('mostra as numerações nas colunas e destaca a linha A produzir', () => {
    render(<GradeFormationMatrix calculation={calculation} onUpdateQuantity={vi.fn()} />);

    const table = screen.getByRole('table', { name: /formação da grade na horizontal/i });
    expect(table).toBeInTheDocument();

    for (const size of ['34', '35', '36']) {
      expect(screen.getByRole('columnheader', { name: size })).toBeInTheDocument();
    }
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Por ficha' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Necessidade' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Já pronta' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'A produzir' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Sobra' })).toBeInTheDocument();

    const produceRow = screen.getByRole('rowheader', { name: 'A produzir' }).closest('tr');
    expect(produceRow).toHaveClass('bg-muted');
    expect(produceRow).toHaveTextContent('10');
    expect(produceRow).toHaveTextContent('15');
    expect(produceRow).toHaveTextContent('10');
    expect(produceRow).toHaveTextContent('35');

    expect(screen.getByLabelText('Quantidade por ficha da numeração 35')).toHaveValue(2);
    expect(screen.getByLabelText('Palmilhas já prontas da numeração 35')).toHaveValue(5);
  });

  it('permite editar por ficha e já pronta direto na matriz', () => {
    const onUpdateQuantity = vi.fn();
    render(<GradeFormationMatrix calculation={calculation} onUpdateQuantity={onUpdateQuantity} />);

    fireEvent.change(screen.getByLabelText('Quantidade por ficha da numeração 34'), { target: { value: '3' } });
    expect(onUpdateQuantity).toHaveBeenCalledWith('needBySize', 34, '3');

    fireEvent.change(screen.getByLabelText('Palmilhas já prontas da numeração 36'), { target: { value: '4' } });
    expect(onUpdateQuantity).toHaveBeenCalledWith('readyBySize', 36, '4');
  });
});
