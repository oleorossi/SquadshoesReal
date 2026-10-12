import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { canonicalStageName } from '@/lib/production/stageFlow';

/**
 * Falta de material por PV — RPC `list_sale_order_material_shortages(uuid[])`
 * (spec `integracao-estoque-pv-compras.md`).
 *
 * "Material completo" = o motor de empenho gerencia linhas do PV e nenhuma
 * ficou curta. "Falta material" = alguma linha empenhou menos que o consumo.
 *
 * ⚠ Aviso, não trava: aprovar ou apontar com falta continua permitido. Por isso
 * a falha da RPC (inclusive "função não existe" antes da migration chegar ao
 * banco) degrada em SILÊNCIO — devolve mapa vazio, sem toast e sem retry.
 * Nenhuma tela pode quebrar ou bloquear por causa deste selo.
 */

export interface MaterialShortageLine {
  product_id: string | null;
  product_name: string;
  color: string | null;
  unit: string | null;
  quantity_short: number;
  /** Solado: falta por numeração/balde, ex. {"35":6,"33/34":4}. */
  shortage_grade: Record<string, number> | null;
}

/**
 * Mesma linha de falta, já filtrada pelo SETOR que consome o material
 * (`list_order_sector_material_shortages`).
 *
 * `consumption_sector = null` + `sector_source = 'desconhecido'` é o FAIL-SAFE
 * do servidor: material sem roteamento conhecido avisa em todo setor.
 *
 * `sector_source` diz DE ONDE veio o setor, em ordem de precedência:
 * `explicito` (gravado na reserva) > `cadastro` (`sheet_materials.sector`, depois
 * `bom_part_sector_map` pelo grupo) > `componente` (mapa canônico por rótulo) >
 * `desconhecido` (nada resolveu → fail-safe). É só rastreabilidade: a tela não
 * ramifica por este valor, e um valor novo do servidor não pode quebrá-la.
 */
export interface SectorMaterialShortageLine extends MaterialShortageLine {
  consumption_sector: string | null;
  sector_source: 'explicito' | 'cadastro' | 'componente' | 'desconhecido' | string;
}

export interface SaleOrderMaterialShortageInfo {
  orderNumber: string | null;
  managedLines: number;
  shortLines: number;
  shortages: MaterialShortageLine[];
}

export type MaterialShortageStatus = 'completo' | 'falta' | null;

/** Default estável para `data` enquanto a RPC não respondeu (ou falhou). */
export const EMPTY_MATERIAL_SHORTAGES: ReadonlyMap<string, SaleOrderMaterialShortageInfo> =
  new Map<string, SaleOrderMaterialShortageInfo>();

export const saleOrderMaterialShortagesRoot = ['sale-order-material-shortages'] as const;

/** Status comerciais em que o selo de material faz sentido na lista de PVs. */
export function saleOrderShowsMaterialShortage(status: string | null | undefined): boolean {
  return status === 'Aprovado' || status === 'Em Produção';
}

/** Estado do selo: só fala quando há linha gerenciada pelo motor de empenho. */
export function materialShortageStatus(
  info: SaleOrderMaterialShortageInfo | null | undefined,
): MaterialShortageStatus {
  if (!info) return null;
  if (info.shortLines > 0) return 'falta';
  if (info.managedLines > 0) return 'completo';
  return null;
}

const qtyFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

export function formatShortageQuantity(qty: number, unit: string | null | undefined): string {
  const n = qtyFmt.format(Number(qty) || 0);
  const u = (unit || '').trim();
  if (!u) return n;
  if (u.toLowerCase() === 'par') return `${n} ${Number(qty) === 1 ? 'par' : 'pares'}`;
  return `${n} ${u}`;
}

/** Nome + cor sem repetir a cor quando ela já está no nome do SKU. */
export function shortageMaterialLabel(line: Pick<MaterialShortageLine, 'product_name' | 'color'>): string {
  const name = (line.product_name || 'Material').trim();
  const color = (line.color || '').trim();
  if (!color) return name;
  if (name.toLowerCase().includes(color.toLowerCase())) return name;
  return `${name} ${color}`;
}

