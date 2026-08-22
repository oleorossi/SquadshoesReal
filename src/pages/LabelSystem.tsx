import { useUrlTabState } from '@/hooks/useUrlTabState';
import { Navigate } from 'react-router-dom';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Tag, Printer, Gear as Settings2, ChartBar as BarChart3, PencilLine as PenLine, Checks, FilePdf } from '@phosphor-icons/react';
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
    values: ['production', 'manual', 'client-import', 'templates', 'dashboard', 'analytics'] as const,
    defaultValue: 'production',
  });

  if (activeTab === 'client-import') {
    return <Navigate to="/etiquetagem-cliente" replace />;
  }

  return (
    <div className="p-4 md:p-6 space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="SISTEMA · ETIQUETAS"
        title="Central de Etiquetagem"
        description="Prepare, confira e acompanhe as impressões vinculadas à produção em um único fluxo."
      />

      <div className="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-2 xl:grid-cols-4" aria-label="Fluxo operacional da etiquetagem">
        {[
          { step: '01', title: 'Preparar', description: 'Selecione OPs da fábrica ou lance uma etiqueta avulsa.', icon: Tag },
          { step: '02', title: 'Conferir', description: 'Revise referência, cor, grade, quantidade e modelo ativo.', icon: Checks },
          { step: '03', title: 'Gerar', description: 'Monte o PDF sem alterar o padrão cadastrado da etiqueta.', icon: FilePdf },
          { step: '04', title: 'Confirmar', description: 'Registre a impressão física e mantenha a fila rastreável.', icon: Printer },
        ].map(item => (
          <div key={item.step} className="flex min-h-24 gap-3 border-border p-4 sm:[&:nth-child(even)]:border-l xl:border-l xl:first:border-l-0">
            <div className="font-mono text-xs font-bold text-primary">{item.step}</div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <item.icon className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-bold text-foreground">{item.title}</p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
            </div>
          </div>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <HubTabsList
          tabs={[
            { value: 'production', label: 'Produção', icon: Tag, group: 'Operação' },
            { value: 'manual', label: 'Lançamento avulso', icon: PenLine, group: 'Operação' },
            { value: 'dashboard', label: 'Fila e conferência', icon: Printer, group: 'Controle' },
            { value: 'analytics', label: 'Indicadores', icon: BarChart3, group: 'Controle' },
            { value: 'templates', label: 'Modelos', icon: Settings2, group: 'Configuração' },
          ]}
          ariaLabel="Áreas da central de etiquetagem"
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
