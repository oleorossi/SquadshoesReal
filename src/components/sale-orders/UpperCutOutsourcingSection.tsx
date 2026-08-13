import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CircleNotch as Loader2, CheckCircle, Scissors } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useContractors } from '@/hooks/useContractors';
import { generateServiceOrderNumber } from '@/lib/serviceOrderStock';
import { normTxt } from '@/lib/consumptionRows';

/**
 * CORTE DE CABEDAL — TERCEIRIZAÇÃO, no consumo de UM PV.
 *
 * Extraído de `MaterialConsumptionDialog` em 05/08/2026, quando o modal por-PV
 * foi aposentado em favor da página `?view=consumo` (a mesma do Consolidado).
 * Vive à parte porque só faz sentido com UM pedido: a OS amarra PV + referência
 * + cor, e um lote de PVs não tem uma OS única.
 *
 * Itens do PV cuja ficha técnica NÃO tem tiras (`has_straps !== true`) passam
 * pela sub-etapa "Corte Cabedal". Aqui a OS de terceirização é gerada direto,
 * espelhando o payload do `ServiceOrderFormDialog`.
 */
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
const FINALIZED_OS_STATUSES = [
  'received', 'Concluído', 'concluido', 'finalizado', 'Finalizado',
  'Cancelado', 'cancelled', 'cancelado',
];

type Props = { saleOrderId: string; orderNumber: string };

