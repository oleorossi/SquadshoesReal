import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PaperPlaneTilt, Handshake, Warning, CheckCircle } from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useContractors } from '@/hooks/useContractors';
import { SERVICE_ORDER_SECTORS, serviceOrderSectorLabel } from '@/lib/serviceOrderSectors';

/**
 * "Enviar pra prestador" — manda um SETOR de OPs já existentes pra fora, depois
 * do pedido ter entrado em produção.
 *
 * É a saída pro caso que o fluxo normal não cobre: o setor não foi marcado no
 * item antes da OP nascer, ou a OS falhou na criação automática (o trigger
 * `tg_orders_generate_outsourcing_os` engole o erro de propósito — falhar a OS
 * nunca pode travar a OP).
 *
 * Idempotente pelo servidor: `send_item_sector_os` reusa o índice
 * `uq_os_per_op_sector`, então reenviar não duplica — devolve `exists`.
 */

interface OpSectorRow {
  order_id: string;
  op_number: string | null;
  ref_code: string | null;
  color: string | null;
  quantity: number | null;
  sector: string;
  os_id: string | null;
  os_number: string | null;
  os_status: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
}

export interface SendSectorToContractorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleOrderId: string;
  saleOrderLabel?: string | null;
}

export function SendSectorToContractorDialog({
  open, onOpenChange, saleOrderId, saleOrderLabel,
}: SendSectorToContractorDialogProps) {
  const qc = useQueryClient();
  const { data: contractors = [] } = useContractors();
  const activeContractors = useMemo(
    () => (contractors as any[]).filter((c) => c.active),
    [contractors],
  );

  const [sector, setSector] = useState<string>('');
  const [contractorId, setContractorId] = useState<string>('');
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set());

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['pv_op_sector_os_status', saleOrderId],
    enabled: open && !!saleOrderId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc('get_pv_op_sector_os_status', { p_sale_order_id: saleOrderId });
      if (error) throw error;
      return (data || []) as OpSectorRow[];
    },
    staleTime: 15_000,
  });

  // OPs distintas do pedido (a RPC devolve OP × setor).
  const ops = useMemo(() => {
    const byId = new Map<string, { order_id: string; op_number: string | null; ref_code: string | null; color: string | null; quantity: number | null }>();
    for (const r of rows) {
      if (!byId.has(r.order_id)) {
        byId.set(r.order_id, {
          order_id: r.order_id, op_number: r.op_number,
          ref_code: r.ref_code, color: r.color, quantity: r.quantity,
        });
      }
    }
    return [...byId.values()];
  }, [rows]);

  // OS já existentes, por OP.
  const osByOp = useMemo(() => {
    const m = new Map<string, OpSectorRow[]>();
    for (const r of rows) {
      if (!r.os_id) continue;
      m.set(r.order_id, [...(m.get(r.order_id) || []), r]);
    }
    return m;
  }, [rows]);

  // Quais OPs já têm OS no setor escolhido — essas não precisam de envio.
  const alreadyInSector = useMemo(() => {
    const s = new Set<string>();
    if (!sector) return s;
    for (const r of rows) if (r.sector === sector && r.os_id) s.add(r.order_id);
    return s;
  }, [rows, sector]);

  useEffect(() => {
    if (!open) return;
    setSector('');
    setContractorId('');
    setSelectedOps(new Set());
  }, [open]);

  // Ao trocar de setor, pré-marca as OPs que ainda não têm OS nele.
  useEffect(() => {
    if (!sector) { setSelectedOps(new Set()); return; }
    setSelectedOps(new Set(ops.filter((o) => !alreadyInSector.has(o.order_id)).map((o) => o.order_id)));
  }, [sector, ops, alreadyInSector]);

  const send = useMutation({
    mutationFn: async () => {
      const targets = [...selectedOps];
      const results: { action: string }[] = [];
      // Serial de propósito: cada chamada escreve service_orders e mexe na OP.
      for (const orderId of targets) {
        const { data, error } = await (supabase as any).rpc('send_item_sector_os', {
          p_order_id: orderId, p_sector: sector, p_contractor_id: contractorId,
        });
        if (error) throw new Error(error.message);
        results.push(data as { action: string });
      }
      return results;
    },
    onSuccess: (results) => {
      const criadas = results.filter((r) => r?.action === 'created' || r?.action === 'reactivated').length;
      const jaExistiam = results.filter((r) => r?.action === 'exists').length;
      const puladas = results.filter((r) => r?.action === 'skipped').length;
      if (criadas > 0) toast.success(`${criadas} Ordem(ns) de Serviço criada(s) para ${serviceOrderSectorLabel(sector)}.`);
      if (jaExistiam > 0) toast.info(`${jaExistiam} OP(s) já tinham OS neste setor — nada duplicado.`);
      if (puladas > 0) toast.warning(`${puladas} OP(s) puladas.`);
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['pv_op_sector_os_status', saleOrderId] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao enviar pro prestador.'),
  });

  const toggleOp = (id: string) => {
    setSelectedOps((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const canSend = !!sector && !!contractorId && selectedOps.size > 0 && !send.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-5 w-5 text-primary" />
            Enviar pra prestador{saleOrderLabel ? ` · ${saleOrderLabel}` : ''}
          </DialogTitle>
          <DialogDescription>
            Manda um setor das OPs deste pedido pra fora agora. Reenviar não
            duplica — a OS é única por OP e setor.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Carregando OPs...</p>
        ) : ops.length === 0 ? (
          <EmptyState
            icon={Warning}
            title="Este pedido ainda não tem OP"
            description="A Ordem de Serviço nasce junto com a OP, quando o pedido entra em produção. Pra já deixar definido, marque os setores nos itens do pedido — eles viram OS automaticamente na liberação."
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Setor *</Label>
                <Select value={sector} onValueChange={setSector}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Escolher setor..." /></SelectTrigger>
                  <SelectContent>
                    {SERVICE_ORDER_SECTORS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Prestador *</Label>
                <Select value={contractorId} onValueChange={setContractorId}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Escolher prestador..." /></SelectTrigger>
                  <SelectContent>
                    {activeContractors.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        Nenhum prestador ativo. Cadastre em Terceirizados.
                      </div>
                    )}
                    {activeContractors.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.trade_name?.trim() || c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">
                Ordens de produção {sector ? `· ${selectedOps.size} marcada(s)` : ''}
              </div>
              {ops.map((op) => {
                const jaTem = alreadyInSector.has(op.order_id);
                const on = selectedOps.has(op.order_id);
                const existentes = osByOp.get(op.order_id) || [];
                return (
                  <div
                    key={op.order_id}
                    className={cn(
                      'rounded-md border px-3 py-2',
                      jaTem ? 'border-border bg-muted/30' : on ? 'border-primary/40 bg-primary/5' : 'border-border',
                    )}
                  >
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <button
                        type="button"
                        disabled={!sector || jaTem}
                        onClick={() => toggleOp(op.order_id)}
                        aria-pressed={on}
                        className={cn(
                          'h-4 w-4 rounded border grid place-items-center text-[10px] leading-none shrink-0',
                          'disabled:opacity-40 disabled:cursor-not-allowed',
                          on && !jaTem ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40',
                        )}
                        aria-label={`Marcar OP ${op.op_number || ''}`}
                      >
                        {on && !jaTem ? '✓' : ''}
                      </button>
                      <span className="font-mono text-xs font-medium">{op.op_number || '—'}</span>
                      <span className="text-xs text-muted-foreground">
                        {op.ref_code || '—'}{op.color ? ` · ${op.color}` : ''}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground ml-auto">
                        {Number(op.quantity || 0).toLocaleString('pt-BR')} pares
                      </span>
                    </div>

                    {jaTem && (
                      <div className="mt-1 text-[11px] text-green-700 dark:text-green-400 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Já tem OS em {serviceOrderSectorLabel(sector)}
                      </div>
                    )}

                    {existentes.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {existentes.map((e) => (
                          <Badge key={e.os_id} variant="outline" className="h-5 text-[10px] font-normal">
                            {serviceOrderSectorLabel(e.sector)}
                            {e.contractor_name ? ` · ${e.contractor_name}` : ''}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="h-9" onClick={() => onOpenChange(false)} disabled={send.isPending}>
            Fechar
          </Button>
          {ops.length > 0 && (
            <Button className="h-9 gap-1.5" disabled={!canSend} onClick={() => send.mutate()}>
              <PaperPlaneTilt className="h-4 w-4" />
              {send.isPending ? 'Enviando...' : `Enviar ${selectedOps.size > 0 ? `(${selectedOps.size})` : ''}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
