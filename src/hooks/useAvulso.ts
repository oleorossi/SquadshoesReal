import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { generateServiceOrderNumber } from '@/lib/serviceOrderStock';

/**
 * Lançamento AVULSO de Ordem de Compra e Ordem de Serviço.
 *
 * Fluxo curto pedido pelo usuário: seleciona item/serviço + qtd + valor + DATA
 * DE PAGAMENTO e o sistema cria a OC/OS já com a conta a pagar (accounts_payable)
 * no financeiro, num só passo. A integração financeira é app-side aqui (espelha
 * o createAPEntries da tela de OC, que sempre foi app-side).
 *
 * Idempotência:
 *  - OC: idempotency_key na OC (trigger anti-duplicação 30s) + unique index
 *    uq_ap_per_purchase_order em accounts_payable(reference_id).
 *  - OS: unique index uq_ap_per_service_order em accounts_payable(reference_id)
 *    (já existia). O trigger de finalização de OS não duplica a AP.
 */

const todayISO = () => new Date().toISOString().slice(0, 10);

export interface CreateAvulsoPurchaseOrderInput {
  supplier_id: string;
  supplier_name: string;
  product_id: string;
  product_name: string;
  /** Quantidade na UNIDADE DE ESTOQUE do produto (ex.: 50 m, 12 dm²). */
  quantity: number;
  /** Unidade de estoque do produto (products.unit). */
  unit: string;
  /** Preço por unidade de estoque (R$/unit). total = quantity × unit_price. */
  unit_price: number;
  current_stock: number;
  min_stock: number;
  max_stock: number;
  /** Data de pagamento escolhida (ISO yyyy-mm-dd) → vira accounts_payable.due_date. */
  payment_due_date: string;
  notes?: string;
  /** Se true, credita o estoque do item agora (entrada retroativa). */
  add_to_stock: boolean;
}

export function useCreateAvulsoPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAvulsoPurchaseOrderInput) => {
      if (!input.supplier_id) throw new Error('Selecione um fornecedor.');
      if (!input.product_id) throw new Error('Selecione um item do estoque.');
      if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('Quantidade deve ser maior que zero.');
      if (!Number.isFinite(input.unit_price) || input.unit_price < 0) throw new Error('Preço unitário inválido.');
      if (!input.payment_due_date) throw new Error('Selecione a data de pagamento.');
      const total = input.quantity * input.unit_price;
      if (!Number.isFinite(total) || total <= 0) throw new Error('Valor total da OC deve ser maior que zero.');
      if (total > 1e12) throw new Error('Total da OC fora de limite.');

      // 1. Cria a OC avulsa. Começa 'approved' (financeiro lançado, aguardando
      //    mercadoria). Só vira 'received' DEPOIS que o estoque é creditado com
      //    sucesso (abaixo), pra não marcar como recebida se o crédito falhar.
      const idemKey = `avulsa::${input.supplier_id}::${input.product_id}::${input.quantity}::${input.unit_price}::${input.payment_due_date}`;
      const { data: po, error: poErr } = await supabase.from('purchase_orders').insert({
        supplier_id: input.supplier_id,
        supplier_name: input.supplier_name,
        notes: input.notes || '',
        total_value: total,
        auto_generated: false,
        source_type: 'manual_avulsa',
        status: 'approved',
        idempotency_key: idemKey,
      } as any).select().single();
      if (poErr) {
        if (poErr.code === '23505' && /idempotency/.test(poErr.message || '')) {
          throw new Error('Esta OC avulsa foi lançada há menos de 30s — confira a lista antes de repetir.');
        }
        throw poErr;
      }

      // 2. Item único (na unidade de estoque — sem conversão).
      const { error: itemErr } = await supabase.from('purchase_order_items').insert({
        purchase_order_id: po.id,
        product_id: input.product_id,
        quantity: input.quantity,
        suggested_quantity: input.quantity,
        unit_price: input.unit_price,
        unit: input.unit,
        current_stock: input.current_stock,
        min_stock: input.min_stock,
        max_stock: input.max_stock,
      } as any);
      if (itemErr) {
        await supabase.from('purchase_orders').delete().eq('id', po.id);
        throw itemErr;
      }

      // 3. Conta a pagar com a data escolhida (o objetivo central). Token
      //    [OC#id] em notes mantém compatível o cancelamento de AP do
      //    useDeletePurchaseOrder; reference_type/id habilitam a idempotência.
      const idToken = `[OC#${po.id}]`;
      const { error: apErr } = await supabase.from('accounts_payable').insert({
        description: `OC ${po.order_number} — ${input.product_name}`.slice(0, 200),
        amount: total,
        due_date: input.payment_due_date,
        category: 'material',
        supplier_id: input.supplier_id,
        status: 'pending',
        reference_type: 'purchase_order',
        reference_id: po.id,
        notes: `OC avulsa: ${po.order_number} - ${input.supplier_name} ${idToken}`,
      } as any);
      if (apErr && apErr.code !== '23505') {
        // Falhou em lançar no financeiro (o objetivo) — reverte a OC pra não
        // deixar uma OC sem conta a pagar. (Estoque ainda não foi creditado.)
        await supabase.from('purchase_orders').delete().eq('id', po.id);
        throw new Error(`Falha ao lançar no financeiro: ${apErr.message}`);
      }

      // 4. Crédito de estoque (opcional). Best-effort: se falhar, a OC fica
      //    'approved' com a AP criada e o usuário pode receber pelo fluxo normal
      //    (que é idempotente na AP via token [OC#id]).
      let stockWarning: string | undefined;
      if (input.add_to_stock) {
        const result = await adjustStockSafe({
          productId: input.product_id,
          expectedPrevious: input.current_stock,
          newQty: input.current_stock + input.quantity,
          reason: `Entrada avulsa — OC ${po.order_number} (${input.supplier_name})`,
          orderId: null,
        });
        if (result.success) {
          await supabase.from('purchase_orders')
            .update({ status: 'received', received_date: todayISO() } as any)
            .eq('id', po.id);
          await supabase.from('purchase_order_items')
            .update({ received_at: new Date().toISOString(), received_quantity: input.quantity } as any)
            .eq('purchase_order_id', po.id);
        } else {
          stockWarning = result.errorMessage || 'Falha ao creditar estoque.';
        }
      }

      return { po, stockWarning };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['mrp-needs'] });
      if (res?.stockWarning) {
        toast.warning(`OC e conta a pagar criadas, mas o estoque não foi creditado: ${res.stockWarning} Use "Receber" na OC depois.`, { duration: 9000 });
      } else {
        toast.success('OC avulsa lançada no financeiro!');
      }
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export interface CreateAvulsoServiceOrderInput {
  contractor_id: string;
  contractor_name: string;
  description: string;
  /** Valor total do serviço (R$). */
  total_value: number;
  /** Data de pagamento escolhida (ISO yyyy-mm-dd) → vira accounts_payable.due_date. */
  payment_due_date: string;
  notes?: string;
}

