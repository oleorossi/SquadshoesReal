import { useState } from 'react';
import { FileText, FileArrowUp as FileUp, FileArrowDown as FileDown } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInvoiceSummary } from '@/hooks/useInvoiceSummary';
import { todayISO } from '@/lib/date';
import InvoicesEntradaTab from './InvoicesEntradaTab';
import InvoicesSaidaTab from './InvoicesSaidaTab';

export default function UnifiedInvoicesTab() {
  const [activeSubTab, setActiveSubTab] = useState('entrada');
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const { incoming, outgoing } = useInvoiceSummary(month);
  const fmt = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="invoice-summary-month">Mês de emissão dos indicadores</Label>
          <Input id="invoice-summary-month" type="month" value={month}
            onChange={event => { if (event.target.value) setMonth(event.target.value); }} className="w-44" />
        </div>
        <p className="text-xs text-muted-foreground pb-2">Valores documentais, não pagamentos ou recebimentos. As listas abaixo exibem todos os períodos.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-label="Resumo real de notas fiscais">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-4">
            <p className="text-xs font-semibold text-primary uppercase">Entradas importadas</p>
            <p className="display text-2xl tabular-nums">{incoming.isError ? 'Indisponível' : incoming.isPending ? 'Carregando…' : fmt(incoming.data.total)}</p>
            <p className="text-xs text-muted-foreground">{incoming.isError ? 'Falha na consulta; o total não foi estimado.' : incoming.data ? `${incoming.data.count} nota(s) no mês selecionado` : 'Consultando documentos'}</p>
            {incoming.isError ? <Button size="sm" variant="outline" className="mt-2" onClick={() => incoming.refetch()}>Tentar entradas novamente</Button> : null}
          </CardContent>
        </Card>
        <Card className="bg-emerald-500/10 border-emerald-500/20">
          <CardContent className="pt-4">
            <p className="text-xs font-semibold text-emerald-600 uppercase">Saídas autorizadas</p>
            <p className="display text-2xl tabular-nums text-emerald-600">{outgoing.isError ? 'Indisponível' : outgoing.isPending ? 'Carregando…' : fmt(outgoing.data.total)}</p>
            <p className="text-xs text-muted-foreground">{outgoing.isError ? 'Falha na consulta; o total não foi estimado.' : outgoing.data ? `${outgoing.data.count} NF-e no mês · exclui homologação identificada` : 'Consultando documentos'}</p>
            {outgoing.data?.unknownEnvironment && !outgoing.isError ? <p className="text-xs text-amber-600 mt-1">{outgoing.data.unknownEnvironment} nota(s) legada(s) sem ambiente informado.</p> : null}
            {outgoing.isError ? <Button size="sm" variant="outline" className="mt-2" onClick={() => outgoing.refetch()}>Tentar saídas novamente</Button> : null}
          </CardContent>
        </Card>
        <Card className="bg-amber-500/10 border-amber-500/20">
          <CardContent className="pt-4">
            <p className="text-xs font-semibold text-amber-600 uppercase">Saídas com pendência</p>
            <p className="display text-2xl tabular-nums text-amber-600">{outgoing.isError ? 'Indisponível' : outgoing.isPending ? 'Carregando…' : outgoing.data.processing + outgoing.data.failed}</p>
            <p className="text-xs text-muted-foreground">{outgoing.data && !outgoing.isError ? `${outgoing.data.processing} em processamento · ${outgoing.data.failed} com erro ou rejeição` : 'Consulta do mês selecionado'}</p>
            <p className="text-xs text-muted-foreground mt-1">Tributos devem ser conferidos na apuração fiscal; não se aplica alíquota genérica às vendas.</p>
          </CardContent>
        </Card>
      </div>

      {activeSubTab === 'entrada' ? <InvoicesEntradaTab /> : <InvoicesSaidaTab />}
    </div>
  );
}
