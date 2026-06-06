import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Warning as AlertTriangle, Truck, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';

/**
 * Dialog mostrado APÓS o salvamento de um PV com override administrativo
 * (data anterior à mínima viável). O admin escolhe pra qual contractor a
 * Costura das OPs criadas será terceirizada — a RPC commit_capacity_overflow_outsourcing
 * marca cada OP como outsourced + cria a service_order correspondente.
 *
 * Skip / Cancelar: PV fica salvo, OPs criadas, costura roda interna. Admin
 * resolve manualmente depois no Kanban se mudar de ideia.
 */
interface Props {
  open: boolean;
  saleOrderId: string | null;
  onClose: () => void;
}

interface Contractor {
  id: string;
  name: string;
  service_type: string | null;
  default_lead_days: number | null;
}

export function OverrideOutsourceCosturaDialog({ open, saleOrderId, onClose }: Props) {
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [ops, setOps] = useState<Array<{ id: string; order_number: string }>>([]);
  const [contractorId, setContractorId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    if (!open || !saleOrderId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: c }, { data: o }] = await Promise.all([
          // Filtro preferencial: contractors com service_type ligado a costura/pesponto.
          // Mantém todos os ativos como fallback se o filtro vazio.
          supabase.from('contractors')
            .select('id, name, service_type, default_lead_days')
            .eq('active', true)
            .order('name'),
          supabase.from('orders')
            .select('id, order_number')
            .eq('sale_order_id', saleOrderId),
        ]);
        if (cancelled) return;
        const all = (c || []) as Contractor[];
        const costuraFirst = all.filter(x =>
          /costura|pesponto/i.test(x.service_type || '')
        );
        const others = all.filter(x => !/costura|pesponto/i.test(x.service_type || ''));
        setContractors([...costuraFirst, ...others]);
        // Auto-seleciona o primeiro de costura/pesponto se houver
        if (costuraFirst.length > 0) setContractorId(costuraFirst[0].id);
        setOps((o || []) as Array<{ id: string; order_number: string }>);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, saleOrderId]);

  const handleConfirm = async () => {
    if (!contractorId) {
      toast.error('Selecione o contractor que vai receber a costura.');
      return;
    }
    if (ops.length === 0) {
      toast.warning('Nenhuma OP encontrada pra terceirizar.');
      onClose();
      return;
    }
    setCommitting(true);
    try {
      const assignments = ops.map(op => ({
        order_id: op.id,
        sector: 'Costura',
        contractor_id: contractorId,
      }));
      const { data, error } = await (supabase as any).rpc(
        'commit_capacity_overflow_outsourcing',
        { p_assignments: assignments },
      );
      if (error) throw error;
      const processed = Number(data?.processed_count || 0);
      toast.success(
        processed > 0
          ? `${processed} OP${processed === 1 ? '' : 's'} de costura terceirizada${processed === 1 ? '' : 's'}.`
          : 'Nenhuma OP processada.'
      );
      onClose();
    } catch (e: any) {
      toast.error(`Erro ao terceirizar: ${e.message}`);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Terceirizar Costura (override admin)
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-1">
            <span className="block">
              Esse PV foi salvo com data <strong>anterior à mínima viável</strong>. Pra liberar
              capacidade da fábrica, a Costura das {ops.length} OP{ops.length === 1 ? '' : 's'} pode
              sair pra um contractor externo.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Contractor de Costura
            </Label>
            <Select value={contractorId} onValueChange={setContractorId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder={loading ? 'Carregando...' : 'Selecionar contractor'} />
              </SelectTrigger>
              <SelectContent>
                {contractors.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Nenhum contractor ativo cadastrado.
                  </div>
                )}
                {contractors.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.service_type ? ` · ${c.service_type}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Recomendado: contractor com service_type de Costura/Pesponto.
              Cadastre mais em /contractors se a lista estiver vazia.
            </p>
          </div>

          {ops.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
              <div className="font-mono font-bold text-muted-foreground mb-1.5 uppercase tracking-wide">
                OPs afetadas ({ops.length})
              </div>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {ops.slice(0, 10).map(op => (
                  <li key={op.id} className="font-mono">{op.order_number}</li>
                ))}
                {ops.length > 10 && (
                  <li className="text-muted-foreground italic">... e mais {ops.length - 10} OPs</li>
                )}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={committing}>
            Pular (resolvo depois)
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={committing || !contractorId || ops.length === 0}
            className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
          >
            {committing ? <Truck className="h-4 w-4 animate-pulse" /> : <CheckCircle2 className="h-4 w-4" />}
            Terceirizar costura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
