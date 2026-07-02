 import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
 import { Badge } from '@/components/ui/badge';
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Package, Stack as Layers, ShoppingBag, ArrowSquareOut as ExternalLink, CalendarBlank as CalendarDays, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { useWaveDetail, useWaveSaleOrders, useSyncWaveFromKanban } from '@/hooks/useProductionWaves';
import { STAGE_LABEL, STAGE_ORDER } from '@/types/production-waves';
import { FinishingSplitTable } from './FinishingSplitTable';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null;
  try { return format(new Date(iso + 'T00:00:00'), 'dd/MM/yy', { locale: ptBR }); } catch { return null; }
}

export function WaveDetailPanel({
  waveId, open, onOpenChange,
}: {
  waveId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: wave, isLoading } = useWaveDetail(waveId);
  const { data: saleOrders = [] } = useWaveSaleOrders(waveId);
  const syncMutation = useSyncWaveFromKanban();
  const navigate = useNavigate();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            {wave ? `Onda ${wave.code}` : 'Detalhe da onda'}
            {wave && wave.wave_status === 'running' && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 px-2 text-xs gap-1"
                disabled={syncMutation.isPending}
                onClick={() => syncMutation.mutate(wave.wave_id)}
                title="Sincronizar estágio da onda com o progresso real do Kanban"
              >
                <RefreshCw className={cn('h-3 w-3', syncMutation.isPending && 'animate-spin')} />
                Sincronizar
              </Button>
            )}
          </SheetTitle>
        </SheetHeader>

        {isLoading && <Skeleton className="h-40 mt-4" />}

        {wave && (
          <div className="space-y-6 mt-4">
            {/* progresso de setores */}
            <div className="grid grid-cols-3 sm:grid-cols-9 gap-2">
              {STAGE_ORDER.map((stage) => {
                const s = wave.stages.find((x) => x.stage === stage);
                const statusClass =
                  s?.status === 'completed'   ? 'bg-success/10 border-success/30' :
                  s?.status === 'in_progress' ? 'bg-primary/10 border-primary/30' :
                  s?.status === 'blocked'     ? 'bg-destructive/10 border-destructive/30' :
                                                'bg-muted border-border';
                return (
                  <div key={stage} className={`p-2 rounded border text-center ${statusClass}`}>
                    <div className="text-xs font-bold uppercase">{STAGE_LABEL[stage]}</div>
                    <div className="text-xs mt-1">{s?.status ?? '—'}</div>
                    {s?.progress_pct !== undefined && (
                      <div className="text-xs mt-1">{s.progress_pct.toFixed(0)}%</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* itens agrupados */}
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                <Layers className="w-3 h-3" />
                Itens agrupados (solado → referência → cor)
              </h4>
               <div className="border rounded-lg">
                 <Table>
                   <TableHeader className="bg-muted/50 border-b text-xs uppercase text-muted-foreground">
                     <TableRow>
                       <TableHead className="px-3 py-2 h-auto text-left">Solado</TableHead>
                       <TableHead className="px-3 py-2 h-auto text-left">Referência</TableHead>
                       <TableHead className="px-3 py-2 h-auto text-center">Cor</TableHead>
                       <TableHead className="px-3 py-2 h-auto text-right">Pares</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {wave.items?.map((it) => (
                       <TableRow key={it.item_id}>
                         <TableCell className="px-3 py-2 font-medium">{it.sole_name ?? '—'}</TableCell>
                         <TableCell className="px-3 py-2">{it.reference_name}</TableCell>
                         <TableCell className="px-3 py-2 text-center">
                           <Badge variant="outline">{it.color || '—'}</Badge>
                         </TableCell>
                         <TableCell className="px-3 py-2 text-right tabular-nums">{it.total_quantity}</TableCell>
                       </TableRow>
                     ))}
                   </TableBody>
                 </Table>
               </div>
            </div>

            {/* pedidos de venda vinculados à onda */}
            {saleOrders.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                  <ShoppingBag className="w-3 h-3" />
                  Pedidos de venda ({saleOrders.length})
                </h4>
                <div className="border rounded-lg divide-y divide-border/50">
                  {saleOrders.map((so) => {
                    const today = new Date().toISOString().slice(0, 10);
                    const isLate = so.delivery_deadline && so.delivery_deadline < today;
                    return (
                      <div key={so.sale_order_id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-semibold">{so.order_number ?? so.sale_order_id.slice(0, 8)}</span>
                            {so.client_name && <span className="text-xs text-muted-foreground truncate">{so.client_name}</span>}
                            <Badge variant="outline" className="text-xs py-0 font-mono">{so.total_pairs} pares</Badge>
                            {so.status && (
                              <Badge variant="secondary" className="text-xs py-0">{so.status}</Badge>
                            )}
                          </div>
                          {so.delivery_deadline && (
                            <div className={cn('flex items-center gap-1 mt-0.5 text-xs', isLate ? 'text-destructive' : 'text-muted-foreground')}>
                              <CalendarDays className="h-2.5 w-2.5" />
                              Entrega {fmtDate(so.delivery_deadline)}
                              {isLate && ' ⚠'}
                            </div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 shrink-0"
                          aria-label="Abrir pedido de venda"
                          title="Abrir pedido de venda"
                          onClick={() => { navigate(`/sales/edit/${so.sale_order_id}`); onOpenChange(false); }}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* split por loja (apenas se estiver em acabamento ou finalizada) */}
            {(wave.current_stage === 'acabamento' || wave.current_stage === 'expedicao' || wave.wave_status === 'finished') && (
              <div>
                <h4 className="text-xs font-bold text-muted-foreground uppercase mb-2">
                  Acabamento — split por loja
                </h4>
                <FinishingSplitTable waveId={wave.wave_id} />
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
