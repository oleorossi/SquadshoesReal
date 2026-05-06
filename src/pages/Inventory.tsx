import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Package, LayoutGrid, ArrowDownUp, History, Ribbon, Footprints, ExternalLink, Info
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import AppLayout from '@/components/layout/AppLayout';
import { useIsAdmin } from '@/hooks/useUserManagement';

import { MaterialsTab } from '@/components/inventory/tabs/MaterialsTab';
import { ReportTab } from '@/components/inventory/tabs/ReportTab';
import AuditLogTab from '@/components/inventory/tabs/AuditLogTab';
import StrapStockLogTab from '@/components/inventory/tabs/StrapStockLogTab';

const INVENTORY_TABS = new Set(['solados', 'materials', 'report', 'audit', 'strap-stock']);

export default function InventoryIndex() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedTab = searchParams.get('tab');
  const isAdmin = useIsAdmin();

   const [activeTab, setActiveTab] = useState(() => {
     const savedTab = localStorage.getItem('inventory_active_tab');
     if (requestedTab && INVENTORY_TABS.has(requestedTab)) return requestedTab;
     if (savedTab && INVENTORY_TABS.has(savedTab)) return savedTab;
     return 'materials';
   });

   const handleTabChange = (value: string) => {
     setActiveTab(value);
     localStorage.setItem('inventory_active_tab', value);
   };

  useEffect(() => {
    if (requestedTab && INVENTORY_TABS.has(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  return (
    <AppLayout>
      <div className="w-full space-y-6 page-enter">
        <div className="flex flex-col gap-2 mb-6">
          <div className="flex items-center gap-3">
            <Package className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Estoque & Gestão</h1>
          </div>
          <p className="text-muted-foreground">
            Visão geral, materiais e relatórios da fábrica
          </p>
        </div>

         <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <div className="overflow-x-auto pb-2">
             <TabsList className="inline-flex h-10 items-center justify-start rounded-md bg-muted p-1 text-muted-foreground w-auto min-w-full lg:min-w-0">
               <TabsTrigger value="materials" className="flex items-center gap-2">
                 <Package className="w-4 h-4" /> Materiais
               </TabsTrigger>
 
               <TabsTrigger value="solados" className="flex items-center gap-2">
                 <Footprints className="w-4 h-4" /> Solados
               </TabsTrigger>

              <TabsTrigger value="report" className="flex items-center gap-2">
                <LayoutGrid className="w-4 h-4" /> Painel
              </TabsTrigger>

              {isAdmin && (
                <>
                  <TabsTrigger value="audit" className="flex items-center gap-2">
                    <History className="w-4 h-4" /> Auditoria
                  </TabsTrigger>
                  <TabsTrigger value="strap-stock" className="flex items-center gap-2">
                    <Ribbon className="w-4 h-4" /> Corte de Tiras
                  </TabsTrigger>
                </>
              )}
            </TabsList>
          </div>

           <div className="mt-6">
             {activeTab === 'materials' && <MaterialsTab />}
             {activeTab === 'solados' && (
               <>
                 <div className="flex items-center justify-between gap-3 mb-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                   <div className="flex items-center gap-2 text-sm text-muted-foreground">
                     <Info className="h-4 w-4 text-primary shrink-0" />
                     <span>Esta aba mostra apenas o estoque por numeração e cor. Configurações técnicas, consumo, grade e silk estão em <strong className="text-foreground">Gestão de Solados</strong>.</span>
                   </div>
                   <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => navigate('/consumo-base')}>
                     <ExternalLink className="h-3.5 w-3.5" />
                     Gestão de Solados
                   </Button>
                 </div>
                 <MaterialsTab defaultGroupName="Solado" title="Solado" />
               </>
             )}
             {activeTab === 'report' && <ReportTab />}
            
            {isAdmin && (
              <>
                {activeTab === 'audit' && <AuditLogTab />}
                {activeTab === 'strap-stock' && <StrapStockLogTab />}
              </>
            )}
          </div>
        </Tabs>
      </div>
    </AppLayout>
  );
}
