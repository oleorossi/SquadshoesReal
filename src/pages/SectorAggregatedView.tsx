import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Scissors, Stack as Layers, Hand, Pen, Printer, Flame, Hammer, Footprints } from '@phosphor-icons/react';
import { SectorWorkloadAggregated } from '@/components/production/SectorWorkloadAggregated';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

interface SectorConfig {
  key: string;
  /** Nome exato em order_stages.stage_name */
  stageName: string;
  label: string;
  icon: React.ElementType;
  /** Quando false, agrupa todas as cores juntas (mesmo molde) */
  groupByColor: boolean;
  hint: string;
}

const SECTORS: SectorConfig[] = [
  {
    key: 'corte_palmilha', stageName: 'Corte Palmilha', label: 'Corte Palmilha',
    icon: Scissors, groupByColor: false,
    hint: 'Agrupado só por modelo — mesmo molde corta a grade inteira sem trocar setup, independente da cor.',
  },
  {
    key: 'corte_forracao', stageName: 'Corte Forração', label: 'Corte Forração',
    icon: Layers, groupByColor: true,
    hint: 'Agrupado por modelo + cor — corta tecido colorido em lote.',
  },
  {
    key: 'mesa', stageName: 'Aviamento', label: 'Mesa / Aviamento',
    icon: Hand, groupByColor: true,
    hint: 'Agrupado por modelo + cor — prepara componentes coloridos consolidados.',
  },
  {
    key: 'costura', stageName: 'Costura', label: 'Costura',
    icon: Pen, groupByColor: true,
    hint: 'Agrupado por modelo + cor — costura faz a grade inteira da cor sem parar.',
  },
  {
    key: 'silk', stageName: 'Silk', label: 'Silk',
    icon: Printer, groupByColor: true,
    hint: 'Agrupado por modelo + cor — programação de turno por arte/cor.',
  },
  {
    key: 'colagem', stageName: 'Colagem', label: 'Colagem',
    icon: Flame, groupByColor: true,
    hint: 'Agrupado por modelo + cor — mesma cola/processo por par.',
  },
  {
    key: 'montagem', stageName: 'Montagem', label: 'Montagem',
    icon: Hammer, groupByColor: true,
    hint: 'Agrupado por modelo + cor — operação por lote, antes de Acabamento.',
  },
  {
    key: 'solagem', stageName: 'Solagem', label: 'Solagem',
    icon: Footprints, groupByColor: true,
    hint: 'Agrupado por modelo + cor — mesmo solado em lote.',
  },
];

export default function SectorAggregatedView() {
  const [activeTab, setActiveTab] = useState<string>(SECTORS[0].key);
  const active = SECTORS.find(s => s.key === activeTab) || SECTORS[0];

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · Visão Agregada"
        title="Visão Agregada por Setor"
        description="Carga ativa de cada setor consolidada por modelo (e cor onde faz sentido). Em vez de N cartões individuais de 12 pares, o operador vê o LOTE consolidado — costura faz a grade inteira sem trocar setup, corte usa o mesmo molde por todas as cores."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-4 lg:grid-cols-8 h-auto">
          {SECTORS.map(s => {
            const Icon = s.icon;
            return (
              <TabsTrigger key={s.key} value={s.key} className="gap-1.5 text-xs">
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <Card>
          <CardContent className="py-3 px-4 bg-muted/30">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">{active.label}:</strong> {active.hint}
            </p>
          </CardContent>
        </Card>

        {SECTORS.map(s => (
          <TabsContent key={s.key} value={s.key} className="mt-3">
            <SectorWorkloadAggregated stageName={s.stageName} groupByColor={s.groupByColor} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
