import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NumberInput } from '@/components/ui/number-input';
import { Clock } from '@phosphor-icons/react';
import { calculateProductionHours, hoursToWorkingDays } from '@/lib/productionTime';

interface StageTimesModel {
  time_cutting: number;
  time_stitching: number;
  time_assembly: number;
  time_finishing?: number;
}

interface Props {
  totalPairs: number;
  model: StageTimesModel;
  defaultEfficiency?: number;
  journeyHours?: number;
}

export function TimeEstimationCard({
  totalPairs,
  model,
  defaultEfficiency = 0.85,
  journeyHours = 8.8,
}: Props) {
  const [workers, setWorkers] = useState({ cutting: 2, stitching: 10, assembly: 8, finishing: 4 });
  const efficiency = defaultEfficiency;

  const calc = (minutesPerPair: number, numWorkers: number) =>
    calculateProductionHours({ pairs: totalPairs, minutesPerPair, numWorkers, efficiency });

  const times = {
    corte: calc(model.time_cutting, workers.cutting),
    pesponto: calc(model.time_stitching, workers.stitching),
    montagem: calc(model.time_assembly, workers.assembly),
    acabamento: calc(model.time_finishing ?? 3, workers.finishing),
  };

  const bottleneck = Math.max(times.corte, times.pesponto, times.montagem, times.acabamento);
  const workingDays = hoursToWorkingDays(bottleneck, journeyHours);

  const stages = [
    { key: 'cutting' as const, label: 'Corte', hours: times.corte },
    { key: 'stitching' as const, label: 'Pesponto', hours: times.pesponto },
    { key: 'assembly' as const, label: 'Montagem', hours: times.montagem },
    { key: 'finishing' as const, label: 'Acabamento', hours: times.acabamento },
  ];

  return (
    <Card className="bg-card border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
          <Clock className="h-4 w-4 text-primary" />
          Estimativa de Produção — {totalPairs} pares
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {stages.map((s) => (
            <div key={s.key} className="text-center p-2 bg-muted/50 rounded-lg space-y-1">
              <p className="text-xs text-muted-foreground uppercase">{s.label}</p>
              <p className="text-lg font-bold font-mono text-foreground">{s.hours}h</p>
              <div className="flex items-center justify-center gap-1">
                <span className="text-xs text-muted-foreground">Op:</span>
                <NumberInput
                  min={1}
                  decimals={0}
                  className="h-6 w-12 text-center text-xs p-0"
                  value={workers[s.key]}
                  onChange={(n) =>
                    setWorkers((prev) => ({ ...prev, [s.key]: Math.max(1, n) }))
                  }
                />
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Prazo Estimado (Gargalo):</span>
          <Badge variant="default">{workingDays} Dia{workingDays !== 1 ? 's' : ''} Útei{workingDays !== 1 ? 's' : 'l'}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          * Jornada de {journeyHours}h/dia e {(efficiency * 100).toFixed(0)}% de eficiência.
        </p>
      </CardContent>
    </Card>
  );
}
