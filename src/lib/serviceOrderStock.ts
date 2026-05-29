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
  status: 'ok' | 'product_not_found' | 'rpc_failed';
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
    if (!mat.material || !mat.color || !(mat.meters > 0)) continue;
    let product = mat.product_id ? ctx.products.find((p) => p.id === mat.product_id) : undefined;

    if (!product) {
      const group = ctx.product_groups.find((g) => normalize(g.name) === normalize(mat.material));
      product = ctx.products.find((p) => {
        const pc = normalize(p.color);
        const targetColor = normalize(mat.color);
        if (group && p.group_id === group.id) return pc === targetColor;
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
    const newQty = Math.max(0, prevQty - mat.meters);
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
    if (group && p.group_id === group.id) return pc === targetColor;
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
 * Resolve um URL de exibição pra signed_photo_url. Aceita 3 formatos
 * (legacy + atual):
 *   - URL completa de signed URL (gerado por uploadSignedReceiptPhoto) → reusa
 *   - URL completa de /public/ → recria signed (bucket foi privatizado)
 *   - path puro (legacy do dialog inline) → gera signed
 *
 * Auditoria 28/05/2026: antes Contractors.tsx construía manualmente
 * `${VITE_SUPABASE_URL}/storage/v1/object/public/service-orders/${path}`
 * mas o bucket é privado → toda foto retornava 400. Centraliza aqui.
 */
export async function resolveSignedReceiptDisplayUrl(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;

  // Já é signed URL → reusa
  if (stored.includes('/object/sign/')) return stored;

  // Extrair path: se for URL /public/ ou /sign/, pegar o segmento depois
  // de /service-orders/. Se for path puro, usar como está.
  let path = stored;
  const m = stored.match(/\/service-orders\/(.+?)(?:\?|$)/);
  if (m) path = m[1];

  const { data: signed, error } = await supabase.storage
    .from('service-orders')
    .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 dias pra preview
  if (error || !signed?.signedUrl) return null;
  return signed.signedUrl;
}
