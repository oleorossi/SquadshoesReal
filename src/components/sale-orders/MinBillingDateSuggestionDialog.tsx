import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Calendar, CheckCircle2, Pencil, Truck, AlertTriangle, Package } from 'lucide-react';
import { formatBR } from '@/lib/minBillingDate';
import { monthWeekToISODate } from '@/lib/billingWeek';
import { SubmitFlowStepper } from './SubmitFlowStepper';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Data mínima calculada (ISO yyyy-mm-dd). */
  minDateISO: string;
  /** Semana ISO correspondente (ex: 2026-W18). */
  minWeekISO: string;
  /** True quando faltou material em casa e o sistema teve que somar lead do fornecedor. */
  materialShortage?: boolean;
  /** Dias úteis adicionados por causa de compra de material. */
  supplierLeadDays?: number;
  /** Lista de materiais em falta (resumo). */
  shortageItems?: Array<{ product_name: string; needed: number; available: number; supplier_lead_days: number }>;
  /** Quando o usuário aceita a data mínima. */
  onConfirmMin: () => void;
  /** Quando o usuário escolhe uma data diferente — a validação de override é feita pelo caller. */
  onPickManual: (newISO: string) => void;
}

/**
 * Mostrado ao salvar um pedido para confirmar a semana mínima de faturamento
 * calculada (capacidade + lead time + fila atual).
 */
export function MinBillingDateSuggestionDialog({
  open,
  onOpenChange,
  minDateISO,
  minWeekISO,
  materialShortage = false,
  supplierLeadDays = 0,
  shortageItems = [],
  onConfirmMin,
  onPickManual,
}: Props) {
  const [editing, setEditing] = useState(false);
  // Em vez de date picker (calendar), usa Mês + Semana — espelha o form principal
  // pra manter coerência com a forma como o sistema raciocina sobre faturamento.
  const [manualMonth, setManualMonth] = useState<string>(() => {
    if (!minDateISO) return '';
    return minDateISO.slice(0, 7); // yyyy-mm
  });
  const [manualWeek, setManualWeek] = useState<string>('');

  const computedManualDate = useMemo(
    () => monthWeekToISODate(manualMonth, manualWeek),
    [manualMonth, manualWeek],
  );

  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return months;
  }, []);

  const weekOptions = useMemo(() => {
    if (!manualMonth) return [] as { value: string; label: string }[];
    const [year, month] = manualMonth.split('-').map(Number);
    const weeks: { value: string; label: string }[] = [];
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let weekStart = new Date(firstDay);
    const dayOfWeek = weekStart.getDay();
    if (dayOfWeek !== 1) {
      weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7));
    }
    let weekNum = 1;
    while (weekStart <= lastDay) {
      const displayStart = weekStart < firstDay ? new Date(firstDay) : new Date(weekStart);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 4);
      const displayEnd = weekEnd > lastDay ? new Date(lastDay) : weekEnd;
      const label = `Semana ${weekNum} (${displayStart.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} - ${displayEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`;
      weeks.push({ value: `S${weekNum}`, label });
      weekStart.setDate(weekStart.getDate() + 7);
      weekNum++;
    }
    return weeks;
  }, [manualMonth]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setEditing(false);
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <SubmitFlowStepper current="min_billing" />
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Próxima janela de pickup disponível
          </DialogTitle>
          <DialogDescription>
            Com base na fila atual de pedidos, capacidade dos setores e janelas de
            expedição (Terça e Sexta), a primeira data viável para faturar este
            pedido é:
          </DialogDescription>
        </DialogHeader>

        {(() => {
          const dow = (() => {
            if (!minDateISO) return null;
            const [y, m, d] = minDateISO.split('-').map(Number);
            if (!y || !m || !d) return null;
            return new Date(y, m - 1, d).getDay(); // 0=Dom..6=Sáb
          })();
          const isTue = dow === 2;
          const isFri = dow === 5;
          const windowLabel = isTue ? 'Terça' : isFri ? 'Sexta' : null;
          return (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 my-2">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground font-bold">
                {windowLabel && <Truck className="h-3 w-3" />}
                {windowLabel ? `Janela de pickup · ${windowLabel}` : 'Semana mínima'}
              </div>
              <div className="text-2xl font-bold text-primary mt-1">
                {minWeekISO ? minWeekISO.replace(/^(\d{4})-W(\d+)$/, 'Semana $2 / $1') : '—'}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                a partir de <strong className="text-foreground">{formatBR(minDateISO)}</strong>
              </div>
              {materialShortage ? (
                <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                  <span>
                    Material precisa ser comprado — somados <strong>{supplierLeadDays} dias úteis</strong> de lead time do fornecedor.
                  </span>
                </div>
              ) : (
                <div className="mt-2 flex items-start gap-1.5 text-[11px] text-emerald-700">
                  <Package className="h-3.5 w-3.5 mt-px shrink-0" />
                  <span>Material disponível em estoque — sem espera por compra.</span>
                </div>
              )}
            </div>
          );
        })()}

        {materialShortage && shortageItems.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1">
            <p className="font-semibold text-amber-800 flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" />
              Materiais em falta ({shortageItems.length}):
            </p>
            <ul className="space-y-0.5 max-h-32 overflow-y-auto pr-1">
              {shortageItems.slice(0, 8).map((s, i) => (
                <li key={i} className="flex justify-between gap-2 font-mono text-[10.5px]">
                  <span className="truncate text-foreground">{s.product_name}</span>
                  <span className="text-muted-foreground shrink-0">
                    faltam {(s.needed - s.available).toFixed(1)} · {s.supplier_lead_days}d
                  </span>
                </li>
              ))}
              {shortageItems.length > 8 && (
                <li className="text-[10px] text-muted-foreground italic">
                  …e mais {shortageItems.length - 8} item(s).
                </li>
              )}
            </ul>
          </div>
        )}

        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] uppercase font-bold text-muted-foreground mb-1 block">
                  Mês de Faturamento
                </Label>
                <Select value={manualMonth} onValueChange={(v) => { setManualMonth(v); setManualWeek(''); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Mês..." /></SelectTrigger>
                  <SelectContent>
                    {monthOptions.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] uppercase font-bold text-muted-foreground mb-1 block">
                  Semana de Faturamento
                </Label>
                <Select value={manualWeek} onValueChange={setManualWeek}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Semana..." /></SelectTrigger>
                  <SelectContent>
                    {weekOptions.length === 0 ? (
                      <SelectItem value="none" disabled>Selecione o mês primeiro</SelectItem>
                    ) : (
                      weekOptions.map(w => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {computedManualDate && (
              <p className="text-[11px] text-muted-foreground">
                Faturamento previsto: <strong className="text-foreground font-mono">{formatBR(computedManualDate)}</strong>
                {' '}(segunda-feira da semana selecionada)
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Se a data escolhida for anterior à mínima, o pedido será marcado como
              <strong> override manual</strong> (destacado em âmbar no Kanban).
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {editing ? (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Voltar
              </Button>
              <Button
                onClick={() => {
                  if (!computedManualDate) return;
                  onPickManual(computedManualDate);
                }}
                disabled={!computedManualDate}
              >
                Usar esta semana
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)} className="gap-2">
                <Pencil className="h-4 w-4" />
                Ajustar manualmente
              </Button>
              <Button onClick={onConfirmMin} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Confirmar semana mínima
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}