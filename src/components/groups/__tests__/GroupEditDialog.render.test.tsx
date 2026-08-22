import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ProductGroup } from '@/hooks/useGroups';
import type { Product } from '@/types/inventory';

/**
 * Smoke de RENDER da janela do grupo de estoque.
 *
 * Existe porque este arquivo já quebrou DUAS vezes exatamente assim: state
 * removido num cleanup deixando o JSX órfão (`sharedSpecs is not defined`,
 * commit a089022) e JSX entrando num merge sem as declarações
 * (`parentGroupId is not defined`, bec3ed0). O TS do projeto é loose, então
 * símbolo indefinido compila limpo e só estoura no navegador — nenhum outro
 * teste do repo monta este componente.
 *
 * Em 22/08/2026 a janela absorveu os painéis de variante (o antigo
 * `MasterVariantDialog`) e teve o state reorganizado. Este teste trava o que o
 * typecheck não vê: as abas existem, trocam, e cada painel monta sem explodir.
 */

const PRODUCTS: Array<Partial<Product>> = [
  {
    id: 'p1', name: 'NAPA SANTORINE', sku: 'NAP-PRT', color: 'PRETO', quantity: 12, unit: 'm',
    unit_price: 24.9, group_id: 'g1', active: true, category: 'Cabedal', purchase_unit: 'm',
    reserved_stock: 0, min_stock: 0, max_stock: 0, safety_stock: 0, location: 'A1',
    conversion_rate: 1, stock_grade: {},
  },
  {
    id: 'p2', name: 'NAPA SANTORINE', sku: 'NAP-OFF', color: 'OFF WHITE', quantity: 0, unit: 'm',
    unit_price: 13.34, group_id: 'g1', active: true, category: 'Cabedal', purchase_unit: 'm',
    reserved_stock: 0, min_stock: 0, max_stock: 0, safety_stock: 0, location: 'A2',
    conversion_rate: 1, stock_grade: {},
  },
];

const GROUP = {
  id: 'g1', name: 'NAPA SANTORINE', description: 'Laminado sintético.',
  sector: 'Cabedal', parent_group_id: null, is_family: false,
  is_bom_color_source: false, is_color_agnostic: false, shared_specs: true,
  consumption_unit: 'dm²', unit_weight_kg: 0, dimensions_width: 1370,
} as unknown as ProductGroup;

vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({ data: PRODUCTS as Product[], isLoading: false }),
  useAddProduct: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ data: [GROUP], isLoading: false }),
  useUpdateGroup: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/components/inventory/ForceDeleteProductDialog', () => ({
  useForceDeleteProductFlow: () => ({ tryDelete: vi.fn(), dialog: null }),
}));

/** Builder encadeável: qualquer método devolve a si mesmo e o await resolve vazio. */
vi.mock('@/integrations/supabase/client', () => {
  type Builder = Record<string, unknown>;
  const builder: Builder = new Proxy({} as Builder, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (r: unknown) => void) => resolve({ data: [], error: null });
      return () => builder;
    },
  });
  return { supabase: { from: () => builder, rpc: () => builder, auth: { getUser: async () => ({ data: { user: null } }) } } };
});

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

const { default: GroupEditDialog } = await import('@/components/groups/GroupEditDialog');
import type { GroupEditTab } from '@/components/groups/GroupEditDialog';

/** Cada aba tem título + sublabel; o sublabel de "Em massa" contém "cores" e
 *  casaria no seletor da aba Cores. Ancora no TÍTULO, que é o primeiro nó. */
const aberturaDaAba = (titulo: string) =>
  screen.getAllByRole('tab').find(tab => tab.querySelector('span > span')?.textContent === titulo)!;

const renderDialog = (initialTab?: GroupEditTab) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      {/* Mesmo invólucro do App.tsx: os selos de divergência da edição em massa
          são Tooltips do radix, que exigem o provider da raiz. */}
      <TooltipProvider>
        <MemoryRouter>
          <GroupEditDialog open onOpenChange={() => {}} group={GROUP} initialTab={initialTab} />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
};

