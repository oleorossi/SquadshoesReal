import React, { useMemo, useState } from 'react';
import ServiceOrderReturnDialog from '@/components/contractors/ServiceOrderReturnDialog';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Truck, ArrowSquareOut, Buildings, Funnel, Warning as AlertTriangle,
  CurrencyDollar as DollarSign, Package as Boxes, X, CheckCircle, Clock,
  Calendar, DotsThreeVertical, Printer, CaretRight, Palette, Flask as FlaskConical,
  Ruler, Plus, Camera, ChartBar as BarChart3, Receipt,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Link } from 'react-router-dom';
import { cn, formatCurrency } from '@/lib/utils';
import { ServiceOrderFormDialog } from '@/components/contractors/ServiceOrderFormDialog';
import { LancamentoAvulsoDialog } from '@/components/avulso/LancamentoAvulsoDialog';
import { SignedReceiptUploadDialog } from '@/components/contractors/SignedReceiptUploadDialog';
import { printServiceOrderReceipt } from '@/lib/printServiceOrderReceipt';
import { useContractors } from '@/hooks/useContractors';
import {
  useOutsourcedInField, useReceiveOutsourcedItem, useExtendOutsourcedDeadline,
  type OutsourcedItem, type MaterialSent,
} from '@/hooks/useOutsourcedInField';
import { SECTOR_LABEL, type SectorKey } from '@/hooks/useSectorBottlenecks';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de formatação
// ─────────────────────────────────────────────────────────────────────────────

function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

const sectorLabel = (sector: string): string =>
  SECTOR_LABEL[sector as SectorKey] ?? sector;

// Status visual derivado: "Atrasado +Nd" | "Vence hoje" | "Vence em Nd" | "No prazo"
type DeadlineState = { kind: 'late' | 'today' | 'soon' | 'ok' | 'unknown'; label: string };

function deadlineState(item: OutsourcedItem): DeadlineState {
  if (item.days_late > 0) {
    return { kind: 'late', label: `Atrasado +${item.days_late}d` };
  }
  const d = daysUntil(item.expected_back);
  if (d === null) return { kind: 'unknown', label: 'Sem prazo' };
  if (d === 0) return { kind: 'today', label: 'Vence hoje' };
  if (d <= 7) return { kind: 'soon', label: `Vence em ${d}d` };
  return { kind: 'ok', label: 'No prazo' };
}

const STATE_STYLE: Record<DeadlineState['kind'], string> = {
  late:    'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
  today:   'bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-400',
  soon:    'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
  ok:      'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400',
  unknown: 'bg-muted text-muted-foreground border-border',
};

// ─────────────────────────────────────────────────────────────────────────────
// Breakdown ao expandir uma linha — 3 casos suportados pela view v2
// ─────────────────────────────────────────────────────────────────────────────
// (A) materials_sent[] populado → cada material/cor/metros enviado
// (B) is_artisanal=true sem materials_sent → mostra a receita (output + base)
// (C) order_grade preenchido → mostra grade da OP (numerações × pares)
// (D) tudo vazio → não dá pra expandir (canExpand=false)
// ─────────────────────────────────────────────────────────────────────────────
type BreakdownData =
  | { kind: 'empty' }
  | { kind: 'materials';  rows: MaterialSent[] }
  | { kind: 'artisanal';  output: { name: string; color: string; meters: number }; base: { color: string; forOrder: number; forStock: number } }
  | { kind: 'grade';      rows: Array<{ size: string; pairs: number }>; color: string };

