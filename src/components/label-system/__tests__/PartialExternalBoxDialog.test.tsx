import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PartialExternalBoxDialog } from '@/components/label-system/PartialExternalBoxDialog';

describe('PartialExternalBoxDialog', () => {
  it('mostra ajuda 1–N e só gera com volumes válidos', () => {
    const onGenerate = vi.fn();
    render(
      <PartialExternalBoxDialog
        rows={[
          {
            volumeSetKey: 'PV|ref|TAN|',
            saleOrderNumber: 'PV-00194',
            refCode: 'I90',
            refName: 'I90',
            color: 'TAN',
            orderNumbers: ['OP-1'],
            maxVolume: 62,
            groupKeys: ['g1'],
          },
        ]}
        onGenerate={onGenerate}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText(/Volumes disponíveis: 1–62/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerar PDF parcial' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Volumes a reimprimir'), {
      target: { value: '20, 27, 99' },
    });
    expect(screen.getByText(/2 volumes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Gerar PDF parcial' }));
    expect(onGenerate).toHaveBeenCalledWith({ 'PV|ref|TAN|': '20, 27, 99' });
  });
});
