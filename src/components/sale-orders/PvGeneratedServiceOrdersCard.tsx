import { Link } from 'react-router-dom';
import {
  Handshake, ArrowSquareOut as ExternalLink, PaperPlaneTilt, XCircle, ArrowsClockwise, Warning,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, cn } from '@/lib/utils';
import {
  usePvTerceirizacaoLines,
  localTerceirizacaoStatus,
  useSendTerceirizacaoOs,
  useSendAllTerceirizacaoOs,
  useCancelTerceirizacaoOs,
  useUpdateTerceirizacaoOsQty,
  type PvTerceirizacaoLine,
} from '@/hooks/useReferenceTerceirizacoes';

/**
 * Card "Terceirizações" do detalhe do PV. Lista as terceirizações MARCADAS nos
 * itens (intenção) com status local e ações de envio. A OS só é criada quando o
 * usuário clica "Enviar para terceirizados" (por linha) ou "Enviar todas".
 */
const STATUS_META: Record<string, { label: string; cls: string }> = {
  pendente_envio: { label: 'Pendente envio', cls: 'bg-amber-500/10 text-amber-700 border-amber-500/40 dark:text-amber-400' },
  enviada:        { label: 'Enviada',        cls: 'bg-green-500/10 text-green-700 border-green-500/40 dark:text-green-400' },
  cancelada:      { label: 'Cancelada',      cls: 'bg-muted text-muted-foreground border-border' },
};

export function PvGeneratedServiceOrdersCard({ saleOrderId }: { saleOrderId: string }) {
  const { data: lines = [], isLoading } = usePvTerceirizacaoLines(saleOrderId);
  const sendOne = useSendTerceirizacaoOs();
  const sendAll = useSendAllTerceirizacaoOs();
  const cancelOs = useCancelTerceirizacaoOs();
  const updateQty = useUpdateTerceirizacaoOsQty();

  if (isLoading || lines.length === 0) return null;

  const busy = sendOne.isPending || sendAll.isPending || cancelOs.isPending || updateQty.isPending;
  const pendingCount = lines.filter((l) => localTerceirizacaoStatus(l) === 'pendente_envio').length;
  const totalEnviado = lines
    .filter((l) => localTerceirizacaoStatus(l) === 'enviada')
    .reduce((s, l) => s + (Number(l.os_total) || 0), 0);

  const lineKey = (l: PvTerceirizacaoLine) => `${l.reference_id}::${l.color}::${l.terceirizacao_id}`;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <Handshake className="h-4 w-4 text-primary" />
          Terceirizações
          <Badge variant="outline" className="h-5 text-[10px] font-mono">{lines.length}</Badge>
        </h3>
        <div className="flex items-center gap-2">
          <Link to="/terceirizados?tab=orders" className="text-xs text-primary hover:underline flex items-center gap-1">
            Ver OS <ExternalLink className="h-3 w-3" />
          </Link>
          <Button
            size="sm" className="h-8 gap-1.5"
            disabled={busy || pendingCount === 0}
            onClick={() => sendAll.mutate(saleOrderId)}
          >
            <PaperPlaneTilt className="h-3.5 w-3.5" />
            Enviar todas{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        A marcação no item é intenção — a Ordem de Serviço só é criada quando você
        envia a linha pro prestador.
      </p>

      <div className="rounded-lg border border-border/60 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left text-[11px] uppercase tracking-wide">
              <th className="px-3 py-2 font-semibold">Prestador / Serviço</th>
              <th className="px-3 py-2 font-semibold">Ref · Cor</th>
              <th className="px-3 py-2 font-semibold text-right">Pares</th>
              <th className="px-3 py-2 font-semibold text-right">Valor/par</th>
              <th className="px-3 py-2 font-semibold text-right">Total</th>
              <th className="px-3 py-2 font-semibold text-center">Status</th>
              <th className="px-3 py-2 font-semibold text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l) => {
              const status = localTerceirizacaoStatus(l);
              const meta = STATUS_META[status];
              const total = (Number(l.value_per_pair) || 0) * (Number(l.qty) || 0);
              const diverges = status === 'enviada'
                && Number(l.os_quantity) !== Number(l.qty);
              return (
                <tr key={lineKey(l)} className={cn('align-top', status === 'cancelada' && 'opacity-60')}>
                  <td className="px-3 py-2">
                    <div className="text-xs">
                      <span className="font-medium text-foreground">{l.contractor_name || '—'}</span>
                      <span className="text-muted-foreground"> · {l.description}</span>
                    </div>
                    {!l.terceirizacao_active && (
                      <span className="text-[10px] text-amber-700 dark:text-amber-400">terceirização inativa na ficha</span>
                    )}
                    {l.os_number && (
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">OS {l.os_number}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <span className="font-mono">{l.ref_code || '—'}</span>
                    {l.color && <span className="text-muted-foreground"> · {l.color}</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                    {(Number(l.qty) || 0).toLocaleString('pt-BR')}
                    {diverges && (
                      <span className="block text-[10px] text-amber-700 dark:text-amber-400">
                        OS: {(Number(l.os_quantity) || 0).toLocaleString('pt-BR')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{formatCurrency(l.value_per_pair)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{formatCurrency(total)}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant="outline" className={cn('text-[10px]', meta.cls)}>{meta.label}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-end gap-1">
                      {status === 'pendente_envio' && (
                        <Button
                          size="sm" variant="default" className="h-7 text-xs gap-1"
                          disabled={busy}
                          onClick={() => sendOne.mutate({ saleOrderId, referenceId: l.reference_id, color: l.color, terceirizacaoId: l.terceirizacao_id })}
                        >
                          <PaperPlaneTilt className="h-3 w-3" /> Enviar
                        </Button>
                      )}
                      {status === 'enviada' && (
                        <>
                          {diverges && (
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400"
                              disabled={busy}
                              onClick={() => l.os_id && updateQty.mutate(l.os_id)}
                            >
                              <ArrowsClockwise className="h-3 w-3" /> Atualizar OS
                            </Button>
                          )}
                          <Button
                            size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
                            disabled={busy}
                            onClick={() => l.os_id && cancelOs.mutate(l.os_id)}
                          >
                            <XCircle className="h-3 w-3" /> Cancelar OS
                          </Button>
                        </>
                      )}
                      {status === 'cancelada' && (
                        <Button
                          size="sm" variant="outline" className="h-7 text-xs gap-1"
                          disabled={busy}
                          onClick={() => sendOne.mutate({ saleOrderId, referenceId: l.reference_id, color: l.color, terceirizacaoId: l.terceirizacao_id })}
                        >
                          <PaperPlaneTilt className="h-3 w-3" /> Reenviar
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {pendingCount > 0 && (
            <><Warning className="h-3 w-3 text-amber-600" /> {pendingCount} pendente(s) de envio</>
          )}
        </span>
        <span>
          Total enviado (ativo):{' '}
          <strong className="ml-1 text-foreground font-mono tabular-nums">{formatCurrency(totalEnviado)}</strong>
        </span>
      </div>
    </div>
  );
}
