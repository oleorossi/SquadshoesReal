import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { QuickSheetSelector, type QuickSheetOption } from '../QuickSheetSelector';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});

const sheets: QuickSheetOption[] = [
  { id: 'z', name: 'Zaira', code: 'Z-02', sale_price: 79.9 },
  { id: 'a', name: 'Amanda', code: 'A-01', sale_price: 89.9 },
];

describe('QuickSheetSelector', () => {
  it('lista todas as referências em ordem alfabética e abre a selecionada', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<QuickSheetSelector sheets={sheets} onSelect={onSelect} />);

    const openButton = screen.getByRole('button', { name: 'Abrir ficha' });
    expect(openButton).toBeDisabled();
    expect(screen.getByText('2 referências')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Selecionar referência para abrir' }));
    const options = screen.getAllByRole('option');
    expect(options.map(option => option.textContent?.trim())).toEqual(['Amanda (A-01)', 'Zaira (Z-02)']);

    await user.click(options[0]);
    expect(openButton).toBeEnabled();
    await user.click(openButton);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('limpa uma seleção que deixou de existir após atualização dos dados', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<QuickSheetSelector sheets={sheets} onSelect={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: 'Selecionar referência para abrir' }));
    await user.click(screen.getByRole('option', { name: 'Amanda (A-01)' }));
    expect(screen.getByRole('button', { name: 'Abrir ficha' })).toBeEnabled();

    rerender(<QuickSheetSelector sheets={[sheets[0]]} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir ficha' })).toBeDisabled());
  });
});
