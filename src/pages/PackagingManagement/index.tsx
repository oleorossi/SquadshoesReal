import {
  Package,
  Warehouse,
  Calculator,
  Gear,
  ShieldCheck,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { usePackagingStats } from '@/hooks/usePackaging';
import PackagingAlerts from '@/components/packaging/PackagingAlerts';
import PackagingStockPanel from '@/components/packaging/PackagingStockPanel';
import { PackagingDecision } from '@/components/packaging/PackagingDecision';
import SolePackagingConfigurationPanel from '@/components/packaging/SolePackagingConfigurationPanel';
import PackagingDebitAuditPanel from '@/components/packaging/PackagingDebitAuditPanel';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams } from 'react-router-dom';

/**
 * Gestão de Embalagens — piloto do sistema de telas (02/08/2026).
 *
 * O que mudou e por quê, pra não voltar atrás sem querer:
 *
 * R1 — A página era a ÚNICA do app com rolagem por âncora (`scroll-mt` +
 *      barra fixa que rolava até a seção). Quatro seções empilhadas viraram
 *      ABAS: o que não cabe na dobra é outra faceta, não mais rolagem.
 *
 * R3 — O trilho do topo mostra PENDÊNCIA primeiro (moldura de alerta), totais
 *      depois, neutros. Antes eram 4 cards iguais — "Tipos cadastrados" tinha
 *      o mesmo peso visual de "Alertas de Estoque".
 *
 * R5 — A seção "Vínculos com fichas" FOI APAGADA. Desde a migration
 *      20261110120000 ela só espelhava a configuração canônica do solado
 *      edita; a tela mostrava o mesmo dado duas vezes e nenhuma das duas era a
 *      fonte. Quem precisa ver o vínculo vê no lugar que o edita.
 */

/** Seleciona uma OP e mostra a sugestão de embalagem daquele pedido. */
const OrderPackagingDecision = () => {
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');

  const { data: orders = [] } = useQuery({
    queryKey: ['orders_for_packaging'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, quantity')
        .not('sale_order_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Selecionar pedido</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pedido (OP)</Label>
              <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione um pedido..." />
                </SelectTrigger>
                <SelectContent>
                  {orders.map(o => (
                    <SelectItem key={o.id} value={o.id}>
                      OP #{o.order_number} ({o.quantity} pares)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedOrder && (
        <PackagingDecision
          order={{
            orderId: selectedOrder.id,
            reference: selectedOrder.order_number,
            quantity: selectedOrder.quantity,
          }}
        />
      )}
    </div>
  );
};

/** Card do trilho de atenção. `alert` muda a moldura E o texto — cor sozinha
 *  não sobrevive ao tema escuro nem ao daltonismo (R2). */
function RailStat({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <Card className={`px-3 py-2 ${alert ? 'border-red-500/40 bg-red-500/10' : ''}`}>
      <p className={`text-xs uppercase tracking-wider ${alert ? 'text-red-600' : 'text-muted-foreground'}`}>
        {label}
      </p>
      <p className={`text-lg font-bold font-mono ${alert ? 'text-red-600' : ''}`}>{value}</p>
    </Card>
  );
}

const PackagingManagementPage = ({ embedded = false }: { embedded?: boolean }) => {
  const { data: stats, isLoading } = usePackagingStats();
  const [tab, setTab] = usePersistedState<string>('packaging-tab', 'stock');
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const requestedSoleGroupId = searchParams.get('soleGroupId');

  useEffect(() => {
    if (requestedTab && ['stock', 'soles', 'audit', 'alerts', 'decision'].includes(requestedTab)) {
      setTab(requestedTab);
    }
  }, [requestedTab, setTab]);

  const handleTabChange = (next: string) => {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    if (next !== 'soles') params.delete('soleGroupId');
    setSearchParams(params, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  const alertsCount = stats?.low_stock_alerts ?? 0;
  const semPreco = stats?.boxes_without_price ?? 0;
  const semTara = stats?.boxes_without_tare ?? 0;
  const semEmbalagem = stats?.soles_without_packaging ?? 0;
  const modosIncompletos = stats?.soles_with_incomplete_modes ?? 0;
  const fichasSemSolado = stats?.sheets_without_sole ?? 0;
  // Tudo que exige ação — vira o ponto na aba Alertas.
  const pendencias = alertsCount + semPreco + semTara + modosIncompletos + fichasSemSolado;

  return (
    <div className="space-y-4 pb-12">
      {!embedded && (
        <EditorialPageHeader
          sectionLabel="LOGÍSTICA · EMBALAGENS"
          title="Embalagens"
          description="Um único local para cadastro, estoque, configuração por tipo de solado e conferência do débito por pedido."
          actions={
            <div className="flex items-center gap-3 flex-wrap">
              {/* Pendência primeiro: o trilho responde "preciso agir?" antes de
                  "o que tem aqui?". Card de alerta só existe quando há o quê. */}
              {semEmbalagem > 0 && <RailStat label="Solados sem caixa" value={semEmbalagem} alert />}
              {fichasSemSolado > 0 && <RailStat label="Fichas sem solado" value={fichasSemSolado} alert />}
              {semPreco > 0 && <RailStat label="Caixa sem preço" value={semPreco} alert />}
              {alertsCount > 0 && <RailStat label="Abaixo do mínimo" value={alertsCount} alert />}
              {semTara > 0 && <RailStat label="Caixa sem tara" value={semTara} alert />}
              <RailStat label="Caixas" value={stats?.total_boxes ?? 0} />
              <RailStat label="Em estoque" value={(stats?.total_units ?? 0).toLocaleString('pt-BR')} />
            </div>
          }
        />
      )}

      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <HubTabsList
          tabs={[
            { value: 'stock', label: 'Cadastro & Estoque', icon: Warehouse },
            { value: 'soles', label: 'Configuração por Solado', icon: Gear, badge: modosIncompletos || undefined },
            { value: 'audit', label: 'Conferência de Débitos', icon: ShieldCheck },
            { value: 'alerts', label: 'Alertas', icon: AlertTriangle, badge: pendencias > 0 ? pendencias : undefined },
            { value: 'decision', label: 'Sugestão por pedido', icon: Calculator },
          ]}
        />

        <TabsContent value="stock" className="mt-4">
          <PackagingStockPanel />
        </TabsContent>

        <TabsContent value="soles" className="mt-4">
          <SolePackagingConfigurationPanel initialSoleGroupId={requestedSoleGroupId} />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <PackagingDebitAuditPanel />
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <PackagingAlerts />
        </TabsContent>

        <TabsContent value="decision" className="mt-4">
          <OrderPackagingDecision />
        </TabsContent>
      </Tabs>

      {embedded && stats && pendencias === 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5" />
          Nenhuma pendência de embalagem.
        </p>
      )}
    </div>
  );
};

export default PackagingManagementPage;
