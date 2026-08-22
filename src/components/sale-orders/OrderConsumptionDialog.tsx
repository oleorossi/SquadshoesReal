import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Package } from '@phosphor-icons/react';
import SummaryConsumptionPanel from '@/components/sale-orders/SummaryConsumptionPanel';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  saleOrderIds: string[];
  orderNumbers: string[];
  onGerarOC?: () => void;
};

/**
 * Consumo de 1 PV (ou poucos) em tela cheia, sem sair do pedido.
 *
 * A página `?view=consumo` continua existindo pro lote (N PVs, URL compartilhável).
 * Daqui o operador volta no X/Esc pro detalhe do PV — o clique antigo
 * navegava embora e o "Voltar aos pedidos" não reabria o PV.
 */
export default function OrderConsumptionDialog({
  open,
  onOpenChange,
  saleOrderIds,
  orderNumbers,
  onGerarOC,
}: Props) {
  const scope = orderNumbers.length === 1
    ? orderNumbers[0]
    : `${orderNumbers.length} pedidos`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[96dvh] w-[96vw] max-h-[96dvh] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b bg-muted/40 px-5 py-4 pr-12 space-y-0 text-left">
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Package className="h-5 w-5 text-primary" />
            Consumo de materiais
          </DialogTitle>
          <DialogDescription className="mt-1">
            {scope} — o que comprar, quanto falta e a grade do solado
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {open ? (
            <SummaryConsumptionPanel saleOrderIds={saleOrderIds} onGerarOC={onGerarOC} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
