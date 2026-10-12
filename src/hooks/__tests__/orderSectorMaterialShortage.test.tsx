import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildShortagePointingWarnings,
  buildShortageWarningsFromLines,
  orderSectorMaterialShortagesRoot,
  useOrderSectorMaterialShortage,
  type SaleOrderMaterialShortageInfo,
  type SectorMaterialShortageLine,
} from '@/hooks/useSaleOrderMaterialShortages';
import { invalidateProductSupply } from '@/hooks/useProductSupplySummary';

// ⚠ alias `@/` obrigatório (CLAUDE.md): `vi.mock` relativo é ignorado em
// silêncio quando o vitest roda sob o Bun.
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));

const ORDER = '11111111-1111-4111-8111-111111111111';

function line(over: Partial<SectorMaterialShortageLine> = {}): SectorMaterialShortageLine {
  return {
    product_id: 'p1', product_name: 'NAPA SOFT', color: 'PRETO', unit: 'm',
    quantity_short: 12, shortage_grade: null,
    consumption_sector: 'Corte Cabedal', sector_source: 'componente',
    ...over,
  };
}

const PV_INFO: SaleOrderMaterialShortageInfo = {
  orderNumber: 'PV-00160', managedLines: 4, shortLines: 1,
  shortages: [{
    product_id: 'p1', product_name: 'NAPA SOFT', color: 'PRETO',
    unit: 'm', quantity_short: 12, shortage_grade: null,
  }],
};

