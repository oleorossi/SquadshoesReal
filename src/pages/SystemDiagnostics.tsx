import { useState, useEffect } from 'react';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useQuery } from '@tanstack/react-query';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { CheckCircle as CheckCircle2, XCircle, ArrowsClockwise as RefreshCw, Database, Stethoscope, Copy, Warning as AlertTriangle, HardDrive, WifiHigh as Wifi, FileCode, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { manualVersionCheck } from '@/components/VersionChecker';
import { CabedalParPeAuditPanel } from '@/components/technical-sheets/CabedalParPeAuditPanel';
import OrphanDirectComponentsPanel from '@/components/technical-sheets/OrphanDirectComponentsPanel';
import { useStockDebitHoles, summarizeStockDebitHoles, useReconcileStockDebitHole } from '@/hooks/useStockDebitHoles';

type SchemaObject = {
  name: string;
  type: 'table' | 'function';
  exists: boolean;
  description: string;
};

type DiagnosticItem = {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail' | 'pending';
  detail: string;
  hint?: string;
};

type ConsistencyRow = { check_name: string; severity: string; item_count: number; sample: string | null };
type ParityRow = { case_name: string; ok: boolean; message: string | null };
type PvSystemDiagnosticRow = ConsistencyRow & { category: string };
const pvSystemDiagnosticsClient = supabase as unknown as {
  rpc(
    functionName: 'get_sale_order_command_diagnostics',
    args: { p_sale_order_id: null },
  ): PromiseLike<{
    data: PvSystemDiagnosticRow[] | null;
    error: { message: string } | null;
  }>;
};

const REQUIRED_PV_SYSTEM_SIGNALS = [
  'command_receipts_in_progress_stale',
  'material_plan_readiness_blocked',
  'active_ops_outdated_plan',
  'debit_delta_missing',
  'unsafe_stock_debit_overloads',
  'partial_promotion_enabled',
  'sale_order_outbox_worker',
  'sale_order_purchase_attention',
  'consumption_parity_skipped',
] as const;

const PV_SYSTEM_SIGNAL_LABELS: Record<string, string> = {
  command_receipts_in_progress_stale: 'Command receipts travados em processamento',
  material_plan_readiness_blocked: 'Plano de materiais bloqueado por readiness',
  active_ops_outdated_plan: 'OPs ativas com plano de materiais desatualizado',
  debit_delta_missing: 'Falta de débito (esperado − debitado)',
  unsafe_stock_debit_overloads: 'Resync/baixa: overloads inseguros com EXECUTE público',
  partial_promotion_enabled: 'Promoção parcial habilitada',
  sale_order_outbox_worker: 'Outbox de PV sem processamento durável',
  sale_order_purchase_attention: 'Faltas de compra exigindo correção de cadastro',
  consumption_parity_skipped: 'Paridade SQL sem execução comprovada',
};
/** Linha do debit_consistency_report() — esperado (ficha × grade) × debitado
 *  (stock_movements) por OP×produto, tolerância 1% + piso 0,01. */
type DebitRow = {
  order_number: string; op_status: string; product_name: string; unit: string | null;
  component: string; esperado: number; debitado: number; delta: number;
  delta_pct: number | null; classe: 'ok' | 'furo' | 'extra' | 'divergente'; obs: string | null;
};

/** Linha de check (consistência de consumo OU frescor do PCP) — mesma forma.
 *  item_count=0 → passou (verde); >0 destaca por severidade ('alto'/'error' = erro,
 *  'medio'/'warn' = aviso). */
function CheckRow({ row }: { row: ConsistencyRow }) {
  const clean = (row.item_count ?? 0) === 0;
  const sev = (row.severity || '').toLowerCase();
  const isErr = !clean && (sev.includes('alto') || sev.includes('error') || sev.includes('crit'));
  const isWarn = !clean && (sev.includes('med') || sev.includes('méd') || sev.includes('warn'));
  const tone = clean ? 'text-success' : isErr ? 'text-destructive' : isWarn ? 'text-warning' : 'text-muted-foreground';
  const icon = clean
    ? <CheckCircle2 className="h-4 w-4 text-success" />
    : isErr ? <XCircle className="h-4 w-4 text-destructive" />
    : isWarn ? <AlertTriangle className="h-4 w-4 text-warning" />
    : <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
      <div className="mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-foreground">{row.check_name}</p>
          <Badge variant="outline" className={`text-xs uppercase ${tone}`}>{row.severity}</Badge>
          <Badge variant="secondary" className="text-xs">{row.item_count} item(ns)</Badge>
        </div>
        {row.sample && row.sample !== '—' && <p className="text-xs text-muted-foreground mt-0.5 break-all">{row.sample}</p>}
      </div>
    </div>
  );
}

