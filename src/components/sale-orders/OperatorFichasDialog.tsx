import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Printer,
  FileText,
  CircleNotch as Loader2,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';
import {
  printOperatorFichas,
  printOperatorFichasFromRows,
  planFichas,
  deriveBaseFromScaled,
  OPERATOR_FICHA_SECTORS,
  type FichaPlan,
} from '@/lib/printOperatorFichas';
import { filterOperationalOperatorOrders } from '@/lib/operatorPrintEligibility';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  saleOrderId: string | null;
  orderNumber: string;
};

/**
 * Diálogo de seleção das fichas de operador do PV ("Ficha Montagem").
 *
 * Antes o botão imprimia o PEDIDO INTEIRO direto (todos os itens, todos os
 * setores) — não dava pra reimprimir só a OP que faltou. Agora lista as OPs
 * do PV com a PRÉVIA do que cada uma gera (fornadas, setores, papéis) e
 * imprime só as marcadas, via `printOperatorFichasFromRows`.
 *
 * As bolinhas de setor usam as MESMAS cores das faixas impressas em
 * `printOperatorFichas.ts` — a tela é o mapa do papel que vai sair.
 */
const SECTOR_DOT: Record<string, { light: string; dark: string }> = {
  // light = cor do texto da faixa impressa; dark = cor do fundo da faixa (o tom
  // escuro some contra o tema escuro do app).
  'Corte Forração': { light: '#085041', dark: '#8FD9C4' },
  'Aviamento': { light: '#633806', dark: '#E0B87A' },
  'Montagem': { light: '#3C3489', dark: '#A9A4EE' },
};

interface OpRow {
  id: string;
  order_number: string;
  reference_id: string | null;
  color: string | null;
  quantity: number;
  grade: Record<string, number> | null;
  status: string;
  sale_order_item_id: string | null;
  technical_sheets?: { name: string | null; code: string | null; production_sectors: unknown } | null;
  sale_order_items?: {
    grade: Record<string, number> | null;
    production_excluded_at: string | null;
  } | null;
  sale_orders?: { order_number: string | null; client_name: string | null } | null;
}

/** Linha da lista + prévia de impressão já calculada pelo motor das fichas. */
interface OpWithPlan {
  row: OpRow;
  refName: string;
  refCode: string;
  plan: FichaPlan;
  sizeRange: string;
}

function sizeRangeLabel(base: Record<string, number>): string {
  const sizes = Object.keys(base)
    .filter(s => Number(base[s]) > 0)
    .sort((a, b) => Number(a) - Number(b));
  if (sizes.length === 0) return '—';
  return sizes.length === 1 ? sizes[0] : `${sizes[0]}–${sizes[sizes.length - 1]}`;
}

