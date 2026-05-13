import AppLayout from "@/components/layout/AppLayout";
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ClockCounterClockwise as History, MagnifyingGlass as Search, Funnel as Filter, CheckCircle as CheckCircle2, XCircle, Info, Calendar, User, Database, ArrowRight } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function AuditLogs() {
  const [search, setSearch] = useState('');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['system-audit-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });

  const uniqueResources = useMemo(() => {
    const set = new Set(logs.map((l: any) => l.resource));
    return Array.from(set).filter(Boolean).sort();
  }, [logs]);

  const uniqueActions = useMemo(() => {
    const set = new Set(logs.map((l: any) => l.action));
    return Array.from(set).filter(Boolean).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((l: any) => {
      if (resourceFilter !== 'all' && l.resource !== resourceFilter) return false;
      if (actionFilter !== 'all' && l.action !== actionFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (l.resource || '').toLowerCase().includes(q) ||
          (l.action || '').toLowerCase().includes(q) ||
          (l.user_id || '').toLowerCase().includes(q) ||
          (JSON.stringify(l.new_data || {})).toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, search, resourceFilter, actionFilter]);

  return (
    <AppLayout>
      <div className="space-y-6 page-enter">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="display text-2xl tracking-tight flex items-center gap-2">
              <History className="h-6 w-6 text-primary" /> Auditoria do Sistema
            </h1>
            <p className="text-sm text-muted-foreground">
              Rastreamento completo de todas as alterações e ações realizadas no sistema.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="px-3 py-1">
              {filteredLogs.length} registros exibidos
            </Badge>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Filtros de Busca</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar por recurso, ação ou dados..." 
                className="pl-9" 
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select value={resourceFilter} onValueChange={setResourceFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Recurso" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Recursos</SelectItem>
                {uniqueResources.map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Ação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Ações</SelectItem>
                {uniqueActions.map(a => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[180px]">Timestamp</TableHead>
                <TableHead className="w-[120px]">Recurso</TableHead>
                <TableHead className="w-[120px]">Ação</TableHead>
                <TableHead className="w-[100px] text-center">Status</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10">Carregando logs...</TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    Nenhum registro encontrado para os filtros selecionados.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log: any) => (
                  <TableRow key={log.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-xs font-mono">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        {log.created_at ? format(new Date(log.created_at), 'dd/MM/yy HH:mm:ss', { locale: ptBR }) : '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider">
                        {log.resource}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{log.action}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      {log.success !== false ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive mx-auto" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3 w-3 text-muted-foreground" />
                        {log.user_id ? log.user_id.slice(0, 13) + '...' : 'System'}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[400px]">
                      <div className="flex items-center gap-2 overflow-hidden">
                        {log.old_data && (
                          <div className="text-[10px] bg-muted px-1.5 py-0.5 rounded truncate max-w-[150px]">
                            Old: {JSON.stringify(log.old_data).slice(0, 50)}...
                          </div>
                        )}
                        {log.old_data && log.new_data && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                        {log.new_data && (
                          <div className="text-[10px] bg-emerald-500/10 text-emerald-700 px-1.5 py-0.5 rounded truncate max-w-[200px]">
                            New: {JSON.stringify(log.new_data).slice(0, 60)}...
                          </div>
                        )}
                        {log.error_message && (
                          <div className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
                            Error: {log.error_message}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppLayout>
  );
}
