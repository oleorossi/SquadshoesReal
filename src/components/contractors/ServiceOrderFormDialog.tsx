import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Buildings, Flask as FlaskConical, Calendar, CurrencyDollar,
} from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useContractors } from '@/hooks/useContractors';
import { generateServiceOrderNumber } from '@/lib/serviceOrderStock';
import { SERVICE_ORDER_SECTORS } from '@/lib/serviceOrderSectors';
import { formatCurrency, cn } from '@/lib/utils';

/**
 * Dialog compartilhado pra CRIAR uma nova OS terceirizada.
 *
 * Fluxo:
 *  1. Coleta contractor + setor + descrição + qty × unit_price (= total auto)
 *  2. Submit: INSERT em service_orders
 *  3. Re-invalida caches relevantes
 *
 * Substitui o form bugado em Contractors.tsx (que gravava total_value=unit_price
 * sem multiplicar pela quantidade) e é reusável no hub /terceiros (aba Na Rua).
 *
 * ⚠ A OS **não debita estoque** (decisão do dono, 31/07/2026). O consumo de
 * material tem UM dono: o ledger da OP (reserva na liberação pra produção →
 * `commit_picking_for_sale_order`; faturamento como rede via
 * `convert_reservation_to_out`). O débito que existia aqui escrevia direto em
 * `products.quantity` com `order_id` NULL, sem linha em `material_reservations`
 * e sem enxergar o que a OP já tinha reservado — a mesma napa sairia duas vezes.
 * Nunca foi disparado em produção (0 movimentos em 4 meses) e foi removido antes
 * de virar furo de estoque. Não reintroduzir aqui.
 *
 * Edit mode pode ser implementado depois — MVP foca em CREATE.
 */

export interface ServiceOrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContractorId?: string;
  initialSector?: string;
  onCreated?: (serviceOrderId: string) => void;
  /** Contexto de um PV (atalho "Gerar OS" no pedido): amarra a OS ao pedido e
   *  lista os itens dele pra seleção. A Quantidade da OS = Σ pares selecionados. */
  saleOrderId?: string;
  saleOrderLabel?: string;               // ex.: "PV-00145"
  pvItems?: { id: string; label: string; pairs: number }[];
}

// Lista canônica compartilhada — era uma cópia local aqui, divergente da de
// `serviceOrderSectors.ts` (que não tinha `mesa` nem `colagem`). Duas listas =
// tarifa por setor silenciosamente sem match. Consolidado em 01/08/2026.
const SECTORS = SERVICE_ORDER_SECTORS;

const todayISO = () => new Date().toISOString().slice(0, 10);

