import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CircleNotch as Loader2, Package, CheckCircle, Scissors } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useContractors } from '@/hooks/useContractors';
import { generateServiceOrderNumber } from '@/lib/serviceOrderStock';
import {
  fetchConsumptionContext,
  computeConsumptionForItems,
  TECHNICAL_SHEET_CONSUMPTION_COLUMNS,
  type ConsumptionItem,
} from '@/lib/orderConsumption';
import { annotateConsumptionAvailability, normTxt, type ConsumptionRow } from '@/lib/consumptionRows';
import MaterialConsumptionView from '@/components/sale-orders/MaterialConsumptionView';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  saleOrderId: string | null;
  orderNumber: string;
};

/* ── Terceirização do Corte de Cabedal ─────────────────────────────────────
 * Itens do PV cuja ficha técnica NÃO tem tiras (has_straps !== true) passam
 * pela sub-etapa "Corte Cabedal". A seção abaixo permite gerar a OS de
 * terceirização direto do modal, espelhando o payload do ServiceOrderFormDialog. */
type UpperCutGroup = {
  key: string;
  refId: string;
  refCode: string | null;
  refName: string;
  color: string;
  pairs: number;
};

/** Valor de domínio pro setor de corte de cabedal (enum SQL 'corte_cabedal'). */
const UPPER_CUT_SECTOR = 'corte_cabedal';

/** Status que encerram uma OS — OS nesses status NÃO bloqueia gerar outra. */
const FINALIZED_OS_STATUSES = ['received', 'Concluído', 'concluido', 'finalizado', 'Finalizado', 'Cancelado', 'cancelled', 'cancelado'];

