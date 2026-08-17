import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});

const OPTIONS: SearchableOption[] = [
  { value: '1', label: 'NAPA SOFT', description: 'Preto', keywords: 'cabedal couro' },
  { value: '2', label: 'NAPA SANTORINE', description: 'Caramelo', keywords: 'cabedal' },
  { value: '3', label: 'Meia Cana 10mm', description: 'Dourado', keywords: 'aviamento tira' },
];

function Harness() {
  const [value, setValue] = useState('');
  return (
    <SearchableSelect
      value={value}
      onChange={setValue}
      options={OPTIONS}
      placeholder="Selecionar material…"
      searchPlaceholder="Buscar material…"
      searchLabel="Localizar material"
    />
  );
}

describe('SearchableSelect — localizador de catálogo', () => {
  it('mostra contagem, refina por termos em campos diferentes e seleciona', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('combobox', { name: 'Selecionar material…' });
    await user.click(trigger);
    expect(screen.getByText('Localizar material')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    await user.type(screen.getByRole('combobox', { name: 'Buscar material…' }), 'napa preto');
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(screen.getByText('NAPA SOFT')).toBeInTheDocument();
    expect(screen.queryByText('NAPA SANTORINE')).not.toBeInTheDocument();

    await user.click(screen.getByText('NAPA SOFT'));
    expect(trigger).toHaveTextContent('NAPA SOFT');
    expect(trigger).toHaveTextContent('Preto');
  });
});
