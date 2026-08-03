import AppLayout from "@/components/layout/AppLayout";
import { useState, useMemo, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ClockCounterClockwise as History, CheckCircle as CheckCircle2, XCircle, Calendar, User, ArrowRight } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { searchNormOrFilter } from '@/lib/searchUtils';
import { ListPagination } from '@/components/ui/list-pagination';
import { fetchPage, PAGE_SIZE } from '@/lib/pagination';

// Mapas para humanizar recursos e ações vindas direto do banco.
// O log original guarda os nomes em snake_case (ex: manual_billing_override_create);
// aqui traduzimos para algo legível pelo operador.
const RESOURCE_LABELS: Record<string, string> = {
  SALE_ORDER: 'Pedido de Venda',
  PURCHASE_ORDER: 'Ordem de Compra',
  PRODUCTION_ORDER: 'Ordem de Produção',
  CLIENT: 'Cliente',
  SUPPLIER: 'Fornecedor',
  PRODUCT: 'Produto',
  STOCK: 'Estoque',
  USER: 'Usuário',
  PAYABLE: 'Conta a Pagar',
  RECEIVABLE: 'Conta a Receber',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Criar',
  update: 'Atualizar',
  delete: 'Excluir',
  approve: 'Aprovar',
  cancel: 'Cancelar',
  reject: 'Rejeitar',
  manual_billing_override_create: 'Override manual de faturamento (criar)',
  manual_billing_override_update: 'Override manual de faturamento (atualizar)',
  manual_billing_override_delete: 'Override manual de faturamento (remover)',
  status_change: 'Mudança de status',
  stage_advance: 'Avanço de etapa',
  bulk_update: 'Atualização em lote',
};

