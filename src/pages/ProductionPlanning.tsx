 import { useQuery } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Badge } from "@/components/ui/badge";
 import { CircleNotch as Loader2, Warning as AlertTriangle, Clock, TrendUp as TrendingUp, Scissors, PencilLine as PenLine, Hammer, Sparkle as Sparkles, Hand } from '@phosphor-icons/react';
 import { Progress } from "@/components/ui/progress";
 import { cn } from "@/lib/utils";
 import { 
   Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
 } from "@/components/ui/table";
 import { format, parseISO } from "date-fns";
 import { ptBR } from "date-fns/locale";
 
 const SECTOR_ICONS: Record<string, any> = {
   'Corte': Scissors,
   'Forração': PenLine,
   'Montagem': Hammer,
   'Silk': Sparkles,
   'Colagem': Hand,
   'Acabamento': Sparkles,
   'Expedição': TrendingUp,
 };
 
 export default function ProductionPlanning() {
   const { data: kpis = [], isLoading: loadingKpis } = useQuery({
     queryKey: ['production_planning_kpis'],
     queryFn: async () => {
       const { data, error } = await supabase.from('v_production_planning_kpis' as any).select('*');
       if (error) throw error;
       return data;
     }
   });
 
   const { data: timeline = [], isLoading: loadingTimeline } = useQuery({
     queryKey: ['production_timeline_planning'],
     queryFn: async () => {
       const { data, error } = await supabase
         .from('purchase_projection_timeline' as any)
         .select('*')
         .limit(50);
       if (error) throw error;
       return data;
     }
   });
 
   if (loadingKpis || loadingTimeline) {
     return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
   }
 
   return (
     <div className="space-y-6">
       {/* KPI Dashboard Section */}
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
         {kpis.map((kpi: any) => {
           const Icon = SECTOR_ICONS[kpi.sector] || TrendingUp;
           const occupancy = kpi.daily_capacity > 0 ? (kpi.total_pairs / (kpi.daily_capacity * 5)) * 100 : 0;
           
           return (
             <Card key={kpi.sector} className={kpi.risk_level === 'crítico' ? 'border-destructive/50' : ''}>
               <CardHeader className="pb-2">
                 <div className="flex items-center justify-between">
                   <CardTitle className="text-sm font-medium flex items-center gap-2">
                     <Icon className="h-4 w-4" />
                     {kpi.sector}
                   </CardTitle>
                   {kpi.risk_level !== 'normal' && (
                     <Badge variant={kpi.risk_level === 'crítico' ? 'destructive' : 'outline'} className={cn("text-[10px]", kpi.risk_level === 'atenção' && "border-amber-500 text-amber-600")}>
                       {kpi.risk_level}
                     </Badge>
                   )}
                 </div>
               </CardHeader>
               <CardContent className="space-y-2">
                 <div className="text-2xl font-bold">{kpi.total_pairs.toLocaleString()}p</div>
                 <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                   <span>Backlog: {kpi.days_of_backlog} dias</span>
                   <span>Capacidade: {kpi.daily_capacity}/dia</span>
                 </div>
                 <Progress value={Math.min(occupancy, 100)} className="h-1" />
               </CardContent>
             </Card>
           );
         })}
       </div>
 
       {/* Timeline Section */}
       <Card>
         <CardHeader>
           <CardTitle className="text-base flex items-center gap-2">
             <Clock className="h-4 w-4" />
             Datas Planejadas (Timeline de Produção)
           </CardTitle>
         </CardHeader>
         <CardContent>
           <div className="rounded-md border overflow-hidden">
             <Table>
               <TableHeader className="bg-muted/50">
                 <TableRow>
                   <TableHead className="text-xs">OP / Ref</TableHead>
                   <TableHead className="text-xs">Limite Compra</TableHead>
                     <TableHead className="text-xs">Início Corte</TableHead>
                    <TableHead className="text-xs">Início Forr.</TableHead>
                    <TableHead className="text-xs">Silk</TableHead>
                    <TableHead className="text-xs">Colagem</TableHead>
                    <TableHead className="text-xs">Montagem</TableHead>
                    <TableHead className="text-xs">Acabamento</TableHead>
                    <TableHead className="text-xs">Exped.</TableHead>
                   <TableHead className="text-xs">Entrega</TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {timeline.map((row: any) => (
                   <TableRow key={row.order_id} className="text-[11px]">
                     <TableCell>
                       <div className="font-bold">{row.pedido_ref}</div>
                       <div className="text-muted-foreground">{row.referencia_nome}</div>
                     </TableCell>
                     <TableCell className={row.data_limite_compra < new Date().toISOString() ? 'text-destructive font-bold' : ''}>
                       {row.data_limite_compra ? format(parseISO(row.data_limite_compra), 'dd/MM', { locale: ptBR }) : '—'}
                     </TableCell>
                     <TableCell>{row.data_inicio_corte ? format(parseISO(row.data_inicio_corte), 'dd/MM', { locale: ptBR }) : '—'}</TableCell>
                     <TableCell>{row.data_inicio_costura ? format(parseISO(row.data_inicio_costura), 'dd/MM', { locale: ptBR }) : '—'}</TableCell>
                      <TableCell>{row.data_inicio_silk ? format(parseISO(row.data_inicio_silk), 'dd/MM', { locale: ptBR }) : '—'}</TableCell>
                      <TableCell>{row.data_inicio_colagem ? format(parseISO(row.data_inicio_colagem), 'dd/MM', { locale: ptBR }) : '—'}</TableCell>
                      <TableCell>{row.data_inicio_montagem ? format(parseISO(row.data_inicio_montagem), 'dd/MM', { locale: ptBR }) : '—'}</TableCell>
                     <TableCell>{row.data_inicio_acabamento ? format(parseISO(row.data_inicio_acabamento), 'dd/MM', { locale: ptBR }) : '—'}</TableCell>
                      <TableCell>{row.data_inicio_expedicao ? format(parseISO(row.data_inicio_expedicao), 'dd/MM', { locale: ptBR }) : '—'}</TableCell>
                     <TableCell className="font-semibold">{row.data_entrega_cliente ? format(parseISO(row.data_entrega_cliente), 'dd/MM', { locale: ptBR }) : '—'}</TableCell>
                   </TableRow>
                 ))}
               </TableBody>
             </Table>
           </div>
         </CardContent>
       </Card>
 
       {/* Alerts & Risks */}
       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         <Card>
           <CardHeader>
             <CardTitle className="text-sm flex items-center gap-2">
               <AlertTriangle className="h-4 w-4 text-warning" />
               Riscos de Materiais e Terceirizados
             </CardTitle>
           </CardHeader>
           <CardContent className="space-y-3">
             <div className="flex items-center justify-between p-2 border rounded-md text-xs bg-muted/20">
               <span>Itens Artesanais Pendentes</span>
               <Badge variant="secondary">Ver em Receitas</Badge>
             </div>
             <div className="flex items-center justify-between p-2 border rounded-md text-xs bg-muted/20">
               <span>Atrasos Críticos em Matéria-Prima</span>
               <Badge variant="destructive">{timeline.filter((r: any) => r.data_limite_compra < new Date().toISOString()).length} OPs</Badge>
             </div>
           </CardContent>
         </Card>
       </div>
     </div>
   );
 }