import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle, Calendar, Scissors, Hammer,
  Layers, LayoutGrid, Pen, Paintbrush, Wind, Footprints, Package, Truck,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CapacityCheckResult, SECTOR_LABELS, SectorKey } from '@/lib/sectorCapacity';
import { SubmitFlowStepper } from './SubmitFlowStepper';

const SECTOR_ICONS: Record<SectorKey, React.ComponentType<any>> = {
  corte_palmilha: Scissors,
  corte_forracao: Layers,
  mesa:           LayoutGrid,
  costura:        Pen,
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
}

export function SectorOverloadDialog({ open, onOpenChange, result, onKeepDateAndOutsource, onPostponeDate }: Props) {
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
      <DialogContent className="max-w-2xl">
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
          </AlertDescription>
        </Alert>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={() => onPostponeDate(suggestedISO)}>
            Adiar para {new Date(suggestedISO).toLocaleDateString('pt-BR')}
          </Button>
          <Button onClick={onKeepDateAndOutsource}>
            Manter data e gerar OS terceirizada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
