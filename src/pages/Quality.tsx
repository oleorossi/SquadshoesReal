import AppLayout from "@/components/layout/AppLayout";
import { useMemo, useState } from 'react';
 import { ShieldCheck, Warning as AlertTriangle, XCircle, CheckCircle as CheckCircle2, Clock, MagnifyingGlass as Search, Funnel as Filter, ClipboardText as ClipboardCheck } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
 import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
 import LotTestingTab from '@/components/quality/LotTestingTab';
import { useAllQualityRecords, useResolveQualityRecord } from '@/hooks/useQualityRecords';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const SEVERITY_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  minor:    { label: 'Menor',    variant: 'outline',      className: 'border-amber-400/60 text-amber-600' },
  major:    { label: 'Maior',    variant: 'secondary',    className: 'bg-orange-500/15 text-orange-700 border-orange-400/40' },
  critical: { label: 'Crítico',  variant: 'destructive',  className: '' },
};

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
        <EditorialPageHeader
          sectionLabel="QUALIDADE · INSPEÇÕES"
          title="Qualidade & Auditorias"
          description="Defeitos registrados por setor — rastreamento por OP e plano de ação"
        />

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
             {/* KPI strip — kit editorial (StatCard) derivado de dados reais */}
             <StatGrid>
               <StatCard icon={ShieldCheck}  label="Total de Registros"  value={stats.total}      hint="todos os períodos" />
               <StatCard icon={Clock}        label="Não Resolvidos"      value={stats.unresolved} hint="aguardando ação"          tone="warning" />
               <StatCard icon={XCircle}      label="Críticos em Aberto"  value={stats.critical}   hint="requer atenção imediata"  tone={stats.critical > 0 ? 'destructive' : 'default'} />
               <StatCard icon={CheckCircle2} label="Com Retrabalho"      value={stats.reworkable} hint="podem ser recuperados"    tone="success" />
             </StatGrid>
 
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
             <Panel flush>
               <Table>
                 <TableHeader>
                   <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
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
                     <TableRow><TableCell colSpan={9} className="p-0">
                       <EmptyState icon={ShieldCheck} title="Nenhum registro encontrado" description="Ajuste os filtros ou aguarde novos registros de qualidade." size="sm" />
                     </TableCell></TableRow>
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
             </Panel>

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
