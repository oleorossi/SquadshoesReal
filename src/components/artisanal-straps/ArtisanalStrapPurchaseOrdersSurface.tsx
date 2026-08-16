import { useMemo, useState } from 'react';
import { ArrowsClockwise, Funnel, MagnifyingGlass, ShieldWarning, ShoppingBag } from '@phosphor-icons/react';
import { ArtisanalStrapPurchaseOrdersPanel, purchaseOrderCanonicalStatus } from './ArtisanalStrapExternalOperations';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  isArtisanalStrapPurchaseOrderPendingApproval,
  useArtisanalStrapCatalog,
  useArtisanalStrapExternalOperations,
} from '@/hooks/useArtisanalStraps';

interface Props {
  mode?: 'operational' | 'approval';
}

function normalize(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function ArtisanalStrapPurchaseOrdersSurface({ mode = 'operational' }: Props) {
  const catalogQuery = useArtisanalStrapCatalog(false);
  const operationsQuery = useArtisanalStrapExternalOperations(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [criticality, setCriticality] = useState('all');
  const [billingPeriod, setBillingPeriod] = useState('all');
  const [fortnight, setFortnight] = useState('all');

  const sourceRows = useMemo(
    () => operationsQuery.data?.purchaseItems || [],
    [operationsQuery.data?.purchaseItems],
  );
  const billingPeriods = useMemo(() => {
    const values = new Map<string, string>();
    sourceRows.forEach((row) => {
      const month = String(row.billing_month || '').trim();
      const year = String(row.billing_year || '').trim();
      if (!month || !year) return;
      values.set(`${year}|${month}`, `${month} de ${year}`);
    });
    return [...values.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [sourceRows]);
  const pendingCount = useMemo(() => {
    const ids = new Set<string>();
    sourceRows.forEach((row) => {
      if (isArtisanalStrapPurchaseOrderPendingApproval(row)) ids.add(row.purchase_order_id);
    });
    return ids.size;
  }, [sourceRows]);

  const rows = useMemo(() => sourceRows.filter((row) => {
    if (mode === 'approval' && !isArtisanalStrapPurchaseOrderPendingApproval(row)) return false;
    if (status !== 'all' && purchaseOrderCanonicalStatus(row) !== status) return false;
    if (criticality !== 'all' && normalize(row.criticality) !== normalize(criticality)) return false;
    if (billingPeriod !== 'all' && `${row.billing_year}|${row.billing_month}` !== billingPeriod) return false;
    if (fortnight !== 'all' && String(row.billing_fortnight || '') !== fortnight) return false;
    if (!search.trim()) return true;
    const haystack = normalize([
      row.order_number,
      row.supplier_name,
      row.product_name,
      row.product_sku,
      row.billing_month,
      row.billing_year,
      row.latest_job_status,
      row.latest_job_error,
      row.criticality,
      ...(row.blockers || []),
      ...(row.contributions || []).map((entry) => entry.label),
    ].join(' '));
    return normalize(search).split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
  }), [billingPeriod, criticality, fortnight, mode, search, sourceRows, status]);

  if (catalogQuery.isError || operationsQuery.isError) {
    return (
      <Alert variant="destructive">
        <ShieldWarning className="h-4 w-4" />
        <AlertTitle>Não foi possível abrir as demandas automáticas</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          Verifique seu acesso às views operacionais de tiras e tente novamente.
          <Button variant="outline" size="sm" onClick={() => { catalogQuery.refetch(); operationsQuery.refetch(); }}>
            <ArrowsClockwise className="mr-1 h-4 w-4" /> Tentar novamente
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (catalogQuery.isLoading || operationsQuery.isLoading) {
    return <Panel><p className="text-sm text-muted-foreground">Carregando ordens automáticas de tiras…</p></Panel>;
  }

  const catalog = catalogQuery.data;
  const canAdmin = Boolean(catalog?.capabilities.administer_strap_operations);
  const canSeeFinancial = Boolean(catalog?.capabilities.can_see_financial_values);
  const visibleOrders = new Set(rows.map((row) => row.purchase_order_id)).size;

  if (mode === 'approval' && !canAdmin) {
    return (
      <Alert variant="destructive">
        <ShieldWarning className="h-4 w-4" />
        <AlertTitle>Aprovação exclusiva do Administrador</AlertTitle>
        <AlertDescription>Seu perfil pode consultar compras, mas não aprovar, suspender ou retomar estas OCs.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        eyebrow="DEMANDA CANÔNICA · TIRA PRONTA"
        title={mode === 'approval' ? 'Fila administrativa de aprovação' : 'Demandas automáticas'}
        subtitle="A mesma OC recebe contribuições de PVs da mesma quinzena até ser aprovada; linhas já aprovadas permanecem congeladas."
        actions={<Badge variant={pendingCount > 0 ? 'default' : 'outline'}>{pendingCount} aguardando aprovação</Badge>}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_160px_170px_140px_auto]">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="OC, fornecedor, material ou PV"
            aria-label="Buscar demandas automáticas"
          />
          {mode === 'operational' && (
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os estados</SelectItem>
                <SelectItem value="Aguardando aprovação">Aguardando aprovação</SelectItem>
                <SelectItem value="OC Provisória — Sem fornecedor">OC Provisória</SelectItem>
                <SelectItem value="Suspensa">Suspensa</SelectItem>
                <SelectItem value="Aprovada">Aprovada</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={criticality} onValueChange={setCriticality}>
            <SelectTrigger aria-label="Filtrar por criticidade"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda criticidade</SelectItem>
              <SelectItem value="Normal">Normal</SelectItem>
              <SelectItem value="Atrasada">Atrasada</SelectItem>
              <SelectItem value="Urgente">Urgente</SelectItem>
            </SelectContent>
          </Select>
          <Select value={billingPeriod} onValueChange={setBillingPeriod}>
            <SelectTrigger aria-label="Filtrar por mês de faturamento"><SelectValue placeholder="Mês de faturamento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meses</SelectItem>
              {billingPeriods.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fortnight} onValueChange={setFortnight}>
            <SelectTrigger aria-label="Filtrar por quinzena"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as quinzenas</SelectItem>
              <SelectItem value="1">1ª quinzena</SelectItem>
              <SelectItem value="2">2ª quinzena</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex min-h-10 items-center gap-1.5 text-xs text-muted-foreground">
            <Funnel className="h-4 w-4" /> {visibleOrders} OC{visibleOrders === 1 ? '' : 's'}
          </div>
        </div>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState
          icon={search ? MagnifyingGlass : ShoppingBag}
          title={mode === 'approval' && !search ? 'Nenhuma OC aguardando aprovação' : 'Nenhuma demanda automática encontrada'}
          description={search ? 'Revise os filtros ou busque pelo número do PV.' : 'As OCs aparecem aqui quando o motor canônico consolidar uma falta de tira pronta.'}
        />
      ) : (
        <ArtisanalStrapPurchaseOrdersPanel
          rows={rows}
          canManage={canAdmin}
          canSeeFinancial={canSeeFinancial}
          title={mode === 'approval' ? 'Ordens aguardando decisão' : 'Ordens automáticas por fornecedor e quinzena'}
          subtitle={mode === 'approval'
            ? 'Confira cadastro, quantidade, condição e PDF antes de congelar a aprovação.'
            : 'PVs e reposição de estoque mínimo permanecem identificados em cada item.'}
        />
      )}
    </div>
  );
}
