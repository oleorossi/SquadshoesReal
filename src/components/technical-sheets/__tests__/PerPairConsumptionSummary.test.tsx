import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PerPairConsumptionSummary from '../PerPairConsumptionSummary';

/**
 * Card "Consumo e custo por par" (spec `consumo-por-par-na-ficha`, revisão 2).
 * Dados espelham a ficha I703 e a SP301 medidas no banco em 11/10/2026.
 */
const G = {
  massabox: 'g-massabox',
  soft: 'g-soft',
  diversos: 'g-diversos',
  overlock: 'g-overlock',
  strass: 'g-strass',
  chata: 'g-chata',
  cola: 'g-cola',
};
const groups = [
  { id: G.massabox, name: 'NAPA SOFT + MASSABOX' },
  { id: G.soft, name: 'NAPA SOFT' },
  { id: G.diversos, name: 'COMPONENTES DIVERSOS' },
  { id: G.overlock, name: 'TIRA OVERLOCK 5MM' },
  { id: G.strass, name: 'TIRA STRASS 6MM' },
  { id: G.chata, name: 'Tira chata 8mm' },
  { id: G.cola, name: 'COLA FORTE' },
];

let seq = 0;
const sku = (group_id: string, name: string, unit: string, unit_price: number, extra: Record<string, unknown> = {}) => ({
  id: `p-${++seq}`, group_id, name, unit, unit_price, active: true, color: null, category: null, ...extra,
});

const fivela = sku(G.diversos, 'Fivela 12mm', 'un', 0.27, { category: 'Componente' });
const overlockNapaSoft = sku(G.overlock, 'TIRA OVERLOCK 5 MM · NAPA SOFT · PRETO', 'm', 0);
const overlockSudani = sku(G.overlock, 'TIRA OVERLOCK 5 MM · NAPA SUDANI · PRETO', 'm', 0.85);
const products = [
  sku(G.massabox, 'NAPA SOFT + MASSABOX PRETO', 'm', 43.54, { category: 'Cabedal' }),
  sku(G.massabox, 'NAPA SOFT + MASSABOX NUDE', 'm', 43.54, { category: 'Cabedal' }),
  sku(G.massabox, 'NAPA SOFT + MASSABOX', 'un', 43.34, { category: 'Cabedal' }),
  // NAPA SOFT é estocada como forro, mas é cabedal na SP301.
  sku(G.soft, 'NAPA SOFT PRETO', 'm', 17.34, { category: 'Forração da Palmilha' }),
  fivela,
  // Mesmo grupo, outras peças — nunca entram na mediana da fivela.
  sku(G.diversos, 'Ilhós 5mm', 'un', 5, { category: 'Componente' }),
  sku(G.diversos, 'Binóculo 6mm', 'un', 1, { category: 'Componente' }),
  overlockNapaSoft,
  overlockSudani,
  sku(G.overlock, 'TIRA OVERLOCK 5MM ROSE', 'm', 0.85),
  sku(G.overlock, 'TIRA OVERLOCK 5MM BEGE', 'm', 0.85),
  sku(G.overlock, 'TIRA OVERLOCK 5MM AMARELO', 'm', 1.05),
  sku(G.overlock, 'TIRA OVERLOCK 5MM COBRE', 'm', 20.495),
  // Comprada pronta: nomes são só a cor.
  sku(G.strass, 'Cristal com fundo branco', 'm', 2),
  sku(G.strass, 'Preto com fundo preto', 'm', 2),
  sku(G.strass, 'TIRA STRASS 6MM', 'm', 2.5),
  sku(G.strass, 'Rosado com fundo rosado', 'm', 2.5),
  sku(G.chata, 'TIRA CHATA 8MM PRETO', 'm', 0.6),
  sku(G.chata, 'ELÁSTICO FORRADO 7 MM · NAPA SOFT · PRETO', 'm', 9.99),
  sku(G.cola, 'COLA FORTE', 'kg', 30, { category: 'Componente' }),
];

const componentSheets = [
  { group_id: G.massabox, dimensions_width: 1370, dimensions_length: 1000, dimensions_unit: 'mm', products: { unit: 'm' } },
  { group_id: G.soft, dimensions_width: 1370, dimensions_length: 1000, dimensions_unit: 'mm', products: { unit: 'm' } },
];

const strapCatalog = {
  types: [
    { id: 't-over', name: 'TIRA OVERLOCK' },
    { id: 't-strass', name: 'TIRA STRASS' },
    { id: 't-chata', name: 'TIRA CHATA' },
  ],
  measures: [
    { id: 'm-over', strap_type_id: 't-over', display_name: '5 mm' },
    { id: 'm-strass', strap_type_id: 't-strass', display_name: '6 mm' },
    { id: 'm-chata', strap_type_id: 't-chata', display_name: '8 mm' },
  ],
  variants: [
    { measure_id: 'm-over', base_group_id: G.soft, finished_product_id: overlockNapaSoft.id },
    { measure_id: 'm-over', base_group_id: 'g-sudani', finished_product_id: overlockSudani.id },
  ],
};

