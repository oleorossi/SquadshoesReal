 import { Users, Star, Footprints } from 'lucide-react';
 import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
 import { cn } from '@/lib/utils';
 
 interface CustomerInsightsPanelProps {
   recentActivity: any[];
   topModels: any[];
   fmtDate: (d: Date) => string;
 }
 
 export function CustomerInsightsPanel({ recentActivity, topModels, fmtDate }: CustomerInsightsPanelProps) {
   return (
     <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
       <Card className="lg:col-span-2 card-hover-elevation">
         <CardHeader className="pb-2">
           <CardTitle className="text-sm font-semibold flex items-center gap-2">
             <Users className="h-4 w-4 text-primary" />
             Insights de Clientes
           </CardTitle>
         </CardHeader>
         <CardContent>
           <div className="space-y-4">
             <div className="grid grid-cols-3 gap-4">
               <div className="p-3 bg-muted/30 rounded-lg text-center">
                 <p className="text-[10px] text-muted-foreground uppercase font-bold">Lealdade</p>
                 <p className="text-lg font-bold">85%</p>
               </div>
               <div className="p-3 bg-muted/30 rounded-lg text-center">
                 <p className="text-[10px] text-muted-foreground uppercase font-bold">Satisfação</p>
                 <div className="flex justify-center mt-1">
                   <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                   <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                   <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                   <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                   <Star className="h-4 w-4 text-muted shrink-0" />
                 </div>
               </div>
               <div className="p-3 bg-muted/30 rounded-lg text-center">
                 <p className="text-[10px] text-muted-foreground uppercase font-bold">Retenção</p>
                 <p className="text-lg font-bold text-success">+12%</p>
               </div>
             </div>
             <div className="space-y-2">
               <p className="text-xs font-semibold">Atividade Recente de Clientes</p>
               {recentActivity.filter(a => a.type === 'sale').slice(0, 3).map((act, i) => (
                 <div key={i} className="text-xs p-2 rounded bg-muted/20 flex justify-between items-center">
                   <span>{act.label} - {act.detail.split('·')[0]}</span>
                   <span className="text-[10px] text-muted-foreground">{fmtDate(act.time)}</span>
                 </div>
               ))}
             </div>
           </div>
         </CardContent>
       </Card>
 
       <Card className="card-hover-elevation">
         <CardHeader className="pb-2">
           <CardTitle className="text-sm font-semibold flex items-center gap-2">
             <Star className="h-4 w-4 text-orange-500" />
             Destaques da Temporada
           </CardTitle>
         </CardHeader>
         <CardContent>
           <div className="space-y-3">
             {topModels.slice(0, 3).map((model, i) => (
               <div key={i} className="flex items-center gap-3">
                 <div className="h-10 w-10 bg-muted rounded flex items-center justify-center shrink-0">
                   <Footprints className="h-5 w-5 text-muted-foreground" />
                 </div>
                 <div className="min-w-0 flex-1">
                   <p className="text-xs font-bold truncate">{model.name}</p>
                   <div className="w-full bg-muted rounded-full h-1 mt-1">
                     <div className="bg-orange-500 h-1 rounded-full" style={{ width: `${(model.count / topModels[0].count) * 100}%` }} />
                   </div>
                 </div>
                 <span className="text-xs font-mono font-bold">{model.count}</span>
               </div>
             ))}
           </div>
         </CardContent>
       </Card>
     </div>
   );
 }