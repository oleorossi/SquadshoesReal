import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Warning as AlertTriangle, Calendar, Scissors, Hammer, Stack as Layers, GridFour as LayoutGrid, Pen, PaintBrush as Paintbrush, Wind, Footprints, Package, Truck, ShieldCheck } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CapacityCheckResult, SECTOR_LABELS, SectorKey } from '@/lib/sectorCapacity';
import { SubmitFlowStepper } from './SubmitFlowStepper';
import { useAccessControl } from '@/hooks/useAccessControl';

const SECTOR_ICONS: Record<SectorKey, React.ComponentType<any>> = {
  corte_palmilha:   Scissors,
  corte_forracao:   Layers,
  mesa:             LayoutGrid,
  costura_palmilha: Pen,
  costura_cabedal:  Pen,
  costura:          Pen,
  silk:           Paintbrush,
  colagem:        Wind,
  montagem:       Hammer,
  solagem:        Footprints,
  acabamento:     Package,
  expedicao:      Truck,
  corte:          Scissors,
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  result: CapacityCheckResult | null;
  onKeepDateAndOutsource: () => void;
  onPostponeDate: (newISO: string) => void;
  /** Admin override — pula criação automática de OS, segue direto pra salvar.
   *  Usado quando admin já tem solução por fora (terceirizado próprio, hora extra etc). */
  onAdminOverride?: (reason: string) => void;
}

export function SectorOverloadDialog({ open, onOpenChange, result, onKeepDateAndOutsource, onPostponeDate, onAdminOverride }: Props) {
  const { isAdmin } = useAccessControl();
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  if (!result) return null;

  // Sugere nova data: maior dias necessários extras dentre os setores em sobrecarga
  const maxExtraDays = Math.max(
    0,
    ...result.overloads.map((o) => Math.ceil(o.shortfall_pairs / Math.max(1, o.capacity_per_day))),
  );
  const suggestedDate = new Date(result.billingDateISO + 'T00:00:00');
  suggestedDate.setDate(suggestedDate.getDate() + maxExtraDays + 2);
  const suggestedISO = suggestedDate.toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <SubmitFlowStepper current="capacity" />
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Capacidade insuficiente para a data de faturamento
          </DialogTitle>
          <DialogDescription>
            Os setores abaixo não conseguirão entregar a quantidade solicitada até{' '}
            <strong>{new Date(result.billingDateISO).toLocaleDateString('pt-BR')}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {result.overloads.map((o, i) => {
            const Icon = SECTOR_ICONS[o.sector];
            return (
              <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">{SECTOR_LABELS[o.sector]}</span>
                    <Badge variant="outline" className="text-xs">{o.reference_label}</Badge>
                  </div>
                  <Badge variant="destructive" className="text-xs">
                    Falta: {o.shortfall_pairs} pares
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Capacidade/dia</div>
                    <div className="font-mono font-semibold">{o.capacity_per_day}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Carga prevista/dia</div>
                    <div className="font-mono font-semibold text-destructive">{o.daily_load.toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Janela</div>
                    <div className="font-mono">{o.available_days} dias úteis</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Necessário</div>
                    <div className="font-mono">{o.required_days} dias</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <Alert className="bg-muted/40 border-border">
          <Calendar className="h-4 w-4" />
          <AlertTitle className="text-sm">O que você quer fazer?</AlertTitle>
          <AlertDescription className="text-xs space-y-1">
            <p>
              <strong>Manter a data:</strong> uma Ordem de Serviço (OS) de terceirização será criada automaticamente
              para cobrir o excedente, garantindo a entrega.
            </p>
            <p>
              <strong>Adiar para {new Date(suggestedISO).toLocaleDateString('pt-BR')}:</strong> ajusta a data de
              faturamento para uma janela viável internamente.
            </p>
            {isAdmin && onAdminOverride && (
              <p className="pt-1 border-t border-border/60">
                <strong className="text-amber-700 dark:text-amber-400">Override admin:</strong> pula a criação automática de OS
                e salva o pedido. Use só se você já resolveu a capacidade por fora (terceirizado próprio, material emprestado, hora extra).
              </p>
            )}
          </AlertDescription>
        </Alert>

        {overrideMode && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-wide">Confirmar override</span>
            </div>
            <p className="text-xs text-foreground">
              Você está assumindo responsabilidade por entregar este pedido em <strong>{new Date(result.billingDateISO).toLocaleDateString('pt-BR')}</strong>,
              mesmo com capacidade interna insuficiente. O pedido será marcado como override manual.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="override-reason" className="text-xs uppercase font-bold text-muted-foreground">
                Motivo (obrigatório)
              </Label>
              <Textarea
                id="override-reason"
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="Ex: terceirizado próprio cobrindo costura / material emprestado pelo fornecedor X / hora extra autorizada"
                rows={2}
                className="text-sm"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {overrideMode ? (
            <>
              <Button variant="ghost" onClick={() => { setOverrideMode(false); setOverrideReason(''); }}>
                Voltar
              </Button>
              <Button
                variant="default"
                disabled={!overrideReason.trim()}
                onClick={() => {
                  if (!onAdminOverride) return;
                  onAdminOverride(overrideReason.trim());
                  setOverrideMode(false);
                  setOverrideReason('');
                }}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                <ShieldCheck className="h-4 w-4 mr-1.5" />
                Confirmar override
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button variant="secondary" onClick={() => onPostponeDate(suggestedISO)}>
                Adiar para {new Date(suggestedISO).toLocaleDateString('pt-BR')}
              </Button>
              {isAdmin && onAdminOverride && (
                <Button
                  variant="outline"
                  onClick={() => setOverrideMode(true)}
                  className="border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                >
                  <ShieldCheck className="h-4 w-4 mr-1.5" />
                  Override (admin)
                </Button>
              )}
              <Button onClick={onKeepDateAndOutsource}>
                Manter data e gerar OS terceirizada
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
