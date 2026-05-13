import { useState } from 'react';
import { FileText, FileArrowUp as FileUp, FileArrowDown as FileDown, MagnifyingGlass as Search, Funnel as Filter } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import InvoicesEntradaTab from './InvoicesEntradaTab';
import InvoicesSaidaTab from './InvoicesSaidaTab';

export default function UnifiedInvoicesTab() {
  const [activeSubTab, setActiveSubTab] = useState('entrada');

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Central de Notas Fiscais
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Gestão unificada de entradas (compras) e saídas (vendas)</p>
        </div>
        
        <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full sm:w-auto">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="entrada" className="gap-2">
              <FileUp className="h-4 w-4" /> Entradas
            </TabsTrigger>
            <TabsTrigger value="saida" className="gap-2">
              <FileDown className="h-4 w-4" /> Saídas
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-4">
            <p className="text-xs font-semibold text-primary uppercase">Total no Mês (Entrada)</p>
            <p className="display text-2xl tabular-nums">R$ 45.230,00</p>
            <p className="text-[10px] text-muted-foreground">12 notas processadas</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="pt-4">
            <p className="text-xs font-semibold text-emerald-700 uppercase">Total no Mês (Saída)</p>
            <p className="display text-2xl tabular-nums text-emerald-700">R$ 128.450,00</p>
            <p className="text-[10px] text-muted-foreground">48 notas emitidas</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="pt-4">
            <p className="text-xs font-semibold text-amber-700 uppercase">Impostos Estimados</p>
            <p className="display text-2xl tabular-nums text-amber-700">R$ 15.414,00</p>
            <p className="text-[10px] text-muted-foreground">Base: 12% sobre saídas</p>
          </CardContent>
        </Card>
      </div>

      {activeSubTab === 'entrada' ? <InvoicesEntradaTab /> : <InvoicesSaidaTab />}
    </div>
  );
}