export function ServiceOrderFormDialog({
  open, onOpenChange, initialContractorId, initialSector, onCreated,
  saleOrderId, saleOrderLabel, pvItems,
}: ServiceOrderFormDialogProps) {
  const qc = useQueryClient();
  const { data: contractors = [] } = useContractors();

  // Form state
  const [contractorId, setContractorId] = useState<string>('');
  const [sector, setSector] = useState<string>('costura');
  const [description, setDescription] = useState<string>('');
  const [serviceDate, setServiceDate] = useState<string>(todayISO());
  const [quotedDeadline, setQuotedDeadline] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(0);
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  // Seleção dos itens do PV (atalho do pedido). Default: todos marcados.
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Tarifa vigente serviço×prestadora (contractor_service_rates — fora do
  // types.ts; regenerar depois). Pré-preenche o valor por par; digitar
  // diferente vira override visível ("preço fora da tabela").
  const { data: tableRate } = useQuery({
    queryKey: ['contractor_rate', contractorId, sector, serviceDate],
    enabled: open && !!contractorId && !!sector,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_contractor_rate', {
        p_contractor_id: contractorId,
        p_sector: sector,
        p_date: serviceDate || todayISO(),
      });
      if (error) throw error;
      return data != null ? Number(data) : null;
    },
    staleTime: 60_000,
  });
  useEffect(() => {
    if (open && tableRate != null && tableRate > 0) setUnitPrice(tableRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableRate, open]);

  // Inicializa com props quando o dialog abre
  useEffect(() => {
    if (open) {
      setContractorId(initialContractorId || '');
      setSector(initialSector || 'costura');
      setServiceDate(todayISO());
      setQuotedDeadline('');
      setUnitPrice(0);
      setNotes('');
      // Atalho do PV: pré-marca todos os itens, soma os pares na Quantidade e
      // sugere a descrição a partir do pedido + itens.
      if (pvItems && pvItems.length) {
        setSelectedItemIds(new Set(pvItems.map((i) => i.id)));
        setQuantity(pvItems.reduce((s, i) => s + (Number(i.pairs) || 0), 0));
        setDescription(saleOrderLabel ? `${saleOrderLabel} — ${pvItems.map((i) => i.label).join(', ')}` : '');
      } else {
        setSelectedItemIds(new Set());
        setQuantity(0);
        setDescription('');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialContractorId, initialSector]);

  // Liga/desliga um item do PV e recalcula a Quantidade (Σ pares selecionados).
  const toggleItem = (id: string) => {
    const next = new Set(selectedItemIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedItemIds(next);
    setQuantity((pvItems || []).filter((i) => next.has(i.id)).reduce((s, i) => s + (Number(i.pairs) || 0), 0));
  };
  const selectedPvItems = useMemo(
    () => (pvItems || []).filter((i) => selectedItemIds.has(i.id)),
    [pvItems, selectedItemIds],
  );

  const totalValue = useMemo(() => quantity * unitPrice, [quantity, unitPrice]);
  const selectedContractor = contractors.find((c: any) => c.id === contractorId);
  const paymentDays = Number((selectedContractor as any)?.payment_days ?? 30) || 30;

  const create = useMutation({
    mutationFn: async () => {
      if (!contractorId) throw new Error('Selecione uma contratada.');
      if (!description.trim()) throw new Error('Informe uma descrição do serviço.');
      if (quantity <= 0 || unitPrice <= 0) throw new Error('Quantidade e valor unitário devem ser maiores que zero.');

      const order_number = await generateServiceOrderNumber();
      const payload: any = {
        contractor_id: contractorId,
        order_number,
        description: description.trim(),
        service_date: serviceDate || todayISO(),
        quoted_deadline: quotedDeadline || null,
        target_sector: sector,
        quantity,
        unit_price: unitPrice,
        total_value: totalValue,
        status: 'Pendente',
        notes: notes.trim() || null,
        quoted_at: quotedDeadline ? new Date().toISOString() : null,
      };
      // Atalho do PV: amarra a OS ao pedido (aparece no card de OS do PV, via
      // sale_order_id/source_sale_order_id — mesma consulta do PvServiceOrdersCard).
      if (saleOrderId) { payload.sale_order_id = saleOrderId; payload.source_sale_order_id = saleOrderId; }

      const { data: inserted, error } = await (supabase as any)
        .from('service_orders')
        .insert(payload)
        .select('id, order_number')
        .single();
      if (error) throw new Error(error.message);

      return inserted.id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      toast.success('Ordem de serviço criada.');
      onCreated?.(id);
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao criar OS.');
    },
  });

  const canSubmit = !!contractorId && !!description.trim() && quantity > 0 && unitPrice > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Buildings className="h-5 w-5 text-primary" />
            {saleOrderLabel ? `Gerar OS · ${saleOrderLabel}` : 'Nova Ordem de Serviço'}
          </DialogTitle>
          <DialogDescription>
            {pvItems && pvItems.length
              ? 'Selecione os itens deste pedido, o prestador e o setor. A OS nasce amarrada ao pedido.'
              : 'Lance qtd × valor por par (total calculado automaticamente). A OS não movimenta estoque — o material baixa na liberação do pedido pra produção.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ── Bloco 0: Itens do PV (só no atalho "Gerar OS" do pedido) ── */}
          {pvItems && pvItems.length > 0 && (
            <section className="space-y-2">
              <div className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">
                Itens deste pedido{saleOrderLabel ? ` · ${saleOrderLabel}` : ''}
              </div>
              <div className="space-y-1.5">
                {pvItems.map((it) => {
                  const on = selectedItemIds.has(it.id);
                  return (
                    <button
                      type="button" key={it.id} onClick={() => toggleItem(it.id)}
                      className={cn(
                        'w-full flex items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors',
                        on ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30 hover:bg-muted/50',
                      )}
                    >
                      <span className={cn('h-4 w-4 rounded border grid place-items-center text-[10px] leading-none text-white', on ? 'bg-primary border-primary' : 'border-muted-foreground/40')}>{on ? '✓' : ''}</span>
                      <span className="text-sm font-medium text-foreground flex-1 truncate">{it.label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{it.pairs.toLocaleString('pt-BR')} pares</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {selectedPvItems.length} de {pvItems.length} selecionado(s) · <b className="text-foreground">{selectedPvItems.reduce((s, i) => s + i.pairs, 0).toLocaleString('pt-BR')} pares</b> → vira a Quantidade da OS.
              </p>
            </section>
          )}

          {/* ── Bloco 1: Contratada + Setor ──────────────────────────── */}
          <section className="space-y-3">
            <div className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">
              Prestador e setor
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Contratada *</Label>
                <Select value={contractorId} onValueChange={setContractorId}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue placeholder="Selecionar contratada..." />
                  </SelectTrigger>
                  <SelectContent>
                    {contractors.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        Nenhuma contratada cadastrada. Cadastre em /terceirizados.
                      </div>
                    )}
                    {contractors.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.trade_name || c.name}
                        {c.service_type && (
                          <Badge variant="outline" className="h-4 text-[10px] ml-2">{c.service_type}</Badge>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Setor coberto *</Label>
                <Select value={sector} onValueChange={setSector}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTORS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* ── Bloco 2: Descrição + Datas ───────────────────────────── */}
          <section className="space-y-3">
            <div className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">
              Detalhes do serviço
            </div>
            <div>
              <Label className="text-xs">Descrição *</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: Costura de cabedal modelo X cor preto (lote PV-1234)"
                rows={2}
                className="mt-1 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Data do envio
                </Label>
                <Input
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Prazo prometido
                </Label>
                <Input
                  type="date"
                  value={quotedDeadline}
                  min={serviceDate || todayISO()}
                  onChange={(e) => setQuotedDeadline(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
            </div>
          </section>

          {/* ── Bloco 3: Quantidade × Valor = Total ──────────────────── */}
          <section className="space-y-3">
            <div className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">
              Valor (qty × unit = total automático)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Quantidade (pares) *</Label>
                <NumberInput value={quantity} onChange={setQuantity} step="1" min={0} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <CurrencyDollar className="h-3 w-3" /> Valor por par *
                </Label>
                <NumberInput value={unitPrice} onChange={setUnitPrice} step="0.01" min={0} className="mt-1 h-9" />
                {tableRate != null && tableRate > 0 && Math.abs(unitPrice - tableRate) > 0.004 && (
                  <p className="text-[11px] text-amber-600 mt-0.5">Preço fora da tabela (vigente: {formatCurrency(tableRate)})</p>
                )}
                {contractorId && (tableRate == null || tableRate <= 0) && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">Sem tarifa cadastrada p/ este serviço</p>
                )}
              </div>
              <div>
                <Label className="text-xs">Total da OS</Label>
                <div className="mt-1 h-9 px-3 flex items-center justify-end rounded-md bg-primary/5 border border-primary/20">
                  <span className="mono font-bold text-base tabular-nums text-foreground">
                    {formatCurrency(totalValue)}
                  </span>
                </div>
              </div>
            </div>
            {totalValue > 0 && selectedContractor && (
              <div className="text-xs text-muted-foreground flex items-center justify-between px-1">
                <span>
                  {quantity.toLocaleString('pt-BR')} pares × {formatCurrency(unitPrice)}
                </span>
                {quotedDeadline && (
                  <span>
                    Pagamento (~{paymentDays}d após entrega): <strong className="text-foreground">
                      {(() => {
                        const d = new Date(quotedDeadline + 'T00:00:00');
                        d.setDate(d.getDate() + paymentDays);
                        return d.toLocaleDateString('pt-BR');
                      })()}
                    </strong>
                  </span>
                )}
              </div>
            )}
          </section>

          {/* ── Bloco 5: Observações ─────────────────────────────────── */}
          <section className="space-y-2">
            <Label className="text-xs">Observações (opcional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas internas, instruções, número de lote, etc."
              rows={2}
              className="text-sm"
            />
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
            {create.isPending ? 'Criando...' : (
              <>
                <FlaskConical className="h-3.5 w-3.5 mr-1" />
                Criar OS
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
