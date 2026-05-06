 import { Badge } from '@/components/ui/badge';
 import { Button } from '@/components/ui/button';
 import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Package2, Truck, CheckCircle2 } from 'lucide-react';
import { useFinishingPackages, useUpdatePackage } from '@/hooks/useProductionWaves';

export function FinishingSplitTable({ waveId }: { waveId: string }) {
  const { data: pkgs = [], isLoading } = useFinishingPackages(waveId);
  const update = useUpdatePackage();

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando split…</div>;
  if (!pkgs.length) return (
    <div className="text-sm text-muted-foreground italic p-4 bg-muted/40 rounded border border-dashed">
      Split ainda não gerado. Ele é criado quando a onda entra em Acabamento.
    </div>
  );

  // agrupa por loja
  const byStore = pkgs.reduce((acc, p) => {
    const key = p.store_name ?? 'Sem loja';
    (acc[key] ??= []).push(p);
    return acc;
  }, {} as Record<string, typeof pkgs>);

  return (
    <div className="space-y-3">
      {Object.entries(byStore).map(([store, items]) => (
        <div key={store} className="border rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-muted border-b flex items-center justify-between">
            <div className="font-bold text-sm flex items-center gap-2">
              <Package2 className="w-4 h-4" />
              {store}
            </div>
            <Badge variant="outline">
              {items.reduce((s, i) => s + Number(i.quantity), 0)} pares
            </Badge>
          </div>
           <Table>
             <TableBody>
               {items.map((p) => (
                 <TableRow key={p.id}>
                   <TableCell className="px-3 py-2 text-xs">
                     <div className="font-mono">{p.reference_id?.slice(0, 8)}</div>
                     <div className="text-muted-foreground">cor {p.color || '—'}</div>
                   </TableCell>
                   <TableCell className="px-3 py-2 text-right tabular-nums">{p.quantity}</TableCell>
                   <TableCell className="px-3 py-2 w-40">
                     {p.status === 'pending' && (
                       <Button
                         size="sm" variant="outline" className="w-full"
                         onClick={() => update.mutate({ packageId: p.id, status: 'packed' })}
                       >
                         <CheckCircle2 className="w-3 h-3 mr-1" /> Embalar
                       </Button>
                     )}
                     {p.status === 'packed' && (
                       <Button
                         size="sm" className="w-full"
                         onClick={() => update.mutate({ packageId: p.id, status: 'shipped' })}
                       >
                         <Truck className="w-3 h-3 mr-1" /> Enviar
                       </Button>
                     )}
                     {p.status === 'shipped' && (
                       <Badge className="w-full justify-center bg-success/10 text-success">
                         Enviado
                       </Badge>
                     )}
                   </TableCell>
                 </TableRow>
               ))}
             </TableBody>
           </Table>
        </div>
      ))}
    </div>
  );
}
