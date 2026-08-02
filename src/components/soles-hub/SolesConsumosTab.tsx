import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Card, CardContent } from '@/components/ui/card';
import { Stack as Layers, Info, Image as ImageIcon, Cube as Box, Package as Package2 } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { SoleTechnicalDetails } from '@/components/technical-sheets/SoleTechnicalDetails';
import SoleStandardConsumptionPanel from './SoleStandardConsumptionPanel';
import { SoleSilkPanel } from '@/components/technical-sheets/SoleSilkPanel';
import { PackagingTab } from '@/components/technical-sheets/PackagingTab';
import type { SoleProduct } from './types';

interface Props {
  sole: SoleProduct;
  soleLabel?: string;
}

export default function SolesConsumosTab({ sole, soleLabel }: Props) {
  const [tab, setTab] = usePersistedState<string>('soles-consumos-sub', 'padrao');
  // Compat com nomes persistidos das abas aposentadas em 02/08/2026:
  // "Itens Padrão" (sole_standard_materials) e "Por Numeração"
  // (sole_standard_items_consumption) foram absorvidas pelo cadastro único.
  const safeTab = tab === 'standard' || tab === 'numeracao' ? 'padrao' : tab;

  return (
    <div className="space-y-3">
      <Card className="border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/10">
        <CardContent className="py-3 px-4 flex items-start gap-2">
          <Info className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            <strong>Consumo é por MODELO de solado, não por cor.</strong> O que você cadastrar
            em <strong>Consumo Padrão</strong> vale pra todas as cores deste solado e pra todas
            as referências que o usam — sem cópia no BOM da ficha, então corrigir aqui corrige
            em todas. É a <strong>única</strong> tela que cadastra consumo; a aba{' '}
            <strong>Numerações</strong> cuida só da grade. A ficha técnica lista só o que é
            exclusivo da referência. Conjugadas (ex.: 33/34) entram como uma única linha.{' '}
            <strong>Silk</strong> tem menu próprio.
          </p>
        </CardContent>
      </Card>

      <Tabs value={safeTab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'padrao',    label: 'Consumo Padrão',      icon: Package2 },
          { value: 'forracao',  label: 'Numerações',          icon: Layers },
          { value: 'silk',      label: 'Silk / Arte',         icon: ImageIcon },
          { value: 'embalagem', label: 'Embalagem',            icon: Box },
        ]} />

        {/* Cadastro ÚNICO do consumo padrão do modelo: linhas PAPEL (forração,
            palmilha, fachete — quantidade aqui, material da ficha/PV) e ITEM
            (cola, linha, EVA — material e quantidade do solado). Substitui as
            abas "Itens Padrão" e "Por Numeração". */}
        <TabsContent value="padrao" className="mt-4">
          <SoleStandardConsumptionPanel
            soleGroupId={sole.group_id}
            soleGroupName={soleLabel ?? sole.name}
            soleClassification={sole.sole_classification ?? null}
            isFachetado={sole.is_fachetado ?? false}
          />
        </TabsContent>

        {/* SÓ a grade de numerações. As colunas de consumo saíram em 03/08/2026:
            a fonte da verdade é sole_group_standard_items (linhas PAPEL) e esta
            tabela é o espelho mantido pelo trigger tg_sgsi_mirror_papel. O
            `readOnly` anterior cobria só os inputs — Replicar/Puxar de Família/
            Copiar e o Salvar seguiam gravando no espelho. */}
        <TabsContent value="forracao" className="mt-4">
          <SoleTechnicalDetails soleId={sole.id} soleName={sole.name} />
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
