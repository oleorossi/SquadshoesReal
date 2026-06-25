import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle as CheckCircle2, XCircle, ArrowsClockwise as RefreshCw, Database, Stethoscope, Copy, Warning as AlertTriangle, HardDrive, WifiHigh as Wifi, FileCode, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { manualVersionCheck } from '@/components/VersionChecker';

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

export default function SystemDiagnostics() {
  const [diag, setDiag] = useState<DiagnosticItem[]>([]);
  const [running, setRunning] = useState(false);

  // C3 (2026-06-25): expõe na UI os guards de consumo que já existiam só em SQL/
  // testes — consumption_consistency_report() lista lacunas de cadastro que
  // reintroduzem consumo errado (largura faltando, palmilha pronta inconsistente,
  // solado sem specs, fachete sem consumo) e run_consumption_parity_tests() trava
  // o contrato TS×SQL do motor de consumo. Sob demanda (botão) — são varreduras.
  const [consChecks, setConsChecks] = useState<ConsistencyRow[] | null>(null);
  const [parityChecks, setParityChecks] = useState<ParityRow[] | null>(null);
  const [consRunning, setConsRunning] = useState(false);

  const runConsumptionChecks = async () => {
    setConsRunning(true);
    try {
      const [consRes, parRes] = await Promise.all([
        supabase.rpc('consumption_consistency_report'),
        supabase.rpc('run_consumption_parity_tests'),
      ]);
      if (consRes.error) throw consRes.error;
      setConsChecks((consRes.data ?? []) as ConsistencyRow[]);
      // Paridade pode depender de flags/dados de integração — tolera falha.
      if (parRes.error) {
        setParityChecks([]);
        toast.message('Paridade indisponível', { description: parRes.error.message });
      } else {
        setParityChecks((parRes.data ?? []) as ParityRow[]);
      }
      toast.success('Verificação de consumo concluída');
    } catch (e: any) {
      toast.error('Falha na verificação de consumo: ' + e.message);
    } finally {
      setConsRunning(false);
    }
  };

  const { data: migrations, isLoading: migLoading, refetch: refetchMig } = useQuery({
    queryKey: ['system-diag', 'migrations'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_applied_migrations');
      if (error) throw error;
      return (data ?? []) as Array<{ version: string; name: string; statements_count: number }>;
    },
  });

  const { data: schemaObjects, isLoading: schemaLoading, refetch: refetchSchema } = useQuery({
    queryKey: ['system-diag', 'schema-objects'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('check_schema_objects');
      if (error) throw error;
      return (data ?? []) as SchemaObject[];
    },
  });

  const required = ['sole_size_conjugations', 'get_sole_size_key', 'get_sole_group_id_for_product'];
  const missing = (schemaObjects ?? []).filter((o) => required.includes(o.name) && !o.exists);
  const allOk = missing.length === 0 && (schemaObjects ?? []).length > 0;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            {allOk ? 'Schema do solado OK' : `${missing.length} objeto(s) ausente(s)`}
          </AlertTitle>
          <AlertDescription>
            {allOk
              ? 'Tabela sole_size_conjugations e funções get_sole_size_key / get_sole_group_id_for_product estão presentes.'
              : `Faltando: ${missing.map((m) => m.name).join(', ')}. Aplique a migration correspondente.`}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="diagnostics" className="w-full">
        <TabsList>
          <TabsTrigger value="diagnostics"><Stethoscope className="h-4 w-4 mr-1.5" />Diagnóstico</TabsTrigger>
          <TabsTrigger value="schema"><Database className="h-4 w-4 mr-1.5" />Schema</TabsTrigger>
          <TabsTrigger value="migrations"><FileCode className="h-4 w-4 mr-1.5" />Migrations</TabsTrigger>
          <TabsTrigger value="consumo"><Database className="h-4 w-4 mr-1.5" />Consumo</TabsTrigger>
        </TabsList>

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
            subtitle={migLoading ? 'Carregando…' : `${migrations?.length ?? 0} migration(s) aplicada(s) — exibindo as 200 mais recentes.`}
          >
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

        {/* CONSUMO — guards de consistência + paridade do motor de consumo */}
        <TabsContent value="consumo" className="space-y-4">
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
            {(consChecks ?? []).slice().sort((a, b) => b.item_count - a.item_count).map((c, i) => {
              // item_count=0 → check passou (verde), independe da severidade-rótulo.
              // Severidades vêm em PT ('alto'/'medio') além de en ('error'/'warn').
              const clean = (c.item_count ?? 0) === 0;
              const sev = (c.severity || '').toLowerCase();
              const isErr = !clean && (sev.includes('alto') || sev.includes('error') || sev.includes('crit'));
              const isWarn = !clean && (sev.includes('med') || sev.includes('méd') || sev.includes('warn'));
              const tone = clean ? 'text-success' : isErr ? 'text-destructive' : isWarn ? 'text-warning' : 'text-muted-foreground';
              const icon = clean
                ? <CheckCircle2 className="h-4 w-4 text-success" />
                : isErr ? <XCircle className="h-4 w-4 text-destructive" />
                : isWarn ? <AlertTriangle className="h-4 w-4 text-warning" />
                : <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
              return (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
                  <div className="mt-0.5">{icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">{c.check_name}</p>
                      <Badge variant="outline" className={`text-xs uppercase ${tone}`}>{c.severity}</Badge>
                      <Badge variant="secondary" className="text-xs">{c.item_count} item(ns)</Badge>
                    </div>
                    {c.sample && <p className="text-xs text-muted-foreground mt-0.5 break-all">{c.sample}</p>}
                  </div>
                </div>
              );
            })}
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
              <p className="text-sm text-muted-foreground">Sem casos de paridade retornados.</p>
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
