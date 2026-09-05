import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useState, type FormEvent } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  buildCopySeedPayload,
  consumeCopySeed,
  hasStoredSaleOrderDraft,
} from '../SaleOrderForm';
import type { SaleOrderFormData, SaleOrderItemFormData } from '@/hooks/useSaleOrders';

/**
 * Testes do TRAJETO da cópia parcial de itens do PV, não das peças isoladas.
 *
 * O bug que derrubou a feature na primeira versão não estava em nenhuma função:
 * estava no FIO entre elas (o efeito que lê o seed nunca rodava). Teste de
 * função pura passava com folga enquanto a tela criava um pedido com os itens
 * errados. Por isso aqui exercitamos as duas pontas de verdade:
 *   1. o clique no botão da barra de lote entrega os ÍNDICES certos;
 *   2. o seed sobrevive ao armazenamento e é consumido UMA vez do outro lado.
 */

// O item do PV é pesado (dezenas de hooks de cor/produto/ficha) e não é o que
// está sob teste — o dublê mantém só o contrato que o painel usa dele.
vi.mock('@/components/sale-orders/SaleOrderItemForm', () => ({
  default: ({ item, index, isSelected, onToggleSelect, onRemove }: any) => (
    <div data-testid={`item-${index}`}>
      <input
        type="checkbox"
        aria-label={`selecionar ${item.reference_id}`}
        checked={!!isSelected}
        onChange={() => onToggleSelect?.(index)}
      />
      <button type="button" onClick={() => onRemove?.(index)}>
        remover {item.reference_id}
      </button>
    </div>
  ),
}));

vi.mock('@/hooks/useAccessControl', () => ({
  useAccessControl: () => ({ canSeeFinancialValues: true }),
}));
vi.mock('@/hooks/useContractors', () => ({ useContractors: () => ({ data: [] }) }));
vi.mock('@/components/finance/FactoringTab', () => ({ useFactoringConfigs: () => ({ data: [] }) }));
vi.mock('@/hooks/useNfe', () => ({ useCompanies: () => ({ data: [] }) }));
vi.mock('@/hooks/useEconomicGroup360', () => ({ useClientCommercialDefaults: () => ({ data: null }) }));
vi.mock('@/hooks/useReferenceMaterialVariants', () => ({
  useAllActiveReferenceMaterialVariants: () => ({ data: new Map() }),
}));
vi.mock('@/lib/clientCreditExposure', () => ({ fetchClientCreditExposure: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/mobile/clientContext', () => ({ fetchClientPriceList: vi.fn().mockResolvedValue(null) }));
vi.mock('@/integrations/supabase/client', () => {
  const thenable = { data: [], error: null };
  const chain: any = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'then') return (resolve: any) => resolve(thenable);
      return () => chain;
    },
  });
  return { supabase: { from: () => chain, rpc: () => chain } };
});

import SaleOrderFormPanel, {
  removeItemsAtIndices,
  restoreItemsAt,
  saleOrderItemDuplicateKey,
  shouldWarnSaleOrderItemDuplicate,
} from '@/components/sale-orders/SaleOrderFormPanel';

const ITEMS: SaleOrderItemFormData[] = [
  { id: 'i-A', reference_id: 'REF-A', color: 'PRETO', grade: { '37': 5 }, unit_price: 100, quantity: 5, fichas: 1 },
  { id: 'i-B', reference_id: 'REF-B', color: 'BRANCO', grade: { '38': 6 }, unit_price: 110, quantity: 6, fichas: 1 },
  { id: 'i-C', reference_id: 'REF-C', color: 'AZUL', grade: { '39': 7 }, unit_price: 120, quantity: 7, fichas: 1 },
];