const sizes = ['34', '35'];
const each = (value: number) => ({ '34': value, '35': value });

const i703Form = {
  upper_material: 'NAPA SOFT + MASSABOX',
  upper_material_group_id: G.massabox,
  upper_consumption: 2.74, // dm²/par → 2,74 ÷ 137 = 0,02 m/par
  upper_consumption_per_size: each(2.74),
  insole_material: 'PALMILHA',
  insole_consumption: 4.5,
  sole_group_id: 'g-solado',
  primary_sole_id: 'p-solado',
  components_accessories: [],
  direct_components: [{ product_id: fivela.id, quantity: 2, unit: 'un' }],
  has_straps: true,
  strap_colors: [
    { measure_id: 'm-over', identity_basis: 'reference_base', consumption: 44, consumption_per_size: each(44) },
    { measure_id: 'm-strass', identity_basis: 'finished_product_group', identity_group_id: G.strass, consumption: 50, consumption_per_size: each(50) },
  ],
};

const bomCola = [{
  product_id: 'p-cola', material_variant_id: null, quantity_per_unit: 0.01, consumption_per_size: null,
  products: { name: 'COLA FORTE', unit: 'kg', category: 'Componente', group_id: G.cola },
  product_groups: { id: G.cola, name: 'COLA FORTE' },
}];

function renderCard(overrides: Record<string, unknown> = {}) {
  return render(
    <PerPairConsumptionSummary
      form={i703Form}
      sizes={sizes}
      sheetMaterials={bomCola}
      componentSheets={componentSheets}
      products={products}
      groups={groups}
      strapCatalog={strapCatalog}
      referenceBaseGroups={[{ id: G.soft, name: 'NAPA SOFT' }]}
      canSeeCost
      onOpenMaterials={vi.fn()}
      {...overrides}
    />,
  );
}

const rowOf = (material: string) => screen.getByText(material).closest('li') as HTMLElement;

describe('PerPairConsumptionSummary — I703', () => {
  it('mostra só os exclusivos: some solado, palmilha e cola', () => {
    renderCard();
    expect(screen.getByText('Consumo e custo por par')).toBeInTheDocument();
    for (const name of ['Fivela 12mm', 'NAPA SOFT + MASSABOX', 'TIRA OVERLOCK · 5 mm', 'TIRA STRASS · 6 mm']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText('PALMILHA')).toBeNull();
    expect(screen.queryByText(/SOLADO/)).toBeNull();
    expect(screen.queryByText('COLA FORTE')).toBeNull();
  });

  it('custo por par de cada linha e total exclusivo', () => {
    renderCard();
    expect(within(rowOf('Fivela 12mm')).getByText('R$ 0,54')).toBeInTheDocument();
    expect(within(rowOf('Fivela 12mm')).getByText('R$ 0,27/un')).toBeInTheDocument();
    // Só os SKUs em metro — o de `un` (R$ 43,34) não entra no preço por metro.
    expect(within(rowOf('NAPA SOFT + MASSABOX')).getByText('R$ 43,54/m')).toBeInTheDocument();
    expect(within(rowOf('NAPA SOFT + MASSABOX')).getByText('R$ 0,87')).toBeInTheDocument();
    expect(within(rowOf('TIRA STRASS · 6 mm')).getByText('R$ 1,13')).toBeInTheDocument();
    expect(within(rowOf('TIRA STRASS · 6 mm')).getByText('R$ 1,00–1,25 conforme a cor')).toBeInTheDocument();
    expect(screen.getByText('Total exclusivo do modelo')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s2,91/)).toBeInTheDocument();
    expect(screen.queryByText(/sem preço — total incompleto/)).toBeNull();
  });

  it('overlock sem preço na NAPA SOFT → estimada pela medida, sem o outlier e sem faixa', () => {
    renderCard();
    const row = rowOf('TIRA OVERLOCK · 5 mm');
    expect(within(row).getByText('estimado')).toBeInTheDocument();
    expect(within(row).getByText('estimado pelo grupo — sem preço na NAPA SOFT')).toBeInTheDocument();
    expect(within(row).getByText('R$ 0,85/m')).toBeInTheDocument();
    expect(within(row).getByText('R$ 0,37')).toBeInTheDocument();
    expect(within(row).queryByText(/conforme a cor/)).toBeNull();
  });

  it('quem não vê custo (produção/almoxarifado) vê só consumo', () => {
    renderCard({ canSeeCost: false });
    expect(screen.getByText('Consumo por par')).toBeInTheDocument();
    expect(screen.getByText('Fivela 12mm')).toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).toBeNull();
    expect(screen.queryByText('estimado')).toBeNull();
    expect(screen.queryByText('Total exclusivo do modelo')).toBeNull();
  });
});

