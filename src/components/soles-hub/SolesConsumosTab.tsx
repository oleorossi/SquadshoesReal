import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Card, CardContent } from '@/components/ui/card';
import { Stack as Layers, Footprints, ListNumbers, Info, Image as ImageIcon, Cube as Box } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { SoleTechnicalDetails } from '@/components/technical-sheets/SoleTechnicalDetails';
import { SoleStandardItemsPanel } from '@/components/technical-sheets/SoleStandardItemsPanel';
import { SoleStandardMaterialsEditor } from '@/components/inventory/SoleStandardMaterialsEditor';
import { SoleSilkPanel } from '@/components/technical-sheets/SoleSilkPanel';
import { PackagingTab } from '@/components/technical-sheets/PackagingTab';
import type { SoleProduct } from './types';

interface Props {
  sole: SoleProduct;
  soleLabel?: string;
}

export default function SolesConsumosTab({ sole, soleLabel }: Props) {
  const [tab, setTab] = usePersistedState<string>('soles-consumos-sub', 'padrao');
  // Compat com o nome persistido anterior; Silk voltou a ser uma aba real ao
  // absorver /consumo-base, então não a remapeamos para Itens Padrão.
  const safeTab = tab === 'standard' ? 'numeracao' : tab;

  return (
    <div className="space-y-3">
      <Card className="border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/10">
        <CardContent className="py-3 px-4 flex items-start gap-2">
          <Info className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            <strong>Consumo é por REFERÊNCIA do solado, não por cor.</strong> O que você
            cadastrar aqui vale pra TODAS as cores deste solado automaticamente — você edita
            uma vez. <strong>Itens Padrão</strong> (cola, linha, etc., por par) são baixados
            no BOM automaticamente quando a referência selecionar este solado. Conjugadas
            (ex.: 33/34) entram como uma única linha. <strong>Silk</strong> tem menu próprio.
          </p>
        </CardContent>
      </Card>

      <Tabs value={safeTab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'padrao',    label: 'Itens Padrão',        icon: Footprints },
          { value: 'forracao',  label: 'Forração / Palmilha', icon: Layers },
          { value: 'numeracao', label: 'Por Numeração',       icon: ListNumbers },
          { value: 'silk',      label: 'Silk / Arte',         icon: ImageIcon },
          { value: 'embalagem', label: 'Embalagem',            icon: Box },
        ]} />

        {/* Consumos padrão POR PAR (cola, linha, forração…) — baixados no BOM
            automaticamente ao selecionar este solado numa referência. Grava em
            sole_standard_materials (lido por autoFillStandardItemsFromSole). */}
        <TabsContent value="padrao" className="mt-4">
          <SoleStandardMaterialsEditor
            soleGroupId={sole.group_id || ''}
            soleClassification={sole.sole_classification ?? undefined}
          />
        </TabsContent>

        <TabsContent value="forracao" className="mt-4">
          <SoleTechnicalDetails
            soleId={sole.id}
            soleName={sole.name}
          />
        </TabsContent>

        {/* Itens padrão POR NUMERAÇÃO (legado) — quando o consumo varia por
            tamanho. Convive com o por-par: o auto-fill deduplica por produto. */}
        <TabsContent value="numeracao" className="mt-4">
          <SoleStandardItemsPanel soleProductId={sole.id} />
        </TabsContent>

        {/* Estes painéis vinham da rota /consumo-base. Reutilizá-los aqui mantém
            o mesmo cadastro por solado ao consolidar a jornada em /solados. */}
        <TabsContent value="silk" className="mt-4">
          <SoleSilkPanel soleProductId={sole.id} soleName={soleLabel ?? sole.name} />
        </TabsContent>

        <TabsContent value="embalagem" className="mt-4">
          <PackagingTab soleGroupId={sole.group_id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
