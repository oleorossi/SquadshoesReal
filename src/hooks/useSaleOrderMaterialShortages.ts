import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
  const shown = lines.slice(0, POINTING_WARNING_MAX_LINES).map((line, i) => {
    const grade = formatShortageGrade(line.shortage_grade);
    return {
      code: `pv_material_falta_${i}`,
      message: `Falta ${formatShortageQuantity(line.quantity_short, line.unit)} de ${shortageMaterialLabel(line)}`
        + `${grade ? ` (nº ${grade})` : ''} — o setor vai iniciar com material parcial.`,
    };
  });
  const rest = lines.length - shown.length;
  if (rest > 0) {
    shown.push({
      code: 'pv_material_falta_mais',
      message: `E mais ${rest} ${rest === 1 ? 'material' : 'materiais'} em falta neste PV.`,
    });
  }
  return shown;
}