describe('PerPairConsumptionSummary — casos de cadastro', () => {
  it('SP301: cabedal NAPA SOFT estocado como Forração da Palmilha aparece com custo', () => {
    renderCard({
      form: {
        ...i703Form,
        upper_material: 'NAPA SOFT',
        upper_material_group_id: G.soft,
        upper_consumption: 6.85,
        upper_consumption_per_size: each(6.85),
        direct_components: [],
        has_straps: false,
      },
    });
    const row = rowOf('NAPA SOFT');
    expect(within(row).getByText('Cabedal')).toBeInTheDocument();
    expect(within(row).getByText('R$ 17,34/m')).toBeInTheDocument();
    expect(within(row).getByText('R$ 0,87')).toBeInTheDocument(); // 6,85 ÷ 137 = 0,05 m × 17,34
  });

  it('unidade do cabedal não depende de qual cor foi editada por último', () => {
    // useProducts vem por updated_at DESC: o SKU em `un` acabou de ser debitado e está na frente.
    const unFirst = [...products].sort((a, b) => (a.unit === 'un' && a.group_id === G.massabox ? -1 : 0)
      - (b.unit === 'un' && b.group_id === G.massabox ? -1 : 0));
    renderCard({ products: unFirst });
    const row = rowOf('NAPA SOFT + MASSABOX');
    expect(within(row).getByText('m/par')).toBeInTheDocument();
    expect(within(row).getByText('R$ 0,87')).toBeInTheDocument();
  });

  it('componente sem preço não estima pela mediana de outras peças do grupo misto', () => {
    const semPreco = { ...fivela, id: 'p-fivela-0', unit_price: 0 };
    renderCard({
      products: [...products, semPreco],
      form: { ...i703Form, direct_components: [{ product_id: semPreco.id, quantity: 2 }], has_straps: false },
    });
    const row = rowOf('Fivela 12mm');
    // A outra "Fivela 12mm" (R$ 0,27) é o mesmo material → estimado; Ilhós/Binóculo nunca.
    expect(within(row).getByText('R$ 0,54')).toBeInTheDocument();
    expect(within(row).getByText('estimado')).toBeInTheDocument();
  });

  it('tira chata estimada não mistura o ELÁSTICO guardado no mesmo grupo', () => {
    renderCard({
      form: {
        ...i703Form,
        direct_components: [],
        strap_colors: [
          { measure_id: 'm-chata', identity_basis: 'reference_base', group_id: G.chata, consumption: 100, consumption_per_size: each(100) },
        ],
      },
    });
    const row = rowOf('TIRA CHATA · 8 mm');
    expect(within(row).getByText('R$ 0,60/m')).toBeInTheDocument();
    expect(within(row).getByText('R$ 0,60')).toBeInTheDocument();
  });

  it('tira sem preço em lugar nenhum → "sem preço" e total incompleto', () => {
    renderCard({
      form: {
        ...i703Form,
        direct_components: [],
        strap_colors: [{ label: 'TIRA NOVA', identity_basis: 'reference_base', consumption: 30 }],
      },
    });
    expect(within(rowOf('TIRA NOVA')).getByText('sem preço')).toBeInTheDocument();
    expect(screen.getByText('+1 item sem preço — total incompleto')).toBeInTheDocument();
  });

  it('direct_components com product_id repetido (NL04/ELÁSTICO) conta uma vez — espelha v_dc_seen', () => {
    // JSON legado: mesma entrada 20 cm/par ×3. O débito/SQL deduplica; o card
    // somava 60 cm × R$ 0,01 = R$ 0,60. Correto = 20 cm → R$ 0,20.
    const elastico = sku(G.diversos, 'Elástico 6MM', 'cm', 0.01, { category: 'Componente' });
    const entry = { product_id: elastico.id, quantity: 20, unit: 'cm' };
    renderCard({
      products: [...products, elastico],
      form: {
        ...i703Form,
        upper_material: '',
        upper_material_group_id: null,
        direct_components: [entry, entry, entry],
        has_straps: false,
      },
      sheetMaterials: [],
    });
    const row = rowOf('Elástico 6MM');
    // Consumo fica "20" + span "cm/par" — casar pelo textContent do cell.
    expect(row.textContent).toMatch(/20\s*cm\/par/);
    expect(row.textContent).not.toMatch(/60\s*cm\/par/);
    expect(within(row).getByText('R$ 0,01/cm')).toBeInTheDocument();
    expect(within(row).getByText('R$ 0,20')).toBeInTheDocument();
    expect(within(row).queryByText('R$ 0,60')).toBeNull();
  });
});