describe('identidade de duplicata com cores independentes por tira', () => {
  const lineA = '11111111-1111-4111-8111-111111111111';
  const lineB = '22222222-2222-4222-8222-222222222222';
  const red = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const blue = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const item = (strapColors: NonNullable<SaleOrderItemFormData['strap_colors']>) => ({
    ...ITEMS[0],
    strap_colors: strapColors,
  });
  const strap = (lineId: string, colorId: string, colorMode: 'follow_main' | 'select_on_order') => ({
    id: lineId,
    technical_strap_line_id: lineId,
    label: lineId === lineA ? 'TIRA 1' : 'TIRA 2',
    color: colorId === red ? 'VERMELHO' : 'AZUL',
    color_id: colorId,
    identity_basis: 'reference_base' as const,
    color_mode: colorMode,
  });

  it('considera equivalente a mesma combinação em outra ordem de apresentação', () => {
    const first = item([
      strap(lineA, red, 'select_on_order'),
      strap(lineB, blue, 'select_on_order'),
    ]);
    const reordered = item([
      { ...strap(lineB, blue, 'select_on_order'), label: 'SEGUNDA TIRA' },
      { ...strap(lineA, red, 'select_on_order'), label: 'PRIMEIRA TIRA' },
    ]);

    expect(saleOrderItemDuplicateKey(first)).toBe(saleOrderItemDuplicateKey(reordered));
  });

  it('mantém equivalência por UUID v7 canônico ao reordenar as linhas', () => {
    const lineV7A = '0198f35c-7f4d-7000-8000-000000000001';
    const lineV7B = '0198f35c-7f4d-7000-8000-000000000002';
    const first = item([
      strap(lineV7A, red, 'select_on_order'),
      strap(lineV7B, blue, 'select_on_order'),
    ]);
    const reordered = item([
      strap(lineV7B, blue, 'select_on_order'),
      strap(lineV7A, red, 'select_on_order'),
    ]);

    expect(saleOrderItemDuplicateKey(first)).toBe(saleOrderItemDuplicateKey(reordered));
  });

  it('não mescla cores trocadas entre posições nem políticas diferentes', () => {
    const original = item([
      strap(lineA, red, 'select_on_order'),
      strap(lineB, blue, 'select_on_order'),
    ]);
    const colorsSwapped = item([
      strap(lineA, blue, 'select_on_order'),
      strap(lineB, red, 'select_on_order'),
    ]);
    const differentMode = item([
      strap(lineA, red, 'follow_main'),
      strap(lineB, blue, 'select_on_order'),
    ]);

    expect(saleOrderItemDuplicateKey(colorsSwapped)).not.toBe(saleOrderItemDuplicateKey(original));
    expect(saleOrderItemDuplicateKey(differentMode)).not.toBe(saleOrderItemDuplicateKey(original));
  });

  it('não alerta duplicidade para mesma referência/cor com tiras diferentes', () => {
    const original = item([
      strap(lineA, red, 'select_on_order'),
      strap(lineB, blue, 'select_on_order'),
    ]);
    const colorsSwapped = item([
      strap(lineA, blue, 'select_on_order'),
      strap(lineB, red, 'select_on_order'),
    ]);

    expect(shouldWarnSaleOrderItemDuplicate([original, colorsSwapped], 1)).toBe(false);
  });

  it('alerta duplicidade quando a chave produtiva completa é idêntica', () => {
    const original = item([
      strap(lineA, red, 'select_on_order'),
      strap(lineB, blue, 'select_on_order'),
    ]);
    const reordered = item([
      strap(lineB, blue, 'select_on_order'),
      strap(lineA, red, 'select_on_order'),
    ]);

    expect(shouldWarnSaleOrderItemDuplicate([original, reordered], 1)).toBe(true);
  });

  it('mantém a posição como identidade conservadora em snapshots legados sem UUID', () => {
    const legacy = (position: number, colorId: string) => ({
      id: String(position),
      label: `TIRA ${position}`,
      color: colorId === red ? 'VERMELHO' : 'AZUL',
      color_id: colorId,
      identity_basis: 'reference_base' as const,
      color_mode: 'select_on_order' as const,
    });
    const original = item([legacy(1, red), legacy(2, blue)]);
    const colorsSwapped = item([legacy(1, blue), legacy(2, red)]);

    expect(saleOrderItemDuplicateKey(colorsSwapped)).not.toBe(saleOrderItemDuplicateKey(original));
  });
});

const FORM: SaleOrderFormData = {
  client_id: 'cli-1', client_name: 'PONTO MIX', client_cnpj: '', client_contact: '',
  client_order_number: '', representative: '', payment_condition: '30/60',
  delivery_deadline: '', delivery_week: '', delivery_month: '', notes: '',
  status: 'Aprovado', nfe: '', remessa: '', is_factoring: false,
  factoring_config_id: '', packaging_mode: 'colmeia',
};

