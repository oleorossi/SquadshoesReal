import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Card, CardContent } from '@/components/ui/card';
import { Stack as Layers, Footprints, Info } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { SoleTechnicalDetails } from '@/components/technical-sheets/SoleTechnicalDetails';
import { SoleStandardItemsPanel } from '@/components/technical-sheets/SoleStandardItemsPanel';
import type { SoleProduct } from './types';

interface Props {
  sole: SoleProduct;
}

export default function SolesConsumosTab({ sole }: Props) {
  const [tab, setTab] = usePersistedState<string>('soles-consumos-sub', 'forracao');
  // Silk foi removido — quem tem 'silk' persistido cai pra 'forracao'
  const safeTab = tab === 'silk' ? 'forracao' : tab;

  return (
    <div className="space-y-3">
      <Card className="border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/10">
        <CardContent className="py-3 px-4 flex items-start gap-2">
          <Info className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            <strong>Consumo é por REFERÊNCIA do solado, não por cor.</strong> O que você
            cadastrar aqui (Forração/Palmilha, Itens Padrão) vale pra TODAS as cores deste
            solado automaticamente — você edita uma vez. Conjugadas (ex.: 33/34) entram
            como uma única linha. <strong>Silk</strong> tem menu próprio (não fica aqui).
          </p>
        </CardContent>
      </Card>

      <Tabs value={safeTab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'forracao',  label: 'Forração / Palmilha', icon: Layers },
          { value: 'standard',  label: 'Itens Padrão',         icon: Footprints },
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
      </Tabs>
    </div>
  );
}
