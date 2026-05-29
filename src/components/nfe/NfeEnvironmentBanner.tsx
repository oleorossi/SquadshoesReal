import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Warning as AlertTriangle, CheckCircle, Info } from '@phosphor-icons/react';

/**
 * Banner que exibe o ambiente SEFAZ atual da empresa primária. Crítico em
 * dialogs de emissão de NF (audit round 3 2026-05-29) — antes o operador
 * não tinha clareza se as NFs sendo emitidas eram TESTE (homologação) ou
 * REAIS (produção, com valor fiscal). Auditoria descobriu que o painel
 * GestaoClick podia estar em produção enquanto DB dizia homologação.
 *
 * Cores:
 *   - PRODUÇÃO (vermelho/erro) — NF real com valor fiscal, exige cautela
 *   - HOMOLOGAÇÃO (âmbar/warning) — NF teste, sem valor fiscal
 *   - DIVERGENTE (vermelho intenso) — DB difere do último observado SEFAZ
 */
export function NfeEnvironmentBanner({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['nfe_env_banner'],
    queryFn: async () => {
      const { data: companies } = await supabase
        .from('companies')
        .select('id, ambiente, is_primary')
        .eq('active', true);
      const primary = (companies || []).find((c: any) => c.is_primary) || (companies || [])[0];
      const dbAmbiente = primary?.ambiente ?? null;
      const { data: lastNfe } = await (supabase as any)
        .from('nfe_emitidas')
        .select('numero, tp_amb_sefaz, created_at')
        .eq('status', 'autorizada')
        .not('tp_amb_sefaz', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      const observedTp = lastNfe?.[0]?.tp_amb_sefaz;
      const observedAmbiente = observedTp === '1' ? 'producao' : observedTp === '2' ? 'homologacao' : null;
      const divergent = !!observedAmbiente && !!dbAmbiente && observedAmbiente !== dbAmbiente;
      return { dbAmbiente, observedAmbiente, divergent, lastNfeNumero: lastNfe?.[0]?.numero };
    },
    staleTime: 60_000,
  });

  if (isLoading || !data?.dbAmbiente) return null;

  if (data.divergent) {
    return (
      <div className="rounded-md border-2 border-red-600 bg-red-500/10 p-3">
        <p className="flex items-start gap-2 text-red-700 font-semibold text-sm">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" weight="fill" />
          DIVERGÊNCIA DE AMBIENTE — VERIFIQUE ANTES DE EMITIR
        </p>
        <p className="text-xs text-red-700 mt-1 pl-7">
          Cadastro local diz <strong>{data.dbAmbiente}</strong> mas a última NF autorizada
          (#{data.lastNfeNumero}) retornou da SEFAZ como <strong>{data.observedAmbiente}</strong>.
          Sincronize o ambiente em Configurações → Empresas antes de continuar.
        </p>
      </div>
    );
  }

  const isProducao = data.dbAmbiente === 'producao';
  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isProducao ? 'bg-red-500/10 text-red-700 border border-red-500/30' : 'bg-amber-500/10 text-amber-700 border border-amber-500/30'
      }`}>
        {isProducao ? <CheckCircle className="h-3 w-3" weight="fill" /> : <Info className="h-3 w-3" weight="fill" />}
        {isProducao ? 'Produção (NF real)' : 'Homologação (teste)'}
      </span>
    );
  }

  return (
    <div className={`rounded-md border p-3 ${
      isProducao
        ? 'border-red-500/40 bg-red-500/5 text-red-700'
        : 'border-amber-500/40 bg-amber-500/5 text-amber-700'
    }`}>
      <p className="flex items-start gap-2 font-semibold text-sm">
        {isProducao ? <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" weight="fill" /> : <Info className="h-5 w-5 mt-0.5 shrink-0" weight="fill" />}
        {isProducao
          ? 'AMBIENTE PRODUÇÃO — NF-e tem VALOR FISCAL REAL'
          : 'AMBIENTE HOMOLOGAÇÃO — NF de teste, sem valor fiscal'}
      </p>
      <p className="text-xs mt-1 pl-7">
        {isProducao
          ? 'Esta emissão vai gerar NF real na SEFAZ. Confira destinatário, valores e CFOP antes de confirmar — cancelamento só nas primeiras 24h.'
          : 'Esta emissão NÃO tem valor fiscal. Use pra validar fluxo, formato e configurações. Pra emitir NF real, ative ambiente Produção no painel GestaoClick.'}
      </p>
    </div>
  );
}