export default function UpperCutOutsourcingSection({ saleOrderId, orderNumber }: Props) {
  const qc = useQueryClient();
  const { data: contractors = [] } = useContractors();
  const activeContractors = useMemo(
    () => contractors.filter((c) => c.active), // hook já ordena por nome
    [contractors],
  );
  /** key do grupo → contractor_id selecionado no Select */
  const [contractorByKey, setContractorByKey] = useState<Record<string, string>>({});
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  /** OS criadas nesta sessão, somadas às já existentes no banco. */
  const [justCreated, setJustCreated] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['upper-cut-groups', saleOrderId],
    enabled: !!saleOrderId,
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from('sale_order_items')
        .select('reference_id, color, quantity, technical_sheets(code, name, has_straps)')
        .eq('sale_order_id', saleOrderId);
      if (error) throw error;

      // Agrupa por referência + cor — um grupo = uma OS.
      const groupsMap = new Map<string, UpperCutGroup>();
      for (const item of (items || []) as any[]) {
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
      const groups = Array.from(groupsMap.values())
        .filter((g) => g.pairs > 0)
        .sort((a, b) =>
          (a.refName || a.refCode).localeCompare(b.refName || b.refCode, 'pt-BR')
          || a.color.localeCompare(b.color, 'pt-BR'));

      // OS ativas de corte de cabedal já vinculadas a ESTE PV (anti-duplicação).
      const osByKey: Record<string, string> = {};
      if (groups.length > 0) {
        const { data: existingOs } = await (supabase as any)
          .from('service_orders')
          .select('order_number, description, status')
          .or(`sale_order_id.eq.${saleOrderId},linked_sale_order_ids.cs.{${saleOrderId}}`)
          .eq('target_sector', UPPER_CUT_SECTOR);
        const activeOs = ((existingOs || []) as Array<{ order_number: string; description: string | null; status: string }>)
          .filter((o) => !FINALIZED_OS_STATUSES.includes(o.status));
        for (const g of groups) {
          const refToken = normTxt(g.refName || g.refCode);
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
      return { groups, osByKey };
    },
  });

  const groups = data?.groups ?? [];
  const existingOsByKey = { ...(data?.osByKey ?? {}), ...justCreated };

  /** Cria a OS de corte de cabedal pro grupo (ref+cor) e DEBITA a napa do
   *  cabedal na mesma transação (spec §4.1).
   *
   *  A criação inteira mora na RPC `create_upper_cut_service_order` porque o
   *  insert e a baixa de estoque têm que ser atômicos: OS criada sem débito
   *  passaria a exibir "OS já gerada" e o furo ficaria escondido pra sempre.
   *  A RPC também é quem garante a idempotência (advisory lock por PV+ref+cor
   *  + marcador na descrição), então duas abas não geram dois débitos.
   *
   *  Modelo só de tiras (ficha sem cabedal) continua sem débito — a RPC
   *  simplesmente não acha linha 'Cabedal' no motor de consumo. */
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
      const refLabel = [g.refName, g.refCode && g.refCode !== g.refName ? `(cód. interno ${g.refCode})` : ''].filter(Boolean).join(' ');
      const colorPart = g.color !== '—' ? ` · cor ${g.color}` : '';

      const { data: res, error } = await (supabase as any).rpc('create_upper_cut_service_order', {
        p_sale_order_id: saleOrderId,
        p_reference_id: g.refId,
        // '—' é o rótulo de "sem cor" da tabela; o servidor casa itens por cor
        // normalizada, então tem que virar string vazia de novo.
        p_color: g.color === '—' ? '' : g.color,
        p_contractor_id: contractorId,
        p_pairs: g.pairs,
        p_description: `Corte de cabedal — REF ${refLabel}${colorPart} · ${g.pairs} pares (PV ${orderNumber})`,
        p_order_number: order_number,
        p_unit_price: unitPrice,
        p_service_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw new Error(error.message);

      const osNumber = String(res?.order_number ?? order_number);
      setJustCreated((prev) => ({ ...prev, [g.key]: osNumber }));
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['contractors'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      // O débito mexe em estoque: as telas de material precisam recarregar.
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });

      if (res?.status === 'already_exists') {
        toast.info(`OS ${osNumber} já existia para esta referência/cor — nada foi debitado de novo.`);
        return;
      }

      const debited: Array<{ product_name: string; quantity: number; unit: string }> = res?.debited ?? [];
      const shortfall: Array<{ product_name: string; required: number; available: number; unit: string }> = res?.shortfall ?? [];

      if (debited.length > 0) {
        const resumo = debited.map((d) => `${d.quantity} ${d.unit} de ${d.product_name}`).join(', ');
        toast.success(`OS ${osNumber} criada — baixa de ${resumo}.`);
      } else if (res?.upper_material === false) {
        toast.success(`OS ${osNumber} criada — modelo sem cabedal na ficha, nenhum material debitado.`);
      } else {
        toast.success(`OS ${osNumber} criada — visível no menu Terceirizados.`);
      }

      for (const s of shortfall) {
        toast.warning(
          `Estoque insuficiente de ${s.product_name}: necessário ${s.required} ${s.unit}, disponível ${s.available}. ` +
          'A OS saiu e o disponível foi debitado — acerte a entrada dessa napa.',
        );
      }
      if (unitPrice <= 0) {
        toast.warning(`OS ${osNumber} está SEM preço — cadastre a tarifa da prestadora ou defina o valor na OS.`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao criar a OS de corte de cabedal.');
    } finally {
      setCreatingKey(null);
    }
  };

  if (isLoading || groups.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <Scissors className="h-4 w-4" />
        Corte de Cabedal — Terceirização
      </h3>
      <p className="text-xs text-muted-foreground">
        Referências deste pedido com corte de cabedal (modelo sem tiras). Selecione a terceirizada e
        gere a Ordem de Serviço direto daqui — ela entra como <strong>Pendente</strong> nas listas do
        menu Terceirizados. Quando a ficha tem cabedal, gerar a OS <strong>dá baixa na napa do
        cabedal</strong> na metragem deste lote (o material sai da fábrica com a terceirizada).
      </p>
      <div className="overflow-hidden overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Referência</TableHead>
              <TableHead>Cor</TableHead>
              <TableHead className="w-20 text-right">Pares</TableHead>
              <TableHead className="w-64">Terceirizada</TableHead>
              <TableHead className="w-44 text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => {
              const existingOs = existingOsByKey[g.key];
              const selected = contractorByKey[g.key] || '';
              const isCreating = creatingKey === g.key;
              return (
                <TableRow key={g.key}>
                  <TableCell className="font-medium">
                    <span>{g.refName || g.refCode || '—'}</span>
                    {g.refCode && g.refCode !== g.refName && <span className="ml-1.5 font-mono text-xs text-muted-foreground">Cód. interno: {g.refCode}</span>}
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
                      <Badge variant="outline" className="gap-1 border-green-500/40 bg-green-500/10 text-xs text-green-700 dark:text-green-400">
                        <CheckCircle className="h-3 w-3" />
                        OS já gerada: {existingOs}
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
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
  );
}
