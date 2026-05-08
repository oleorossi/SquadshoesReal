import { useSearchParams, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
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
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/sales')} aria-label="Voltar para Pedidos de Venda">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Consumo Consolidado</h1>
            <p className="text-sm text-muted-foreground">
              {saleOrderIds.length} pedido(s) selecionado(s)
            </p>
          </div>
        </div>

        {saleOrderIds.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">
            Nenhum pedido selecionado. Volte e selecione pedidos para ver o consumo.
          </p>
        ) : (
          <SummaryConsumptionPanel saleOrderIds={saleOrderIds} />
        )}
      </div>
    </AppLayout>
  );
}