describe('GroupEditDialog — janela única do grupo de estoque', () => {
  beforeEach(() => vi.clearAllMocks());

  it('monta com todas as abas do grupo-folha, incluindo as de variante', () => {
    renderDialog();
    for (const aba of ['Geral', 'Hierarquia', 'Cores', 'Itens', 'Em massa']) {
      expect(aberturaDaAba(aba), `aba ${aba}`).toBeInTheDocument();
    }
    // Aba Geral hidratada — os dois campos que já sumiram em merges anteriores.
    expect(screen.getByDisplayValue('NAPA SANTORINE')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Laminado sintético.')).toBeInTheDocument();
  });

  it('abre direto na aba pedida por quem chamou (o botão "Editar N itens")', () => {
    renderDialog('bulk');
    expect(aberturaDaAba('Em massa')).toHaveAttribute('data-state', 'active');
    // O painel de edição em massa montou de fato.
    expect(screen.getByText(/Campo deixado/i)).toBeInTheDocument();
    expect(screen.getByText(/todas as 2 cores/i)).toBeInTheDocument();
  });

  it('a edição em massa nasce com campo divergente VAZIO e homogêneo preenchido', () => {
    renderDialog('bulk');
    // Custo diverge (24,90 × 13,34) ⇒ selo e campo vazio, pra não achatar (R2.5/R2.6).
    expect(screen.getAllByText(/2 valores diferentes/i).length).toBeGreaterThan(0);
    // Nada preenchido ⇒ salvar fica travado.
    expect(screen.getByText('Nenhum campo preenchido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revisar e aplicar/i })).toBeDisabled();
  });

  it('abre na aba Cores quando a lista pediu "+ Cor"', () => {
    renderDialog('colors');
    expect(aberturaDaAba('Cores')).toHaveAttribute('data-state', 'active');
  });

  it('a aba Itens lista as variantes com as ações por cor', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(aberturaDaAba('Itens'));
    expect(screen.getByText('NAP-PRT')).toBeInTheDocument();
    expect(screen.getByText('NAP-OFF')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Editar completo/i })).toHaveLength(2);
    // Grupo homogêneo: sem coluna Nome, e o cadastro rápido de cor liberado.
    expect(screen.queryByRole('columnheader', { name: 'Nome' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Adicionar Variante/i })).toBeInTheDocument();
  });

  it('grupo heterogêneo mostra o nome e desliga o cadastro rápido de cor', async () => {
    const user = userEvent.setup();
    PRODUCTS[1].name = 'FIVELA REDONDA';
    try {
      renderDialog();
      await user.click(aberturaDaAba('Itens'));
      expect(screen.getByRole('columnheader', { name: 'Nome' })).toBeInTheDocument();
      expect(screen.getByText(/mais de um material/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Adicionar Variante/i })).not.toBeInTheDocument();
    } finally {
      PRODUCTS[1].name = 'NAPA SANTORINE';
    }
  });

  it('aba pedida que não existe neste grupo cai em Geral, sem janela vazia', () => {
    // Família (container) não tem Cores/Itens/Em massa. Sem o guard, o Radix não
    // acha o `TabsContent` e renderiza um painel vazio — sem erro nenhum.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <MemoryRouter>
            <GroupEditDialog
              open
              onOpenChange={() => {}}
              group={{ ...GROUP, id: 'g9', is_family: true }}
              initialTab="bulk"
            />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(aberturaDaAba('Geral')).toHaveAttribute('data-state', 'active');
    expect(aberturaDaAba('Em massa')).toBeUndefined();
    expect(screen.getByRole('button', { name: /Salvar família/i })).toBeInTheDocument();
  });

  it('nenhuma aba deixa o rodapé de salvar do grupo para trás', async () => {
    const user = userEvent.setup();
    renderDialog();
    for (const aba of ['Hierarquia', 'Cores', 'Itens', 'Em massa', 'Geral']) {
      await user.click(aberturaDaAba(aba));
      expect(screen.getByRole('button', { name: /Salvar grupo/i }), `rodapé sumiu na aba ${aba}`).toBeInTheDocument();
    }
  });
});
