 import { Bell, Warning as AlertTriangle, CheckCircle as CheckCircle2, XCircle, EyeSlash as EyeOff, Trash as Trash2 } from '@phosphor-icons/react';
 import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
 import { Badge } from '@/components/ui/badge';
 import { Button } from '@/components/ui/button';
 import { cn } from '@/lib/utils';
 
 interface DashboardAlertsProps {
   isOpen: boolean;
   onOpenChange: (open: boolean) => void;
   visibleAlerts: any[];
   stats: any;
   ignoredAlerts: string[];
   deletedAlerts: string[];
   handleIgnoreAlert: (msg: string) => void;
   handleDeleteAlert: (msg: string) => void;
   setIgnoredAlerts: (val: string[]) => void;
   setDeletedAlerts: (val: string[]) => void;
 }
 
 export function DashboardAlerts({
   isOpen, onOpenChange, visibleAlerts, stats, ignoredAlerts, deletedAlerts,
   handleIgnoreAlert, handleDeleteAlert, setIgnoredAlerts, setDeletedAlerts
 }: DashboardAlertsProps) {
   return (
     <Dialog open={isOpen} onOpenChange={onOpenChange}>
       <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
         <DialogHeader>
           <DialogTitle className="flex items-center gap-2">
             <Bell className="h-5 w-5 text-warning" />
             Alertas & Notificações
             {visibleAlerts.length > 0 && (
               <Badge variant="destructive" className="text-xs ml-2">{visibleAlerts.length}</Badge>
             )}
           </DialogTitle>
         </DialogHeader>
         <div className="space-y-4 mt-2">
           {stats.criticalStock.length > 0 && (
             <div className="space-y-2">
               <div className="flex items-center gap-2">
                 <AlertTriangle className="h-4 w-4 text-destructive" />
                 <span className="font-semibold text-sm text-destructive">Materiais com Estoque Baixo</span>
                 <Badge variant="destructive" className="text-xs">{stats.criticalStock.length}</Badge>
               </div>
               <div className="rounded-lg border border-destructive/20 overflow-hidden">
                 <table className="w-full text-sm">
                   <thead>
                     <tr className="bg-destructive/5 text-xs text-muted-foreground">
                       <th className="text-left px-3 py-2 font-medium">Material</th>
                       <th className="text-right px-3 py-2 font-medium">Atual</th>
                       <th className="text-right px-3 py-2 font-medium">Mín.</th>
                     </tr>
                   </thead>
                   <tbody>
                     {stats.criticalStock.sort((a: any, b: any) => a.quantity - b.quantity).map((p: any) => (
                       <tr key={p.id} className="border-t border-border/50 hover:bg-muted/30">
                         <td className="px-3 py-2">
                           <div className="font-medium text-xs">{p.name}</div>
                           {p.color && <span className="text-xs text-muted-foreground">{p.color}</span>}
                         </td>
                         <td className="text-right px-3 py-2 font-mono text-xs font-bold">
                           <span className={p.quantity === 0 ? 'text-destructive' : 'text-warning'}>
                             {Number(p.quantity).toLocaleString('pt-BR')}
                           </span>
                         </td>
                         <td className="text-right px-3 py-2 font-mono text-xs text-muted-foreground">
                           {Number(p.min_stock).toLocaleString('pt-BR')}
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             </div>
           )}
 
           {visibleAlerts.filter(a => !a.msg.includes('estoque mínimo')).map((a, i) => (
             <div key={i} className={cn(
               'flex items-start gap-3 p-3 rounded-lg border',
               a.type === 'error' && 'bg-destructive/5 border-destructive/20',
               a.type === 'warning' && 'bg-warning/5 border-warning/20',
               a.type === 'info' && 'bg-primary/5 border-primary/20',
             )}>
               <div className="mt-0.5 shrink-0">
                 {a.type === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                 {a.type === 'warning' && <AlertTriangle className="h-4 w-4 text-warning" />}
                 {a.type === 'info' && <Clock className="h-4 w-4 text-primary" />}
               </div>
               <span className="text-sm flex-1">{a.msg}</span>
               <div className="flex items-center gap-1 shrink-0">
                 <Button size="icon" variant="ghost" className="h-7 w-7" title="Ignorar"
                   onClick={(e) => { e.stopPropagation(); handleIgnoreAlert(a.msg); }}>
                   <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                 </Button>
                 <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title="Apagar"
                   onClick={(e) => { e.stopPropagation(); handleDeleteAlert(a.msg); }}>
                   <Trash2 className="h-3.5 w-3.5" />
                 </Button>
               </div>
             </div>
           ))}
 
           {stats.criticalStock.length === 0 && visibleAlerts.length === 0 && (
             <div className="py-8 text-center">
               <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-3 opacity-60" />
               <p className="text-sm text-muted-foreground">Nenhuma notificação pendente</p>
             </div>
           )}
         </div>
         {(ignoredAlerts.length > 0 || deletedAlerts.length > 0) && (
           <div className="pt-3 border-t mt-3">
             <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => { setIgnoredAlerts([]); setDeletedAlerts([]); }}>
               Restaurar todas as notificações
             </Button>
           </div>
         )}
       </DialogContent>
     </Dialog>
   );
 }

 const Clock = ({ className }: { className?: string }) => (
   <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
     <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
   </svg>
 );