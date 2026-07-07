import { useEffect, useState, lazy, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Package, GridFour as LayoutGrid, Bell, Minus, ClockCounterClockwise as History, Medal as Ribbon, ArrowsLeftRight as ArrowRightLeft } from '@phosphor-icons/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsAdmin } from '@/hooks/useUserManagement';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import { MaterialsTab } from '@/components/inventory/tabs/MaterialsTab';
import { ReportTab } from '@/components/inventory/tabs/ReportTab';
import { NotificationsTab } from '@/components/inventory/tabs/NotificationsTab';
import { ConversionReportTab } from '@/components/inventory/tabs/ConversionReportTab';
import AuditLogTab from '@/components/inventory/tabs/AuditLogTab';
 import StrapStockLogTab from '@/components/inventory/tabs/StrapStockLogTab';
 import StockHistory from './StockHistory';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

// Tabs principais
const MAIN_TABS = ['materials', 'overview', 'alerts', 'conversion'] as const;
type MainTab = typeof MAIN_TABS[number];

// Admin-only tabs — removidas da barra principal
const ADMIN_TABS = new Set(['audit', 'strap-stock']);

// Todas as tabs válidas (para leitura de URL)
 const ALL_TABS = new Set([...MAIN_TABS, ...ADMIN_TABS, 'solados', 'history']);

export default function Index() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const requestedTab = searchParams.get('tab');

  // Redireciona tabs legadas "solados" → /solados (SolesHub). Mudança 18/05/2026:
  // gestão de solados centralizada num único lugar; bookmarks/links antigos
  // não morrem de imediato — viram redirect.
  useEffect(() => {
    if (requestedTab === 'solados') {
      navigate('/solados', { replace: true });
    }
  }, [requestedTab, navigate]);

  // Mapeia tabs legadas para o novo esquema
  const resolveTab = (tab: string | null): MainTab => {
    if (!tab) return 'materials';
    // Tabs admin — só acessa se for admin
    if (ADMIN_TABS.has(tab) && isAdmin) return tab as any;
    // "componentes" era tab — agora vira filtro dentro de materials
    if (tab === 'componentes') return 'materials';
    // "consumables" foi removida — redireciona pra materials
    if (tab === 'consumables') return 'materials';
    // "report" / "painel" mapeados para overview
    if (tab === 'report' || tab === 'painel') return 'overview';
    // "notifications" → alerts
    if (tab === 'notifications') return 'alerts';
     if (MAIN_TABS.includes(tab as any)) return tab as any;
     if (tab === 'history') return 'history' as any;
    return 'materials';
  };

   const [activeTab, setActiveTab] = useState<any>(() => resolveTab(requestedTab));

  useEffect(() => {
    if (requestedTab && ALL_TABS.has(requestedTab)) {
      setActiveTab(resolveTab(requestedTab));
    }
  }, [requestedTab]);

  return (
    <div className="space-y-6 editorial-stagger">
      <EditorialPageHeader
        sectionNumber="01"
        sectionLabel="INVENTÁRIO SQUAD"
        title="Estoque"
        description="Materiais, consumos, alertas e visão geral do inventário"
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as MainTab)}>
        {/* ── Tab bar principal ── */}
        <TabsList indicator="none" className="h-auto gap-1 bg-muted/50 p-1 rounded-lg">
          <TabsTrigger
            value="materials"
            className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
          >
            <Package className="h-3.5 w-3.5" />
            Materiais
          </TabsTrigger>
          <TabsTrigger
            value="overview"
            className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Visão Geral
          </TabsTrigger>
          <TabsTrigger
            value="alerts"
            className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
          >
            <Bell className="h-3.5 w-3.5" />
            Alertas
          </TabsTrigger>
           <TabsTrigger
             value="conversion"
             className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
           >
             <ArrowRightLeft className="h-3.5 w-3.5" />
             Conversões
           </TabsTrigger>
           <TabsTrigger
             value="history"
             className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
           >
             <History className="h-3.5 w-3.5" />
             Histórico
           </TabsTrigger>

          {/* ── Admin tabs — separadas visualmente ── */}
          {isAdmin && (
            <>
              <Separator orientation="vertical" className="h-5 mx-1" />
              <TabsTrigger
                value="audit"
                className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md opacity-60 data-[state=active]:opacity-100"
              >
                <History className="h-3.5 w-3.5" />
                Auditoria
              </TabsTrigger>
              <TabsTrigger
                value="strap-stock"
                className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md opacity-60 data-[state=active]:opacity-100"
              >
                <Ribbon className="h-3.5 w-3.5" />
                Corte Tiras
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <div className="mt-4">
          {/* ── Visão Geral ── */}
          <TabsContent value="overview">
            <ReportTab />
          </TabsContent>

          {/* ── Materiais — árvore Setor → Família → Grupo (GroupOrganizationPanel) ── */}
          <TabsContent value="materials">
            <MaterialsTab />
          </TabsContent>

          {/* ── Alertas ── */}
          <TabsContent value="alerts">
            <NotificationsTab />
          </TabsContent>

          {/* ── Relatório de Conversão ── */}
          <TabsContent value="conversion">
            <ConversionReportTab />
          </TabsContent>

           {/* ── Histórico ── */}
           <TabsContent value="history">
             <StockHistory />
           </TabsContent>

          {/* ── Admin: Auditoria ── */}
          {isAdmin && (
            <>
              <TabsContent value="audit">
                <AuditLogTab />
              </TabsContent>
              <TabsContent value="strap-stock">
                <StrapStockLogTab />
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}
