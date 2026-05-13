import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Pulse as Activity, ShieldCheck, ShieldWarning as ShieldAlert, FileText as FileCheck, Warning as AlertTriangle, Clock, CheckCircle as CheckCircle2, XCircle, Wrench } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

type Severity = 'ok' | 'warn' | 'error' | 'pending';

interface DiagItem {
  key: string;
  label: string;
  description: string;
  severity: Severity;
  detail?: string;
}

const SEV_STYLE: Record<Severity, string> = {
  ok:      'bg-green-500/10 text-green-700 border-green-500/30',
  warn:    'bg-amber-500/10 text-amber-700 border-amber-500/30',
  error:   'bg-red-500/10 text-red-700 border-red-500/30',
  pending: 'bg-muted text-muted-foreground border-border',
};

const SEV_ICON: Record<Severity, React.ReactNode> = {
  ok:      <CheckCircle2 className="h-4 w-4" />,
  warn:    <AlertTriangle className="h-4 w-4" />,
  error:   <XCircle className="h-4 w-4" />,
  pending: <Clock className="h-4 w-4" />,
};

export default function NfeDiagnosticPanel() {
  const { data: diagnostics = [], isLoading } = useQuery({
    queryKey: ['nfe-diagnostic'],
    queryFn: async (): Promise<DiagItem[]> => {
      const items: DiagItem[] = [];

      // 1. Empresa cadastrada
      const { data: companies } = await supabase
        .from('companies')
        .select('id, cnpj, razao_social, ambiente, regime_tributario, pis_cofins_regime, cert_status, cert_valid_until, cert_uploaded_at')
        .eq('active', true);

      if (!companies || companies.length === 0) {
        items.push({
          key: 'company', label: 'Empresa emitente', severity: 'error',
          description: 'Nenhuma empresa cadastrada.',
        });
      } else {
        const c = companies[0] as any;
        items.push({
          key: 'company', label: 'Empresa emitente', severity: 'ok',
          description: `${c.razao_social} · CNPJ ${c.cnpj}`,
        });

        // 2. Ambiente
        items.push({
          key: 'env',
          label: 'Ambiente',
          severity: c.ambiente === 'producao' ? 'ok' : 'warn',
          description: c.ambiente === 'producao'
            ? 'Produção — NF-es têm valor fiscal'
            : 'Homologação — NF-es são apenas teste, sem valor fiscal',
        });

        // 3. Certificado A1
        const certSev: Severity =
          c.cert_status === 'erro' ? 'error' :
          c.cert_status === 'valido' ? 'ok' :
          !c.cert_uploaded_at ? 'pending' : 'warn';
        items.push({
          key: 'cert', label: 'Certificado digital A1',
          severity: certSev,
          description:
            certSev === 'error' ? 'Certificado com erro — re-upload necessário (provável senha errada)' :
            certSev === 'ok' ? `Válido até ${c.cert_valid_until ?? '—'}` :
            certSev === 'pending' ? 'Não foi feito upload ainda' :
            'Status desconhecido — verificar com o provedor',
          detail: c.cert_uploaded_at ? `Upload em ${new Date(c.cert_uploaded_at).toLocaleString('pt-BR')}` : undefined,
        });

        // 4. Regime/Tributação
        items.push({
          key: 'tax', label: 'Tributação',
          severity: c.regime_tributario === '1' && c.pis_cofins_regime === 'simples_nacional' ? 'ok' :
                    c.regime_tributario === '1' ? 'warn' : 'ok',
          description:
            c.regime_tributario === '1'
              ? 'Simples Nacional configurado'
              : c.regime_tributario === '3'
              ? 'Regime Normal (Lucro Real/Presumido)'
              : `Regime CRT=${c.regime_tributario}`,
          detail: c.regime_tributario === '1' && c.pis_cofins_regime !== 'simples_nacional'
            ? 'PIS/COFINS regime inconsistente (esperado: simples_nacional)'
            : undefined,
        });
      }

      // 5. NCM nas fichas técnicas
      // technical_sheets.ncm tem default '' (string vazia, não NULL) — filtro
      // anterior `.not('ncm', 'is', null)` contava fichas com NCM vazio como
      // preenchido. Filtra por NCM no formato exato exigido pela NF-e: 8 dígitos.
      const { count: sheetCount } = await supabase
        .from('technical_sheets').select('*', { count: 'exact', head: true });
      const { count: sheetWithNcm } = await supabase
        .from('technical_sheets').select('*', { count: 'exact', head: true })
        .not('ncm', 'is', null)
        .neq('ncm', '');
      const ncmRatio = sheetCount && sheetCount > 0 ? (sheetWithNcm ?? 0) / sheetCount : 0;
      items.push({
        key: 'ncm', label: 'NCM nas fichas técnicas',
        severity: ncmRatio === 1 ? 'ok' : ncmRatio > 0.8 ? 'warn' : 'error',
        description: `${sheetWithNcm}/${sheetCount} fichas com NCM cadastrado (${Math.round(ncmRatio * 100)}%)`,
      });

      // 6. NF-es já emitidas
      const { count: nfeCount } = await supabase
        .from('nfe_emitidas').select('*', { count: 'exact', head: true });
      items.push({
        key: 'nfe-history',
        label: 'Histórico de emissão',
        severity: (nfeCount ?? 0) > 0 ? 'ok' : 'pending',
        description: nfeCount === 0
          ? 'Nenhuma NF-e emitida — primeira emissão pendente'
          : `${nfeCount} NF-e(s) já processadas`,
      });

      // 7. Provider configurado (Spedy — em implementação)
      items.push({
        key: 'provider',
        label: 'Provider de emissão (Spedy)',
        severity: 'pending',
        description: 'Integração com Spedy ainda não foi configurada',
        detail: 'Etapa final do setup — depende de credenciais Spedy + cert válido',
      });

      return items;
    },
    staleTime: 30_000,
  });

  const counts = {
    ok: diagnostics.filter(d => d.severity === 'ok').length,
    warn: diagnostics.filter(d => d.severity === 'warn').length,
    error: diagnostics.filter(d => d.severity === 'error').length,
    pending: diagnostics.filter(d => d.severity === 'pending').length,
  };

  const ready = counts.error === 0 && counts.pending <= 1; // só "provider" pendente é ok

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-base font-bold flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Diagnóstico de emissão
        </h3>
        <p className="text-xs text-muted-foreground">
          Health check completo de todos os pré-requisitos pra emitir uma NF-e válida.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-green-500/30">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-green-600 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> OK
            </div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">{counts.ok}</div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-amber-600 font-bold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Atenção
            </div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">{counts.warn}</div>
          </CardContent>
        </Card>
        <Card className="border-red-500/30">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-red-600 font-bold flex items-center gap-1">
              <XCircle className="w-3 h-3" /> Erro
            </div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">{counts.error}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-bold flex items-center gap-1">
              <Clock className="w-3 h-3" /> Pendente
            </div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">{counts.pending}</div>
          </CardContent>
        </Card>
      </div>

      {/* Status geral */}
      <Card className={cn(ready ? 'border-green-500/30' : 'border-amber-500/30')}>
        <CardContent className="pt-4 pb-4 flex items-center gap-3">
          {ready ? (
            <ShieldCheck className="h-6 w-6 text-green-600" />
          ) : (
            <ShieldAlert className="h-6 w-6 text-amber-600" />
          )}
          <div>
            <p className="font-medium text-sm">
              {ready
                ? 'Sistema pronto pra primeira emissão'
                : 'Configuração incompleta — não emite NF-e ainda'}
            </p>
            <p className="text-xs text-muted-foreground">
              {ready
                ? 'Vá pra "NFes Emitidas" e clique em "Emitir NF-e".'
                : 'Resolva os itens abaixo antes de tentar emitir.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Lista detalhada */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileCheck className="h-4 w-4" /> Checklist
          </CardTitle>
          <CardDescription className="text-xs">
            Cada item precisa estar OK pra emissão funcionar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : (
            diagnostics.map((d) => (
              <div key={d.key} className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0">
                <Badge variant="outline" className={cn('gap-1 mt-0.5 shrink-0', SEV_STYLE[d.severity])}>
                  {SEV_ICON[d.severity]}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{d.label}</p>
                  <p className="text-xs text-muted-foreground">{d.description}</p>
                  {d.detail && (
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">{d.detail}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* TODO: Spedy + cert flow */}
      <Card className="border-dashed border-primary/30 bg-primary/5">
        <CardContent className="pt-4 pb-4 flex items-start gap-3">
          <Wrench className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium text-foreground">Próxima etapa</p>
            <p className="text-muted-foreground mt-0.5">
              Integração com Spedy + re-upload de certificado A1 + emissão de NF-e teste em homologação.
              Esse fluxo será implementado depois que toda a UI estiver organizada.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