function PanelHarness({
  onCopy, onDelete, onUserEdit, onSubmit, initialItems = ITEMS,
}: {
  onCopy?: (indices: number[]) => void;
  onDelete?: (indices: number[]) => void;
  onUserEdit?: () => void;
  onSubmit?: (e: FormEvent) => void;
  initialItems?: SaleOrderItemFormData[];
}) {
  // Estado real: é ele que faz o remover-item reindexar a seleção de verdade.
  const [items, setItems] = useState<SaleOrderItemFormData[]>(initialItems);
  return (
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SaleOrderFormPanel
          form={FORM}
          setForm={() => {}}
          items={items}
          setItems={setItems}
          clients={[]}
          representatives={[]}
          references={[]}
          isAdmin
          selectedClientId="cli-1"
          onClientSelect={() => {}}
          onSubmit={onSubmit ?? ((e) => e.preventDefault())}
          onCancel={() => {}}
          onUserEdit={onUserEdit}
          isPending={false}
          submitLabel="Criar Pedido"
          onCopyToNewOrder={onCopy}
          onDeleteSelectedItems={onDelete}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('badge visual de duplicidade produtiva', () => {
  const lineA = '0198f35c-7f4d-7000-8000-000000000001';
  const lineB = '0198f35c-7f4d-7000-8000-000000000002';
  const red = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const blue = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const strap = (lineId: string, colorId: string) => ({
    id: lineId,
    technical_strap_line_id: lineId,
    label: lineId === lineA ? 'TIRA 1' : 'TIRA 2',
    color: colorId === red ? 'VERMELHO' : 'AZUL',
    color_id: colorId,
    identity_basis: 'reference_base' as const,
    color_mode: 'select_on_order' as const,
  });
  const configuredItem = (
    id: string,
    colors: [string, string],
  ): SaleOrderItemFormData => ({
    ...ITEMS[0],
    id,
    strap_colors: [strap(lineA, colors[0]), strap(lineB, colors[1])],
  });

  it('não sinaliza mesma referência/cor principal quando as tiras são diferentes', () => {
    render(<PanelHarness initialItems={[
      configuredItem('x-1', [red, blue]),
      configuredItem('y-1', [blue, red]),
    ]} />);

    expect(screen.queryByText('Duplicado · mesma configuração')).toBeNull();
  });

  it('sinaliza somente a repetição real não adjacente em X, Y, X', () => {
    render(<PanelHarness initialItems={[
      configuredItem('x-1', [red, blue]),
      configuredItem('y-1', [blue, red]),
      configuredItem('x-2', [red, blue]),
    ]} />);

    expect(screen.getAllByText('Duplicado · mesma configuração')).toHaveLength(1);
    expect(screen.getByTestId('item-2').parentElement?.textContent)
      .toContain('Duplicado · mesma configuração');
    expect(screen.getByTestId('item-0').parentElement?.textContent)
      .not.toContain('Duplicado · mesma configuração');
  });
});

describe('cópia parcial — do clique aos índices', () => {
  it('entrega ao pai exatamente os itens marcados', async () => {
    const onCopy = vi.fn();
    const user = userEvent.setup();
    render(<PanelHarness onCopy={onCopy} />);

    await user.click(screen.getByLabelText('selecionar REF-A'));
    await user.click(screen.getByLabelText('selecionar REF-C'));
    await user.click(screen.getByRole('button', { name: /copiar p\/ novo pv/i }));

    expect(onCopy).toHaveBeenCalledWith([0, 2]);
  });

  it('depois de remover um item, os índices acompanham — copia o item ESCOLHIDO', async () => {
    const onCopy = vi.fn();
    const user = userEvent.setup();
    render(<PanelHarness onCopy={onCopy} />);

    // marca B (índice 1) e apaga A (índice 0): B passa a ser o índice 0.
    await user.click(screen.getByLabelText('selecionar REF-B'));
    await user.click(screen.getByRole('button', { name: 'remover REF-A' }));
    await user.click(screen.getByRole('button', { name: /copiar p\/ novo pv/i }));

    // Sem a reindexação isto viria [1] — que agora é o REF-C, item errado.
    expect(onCopy).toHaveBeenCalledWith([0]);
  });

  it('o botão não existe fora da edição (sem o callback do pai)', () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <SaleOrderFormPanel
            form={FORM} setForm={() => {}} items={ITEMS} setItems={() => {}}
            clients={[]} representatives={[]} references={[]} isAdmin
            selectedClientId="cli-1" onClientSelect={() => {}}
            onSubmit={(e) => e.preventDefault()} onCancel={() => {}}
            isPending={false} submitLabel="Criar Pedido"
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /copiar p\/ novo pv/i })).toBeNull();
  });
});