function breakdownRows(it: OutsourcedItem): BreakdownData {
  // (A) materials_sent populado tem prioridade — é o dado mais explícito
  if (Array.isArray(it.materials_sent) && it.materials_sent.length > 0) {
    return { kind: 'materials', rows: it.materials_sent };
  }
  // (B) artesanal: receita
  if (it.is_artisanal && (it.artisanal_output_name || it.artisanal_output_color)) {
    return {
      kind: 'artisanal',
      output: {
        name:   it.artisanal_output_name   || it.material_name || '—',
        color:  it.artisanal_output_color  || it.material_color || '—',
        meters: Number(it.artisanal_output_meters || 0),
      },
      base: {
        color:    it.artisanal_base_color || '—',
        forOrder: Number(it.artisanal_for_order_meters || 0),
        forStock: Number(it.artisanal_for_stock_meters || 0),
      },
    };
  }
  // (C) grade da OP
  if (it.order_grade && typeof it.order_grade === 'object') {
    const entries = Object.entries(it.order_grade)
      .map(([size, qty]) => ({ size, pairs: Number(qty || 0) }))
      .filter((r) => r.pairs > 0)
      // ordem natural por número quando possível
      .sort((a, b) => {
        const na = Number(a.size); const nb = Number(b.size);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return a.size.localeCompare(b.size);
      });
    if (entries.length > 0) {
      return { kind: 'grade', rows: entries, color: it.color || '—' };
    }
  }
  return { kind: 'empty' };
}

function BreakdownPanel({ item, breakdown }: { item: OutsourcedItem; breakdown: BreakdownData }) {
  return (
    <div className="px-6 py-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">
            Composição enviada
          </div>
          <div className="text-xs text-muted-foreground">
            Detalhe do que está com <strong className="text-foreground">{item.contractor_name}</strong>.
          </div>
        </div>
        {item.description && (
          <div className="text-[11px] text-muted-foreground italic max-w-md truncate" title={item.description}>
            {item.description}
          </div>
        )}
      </div>

      {breakdown.kind === 'materials' && <MaterialsBreakdown rows={breakdown.rows} />}
      {breakdown.kind === 'artisanal' && <ArtisanalBreakdown {...breakdown} />}
      {breakdown.kind === 'grade'     && <GradeBreakdown rows={breakdown.rows} color={breakdown.color} totalPairs={item.pairs} />}

      {item.notes && (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground whitespace-pre-wrap">
          <span className="font-semibold text-foreground">Observações: </span>
          {item.notes}
        </div>
      )}
    </div>
  );
}

