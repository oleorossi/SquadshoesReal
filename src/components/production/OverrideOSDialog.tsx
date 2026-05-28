import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Warning as AlertTriangle, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useOverrideOSForMontagem } from '@/hooks/useOutsourcedInField';

interface PendingServiceOrder {
  id: string;
  order_number: string;
  contractor_name: string;
  service_date: string | null;
  quoted_deadline: string | null;
  status: string;
  description: string | null;
  days_late: number | null;
}

interface OverrideOSDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  orderNumber?: string;
  onAllOverridden?: () => void;
}

/**
 * Dialog mostrado quando o usuário tenta avançar uma OP pra Montagem mas
 * o trigger tg_block_montagem_with_pending_service_order rejeitou. Lista
 * as OSs terceirizadas que ainda travam o avanço, com input de justificativa
 * pra cada uma. Ao confirmar override de todas, fecha e dá callback pra
 * o caller reexecutar o avanço da OP.
 */
export function OverrideOSDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  onAllOverridden,
}: OverrideOSDialogProps) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  // silent: evita inundação de toasts em batch (N OSs = N toasts antes).
  // Caller agrega via Promise.allSettled e mostra UM resumo abaixo.
  const overrideMutation = useOverrideOSForMontagem({ silent: true });

  const { data: pendingOSs = [], isLoading } = useQuery({
    queryKey: ['pending-os-for-order', orderId],
    enabled: !!orderId && open,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await (supabase as any)
        .from('service_orders')
        .select('id, order_number, service_date, quoted_deadline, status, description, contractors(name)')
        .eq('order_id', orderId!)
        .not('status', 'in', '("received","Concluído","concluido","Cancelado","cancelled","cancelado")')
        .is('montagem_override_at', null);
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        id: r.id,
        order_number: r.order_number,
        contractor_name: r.contractors?.name || 'Sem contratada',
        service_date: r.service_date,
        quoted_deadline: r.quoted_deadline,
        status: r.status,
        description: r.description,
        days_late: r.quoted_deadline
          ? Math.max(0, Math.floor((new Date(today).getTime() - new Date(r.quoted_deadline).getTime()) / 86_400_000))
          : null,
      })) as PendingServiceOrder[];
    },
    staleTime: 0,
  });

  const allValid = useMemo(
    () => pendingOSs.length > 0 && pendingOSs.every((os) => (reasons[os.id] || '').trim().length >= 5),
    [pendingOSs, reasons],
  );

  const handleConfirm = async () => {
    // Promise.allSettled: se uma OS falhar, as outras seguem. Mutation está
    // em silent mode — invalidação de cache acontece uma vez aqui no final.
    const results = await Promise.allSettled(
      pendingOSs.map((os) =>
        overrideMutation.mutateAsync({ serviceOrderId: os.id, reason: reasons[os.id] }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    const succeeded = results.length - failed.length;

    // Invalidação única (em vez de N por mutation) — antes a UI fazia N
    // refetches em paralelo. Inclui 'pending-os-for-order' pra que reabrir
    // o dialog mostre estado fresco (sem flicker de OSs já overridden).
    if (succeeded > 0) {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['production_waves'] });
      qc.invalidateQueries({ queryKey: ['pending-os-for-order'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['v_sector_bottlenecks'] });
    }

    if (failed.length === 0) {
      toast.success(`${succeeded} OS(s) liberadas — Montagem desbloqueada.`);
      setReasons({});
      onOpenChange(false);
      onAllOverridden?.();
    } else {
      toast.error(
        `${failed.length} de ${pendingOSs.length} OS(s) falharam ao ser liberadas. ` +
        (succeeded > 0 ? `${succeeded} foram marcadas. ` : '') +
        `Recarregue e tente novamente.`,
        { duration: 8000 },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Liberar Montagem com OSs Pendentes
          </DialogTitle>
          <DialogDescription>
            {orderNumber ? `OP ${orderNumber}` : 'Esta OP'} tem OSs terceirizadas em andamento.
            Liberar a Montagem sem o material recebido exige uma justificativa por OS
            (mín. 5 caracteres). A ação é registrada no audit log.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : pendingOSs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Nenhuma OS pendente encontrada — recarregue a página e tente avançar de novo.
          </p>
        ) : (
          <div className="space-y-3">
            {pendingOSs.map((os) => (
              <div key={os.id} className="rounded-md border border-border/60 p-3 bg-muted/20">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{os.order_number}</span>
                      <Badge variant="outline" className="text-xs">{os.status}</Badge>
                      {os.days_late !== null && os.days_late > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {os.days_late}d atrasada
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {os.contractor_name}
                      {os.quoted_deadline && ` · prazo ${new Date(os.quoted_deadline + 'T12:00:00').toLocaleDateString('pt-BR')}`}
                    </p>
                    {os.description && (
                      <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">{os.description}</p>
                    )}
                  </div>
                </div>
                <Textarea
                  placeholder="Justifique (ex: contratada perdeu o material, vamos refazer interno)..."
                  value={reasons[os.id] || ''}
                  onChange={(e) => setReasons((prev) => ({ ...prev, [os.id]: e.target.value }))}
                  rows={2}
                  className="text-sm resize-none"
                />
                {(reasons[os.id] || '').trim().length > 0 && (reasons[os.id] || '').trim().length < 5 && (
                  <p className="text-[10px] text-destructive mt-1">Mín. 5 caracteres.</p>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={overrideMutation.isPending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!allValid || overrideMutation.isPending || pendingOSs.length === 0}
          >
            {overrideMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Liberar {pendingOSs.length} OS{pendingOSs.length === 1 ? '' : 's'} e prosseguir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
