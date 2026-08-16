import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowsClockwise as RefreshCw,
  CheckCircle,
  ClockCounterClockwise as History,
  MagnifyingGlass as Search,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PackagingAuditRow {
  order_id: string;
  order_number: string | null;
  order_status: string;
  sale_order_number: string | null;
  reference_name: string | null;
  sole_group_name: string | null;
  packaging_mode: string;
  packaging_type: string | null;
  box_name: string | null;
  unit_label: string | null;
  pairs_per_package: number | null;
  required_quantity: number | null;
  actual_debited: number | null;
  remaining_quantity: number | null;
  available_quantity: number | null;
  audit_status: string;
  order_created_at: string;
}

const ACTIVE_STATUSES = new Set(['Reservado', 'Em Produção']);
const HEALTHY = new Set(['ok', 'nao_aplicavel']);

const statusLabel: Record<string, string> = {
  ok: 'Conferido',
  sem_debito: 'Sem débito',
  parcial: 'Débito parcial',
  sem_estoque: 'Sem estoque',
  estoque_parcial: 'Estoque insuficiente',
  sem_solado: 'Ficha sem solado',
  sem_caixa: 'Solado sem caixa',
  caixa_inativa: 'Caixa inativa',
  nao_aplicavel: 'Não aplicável',
};

const modeLabel: Record<string, string> = {
  individual_master: 'Tradicional',
  individual_fitilho: 'Amarrado',
  individual_amarrado: 'Amarrado',
  colmeia: 'Colmeia',
  individual: 'Individual',
};

function fmt(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export default function PackagingDebitAuditPanel() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'active' | 'issues' | 'all'>('active');
  const [search, setSearch] = useState('');

  const { data: rows = [], isLoading, isFetching, error } = useQuery<PackagingAuditRow[]>({
    queryKey: ['packaging_debit_audit'],
    queryFn: async () => {
      const { data, error: rpcError } = await (supabase as any).rpc('list_packaging_debit_audit', {
        p_limit: 600,
      });
      if (rpcError) throw rpcError;
      return (data ?? []) as PackagingAuditRow[];
    },
    staleTime: 30_000,
  });

  const activeRows = rows.filter(row => ACTIVE_STATUSES.has(row.order_status));
  const issueRows = rows.filter(row => !HEALTHY.has(row.audit_status));
  const activeIssues = activeRows.filter(row => !HEALTHY.has(row.audit_status));
  const completed = rows.filter(row => row.audit_status === 'ok').length;

  const visible = useMemo(() => {
    const base = scope === 'active' ? activeRows : scope === 'issues' ? issueRows : rows;
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return base;
    return base.filter(row => [
      row.order_number,
      row.sale_order_number,
      row.reference_name,
      row.sole_group_name,
      row.box_name,
      statusLabel[row.audit_status],
    ].some(value => String(value ?? '').toLocaleLowerCase('pt-BR').includes(term)));
  }, [activeRows, issueRows, rows, scope, search]);

  if (isLoading) return <Skeleton className="h-[480px] w-full" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className={activeIssues.length > 0 ? 'border-warning/40 bg-warning/5' : ''}>
          <CardContent className="p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Pendências em OPs ativas</p>
            <p className="mt-1 font-mono text-2xl font-bold">{activeIssues.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Linhas conferidas</p>
            <p className="mt-1 font-mono text-2xl font-bold">{completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">OPs ativas auditadas</p>
            <p className="mt-1 font-mono text-2xl font-bold">{new Set(activeRows.map(row => row.order_id)).size}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Histórico analisado</p>
            <p className="mt-1 font-mono text-2xl font-bold">{new Set(rows.map(row => row.order_id)).size}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p>
          A auditoria compara o que cada OP deveria consumir com o débito líquido registrado
          (saídas menos estornos). OPs antigas aparecem para conferência, mas não são baixadas
          retroativamente: inventário histórico exige decisão manual.
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs value={scope} onValueChange={value => setScope(value as typeof scope)}>
          <TabsList>
            <TabsTrigger value="active">OPs ativas ({activeRows.length})</TabsTrigger>
            <TabsTrigger value="issues">Todas pendências ({issueRows.length})</TabsTrigger>
            <TabsTrigger value="all">Histórico ({rows.length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1 md:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar OP, PV, referência, solado..."
              className="h-9 pl-8"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            disabled={isFetching}
            onClick={() => qc.invalidateQueries({ queryKey: ['packaging_debit_audit'] })}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/30">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Não foi possível carregar a conferência: {(error as Error).message}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">OP / PV</th>
                  <th className="px-3 py-2.5 font-medium">Referência / solado</th>
                  <th className="px-3 py-2.5 font-medium">Modo</th>
                  <th className="px-3 py-2.5 font-medium">Embalagem</th>
                  <th className="px-3 py-2.5 text-right font-medium">Esperado</th>
                  <th className="px-3 py-2.5 text-right font-medium">Debitado</th>
                  <th className="px-3 py-2.5 text-right font-medium">Falta</th>
                  <th className="px-3 py-2.5 font-medium">Conferência</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((row, index) => {
                  const healthy = HEALTHY.has(row.audit_status);
                  return (
                    <tr key={`${row.order_id}:${row.packaging_type ?? 'none'}:${index}`} className={!healthy ? 'bg-warning/[0.04]' : ''}>
                      <td className="px-3 py-2.5">
                        <p className="font-mono text-xs font-semibold">{row.order_number ?? row.order_id.slice(0, 8)}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.sale_order_number ? `PV ${row.sale_order_number}` : 'Sem PV'} · {row.order_status}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="max-w-56 truncate text-xs font-medium">{row.reference_name ?? 'Referência não identificada'}</p>
                        <p className="max-w-56 truncate text-xs text-muted-foreground">{row.sole_group_name ?? 'Sem tipo de solado'}</p>
                      </td>
                      <td className="px-3 py-2.5 text-xs">{modeLabel[row.packaging_mode] ?? row.packaging_mode}</td>
                      <td className="px-3 py-2.5">
                        <p className="max-w-52 truncate text-xs font-medium">{row.box_name ?? 'Não configurada'}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.packaging_type ?? '—'}
                          {row.pairs_per_package ? ` · ${row.pairs_per_package} pares` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">
                        {fmt(row.required_quantity)} {row.unit_label ?? ''}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{fmt(row.actual_debited)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{fmt(row.remaining_quantity)}</td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className={healthy
                            ? 'border-success/30 bg-success/10 text-success'
                            : 'border-warning/30 bg-warning/10 text-warning-foreground'}
                        >
                          {healthy ? <CheckCircle className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
                          {statusLabel[row.audit_status] ?? row.audit_status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visible.length === 0 && (
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Nenhum registro encontrado neste filtro.
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