export default function SystemDiagnostics() {
  // A aba mora na URL (contrato do lote L6): antes era <Tabs defaultValue>, então
  // F5 e o botão Voltar devolviam o usuário à primeira aba.
  const { value: abaUrl, setValue: setAbaUrl } = useUrlTabState({
    values: ['diagnostics', 'schema', 'migrations', 'pedidos', 'consumo'] as const,
    defaultValue: 'diagnostics',
  });
  const [diag, setDiag] = useState<DiagnosticItem[]>([]);
  const [running, setRunning] = useState(false);

  // C3 (2026-06-25): expõe na UI os guards de consumo que já existiam só em SQL/
  // testes — consumption_consistency_report() lista lacunas de cadastro que
  // reintroduzem consumo errado (largura faltando, palmilha pronta inconsistente,
  // solado sem specs, fachete sem consumo) e run_consumption_parity_tests() trava
  // o contrato TS×SQL do motor de consumo. Sob demanda (botão) — são varreduras.
  const [consChecks, setConsChecks] = useState<ConsistencyRow[] | null>(null);
  const [parityChecks, setParityChecks] = useState<ParityRow[] | null>(null);
  const [freshChecks, setFreshChecks] = useState<ConsistencyRow[] | null>(null);
  const [cpcChecks, setCpcChecks] = useState<ConsistencyRow[] | null>(null);
  // Auditoria débito ficha×grade (specs/auditoria-debito-ficha-grade.md):
  // esperado×debitado por OP×produto + guards de regressão dos fixes.
  const [debitRows, setDebitRows] = useState<DebitRow[] | null>(null);
  const [debitGuards, setDebitGuards] = useState<ParityRow[] | null>(null);
  // Engine de capacidade (specs/produtividade-por-modelo.md): gaps de cadastro
  // que distorcem gargalo/pares-dia/custo-par — tempo faltando, setor sem
  // equipe, divergência minutos×capacidade da ficha, taxa órfã.
  const [capacityChecks, setCapacityChecks] = useState<
    Array<{ categoria: string; severidade: string; referencia: string; detalhe: string }> | null
  >(null);
  // Vínculos quebrados do PV (migration 20260919120000): OP ativa sem item,
  // OS sem vínculo com o item, item com 2+ OPs ativas. Nasceram do incidente
  // PV-00146 — a duplicação de OP só foi descoberta por etiqueta duplicada.
  const [linkChecks, setLinkChecks] = useState<
    Array<{ check_name: string; severity: string; qtd: number; detalhe: string }> | null
  >(null);
  // Reserva defasada (investigação PV-00147): OP ativa cuja reserva NÃO cobre o
  // que a ficha pede hoje. Nasceu do furo de baixa do PV-00145 — as OPs foram
  // reservadas contra a ficha antiga, alguém acrescentou componentes depois, e o
  // resync de ficha não re-reserva material. Como o débito na finalização
  // converte RESERVA em movimento, o que entrou depois sai da fábrica sem baixa.
  const [staleResRows, setStaleResRows] = useState<
    Array<{ order_number: string; sale_order_number: string; reference_name: string; product_name: string; required_qty: number; consumption_source: string }> | null
  >(null);
  // Custeio (auditoria 2026-08-03): o custo saía errado em silêncio — solado a
  // R$ 0,00 desde 11/07 e custo apoiado em snapshot já marcado desatualizado
  // (97% deles). cost_consistency_report() lista as lacunas de cadastro que
  // reproduzem isso, no mesmo formato do relatório de consumo.
  const [costChecks, setCostChecks] = useState<ConsistencyRow[] | null>(null);
  // Identidade do relógio de ponto (auditoria 07/08/2026): o crachá do relógio é
  // um SLOT RECICLADO — 23 dos 44 números já foram de mais de uma pessoa —, e o
  // arquivo do equipamento só exporta IDUsuário/Nome/Dep. Sem âncora temporal, o
  // ponto de quem saiu era atribuído a quem herdou o número.
  const [clockChecks, setClockChecks] = useState<ConsistencyRow[] | null>(null);
  const [consRunning, setConsRunning] = useState(false);
  const [consChecksError, setConsChecksError] = useState<string | null>(null);

  // Furo de baixa (auditoria 2026-07-25): material que a ficha pedia e NUNCA
  // saiu do estoque. O ERP já detectava (record_order_consumption grava
  // actual_quantity = 0 com a nota "possível furo de baixa"); faltava
  // VISIBILIDADE. Varredura pesada → só carrega sob demanda.
  const [holesEnabled, setHolesEnabled] = useState(false);
  const {
    data: holeRows,
    isFetching: holesLoading,
    error: holesError,
    refetch: refetchHoles,
  } = useStockDebitHoles(90, holesEnabled);
  const holesSummary = summarizeStockDebitHoles(holeRows);
  const reconcile = useReconcileStockDebitHole();

  const runConsumptionChecks = async () => {
    setConsRunning(true);
    setConsChecksError(null);
    setConsChecks(null);
    setParityChecks(null);
    setFreshChecks(null);
    setCpcChecks(null);
    setDebitRows(null);
    setDebitGuards(null);
    setCapacityChecks(null);
    setLinkChecks(null);
    setStaleResRows(null);
    setCostChecks(null);
    setClockChecks(null);
    try {
      const [consRes, parRes, freshRes, cpcRes, debitRes, guardRes, capRes, linkRes, staleResRes, costRes, clockRes] = await Promise.all([
        supabase.rpc('consumption_consistency_report'),
        supabase.rpc('run_consumption_parity_tests'),
        // pcp_freshness_report é função nova (ainda não nos tipos gerados) → cast.
        (supabase as any).rpc('pcp_freshness_report'),
        // component_colors_consistency_report — auditoria componentes-por-cor
        // (migration 20260910140000, ainda não nos tipos gerados) → cast.
        (supabase as any).rpc('component_colors_consistency_report'),
        // debit_consistency_report / run_debit_guard_tests — auditoria débito
        // ficha×grade (migration 20260915100000/110000, não nos tipos) → cast.
        (supabase as any).rpc('debit_consistency_report'),
        (supabase as any).rpc('run_debit_guard_tests'),
        // capacity_consistency_report — engine de capacidade (mig 20260719120100).
        (supabase as any).rpc('capacity_consistency_report'),
        // broken_sale_order_links_report — identidade do item do PV (mig 20260919120000).
        (supabase as any).rpc('broken_sale_order_links_report'),
        // list_ops_with_stale_reservations — reserva defasada vs ficha atual.
        (supabase as any).rpc('list_ops_with_stale_reservations'),
        // cost_consistency_report — lacunas que fazem o custo sair errado (mig 20261104120200).
        (supabase as any).rpc('cost_consistency_report'),
        // timeclock_identity_report — saúde do casamento ponto×funcionário (mig 20261227120000).
        (supabase as any).rpc('timeclock_identity_report'),
      ]);

      const queryError = [consRes, parRes, freshRes, cpcRes, debitRes, guardRes, capRes, linkRes, staleResRes, costRes, clockRes]
        .map((result) => result.error)
        .find(Boolean);
      if (queryError) throw queryError;

      setConsChecks((consRes.data ?? []) as ConsistencyRow[]);
      setFreshChecks((freshRes.data ?? []) as ConsistencyRow[]);
      setCpcChecks((cpcRes.data ?? []) as ConsistencyRow[]);
      setDebitRows((debitRes.data ?? []) as DebitRow[]);
      setDebitGuards((guardRes.data ?? []) as ParityRow[]);
      setCapacityChecks(capRes.data ?? []);
      setCostChecks((costRes.data ?? []) as ConsistencyRow[]);
      setClockChecks((clockRes.data ?? []) as ConsistencyRow[]);
      setLinkChecks(linkRes.data ?? []);
      setStaleResRows(staleResRes.data ?? []);
      setParityChecks((parRes.data ?? []) as ParityRow[]);
      toast.success('Verificação de consumo concluída');
    } catch (e: any) {
      setConsChecksError(e.message || 'Falha ao consultar as verificações de consumo.');
      toast.error('Falha na verificação de consumo: ' + e.message);
    } finally {
      setConsRunning(false);
    }
  };

  const { data: migrations, isLoading: migLoading, error: migrationsError, refetch: refetchMig } = useQuery({
    queryKey: ['system-diag', 'migrations'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_applied_migrations');
      if (error) throw error;
      return (data ?? []) as Array<{ version: string; name: string; statements_count: number }>;
    },
  });

  const { data: schemaObjects, isLoading: schemaLoading, error: schemaError, refetch: refetchSchema } = useQuery({
    queryKey: ['system-diag', 'schema-objects'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('check_schema_objects');
      if (error) throw error;
      return (data ?? []) as SchemaObject[];
    },
  });

  const {
    data: pvSystemChecks,
    isLoading: pvSystemLoading,
    isFetching: pvSystemFetching,
    error: pvSystemError,
    refetch: refetchPvSystem,
  } = useQuery({
    queryKey: ['system-diag', 'pv-system'],
    enabled: abaUrl === 'pedidos',
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<PvSystemDiagnosticRow[]> => {
      const [diagRes, parityRes, outboxRes] = await Promise.all([
        pvSystemDiagnosticsClient.rpc('get_sale_order_command_diagnostics', { p_sale_order_id: null }),
        supabase.rpc('run_consumption_parity_tests'),
        (supabase as any).rpc('get_sale_order_outbox_health'),
      ]);

      if (diagRes.error) throw diagRes.error;
      if (outboxRes.error) throw outboxRes.error;

      const diagnostics = ((diagRes.data ?? []) as PvSystemDiagnosticRow[]).map((row) => ({
        ...row,
        item_count: Number(row.item_count ?? 0),
      }));
      const parityRows = (parityRes.data ?? []) as ParityRow[];
      const parityFailures = parityRows.filter((row) => !row.ok);
      const parityUnavailable = Boolean(parityRes.error) || parityRows.length === 0;

      diagnostics.push({
        check_name: 'consumption_parity_skipped',
        category: 'parity',
        severity: parityUnavailable || parityFailures.length > 0 ? 'error' : 'info',
        item_count: parityUnavailable ? 1 : parityFailures.length,
        sample: parityRes.error
          ? `RPC indisponível: ${parityRes.error.message}`
          : parityRows.length === 0
            ? 'run_consumption_parity_tests() devolveu 0 casos; zero casos não é verde.'
            : parityFailures.length > 0
              ? parityFailures.map((row) => row.case_name).join(', ')
              : `${parityRows.length} caso(s) executado(s), todos aprovados.`,
      });

      const outbox = (outboxRes.data || {}) as {
        pending?: number;
        failed?: number;
        dead_letter?: number;
        attention_required?: number;
        oldest_available_at?: string | null;
        last_run?: { ran_at?: string; error?: string | null } | null;
      };
      const failedEvents = Number(outbox.failed || 0) + Number(outbox.dead_letter || 0);
      const lastRunAt = outbox.last_run?.ran_at ? Date.parse(outbox.last_run.ran_at) : Number.NaN;
      const workerStale = !Number.isFinite(lastRunAt) || Date.now() - lastRunAt > 5 * 60_000;
      const oldestAt = outbox.oldest_available_at ? Date.parse(outbox.oldest_available_at) : Number.NaN;
      const backlogStale = Number(outbox.pending || 0) > 0
        && Number.isFinite(oldestAt)
        && Date.now() - oldestAt > 10 * 60_000;
      diagnostics.push({
        check_name: 'sale_order_outbox_worker',
        category: 'integration',
        severity: failedEvents > 0 || workerStale || backlogStale ? 'error' : 'info',
        item_count: failedEvents + (workerStale ? 1 : 0) + (backlogStale ? 1 : 0),
        sample: `pending=${Number(outbox.pending || 0)} · failed=${Number(outbox.failed || 0)} · dead_letter=${Number(outbox.dead_letter || 0)} · última execução=${outbox.last_run?.ran_at || 'nunca'}${outbox.last_run?.error ? ` · ${outbox.last_run.error}` : ''}`,
      });
      diagnostics.push({
        check_name: 'sale_order_purchase_attention',
        category: 'purchase',
        severity: Number(outbox.attention_required || 0) > 0 ? 'warning' : 'info',
        item_count: Number(outbox.attention_required || 0),
        sample: Number(outbox.attention_required || 0) > 0
          ? 'Corrija fornecedor/cor/conversão ou material artesanal antes de comprar.'
          : 'Nenhuma falta bloqueada por cadastro.',
      });

      return diagnostics;
    },
  });

  const required = ['sole_size_conjugations', 'get_sole_size_key', 'get_sole_group_id_for_product'];
  const missing = (schemaObjects ?? []).filter((o) => required.includes(o.name) && !o.exists);
  const allOk = !schemaError && missing.length === 0 && (schemaObjects ?? []).length > 0;

  const runDiagnostics = async () => {
    setRunning(true);
    const results: DiagnosticItem[] = [];

    // 1) Versão local vs servidor
    try {
      const localVersion = (import.meta as any).env?.VITE_APP_VERSION ?? 'desconhecida';
      const resp = await fetch(`/version.json?t=${Date.now()}`, {
        cache: 'no-cache',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!resp.ok) {
        results.push({
          id: 'version',
          label: 'Versão do build',
          status: 'warn',
          detail: `Local: ${localVersion} | Servidor: indisponível (HTTP ${resp.status})`,
          hint: 'O endpoint /version.json não respondeu. Pode ser cache de proxy/CDN.',
        });
      } else {
        const json = await resp.json();
        const same = json.version === localVersion;
        results.push({
          id: 'version',
          label: 'Versão do build',
          status: same ? 'ok' : 'fail',
          detail: `Local: ${localVersion} | Servidor: ${json.version}`,
          hint: same ? undefined : 'Sua aba está rodando uma versão antiga. Force a atualização para baixar os módulos novos.',
        });
      }
    } catch (e: any) {
      results.push({
        id: 'version',
        label: 'Versão do build',
        status: 'fail',
        detail: `Falha ao consultar version.json: ${e.message}`,
        hint: 'Verifique sua conexão de rede.',
      });
    }

    // 2) Service Worker
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        results.push({
          id: 'sw',
          label: 'Service Worker',
          status: regs.length > 0 ? 'ok' : 'warn',
          detail: regs.length > 0 ? `${regs.length} registro(s) ativo(s)` : 'Nenhum registro ativo',
          hint: regs.length > 0 ? 'Caso o erro persista, desregistre o SW e recarregue.' : undefined,
        });
      } else {
        results.push({
          id: 'sw',
          label: 'Service Worker',
          status: 'warn',
          detail: 'API não suportada neste navegador',
        });
      }
    } catch (e: any) {
      results.push({ id: 'sw', label: 'Service Worker', status: 'fail', detail: e.message });
    }

    // 3) Cache Storage
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        results.push({
          id: 'caches',
          label: 'Cache Storage do navegador',
          status: keys.length > 5 ? 'warn' : 'ok',
          detail: keys.length === 0
            ? 'Nenhum cache armazenado.'
            : `${keys.length} ${keys.length === 1 ? 'cache armazenado' : 'caches armazenados'}: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '…' : ''}`,
          hint: keys.length > 5 ? 'Caches em excesso podem servir módulos antigos. Use o botão "Limpar cache".' : undefined,
        });
      }
    } catch (e: any) {
      results.push({ id: 'caches', label: 'Cache Storage', status: 'fail', detail: e.message });
    }

    // 4) Conectividade
    results.push({
      id: 'online',
      label: 'Conectividade',
      status: navigator.onLine ? 'ok' : 'fail',
      detail: navigator.onLine ? 'Online' : 'Offline — chunks dinâmicos não podem ser baixados',
      hint: navigator.onLine ? undefined : 'Verifique sua conexão. O erro de import normalmente acontece quando a rede cai durante a navegação.',
    });

    // 5) Teste de import dinâmico
    try {
      const t0 = performance.now();
      await import(/* @vite-ignore */ `/version.json?probe=${Date.now()}`).catch(() => null);
      const dt = (performance.now() - t0).toFixed(0);
      results.push({
        id: 'fetch',
        label: 'Fetch de recurso estático',
        status: 'ok',
        detail: `Resposta em ${dt}ms`,
      });
    } catch (e: any) {
      results.push({
        id: 'fetch',
        label: 'Fetch de recurso estático',
        status: 'fail',
        detail: e.message,
        hint: 'Falha ao carregar recursos. Verifique CORS/CDN/cache de proxy.',
      });
    }

    // 6) localStorage utilizável
    try {
      const k = '__diag_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      results.push({ id: 'storage', label: 'localStorage', status: 'ok', detail: 'Disponível e gravável' });
    } catch (e: any) {
      results.push({
        id: 'storage',
        label: 'localStorage',
        status: 'fail',
        detail: e.message,
        hint: 'Modo privado/anônimo pode bloquear o storage e quebrar o carregamento de chunks.',
      });
    }

    setDiag(results);
    setRunning(false);
    toast.success('Diagnóstico concluído');
  };

  // Auto-run on mount
  useEffect(() => {
    runDiagnostics();

  }, []);

  const clearCachesAndReload = async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      sessionStorage.clear();
      toast.success('Cache limpo. Recarregando…');
      setTimeout(() => window.location.reload(), 600);
    } catch (e: any) {
      toast.error('Falha ao limpar cache: ' + e.message);
    }
  };

  const copyDiagnostics = async () => {
    const payload = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      version: (import.meta as any).env?.VITE_APP_VERSION,
      diagnostics: diag,
      schema: schemaObjects,
      migrationsCount: migrations?.length ?? 0,
      latestMigration: migrations?.[0]?.version ?? null,
      pvSystem: pvSystemChecks ?? null,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast.success('Diagnóstico copiado para a área de transferência');
  };

  const statusIcon = (s: DiagnosticItem['status']) => {
    if (s === 'ok') return <CheckCircle2 className="h-4 w-4 text-success" />;
    if (s === 'warn') return <AlertTriangle className="h-4 w-4 text-warning" />;
    if (s === 'fail') return <XCircle className="h-4 w-4 text-destructive" />;
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  };

  return (
    <div className="flex flex-col gap-5 page-enter">
      <EditorialPageHeader
        sectionLabel="SISTEMA · DIAGNÓSTICO"
        title="Diagnóstico do Sistema"
        description="Status do banco, migrations aplicadas e diagnóstico de carregamento"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => { refetchMig(); refetchSchema(); }}>
              <RefreshCw className="h-4 w-4 mr-2" /> Recarregar
            </Button>
            <Button variant="outline" size="sm" onClick={copyDiagnostics}>
              <Copy className="h-4 w-4 mr-2" /> Copiar
            </Button>
          </>
        }
      />

      {/* Resumo schema */}
      {!schemaLoading && (
        <Alert variant={allOk ? 'default' : 'destructive'}>
          {allOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <AlertTitle>
            {schemaError ? 'Consulta de schema indisponível' : allOk ? 'Schema do solado OK' : `${missing.length} objeto(s) ausente(s)`}
          </AlertTitle>
          <AlertDescription>
            {schemaError
              ? (schemaError as Error).message
              : allOk
              ? 'Tabela sole_size_conjugations e funções get_sole_size_key / get_sole_group_id_for_product estão presentes.'
              : `Faltando: ${missing.map((m) => m.name).join(', ')}. Aplique a migration correspondente.`}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={abaUrl} onValueChange={setAbaUrl} className="w-full">
        <HubTabsList
          tabs={[
            { value: 'diagnostics', label: 'Diagnóstico', icon: Stethoscope },
            { value: 'schema', label: 'Schema', icon: Database },
            { value: 'migrations', label: 'Migrations', icon: FileCode },
            { value: 'pedidos', label: 'Pedidos', icon: Stethoscope },
            { value: 'consumo', label: 'Consumo', icon: Database },
          ]}
        />

        {/* DIAGNÓSTICO */}
        <TabsContent value="diagnostics" className="space-y-4">
          <Panel
            eyebrow="SISTEMA · DIAGNÓSTICO"
            title="Diagnóstico automático"
            subtitle={'Verifica as causas mais comuns do erro "Importing a module script failed": versão do build defasada, Service Worker antigo, Cache Storage poluído, conectividade e storage do navegador.'}
            actions={
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={runDiagnostics} disabled={running}>
                  {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Stethoscope className="h-4 w-4 mr-2" />}
                  Executar
                </Button>
                <Button size="sm" variant="outline" onClick={() => manualVersionCheck()}>
                  <Wifi className="h-4 w-4 mr-2" /> Checar versão
                </Button>
                <Button size="sm" variant="destructive" onClick={clearCachesAndReload}>
                  <HardDrive className="h-4 w-4 mr-2" /> Limpar cache
                </Button>
              </div>
            }
            bodyClassName="space-y-2"
          >
              {diag.length === 0 && !running && (
                <p className="text-sm text-muted-foreground">Nenhum diagnóstico executado ainda.</p>
              )}
              {diag.map((d) => (
                <div key={d.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
                  <div className="mt-0.5">{statusIcon(d.status)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{d.label}</p>
                      <Badge variant="outline" className="text-xs uppercase">{d.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 break-all">{d.detail}</p>
                    {d.hint && <p className="text-xs text-warning mt-1">💡 {d.hint}</p>}
                  </div>
                </div>
              ))}
          </Panel>

          <Panel
            eyebrow="SISTEMA · DIAGNÓSTICO"
            title="Causas comuns do erro de import de módulo"
            bodyClassName="space-y-2 text-sm text-muted-foreground"
          >
              <p><strong className="text-foreground">1. Build novo no servidor.</strong> O HTML antigo da aba referencia chunks que já não existem. Solução: recarregar (Ctrl+Shift+R).</p>
              <p><strong className="text-foreground">2. Service Worker servindo cache obsoleto.</strong> Use "Limpar cache" para desregistrar o SW e apagar todos os caches.</p>
              <p><strong className="text-foreground">3. Conexão instável.</strong> O fetch do chunk JS falha durante a navegação por lazy import.</p>
              <p><strong className="text-foreground">4. Bloqueio por extensão/proxy.</strong> Antivírus/proxy corporativo pode rejeitar arquivos .js do sandbox.</p>
              <p><strong className="text-foreground">5. localStorage indisponível.</strong> Navegação anônima estrita pode bloquear armazenamento e impedir hidratação.</p>
          </Panel>
        </TabsContent>

        {/* SCHEMA */}
        <TabsContent value="schema">
          <Panel
            eyebrow="SISTEMA · DIAGNÓSTICO"
            title="Objetos críticos do schema"
            subtitle="Validação de tabelas e funções essenciais para o cálculo de solados."
            bodyClassName="space-y-2"
          >
              {schemaLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
              {schemaError && <p className="text-sm text-destructive">Consulta indisponível: {(schemaError as Error).message}</p>}
              {(schemaObjects ?? []).map((o) => (
                <div key={o.name} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
                  <div className="mt-0.5">
                    {o.exists
                      ? <CheckCircle2 className="h-4 w-4 text-success" />
                      : <XCircle className="h-4 w-4 text-destructive" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-semibold text-foreground">{o.name}</code>
                      <Badge variant="outline" className="text-xs uppercase">{o.type}</Badge>
                      {required.includes(o.name) && (
                        <Badge variant="secondary" className="text-xs">obrigatório</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{o.description}</p>
                  </div>
                </div>
              ))}
          </Panel>
        </TabsContent>

        {/* MIGRATIONS */}
        <TabsContent value="migrations">
          <Panel
            eyebrow="SISTEMA · DIAGNÓSTICO"
            title="Migrations aplicadas"
            subtitle={migLoading ? 'Carregando…' : migrationsError ? 'Consulta indisponível.' : `${migrations?.length ?? 0} migration(s) aplicada(s) — exibindo as 200 mais recentes.`}
          >
              {migrationsError && <p className="px-3 py-2 text-sm text-destructive">Consulta indisponível: {(migrationsError as Error).message}</p>}
              <ScrollArea className="h-[480px] rounded-md border border-border">
                <div className="divide-y divide-border">
                  {(migrations ?? []).map((m) => (
                    <div key={m.version} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/40">
                      <div className="min-w-0 flex-1">
                        <code className="text-xs font-mono text-foreground">{m.version}</code>
                        {m.name && <p className="text-xs text-muted-foreground truncate">{m.name}</p>}
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {m.statements_count} stmt{m.statements_count === 1 ? '' : 's'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
          </Panel>
        </TabsContent>

        {/* PEDIDOS — sinais consolidados dos comandos PV → ficha → estoque. */}
        <TabsContent value="pedidos" className="space-y-4">
          {pvSystemError && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Diagnóstico dos pedidos indisponível</AlertTitle>
              <AlertDescription>
                {(pvSystemError as Error).message}. O painel não assume estado saudável quando o RPC não responde.
              </AlertDescription>
            </Alert>
          )}

          <Panel
            eyebrow="PV · FICHA · ESTOQUE"
            title="Saúde dos comandos de pedido"
            subtitle="Receipts idempotentes, plano/readiness, ressincronização, delta de débito, grants e atomicidade da promoção. Fonte: get_sale_order_command_diagnostics(NULL) + run_consumption_parity_tests()."
            actions={
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetchPvSystem()}
                disabled={pvSystemFetching}
              >
                {pvSystemFetching
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <RefreshCw className="h-4 w-4 mr-2" />}
                Atualizar
              </Button>
            }
            bodyClassName="space-y-2"
          >
            {pvSystemLoading && (
              <p className="text-sm text-muted-foreground">Consultando contratos vivos do fluxo de pedidos…</p>
            )}

            {!pvSystemLoading && !pvSystemError && (() => {
              const rows = pvSystemChecks ?? [];
              const present = new Set(rows.map((row) => row.check_name));
              const missingSignals = REQUIRED_PV_SYSTEM_SIGNALS.filter((name) => !present.has(name));
              const issueCount = rows.reduce((sum, row) => sum + Math.max(0, Number(row.item_count) || 0), 0);
              const hasCriticalIssue = rows.some((row) => {
                const severity = (row.severity || '').toLowerCase();
                return Number(row.item_count) > 0
                  && (severity.includes('error') || severity.includes('crit') || severity.includes('alto'));
              });

              return (
                <>
                  {rows.length === 0 && (
                    <Alert variant="destructive">
                      <XCircle className="h-4 w-4" />
                      <AlertTitle>Zero sinais retornados</AlertTitle>
                      <AlertDescription>Zero casos não é verde: confirme a migration e os grants do RPC.</AlertDescription>
                    </Alert>
                  )}
                  {missingSignals.length > 0 && (
                    <Alert variant="destructive">
                      <XCircle className="h-4 w-4" />
                      <AlertTitle>{missingSignals.length} sinal(is) obrigatório(s) ausente(s)</AlertTitle>
                      <AlertDescription className="break-all">{missingSignals.join(', ')}</AlertDescription>
                    </Alert>
                  )}
                  {rows.length > 0 && missingSignals.length === 0 && issueCount === 0 && (
                    <div className="flex items-center gap-2 text-sm text-success">
                      <CheckCircle2 className="h-4 w-4" /> Todos os contratos operacionais estão saudáveis.
                    </div>
                  )}
                  {rows.length > 0 && issueCount > 0 && (
                    <div className={`flex items-center gap-2 text-sm ${hasCriticalIssue ? 'text-destructive' : 'text-warning'}`}>
                      {hasCriticalIssue
                        ? <XCircle className="h-4 w-4" />
                        : <AlertTriangle className="h-4 w-4" />}
                      {issueCount} ocorrência(s) exigem atenção.
                    </div>
                  )}
                  {rows.map((row) => (
                    <CheckRow
                      key={`${row.category}:${row.check_name}`}
                      row={{
                        ...row,
                        check_name: PV_SYSTEM_SIGNAL_LABELS[row.check_name] ?? row.check_name,
                      }}
                    />
                  ))}
                </>
              );
            })()}
          </Panel>

          <Alert>
            <Database className="h-4 w-4" />
            <AlertTitle>Convenção do delta</AlertTitle>
            <AlertDescription>
              O relatório-base usa delta = debitado − esperado. Falta operacional é esperado − debitado &gt; 0;
              excesso de débito deve aparecer separado e nunca ser rotulado como falta.
            </AlertDescription>
          </Alert>
        </TabsContent>

        {/* CONSUMO — guards de consistência + paridade do motor de consumo */}
        <TabsContent value="consumo" className="space-y-4">
          {/* Normalização assistida pé×par do cabedal (spec consumo-cabedal-padrao-par). */}
          <CabedalParPeAuditPanel />

          {/* Componente direto cujo produto foi apagado: jsonb sem FK, então o
              vínculo morre calado e o material some do custo e da compra.
              Recadastrar não reata (ID novo) — daí o religamento assistido. */}
          <Panel
            eyebrow="FICHA TÉCNICA · COMPONENTES"
            title="Componente direto órfão"
            subtitle="Ficha aponta pra produto que não existe mais — não é reservado nem debitado"
          >
            <OrphanDirectComponentsPanel />
          </Panel>

          {consChecksError && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Verificações de consumo indisponíveis</AlertTitle>
              <AlertDescription>{consChecksError}</AlertDescription>
            </Alert>
          )}

          <Panel
            eyebrow="PCP · CONSUMO"
            title="Consistência de consumo"
            subtitle="Lacunas de cadastro que reintroduzem consumo errado (largura faltando, palmilha pronta inconsistente, solado sem specs, fachete sem consumo). Fonte: consumption_consistency_report()."
            actions={
              <Button size="sm" onClick={runConsumptionChecks} disabled={consRunning}>
                {consRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Stethoscope className="h-4 w-4 mr-2" />}
                Executar
              </Button>
            }
            bodyClassName="space-y-2"
          >
            {consChecks === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Clique em “Executar” para varrer as inconsistências de cadastro que distorcem o consumo.</p>
            )}
            {consChecks !== null && consChecks.length === 0 && !consRunning && (
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Nenhuma inconsistência de cadastro encontrada.</div>
            )}
            {(consChecks ?? []).slice().sort((a, b) => b.item_count - a.item_count).map((c, i) => (
              <CheckRow key={i} row={c} />
            ))}
          </Panel>

          {/* Custeio — auditoria 03/08/2026. A margem armazenada estava em −59,3%
              (custo R$ 45,65/par contra preço R$ 24,93/par) e nada na tela dizia
              por quê: o custeio usava snapshot já marcado como desatualizado e o
              solado INFANTIL/CARAMELO entrava a R$ 0,00 desde 11/07. */}
          <Panel
            eyebrow="FINANCEIRO · CUSTO"
            title="Consistência do custeio"
            subtitle="Lacunas que fazem o custo sair errado em silêncio: material sem preço, custo apoiado em snapshot desatualizado, linha repetida na ficha, ficha sem operação de mão de obra, custo acima do preço de venda e unidade não convertida. Fonte: cost_consistency_report(). Use o botão acima pra rodar."
            bodyClassName="space-y-2"
          >
            {costChecks === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Rode a verificação acima pra incluir a consistência do custeio.</p>
            )}
            {costChecks !== null && costChecks.length === 0 && !consRunning && (
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Custo íntegro — nenhuma lacuna de cadastro encontrada.</div>
            )}
            {(costChecks ?? []).slice().sort((a, b) => b.item_count - a.item_count).map((c, i) => (
              <CheckRow key={i} row={c} />
            ))}
          </Panel>

          {/* Ponto — auditoria 07/08/2026. O crachá do relógio (IDUsuário) é um
              SLOT RECICLADO: o nº 6 era da "camila" e hoje é do "Admilson"; o nº 3
              era do "junior" e hoje é da "CAMILA". Como o arquivo do equipamento só
              exporta IDUsuário/Nome/Dep., a vigência da ficha
              (admission_date..termination_date) é a ÚNICA âncora que impede atribuir
              ponto a quem nem estava na empresa — daí este painel vigiar o cadastro
              de que ela depende. */}
          <Panel
            eyebrow="RH · PONTO"
            title="Identidade do relógio de ponto"
            subtitle="Saúde do casamento ponto×funcionário: ficha com crachá e sem admissão (sentinela da constraint), crachá que bate ponto sem ficha, registro sem funcionário resolvido, ficha ativa sem crachá, crachá que trocou de dono e ponto órfão por herança de crachá. Fonte: timeclock_identity_report(). Use o botão acima pra rodar."
            bodyClassName="space-y-2"
          >
            {clockChecks === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Rode a verificação acima pra incluir a identidade do relógio de ponto.</p>
            )}
            {clockChecks !== null && clockChecks.length === 0 && !consRunning && (
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Ponto íntegro — todo registro resolve um funcionário.</div>
            )}
            {(clockChecks ?? []).slice().sort((a, b) => b.item_count - a.item_count).map((c, i) => (
              <CheckRow key={i} row={c} />
            ))}
          </Panel>

          <Panel
            eyebrow="PCP · CONSUMO"
            title="Componentes por Cor — consistência do mapeamento"
            subtitle="Cadastro quebrado no mapeamento por cor predominante (produto inexistente/inativo, quantidade zerada, duplicata, cor órfã do grupo, flag sem mapeamento). Fonte: component_colors_consistency_report(). Use o botão acima pra rodar."
            bodyClassName="space-y-2"
          >
            {cpcChecks === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Rode a verificação acima pra incluir a consistência dos componentes por cor.</p>
            )}
            {cpcChecks !== null && cpcChecks.every((c) => c.item_count === 0) && !consRunning && (
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Nenhuma inconsistência no mapeamento por cor.</div>
            )}
            {(cpcChecks ?? []).filter((c) => c.item_count > 0).slice().sort((a, b) => b.item_count - a.item_count).map((c, i) => (
              <CheckRow key={i} row={c} />
            ))}
          </Panel>

          <Panel
            eyebrow="PCP · FRESCOR"
            title="Frescor — custo & compra"
            subtitle="Custo congelado desatualizado (ficha mudou depois do snapshot → recalcular/reabrir) e ondas com prazo de compra vencido/iminente. Fonte: pcp_freshness_report(). Use o botão acima pra rodar."
            bodyClassName="space-y-2"
          >
            {freshChecks === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Rode a verificação acima pra incluir o frescor de custo/compra.</p>
            )}
            {(freshChecks ?? []).slice().sort((a, b) => b.item_count - a.item_count).map((c, i) => (
              <CheckRow key={i} row={c} />
            ))}
          </Panel>

          <Panel
            eyebrow="PEDIDO · VÍNCULOS"
            title="Vínculos do item do pedido"
            subtitle="OP ativa sem item do PV, OS do fluxo por-item com vínculo destruído, item com mais de uma OP ativa. Tudo deve ficar em ZERO — se subir, alguma rotina voltou a apagar e recriar sale_order_items (foi o que duplicou as etiquetas do PV-00146). OS por PV/setor não entra: não tem item único e acusaria falso positivo. Fonte: broken_sale_order_links_report()."
            bodyClassName="space-y-1.5"
          >
            {linkChecks === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Rode a verificação acima pra checar os vínculos do pedido de venda.</p>
            )}
            {linkChecks !== null && linkChecks.every(c => Number(c.qtd) === 0) && !consRunning && (
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Nenhum vínculo quebrado.</div>
            )}
            {(linkChecks ?? []).filter(c => Number(c.qtd) > 0).map((c, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
                <Badge
                  variant="outline"
                  className={
                    c.severity === 'critico'
                      ? 'bg-red-500/10 text-red-600 border-transparent text-[10px] shrink-0 tabular-nums'
                      : 'bg-amber-500/10 text-amber-600 border-transparent text-[10px] shrink-0 tabular-nums'
                  }
                >
                  {c.qtd}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.check_name}</p>
                  <p className="text-xs text-muted-foreground break-words">{c.detalhe}</p>
                </div>
              </div>
            ))}
          </Panel>

          <Panel
            eyebrow="ESTOQUE · RESERVA"
            title="Reserva defasada vs ficha atual"
            subtitle="Material que a ficha técnica pede HOJE mas que a OP ativa NÃO tem reservado. A reserva é feita na criação da OP; se a ficha ganhar componentes depois, o resync não re-reserva — e como a baixa na finalização converte RESERVA em movimento, esse material sai da fábrica sem débito. Foi o que abriu o furo do PV-00145 (fivela, rebite e binóculo strass consumidos e nunca debitados). Fonte: list_ops_with_stale_reservations()."
            bodyClassName="space-y-1.5"
          >
            {staleResRows === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Rode a verificação acima pra checar as reservas das OPs ativas.</p>
            )}
            {staleResRows !== null && staleResRows.length === 0 && !consRunning && (
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Toda OP ativa tem reserva pra o que a ficha pede.</div>
            )}
            {staleResRows !== null && staleResRows.length > 0 && (
              <>
                <div className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
                  <Badge variant="outline" className="bg-red-500/10 text-red-600 border-transparent text-[10px] shrink-0 tabular-nums">
                    {staleResRows.length}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">materiais sem reserva em {new Set(staleResRows.map(r => r.order_number)).size} OP(s) ativa(s)</p>
                    <p className="text-xs text-muted-foreground break-words">
                      Cancele e refaça a reserva da OP (ou ajuste o estoque na baixa) antes de finalizar, senão vira furo de estoque.
                    </p>
                  </div>
                </div>
                {staleResRows.slice(0, 40).map((r, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-transparent text-[10px] shrink-0 tabular-nums">
                      {Number(r.required_qty).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.product_name}</p>
                      <p className="text-xs text-muted-foreground break-words">
                        {r.sale_order_number} · {r.order_number} · {r.reference_name}
                        {/* Componente Direto = a ficha FIXA o produto, então a linha é
                            um material genuinamente sem reserva. As outras origens são
                            resolvidas por grupo e merecem conferência antes de agir. */}
                        {(r.consumption_source === 'direct_components' || r.consumption_source === 'component_color')
                          ? ' · componente direto'
                          : ` · ${r.consumption_source}`}
                      </p>
                    </div>
                  </div>
                ))}
                {staleResRows.length > 40 && (
                  <p className="text-xs text-muted-foreground">
                    Mostrando 40 de {staleResRows.length} — rode list_ops_with_stale_reservations() no SQL pra a lista completa.
                  </p>
                )}
              </>
            )}
          </Panel>

          <Panel
            eyebrow="ESTOQUE · FURO DE BAIXA"
            title="Furo de baixa — material sem débito"
            subtitle="Material que a ficha pedia e NUNCA saiu do estoque: a OP foi finalizada, a produção consumiu, mas nenhum stock_movements foi gravado. Acontece quando o material não tinha reserva (a baixa converte RESERVA em movimento) ou quando a baixa foi parcial por falta de estoque. Últimos 90 dias. Fonte: list_stock_debit_holes()."
            bodyClassName="space-y-1.5"
            actions={
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => (holesEnabled ? refetchHoles() : setHolesEnabled(true))}
                disabled={holesLoading}
              >
                {holesLoading
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <RefreshCw className="h-4 w-4 mr-2" />}
                {holesEnabled ? 'Recarregar' : 'Carregar furos'}
              </Button>
            }
          >
            {!holesEnabled && !holesLoading && (
              <p className="text-sm text-muted-foreground">
                Varredura pesada — clique em "Carregar furos" pra listar o material consumido sem baixa nas OPs dos últimos 90 dias.
              </p>
            )}
            {holesError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4" /> Falha ao carregar: {(holesError as Error | null)?.message}
              </div>
            )}
            {holesEnabled && !holesLoading && !holesError && holesSummary.linhas === 0 && (
              <EmptyState
                size="sm"
                icon={CheckCircle2}
                title="Nenhum furo de baixa no período"
                description="Todo material que a ficha pediu foi debitado do estoque nas OPs finalizadas dos últimos 90 dias."
              />
            )}
            {holesEnabled && !holesError && holesSummary.linhas > 0 && (
              <>
                <div className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
                  <Badge variant="outline" className="bg-red-500/10 text-red-600 border-transparent text-[10px] shrink-0 tabular-nums">
                    {holesSummary.linhas}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      linhas sem débito em {holesSummary.ops} OP(s) / {holesSummary.pedidos} PV(s) — ≈{' '}
                      {holesSummary.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </p>
                    <p className="text-xs text-muted-foreground break-words">
                      Regularize com entrada + baixa compensatória (efeito líquido zero no saldo) — modelo em
                      {' '}sql-scripts/fix-furo-baixa-pv-00145.sql. Pra impedir novos furos, rode a reserva de delta
                      (reserve_missing_materials_for_order) antes de finalizar.
                    </p>
                  </div>
                </div>
                {(holeRows ?? []).slice(0, 40).map((r, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
                    <Badge
                      variant="outline"
                      className={
                        r.origem === 'consumo_sem_debito'
                          ? 'bg-red-500/10 text-red-600 border-transparent text-[10px] shrink-0 tabular-nums'
                          : 'bg-amber-500/10 text-amber-600 border-transparent text-[10px] shrink-0 tabular-nums'
                      }
                    >
                      {Number(r.diferenca).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                      {r.unit ? ` ${r.unit}` : ''}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{r.product_name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground break-words">
                        {r.sale_order_number ?? '—'} · {r.order_number ?? '—'} · {r.reference_name ?? '—'} ·{' '}
                        {Number(r.valor_estimado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        {r.origem === 'reserva_parcial_pendente' ? ' · baixa parcial pendente' : ' · consumo sem débito'}
                      </p>
                    </div>
                    {/* Só o saldo de reserva preservado tem como ser fechado por
                        RPC — o furo de consumo sem débito não tem reserva viva
                        pra debitar e continua sendo ajuste manual. */}
                    {r.reservation_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 text-xs"
                        disabled={reconcile.isPending}
                        onClick={() => reconcile.mutate({ reservationId: r.reservation_id! })}
                        title="Debita agora o saldo que ficou devendo e fecha a pendência"
                      >
                        Reconciliar
                      </Button>
                    )}
                  </div>
                ))}
                {holesSummary.linhas > 40 && (
                  <p className="text-xs text-muted-foreground">
                    Mostrando 40 de {holesSummary.linhas} — rode list_stock_debit_holes() no SQL pra a lista completa.
                  </p>
                )}
              </>
            )}
          </Panel>

          <Panel
            eyebrow="PCP · CAPACIDADE"
            title="Capacidade & Produtividade — consistência"
            subtitle="Gaps que distorcem gargalo/pares-dia/custo-par: setor sem tempo em nenhuma camada, operação pendente, setor sem equipe, divergência minutos×capacidade da ficha, taxa órfã. Fonte: capacity_consistency_report(). Use o botão acima pra rodar."
            bodyClassName="space-y-1.5"
          >
            {capacityChecks === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Rode a verificação acima pra incluir a consistência da engine de capacidade (/producao/produtividade).</p>
            )}
            {capacityChecks !== null && capacityChecks.length === 0 && !consRunning && (
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Nenhum gap de cadastro na engine de capacidade.</div>
            )}
            {(capacityChecks ?? []).map((c, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
                <Badge
                  variant="outline"
                  className={
                    c.severidade === 'alta'
                      ? 'bg-red-500/10 text-red-600 border-transparent text-[10px] shrink-0'
                      : c.severidade === 'media'
                        ? 'bg-amber-500/10 text-amber-600 border-transparent text-[10px] shrink-0'
                        : 'bg-muted text-muted-foreground border-transparent text-[10px] shrink-0'
                  }
                >
                  {c.categoria}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.referencia}</p>
                  <p className="text-xs text-muted-foreground">{c.detalhe}</p>
                </div>
              </div>
            ))}
          </Panel>

          <Panel
            eyebrow="PCP · DÉBITO"
            title="Débito × Ficha técnica (esperado × debitado por OP)"
            subtitle="Recalcula o consumo esperado (ficha × grade, com grade base escalada) das OPs dos últimos 60 dias e compara com o debitado em stock_movements. Tolerância 1% + piso 0,01. Fonte: debit_consistency_report(). Use o botão acima pra rodar."
            bodyClassName="space-y-2"
          >
            {debitRows === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Rode a verificação acima pra incluir a auditoria de débito por OP.</p>
            )}
            {debitRows !== null && (() => {
              const problemas = debitRows.filter((r) => r.classe !== 'ok');
              const porClasse = new Map<string, number>();
              for (const r of debitRows) porClasse.set(r.classe, (porClasse.get(r.classe) ?? 0) + 1);
              const LIMITE = 60;
              const exibidas = problemas
                .slice()
                .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
                .slice(0, LIMITE);
              return (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(['ok', 'furo', 'divergente', 'extra'] as const).map((c) => (
                      <Badge key={c} variant="outline" className={`text-xs uppercase ${
                        c === 'ok' ? 'text-success' : c === 'furo' ? 'text-destructive' : 'text-warning'
                      }`}>{c}: {porClasse.get(c) ?? 0}</Badge>
                    ))}
                  </div>
                  {problemas.length === 0 && (
                    <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Todos os débitos batem com a ficha × grade (dentro da tolerância).</div>
                  )}
                  {problemas.length > 0 && (
                    <ScrollArea className="h-[320px] rounded-md border border-border">
                      <div className="divide-y divide-border">
                        {exibidas.map((r, i) => (
                          <div key={i} className="flex items-start gap-3 px-3 py-2 hover:bg-muted/40">
                            <div className="mt-0.5">
                              {r.classe === 'furo'
                                ? <XCircle className="h-4 w-4 text-destructive" />
                                : <AlertTriangle className="h-4 w-4 text-warning" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-foreground">{r.order_number}</p>
                                <span className="text-sm text-foreground truncate">{r.product_name}</span>
                                <Badge variant="secondary" className="text-xs">{r.component}</Badge>
                                <Badge variant="outline" className="text-xs uppercase">{r.classe}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                esperado {Number(r.esperado).toLocaleString('pt-BR')} {r.unit ?? ''} · debitado {Number(r.debitado).toLocaleString('pt-BR')} {r.unit ?? ''}
                                {` · Δ ${Number(r.delta).toLocaleString('pt-BR')} ${r.unit ?? ''}`}
                                {r.delta_pct != null ? ` (${Number(r.delta_pct).toLocaleString('pt-BR')}%)` : ''}
                                {r.obs ? ` · ${r.obs}` : ''}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                  {problemas.length > LIMITE && (
                    <p className="text-xs text-muted-foreground">Exibindo as {LIMITE} maiores divergências de {problemas.length} — a lista completa sai de debit_consistency_report() no SQL.</p>
                  )}
                </>
              );
            })()}
          </Panel>

          <Panel
            eyebrow="PCP · DÉBITO"
            title="Guards da auditoria de débito (fixes 2026-07-19)"
            subtitle="Trava de regressão dos fixes da auditoria débito ficha×grade (grade base escalada, ledger honesto na conversão, variant_sole, retry de solado, erro_reserva visível). Fonte: run_debit_guard_tests(). Use o botão acima pra rodar."
            bodyClassName="space-y-2"
          >
            {debitGuards === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Rode a verificação acima pra incluir os guards da auditoria de débito.</p>
            )}
            {(debitGuards ?? []).map((p, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
                <div className="mt-0.5">{p.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{p.case_name}</p>
                    <Badge variant="outline" className={`text-xs uppercase ${p.ok ? 'text-success' : 'text-destructive'}`}>{p.ok ? 'ok' : 'falhou'}</Badge>
                  </div>
                  {p.message && <p className="text-xs text-muted-foreground mt-0.5 break-all">{p.message}</p>}
                </div>
              </div>
            ))}
          </Panel>

          <Panel
            eyebrow="PCP · CONSUMO"
            title="Paridade do motor de consumo (TS × SQL)"
            subtitle="Trava o contrato do cálculo de consumo entre o lado SQL e o TS. Fonte: run_consumption_parity_tests()."
            bodyClassName="space-y-2"
          >
            {parityChecks === null && !consRunning && (
              <p className="text-sm text-muted-foreground">Rode a verificação acima para incluir os testes de paridade.</p>
            )}
            {parityChecks !== null && parityChecks.length === 0 && !consRunning && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Paridade não executada</AlertTitle>
                <AlertDescription>run_consumption_parity_tests() devolveu 0 casos. Zero casos não é suíte verde.</AlertDescription>
              </Alert>
            )}
            {(parityChecks ?? []).map((p, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
                <div className="mt-0.5">{p.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{p.case_name}</p>
                    <Badge variant="outline" className={`text-xs uppercase ${p.ok ? 'text-success' : 'text-destructive'}`}>{p.ok ? 'ok' : 'falhou'}</Badge>
                  </div>
                  {p.message && <p className="text-xs text-muted-foreground mt-0.5 break-all">{p.message}</p>}
                </div>
              </div>
            ))}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
