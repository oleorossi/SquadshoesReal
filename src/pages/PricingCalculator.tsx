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
import { Calculator, FileText } from '@phosphor-icons/react';
import PricingCalculatorPanel from '@/components/financial/PricingCalculatorPanel';
import PricingByTechnicalSheetPanel from '@/components/financial/PricingByTechnicalSheetPanel';

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
      {/* Header — Novidade editorial */}
      <div>
        <div className="eyebrow">Financeiro · Precificação</div>
        <h1 className="display text-2xl mt-1.5 sm:text-3xl">Markup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Simulador de custo do produto e margem — combina insumos, mão de obra, overhead, frete,
          impostos, comissões e factoring para mostrar o preço de venda mínimo e a margem real por par.
        </p>
      </div>

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
        </TabsList>

        <TabsContent value="manual">
          <PricingCalculatorPanel />
        </TabsContent>

        <TabsContent value="by-sheet">
          <PricingByTechnicalSheetPanel initialSheetId={requestedSheet || undefined} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