export default function MaterialConsumptionDialog({ open, onOpenChange, saleOrderId, orderNumber }: Props) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [artisanalStrapRows, setArtisanalStrapRows] = useState<ArtisanalStrapCutRow[]>([]);

  // ── Corte de Cabedal — terceirização ────────────────────────────────────
  const { data: contractors = [] } = useContractors();
  const activeContractors = useMemo(
    () => contractors.filter((c) => c.active), // hook já ordena por nome
    [contractors],
  );
  const [upperCutGroups, setUpperCutGroups] = useState<UpperCutGroup[]>([]);
  /** key do grupo → order_number da OS ativa já existente (anti-duplicação) */
  const [existingOsByKey, setExistingOsByKey] = useState<Record<string, string>>({});
  /** key do grupo → contractor_id selecionado no Select */
  const [contractorByKey, setContractorByKey] = useState<Record<string, string>>({});
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  // Gatilho de recálculo automático: invalidado pelo save do PV
  // (useUpdateSaleOrder → invalidateQueries(['consumption-source'])).
  const { dataUpdatedAt: pvTouchedAt } = useQuery({
    queryKey: ['consumption-source', saleOrderId],
    queryFn: async () => {
      const { data } = await supabase
        .from('sale_orders')
        .select('updated_at')
        .eq('id', saleOrderId as string)
        .maybeSingle();
      return (data as any)?.updated_at ?? null;
    },
    enabled: open && !!saleOrderId,
    staleTime: 0,
  });

  // Troca de PV zera o quadro ANTES de recarregar. Sem isso o modal continuava
  // exibindo as linhas do PV anterior enquanto o novo carregava — com o título já
  // trocado pro novo número, o usuário lia o consumo de um pedido sob o rótulo de
  // outro (exatamente a confusão do 4.416 do PV-00145 aparecendo "no PV-00147").
  useEffect(() => {
    setRows([]);
    setArtisanalStrapRows([]);
    setUpperCutGroups([]);
    setExistingOsByKey({});
    setContractorByKey({});
  }, [saleOrderId]);

  useEffect(() => {
    if (!open || !saleOrderId) return;
    let cancelled = false;
    loadConsumption(() => cancelled);
    return () => { cancelled = true; };
  }, [open, saleOrderId, pvTouchedAt]);

  const loadConsumption = async (isCancelled: () => boolean = () => false) => {
    if (!saleOrderId) return;
    setLoading(true);

    try {
      // O sub-select de technical_sheets reusa TECHNICAL_SHEET_CONSUMPTION_COLUMNS
      // (fonte ÚNICA das colunas que o motor canônico lê) + os campos exclusivos
      // do modal (code/name p/ a seção de Corte de Cabedal, has_straps p/ decidir
      // quem entra nela).
      const { data: items, error: itemsError } = await supabase
        .from('sale_order_items')
        .select(`
          reference_id,
          color,
          quantity,
          grade,
          fichas,
          strap_colors,
          material_variant_id,
          technical_sheets(
            code,
            name,
            has_straps,
            ${TECHNICAL_SHEET_CONSUMPTION_COLUMNS}
          )
        `)
        .eq('sale_order_id', saleOrderId);

      if (itemsError) throw itemsError;
      if (!items || items.length === 0) {
        setRows([]);
        setArtisanalStrapRows([]);
        setUpperCutGroups([]);
        setExistingOsByKey({});
        setContractorByKey({});
        return;
      }

      // ── Itens com Corte de Cabedal (has_straps !== true), agrupados por
      //    referência + cor — alimenta a seção de terceirização. ────────────
      const groupsMap = new Map<string, UpperCutGroup>();
      for (const item of items as any[]) {
        const sheet = item.technical_sheets;
        if (!item.reference_id || !sheet || sheet.has_straps === true) continue;
        const color = (item.color || '').trim() || '—';
        const key = `${item.reference_id}|${normTxt(color)}`;
        const g = groupsMap.get(key) || {
          key,
          refId: item.reference_id,
          refCode: sheet.code || null,
          refName: sheet.name || '',
          color,
          pairs: 0,
        };
        g.pairs += Number(item.quantity) || 0;
        groupsMap.set(key, g);
      }
      const upperGroups = Array.from(groupsMap.values())
        .filter((g) => g.pairs > 0)
        .sort((a, b) => (a.refCode || a.refName).localeCompare(b.refCode || b.refName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'));

      // OS ativas de corte de cabedal já vinculadas a ESTE PV (anti-duplicação).
      const osByKey: Record<string, string> = {};
      if (upperGroups.length > 0) {
        const { data: existingOs } = await (supabase as any)
          .from('service_orders')
          .select('order_number, description, status')
          .or(`sale_order_id.eq.${saleOrderId},linked_sale_order_ids.cs.{${saleOrderId}}`)
          .eq('target_sector', UPPER_CUT_SECTOR);
        const activeOs = ((existingOs || []) as Array<{ order_number: string; description: string | null; status: string }>)
          .filter((o) => !FINALIZED_OS_STATUSES.includes(o.status));
        for (const g of upperGroups) {
          const refToken = normTxt(g.refCode || g.refName);
          if (!refToken) continue;
          const hit = activeOs.find((o) => {
            const desc = normTxt(o.description || '');
            if (!desc.includes(refToken)) return false;
            if (g.color !== '—' && !desc.includes(normTxt(g.color))) return false;
            return true;
          });
          if (hit) osByKey[g.key] = hit.order_number;
        }
      }

      if (!isCancelled()) {
        setUpperCutGroups(upperGroups);
        setExistingOsByKey(osByKey);
        setContractorByKey({});
      }

      const refIds = [...new Set(items.map((item) => item.reference_id).filter(Boolean))];

      const ctx = await fetchConsumptionContext(refIds);

      // Modo de embalagem do PEDIDO — quando a ficha tem várias caixas no BOM
      // (colmeia + individual), o motor mostra só a caixa do modo escolhido.
      const { data: soPkg } = await supabase
        .from('sale_orders')
        .select('packaging_mode')
        .eq('id', saleOrderId)
        .single();
      const packagingMode = (soPkg as any)?.packaging_mode ?? null;
      const itemsWithMode = (items as any[]).map((it) => ({ ...it, packagingMode }));

      // Motor CANÔNICO (por PEDIDO: agrega todos os itens do PV) + anotação de
      // disponibilidade/tiras artesanais (fonte única compartilhada).
      const computed = computeConsumptionForItems(
        itemsWithMode as unknown as ConsumptionItem[],
        ctx,
      );
      const { rows: annotatedRows, artisanalStrapRows: strapCut } =
        await annotateConsumptionAvailability(computed, ctx);

      if (isCancelled()) return;
      setRows(annotatedRows);
      setArtisanalStrapRows(strapCut);
    } catch (err) {
      if (isCancelled()) return;
      console.error('Erro ao carregar consumo:', err);
      setRows([]);
      setArtisanalStrapRows([]);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  };

  /** Cria a OS de corte de cabedal pro grupo (ref+cor) — espelha o payload do
   *  ServiceOrderFormDialog (criação manual canônica). */
  const handleCreateUpperCutOS = async (g: UpperCutGroup) => {
    const contractorId = contractorByKey[g.key];
    if (!saleOrderId || !contractorId || creatingKey) return;
    setCreatingKey(g.key);
    try {
      const order_number = await generateServiceOrderNumber();
      // Tarifa vigente serviço×prestadora (Fase 1 facção) — evita OS sem preço.
      let unitPrice = 0;
      try {
        const { data: rate } = await (supabase as any).rpc('get_contractor_rate', {
          p_contractor_id: contractorId,
          p_sector: UPPER_CUT_SECTOR,
          p_date: new Date().toISOString().slice(0, 10),
        });
        unitPrice = rate != null ? Number(rate) : 0;
      } catch { /* sem tarifa — OS nasce com preço 0, definir depois */ }
      const refLabel = [g.refCode, g.refName].filter(Boolean).join(' ');
      const colorPart = g.color !== '—' ? ` · cor ${g.color}` : '';
      const payload = {
        contractor_id: contractorId,
        order_number,
        description: `Corte de cabedal — REF ${refLabel}${colorPart} · ${g.pairs} pares (PV ${orderNumber})`,
        service_date: new Date().toISOString().slice(0, 10),
        target_sector: UPPER_CUT_SECTOR,
        sale_order_id: saleOrderId,
        linked_sale_order_ids: [saleOrderId],
        quantity: g.pairs,
        unit_price: unitPrice,
        total_value: unitPrice > 0 ? unitPrice * g.pairs : 0,
        status: 'Pendente',
      };
      const { data: inserted, error } = await (supabase as any)
        .from('service_orders')
        .insert(payload)
        .select('id, order_number')
        .single();
      if (error) throw new Error(error.message);

      setExistingOsByKey((prev) => ({ ...prev, [g.key]: inserted.order_number as string }));
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['contractors'] });
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      if (unitPrice > 0) {
        toast.success(`OS ${inserted.order_number} criada (R$ ${unitPrice.toFixed(2)}/par pela tabela) — visível no menu Terceirizados.`);
      } else {
        toast.warning(`OS ${inserted.order_number} criada SEM preço — cadastre a tarifa da prestadora ou defina o valor na OS.`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao criar a OS de corte de cabedal.');
    } finally {
      setCreatingKey(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-7xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Consumo de Materiais — {orderNumber}
          </DialogTitle>
          <DialogDescription className="sr-only">Consumo calculado por material com disponibilidade em estoque.</DialogDescription>
        </DialogHeader>

        <MaterialConsumptionView
          rows={rows}
          artisanalStrapRows={artisanalStrapRows}
          title={`Consumo de Materiais — ${orderNumber}`}
          loading={loading}
          onRecalcular={() => loadConsumption()}
          emptyMessage="Nenhum consumo de material encontrado para este pedido."
        />

        {/* ── Corte de Cabedal — Terceirização ──────────────────────────────
            Visível quando ≥1 item do PV tem referência SEM tiras (modelo com
            cabedal completo a cortar). Atalho pro fluxo manual do menu
            Terceirizados: seleciona a terceirizada e gera a OS daqui. */}
        {!loading && upperCutGroups.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Scissors className="h-4 w-4" />
              Corte de Cabedal — Terceirização
            </h3>
            <p className="text-xs text-muted-foreground">
              Referências deste pedido com corte de cabedal (modelo sem tiras). Selecione a terceirizada e
              gere a Ordem de Serviço direto daqui — ela entra como <strong>Pendente</strong> nas listas do
              menu Terceirizados.
            </p>
            <div className="rounded-lg border overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Referência</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right w-20">Pares</TableHead>
                    <TableHead className="w-64">Terceirizada</TableHead>
                    <TableHead className="text-right w-44">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upperCutGroups.map((g) => {
                    const existingOs = existingOsByKey[g.key];
                    const selected = contractorByKey[g.key] || '';
                    const isCreating = creatingKey === g.key;
                    return (
                      <TableRow key={g.key}>
                        <TableCell className="font-medium">
                          {g.refCode && <span className="font-mono text-xs mr-1.5 text-muted-foreground">{g.refCode}</span>}
                          {g.refName}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{g.color}</Badge></TableCell>
                        <TableCell className="text-right font-mono font-semibold">{g.pairs}</TableCell>
                        <TableCell>
                          {existingOs ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <Select value={selected} onValueChange={(v) => setContractorByKey((prev) => ({ ...prev, [g.key]: v }))}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Selecionar terceirizada..." />
                              </SelectTrigger>
                              <SelectContent>
                                {activeContractors.length === 0 && (
                                  <div className="px-3 py-2 text-xs text-muted-foreground">
                                    Nenhuma terceirizada ativa. Cadastre em Terceirizados.
                                  </div>
                                )}
                                {activeContractors.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.trade_name || c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {existingOs ? (
                            <Badge variant="outline" className="text-xs gap-1 bg-green-500/10 text-green-700 border-green-500/40 dark:text-green-400">
                              <CheckCircle className="h-3 w-3" />
                              OS já gerada: {existingOs}
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              className="h-8 text-xs gap-1.5"
                              disabled={!selected || isCreating}
                              onClick={() => handleCreateUpperCutOS(g)}
                            >
                              {isCreating
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Scissors className="h-3.5 w-3.5" />}
                              {isCreating ? 'Gerando...' : 'Gerar OS'}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
