import { supabase } from '@/integrations/supabase/client';
import { adjustStockSafe } from '@/lib/stockAdjustments';

/**
 * Débito de estoque para uma OS (service_order) — extraído pra reuso
 * em ServiceOrderFormDialog e Contractors.tsx legacy.
 *
 * Recebe um array de materiais enviados e produtos do cache; pra cada item:
 *  1. Resolve product_id via match nome+cor (com fallback grupo)
 *  2. Chama adjustStockSafe (RPC com FOR UPDATE) — concurrency safe
 *  3. Coleta warnings/erros pra retorno
 *
 * Não dispara toasts diretamente — o caller decide como surfaceá-los.
 */
export interface MaterialSentItem {
  material: string;        // nome do produto OU grupo
  color: string;
  meters: number;
  product_id?: string;     // se já resolvido pelo form, evita lookup
}

export interface DebitContext {
  service_order_id: string;
  order_number?: string | null;
  sale_order_label?: string | null;  // ex.: "PV-1234 (cliente_order_number)"
  products: Array<{
    id: string;
    name: string;
    color: string | null;
    quantity: number | null;
    group_id: string | null;
  }>;
  product_groups: Array<{ id: string; name: string }>;
}

export interface DebitResultItem {
  material: string;
  color: string;
  meters: number;
  product_id: string | null;
  status: 'ok' | 'product_not_found' | 'insufficient_stock' | 'rpc_failed';
  message?: string;
}

export interface DebitResult {
  items: DebitResultItem[];
  any_failed: boolean;
}

function normalize(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase();
}

function getBaseName(name: string): string {
  // "NAPA SOFT - PRETO" → "NAPA SOFT"; "MATERIAL · Cor" → "MATERIAL"
  return name.split(/[-·]/)[0]?.trim() || name;
}

export async function debitStockForServiceOrder(
  materials: MaterialSentItem[],
  ctx: DebitContext,
): Promise<DebitResult> {
  const items: DebitResultItem[] = [];
  const pvLabel = ctx.sale_order_label ? ` | ${ctx.sale_order_label}` : '';
  const reasonPrefix = `Débito automático para OS ${ctx.order_number || ctx.service_order_id.slice(0, 8)}${pvLabel}`;

  for (const mat of materials) {
    if (!mat.material || !(mat.meters > 0) || (!mat.color && !mat.product_id)) {
      items.push({
        material: mat.material,
        color: mat.color,
        meters: mat.meters,
        product_id: mat.product_id ?? null,
        status: 'product_not_found',
        message: 'Material enviado sem identificação suficiente para debitar o estoque',
      });
      continue;
    }
    let product = mat.product_id ? ctx.products.find((p) => p.id === mat.product_id) : undefined;

    if (mat.product_id && !product) {
      items.push({
        material: mat.material,
        color: mat.color,
        meters: mat.meters,
        product_id: mat.product_id,
        status: 'product_not_found',
        message: 'Produto informado não encontrado no estoque',
      });
      continue;
    }

    if (!product) {
      const group = ctx.product_groups.find((g) => normalize(g.name) === normalize(mat.material));
      product = ctx.products.find((p) => {
        const pc = normalize(p.color);
        const targetColor = normalize(mat.color);
        // Grupo resolvido: casa SÓ por group_id (evita vazar pra produto homônimo
        // de outro grupo, ex.: "NAPA SOFT" dentro do grupo NAPA SUDANI).
        if (group) return p.group_id === group.id && pc === targetColor;
        // Sem grupo cadastrado com esse nome: fallback por nome do produto.
        const base = normalize(getBaseName(p.name));
        return base === normalize(mat.material) && pc === targetColor;
      });
    }

    if (!product) {
      items.push({
        material: mat.material,
        color: mat.color,
        meters: mat.meters,
        product_id: null,
        status: 'product_not_found',
        message: 'Produto não encontrado no estoque',
      });
      continue;
    }

    const prevQty = product.quantity || 0;
    if (prevQty < mat.meters) {
      items.push({
        material: mat.material,
        color: mat.color,
        meters: mat.meters,
        product_id: product.id,
        status: 'insufficient_stock',
        message: `Saldo insuficiente: disponível ${prevQty}, necessário ${mat.meters}`,
      });
      continue;
    }

    const newQty = prevQty - mat.meters;
    const result = await adjustStockSafe({
      productId: product.id,
      expectedPrevious: prevQty,
      newQty,
      reason: `${reasonPrefix} — ${mat.material} (${mat.color}) -${mat.meters}m`,
    });

    items.push({
      material: mat.material,
      color: mat.color,
      meters: mat.meters,
      product_id: product.id,
      status: result.success ? 'ok' : 'rpc_failed',
      message: result.errorMessage,
    });
  }

  return { items, any_failed: items.some((i) => i.status !== 'ok') };
}

