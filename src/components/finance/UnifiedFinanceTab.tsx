import { useState } from 'react';
import { DollarSign, TrendingUp, TrendingDown, Target } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function UnifiedFinanceTab({ 
  payableContent, 
  receivableContent,
  totals
}: { 
  payableContent: React.ReactNode; 
  receivableContent: React.ReactNode;
  totals: {
    payable: number;
    receivable: number;
    balance: number;
  }
}) {
  const [activeSubTab, setActiveSubTab] = useState('payable');

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Gestão Financeira Unificada
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Visão consolidada de Contas a Pagar e a Receber</p>
        </div>
        
        <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full sm:w-auto">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="payable" className="gap-2">
              <TrendingDown className="h-4 w-4" /> A Pagar
            </TabsTrigger>
            <TabsTrigger value="receivable" className="gap-2">
              <TrendingUp className="h-4 w-4" /> A Receber
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="pt-4">
            <p className="text-xs font-semibold text-destructive uppercase">Total a Pagar</p>
            <p className="text-2xl font-bold text-destructive">{fmt(totals.payable)}</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="pt-4">
            <p className="text-xs font-semibold text-emerald-700 uppercase">Total a Receber</p>
            <p className="text-2xl font-bold text-emerald-700">{fmt(totals.receivable)}</p>
          </CardContent>
        </Card>
        <Card className={totals.balance >= 0 ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"}>
          <CardContent className="pt-4">
            <p className="text-xs font-semibold uppercase">Saldo Projetado</p>
            <p className={`text-2xl font-bold ${totals.balance >= 0 ? 'text-primary' : 'text-destructive'}`}>
              {fmt(totals.balance)}
            </p>
          </CardContent>
        </Card>
      </div>

      {activeSubTab === 'payable' ? payableContent : receivableContent}
    </div>
  );
}