export default function OperatorFichasDialog({ open, onOpenChange, saleOrderId, orderNumber }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState(false);

  const { data: ops = [], isLoading, isError, error } = useQuery({
    queryKey: ['pv_operator_fichas_ops', saleOrderId],
    enabled: open && !!saleOrderId,
    queryFn: async () => {
      // sale_orders!sale_order_id desambigua: orders tem 2 FKs pra sale_orders
      // (sale_order_id e cross_dock_sale_order_id).
      const { data, error: qErr } = await (supabase as any)
        .from('orders')
        .select('id, order_number, reference_id, color, quantity, grade, status, sale_order_item_id, technical_sheets:reference_id(name, code, production_sectors), sale_order_items!sale_order_item_id(grade, production_excluded_at), sale_orders!sale_order_id(order_number, client_name)')
        .eq('sale_order_id', saleOrderId)
        .order('order_number', { ascending: true });
      if (qErr) throw qErr;
      return (data || []) as OpRow[];
    },
  });

  const operationalOps = useMemo(() => filterOperationalOperatorOrders(ops), [ops]);

  /** Prévia por OP — mesma conta do motor de impressão (planFichas). */
  const rows: OpWithPlan[] = useMemo(() => operationalOps.map(row => {
    const sheet = row.technical_sheets;
    // Base = grade do ITEM do PV (1 fornada). Sem vínculo, deriva pelo MDC da
    // grade escalada da OP — idêntico ao que printOperatorFichasFromRows faz.
    const base = row.sale_order_items?.grade && Object.keys(row.sale_order_items.grade).length > 0
      ? row.sale_order_items.grade
      : deriveBaseFromScaled(row.grade || {});
    const sectors = Array.isArray(sheet?.production_sectors)
      ? (sheet!.production_sectors as unknown[]).map(String)
      : [];
    const plan = planFichas({ grade: base, quantity: Number(row.quantity) || 0, sectors });
    return {
      row,
      refName: sheet?.name || '—',
      refCode: sheet?.code || '',
      plan,
      sizeRange: sizeRangeLabel(base),
    };
  }), [operationalOps]);

  const printable = useMemo(() => rows.filter(r => r.plan.papers > 0), [rows]);

  // Abriu: marca tudo que imprime (comportamento antigo — PV inteiro — a 1
  // clique). Só na PRIMEIRA carga de cada PV: um refetch (voltar pra aba, por
  // ex.) devolve array novo e re-marcaria tudo por cima do que o user desmarcou.
  const initedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { initedFor.current = null; return; }
    if (printable.length === 0 || initedFor.current === saleOrderId) return;
    initedFor.current = saleOrderId;
    setSelectedIds(new Set(printable.map(r => r.row.id)));
  }, [open, saleOrderId, printable]);

  const selected = useMemo(() => printable.filter(r => selectedIds.has(r.row.id)), [printable, selectedIds]);
  const allSelected = printable.length > 0 && selected.length === printable.length;

  const totals = useMemo(() => selected.reduce(
    (acc, r) => ({
      pairs: acc.pairs + (Number(r.row.quantity) || 0),
      fichas: acc.fichas + r.plan.nFichas * r.plan.sectors.length,
      papers: acc.papers + r.plan.papers,
    }),
    { pairs: 0, fichas: 0, papers: 0 },
  ), [selected]);

  const toggleOne = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(printable.map(r => r.row.id)));
  };

  const handlePrint = async () => {
    if (selected.length === 0) return;
    setPrinting(true);
    try {
      await printOperatorFichasFromRows(selected.map(({ row, refName, refCode }) => ({
        reference_id: row.reference_id,
        reference_name: refName,
        reference_code: refCode,
        color: row.color ?? '',
        total_pairs: row.quantity,
        grid: row.grade ?? {},
        sale_order_number: row.sale_orders?.order_number ?? orderNumber,
        client_name: row.sale_orders?.client_name ?? '',
        sale_order_item_id: row.sale_order_item_id,
        status: row.status,
      })));
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao gerar as fichas de operador.');
    } finally {
      setPrinting(false);
    }
  };

  /** Fallback: PV sem OP geradas — imprime pelos itens do pedido (fluxo antigo). */
  const handlePrintWholeOrder = async () => {
    if (!saleOrderId) return;
    setPrinting(true);
    try {
      await printOperatorFichas(saleOrderId, orderNumber);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao gerar as fichas de operador.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-4 pr-12 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Printer className="h-4 w-4 text-primary" />
            Fichas de operador · {orderNumber}
          </DialogTitle>
          <DialogDescription>
            Marque as OPs que vão pra impressora. Cada fornada de pares sai em 2 vias
            (operador e supervisor), uma por setor da ficha técnica.
          </DialogDescription>
        </DialogHeader>

        {/* Resumo antes do detalhe: o que sai da impressora se imprimir agora. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/60 border-b border-border bg-muted/30">
          {([
            { label: 'OPs', value: `${selected.length}/${printable.length}` },
            { label: 'Pares', value: totals.pairs.toLocaleString('pt-BR') },
            { label: 'Fichas', value: totals.fichas.toLocaleString('pt-BR') },
            { label: 'Papéis', value: totals.papers.toLocaleString('pt-BR') },
          ]).map(s => (
            <div key={s.label} className="px-4 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="text-lg font-bold tabular-nums leading-tight text-foreground">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando OPs do pedido…
            </div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Não foi possível carregar as OPs"
              description={(error as any)?.message || 'Tente novamente em instantes.'}
            />
          ) : rows.length === 0 && ops.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Este pedido ainda não tem OPs"
              description="Dá pra imprimir as fichas direto pelos itens do pedido, sem separar por OP."
              action={
                <Button onClick={handlePrintWholeOrder} disabled={printing} className="gap-2">
                  {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                  Imprimir pelo pedido inteiro
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="Este pedido não tem itens ativos na produção"
              description="As OPs foram canceladas ou seus itens foram retirados da produção. Elas continuam no histórico, mas não podem gerar novas fichas de operador."
            />
          ) : (
            <>
              <div
                className="sticky top-0 z-10 flex items-center gap-3 px-5 py-2 bg-card/95 backdrop-blur border-b border-border/60 cursor-pointer"
                onClick={toggleAll}
              >
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  onClick={e => e.stopPropagation()}
                  disabled={printable.length === 0}
                  aria-label="Selecionar todas as OPs"
                />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
                </span>
              </div>

              <ul className="divide-y divide-border/50">
                {rows.map(({ row, refName, refCode, plan, sizeRange }) => {
                  const checked = selectedIds.has(row.id);
                  const printableRow = plan.papers > 0;
                  return (
                    <li
                      key={row.id}
                      // Seleção marcada por trilho à esquerda, não por fundo
                      // tingido: com tudo marcado por padrão, o wash cobriria a
                      // lista inteira e roubaria o destaque do aviso âmbar.
                      className={cn(
                        'flex items-start gap-3 py-3 pr-5 pl-5 border-l-[3px] border-l-transparent',
                        printableRow ? 'cursor-pointer hover:bg-muted/30' : 'opacity-70',
                        checked && 'border-l-primary bg-primary/[0.03]',
                      )}
                      onClick={() => printableRow && toggleOne(row.id)}
                    >
                      <Checkbox
                        className="mt-1"
                        checked={checked}
                        onCheckedChange={() => toggleOne(row.id)}
                        onClick={e => e.stopPropagation()}
                        disabled={!printableRow}
                        aria-label={`Selecionar OP ${row.order_number}`}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-foreground">{row.order_number}</span>
                          <span className="text-sm font-semibold text-foreground truncate">{refName}</span>
                          {refCode && <span className="font-mono text-[11px] text-muted-foreground">{refCode}</span>}
                          <Badge variant="outline" className="h-5 text-[10px] font-semibold">{row.color || 'sem cor'}</Badge>
                        </div>

                        <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-muted-foreground">
                          <span className="tabular-nums">
                            <strong className="text-foreground">{(Number(row.quantity) || 0).toLocaleString('pt-BR')}</strong> pares
                          </span>
                          <span className="tabular-nums">grade {sizeRange}</span>
                          {plan.baseSum > 0 && <span className="tabular-nums">{plan.baseSum} pares/ficha</span>}
                          <span>{row.status}</span>
                        </div>

                        {printableRow ? (
                          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                            {plan.sectors.map(s => (
                              <span
                                key={s}
                                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground"
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full bg-[var(--dot)] dark:bg-[var(--dot-dark)]"
                                  style={{ '--dot': SECTOR_DOT[s]?.light, '--dot-dark': SECTOR_DOT[s]?.dark } as CSSProperties}
                                  aria-hidden="true"
                                />
                                {s}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {plan.baseSum > 0
                              ? 'A ficha técnica desta referência não tem Corte Forração, Aviamento nem Montagem.'
                              : 'OP sem grade — nada a imprimir.'}
                          </div>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-base font-bold tabular-nums leading-tight text-foreground">
                          {(plan.nFichas * plan.sectors.length).toLocaleString('pt-BR')}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">fichas</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border gap-2 sm:justify-between">
          <span className="text-[11px] text-muted-foreground hidden sm:block self-center">
            {OPERATOR_FICHA_SECTORS.join(' · ')} — setor ausente na ficha técnica não gera papel.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button
              data-dialog-primary="true"
              className="gap-2"
              disabled={selected.length === 0 || printing}
              onClick={handlePrint}
            >
              {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Imprimir {selected.length > 0 ? `(${selected.length})` : ''}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
