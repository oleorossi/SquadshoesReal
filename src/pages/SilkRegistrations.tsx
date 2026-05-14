import { SilkGlobalPanel } from '@/components/technical-sheets/SilkGlobalPanel';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

export default function SilkRegistrations() {
  return (
    <div className="space-y-6 page-enter">
      <EditorialPageHeader
        sectionLabel="SISTEMA · Cadastros"
        title="Cadastro de Silk por Solado"
        description="Gerencie qual silk deve ser utilizada para cada tipo de solado e cliente."
      />
      <SilkGlobalPanel />
    </div>
  );
}
