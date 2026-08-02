import { useState } from 'react';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Tag, Printer, Gear as Settings2, Sparkle as Sparkles, Cpu, ChartBar as BarChart3, PencilLine as PenLine } from '@phosphor-icons/react';
import { LabelTemplatesTab } from '@/components/label-system/LabelTemplatesTab';
import { LabelProductionTab } from '@/components/label-system/LabelProductionTab';
import { PrintDashboardTab } from '@/components/label-system/PrintDashboardTab';
import { OptimizationPanel } from '@/components/label-system/OptimizationPanel';
import { PrinterManagementTab } from '@/components/label-system/PrinterManagementTab';
import { LabelAnalyticsDashboard } from '@/components/label-system/LabelAnalyticsDashboard';
import { LabelManualTab } from '@/components/label-system/LabelManualTab';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import type { LabelTemplate } from '@/types/label-system';

const DEMO_TEMPLATE: LabelTemplate = {
  id: 'demo', name: 'Template Demo', category: 'thermal', type: 'thermal',
  dimensions: { width: 100, height: 30, unit: 'mm' },
  fields: [
    { id: '1', name: 'Produto', type: 'text', position: { x: 5, y: 5, width: 40, height: 10 }, styling: { font_size: 10, font_weight: 'bold', text_align: 'left', text_transform: 'uppercase' }, data_source: 'product_name' },
    { id: '2', name: 'Cor', type: 'dynamic_text', position: { x: 5, y: 16, width: 35, height: 8 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'color' },
    { id: '3', name: 'Código', type: 'barcode', position: { x: 60, y: 3, width: 35, height: 24 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'barcode', barcode_format: 'CODE128' },
  ],
  print_settings: { dpi: 203, color_mode: 'monochrome', copies_default: 1 },
  is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};

export default function LabelSystem() {
  // A aba mora na URL (contrato do lote L6a): o useState local não sobrevivia
  // ao F5 nem ao botão Voltar.
  const { value: activeTab, setValue: setActiveTab } = useUrlTabState({
    values: ['production', 'manual', 'templates', 'dashboard', 'printers', 'optimization', 'analytics'] as const,
    defaultValue: 'production',
  });
  const [optimizationTemplate, setOptimizationTemplate] = useState<LabelTemplate>(DEMO_TEMPLATE);

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
            { value: 'printers', label: 'Impressoras', icon: Cpu },
            { value: 'optimization', label: 'Otimização', icon: Sparkles },
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
        <TabsContent value="printers">
          <PrinterManagementTab />
        </TabsContent>
        <TabsContent value="optimization">
          <OptimizationPanel
            template={optimizationTemplate}
            onApply={setOptimizationTemplate}
          />
        </TabsContent>
        <TabsContent value="analytics">
          <LabelAnalyticsDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
