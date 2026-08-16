import { ShoppingBag } from '@phosphor-icons/react';
import { ArtisanalStrapPurchaseOrdersSurface } from '@/components/artisanal-straps/ArtisanalStrapPurchaseOrdersSurface';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Badge } from '@/components/ui/badge';
import { useArtisanalStrapPurchaseOrderApprovalCount } from '@/hooks/useArtisanalStraps';

export default function PurchaseOrderApprovals() {
  const countQuery = useArtisanalStrapPurchaseOrderApprovalCount(true);

  return (
    <div className="w-full space-y-4 page-enter editorial-stagger">
      <EditorialPageHeader
        sectionLabel="ADMINISTRADOR · COMPRAS"
        title="Aprovação de Ordens de Compra"
        description="Decisão administrativa das OCs automáticas de tira pronta, com documento oficial congelado."
        meta="FILA ADMINISTRATIVA · PDF OFICIAL IMUTÁVEL"
        actions={(
          <Badge variant={(countQuery.data || 0) > 0 ? 'default' : 'outline'} className="gap-1.5 px-3 py-1.5">
            <ShoppingBag className="h-4 w-4" />
            {countQuery.isLoading ? '…' : countQuery.data || 0} aguardando aprovação
          </Badge>
        )}
      />
      <ArtisanalStrapPurchaseOrdersSurface mode="approval" />
    </div>
  );
}