function renderShortage(
  stage: string | null,
  enabled = true,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const rendered = renderHook(() => useOrderSectorMaterialShortage(ORDER, stage, enabled), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  return { ...rendered, client };
}

/**
 * Espelha a expressão dos diálogos do Kanban (`DropApontarDialog` /
 * `BulkMoveDialog`): a lista por setor manda, e a falha da RPC cai no aviso por
 * PV — nunca em silêncio.
 */
function dialogWarnings(
  state: { lines: SectorMaterialShortageLine[]; unavailable: boolean },
  pv: SaleOrderMaterialShortageInfo | undefined,
) {
  return state.unavailable
    ? buildShortagePointingWarnings(pv)
    : buildShortageWarningsFromLines(state.lines);
}

describe('buildShortageWarningsFromLines', () => {
  it('lista vazia (ou ainda carregando) não gera aviso nenhum', () => {
    expect(buildShortageWarningsFromLines([])).toEqual([]);
    expect(buildShortageWarningsFromLines(undefined)).toEqual([]);
    expect(buildShortageWarningsFromLines(null)).toEqual([]);
  });

  it('mesma formatação do aviso por PV, com código de cliente', () => {
    const warnings = buildShortageWarningsFromLines([
      line(),
      line({
        product_id: 'p2', product_name: 'SOLADO 01', color: null, unit: 'par',
        quantity_short: 16, shortage_grade: { '35': 6, '36': 10 },
        consumption_sector: 'Solagem',
      }),
    ]);
    expect(warnings.map(w => w.message)).toEqual([
      'Falta 12 m de NAPA SOFT PRETO — o setor vai iniciar com material parcial.',
      'Falta 16 pares de SOLADO 01 (nº 35: 6 · 36: 10) — o setor vai iniciar com material parcial.',
    ]);
    expect(warnings.every(w => w.code.startsWith('pv_material_falta'))).toBe(true);
    expect(new Set(warnings.map(w => w.code)).size).toBe(warnings.length);
  });

  it('teto de 6 linhas + "E mais N"', () => {
    const lines = Array.from({ length: 9 }, (_, i) =>
      line({ product_id: String(i), product_name: `MAT ${i}`, color: null, unit: 'un', quantity_short: 1 }));
    const warnings = buildShortageWarningsFromLines(lines);
    expect(warnings).toHaveLength(7);
    expect(warnings[6]).toEqual({
      code: 'pv_material_falta_mais',
      message: 'E mais 3 materiais em falta neste PV.',
    });
  });

  it('o aviso por PV passou a DELEGAR nesta formatação, sem mudar de saída', () => {
    const info: SaleOrderMaterialShortageInfo = {
      orderNumber: 'PV-00160', managedLines: 4, shortLines: 2,
      shortages: [
        { product_id: 'a', product_name: 'NAPA', color: 'PRETO', unit: 'm', quantity_short: 12, shortage_grade: null },
        { product_id: 'b', product_name: 'SOLADO 01', color: null, unit: 'par', quantity_short: 16, shortage_grade: { '35': 6 } },
      ],
    };
    expect(buildShortagePointingWarnings(info)).toEqual(buildShortageWarningsFromLines(info.shortages));
  });
});

describe('useOrderSectorMaterialShortage', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('setor sem material em falta → ZERO avisos (Acabamento/Expedição passam direto)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderShortage('Acabamento');
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.lines).toEqual([]);
    expect(result.current.unavailable).toBe(false);
    expect(dialogWarnings(result.current, PV_INFO)).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'list_order_sector_material_shortages',
      { p_order_id: ORDER, p_stage_name: 'Acabamento' },
    );
  });

  it('setor que consome → avisa com a falta daquele setor', async () => {
    mocks.rpc.mockResolvedValue({ data: [line()], error: null });
    const { result } = renderShortage('Corte Cabedal');
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    expect(dialogWarnings(result.current, PV_INFO).map(w => w.message)).toEqual([
      'Falta 12 m de NAPA SOFT PRETO — o setor vai iniciar com material parcial.',
    ]);
  });

  it('FAIL-SAFE: linha de setor desconhecido avisa, mesmo num setor qualquer', async () => {
    mocks.rpc.mockResolvedValue({
      data: [line({
        product_name: 'COLA DE MONTAGEM', color: null, unit: 'kg', quantity_short: 3,
        consumption_sector: null, sector_source: 'desconhecido',
      })],
      error: null,
    });
    const { result } = renderShortage('Expedição');
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    expect(dialogWarnings(result.current, PV_INFO)).toHaveLength(1);
  });

  it('RPC ausente/erro NÃO vira "sem falta": marca unavailable e cai no aviso por PV', async () => {
    // Janela real: o deploy da Vercel é automático no push e a migration é
    // aplicada à mão. Devolver [] aqui faria o Kanban inteiro parar de
    // perguntar, em todo setor e em toda OP, sem nada na tela dizendo isso.
    //
    // ⚠ Falha de REDE chega por aqui também: o postgrest-js converte o erro do
    // fetch em `{ data: null, error }` em vez de rejeitar a promise, então este
    // é o único caminho de erro que a RPC produz na prática.
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    const { result } = renderShortage('Solagem');
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.lines).toEqual([]);
    expect(dialogWarnings(result.current, PV_INFO).map(w => w.message)).toEqual([
      'Falta 12 m de NAPA SOFT PRETO — o setor vai iniciar com material parcial.',
    ]);
    // sem PV no fallback (OP sem PV) o aviso simplesmente não existe
    expect(dialogWarnings(result.current, undefined)).toEqual([]);
  });

  it('carregando NÃO é falha: sem aviso e sem fallback por PV', () => {
    // Primeiro render, antes da resposta: é o estado em que o diálogo abre.
    mocks.rpc.mockResolvedValue({ data: [line()], error: null });
    const { result } = renderShortage('Corte Cabedal');
    expect(result.current.isLoading).toBe(true);
    expect(result.current.unavailable).toBe(false);
    expect(result.current.lines).toEqual([]);
    expect(dialogWarnings(result.current, PV_INFO)).toEqual([]);
  });

  it('estorno/readOnly (enabled=false) e setor indefinido não consultam nada', async () => {
    mocks.rpc.mockResolvedValue({ data: [line()], error: null });
    renderShortage('Corte Cabedal', false);
    renderShortage(null, true);
    renderShortage('', true);
    await waitFor(() => expect(mocks.rpc).not.toHaveBeenCalled());
  });

  it('grafia legada e canônica do mesmo setor compartilham a ENTRADA de cache', async () => {
    // A key normaliza o setor: 'Corte Fibra' e 'Palmilha · Fibra' são UMA query,
    // não duas com a mesma resposta. (Chamada por observador é esperada: esta
    // query não tem janela de stale — ver o describe de frescor.)
    mocks.rpc.mockResolvedValue({ data: [line({ consumption_sector: 'Palmilha · Fibra' })], error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = renderShortage('Corte Fibra', true, client);
    await waitFor(() => expect(first.result.current.lines).toHaveLength(1));
    const second = renderShortage('Palmilha · Fibra', true, client);
    await waitFor(() => expect(second.result.current.lines).toHaveLength(1));
    expect(
      client.getQueryCache().findAll({ queryKey: [...orderSectorMaterialShortagesRoot] }),
    ).toHaveLength(1);
    client.clear();
  });
});

describe('frescor da falta por setor (ela porteia uma escrita no ledger)', () => {
  it('a entrada de estoque invalida a raiz por setor, não só o selo do PV', async () => {
    // Sem isto o selo do card virava "Material completo" e o diálogo da MESMA
    // tela seguia perguntando pela napa que o almoxarifado acabou de receber —
    // gravando "ciente da falta" no histórico de produção.
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: [line()], error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderShortage('Corte Cabedal', true, client);
    await waitFor(() => expect(result.current.lines).toHaveLength(1));

    mocks.rpc.mockResolvedValue({ data: [], error: null });
    invalidateProductSupply(client);
    await waitFor(() => expect(result.current.lines).toEqual([]));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it('não serve resposta velha: a query de diálogo não tem janela de stale', async () => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderShortage('Corte Cabedal', true, client);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const [query] = client.getQueryCache().findAll({ queryKey: [...orderSectorMaterialShortagesRoot] });
    expect(query, 'query por setor ausente no cache').toBeTruthy();
    // resposta JÁ chegou e a query já está stale: reabrir o diálogo revalida em
    // vez de servir a falta de 15 min atrás (gcTime herdado do App.tsx).
    expect(query.isStale()).toBe(true);
    expect(query.gcTime).toBe(0);
    client.clear();
  });
});
