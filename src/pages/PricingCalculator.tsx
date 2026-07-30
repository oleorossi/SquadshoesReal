/**
 * Markup — simulador de precificação.
 *
 * 2 modos:
 *   • Manual              — você preenche custo + parâmetros, sistema calcula preço/margem.
 *   • Por Ficha Técnica   — sistema busca o custo da ficha (BOM × preço unitário × perda)
 *                            e você só ajusta margem, impostos, comissão, factoring, frete.
 *
 * Deep-link via URL:
 *   /pricing-calculator?tab=by-sheet&sheet=<uuid>
 *   Útil pra abrir do PV: linha do item → "Simular markup" → cai direto na ficha.
 */
import { useState, useEffect } from 'react';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Calculator, FileText, Clock } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import PricingCalculatorPanel from '@/components/financial/PricingCalculatorPanel';
import PricingByTechnicalSheetPanel from '@/components/financial/PricingByTechnicalSheetPanel';
import SectorPricingCalculator from '@/components/financial/SectorPricingCalculator';

export default function PricingCalculator() {
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const requestedSheet = searchParams.get('sheet');

  // A aba mora na URL (contrato do lote L6a). Esta tela já LIA o parâmetro no
  // carregamento, mas nunca ESCREVIA: trocar de aba não mudava o endereço, então
  // o deep-link só funcionava na ida. 'labor' (aba antiga "Mão de Obra" em
  // horas/par) segue aceito como alias da 'sector' unificada (pares/hora).
  const { value: activeTab, setValue: setActiveTab } = useUrlTabState({
    values: ['manual', 'by-sheet', 'sector'] as const,
    defaultValue: 'manual',
    aliases: { labor: 'sector' },
  });

  // `?sheet=<uuid>` implica a aba da ficha, mesmo sem `?tab=`: o link vem de
  // fora (custeio do PV) apontando pra uma ficha específica.
  useEffect(() => {
    if (requestedSheet && activeTab !== 'by-sheet') setActiveTab('by-sheet', { history: 'replace' });
  }, [requestedSheet, activeTab, setActiveTab]);

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="CUSTOS · PRECIFICAÇÃO"
        title="Markup"
        description="Simulador de custo do produto e margem — combina insumos, mão de obra, overhead, frete, impostos, comissões e factoring para mostrar o preço de venda mínimo e a margem real por par."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList indicator="none" className="h-auto gap-1 bg-muted/50 p-1 rounded-lg">
          <TabsTrigger
            value="manual"
            className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
          >
            <Calculator className="h-3.5 w-3.5" />
            Manual
          </TabsTrigger>
          <TabsTrigger
            value="by-sheet"
            className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
          >
            <FileText className="h-3.5 w-3.5" />
            Por Ficha Técnica
          </TabsTrigger>
          <TabsTrigger
            value="sector"
            className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
          >
            <Clock className="h-3.5 w-3.5" />
            Mão de Obra
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manual">
          <PricingCalculatorPanel />
        </TabsContent>

        <TabsContent value="by-sheet">
          <PricingByTechnicalSheetPanel initialSheetId={requestedSheet || undefined} />
        </TabsContent>

        <TabsContent value="sector">
          <SectorPricingCalculator />
        </TabsContent>
      </Tabs>
    </div>
  );
}
