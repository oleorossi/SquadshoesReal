import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import TechnicalStrapSourceEditor from '../TechnicalStrapSourceEditor';
import type { TechnicalStrapLineLike } from '@/lib/technicalStrapLines';
import type { TechnicalStrapSourceCatalog } from '@/lib/technicalStrapSourcePolicy';

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

type Line = TechnicalStrapLineLike & { consumption: number; consumption_per_size: Record<string, number> };
const catalog: TechnicalStrapSourceCatalog = {
  types: [{ id: 'strass', active: true }, { id: 'overlock', active: true }],
  measures: [{ id: '6mm', strap_type_id: 'strass', active: true }, { id: '5mm', strap_type_id: 'overlock', active: true }],
  variants: [
    { measure_id: '6mm', base_group_id: 'strass6', identity_basis: 'finished_product_group', internal_production_enabled: false, status: 'active', finished_product_id: 'cristal' },
    { measure_id: '5mm', base_group_id: 'glow', identity_basis: 'reference_base', internal_production_enabled: true, status: 'active' },
  ],
  recipes: [],
  products: [{ id: 'cristal', group_id: 'strass6', unit: 'm', active: true }, { id: 'glow-cobre', group_id: 'glow', unit: 'm', active: true }],
  groups: [{ id: 'strass6', name: 'TIRA STRASS 6MM' }, { id: 'glow', name: 'GLOW METALIC + MASSABOX' }],
};
const initial: Line = {
  id: 'posicao2', technical_strap_line_id: 'posicao2', label: 'TIRA 2',
  measure_id: '6mm', strap_type_id: 'strass', identity_basis: 'reference_base',
  color_mode: 'follow_main', material_mode: 'follow_reference',
  consumption: 61, consumption_per_size: { '34': 61 },
};

function mount(line = initial, sourceCatalog: TechnicalStrapSourceCatalog | undefined = catalog, loading = false) {
  let current = line;
  function Harness() {
    const [value, setValue] = useState(line);
    current = value;
    return <TechnicalStrapSourceEditor<Line> line={value} label="TIRA 2" catalog={sourceCatalog} loading={loading} onChange={setValue} />;
  }
  render(<Harness />);
  return { current: () => current };
}

describe('TechnicalStrapSourceEditor', () => {
  it('Strass 6 mm informa SKU acabado e exige grupo do produto', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByText(/SKU acabado \(Hub\)/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Base da identidade de TIRA 2' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Grupo acabado de TIRA 2' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['TIRA STRASS 6MM']);
  });

  it('Overlock 5 mm informa fábrica sem seletor de identidade na ficha', () => {
    mount({ ...initial, measure_id: '5mm', strap_type_id: 'overlock' });
    expect(screen.getByText(/Produção na fábrica \(Hub\)/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Grupo acabado/i })).not.toBeInTheDocument();
  });

  it('híbrido aponta a escolha para o Pedido de Venda', () => {
    const hybrid: TechnicalStrapSourceCatalog = {
      ...catalog,
      variants: [
        ...catalog.variants,
        { measure_id: '5mm', base_group_id: 'glow', identity_basis: 'finished_product_group', internal_production_enabled: false, status: 'active', finished_product_id: 'glow-cobre' },
      ],
    };
    mount({ ...initial, measure_id: '5mm', strap_type_id: 'overlock' }, hybrid);
    expect(screen.getByText(/escolha fábrica vs prestador fica no Pedido de Venda/i)).toBeInTheDocument();
  });

  it('fica desabilitado enquanto o catálogo carrega', () => {
    mount(initial, undefined, true);
    expect(screen.getByText(/Carregando catálogo do Hub/i)).toBeInTheDocument();
  });
});