/**
 * Exclusão em lote. Sem diálogo de confirmação (decisão do dono) — a rede é o
 * Desfazer do toast, disparado pelo pai. O que o painel garante é: entregar os
 * índices certos, nunca deixar o pedido sem item, e marcar o formulário como
 * alterado (senão dá pra excluir, tocar em Voltar e sair sem aviso nenhum).
 */
describe('excluir selecionados — barra de lote', () => {
  it('entrega ao pai os índices marcados e limpa a seleção', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<PanelHarness onDelete={onDelete} />);

    await user.click(screen.getByLabelText('selecionar REF-A'));
    await user.click(screen.getByLabelText('selecionar REF-C'));
    await user.click(screen.getByRole('button', { name: /excluir selecionados/i }));

    expect(onDelete).toHaveBeenCalledWith([0, 2]);
    // Seleção zerada: a barra de lote some quando não há nada marcado.
    expect(screen.queryByRole('button', { name: /excluir selecionados/i })).toBeNull();
  });

  it('recusa excluir TODOS — o pedido não pode ficar sem item', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<PanelHarness onDelete={onDelete} />);

    for (const ref of ['REF-A', 'REF-B', 'REF-C']) {
      await user.click(screen.getByLabelText(`selecionar ${ref}`));
    }
    await user.click(screen.getByRole('button', { name: /excluir selecionados/i }));

    expect(onDelete).not.toHaveBeenCalled();
    // O botão continua lá (não desabilitamos: no celular não há hover pra explicar).
    expect(screen.getByRole('button', { name: /excluir selecionados/i })).toBeTruthy();
  });

  it('marca o formulário como alterado — senão dá pra sair sem aviso', async () => {
    const onUserEdit = vi.fn();
    const user = userEvent.setup();
    render(<PanelHarness onDelete={vi.fn()} onUserEdit={onUserEdit} />);

    await user.click(screen.getByLabelText('selecionar REF-A'));
    await user.click(screen.getByRole('button', { name: /excluir selecionados/i }));

    expect(onUserEdit).toHaveBeenCalled();
  });

  it('a lixeira individual também marca alterado (mesmo gesto, mesmo aviso)', async () => {
    const onUserEdit = vi.fn();
    const user = userEvent.setup();
    render(<PanelHarness onDelete={vi.fn()} onUserEdit={onUserEdit} />);

    await user.click(screen.getByRole('button', { name: 'remover REF-A' }));

    expect(onUserEdit).toHaveBeenCalled();
  });

  it('o botão não existe fora da edição (sem o callback do pai)', () => {
    render(<PanelHarness onCopy={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /excluir selecionados/i })).toBeNull();
  });
});