/**
 * Helper pra match preview no UI — sem efeitos colaterais. Retorna
 * product encontrado OU NULL pra exibir badge "produto não encontrado"
 * antes do submit.
 */
export function resolveMaterialProduct(
  material: string,
  color: string,
  products: DebitContext['products'],
  product_groups: DebitContext['product_groups'],
): DebitContext['products'][number] | null {
  if (!material || !color) return null;
  const group = product_groups.find((g) => normalize(g.name) === normalize(material));
  const found = products.find((p) => {
    const pc = normalize(p.color);
    const targetColor = normalize(color);
    // Grupo resolvido: casa SÓ por group_id (evita homônimo de outro grupo).
    if (group) return p.group_id === group.id && pc === targetColor;
    const base = normalize(getBaseName(p.name));
    return base === normalize(material) && pc === targetColor;
  });
  return found || null;
}

/**
 * Acima do material, gera o número sequencial de OS via RPC ou Supabase.
 * Pra OS criadas direto (sem batch de gargalo).
 */
export async function generateServiceOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  // Usa timestamp pra evitar colisão sem precisar criar sequence. O
  // receipt_number sequencial (REC-YYYY-NNNNN) é gerado pelo trigger SQL
  // quando status='Concluído' — não precisa rodar agora.
  return `OS-${year}-${Date.now()}`;
}

/**
 * Upload da foto do recibo assinado pro bucket 'service-orders'.
 * Retorna a URL pública (signed URL, expira em 1 ano).
 */
export async function uploadSignedReceiptPhoto(
  serviceOrderId: string,
  file: File,
): Promise<{ url: string; path: string }> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${serviceOrderId}/signed-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('service-orders')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (upErr) throw new Error(`Falha ao enviar foto: ${upErr.message}`);

  const { data: signed, error: signErr } = await supabase.storage
    .from('service-orders')
    .createSignedUrl(path, 60 * 60 * 24 * 365); // 1 ano
  if (signErr || !signed?.signedUrl) {
    throw new Error(`Falha ao gerar link da foto: ${signErr?.message || 'sem URL'}`);
  }

  return { url: signed.signedUrl, path };
}

/**
 * Recebimento total de uma OS — CAMINHO ÚNICO.
 *
 * A regra de pagamento do negócio é "paga-se par BOM devolvido × preço", e ela
 * mora em `service_order_payable_amount` (SQL). Essa função só é honrada quando
 * existe linha em `service_order_returns`: sem retorno registrado, o CASE cai no
 * ELSE e a conta a pagar nasce por `total_value` — valor cheio, refugo ignorado.
 *
 * Por isso NINGUÉM deve fechar OS com `update({ status: 'received' })`. Havia
 * três escritores fazendo exatamente isso (fluxo de gargalos, tela na-rua e o
 * upload de foto assinada), cada um gerando um valor diferente para o mesmo
 * recebimento. Todos passam a chamar esta função.
 *
 * Aqui NÃO se mexe em status nem em accounts_payable: inserido o retorno, os
 * triggers fecham a OS quando o saldo zera, marcam 'Em Andamento' no parcial e
 * emitem a conta pelo total de pares bons.
 */
export async function receiveServiceOrderFully(
  serviceOrderId: string,
  opts?: { fallbackQuantity?: number; notes?: string },
): Promise<{ received: number; skipped: boolean }> {
  const { data: bal, error: balErr } = await (supabase as any)
    .from('v_service_order_balance')
    .select('qty_in_field')
    .eq('service_order_id', serviceOrderId)
    .maybeSingle();
  if (balErr) throw new Error(`Falha ao ler o saldo da OS: ${balErr.message}`);

  const inField = Math.max(0, Number(bal?.qty_in_field ?? opts?.fallbackQuantity ?? 0));
  // Nada na rua = já recebida. Não inserir retorno zerado (dispararia conta a
  // pagar de valor zero e sujaria o histórico).
  if (inField <= 0) return { received: 0, skipped: true };

  const { error } = await (supabase as any).from('service_order_returns').insert({
    service_order_id: serviceOrderId,
    qty_good: inField,
    qty_defect: 0,
    qty_loss: 0,
    contractor_id: null,
    defect_notes: opts?.notes ?? null,
  });
  if (error) throw new Error(`Falha ao registrar o recebimento: ${error.message}`);

  return { received: inField, skipped: false };
}
