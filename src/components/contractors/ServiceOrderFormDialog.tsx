import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Buildings, Plus, Trash, Flask as FlaskConical, Calendar, CurrencyDollar, Package,
  CheckCircle, Warning,
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
import { useProducts } from '@/hooks/useProducts';
import {
  debitStockForServiceOrder, resolveMaterialProduct, generateServiceOrderNumber,
  type MaterialSentItem,
} from '@/lib/serviceOrderStock';
import { formatCurrency, cn } from '@/lib/utils';

/**
 * Dialog compartilhado pra CRIAR uma nova OS terceirizada.
 *
 * Fluxo:
 *  1. Coleta contractor + setor + descrição + qty × unit_price (= total auto)
 *  2. Lista de materiais a entregar (material/cor/metros) com preview de match
 *     no estoque (badge verde "produto encontrado" vs vermelho "não encontrado")
 *  3. Submit: INSERT em service_orders + dispara baixa de estoque pra cada item
 *     com produto resolvido (via adjustStockSafe RPC, concurrency-safe)
 *  4. Re-invalida caches relevantes
 *
 * Substitui o form bugado em Contractors.tsx (que gravava total_value=unit_price
 * sem multiplicar pela quantidade) e é reusável em /terceiros-na-rua.
 *
 * Edit mode pode ser implementado depois — MVP foca em CREATE.
 */

export interface ServiceOrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContractorId?: string;
  initialSector?: string;
  onCreated?: (serviceOrderId: string) => void;
}

const SECTORS = [
  { value: 'costura',        label: 'Costura' },
  { value: 'mesa',           label: 'Aviamento' },
  { value: 'corte_palmilha', label: 'Corte Palmilha' },
  { value: 'corte_forracao', label: 'Corte Forração' },
  { value: 'silk',           label: 'Silk' },
  { value: 'colagem',        label: 'Colagem' },
  { value: 'montagem',       label: 'Montagem' },
  { value: 'solagem',        label: 'Solagem' },
  { value: 'acabamento',     label: 'Acabamento' },
];

const todayISO = () => new Date().toISOString().slice(0, 10);

interface MaterialRow extends MaterialSentItem {
  _id: string; // chave local pra controlled array
}

