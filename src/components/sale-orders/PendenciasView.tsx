import { useState, useMemo } from 'react';
import {
  Warning as AlertTriangle, Info, XCircle, CaretRight, CaretDown,
  ArrowCounterClockwise as RotateCcw, CircleNotch as Loader2, CheckCircle,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  useSaleOrderPendencias, useCadastroPendencias, useRetryItemPromotion,
  type Severidade, type Segmento, type PendenciasPorPv,
} from '@/hooks/useSaleOrderPendencias';

/**
 * Aba de Pendências do PV — `/sales?view=pendencias`.
 * Fase 2 + 4 de `specs/pv-producao-performance-e-pendencias.md`.
 *
 * ⚠ Requisito 15: severidade NUNCA só por cor. Cada nível carrega ícone + rótulo
 * em texto — a fábrica imprime em preto e branco e nem todo mundo distingue as
 * cores. O mesmo motivo pelo qual as fichas de produção não usam alpha em borda.
 */

const SEVERIDADE_META: Record<Severidade, {
  rotulo: string; classe: string; Icone: typeof AlertTriangle;
}> = {
  critico:     { rotulo: 'Crítico',      classe: 'bg-red-500/10 text-red-600 border-red-500/30',       Icone: XCircle },
  atencao:     { rotulo: 'Atenção',      classe: 'bg-amber-500/10 text-amber-600 border-amber-500/30', Icone: AlertTriangle },
  informativo: { rotulo: 'Informativo',  classe: 'bg-blue-500/10 text-blue-600 border-blue-500/30',    Icone: Info },
};

const SEGMENTO_ROTULO: Record<Segmento, string> = {
  erro_debito:   'Erro no débito',
  falha_op:      'OP não criada',
  baixa_parcial: 'Baixa parcial',
  data_inviavel: 'Data inviável',
};

type Filtro = 'critico' | 'todos';

