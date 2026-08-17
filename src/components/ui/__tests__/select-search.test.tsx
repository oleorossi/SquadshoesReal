import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});

const OPTIONS = [
  'Fivelas',
  'GLOW METÁLIC',
  'LINHANYL',
  'Meia Cana 10mm',
  'NAPA MADRID',
  'NAPA PALHA',
  'NAPA SANTORINE',
  'NAPA SOFT',
];

function SelectHarness({
  options = OPTIONS,
  searchable,
}: {
  options?: string[];
  searchable?: boolean | 'auto';
}) {
  const [value, setValue] = useState('');
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Selecionar material">
        <SelectValue placeholder="Selecione o material" />
      </SelectTrigger>
      <SelectContent searchable={searchable} searchPlaceholder="Buscar material…">
        {options.map((option) => (
          <SelectItem key={option} value={option.toLowerCase()}>{option}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

describe('SelectContent — busca automática de catálogos', () => {
  it('adiciona busca em listas longas e filtra com acento, espaço e caixa ignorados', async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);

    await user.click(screen.getByRole('combobox', { name: 'Selecionar material' }));
    const input = screen.getByRole('textbox', { name: 'Buscar material…' });
    expect(input).toBeInTheDocument();

    await user.type(input, 'napa soft');

    expect(screen.getByText('1 de 8')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'NAPA SOFT' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'NAPA SANTORINE' })).not.toBeInTheDocument();
  });

  it('permite selecionar o resultado filtrado sem alterar o contrato do Select', async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);

    const trigger = screen.getByRole('combobox', { name: 'Selecionar material' });
    await user.click(trigger);
    await user.type(screen.getByRole('textbox', { name: 'Buscar material…' }), 'meiacana10');
    await user.click(screen.getByRole('option', { name: 'Meia Cana 10mm' }));

    expect(trigger).toHaveTextContent('Meia Cana 10mm');
    expect(screen.queryByRole('textbox', { name: 'Buscar material…' })).not.toBeInTheDocument();
  });

  it('transforma a digitação sobre a lista em busca e preserva a navegação por teclado', async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);

    await user.click(screen.getByRole('combobox', { name: 'Selecionar material' }));
    await user.keyboard('soft');

    const input = screen.getByRole('textbox', { name: 'Buscar material…' });
    expect(input).toHaveValue('soft');
    expect(input).toHaveFocus();
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length);

    await user.type(input, 'napa');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'NAPA MADRID' })).toHaveFocus();
  });

  it('mantém listas curtas compactas e permite forçar a busca quando necessário', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SelectHarness options={OPTIONS.slice(0, 7)} />);

    await user.click(screen.getByRole('combobox', { name: 'Selecionar material' }));
    expect(screen.queryByRole('textbox', { name: 'Buscar material…' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    rerender(<SelectHarness options={OPTIONS.slice(0, 7)} searchable />);
    await user.click(screen.getByRole('combobox', { name: 'Selecionar material' }));
    expect(screen.getByRole('textbox', { name: 'Buscar material…' })).toBeInTheDocument();
  });

  it('remove cabeçalhos de grupos sem resultados e comunica o estado vazio', async () => {
    const user = userEvent.setup();
    render(
      <Select defaultValue="">
        <SelectTrigger aria-label="Selecionar insumo">
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent searchable searchPlaceholder="Buscar insumo…">
          <SelectGroup>
            <SelectLabel>Couros</SelectLabel>
            <SelectItem value="napa-soft">NAPA SOFT</SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Aviamentos</SelectLabel>
            <SelectItem value="fivela">Fivela ouro</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Selecionar insumo' }));
    const searchRail = document.querySelector<HTMLElement>('[data-select-search]');
    expect(searchRail).not.toBeNull();
    expect(within(searchRail!).getByText('2')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Buscar insumo…' }), 'fivela');
    expect(screen.queryByText('Couros')).not.toBeInTheDocument();
    expect(screen.getByText('Aviamentos')).toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: 'Buscar insumo…' }));
    await user.type(screen.getByRole('textbox', { name: 'Buscar insumo…' }), 'inexistente');
    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma opção encontrada.');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
