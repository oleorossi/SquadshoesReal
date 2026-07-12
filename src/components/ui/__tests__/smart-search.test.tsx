import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { useState } from 'react';
import { SmartSearch, type SmartSearchSuggestion } from '../smart-search';

/**
 * Regressão do SmartSearch (spec smart-search-fechar-ao-selecionar.md):
 * ao selecionar uma sugestão, o popover fechava mas reabria sozinho porque o
 * re-foco programático disparava onFocus→setOpen(true). Agora fica FECHADO e só
 * reabre quando o usuário altera o texto.
 */
const SUGGESTIONS: SmartSearchSuggestion[] = [
  { field: 'name', value: 'LNG 10 CONFECCOES LTDA', meta: 'Cliente' },
];

function Harness({ onSelect }: { onSelect?: (s: SmartSearchSuggestion) => void }) {
  const [v, setV] = useState('');
  return (
    <SmartSearch
      value={v}
      onChange={setV}
      onSelect={onSelect}
      // onSelect fornecido e SEM alterar `value`: isola o comportamento do
      // popover (o texto continua casando a sugestão, então só a lógica de
      // open/suppress mantém a caixinha fechada).
      getSuggestions={(term) => SUGGESTIONS.filter(s => s.value.toLowerCase().includes(term.toLowerCase()))}
      debounceMs={0}
    />
  );
}

const inputOf = (c: HTMLElement) => c.querySelector('input') as HTMLInputElement;
const suggestionShown = () => screen.queryByText('LNG 10 CONFECCOES LTDA');

describe('SmartSearch — fechar popover ao selecionar', () => {
  it('clicar numa sugestão fecha o popover e ele NÃO reabre no re-foco', async () => {
    const onSelect = vi.fn();
    const { container } = render(<Harness onSelect={onSelect} />);
    const input = inputOf(container);

    // digita → popover abre com a sugestão
    fireEvent.change(input, { target: { value: 'LNG' } });
    await waitFor(() => expect(suggestionShown()).toBeTruthy());

    // clica na sugestão → aplica e fecha
    fireEvent.click(suggestionShown()!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(suggestionShown()).toBeNull());

    // re-foco (o handleSelect re-foca o input) NÃO reabre
    fireEvent.focus(input);
    await new Promise((r) => setTimeout(r, 20));
    expect(suggestionShown()).toBeNull();
  });

  it('reabre somente quando o texto muda de novo', async () => {
    const { container } = render(<Harness onSelect={vi.fn()} />);
    const input = inputOf(container);

    fireEvent.change(input, { target: { value: 'LNG' } });
    await waitFor(() => expect(suggestionShown()).toBeTruthy());
    fireEvent.click(suggestionShown()!);
    await waitFor(() => expect(suggestionShown()).toBeNull());

    // alterar o texto reabre o popover
    fireEvent.change(input, { target: { value: 'LNG 1' } });
    await waitFor(() => expect(suggestionShown()).toBeTruthy());
  });

  it('seleção por teclado (↓ + Enter) também fecha e mantém fechado', async () => {
    const onSelect = vi.fn();
    const { container } = render(<Harness onSelect={onSelect} />);
    const input = inputOf(container);

    fireEvent.change(input, { target: { value: 'LNG' } });
    await waitFor(() => expect(suggestionShown()).toBeTruthy());

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(suggestionShown()).toBeNull());

    fireEvent.focus(input);
    await new Promise((r) => setTimeout(r, 20));
    expect(suggestionShown()).toBeNull();
  });
});