export function ServiceOrderFormDialog({
  open, onOpenChange, initialContractorId, initialSector, onCreated,
}: ServiceOrderFormDialogProps) {
  const qc = useQueryClient();
  const { data: contractors = [] } = useContractors();
  const { data: products = [] } = useProducts();

  // Grupos pra ajudar resolução nome+cor
  const { data: productGroups = [] } = useQuery({
    queryKey: ['product_groups_for_so_form'],
    queryFn: async () => {
      const { data } = await supabase.from('product_groups').select('id, name');
      return data || [];
    },
    staleTime: 5 * 60_000,
  });

  // Form state
  const [contractorId, setContractorId] = useState<string>('');
  const [sector, setSector] = useState<string>('costura');
  const [description, setDescription] = useState<string>('');
  const [serviceDate, setServiceDate] = useState<string>(todayISO());
  const [quotedDeadline, setQuotedDeadline] = useState<string>('');
  const [quotedLeadDays, setQuotedLeadDays] = useState<number | ''>('');
  const [quantity, setQuantity] = useState<number>(0);
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [materials, setMaterials] = useState<MaterialRow[]>([]);

  // Inicializa com props quando o dialog abre
  useEffect(() => {
    if (open) {
      setContractorId(initialContractorId || '');
      setSector(initialSector || 'costura');
      setDescription('');
      setServiceDate(todayISO());
      setQuotedDeadline('');
      setQuotedLeadDays('');
      setQuantity(0);
      setUnitPrice(0);
      setNotes('');
      setMaterials([]);
    }
  }, [open, initialContractorId, initialSector]);

  const totalValue = useMemo(() => quantity * unitPrice, [quantity, unitPrice]);
  const selectedContractor = contractors.find((c: any) => c.id === contractorId);
  const paymentDays = Number((selectedContractor as any)?.payment_days ?? 30) || 30;

  const addMaterial = () => {
    setMaterials((prev) => [
      ...prev,
      { _id: crypto.randomUUID(), material: '', color: '', meters: 0 },
    ]);
  };

  const removeMaterial = (id: string) => {
    setMaterials((prev) => prev.filter((m) => m._id !== id));
  };

  const updateMaterial = (id: string, patch: Partial<MaterialRow>) => {
    setMaterials((prev) => prev.map((m) => (m._id === id ? { ...m, ...patch } : m)));
  };

  // Preview de match no estoque pra cada linha
  const matchedProducts = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveMaterialProduct>>();
    for (const m of materials) {
      map.set(m._id, resolveMaterialProduct(m.material, m.color, products as any, productGroups as any));
    }
    return map;
  }, [materials, products, productGroups]);

  const validMaterials = materials.filter((m) => m.material && m.color && m.meters > 0);
  const unresolvedCount = validMaterials.filter((m) => !matchedProducts.get(m._id)).length;
  const totalMeters = validMaterials.reduce((s, m) => s + Number(m.meters || 0), 0);

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
        quoted_lead_days: typeof quotedLeadDays === 'number' && quotedLeadDays > 0 ? quotedLeadDays : null,
        target_sector: sector,
        quantity,
        unit_price: unitPrice,
        total_value: totalValue,
        materials_sent: validMaterials.map(({ _id, ...rest }) => rest),
        status: 'Pendente',
        notes: notes.trim() || null,
        quoted_at: quotedDeadline ? new Date().toISOString() : null,
      };

      const { data: inserted, error } = await (supabase as any)
        .from('service_orders')
        .insert(payload)
        .select('id, order_number')
        .single();
      if (error) throw new Error(error.message);

      // Baixa de estoque (best-effort: surface warnings mas não bloqueia)
      if (validMaterials.length > 0) {
        const result = await debitStockForServiceOrder(
          validMaterials.map((m) => ({
            material: m.material, color: m.color, meters: m.meters,
            product_id: matchedProducts.get(m._id)?.id,
          })),
          {
            service_order_id: inserted.id,
            order_number: inserted.order_number,
            sale_order_label: null,
            products: products as any,
            product_groups: productGroups as any,
          },
        );
        const failed = result.items.filter((i) => i.status !== 'ok');
        if (failed.length > 0) {
          toast.warning(
            `${failed.length} ${failed.length === 1 ? 'material não foi debitado' : 'materiais não foram debitados'}: ${failed.map((f) => `${f.material}/${f.color}`).join(', ')}. OS criada mesmo assim.`,
            { duration: 8000 },
          );
        }
      }

      return inserted.id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
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
            Nova Ordem de Serviço
          </DialogTitle>
          <DialogDescription>
            Lance qtd × valor por par (total calculado automaticamente) e os materiais a entregar
            ao prestador — o estoque é debitado automaticamente quando a OS é criada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
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
                  onChange={(e) => {
                    setQuotedDeadline(e.target.value);
                    // Mutex: ao escolher data manual, limpa lead_days pra evitar
                    // ghost field. Trigger só recalcula deadline a partir de
                    // lead_days se deadline IS NULL — manter ambos preenchidos
                    // criava ambiguidade no que o sistema usaria.
                    if (e.target.value) setQuotedLeadDays('');
                  }}
                  className="mt-1 h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Se vazio, o servidor calcula a partir de "dias úteis" abaixo.
                </p>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Dias úteis até entrega (opcional)</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder={
                    quotedDeadline
                      ? 'Desabilitado — prazo prometido já informado'
                      : (selectedContractor as any)?.default_lead_days
                      ? `Padrão da contratada: ${(selectedContractor as any).default_lead_days}`
                      : 'Padrão: 10'
                  }
                  value={quotedLeadDays}
                  disabled={!!quotedDeadline}
                  onChange={(e) => {
                    const v = e.target.value;
                    setQuotedLeadDays(v === '' ? '' : Number(v));
                  }}
                  className="mt-1 h-9 text-sm font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {quotedDeadline
                    ? 'Desabilitado: prazo prometido manual prevalece. Limpe o campo acima pra usar dias úteis.'
                    : selectedContractor
                    ? (selectedContractor as any).default_lead_days
                      ? `Sugerido pela contratada: ${(selectedContractor as any).default_lead_days} dias úteis. Deixe vazio pra usar esse padrão.`
                      : 'Contratada sem prazo padrão configurado — fallback de 10 dias úteis.'
                    : 'Selecione uma contratada pra ver o prazo padrão sugerido.'}
                </p>
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

          {/* ── Bloco 4: Materiais entregues ─────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                <Package className="h-3 w-3" />
                Materiais entregues ao prestador ({materials.length})
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addMaterial} className="h-7 text-xs gap-1">
                <Plus className="h-3 w-3" />
                Adicionar
              </Button>
            </div>

            {materials.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground border border-dashed border-border rounded-md">
                Nenhum material adicionado. Clique <strong>Adicionar</strong> pra incluir materiais que serão entregues ao prestador
                — o estoque será debitado automaticamente.
              </div>
            ) : (
              <div className="space-y-2">
                {materials.map((m) => {
                  const matched = matchedProducts.get(m._id);
                  const isResolved = m.material && m.color && !!matched;
                  const isUnresolved = m.material && m.color && !matched;
                  return (
                    <div
                      key={m._id}
                      className={cn(
                        'grid grid-cols-[1fr_1fr_100px_140px_32px] gap-2 items-end p-2 rounded-md border',
                        isResolved ? 'border-green-500/30 bg-green-500/5' : isUnresolved ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-muted/30',
                      )}
                    >
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Material</Label>
                        <Input
                          value={m.material}
                          onChange={(e) => updateMaterial(m._id, { material: e.target.value })}
                          placeholder="Ex.: NAPA SOFT"
                          className="h-8 text-xs mt-0.5"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Cor</Label>
                        <Input
                          value={m.color}
                          onChange={(e) => updateMaterial(m._id, { color: e.target.value })}
                          placeholder="Ex.: Preto"
                          className="h-8 text-xs mt-0.5"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Metros</Label>
                        <NumberInput
                          value={m.meters}
                          onChange={(v) => updateMaterial(m._id, { meters: v })}
                          step="0.1"
                          min={0}
                          className="h-8 text-xs mt-0.5"
                        />
                      </div>
                      <div className="pb-0.5">
                        {isResolved && matched ? (
                          <Badge variant="outline" className="text-[10px] gap-1 bg-green-500/10 text-green-700 border-green-500/40 dark:text-green-400">
                            <CheckCircle className="h-3 w-3" />
                            <span className="truncate">est: {(matched.quantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}m</span>
                          </Badge>
                        ) : isUnresolved ? (
                          <Badge variant="outline" className="text-[10px] gap-1 bg-red-500/10 text-red-700 border-red-500/40 dark:text-red-400">
                            <Warning className="h-3 w-3" />
                            Não encontrado
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">preencha material+cor</span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => removeMaterial(m._id)}
                        aria-label="Remover material"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between text-xs text-muted-foreground px-2 pt-1">
                  <span>{validMaterials.length} {validMaterials.length === 1 ? 'material válido' : 'materiais válidos'} · {totalMeters.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m totais</span>
                  {unresolvedCount > 0 && (
                    <span className="text-amber-700 dark:text-amber-400 flex items-center gap-1">
                      <Warning className="h-3 w-3" />
                      {unresolvedCount} sem produto no estoque — não será debitado
                    </span>
                  )}
                </div>
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
                Criar OS e debitar estoque
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
