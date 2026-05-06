import { useEffect, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, RefreshCw, Database, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface ExampleRow {
  id: string;
  label: string;
  value: any;
}

interface CheckResult {
  key: string;
  table: string;
  field: string;
  severity: 'high' | 'medium' | 'low' | 'ok';
  description: string;
  expected: string;
  count: number;
  examples: ExampleRow[];
}

interface AuditResponse {
  generated_at: string;
  checks: CheckResult[];
}

export default function UnitAudit() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: rpc, error: rpcErr } = await supabase.rpc('audit_unit_divergences' as any);
      if (rpcErr) throw rpcErr;
      setData(rpc as unknown as AuditResponse);
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao carregar auditoria');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totalIssues = data?.checks.reduce((s, c) => s + (c.severity !== 'ok' ? c.count : 0), 0) ?? 0;
  const failingChecks = data?.checks.filter(c => c.severity !== 'ok' && c.count > 0) ?? [];
  const passingChecks = data?.checks.filter(c => c.count === 0) ?? [];

  const sevColor = (s: string) => {
    if (s === 'high') return 'destructive';
    if (s === 'medium') return 'default';
    if (s === 'ok') return 'secondary';
    return 'outline';
  };

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Auditoria de Unidades</h1>
            <p className="text-sm text-muted-foreground">
              Detecta divergências de unidade de medida entre o frontend e o backend, com exemplos de registros afetados.
            </p>
          </div>
          <Button onClick={load} disabled={loading} size="sm" className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Reexecutar
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Falha na auditoria</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && !data && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground font-medium">Verificações</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.checks.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground font-medium">Com divergência</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{failingChecks.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground font-medium">Registros afetados</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalIssues}</div>
                </CardContent>
              </Card>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Última execução: {new Date(data.generated_at).toLocaleString('pt-BR')}. As regras comparam unidades canônicas
                (kg, m, dm², cm, par, etc.) e detectam valores fora de faixa típica que indicam mistura de unidades.
              </AlertDescription>
            </Alert>

            {failingChecks.length === 0 ? (
              <Card>
                <CardContent className="py-10 flex flex-col items-center gap-2 text-center">
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                  <h3 className="font-semibold">Nenhuma divergência detectada</h3>
                  <p className="text-sm text-muted-foreground">
                    Todas as verificações de unidade passaram com sucesso.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Divergências encontradas ({failingChecks.length})
                </h2>
                {failingChecks.map(check => (
                  <Card key={check.key} className="border-l-4" style={{ borderLeftColor: check.severity === 'high' ? 'hsl(var(--destructive))' : 'hsl(var(--primary))' }}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <CardTitle className="text-sm font-semibold">{check.description}</CardTitle>
                            <Badge variant={sevColor(check.severity) as any} className="text-[10px]">
                              {check.severity === 'high' ? 'CRÍTICO' : 'ATENÇÃO'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <Database className="h-3 w-3" />
                            <code className="font-mono">{check.table}.{check.field}</code>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {check.count} {check.count === 1 ? 'registro' : 'registros'}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="text-xs text-muted-foreground mb-2">
                        <span className="font-medium">Esperado:</span> {check.expected}
                      </div>
                      {check.examples && check.examples.length > 0 && (
                        <div className="mt-2 rounded-md border border-border bg-muted/30 overflow-hidden">
                          <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground border-b border-border">
                            Exemplos ({check.examples.length})
                          </div>
                          <ul className="divide-y divide-border">
                            {check.examples.map(ex => (
                              <li key={ex.id} className="px-3 py-1.5 text-xs flex items-center justify-between gap-2">
                                <span className="truncate flex-1" title={ex.label}>{ex.label}</span>
                                <code className="font-mono text-destructive shrink-0">{String(ex.value)}</code>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {passingChecks.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-2">
                  Verificações que passaram ({passingChecks.length})
                </summary>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {passingChecks.map(c => (
                    <div key={c.key} className="flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-muted/20">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      <code className="font-mono text-[11px] truncate">{c.table}.{c.field}</code>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
