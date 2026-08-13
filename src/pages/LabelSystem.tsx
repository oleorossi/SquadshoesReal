import { useUrlTabState } from '@/hooks/useUrlTabState';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Tag, Printer, Gear as Settings2, ChartBar as BarChart3, PencilLine as PenLine } from '@phosphor-icons/react';
import { LabelTemplatesTab } from '@/components/label-system/LabelTemplatesTab';
import { LabelProductionTab } from '@/components/label-system/LabelProductionTab';
import { PrintDashboardTab } from '@/components/label-system/PrintDashboardTab';
import { LabelAnalyticsDashboard } from '@/components/label-system/LabelAnalyticsDashboard';
import { LabelManualTab } from '@/components/label-system/LabelManualTab';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

export default function LabelSystem() {
  // A aba mora na URL (contrato do lote L6a): o useState local não sobrevivia
  // ao F5 nem ao botão Voltar.
  const { value: activeTab, setValue: setActiveTab } = useUrlTabState({
    values: ['production', 'manual', 'templates', 'dashboard', 'analytics'] as const,
    defaultValue: 'production',
  });

  return (
    <div className="p-4 md:p-6 space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="SISTEMA · ETIQUETAS"
        title="Sistema de Etiquetas"
        description="Gerencie etiquetas, gere impressões e acompanhe a fila — integrado às ordens de produção"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <HubTabsList
          tabs={[
            { value: 'production', label: 'Geração & Impressão', icon: Tag },
            { value: 'manual', label: 'Manual', icon: PenLine },
            { value: 'templates', label: 'Templates', icon: Settings2 },
            { value: 'dashboard', label: 'Fila', icon: Printer },
            { value: 'analytics', label: 'Analytics', icon: BarChart3 },
          ]}
        />

        <TabsContent value="production">
          <LabelProductionTab />
        </TabsContent>
        <TabsContent value="manual">
          <LabelManualTab />
        </TabsContent>
        <TabsContent value="templates">
          <LabelTemplatesTab />
        </TabsContent>
        <TabsContent value="dashboard">
          <PrintDashboardTab />
        </TabsContent>
        <TabsContent value="analytics">
          <LabelAnalyticsDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