export default function PendenciasView() {
  const { data: grupos = [], isLoading } = useSaleOrderPendencias();
  const { data: cadastro = [] } = useCadastroPendencias();
  const retry = useRetryItemPromotion();
  // Requisito 16: abre mostrando só o crítico; o resto fica atrás de filtro, com
  // o contador sempre visível — nada escondido, só não é o padrão.
  const [filtro, setFiltro] = useState<Filtro>('critico');
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const totalCriticos = useMemo(() => grupos.reduce((s, g) => s + g.criticos, 0), [grupos]);
  const totalAtencao = useMemo(() => grupos.reduce((s, g) => s + g.atencoes, 0), [grupos]);
  const totalCadastro = useMemo(
    () => cadastro.reduce((s, c) => s + (c.item_count || 0), 0), [cadastro],
  );

  const visiveis = useMemo(
    () => (filtro === 'critico' ? grupos.filter(g => g.criticos > 0) : grupos),
    [grupos, filtro],
  );

  const alternar = (id: string) => {
    setAbertos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando pendências…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Barra de filtro — h-9, padrão de toolbar de página */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={filtro === 'critico' ? 'default' : 'outline'}
          className="h-9 gap-2"
          onClick={() => setFiltro('critico')}
        >
          <XCircle className="h-4 w-4" />
          Crítico
          <span className="font-mono tabular-nums">{totalCriticos}</span>
        </Button>
        <Button
          size="sm"
          variant={filtro === 'todos' ? 'default' : 'outline'}
          className="h-9 gap-2"
          onClick={() => setFiltro('todos')}
        >
          <AlertTriangle className="h-4 w-4" />
          Tudo
          <span className="font-mono tabular-nums">{totalCriticos + totalAtencao}</span>
        </Button>
        {totalCadastro > 0 && (
          <Badge variant="outline" className="h-9 gap-2 px-3 bg-blue-500/10 text-blue-600 border-blue-500/30">
            <Info className="h-4 w-4" />
            Cadastro
            <span className="font-mono tabular-nums">{totalCadastro}</span>
          </Badge>
        )}
      </div>

      {visiveis.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title={filtro === 'critico' ? 'Nenhuma pendência crítica' : 'Nenhuma pendência'}
          description={
            filtro === 'critico' && totalAtencao > 0
              ? `Nenhum item ficou sem OP. Há ${totalAtencao} pendência(s) de atenção — use o filtro "Tudo".`
              : 'Todos os pedidos entraram em produção com o material baixado.'
          }
        />
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          {visiveis.map((g) => (
            <GrupoPv
              key={g.sale_order_id}
              grupo={g}
              aberto={abertos.has(g.sale_order_id)}
              onAlternar={() => alternar(g.sale_order_id)}
              onRetentar={(itemId) => retry.mutate(itemId)}
              retentandoId={retry.isPending ? (retry.variables as string) : null}
            />
          ))}
        </div>
      )}

      {/* Cadastro é relatório GLOBAL (consumption_consistency_report não é por PV) —
          rotulado como tal em vez de fingir um vínculo que a função não tem. */}
      {cadastro.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Cadastro incompleto <span className="font-normal text-muted-foreground">— afeta todos os pedidos</span>
          </h3>
          <div className="rounded-md border border-border divide-y divide-border">
            {cadastro.map((c) => (
              <div key={c.check_name} className="flex items-start gap-3 p-3 bg-card">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">{c.check_name}</span>
                    <span className="font-mono tabular-nums text-xs text-muted-foreground">
                      {c.item_count} item(ns)
                    </span>
                  </div>
                  {c.sample && (
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{c.sample}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GrupoPv({ grupo, aberto, onAlternar, onRetentar, retentandoId }: {
  grupo: PendenciasPorPv;
  aberto: boolean;
  onAlternar: () => void;
  onRetentar: (itemId: string) => void;
  retentandoId: string | null;
}) {
  const meta = SEVERIDADE_META[grupo.severidade];
  const Icone = meta.Icone;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        className="w-full flex items-center gap-3 p-3 bg-card hover:bg-muted/40 text-left transition-colors"
      >
        {aberto ? <CaretDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                : <CaretRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <Badge variant="outline" className={`${meta.classe} gap-1.5 shrink-0`}>
          <Icone className="h-3.5 w-3.5" />
          {meta.rotulo}
        </Badge>
        <span className="font-mono font-semibold text-sm text-foreground">{grupo.order_number}</span>
        <span className="text-xs text-muted-foreground truncate">{grupo.pv_status}</span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground shrink-0">
          {grupo.criticos > 0 && (
            <span className="font-mono tabular-nums text-red-600">{grupo.criticos} crítico(s)</span>
          )}
          {grupo.atencoes > 0 && (
            <span className="font-mono tabular-nums text-amber-600">{grupo.atencoes} atenção</span>
          )}
        </span>
      </button>

      {aberto && (
        <div className="divide-y divide-border/60 bg-muted/20">
          {grupo.linhas.map((l, i) => {
            const m = SEVERIDADE_META[l.severidade];
            const LinhaIcone = m.Icone;
            const retentando = retentandoId === l.item_id;
            return (
              <div key={`${l.item_id ?? l.segmento}-${i}`} className="flex items-start gap-3 p-3 pl-10">
                <LinhaIcone className={`h-4 w-4 mt-0.5 shrink-0 ${
                  l.severidade === 'critico' ? 'text-red-600'
                    : l.severidade === 'atencao' ? 'text-amber-600' : 'text-blue-600'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
                      {SEGMENTO_ROTULO[l.segmento]}
                    </span>
                    {l.op_numero && (
                      <span className="text-xs font-mono text-muted-foreground">{l.op_numero}</span>
                    )}
                    {l.retry_count > 0 && (
                      <span className="text-xs font-mono text-muted-foreground">
                        · {l.retry_count} tentativa(s)
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground break-words">{l.titulo}</p>
                  {l.detalhe && (
                    <p className="text-xs text-muted-foreground break-words mt-0.5">{l.detalhe}</p>
                  )}
                </div>
                {l.pode_retentar && l.item_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 shrink-0"
                    disabled={!!retentandoId}
                    onClick={() => onRetentar(l.item_id!)}
                  >
                    {retentando
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RotateCcw className="h-3.5 w-3.5" />}
                    Tentar de novo
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