describe('exclusão em lote — helpers de remoção e desfazer', () => {
  const lista = (...refs: string[]) =>
    refs.map(r => ({ ...ITEMS[0], reference_id: r })) as SaleOrderItemFormData[];
  const refs = (its: SaleOrderItemFormData[]) => its.map(i => i.reference_id);

  it('remove vários de uma vez e guarda de onde cada um saiu', () => {
    const { remaining, removed } = removeItemsAtIndices(lista('A', 'B', 'C', 'D'), [1, 3]);
    expect(refs(remaining)).toEqual(['A', 'C']);
    expect(removed.map(r => [r.item.reference_id, r.index])).toEqual([['B', 1], ['D', 3]]);
  });

  it('ignora índice repetido ou fora da lista', () => {
    const { remaining, removed } = removeItemsAtIndices(lista('A', 'B'), [1, 1, 7]);
    expect(refs(remaining)).toEqual(['A']);
    expect(removed).toHaveLength(1);
  });

  it('nunca remove item retirado da produção, mesmo quando o índice é solicitado', () => {
    const items = lista('A', 'B', 'C');
    items[1] = {
      ...items[1],
      production_excluded_at: '2026-08-30T12:00:00Z',
      production_exclusion_reason: 'Ficha aposentada pelo administrador',
      production_exclusion_request_id: '11111111-1111-4111-8111-111111111111',
    };
    const { remaining, removed } = removeItemsAtIndices(items, [1, 2]);
    expect(refs(remaining)).toEqual(['A', 'B']);
    expect(removed.map((entry) => entry.item.reference_id)).toEqual(['C']);
  });

  it('Desfazer devolve cada item na posição original', () => {
    const original = lista('A', 'B', 'C', 'D');
    const { remaining, removed } = removeItemsAtIndices(original, [1, 3]);
    expect(refs(restoreItemsAt(remaining, removed))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('a lista pode ter ENCOLHIDO antes do Desfazer — o item volta no fim, não some', () => {
    const { removed } = removeItemsAtIndices(lista('A', 'B', 'C', 'D'), [3]);
    // usuário apagou mais itens enquanto o toast (que não expira) seguia aberto
    const encolhida = lista('A');
    const restaurada = restoreItemsAt(encolhida, removed);
    expect(refs(restaurada)).toEqual(['A', 'D']);
  });
});

describe('save do PV não intercepta o cadastro de cor', () => {
  it('submit de um form aninhado (Novo Material) não dispara o save do pedido', () => {
    const onSubmit = vi.fn();
    render(<PanelHarness onSubmit={onSubmit} />);
    const pvForm = document.querySelector('form');
    expect(pvForm).toBeTruthy();

    const nested = document.createElement('form');
    nested.setAttribute('aria-label', 'novo-material');
    pvForm!.appendChild(nested);

    fireEvent.submit(nested);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.submit(pvForm!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('item retirado não volta a bloquear o editor', () => {
  it('permite salvar o cabeçalho mesmo se a linha histórica tiver dados produtivos incompletos', async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <PanelHarness
        onSubmit={onSubmit}
        initialItems={[{
          ...ITEMS[0],
          color: '',
          quantity: 0,
          unit_price: 0,
          production_excluded_at: '2026-08-30T12:00:00Z',
          production_exclusion_reason: 'Ficha aposentada pelo administrador',
          production_exclusion_request_id: '11111111-1111-4111-8111-111111111111',
        }]}
      />,
    );

    const submit = screen.getByRole('button', { name: 'Criar Pedido' });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('cópia parcial — o seed do outro lado', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  const semear = (indices: number[]) => {
    const seed = buildCopySeedPayload({
      seedItems: indices.map(i => ITEMS[i]),
      form: FORM,
      selectedClientId: 'cli-1',
      sourceOrderNumber: 'PV-2026-00123',
      activeVariantIds: new Set<string>(),
      companyIsActive: true,
    });
    sessionStorage.setItem('sale_order_copy_seed', JSON.stringify(seed));
  };

  it('atravessa o armazenamento com os itens escolhidos e o cliente do pedido origem', () => {
    semear([0, 2]);
    const seed = consumeCopySeed();
    expect(seed?.items.map(i => i.reference_id)).toEqual(['REF-A', 'REF-C']);
    expect(seed?.form.client_name).toBe('PONTO MIX');
    expect(seed?.form.payment_condition).toBe('30/60');
    expect(seed?.form.status).toBe('Rascunho');
    // O id da linha não sobrevive à serialização — o PV novo cria linhas novas.
    expect(seed?.items.every(i => i.id === undefined)).toBe(true);
  });

  it('é ONE-SHOT: a segunda leitura não repete a cópia', () => {
    semear([1]);
    expect(consumeCopySeed()?.items).toHaveLength(1);
    expect(consumeCopySeed()).toBeNull();
  });

  it('seed corrompido devolve null E some do armazenamento (não fica preso)', () => {
    sessionStorage.setItem('sale_order_copy_seed', '{isto não é json');
    expect(consumeCopySeed()).toBeNull();
    expect(sessionStorage.getItem('sale_order_copy_seed')).toBeNull();
  });

  it('seed sem item nenhum é ignorado — a tela segue como pedido novo comum', () => {
    sessionStorage.setItem('sale_order_copy_seed', JSON.stringify({ items: [], form: {} }));
    expect(consumeCopySeed()).toBeNull();
  });

  it('sem cópia pendente não inventa nada', () => {
    expect(consumeCopySeed()).toBeNull();
  });

  it('detecta rascunho guardado — é o que desarma o auto-save e evita apagá-lo', () => {
    expect(hasStoredSaleOrderDraft('user-1')).toBe(false);
    localStorage.setItem('sale_order_draft:user-1', JSON.stringify({ form: {}, items: [] }));
    expect(hasStoredSaleOrderDraft('user-1')).toBe(true);
  });

  it('rascunho é isolado por conta — o de um vendedor não aparece pro outro', () => {
    localStorage.setItem('sale_order_draft:user-1', JSON.stringify({ form: {}, items: [] }));
    expect(hasStoredSaleOrderDraft('user-2')).toBe(false);
  });
});