/** Numerações em falta do solado, ordenadas: "35: 6 · 36: 10". */
export function formatShortageGrade(grade: Record<string, number> | null | undefined): string | null {
  if (!grade) return null;
  const entries = Object.entries(grade)
    .filter(([k, v]) => !k.startsWith('_') && Number(v) > 0)
    .sort(([a], [b]) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}: ${qtyFmt.format(Number(v))}`).join(' · ');
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseGrade(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = toNumber(v);
    if (n > 0) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseShortages(raw: unknown): MaterialShortageLine[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map(s => ({
      product_id: (s.product_id as string) ?? null,
      product_name: String(s.product_name ?? 'Material'),
      color: (s.color as string) ?? null,
      unit: (s.unit as string) ?? null,
      quantity_short: toNumber(s.quantity_short),
      shortage_grade: parseGrade(s.shortage_grade),
    }))
    .filter(s => s.quantity_short > 0 || !!s.shortage_grade);
}

interface ShortageRow {
  sale_order_id: string;
  order_number: string | null;
  managed_lines: number | string | null;
  short_lines: number | string | null;
  shortages: unknown;
}

/**
 * Uma RPC para todos os PVs pedidos (sem N+1). PV sem linha na resposta não
 * entra no mapa → sem selo.
 *
 * `refetchInterval`: telas que ficam abertas (Kanban da fábrica) passam o piso de
 * frescor delas — a key só muda quando muda o conjunto de PVs, então sem isso o
 * selo "Falta material" nunca virava "Material completo" depois de uma entrada.
 * Entradas de estoque, rateio e mudança de status do PV também invalidam a raiz
 * (`saleOrderMaterialShortagesRoot`).
 */
export function useSaleOrderMaterialShortages(
  ids: Array<string | null | undefined> | undefined,
  options?: { refetchInterval?: number | false },
) {
  const sortedKey = useMemo(() => {
    if (!ids || ids.length === 0) return '';
    return [...new Set(ids.filter((id): id is string => !!id))].sort().join(',');
  }, [ids]);
  const idList = useMemo(() => (sortedKey ? sortedKey.split(',') : []), [sortedKey]);

  return useQuery({
    queryKey: [...saleOrderMaterialShortagesRoot, sortedKey],
    enabled: idList.length > 0,
    retry: false,
    staleTime: 30_000,
    refetchInterval: options?.refetchInterval ?? false,
    placeholderData: prev => prev,
    queryFn: async (): Promise<Map<string, SaleOrderMaterialShortageInfo>> => {
      try {
        const { data, error } = await supabase.rpc(
          'list_sale_order_material_shortages' as never,
          { p_sale_order_ids: idList } as never,
        );
        if (error) return new Map();
        const map = new Map<string, SaleOrderMaterialShortageInfo>();
        for (const row of ((data ?? []) as unknown as ShortageRow[])) {
          if (!row?.sale_order_id) continue;
          map.set(row.sale_order_id, {
            orderNumber: row.order_number ?? null,
            managedLines: toNumber(row.managed_lines),
            shortLines: toNumber(row.short_lines),
            shortages: parseShortages(row.shortages),
          });
        }
        return map;
      } catch {
        // Degrada em silêncio — ver docblock.
        return new Map();
      }
    },
  });
}

/** Resumo em uma linha (tooltip do selo): "Falta material: 12 m de NAPA PRETO; …". */
export function shortageSummaryText(info: SaleOrderMaterialShortageInfo | null | undefined): string | null {
  const state = materialShortageStatus(info);
  if (!state || !info) return null;
  if (state === 'completo') return 'Material completo — todo o material do PV está empenhado.';
  if (info.shortages.length === 0) {
    return `Falta material em ${info.shortLines} ${info.shortLines === 1 ? 'linha' : 'linhas'} do PV.`;
  }
  const parts = info.shortages.slice(0, 4).map(line => {
    const grade = formatShortageGrade(line.shortage_grade);
    return `${formatShortageQuantity(line.quantity_short, line.unit)} de ${shortageMaterialLabel(line)}${grade ? ` (nº ${grade})` : ''}`;
  });
  const rest = info.shortages.length - parts.length;
  return `Falta material: ${parts.join('; ')}${rest > 0 ? `; e mais ${rest}` : ''}.`;
}

/** Quantas linhas de falta entram no aviso de apontamento antes de resumir. */
const POINTING_WARNING_MAX_LINES = 6;

/**
 * Avisos de falta para o `ConfirmPointingWarnings` do Kanban — no formato
 * "Falta 12 m de NAPA PRETO — o setor vai iniciar com material parcial".
 *
 * ⚠ São avisos do CLIENTE: os `code` começam com `pv_material_falta` e NUNCA
 * vão em `confirmedWarnings` da RPC de apontamento (o servidor tem os seus).
 *
 * Esta é a formatação ÚNICA: serve tanto à lista por PV
 * (`buildShortagePointingWarnings`) quanto à lista já filtrada por setor
 * (`useOrderSectorMaterialShortage`).
 */
export function buildShortageWarningsFromLines(
  lines: MaterialShortageLine[] | null | undefined,
): { code: string; message: string }[] {
  const list = lines ?? [];
  if (list.length === 0) return [];
  const shown = list.slice(0, POINTING_WARNING_MAX_LINES).map((line, i) => {
    const grade = formatShortageGrade(line.shortage_grade);
    return {
      code: `pv_material_falta_${i}`,
      message: `Falta ${formatShortageQuantity(line.quantity_short, line.unit)} de ${shortageMaterialLabel(line)}`
        + `${grade ? ` (nº ${grade})` : ''} — o setor vai iniciar com material parcial.`,
    };
  });
  const rest = list.length - shown.length;
  if (rest > 0) {
    shown.push({
      code: 'pv_material_falta_mais',
      message: `E mais ${rest} ${rest === 1 ? 'material' : 'materiais'} em falta neste PV.`,
    });
  }
  return shown;
}

/**
 * Avisos de falta do PV INTEIRO (todo setor pergunta). Mantido com a assinatura
 * e o comportamento originais para quem ainda olha o PV; o Kanban usa a versão
 * por setor. Delega a formatação a `buildShortageWarningsFromLines`.
 */
export function buildShortagePointingWarnings(
  info: SaleOrderMaterialShortageInfo | null | undefined,
): { code: string; message: string }[] {
  if (materialShortageStatus(info) !== 'falta' || !info) return [];
  const lines = info.shortages;
  if (lines.length === 0) {
    return [{
      code: 'pv_material_falta',
      message: `${info.shortLines} ${info.shortLines === 1 ? 'material está' : 'materiais estão'} em falta neste PV — o setor vai iniciar com material parcial.`,
    }];
  }
  return buildShortageWarningsFromLines(lines);
}

export const orderSectorMaterialShortagesRoot = ['order-sector-material-shortages'] as const;

function parseSectorShortages(raw: unknown): SectorMaterialShortageLine[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map(s => ({
      product_id: (s.product_id as string) ?? null,
      product_name: String(s.product_name ?? 'Material'),
      color: (s.color as string) ?? null,
      unit: (s.unit as string) ?? null,
      quantity_short: toNumber(s.quantity_short),
      shortage_grade: parseGrade(s.shortage_grade),
      consumption_sector: (s.consumption_sector as string) ?? null,
      sector_source: String(s.sector_source ?? 'desconhecido'),
    }))
    .filter(s => s.quantity_short > 0 || !!s.shortage_grade);
}

const EMPTY_SECTOR_LINES: SectorMaterialShortageLine[] = [];

export interface OrderSectorMaterialShortage {
  /** Linhas em falta que ESTE setor consome (+ as de setor indeterminado). */
  lines: SectorMaterialShortageLine[];
  /**
   * A RPC não respondeu por FALHA (função ainda não aplicada, permissão, rede)
   * — diferente de "nenhuma falta neste setor". Quem chama tem que cair no
   * aviso por PV; `[]` aqui significaria "pode apontar" em TODO setor.
   */
  unavailable: boolean;
  isLoading: boolean;
}

/**
 * Falta de material da OP **que o setor apontado consome** — RPC
 * `list_order_sector_material_shortages(uuid, text)` (mig `20270101037800`).
 *
 * Pedido do dono (11/10/2026): "nos setores que não utilizam o material deve
 * passar sem perguntar". O selo do card segue sendo do PV; só a CONFIRMAÇÃO do
 * apontamento passa a ser por setor.
 *
 * O servidor devolve também as linhas de setor INDETERMINADO (fail-safe) — quem
 * decide o que esconder é a RPC, não esta camada: aqui não se filtra nada.
 *
 * ⚠ Falha NÃO é "sem falta". Degrada em silêncio no sentido de não toastar e
 * não travar (`retry:false` + `meta.silentError`), mas devolve
 * `unavailable: true` em vez de lista vazia: o deploy da Vercel é automático no
 * push e as migrations desta base são aplicadas À MÃO, então existe uma janela
 * real em que a função não existe no banco. Nessa janela um `[]` faria o Kanban
 * INTEIRO parar de perguntar sobre falta de material, em todo setor e em toda
 * OP, sem nada na tela dizendo isso. Com `unavailable` os diálogos voltam ao
 * aviso por PV (`buildShortagePointingWarnings`) — pergunta demais, que é o
 * comportamento de antes, e não pergunta de menos.
 *
 * ⚠ `staleTime`/`gcTime` = 0 DE PROPÓSITO: esta query porteia uma escrita
 * permanente no ledger (a nota "ciente da falta" do apontamento). Servir uma
 * resposta velha faria o operador confirmar falta de material que o almoxarifado
 * já quitou — com o selo do card, na mesma tela, dizendo "Material completo".
 * Cada abertura de diálogo revalida; carregando = sem aviso (ver os diálogos).
 */
export function useOrderSectorMaterialShortage(
  orderId: string | null | undefined,
  stageName: string | null | undefined,
  enabled: boolean = true,
): OrderSectorMaterialShortage {
  // A key normaliza o setor pela MESMA tabela de aliases do resto da produção
  // ('Corte Fibra' ⇄ 'Palmilha · Fibra'): sem isso duas grafias do mesmo setor
  // viram duas entradas de cache com a mesma resposta.
  const stageKey = canonicalStageName(stageName || '');
  const shouldFetch = !!enabled && !!orderId && !!stageKey;

  const query = useQuery({
    queryKey: [...orderSectorMaterialShortagesRoot, orderId ?? '', stageKey],
    enabled: shouldFetch,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    // Sem isto o `QueryCache.onError` global (App.tsx) tostaria a falha.
    meta: { silentError: true },
    queryFn: async (): Promise<SectorMaterialShortageLine[]> => {
      const { data, error } = await supabase.rpc(
        'list_order_sector_material_shortages' as never,
        { p_order_id: orderId, p_stage_name: stageName } as never,
      );
      // `throw` → `isError` → `unavailable` → o chamador usa o aviso por PV.
      if (error) throw error;
      return parseSectorShortages(data);
    },
  });

  return {
    lines: query.data ?? EMPTY_SECTOR_LINES,
    unavailable: query.isError,
    isLoading: query.isLoading,
  };
}