function MaterialsBreakdown({ rows }: { rows: MaterialSent[] }) {
  // Agrupa por (material × cor) somando metros — guarda contra duplicatas
  const grouped = useMemo(() => {
    const map = new Map<string, MaterialSent & { _key: string }>();
    for (const r of rows) {
      const k = `${(r.material || '—').trim()}|${(r.color || '—').trim()}`;
      const cur = map.get(k);
      if (cur) cur.meters += Number(r.meters || 0);
      else map.set(k, { _key: k, material: r.material || '—', color: r.color || '—', meters: Number(r.meters || 0) });
    }
    return [...map.values()].sort((a, b) => a.material.localeCompare(b.material) || a.color.localeCompare(b.color));
  }, [rows]);
  const totalMeters = grouped.reduce((s, r) => s + r.meters, 0);

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
        <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
          <Palette className="h-3 w-3" />
          Materiais enviados ({grouped.length})
        </span>
        <span className="text-xs mono tabular-nums text-muted-foreground">
          Total: <strong className="text-foreground">{totalMeters.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m</strong>
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/20 text-muted-foreground">
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Material</th>
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Cor</th>
            <th className="text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Metros</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {grouped.map((r) => (
            <tr key={r._key} className="hover:bg-muted/30">
              <td className="px-3 py-1.5">{r.material}</td>
              <td className="px-3 py-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-muted" aria-hidden />
                  {r.color}
                </span>
              </td>
              <td className="px-3 py-1.5 text-right mono tabular-nums">
                {r.meters.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArtisanalBreakdown({
  output, base,
}: { output: { name: string; color: string; meters: number }; base: { color: string; forOrder: number; forStock: number } }) {
  const totalBase = base.forOrder + base.forStock;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Output (cor produzida) */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-emerald-500/5 flex items-center gap-2">
          <FlaskConical className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
          <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-emerald-700 dark:text-emerald-400">
            Cor a produzir
          </span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Material</span>
            <span className="text-sm font-semibold">{output.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Cor final</span>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-muted" aria-hidden />
              {output.color}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border/60">
            <span className="text-xs text-muted-foreground">Metros a tingir</span>
            <span className="mono font-bold text-base tabular-nums text-emerald-700 dark:text-emerald-400">
              {output.meters.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m
            </span>
          </div>
        </div>
      </div>

      {/* Base (cor enviada) */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-amber-500/5 flex items-center gap-2">
          <Palette className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
          <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-amber-700 dark:text-amber-400">
            Base enviada
          </span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Cor base</span>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-muted" aria-hidden />
              {base.color}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Pra esse pedido</span>
            <span className="mono tabular-nums text-sm">
              {base.forOrder.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Pra estoque</span>
            <span className="mono tabular-nums text-sm">
              {base.forStock.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border/60">
            <span className="text-xs text-muted-foreground">Total enviado</span>
            <span className="mono font-bold text-base tabular-nums text-amber-700 dark:text-amber-400">
              {totalBase.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GradeBreakdown({
  rows, color, totalPairs,
}: { rows: Array<{ size: string; pairs: number }>; color: string; totalPairs: number }) {
  const sumGrade = rows.reduce((s, r) => s + r.pairs, 0);
  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
        <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
          <Ruler className="h-3 w-3" />
          Grade da OP · cor {color}
        </span>
        <span className="text-xs mono tabular-nums text-muted-foreground">
          Total: <strong className="text-foreground">{sumGrade.toLocaleString('pt-BR')} pares</strong>
          {sumGrade !== totalPairs && totalPairs > 0 && (
            <span className="text-amber-600 dark:text-amber-400 ml-1">
              (OS: {totalPairs.toLocaleString('pt-BR')})
            </span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2 p-3">
        {rows.map((r) => (
          <div
            key={r.size}
            className="flex flex-col items-center justify-center rounded-md border border-border bg-muted/20 px-2 py-2 text-center"
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {r.size}
            </span>
            <span className="mono font-bold text-base tabular-nums text-foreground leading-tight">
              {r.pairs}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function OutsourcedInFieldPage({ embedded }: { embedded?: boolean } = {}) {
  const { data: items = [], isLoading } = useOutsourcedInField();
  const { data: contractors = [] } = useContractors();
  const receiveItem = useReceiveOutsourcedItem();
  const extendDeadline = useExtendOutsourcedDeadline();

  // Dialogs novos
  const [createOpen, setCreateOpen] = useState(false);
  const [createContractorId, setCreateContractorId] = useState<string | undefined>(undefined);
  const [avulsoOpen, setAvulsoOpen] = useState(false);
  const [photoItem, setPhotoItem] = useState<OutsourcedItem | null>(null);

  // Filtros locais
  const [contractorFilter, setContractorFilter] = useState<string | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [onlyLate, setOnlyLate] = useState(false);

  // Dialog de prorrogação
  const [extendItem, setExtendItem] = useState<OutsourcedItem | null>(null);
  const [newDeadline, setNewDeadline] = useState('');

  // Expand de linha — chave = `${source}:${id}`
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Agregação por contractor
  type ContractorBucket = {
    contractor_id: string;
    contractor_name: string;
    items: OutsourcedItem[];
    total_pairs: number;
    total_value: number;
    late_count: number;
  };

  const byContractor = useMemo<ContractorBucket[]>(() => {
    const map = new Map<string, ContractorBucket>();
    for (const it of items) {
      const key = it.contractor_id || 'sem-contractor';
      if (!map.has(key)) {
        map.set(key, {
          contractor_id: key,
          contractor_name: it.contractor_name || 'Sem contratada',
          items: [],
          total_pairs: 0,
          total_value: 0,
          late_count: 0,
        });
      }
      const b = map.get(key)!;
      b.items.push(it);
      b.total_pairs += Number(it.pairs || 0);
      b.total_value += Number(it.total_value || 0);
      if (it.days_late > 0) b.late_count += 1;
    }
    return [...map.values()].sort((a, b) => {
      if (b.late_count !== a.late_count) return b.late_count - a.late_count;
      return b.total_pairs - a.total_pairs;
    });
  }, [items]);

  // KPIs do topo
  const summary = useMemo(() => {
    const distinctContractors = new Set(items.map((i) => i.contractor_id)).size;
    return {
      total_items: items.length,
      total_pairs: items.reduce((s, i) => s + Number(i.pairs || 0), 0),
      total_value: items.reduce((s, i) => s + Number(i.total_value || 0), 0),
      late_count: items.filter((i) => i.days_late > 0).length,
      distinct_contractors: distinctContractors,
    };
  }, [items]);

  // Tabela: aplica filtros + sort
  // Saldo na rua REAL por OS (Fase 1 facção): enviado − devolvido.
  // v_service_order_balance ainda não está no types.ts (regenerar depois).
  const soIds = useMemo(
    () => items.filter(i => i.source === 'service_order').map(i => i.id),
    [items],
  );
  const { data: balances = [] } = useQuery({
    queryKey: ['so_balances', soIds.sort().join(',')],
    enabled: soIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_service_order_balance')
        .select('service_order_id, qty_sent, qty_returned_good, qty_returned_defect, qty_loss, qty_in_field')
        .in('service_order_id', soIds);
      if (error) throw error;
      return data as Array<{ service_order_id: string; qty_sent: number; qty_returned_good: number; qty_returned_defect: number; qty_loss: number; qty_in_field: number }>;
    },
    staleTime: 30_000,
  });
  const balanceById = useMemo(() => new Map(balances.map(b => [b.service_order_id, b])), [balances]);

  const filtered = useMemo(() => {
    let arr = items;
    // OS com saldo zerado (tudo devolvido) não está mais "na rua" — a view
    // legada ainda lista até o status virar finalizado; o saldo é a verdade.
    arr = arr.filter((i) => {
      if (i.source !== 'service_order') return true;
      const bal = balanceById.get(i.id);
      return !bal || Number(bal.qty_in_field) > 0;
    });
    if (contractorFilter) arr = arr.filter((i) => i.contractor_id === contractorFilter);
    if (sectorFilter !== 'all') arr = arr.filter((i) => i.sector === sectorFilter);
    if (statusFilter !== 'all') {
      arr = arr.filter((i) => {
        const k = deadlineState(i).kind;
        if (statusFilter === 'late')  return k === 'late';
        if (statusFilter === 'today') return k === 'today';
        if (statusFilter === 'soon')  return k === 'soon' || k === 'today';
        if (statusFilter === 'ok')    return k === 'ok';
        return true;
      });
    }
    if (onlyLate) arr = arr.filter((i) => i.days_late > 0);
    // sort por prazo asc (sem prazo no fim), depois enviado asc
    return [...arr].sort((a, b) => {
      const ax = a.expected_back ? new Date(a.expected_back).getTime() : Number.POSITIVE_INFINITY;
      const bx = b.expected_back ? new Date(b.expected_back).getTime() : Number.POSITIVE_INFINITY;
      if (ax !== bx) return ax - bx;
      const ay = a.sent_at ? new Date(a.sent_at).getTime() : 0;
      const by = b.sent_at ? new Date(b.sent_at).getTime() : 0;
      return ay - by;
    });
  }, [items, contractorFilter, sectorFilter, statusFilter, onlyLate, balanceById]);

  const clearFilters = () => {
    setContractorFilter(null);
    setSectorFilter('all');
    setStatusFilter('all');
    setOnlyLate(false);
  };

  const hasFilters = contractorFilter || sectorFilter !== 'all' || statusFilter !== 'all' || onlyLate;



  // Fase 1 facção: OS terceirizada recebe via REGISTRO DE RETORNO (parcial,
  // bons/defeito/perda) — o banco fecha a OS e gera a conta a pagar pelos
  // pares bons. OPs legadas (outsourced_op) mantêm o fluxo antigo.
  const [returnItem, setReturnItem] = useState<OutsourcedItem | null>(null);
  const handleReceive = (item: OutsourcedItem) => {
    if (item.source === 'service_order') {
      setReturnItem(item);
      return;
    }
    if (!confirm(`Marcar OP ${item.op_number} como recebida da terceirizada?`)) return;
    receiveItem.mutate(item);
  };

  const openExtendDialog = (item: OutsourcedItem) => {
    if (item.source !== 'service_order') {
      alert('OPs terceirizadas pré-produção têm seu prazo controlado pela data de entrega da OP em /orders.');
      return;
    }
    setExtendItem(item);
    setNewDeadline(item.expected_back || new Date().toISOString().slice(0, 10));
  };

  const confirmExtend = async () => {
    if (!extendItem || !newDeadline) return;
    await extendDeadline.mutateAsync({ item: extendItem, newDeadline });
    setExtendItem(null);
    setNewDeadline('');
  };

  const handlePrintReceipt = (it: OutsourcedItem) => {
    const c = contractors.find((x: any) => x.id === it.contractor_id) as any;
    printServiceOrderReceipt(
      {
        id: it.id,
        order_number: it.op_number,
        description: it.description ?? null,
        service_date: it.sent_at,
        quoted_deadline: it.expected_back,
        quantity: it.pairs,
        unit_price: it.unit_price,
        total_value: it.total_value,
        notes: it.notes ?? null,
        materials_sent: Array.isArray(it.materials_sent) ? it.materials_sent : [],
        status: it.status,
        target_sector: it.sector,
        op_number: it.op_number,
        sale_order_number: it.sale_order_number,
        client_name: it.client_name,
      },
      {
        name: c?.name || it.contractor_name,
        trade_name: c?.trade_name,
        cnpj_cpf: c?.cnpj_cpf,
        phone: c?.phone,
        email: c?.email,
        address: c?.address,
        city: c?.city,
        state: c?.state,
      },
    );
  };

  const openCreate = (contractorId?: string) => {
    setCreateContractorId(contractorId);
    setCreateOpen(true);
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        Carregando itens em produção externa...
      </div>
    );
  }

  return (
    <div className={cn('space-y-5', !embedded && 'page-enter')}>
      {embedded ? (
        // No hub /terceiros: header vem do hub; aqui só a ação crítica "Nova OS"
        // (o link "Relatórios" virou aba do hub).
        <div className="flex justify-end gap-2">
          <Button onClick={() => setAvulsoOpen(true)} size="sm" variant="outline" className="h-9 gap-1.5">
            <Receipt className="h-3.5 w-3.5" />
            Lançar OS Avulsa
          </Button>
          <Button onClick={() => openCreate()} size="sm" className="h-9 gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Nova OS
          </Button>
        </div>
      ) : (
        <EditorialPageHeader
          sectionLabel="PRODUÇÃO · TERCEIRIZAÇÃO · NA RUA"
          title="Terceiros na Rua"
          description="Tudo o que está fora da fábrica agora — OSs de gargalo + OPs inteiras terceirizadas. Acompanhe prazo, atraso e recebimento num único lugar."
          actions={
            <>
              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
                <Link to="/terceiros?tab=relatorio">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Relatórios
                </Link>
              </Button>
              <Button onClick={() => setAvulsoOpen(true)} size="sm" variant="outline" className="h-9 gap-1.5">
                <Receipt className="h-3.5 w-3.5" />
                Lançar OS Avulsa
              </Button>
              <Button onClick={() => openCreate()} size="sm" className="h-9 gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Nova OS
              </Button>
            </>
          }
        />
      )}

      {/* KPIs */}
      <StatGrid>
        <StatCard
          label="Itens na rua"
          value={summary.total_items}
          icon={Truck}
          hint={`em ${summary.distinct_contractors} ${summary.distinct_contractors === 1 ? 'contratada' : 'contratadas'}`}
        />
        <StatCard
          label="Pares na rua"
          value={summary.total_pairs.toLocaleString('pt-BR')}
          icon={Boxes}
          hint="total agregado"
        />
        <StatCard
          label="Em produção externa"
          value={formatCurrency(summary.total_value)}
          icon={DollarSign}
          hint="somente OSs com valor"
        />
        <StatCard
          label="Atrasados"
          value={summary.late_count}
          icon={AlertTriangle}
          tone={summary.late_count > 0 ? 'destructive' : 'default'}
          hint="prazo vencido"
        />
      </StatGrid>

      {/* Cards-resumo por contractor (clicáveis) */}
      {byContractor.length > 0 && (
        <Panel
          eyebrow="Por contratada"
          title="Carga em produção externa"
          subtitle="Clique num card pra filtrar a tabela. Clique novamente pra desfiltrar."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {byContractor.map((b) => {
              const selected = contractorFilter === b.contractor_id;
              return (
                <button
                  key={b.contractor_id}
                  type="button"
                  onClick={() =>
                    setContractorFilter(selected ? null : b.contractor_id)
                  }
                  className={cn(
                    'group relative bg-card border rounded-lg p-3 text-left transition-all duration-200',
                    'hover:border-foreground/40 hover:-translate-y-0.5',
                    selected
                      ? 'border-foreground shadow-[0_0_0_2px_var(--ring)] ring-2 ring-foreground/15'
                      : 'border-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="shrink-0 h-7 w-7 -mt-0.5 flex items-center justify-center bg-muted text-muted-foreground rounded-md">
                        <Buildings className="h-4 w-4" />
                      </span>
                      <span
                        className="text-sm font-semibold truncate"
                        title={b.contractor_name}
                      >
                        {b.contractor_name}
                      </span>
                    </div>
                    {b.late_count > 0 && (
                      <Badge
                        variant="outline"
                        className={cn(STATE_STYLE.late, 'text-xs whitespace-nowrap')}
                      >
                        {b.late_count} atrasado{b.late_count > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">OSs</div>
                      <div className="mono font-semibold text-sm tabular-nums">
                        {b.items.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Pares</div>
                      <div className="mono font-semibold text-sm tabular-nums">
                        {b.total_pairs.toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">R$</div>
                      <div className="mono font-semibold text-sm tabular-nums truncate" title={formatCurrency(b.total_value)}>
                        {b.total_value > 0
                          ? Intl.NumberFormat('pt-BR', {
                              notation: 'compact',
                              style: 'currency',
                              currency: 'BRL',
                              maximumFractionDigits: 1,
                            }).format(b.total_value)
                          : '—'}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Toolbar de filtros */}
      <Panel
        title="Itens em produção externa"
        subtitle={
          contractorFilter
            ? `Filtrado por ${byContractor.find(b => b.contractor_id === contractorFilter)?.contractor_name ?? '—'}`
            : `${filtered.length} ${filtered.length === 1 ? 'item' : 'itens'}`
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Funnel className="h-4 w-4 text-muted-foreground" />
            <Select value={sectorFilter} onValueChange={setSectorFilter}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue placeholder="Setor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os setores</SelectItem>
                <SelectItem value="costura">Costura</SelectItem>
                <SelectItem value="mesa">Aviamento</SelectItem>
                <SelectItem value="corte_palmilha">Corte Palmilha</SelectItem>
                <SelectItem value="corte_forracao">Corte Forração</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[150px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="late">Atrasados</SelectItem>
                <SelectItem value="today">Vence hoje</SelectItem>
                <SelectItem value="soon">Vence em até 7d</SelectItem>
                <SelectItem value="ok">No prazo</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={onlyLate ? 'default' : 'outline'}
              size="sm"
              className="h-9 text-xs gap-1"
              onClick={() => setOnlyLate(!onlyLate)}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {onlyLate ? 'Mostrando atrasados' : 'Só atrasados'}
            </Button>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs gap-1 text-muted-foreground"
                onClick={clearFilters}
              >
                <X className="h-3.5 w-3.5" />
                Limpar
              </Button>
            )}
          </div>
        }
        flush
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={hasFilters ? 'Nenhum item com esses filtros' : 'Nada em produção externa'}
            description={
              hasFilters
                ? 'Limpe os filtros pra ver todos os itens na rua.'
                : 'Quando você encaminhar OPs pra contratadas, elas aparecem aqui pra acompanhar prazo de retorno.'
            }
            action={hasFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead className="w-8"></TableHead>
                  <TableHead>OP</TableHead>
                  <TableHead>PV / Cliente</TableHead>
                  <TableHead>Modelo / Cor</TableHead>
                  <TableHead className="text-right">Pares</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>Contratada</TableHead>
                  <TableHead>Enviado</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((it) => {
                  const state = deadlineState(it);
                  const rowKey = `${it.source}:${it.id}`;
                  const isExpanded = expandedKeys.has(rowKey);
                  const breakdown = breakdownRows(it);
                  const canExpand = breakdown.kind !== 'empty';
                  return (
                    <React.Fragment key={rowKey}>
                      <TableRow
                        className={cn(
                          'hover:bg-muted/30',
                          canExpand && 'cursor-pointer',
                          isExpanded && 'bg-muted/40 border-b-0',
                        )}
                        onClick={(e) => {
                          // Não dispara expand ao clicar em botões/dropdown/links
                          if ((e.target as HTMLElement).closest('button, a, [role="menuitem"]')) return;
                          if (canExpand) toggleExpand(rowKey);
                        }}
                      >
                        <TableCell className="w-8 pr-0">
                          {canExpand ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 -ml-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(rowKey);
                              }}
                              aria-label={isExpanded ? 'Recolher detalhes' : 'Expandir detalhes'}
                            >
                              <CaretRight
                                className={cn(
                                  'h-3.5 w-3.5 transition-transform duration-200',
                                  isExpanded && 'rotate-90',
                                )}
                              />
                            </Button>
                          ) : (
                            <span className="inline-block h-6 w-6" aria-hidden />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {it.op_number}
                          {it.source === 'outsourced_op' && (
                            <Badge variant="outline" className="ml-1.5 h-4 text-[10px] uppercase tracking-wide">
                              OP int.
                            </Badge>
                          )}
                          {it.is_artisanal && (
                            <Badge variant="outline" className="ml-1.5 h-4 text-[10px] uppercase tracking-wide bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300">
                              <FlaskConical className="inline h-2.5 w-2.5 mr-0.5" />
                              Artesanal
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-mono">{it.sale_order_number}</div>
                          {it.client_name && (
                            <div className="text-muted-foreground truncate max-w-[160px]" title={it.client_name}>
                              {it.client_name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {it.sheet_name}
                          {it.color && (
                            <span className="text-muted-foreground"> · {it.color}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {(() => {
                            const bal = it.source === 'service_order' ? balanceById.get(it.id) : undefined;
                            if (!bal) return Number(it.pairs).toLocaleString('pt-BR');
                            const returned = bal.qty_returned_good + bal.qty_returned_defect + bal.qty_loss;
                            return (
                              <span title={`Enviado ${bal.qty_sent} · Devolvido ${returned}${bal.qty_returned_defect > 0 ? ` (${bal.qty_returned_defect} defeito)` : ''}${bal.qty_loss > 0 ? ` · ${bal.qty_loss} perda` : ''}`}>
                                {Number(bal.qty_in_field).toLocaleString('pt-BR')}
                                {returned > 0 && (
                                  <span className="text-muted-foreground"> / {bal.qty_sent}</span>
                                )}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-xs">{sectorLabel(it.sector)}</TableCell>
                        <TableCell className="text-xs">{it.contractor_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          <Calendar className="inline h-3 w-3 mr-1" />
                          {formatDateBR(it.sent_at)}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {it.expected_back ? formatDateBR(it.expected_back) : (
                            <span className="text-muted-foreground italic">sem prazo</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(STATE_STYLE[state.kind], 'text-xs whitespace-nowrap')}>
                            {state.kind === 'late' && <AlertTriangle className="inline h-3 w-3 mr-1" />}
                            {state.kind === 'ok' && <CheckCircle className="inline h-3 w-3 mr-1" />}
                            {(state.kind === 'today' || state.kind === 'soon') && <Clock className="inline h-3 w-3 mr-1" />}
                            {state.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">
                          {it.total_value && it.total_value > 0
                            ? formatCurrency(it.total_value)
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <DotsThreeVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => handleReceive(it)} className="text-xs gap-2">
                                <CheckCircle className="h-3.5 w-3.5" />
                                Marcar recebido
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setPhotoItem(it)}
                                className="text-xs gap-2"
                                disabled={it.source !== 'service_order'}
                              >
                                <Camera className="h-3.5 w-3.5" />
                                Anexar foto assinada
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openExtendDialog(it)}
                                className="text-xs gap-2"
                                disabled={it.source !== 'service_order'}
                              >
                                <Clock className="h-3.5 w-3.5" />
                                Prorrogar prazo
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handlePrintReceipt(it)}
                                className="text-xs gap-2"
                              >
                                <Printer className="h-3.5 w-3.5" />
                                Imprimir recibo (PDF)
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openCreate(it.contractor_id)}
                                className="text-xs gap-2"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Nova OS pra contratada
                              </DropdownMenuItem>
                              {it.sale_order_id && (
                                <DropdownMenuItem asChild>
                                  <a
                                    href={`/sales/${it.sale_order_id}`}
                                    className="text-xs gap-2 flex items-center"
                                  >
                                    <ArrowSquareOut className="h-3.5 w-3.5" />
                                    Abrir PV
                                  </a>
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                      {isExpanded && canExpand && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30 border-l-2 border-foreground">
                          <TableCell colSpan={12} className="p-0">
                            <BreakdownPanel item={it} breakdown={breakdown} />
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {/* Dialog: criar nova OS */}
      <ServiceOrderFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialContractorId={createContractorId}
      />

      {/* Dialog: lançar OS avulsa (serviço manual → financeiro) */}
      <LancamentoAvulsoDialog open={avulsoOpen} onOpenChange={setAvulsoOpen} mode="os" />

      {/* Dialog: anexar foto do recibo assinado */}
      <SignedReceiptUploadDialog
        open={!!photoItem}
        onOpenChange={(open) => !open && setPhotoItem(null)}
        serviceOrderId={photoItem?.source === 'service_order' ? photoItem.id : null}
        orderLabel={photoItem?.op_number ? `OS ${photoItem.op_number}` : undefined}
        contractorName={photoItem?.contractor_name}
        markAsReceived={true}
        onSuccess={() => setPhotoItem(null)}
      />

      {/* Dialog: prorrogar prazo */}
      <Dialog open={!!extendItem} onOpenChange={(open) => !open && setExtendItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Prorrogar prazo de entrega
            </DialogTitle>
            <DialogDescription>
              {extendItem && (
                <>
                  OS da OP <strong className="text-foreground">{extendItem.op_number}</strong>{' '}
                  com <strong className="text-foreground">{extendItem.contractor_name}</strong>.
                  {extendItem.expected_back && (
                    <span className="block mt-1 text-xs">
                      Prazo atual: <span className="font-mono">{formatDateBR(extendItem.expected_back)}</span>
                    </span>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Novo prazo de entrega</Label>
              <Input
                type="date"
                value={newDeadline}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setNewDeadline(e.target.value)}
                className="mt-1 h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendItem(null)} disabled={extendDeadline.isPending}>
              Cancelar
            </Button>
            <Button onClick={confirmExtend} disabled={!newDeadline || extendDeadline.isPending}>
              {extendDeadline.isPending ? 'Salvando...' : 'Confirmar novo prazo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ServiceOrderReturnDialog
        open={!!returnItem}
        onOpenChange={(o) => { if (!o) setReturnItem(null); }}
        serviceOrder={returnItem ? {
          id: returnItem.id,
          order_number: returnItem.op_number,
          quantity: returnItem.pairs,
          contractorName: returnItem.contractor_name,
        } : null}
      />
    </div>
  );
}