function humanizeAction(action: string): string {
  if (!action) return '—';
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // Fallback: snake_case → "Snake Case" em português aproximado.
  return action
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function humanizeResource(resource: string): string {
  if (!resource) return '—';
  return RESOURCE_LABELS[resource] ?? resource;
}

/** Resume um payload JSON em pares chave: valor (sem chaves/aspas). */
function summarizeJson(data: unknown, max = 80): string {
  if (!data || typeof data !== 'object') return String(data ?? '');
  const entries = Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 4)
    .map(([k, v]) => {
      const valueStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k}: ${valueStr}`;
    })
    .join(' · ');
  return entries.length > max ? entries.slice(0, max) + '…' : entries;
}

export default function AuditLogs() {
  const [search, setSearch] = useState('');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [page, setPage] = useState(1);

  // Mudou busca/filtro ⇒ volta pra página 1. Sem isto, quem está na página 8 e
  // digita uma busca que devolve 2 páginas fica olhando uma tela vazia.
  useEffect(() => {
    setPage(1);
  }, [search, resourceFilter, actionFilter]);

  // Busca SERVER-SIDE via search_norm (spec melhorias-busca-sistema R6):
  // audit_logs já passa de 1000 linhas — filtrar só o que foi carregado
  // escondia registros que existem. O banco filtra (acento/caixa/espaço-AND
  // idênticos ao client, mig 20260911180000) e devolve a página relevante.
  //
  // 2026-08-03: o `.limit(500)` daqui ainda cortava — 1.414 linhas na tabela,
  // 500 chegavam. Agora é `.range()` + `count: 'exact'`, então o total do
  // cabeçalho é o total REAL do banco, não o tamanho do que coube.
  const { data: pageResult, isLoading, isFetching } = useQuery({
    queryKey: ['system-audit-logs', search.trim(), resourceFilter, actionFilter, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchPage<any>((from, to) => {
        // Inclui o nome do usuário por LEFT JOIN com profiles, quando disponível,
        // para não exibir só o UUID truncado na tabela.
        let q = supabase
          .from('audit_logs')
          .select('*, user:profiles(full_name, email)', { count: 'exact' })
          .order('created_at', { ascending: false })
          // Desempate determinístico: `created_at` repete em ações do mesmo
          // lote, e sem 2ª chave o Postgres pode repetir/pular linha entre
          // páginas.
          .order('id', { ascending: false });
        if (resourceFilter !== 'all') q = q.eq('resource', resourceFilter);
        if (actionFilter !== 'all') q = q.eq('action', actionFilter);
        const orFilter = searchNormOrFilter(search);
        if (orFilter) q = q.or(orFilter) as typeof q;
        return q.range(from, to);
      }, { page }),
  });

  const logs = pageResult?.items ?? [];
  const total = pageResult?.total ?? 0;

  // Facetas (recursos/ações) vêm de uma consulta própria SEM busca — senão as
  // opções dos dropdowns sumiriam enquanto o usuário digita.
  const { data: facets = [] } = useQuery({
    queryKey: ['system-audit-logs-facets'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('resource, action')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const uniqueResources = useMemo(() => {
    const set = new Set(facets.map((l: any) => l.resource));
    return Array.from(set).filter(Boolean).sort();
  }, [facets]);

  const uniqueActions = useMemo(() => {
    const set = new Set(facets.map((l: any) => l.action));
    return Array.from(set).filter(Boolean).sort();
  }, [facets]);

  const filteredLogs = logs;

  return (
    <AppLayout>
      <div className="space-y-6 page-enter">
        <EditorialPageHeader
          sectionLabel="SISTEMA · AUDITORIA LOGS"
          title="Auditoria do Sistema"
          description="Rastreamento completo de todas as alterações e ações realizadas no sistema."
          actions={
            <Badge variant="outline" className="px-3 py-1">
              {/* Total do BANCO (count exact), não o tamanho da página — antes
                  dizia "500 registros exibidos" sendo que existiam 1.414. */}
              {isFetching ? 'Buscando…' : `${total.toLocaleString('pt-BR')} ${total === 1 ? 'registro' : 'registros'}`}
            </Badge>
          }
        />

        <Panel
          eyebrow="SISTEMA · AUDITORIA"
          title="Filtros de Busca"
        >
          <div className="flex flex-wrap gap-3">
            <SearchInput
              className="flex-1 min-w-[200px]"
              placeholder="Buscar por recurso, ação, usuário ou dados…"
              value={search}
              onChange={setSearch}
              debounceMs={300}
            />
            <Select value={resourceFilter} onValueChange={setResourceFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Recurso" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Recursos</SelectItem>
                {uniqueResources.map(r => (
                  <SelectItem key={r} value={r}>{humanizeResource(r)}</SelectItem>
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
                  <SelectItem key={a} value={a}>{humanizeAction(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Panel>

        <Panel flush>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
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
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      icon={History}
                      title={search.trim() ? `Nenhum resultado para "${search.trim()}"` : 'Nenhum registro encontrado'}
                      description={search.trim() ? 'A busca varre TODOS os logs no banco — confira o termo ou limpe a busca.' : 'Nenhum registro encontrado para os filtros selecionados.'}
                      action={search.trim() ? <Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button> : undefined}
                    />
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
                      <Badge
                        variant="outline"
                        className="text-xs tracking-wide"
                        title={log.resource}
                      >
                        {humanizeResource(log.resource)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium" title={log.action}>
                        {humanizeAction(log.action)}
                      </span>
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
                        <span title={log.user_id || undefined}>
                          {log.user?.full_name
                            || log.user?.email
                            || (log.user_id ? `Usuário ${log.user_id.slice(0, 6)}` : 'Sistema')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[400px]">
                      <div className="flex items-center gap-2 overflow-hidden">
                        {log.old_data && (
                          <div
                            className="text-xs bg-muted px-1.5 py-0.5 rounded truncate max-w-[180px]"
                            title={JSON.stringify(log.old_data, null, 2)}
                          >
                            Antes: {summarizeJson(log.old_data, 50)}
                          </div>
                        )}
                        {log.old_data && log.new_data && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />}
                        {log.new_data && (
                          <div
                            className="text-xs bg-emerald-500/10 text-emerald-700 px-1.5 py-0.5 rounded truncate max-w-[220px]"
                            title={JSON.stringify(log.new_data, null, 2)}
                          >
                            Depois: {summarizeJson(log.new_data, 60)}
                          </div>
                        )}
                        {log.error_message && (
                          <div className="text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
                            Erro: {log.error_message}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Panel>

        <ListPagination
          page={pageResult?.page ?? 1}
          total={total}
          totalPages={pageResult?.totalPages ?? 1}
          showPager={pageResult?.showPager ?? false}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          itemLabel="registros"
        />
      </div>
    </AppLayout>
  );
}
