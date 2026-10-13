/**
 * Alarme da fila de demanda de tiras (decisão do dono, 13/10/2026).
 *
 * Nasceu do incidente em que o worker ficou 2 dias parado — 82 jobs presos, 9
 * PVs vivos sem demanda — e o dono descobriu pela AUSÊNCIA das tiras numa Ordem
 * de Compra, não por um aviso. Mesmo padrão do `MaterialSectorGapsPanel`: lista
 * acionável, sem inventar nada.
 *
 * Dois alarmes separados porque são sintomas diferentes — ver `useStrapQueueHealth`.
 */
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Warning as AlertTriangle,
  CircleNotch as Loader2,
  ArrowsClockwise as RefreshCw,
  CheckCircle,
  Skull,
} from '@phosphor-icons/react';
import { useStrapQueueHealth, STRAP_QUEUE_ATRASO_MIN, type StrapQueueJob } from '@/hooks/useStrapQueueHealth';

interface Props {
  enabled?: boolean;
}

function JobRow({ job, tone }: { job: StrapQueueJob; tone: 'atraso' | 'morto' }) {
  const alvo = job.order_number || (job.source_type === 'sale_order' ? 'pedido removido' : 'catálogo/estoque');
  return (
    <li className="flex flex-col gap-1 rounded border border-border bg-card p-2 text-xs sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{alvo}</span>
          <Badge variant="outline" className="font-mono text-[10px]">{job.event_type || '—'}</Badge>
          <span className="font-mono text-muted-foreground">
            tentativa {job.attempts}/{job.max_attempts}
          </span>
        </div>
        {job.last_error && (
          <p className={`leading-snug ${tone === 'morto' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {job.last_error}
          </p>
        )}
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {job.id.slice(0, 8)}
      </span>
    </li>
  );
}

export default function StrapQueueHealthPanel({ enabled = true }: Props) {
  const q = useStrapQueueHealth(enabled);
  const atrasados = q.data?.atrasados ?? [];
  const mortos = q.data?.mortos ?? [];
  const saudavel = !q.isLoading && !q.isError && atrasados.length === 0 && mortos.length === 0;

  return (
    <Panel
      eyebrow="TIRAS · FILA DE DEMANDA"
      title="Saúde do motor automático de tiras"
      subtitle={`A Ordem de Compra por Pedido exclui tira de propósito e manda pro motor. Com a fila parada, a tira não fica em lugar nenhum — foi assim que o PV-00232 foi pra produção sem tira em 10/2026. Atraso = job elegível esperando há mais de ${STRAP_QUEUE_ATRASO_MIN} min.`}
      actions={
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => void q.refetch()}
          disabled={q.isLoading}
        >
          {q.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </Button>
      }
      bodyClassName="space-y-4"
    >
      {/* isError ANTES de empty: alarme que falhou não pode parecer "está tudo certo". */}
      {q.isError && (
        <p className="text-sm text-destructive">
          {(q.error as Error)?.message || 'Falha ao ler a fila de demanda de tiras.'}
        </p>
      )}

      {q.isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {saudavel && (
        <EmptyState
          icon={CheckCircle}
          title="Fila em dia"
          description="Nenhum job elegível atrasado e nenhum job morto nos últimos 7 dias."
        />
      )}

      {!q.isLoading && !q.isError && atrasados.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div>
              <strong>{atrasados.length} job(s) elegível(is) parado(s).</strong>{' '}
              O mais antigo espera há <strong>{q.data?.piorAtrasoMin} min</strong>. O worker
              não está consumindo a fila — os PVs abaixo estão sem demanda de tira atualizada.
            </div>
          </div>
          <ul className="space-y-1.5">
            {atrasados.slice(0, 40).map((j) => <JobRow key={j.id} job={j} tone="atraso" />)}
          </ul>
        </div>
      )}

      {!q.isLoading && !q.isError && mortos.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm text-amber-700 dark:text-amber-400">
            <Skull className="h-4 w-4 shrink-0" />
            <div>
              <strong>{mortos.length} job(s) morto(s) nos últimos 7 dias.</strong>{' '}
              Esgotaram as tentativas e <strong>não vão mais rodar sozinhos</strong>. O PV
              correspondente fica sem a tira até alguém reprocessar — este é o alarme
              silencioso, o que não aparece como fila parada.
            </div>
          </div>
          <ul className="space-y-1.5">
            {mortos.slice(0, 40).map((j) => <JobRow key={j.id} job={j} tone="morto" />)}
          </ul>
        </div>
      )}
    </Panel>
  );
}
