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
import { Calendar, CheckCircle as CheckCircle2, PencilSimple as Pencil, Truck, Package, Factory, Info, Warning as AlertTriangle } from '@phosphor-icons/react';
import { formatBR, type MaterialShortfall } from '@/lib/minBillingDate';
import { monthWeekToISODate } from '@/lib/billingWeek';
import { SubmitFlowStepper } from './SubmitFlowStepper';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Data mínima calculada (ISO yyyy-mm-dd). */
  minDateISO: string;
  /** Semana ISO correspondente (ex: 2026-W18). */
  minWeekISO: string;
  /** Gargalo que determinou a data: 'material' (precisa comprar), 'capacidade' (fila cheia) ou 'nenhum'. */
  bottleneck?: 'capacidade' | 'material' | 'nenhum';
  /** Data em que a capacidade produtiva libera. */
  capacityReadyDateISO?: string;
  /** Data em que o material estaria disponível. */
  materialReadyDateISO?: string;
  /** Lista de materiais com shortage (pra exibir detalhes). */
  materialShortfalls?: MaterialShortfall[];
  /** Quando o usuário aceita a data mínima. */
  onConfirmMin: () => void;
  /** Quando o usuário escolhe uma data diferente — a validação de override é feita pelo caller. */
  onPickManual: (newISO: string) => void;
  /** Usuário tem permissão de admin? Controla a aparição do botão azul de override
   *  imediato e bloqueia tentativa de antecipar pra data < mínima pra não-admins. */
  isAdmin?: boolean;
  /** Data originalmente digitada pelo user no form (ISO). Quando ela é anterior à
   *  mínima e o user é admin, mostramos um BOTÃO AZUL pra confirmar override
   *  direto, sem precisar re-selecionar mês/semana. */
  userPickedDateISO?: string | null;
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
  bottleneck = 'nenhum',
  capacityReadyDateISO,
  materialReadyDateISO,
  materialShortfalls = [],
  onConfirmMin,
  onPickManual,
  isAdmin = false,
  userPickedDateISO = null,
}: Props) {
  // Botão azul de override só faz sentido quando:
  //   1. user já tinha digitado uma data
  //   2. essa data é ANTERIOR ao mínimo (caso contrário, "Confirmar mínima" basta)
  //   3. user é admin (não-admins não têm permissão de antedar)
  const canQuickOverride = !!(
    isAdmin && userPickedDateISO && minDateISO && userPickedDateISO < minDateISO
  );
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
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
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
          const materialShortage = bottleneck === 'material';
          const supplierLeadDays = materialShortfalls.length > 0
            ? Math.max(...materialShortfalls.map(m => m.lead_time_days || 0))
            : 0;
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
                <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                  <span>
                    Material precisa ser comprado{supplierLeadDays > 0 ? <> — somados <strong>{supplierLeadDays} dias úteis</strong> de lead time do fornecedor.</> : '.'}
                  </span>
                </div>
              ) : (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-emerald-700">
                  <Package className="h-3.5 w-3.5 mt-px shrink-0" />
                  <span>Material disponível em estoque — sem espera por compra.</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Detalhamento do gargalo — quando há material faltando ou capacidade
            saturada, mostra qual restrição determinou a data sugerida. Cliente
            entende por que a data não pode ser antes (e quando pode adiar
            comprando material vs. esperando fila de produção). */}
        {bottleneck !== 'nenhum' && (
          <div className={`rounded-lg border p-3 my-2 ${
            bottleneck === 'material'
              ? 'border-amber-500/40 bg-amber-500/5'
              : 'border-blue-500/40 bg-blue-500/5'
          }`}>
            <div className={`flex items-center gap-1.5 text-xs uppercase tracking-wide font-bold ${
              bottleneck === 'material' ? 'text-amber-700' : 'text-blue-700'
            }`}>
              {bottleneck === 'material' ? <Package className="h-3.5 w-3.5" /> : <Factory className="h-3.5 w-3.5" />}
              Gargalo: {bottleneck === 'material' ? 'Compra de material' : 'Capacidade produtiva'}
            </div>
            <p className="text-xs mt-1 text-foreground">
              {bottleneck === 'material' ? (
                <>
                  Material insuficiente em estoque — precisa comprar.
                  {capacityReadyDateISO && (
                    <> Capacidade libera em <strong>{formatBR(capacityReadyDateISO)}</strong>,
                    mas o material só chega em <strong>{formatBR(materialReadyDateISO || minDateISO)}</strong>.</>
                  )}
                </>
              ) : (
                <>
                  Material em estoque, porém fila de produção saturada nas semanas próximas.
                  {materialReadyDateISO && capacityReadyDateISO && (
                    <> Material está pronto em <strong>{formatBR(materialReadyDateISO)}</strong>,
                    mas capacidade só libera em <strong>{formatBR(capacityReadyDateISO)}</strong>.</>
                  )}
                </>
              )}
            </p>
            {bottleneck === 'material' && materialShortfalls.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs uppercase font-bold text-amber-700 tracking-wide flex items-center gap-1">
                  <Info className="h-3 w-3" /> Materiais em falta
                </p>
                <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                  {materialShortfalls.slice(0, 8).map(m => (
                    <li key={m.product_id} className="flex items-center justify-between gap-2 border-b border-amber-500/20 pb-0.5">
                      <span className="truncate">
                        <strong>{m.product_name}</strong>
                        {m.color && <span className="text-muted-foreground"> · {m.color}</span>}
                      </span>
                      <span className="text-muted-foreground whitespace-nowrap font-mono">
                        falta {m.shortage.toFixed(1)} · lead {m.lead_time_days}d
                      </span>
                    </li>
                  ))}
                  {materialShortfalls.length > 8 && (
                    <li className="text-xs text-muted-foreground italic">
                      ... e mais {materialShortfalls.length - 8} item(ns)
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase font-bold text-muted-foreground mb-1 block">
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
                <Label className="text-xs uppercase font-bold text-muted-foreground mb-1 block">
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
              <p className="text-xs text-muted-foreground">
                Faturamento previsto: <strong className="text-foreground font-mono">{formatBR(computedManualDate)}</strong>
                {' '}(segunda-feira da semana selecionada)
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Se a data escolhida for anterior à mínima, o pedido será marcado como
              <strong> override manual</strong> (destacado em âmbar no Kanban).
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          {editing ? (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Voltar
              </Button>
              <Button
                onClick={() => {
                  if (!computedManualDate) return;
                  // Bloqueio pra não-admin: data manual NÃO pode ser anterior à mínima.
                  // Admin pode antedar (cai no fluxo de override com motivo).
                  if (!isAdmin && computedManualDate < minDateISO) {
                    // Toast inline pra não bloquear o submit handler; user precisa
                    // escolher uma semana ≥ mínima ou clicar em "Confirmar semana mínima".
                    alert('Apenas administradores podem faturar antes da semana mínima calculada.');
                    return;
                  }
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
              {canQuickOverride && (
                <Button
                  onClick={() => onPickManual(userPickedDateISO as string)}
                  className="gap-2 bg-blue-600 hover:bg-blue-700 text-white border-blue-700 sm:ml-auto"
                  title={`Override administrativo: salva com a data ${formatBR(userPickedDateISO as string)} mesmo antes do mínimo viável`}
                >
                  <AlertTriangle className="h-4 w-4" />
                  Salvar mesmo assim ({formatBR(userPickedDateISO as string)})
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}