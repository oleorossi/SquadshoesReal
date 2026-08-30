import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Package, X } from '@phosphor-icons/react';
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
 *
 * O X padrão do Dialog (16px no canto) sumia neste canvas de 96vw. Cabeçalho
 * e rodapé trazem o fechar no chrome que NÃO rola — visível o tempo todo.
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
      <DialogContent
        hideCloseButton
        className="flex h-[96dvh] w-[96vw] max-h-[96dvh] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex shrink-0 flex-row items-start justify-between gap-4 space-y-0 border-b-2 border-foreground bg-background px-5 py-3 text-left">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <Package className="h-5 w-5 text-primary" />
              Consumo de materiais
            </DialogTitle>
            <DialogDescription className="mt-1">
              {scope} — o que comprar, quanto falta e a grade do solado
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Fechar consumo"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-[1.5px] border-foreground/40 bg-background text-foreground transition-colors hover:border-foreground hover:bg-foreground hover:text-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-6 w-6" weight="bold" aria-hidden="true" />
            <span className="sr-only">Fechar</span>
          </DialogClose>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {open ? (
            <SummaryConsumptionPanel embedded saleOrderIds={saleOrderIds} onGerarOC={onGerarOC} />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end border-t border-border bg-background px-5 py-2">
          <DialogClose asChild>
            <Button type="button" variant="outline" size="sm" className="gap-1.5">
              <X className="h-4 w-4" weight="bold" aria-hidden="true" />
              Fechar
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
