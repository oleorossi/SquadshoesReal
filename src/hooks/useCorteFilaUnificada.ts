/**
 * Fila de Corte unificada — bloco 1 (WIP), confirmar corte, entrar em produção, reuso.
 * Spec: specs/fila-corte-unificada.md
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  corteCutKindFromSector,
  type CorteCutKind,
  type CorteLookaheadSector,
} from '@/lib/corteLookahead';
import { corteLookaheadKeys } from '@/hooks/useCorteLookahead';

export interface CorteWipRow {
  orderId: string;
  orderNumber: string;
  saleOrderId: string | null;
  saleOrderNumber: string | null;
  clientName: string;
  referenceName: string;
  color: string;
  pairs: number;
  stageName: string;
  stageStatus: string;
  isAhead: boolean;
  corteUnlocked: boolean;
  allCutsDone: boolean;
}

export interface CorteCutPieceRow {
  id: string;
  cutKind: CorteCutKind;
  referenceId: string;
  colorNorm: string;
  materialVariantId: string | null;
  pairsOriginal: number;
  pairsAvailable: number;
  originalGrade: unknown;
  sourceOrderId: string | null;
  sourceSaleOrderItemId: string | null;
  status: string;
  createdAt: string;
}

export const corteFilaKeys = {
  wip: (sector: string) => ['corte-fila-wip', sector] as const,
  pieces: ['corte-cut-pieces'] as const,
  ready: ['corte-fila-ready'] as const,
};

async function loadCorteWip(sector: CorteLookaheadSector): Promise<CorteWipRow[]> {
  const { data, error } = await supabase.rpc(
    'list_corte_wip_for_sector' as never,
    { p_sector: sector } as never,
  );
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  return rows.map((r) => ({
    orderId: String(r.order_id),
    orderNumber: String(r.order_number || ''),
    saleOrderId: r.sale_order_id ? String(r.sale_order_id) : null,
    saleOrderNumber: r.sale_order_number ? String(r.sale_order_number) : null,
    clientName: String(r.client_name || ''),
    referenceName: String(r.reference_name || ''),
    color: String(r.color || ''),
    pairs: Number(r.pairs) || 0,
    stageName: String(r.stage_name || ''),
    stageStatus: String(r.stage_status || ''),
    isAhead: Boolean(r.is_ahead),
    corteUnlocked: Boolean(r.corte_unlocked),
    allCutsDone: Boolean(r.all_cuts_done),
  }));
}

export function useCorteWip(sector: CorteLookaheadSector) {
  return useQuery({
    queryKey: corteFilaKeys.wip(sector),
    queryFn: () => loadCorteWip(sector),
    staleTime: 20_000,
  });
}

export function useConfirmCorteStage(sector: CorteLookaheadSector) {
  const qc = useQueryClient();
  const kind = corteCutKindFromSector(sector);
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.rpc(
        'confirm_corte_ahead_stage' as never,
        { p_order_id: orderId, p_cut_kind: kind } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: corteFilaKeys.wip(sector) });
      void qc.invalidateQueries({ queryKey: ['production_queue_detail'] });
      toast.success('Corte confirmado — estoque debitado.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Falha ao confirmar corte');
    },
  });
}

export function useEnterCorteAheadProduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderIds: string[]) => {
      const { data, error } = await supabase.rpc(
        'enter_corte_ahead_production' as never,
        { p_order_ids: orderIds } as never,
      );
      if (error) throw error;
      return data as { ok?: boolean; unlocked?: number; skipped?: unknown };
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['corte-fila-wip'] });
      void qc.invalidateQueries({ queryKey: ['production_queue_detail'] });
      const n = Number(data?.unlocked) || 0;
      toast.success(
        n === 1
          ? '1 OP liberada para produção.'
          : `${n} OPs liberadas para produção.`,
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Falha ao entrar em produção');
    },
  });
}

async function loadCutPieces(): Promise<CorteCutPieceRow[]> {
  const { data, error } = await supabase.rpc(
    'list_corte_cut_pieces_available' as never,
  );
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    cutKind: r.cut_kind as CorteCutKind,
    referenceId: String(r.reference_id),
    colorNorm: String(r.color_norm || ''),
    materialVariantId: r.material_variant_id ? String(r.material_variant_id) : null,
    pairsOriginal: Number(r.pairs_original) || 0,
    pairsAvailable: Number(r.pairs_available) || 0,
    originalGrade: r.original_grade,
    sourceOrderId: r.source_order_id ? String(r.source_order_id) : null,
    sourceSaleOrderItemId: r.source_sale_order_item_id
      ? String(r.source_sale_order_item_id)
      : null,
    status: String(r.status || ''),
    createdAt: String(r.created_at || ''),
  }));
}

export function useCorteCutPieces() {
  return useQuery({
    queryKey: corteFilaKeys.pieces,
    queryFn: loadCutPieces,
    staleTime: 20_000,
  });
}

export function useAllocateCorteCutPiece() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      pieceId: string;
      saleOrderItemId: string;
      pairs: number;
    }) => {
      const { data, error } = await supabase.rpc(
        'allocate_corte_cut_piece' as never,
        {
          p_piece_id: input.pieceId,
          p_sale_order_item_id: input.saleOrderItemId,
          p_pairs: input.pairs,
        } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: corteFilaKeys.pieces });
      void qc.invalidateQueries({ queryKey: corteLookaheadKeys.all });
      void qc.invalidateQueries({ queryKey: ['production_queue_detail'] });
      toast.success('Peça cortada vinculada ao pedido.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Falha ao reutilizar peça cortada');
    },
  });
}
