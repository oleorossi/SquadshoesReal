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
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Calculator, FileText, Clock, Gauge } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import PricingCalculatorPanel from '@/components/financial/PricingCalculatorPanel';
import PricingByTechnicalSheetPanel from '@/components/financial/PricingByTechnicalSheetPanel';
import LaborCostCalculatorPanel from '@/components/financial/LaborCostCalculatorPanel';
import SectorPricingCalculator from '@/components/financial/SectorPricingCalculator';

export default function PricingCalculator() {
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const requestedSheet = searchParams.get('sheet');

  const [activeTab, setActiveTab] = useState<string>(
    requestedTab === 'by-sheet' || requestedSheet ? 'by-sheet' : 'manual'
  );

  useEffect(() => {
    if (requestedTab === 'by-sheet' || requestedSheet) setActiveTab('by-sheet');
  }, [requestedTab, requestedSheet]);

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="CUSTOS · PRECIFICAÇÃO"
        title="Markup"
        description="Simulador de custo do produto e margem — combina insumos, mão de obra, overhead, frete, impostos, comissões e factoring para mostrar o preço de venda mínimo e a margem real por par."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="h-auto gap-1 bg-muted/50 p-1 rounded-lg">
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
            value="labor"
            className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
          >
            <Clock className="h-3.5 w-3.5" />
            Mão de Obra
          </TabsTrigger>
          <TabsTrigger
            value="sector"
            className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
          >
            <Gauge className="h-3.5 w-3.5" />
            MOD por Setor
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manual">
          <PricingCalculatorPanel />
        </TabsContent>

        <TabsContent value="by-sheet">
          <PricingByTechnicalSheetPanel initialSheetId={requestedSheet || undefined} />
        </TabsContent>

        <TabsContent value="labor">
          <LaborCostCalculatorPanel />
        </TabsContent>

        <TabsContent value="sector">
          <SectorPricingCalculator />
        </TabsContent>
      </Tabs>
    </div>
  );
}
