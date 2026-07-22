import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CircleNotch as Loader2, Warning as AlertTriangle, Factory, Handshake, CheckCircle } from '@phosphor-icons/react';
import { useContractors } from '@/hooks/useContractors';
import { useCapacityOverflow, useCommitOutsourcing, type CapacityOverflowRow, type OutsourcingAssignment } from '@/hooks/useCapacityOverflow';

// Label legível dos setores do enum interno
const SECTOR_LABEL: Record<string, string> = {
  costura: 'Costura',
  mesa: 'Mesa (Aviamento)',
  corte_palmilha: 'Corte Palmilha',
  corte_forracao: 'Corte Forração / Cabedal',
  // F1-02: v_sector_weekly_load agora cobre os 9 setores do fluxo
  silk: 'Silk',
  colagem: 'Colagem',
  montagem: 'Montagem',
  solagem: 'Solagem',
  acabamento: 'Acabamento',
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** OPs criadas pela nova onda — base pro overflow detection. */
  orderIds: string[];
  /** Disparado após operador confirmar transbordo (ou pular). */
  onComplete?: () => void;
}

/**
 * Dialog auto-aberto após criar onda quando há OPs em setor estourado
 * (utilization > 100%). Operador escolhe qual terceiro recebe cada OP
 * (ou "Manter interno" pra ficar na produção própria).
 *
 * Quando confirmado, dispara commit_capacity_overflow_outsourcing RPC
 * que: (1) marca orders.outsourced_to_contractor_id, (2) cria 1
 * service_order por OP terceirizada, (3) retorna ids criadas.
 *
 * "Pular" fecha sem terceirizar nada — operador aceita produzir tudo
 * interno mesmo estourado (vai atrasar).
 */
export function CapacityOverflowDialog({ open, onClose, orderIds, onComplete }: Props) {
  const { data: overflow = [], isLoading } = useCapacityOverflow(orderIds);
  const { data: contractors = [] } = useContractors();
  const commit = useCommitOutsourcing();

  // Map de seleção: key = `${order_id}::${sector}` → contractor_id (null = interno)
  const [assignments, setAssignments] = useState<Map<string, string | null>>(new Map());

  // Reset ao abrir/fechar
  useEffect(() => {
    if (!open) setAssignments(new Map());
  }, [open]);

  // Agrupa por setor pra UI mais legível
  const groupedBySector = useMemo(() => {
    const map = new Map<string, CapacityOverflowRow[]>();
    for (const row of overflow) {
      const arr = map.get(row.sector) || [];
      arr.push(row);
      map.set(row.sector, arr);
    }
    return Array.from(map.entries());
  }, [overflow]);

  const setAssignment = (orderId: string, sector: string, contractorId: string | null) => {
    setAssignments(prev => {
      const next = new Map(prev);
      next.set(`${orderId}::${sector}`, contractorId);
      return next;
    });
  };

  const getAssignment = (orderId: string, sector: string): string | null => {
    return assignments.get(`${orderId}::${sector}`) ?? null;
  };

  const activeContractors = useMemo(() => contractors.filter((c: any) => c.active), [contractors]);

  // Count de OPs efetivamente selecionadas pra transbordo (não-internas)
  const outsourcedCount = useMemo(() => {
    let c = 0;
    for (const v of assignments.values()) if (v) c++;
    return c;
  }, [assignments]);

  const handleConfirm = async () => {
    const payload: OutsourcingAssignment[] = [];
    for (const [key, contractorId] of assignments.entries()) {
      if (!contractorId) continue;
      const [order_id, sector] = key.split('::');
      payload.push({ order_id, sector, contractor_id: contractorId });
    }
    if (payload.length === 0) {
      // Sem nada selecionado — apenas fecha (igual a pular)
      onClose();
      onComplete?.();
      return;
    }
    await commit.mutateAsync(payload);
    onClose();
    onComplete?.();
  };

  const handleSkip = () => {
    onClose();
    onComplete?.();
  };

  // Auto-fecha quando não há overflow (defensive — WaveBuilder não deveria abrir nesse caso)
  useEffect(() => {
    if (open && !isLoading && overflow.length === 0) {
      onComplete?.();
      onClose();
    }
  }, [open, isLoading, overflow.length, onClose, onComplete]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleSkip(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Capacidade extrapolada — transbordo para terceiros
          </DialogTitle>
          <DialogDescription className="text-xs mt-1">
            {overflow.length} {overflow.length === 1 ? 'OP em setor' : 'OPs em setores'} com utilização superior a 100% nesta onda.
            Selecione um terceiro pra cada OP que você quer transferir, ou deixe "Manter interno" pra produzir aqui mesmo (vai atrasar).
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : overflow.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">
            Sem OPs em transbordo — capacidade interna comporta a onda.
          </p>
        ) : (
          <div className="space-y-4">
            {groupedBySector.map(([sector, rows]) => {
              const first = rows[0];
              return (
                <div key={sector} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Factory className="h-4 w-4 text-amber-700" />
                      <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                        {SECTOR_LABEL[sector] || sector}
                      </span>
                      <Badge variant="outline" className="text-xs bg-amber-500/10 border-amber-500/30 text-amber-700">
                        Semana {first.week_start}
                      </Badge>
                    </div>
                    <div className="text-xs text-amber-700 tabular-nums">
                      <span className="font-semibold">{first.utilization_pct}%</span>
                      {' '}({first.total_pairs_planned} planejados / {first.total_capacity_week} capacidade)
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {rows.map(r => {
                      const assigned = getAssignment(r.order_id, r.sector);
                      return (
                        <div
                          key={`${r.order_id}::${r.sector}`}
                          className="flex items-center gap-3 bg-card rounded-md border border-border/40 px-3 py-2 text-xs"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-semibold">{r.order_number}</span>
                              <span className="text-muted-foreground truncate">{r.sheet_name} · {r.color || '—'}</span>
                              <Badge variant="secondary" className="text-xs tabular-nums">{r.quantity} pares</Badge>
                            </div>
                          </div>
                          <div className="shrink-0 w-56">
                            <Select
                              value={assigned ?? '__internal'}
                              onValueChange={(v) => setAssignment(r.order_id, r.sector, v === '__internal' ? null : v)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Manter interno" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__internal">
                                  <span className="flex items-center gap-1.5">
                                    <Factory className="h-3 w-3" /> Manter interno
                                  </span>
                                </SelectItem>
                                {activeContractors.map((c: any) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    <span className="flex items-center gap-1.5">
                                      <Handshake className="h-3 w-3 text-primary" />
                                      {c.name}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {outsourcedCount > 0
              ? `${outsourcedCount} ${outsourcedCount === 1 ? 'OP será terceirizada' : 'OPs serão terceirizadas'}`
              : 'Nenhuma OP selecionada — produção continua interna'}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={handleSkip} disabled={commit.isPending}>
              Pular (manter tudo interno)
            </Button>
            <Button onClick={handleConfirm} disabled={commit.isPending || isLoading}>
              {commit.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              {outsourcedCount > 0 ? `Confirmar transbordo (${outsourcedCount})` : 'Continuar sem transbordo'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
