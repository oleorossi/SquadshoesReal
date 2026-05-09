import AppLayout from "@/components/layout/AppLayout";
import { useMemo, useState } from 'react';
 import { ShieldCheck, AlertTriangle, XCircle, CheckCircle2, Clock, Search, Filter, ClipboardCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
 import { Card, CardContent } from '@/components/ui/card';
 import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
 import LotTestingTab from '@/components/quality/LotTestingTab';
import { useAllQualityRecords, useResolveQualityRecord } from '@/hooks/useQualityRecords';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const SEVERITY_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  minor:    { label: 'Menor',    variant: 'outline',      className: 'border-amber-400/60 text-amber-600' },
  major:    { label: 'Maior',    variant: 'secondary',    className: 'bg-orange-500/15 text-orange-700 border-orange-400/40' },
  critical: { label: 'Crítico',  variant: 'destructive',  className: '' },
};

function KpiCard({ icon: Icon, title, value, sub, variant = 'default' }: { icon: any; title: string; value: number | string; sub?: string; variant?: string }) {
  const colors: Record<string, string> = {
    default:     'bg-primary/10 text-primary',
    destructive: 'bg-destructive/10 text-destructive',
    warning:     'bg-amber-500/10 text-amber-600',
    success:     'bg-emerald-500/10 text-emerald-600',
  };
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${colors[variant] || colors.default}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-xl font-bold tabular-nums">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

export default function Quality() {
  const { data: records = [], isLoading } = useAllQualityRecords();
  const resolve = useResolveQualityRecord();
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('unresolved');

  const filtered = useMemo(() => records.filter((r: any) => {
    if (severityFilter !== 'all' && r.severity !== severityFilter) return false;
    if (statusFilter === 'unresolved' && r.resolved) return false;
    if (statusFilter === 'resolved' && !r.resolved) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        r.stage_name?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.cause?.toLowerCase().includes(q)
      );
    }
    return true;
  }), [records, search, severityFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = records.length;
    const unresolved = records.filter((r: any) => !r.resolved).length;
    const critical = records.filter((r: any) => r.severity === 'critical' && !r.resolved).length;
    const reworkable = records.filter((r: any) => r.can_rework && !r.resolved).length;
    return { total, unresolved, critical, reworkable };
  }, [records]);

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <div>
          <h1 className="display text-xl tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Qualidade & Auditorias
          </h1>
          <p className="text-sm text-muted-foreground">Defeitos registrados por setor — rastreamento por OP e plano de ação</p>
        </div>

         <Tabs defaultValue="defects" className="space-y-5">
           <TabsList>
             <TabsTrigger value="defects" className="gap-2">
               <AlertTriangle className="h-4 w-4" /> Ocorrências de Produção
             </TabsTrigger>
             <TabsTrigger value="batch-test" className="gap-2">
               <ClipboardCheck className="h-4 w-4" /> Testes de Lote
             </TabsTrigger>
           </TabsList>
 
           <TabsContent value="defects" className="space-y-5">
             {/* KPI cards */}
             <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
               <KpiCard icon={ShieldCheck}    title="Total de Registros"    value={stats.total}      sub="todos os períodos"       variant="default" />
               <KpiCard icon={Clock}          title="Não Resolvidos"        value={stats.unresolved} sub="aguardando ação"          variant="warning" />
               <KpiCard icon={XCircle}        title="Críticos em Aberto"   value={stats.critical}   sub="requer atenção imediata" variant={stats.critical > 0 ? 'destructive' : 'default'} />
               <KpiCard icon={CheckCircle2}   title="Com Retrabalho"       value={stats.reworkable} sub="podem ser recuperados"    variant="success" />
             </div>
 
             {/* Filters */}
             <div className="flex flex-col sm:flex-row gap-3">
               <div className="relative flex-1">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                 <Input placeholder="Buscar por setor, descrição ou causa..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
               </div>
               <Select value={severityFilter} onValueChange={setSeverityFilter}>
                 <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Todas severidades</SelectItem>
                   <SelectItem value="minor">Menor</SelectItem>
                   <SelectItem value="major">Maior</SelectItem>
                   <SelectItem value="critical">Crítico</SelectItem>
                 </SelectContent>
               </Select>
               <Select value={statusFilter} onValueChange={setStatusFilter}>
                 <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Todos</SelectItem>
                   <SelectItem value="unresolved">Em aberto</SelectItem>
                   <SelectItem value="resolved">Resolvidos</SelectItem>
                 </SelectContent>
               </Select>
             </div>
 
             {/* Table */}
             <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
               <Table>
                 <TableHeader>
                   <TableRow className="bg-muted/30">
                     <TableHead>Setor</TableHead>
                     <TableHead>Tipo</TableHead>
                     <TableHead>Severidade</TableHead>
                     <TableHead className="text-center">Qtd</TableHead>
                     <TableHead>Descrição / Causa</TableHead>
                     <TableHead>Ação Corretiva</TableHead>
                     <TableHead>Data</TableHead>
                     <TableHead className="text-center">Status</TableHead>
                     <TableHead className="text-center">Ações</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {isLoading ? (
                     <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
                   ) : filtered.length === 0 ? (
                     <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Nenhum registro encontrado</TableCell></TableRow>
                   ) : filtered.map((r: any) => {
                     const sev = SEVERITY_CONFIG[r.severity] || SEVERITY_CONFIG.minor;
                     return (
                       <TableRow key={r.id} className={r.resolved ? 'opacity-50' : ''}>
                         <TableCell className="font-medium text-sm">{r.stage_name || '—'}</TableCell>
                         <TableCell className="text-sm text-muted-foreground">{r.record_type || '—'}</TableCell>
                         <TableCell>
                           {r.severity ? (
                             <Badge variant={sev.variant} className={`text-xs ${sev.className}`}>{sev.label}</Badge>
                           ) : '—'}
                         </TableCell>
                         <TableCell className="text-center tabular-nums font-semibold">{r.quantity}</TableCell>
                         <TableCell className="max-w-[200px]">
                           <p className="text-sm truncate">{r.description || '—'}</p>
                           {r.cause && <p className="text-xs text-muted-foreground truncate">Causa: {r.cause}</p>}
                         </TableCell>
                         <TableCell className="max-w-[160px]">
                           <p className="text-xs text-muted-foreground truncate">{r.corrective_action || '—'}</p>
                         </TableCell>
                         <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                           {r.created_at ? format(new Date(r.created_at), 'dd/MM/yy HH:mm', { locale: ptBR }) : '—'}
                         </TableCell>
                         <TableCell className="text-center">
                           {r.resolved ? (
                             <Badge variant="outline" className="text-xs gap-1 text-emerald-600 border-emerald-500/40">
                               <CheckCircle2 className="h-3 w-3" /> Resolvido
                             </Badge>
                           ) : (
                             <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-400/40">
                               <Clock className="h-3 w-3" /> Em aberto
                             </Badge>
                           )}
                           {r.can_rework && !r.resolved && (
                             <div className="text-xs text-emerald-600 mt-0.5">↩ Retrabalho</div>
                           )}
                         </TableCell>
                         <TableCell className="text-center">
                           {!r.resolved && (
                             <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-emerald-600 hover:text-emerald-700" onClick={() => resolve.mutate({ id: r.id })}>
                               <CheckCircle2 className="h-3.5 w-3.5" /> Resolver
                             </Button>
                           )}
                         </TableCell>
                       </TableRow>
                     );
                   })}
                 </TableBody>
               </Table>
             </div>
 
             {filtered.length > 0 && (
               <p className="text-xs text-muted-foreground text-right">{filtered.length} registro(s)</p>
             )}
           </TabsContent>
 
           <TabsContent value="batch-test">
             <LotTestingTab />
           </TabsContent>
         </Tabs>
      </div>
    </AppLayout>
  );
}