export function useCreateAvulsoServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAvulsoServiceOrderInput) => {
      if (!input.contractor_id) throw new Error('Selecione a contratada/prestador.');
      if (!input.description.trim()) throw new Error('Informe a descrição do serviço.');
      if (!Number.isFinite(input.total_value) || input.total_value <= 0) throw new Error('Valor total deve ser maior que zero.');
      if (!input.payment_due_date) throw new Error('Selecione a data de pagamento.');

      // 1. Cria a OS avulsa. quantity=1, unit_price=total (a OS é por serviço,
      //    não por par). status 'Pendente' → o trigger de finalização NÃO cria
      //    AP agora (só em status finalizado); a AP é criada app-side abaixo.
      const order_number = await generateServiceOrderNumber();
      const { data: os, error: osErr } = await (supabase as any).from('service_orders').insert({
        contractor_id: input.contractor_id,
        order_number,
        description: input.description.trim(),
        service_date: todayISO(),
        quantity: 1,
        unit_price: input.total_value,
        total_value: input.total_value,
        status: 'Pendente',
        is_avulsa: true,
        payment_due_date: input.payment_due_date,
        notes: input.notes?.trim() || null,
      }).select('id, order_number').single();
      if (osErr) throw osErr;

      // 2. Conta a pagar com a data escolhida. reference_type='service_order'
      //    reusa o unique uq_ap_per_service_order — se o trigger de finalização
      //    tentar criar depois, ele vê a AP existente e pula (não duplica).
      const { error: apErr } = await supabase.from('accounts_payable').insert({
        description: `OS ${os.order_number} — ${input.description.trim()}`.slice(0, 200),
        amount: input.total_value,
        due_date: input.payment_due_date,
        category: 'service',
        supplier_id: null,
        status: 'pending',
        reference_type: 'service_order',
        reference_id: os.id,
        notes: `OS avulsa: ${os.order_number} - ${input.contractor_name}`,
      } as any);
      if (apErr && apErr.code !== '23505') {
        // Reverte a OS pra não deixar OS sem financeiro (objetivo do lançamento).
        await (supabase as any).from('service_orders').delete().eq('id', os.id);
        throw new Error(`Falha ao lançar no financeiro: ${apErr.message}`);
      }

      return os;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
      toast.success('OS avulsa lançada no financeiro!');
    },
    onError: (e: any) => toast.error(e.message),
  });
}
