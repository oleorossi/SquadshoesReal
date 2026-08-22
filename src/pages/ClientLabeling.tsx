import { ClientLabelingWorkspace } from '@/components/client-labeling/ClientLabelingWorkspace';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

/**
 * Módulo deliberadamente separado da etiquetagem padrão da fábrica.
 *
 * O arquivo do cliente usa parser, geometria e gerador próprios; esta página
 * não importa templates nem configurações de `LabelSystem`.
 */
export default function ClientLabeling() {
  return (
    <div className="p-4 md:p-6 space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="ETIQUETAGEM · CLIENTE"
        title="ETIQUETAGEM CLIENTE"
        description="Importe o pedido do cliente, selecione os SKUs e gere o rolo couchê dedicado sem alterar os padrões de etiqueta da fábrica."
      />

      <ClientLabelingWorkspace />
    </div>
  );
}
