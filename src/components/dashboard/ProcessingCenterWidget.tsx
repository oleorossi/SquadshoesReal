 import { Pulse as Activity } from '@phosphor-icons/react';
 import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
 import { cn } from '@/lib/utils';
 
 interface ProcessingCenterWidgetProps {
   recentActivity: any[];
   fmtDate: (d: Date) => string;
 }
 
 export function ProcessingCenterWidget({ recentActivity, fmtDate }: ProcessingCenterWidgetProps) {
   return (
     <Card className="card-hover-elevation">
       <CardHeader className="pb-2">
         <CardTitle className="text-sm font-semibold flex items-center gap-2 text-success">
           <Activity className="h-4 w-4" />
           Centro de Processamento
         </CardTitle>
       </CardHeader>
       <CardContent>
         {recentActivity.length === 0 ? (
           <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma atividade</p>
         ) : (
           <div className="space-y-1 max-h-[200px] overflow-y-auto">
             {recentActivity.slice(0, 12).map((act, i) => (
               <div key={i} className="flex items-start gap-2.5 py-1.5 px-1 rounded hover:bg-muted/30">
                 <div className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0',
                   act.type === 'op' ? 'bg-primary' : 'bg-success',
                 )} />
                 <div className="min-w-0 flex-1">
                   <p className="text-xs font-semibold truncate">{act.label}</p>
                   <p className="text-[11px] text-muted-foreground truncate">{act.detail}</p>
                 </div>
                 <p className="text-[11px] text-muted-foreground shrink-0">{fmtDate(act.time)}</p>
               </div>
             ))}
           </div>
         )}
       </CardContent>
     </Card>
   );
 }