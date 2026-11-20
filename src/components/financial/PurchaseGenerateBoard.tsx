import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  buildPurchaseBoard,
  purchaseLineKey,
  selectionCanBecomePurchaseOrder,
  type PurchaseBoardFilters,
  type PurchaseBoardMode,
  type PurchaseSuggestion,
} from '@/lib/cabedalPlanningMotor';

interface Props {
  lines: PurchaseSuggestion[];
  today: string;
  motorEnabled: boolean;
  mode: PurchaseBoardMode;
}

const EMPTY_FILTERS = {
  supplierId: '',
  saleOrderId: '',
  urgentOnly: false,
  overdueOnly: false,
  week: '',
};

export function PurchaseGenerateBoard({ lines, today, motorEnabled, mode }: Props) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const boardFilters: PurchaseBoardFilters = {
    supplierId: filters.supplierId || null,
    saleOrderId: filters.saleOrderId || null,
    urgentOnly: filters.urgentOnly,
    overdueOnly: filters.overdueOnly,
    week: filters.week || null,
    today,
  };
  const board = useMemo(
    () => buildPurchaseBoard(lines, mode, boardFilters),
    [lines, mode, filters, today],
  );

  const suppliers = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of lines) map.set(line.supplierId ?? '', line.supplierName);
    return [...map.entries()];
  }, [lines]);
  const orders = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of lines) map.set(line.saleOrderId, line.orderNumber);
    return [...map.entries()];
  }, [lines]);

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const generate = (blockLines: PurchaseSuggestion[]) => {
    const picked = blockLines.filter((line) => selected.has(purchaseLineKey(line)));
    const check = selectionCanBecomePurchaseOrder(picked);
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }
    if (!motorEnabled) {
      toast.message('Motor desligado. Nenhuma OC foi gravada. A seleção cabe numa OC deste fornecedor.');
      return;
    }
    toast.message('A gravação da OC pelo motor ainda não está ativada. Nada foi criado.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {motorEnabled
            ? 'Motor ligado na configuração, mas esta tela ainda não grava OC.'
            : 'Motor desligado. As duas visões são a simulação — gerar OC não grava nada.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="h-9 rounded-md border border-border bg-card px-2 text-sm"
          value={filters.supplierId}
          onChange={(event) => setFilters((current) => ({ ...current, supplierId: event.target.value }))}
          aria-label="Filtrar fornecedor"
        >
          <option value="">Todos os fornecedores</option>
          {suppliers.map(([id, name]) => <option key={id || name} value={id}>{name}</option>)}
        </select>
        <select
          className="h-9 rounded-md border border-border bg-card px-2 text-sm"
          value={filters.saleOrderId}
          onChange={(event) => setFilters((current) => ({ ...current, saleOrderId: event.target.value }))}
          aria-label="Filtrar pedido"
        >
          <option value="">Todos os pedidos</option>
          {orders.map(([id, number]) => <option key={id} value={id}>{number}</option>)}
        </select>
        <input
          className="h-9 w-36 rounded-md border border-border bg-card px-2 text-sm"
          placeholder="Semana ou mês"
          value={filters.week}
          onChange={(event) => setFilters((current) => ({ ...current, week: event.target.value }))}
          aria-label="Filtrar semana"
        />
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={filters.urgentOnly} onCheckedChange={(value) => setFilters((current) => ({ ...current, urgentOnly: value === true }))} />
          Só urgentes
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={filters.overdueOnly} onCheckedChange={(value) => setFilters((current) => ({ ...current, overdueOnly: value === true }))} />
          Só atrasados
        </label>
      </div>

      {board.blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma necessidade nesta simulação com os filtros atuais.</p>
      ) : board.blocks.map((block) => (
        <section key={block.key} className="rounded-lg border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">
                {block.title}
                {block.urgent && <span className="ml-2 rounded-sm bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive">Urgente</span>}
              </h2>
              <p className="text-xs text-muted-foreground">
                {block.subtitle}
                {mode === 'pedido' && (block.complete ? ' · Material completo' : ` · falta ${block.missingCount} itens`)}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => generate(block.lines)}>
              Gerar OC
            </Button>
          </header>
          <ul className="divide-y divide-border/70">
            {block.lines.map((line) => {
              const key = purchaseLineKey(line);
              return (
                <li key={key} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                  <Checkbox checked={selected.has(key)} onCheckedChange={() => toggle(key)} aria-label={`Selecionar ${line.productName}`} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{line.productName}</span>
                    <span className="text-muted-foreground"> · {line.quantity} {line.unit ?? ''}</span>
                    <span className="block text-xs text-muted-foreground">
                      {line.orderNumber} · {line.referenceCode}
                      {line.buyBy ? ` · comprar até ${line.buyBy}` : ''}
                      {line.needDate ? ` · necessidade ${line.needDate}` : ''}
                    </span>
                  </span>
                  {line.urgent && <span className="rounded-sm bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive">Urgente</span>}
                  {line.className === 'complexo' && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase">Complexo</span>}
                  <span className="text-xs text-muted-foreground">{statusLabel(line.status)}</span>
                  <Link className="text-xs underline" to="/purchase-planning?tab=fila-envio">OCs</Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function statusLabel(status: PurchaseSuggestion['status']): string {
  if (status === 'liberada') return 'A comprar';
  if (status === 'fora_da_janela') return 'Fora da janela';
  return 'Aguardando caixa';
}
