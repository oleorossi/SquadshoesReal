import { WarningCircle as AlertCircle, CheckCircle as CheckCircle2, Lock, Image as ImageIcon, Hash } from '@phosphor-icons/react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ProductionCardProps {
  order: {
    id: string;
    reference: string;
    client_name?: string;
    material_status?: string;
    order_number?: string;
    client_order_number?: string;
    image_url?: string;
    color?: string;
    quantity?: number;
  };
  onStartProduction?: (orderId: string) => void;
}

export function ProductionCard({ order, onStartProduction }: ProductionCardProps) {
  const isInsufficient = order.material_status === 'INSUFICIENTE';
  
  return (
    <div className={`p-4 border-l-4 rounded-lg shadow-sm bg-card ${isInsufficient ? 'border-l-amber-500 bg-amber-500/5' : 'border-l-emerald-500'}`}>
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1 mb-1">
            <p className="text-xs font-bold text-primary bg-primary/5 px-1.5 py-0.5 rounded flex items-center gap-1">
              <Hash className="h-2 w-2" /> {order.order_number || 'N/A'}
            </p>
            {order.client_order_number && (
              <p className="text-xs font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex items-center gap-1">
                Ref: {order.client_order_number}
              </p>
            )}
          </div>
          
          <Dialog>
            <DialogTrigger asChild>
              <h4 className="font-bold text-foreground hover:text-primary cursor-pointer transition-colors truncate">
                {order.client_name || 'Cliente Final'}
              </h4>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Resumo do Pedido - {order.client_name}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg">
                  <div className="h-20 w-20 rounded bg-muted flex items-center justify-center overflow-hidden border">
                    {order.image_url ? (
                      <img src={order.image_url} alt={order.reference} className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold">{order.reference}</p>
                    <p className="text-xs text-muted-foreground">Cor: {order.color || 'Padrão'}</p>
                    <p className="text-sm font-semibold mt-1">{order.quantity} pares</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="p-2 border rounded">
                    <p className="text-xs text-muted-foreground">Nº Pedido Interno</p>
                    <p className="font-mono font-bold">#{order.order_number}</p>
                  </div>
                  <div className="p-2 border rounded">
                    <p className="text-xs text-muted-foreground">Nº Pedido Cliente</p>
                    <p className="font-mono font-bold">{order.client_order_number || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          
          <p className="text-xs text-muted-foreground font-medium truncate">{order.reference}</p>
        </div>
        
        <div className="flex flex-col items-end gap-1">
          {isInsufficient ? (
            <Badge variant="outline" className="text-amber-600 border-amber-500/30 bg-amber-500/10 flex gap-1 h-5 px-1.5 text-xs">
              <AlertCircle className="h-2.5 w-2.5" /> Insuficiente
            </Badge>
          ) : (
            <Badge variant="outline" className="text-green-600 border-green-500/30 bg-green-500/10 flex gap-1 h-5 px-1.5 text-xs">
              <CheckCircle2 className="h-2.5 w-2.5" /> Pronto
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {isInsufficient ? (
          <Button disabled className="w-full cursor-not-allowed text-xs gap-2" variant="secondary">
            <Lock className="h-3 w-3" /> Aguardando Almoxarifado
          </Button>
        ) : (
          <Button 
            onClick={() => onStartProduction?.(order.id)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-xs"
          >
            Iniciar Produção
          </Button>
        )}
      </div>
    </div>
  );
}