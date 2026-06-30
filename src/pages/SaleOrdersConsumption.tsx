import { useSearchParams, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { ArrowLeft, FileText } from '@phosphor-icons/react';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import SummaryConsumptionPanel from '@/components/sale-orders/SummaryConsumptionPanel';

export default function SaleOrdersConsumption() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const saleOrderIds = useMemo(() => {
    const ids = searchParams.get('ids');
    return ids ? ids.split(',').filter(Boolean) : [];
  }, [searchParams]);

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="COMERCIAL · CONSUMO"
          title="Consumo Consolidado"
          description={`${saleOrderIds.length} ${saleOrderIds.length === 1 ? 'pedido selecionado' : 'pedidos selecionados'}`}
          actions={
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/sales')}>
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Button>
          }
        />

        {saleOrderIds.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nenhum pedido selecionado"
            description="Volte e selecione pedidos para ver o consumo consolidado de materiais."
            action={
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/sales')}>
                <ArrowLeft className="h-4 w-4" /> Selecionar pedidos
              </Button>
            }
          />
        ) : (
          <SummaryConsumptionPanel saleOrderIds={saleOrderIds} />
        )}
      </div>
    </AppLayout>
  );
}
