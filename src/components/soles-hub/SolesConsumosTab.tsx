import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Card, CardContent } from '@/components/ui/card';
import { Layers, Footprints, Sparkles, Info } from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { SoleTechnicalDetails } from '@/components/technical-sheets/SoleTechnicalDetails';
import { SoleStandardItemsPanel } from '@/components/technical-sheets/SoleStandardItemsPanel';
import { SoleSilkPanel } from '@/components/technical-sheets/SoleSilkPanel';
import type { SoleProduct } from './types';

interface Props {
  sole: SoleProduct;
}

export default function SolesConsumosTab({ sole }: Props) {
  const [tab, setTab] = usePersistedState<string>('soles-consumos-sub', 'forracao');

  return (
    <div className="space-y-3">
      <Card className="border-dashed bg-muted/30">
        <CardContent className="py-3 px-4 flex items-start gap-2">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Os 3 grupos de consumo deste solado: <strong>Forração / Palmilha</strong> (consumo por numeração),
            <strong> Itens Padrão</strong> (cola, EVA, linha — fixo por par), e <strong>Silk</strong> (artes
            por cor). Conjugadas (ex.: 33/34) entram como <em>uma única linha</em> automaticamente.
          </p>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'forracao',  label: 'Forração / Palmilha', icon: Layers },
          { value: 'standard',  label: 'Itens Padrão',         icon: Footprints },
          { value: 'silk',      label: 'Silk',                 icon: Sparkles },
        ]} />

        <TabsContent value="forracao" className="mt-4">
          <SoleTechnicalDetails
            soleId={sole.id}
            soleName={sole.name}
          />
        </TabsContent>

        <TabsContent value="standard" className="mt-4">
          <SoleStandardItemsPanel soleProductId={sole.id} />
        </TabsContent>

        <TabsContent value="silk" className="mt-4">
          <SoleSilkPanel soleProductId={sole.id} soleName={sole.name} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
