 import { Package, Palette, Ruler, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';
 import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
 import { Badge } from '@/components/ui/badge';
 import { cn } from '@/lib/utils';
 import { useNavigate } from 'react-router-dom';
 
 interface InventoryStatusWidgetProps {
   criticalStock: any[];
 }
 
 export function InventoryStatusWidget({ criticalStock }: InventoryStatusWidgetProps) {
   const navigate = useNavigate();
 
   return (
     <Card className="card-hover-elevation cursor-pointer" onClick={() => navigate('/estoque')}>
       <CardHeader className="pb-2">
         <div className="flex items-center justify-between">
           <CardTitle className="text-sm font-semibold flex items-center gap-2">
             <Package className="h-4 w-4 text-primary" />
             Status do Estoque
           </CardTitle>
           <div className="flex gap-2">
             <Badge variant="outline" className="text-[11px] gap-1">
               <Palette className="h-3 w-3" /> Cores
             </Badge>
             <Badge variant="outline" className="text-[11px] gap-1">
               <Ruler className="h-3 w-3" /> Tamanhos
             </Badge>
           </div>
         </div>
       </CardHeader>
       <CardContent>
         {criticalStock.length === 0 ? (
           <div className="py-8 text-center">
             <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2 opacity-60" />
             <p className="text-sm text-muted-foreground">Todos acima do mínimo</p>
           </div>
         ) : (
           <div className="space-y-1 max-h-[200px] overflow-y-auto">
             {criticalStock.sort((a, b) => a.quantity - b.quantity).slice(0, 10).map(p => (
               <div key={p.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30 border-b last:border-0">
                 <div className="min-w-0">
                   <p className="text-xs font-medium truncate">{p.name}</p>
                   {p.color && <p className="text-[11px] text-muted-foreground">{p.color}</p>}
                 </div>
                 <div className="text-right shrink-0 ml-2">
                   <p className={cn('text-xs font-mono font-bold', p.quantity === 0 ? 'text-destructive' : 'text-warning')}>
                     {Number(p.quantity).toLocaleString('pt-BR')}
                   </p>
                   <p className="text-[11px] text-muted-foreground font-mono">mín {Number(p.min_stock).toLocaleString('pt-BR')}</p>
                 </div>
               </div>
             ))}
           </div>
         )}
       </CardContent>
     </Card>
   );
 }