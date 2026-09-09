// =============================================================================
// emit-nfe-devolucao — NF-e de devolução (entrada modelo 55, finalidade 4)
// =============================================================================
// Emite NF-e de entrada referenciando a NF de venda original. Usado quando a
// janela de 24h pra cancelar passou. Após autorizada:
//   - Incrementa products.quantity com os pares devolvidos
//   - Atualiza sale_order_items.qty_devolvida
//   - Cria stock_movement (tipo "Devolução cliente")
//   - Reduz proporcionalmente accounts_receivable (se ainda pendente)
//
// CFOPs de entrada por devolução:
//   1202: intra-estadual (NF original 5101/5102)
//   2202: inter-estadual (NF original 6101/6102)
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildClickNotasTechnicalProductName,
  ClickNotasProductPostDefinitelyRejectedError,
  ClickNotasProductClaimBusyError,
  ClickNotasProductIdentityConflictError,
  ClickNotasProductReconciliationRequiredError,
  provisionClickNotasProductIdentity,
  resolveClickNotasProductIdentity,
  type ClickNotasProductBeginPostResult,
  type ClickNotasProductClaimResult,
  type ClickNotasProductCompletionResult,
  type ClickNotasProductReconciliationResult,
} from "../_shared/clickNotasProductIdentity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const CLICKNOTAS_BASE = "https://api.clicknotas.com";

function gcHeaders() {
  const access = Deno.env.get("CLICKNOTAS_ACCESS_TOKEN");
  const secret = Deno.env.get("CLICKNOTAS_SECRET_TOKEN");
  if (!access || !secret) {
    throw new Error("Tokens CLICKNOTAS_ACCESS_TOKEN/CLICKNOTAS_SECRET_TOKEN não configurados.");
  }
  return {
    "Access-Token": access,
    "Secret-Access-Token": secret,
    "Content-Type": "application/json",
  };
}

async function gcFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${CLICKNOTAS_BASE}${path}`, {
    ...init,
    headers: { ...gcHeaders(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { mensagem: text }; }
  return { ok: res.ok, status: res.status, json };
}

// loja_id obrigatório segundo doc ClickNotas. Cache em memória do isolate.
let _gcLojaIdCache: string | null = null;
async function resolveGcLojaId(): Promise<string | null> {
  if (_gcLojaIdCache) return _gcLojaIdCache;
  try {
    const r = await gcFetch("/lojas");
    const list = Array.isArray(r.json?.data) ? r.json.data : [];
    if (list.length === 0) return null;
    const matriz = list.find((l: any) => l.matriz === 1 || l.matriz === "1" || l.matriz === true);
    const ativa = list.find((l: any) => l.situacao === 1 || l.situacao === "1" || l.situacao === true);
    const pick = matriz || ativa || list[0];
    _gcLojaIdCache = pick?.id ? String(pick.id) : null;
    return _gcLojaIdCache;
  } catch (e) {
    console.warn("[emit-nfe-devolucao] resolveGcLojaId falhou:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// Espelho da NF original → CFOP de entrada de devolução
function cfopDevolucao(cfopSaida: string): string {
  const c = String(cfopSaida || "").trim();
  // Saídas intra (5xxx) → entrada 1202
  if (c.startsWith("5")) {
    if (c === "5403" || c === "5405") return "1411"; // ST → entrada ST
    return "1202";
  }
  // Saídas inter (6xxx) → entrada 2202
  if (c.startsWith("6")) {
    if (c === "6403" || c === "6404") return "2411"; // ST inter → entrada ST inter
    return "2202";
  }
  return "1202"; // fallback intra
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claims.claims.sub as string;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const [rolesResult, profileResult] = await Promise.all([
      adminClient.from("user_roles").select("role").eq("user_id", userId),
      adminClient.from("profiles").select("approved").eq("id", userId).maybeSingle(),
    ]);
    if (rolesResult.error || profileResult.error) {
      return new Response(JSON.stringify({ error: "Access check failed" }), { status: 500, headers: corsHeaders });
    }
    const allowed = rolesResult.data?.some((r: { role: string }) => ["admin", "gerente", "nfe_operator"].includes(r.role));
    if (profileResult.data?.approved !== true || !allowed) {
      return new Response(JSON.stringify({ error: "Forbidden: apenas admin, gerente ou operador NF-e podem emitir devolução" }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const { nfe_original_id, itens, motivo, idempotency_key } = body as {
      nfe_original_id: string;
      itens: Array<{
        sale_order_item_id: string;
        qty: number;
        grade: Record<string, number>;
      }>;
      motivo: string;
      idempotency_key: string;
    };

    if (!nfe_original_id) {
      return new Response(JSON.stringify({ error: "nfe_original_id é obrigatório" }), { status: 400, headers: corsHeaders });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return new Response(JSON.stringify({ error: "Informe ao menos 1 item a devolver" }), { status: 400, headers: corsHeaders });
    }
    if (!motivo || motivo.trim().length < 15) {
      return new Response(JSON.stringify({ error: "Motivo deve ter ao menos 15 caracteres" }), { status: 400, headers: corsHeaders });
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(nfe_original_id)) {
      return new Response(JSON.stringify({ error: "nfe_original_id inválido" }), { status: 400, headers: corsHeaders });
    }
    if (!idempotency_key || !UUID_RE.test(idempotency_key)) {
      return new Response(JSON.stringify({ error: "idempotency_key inválido (deve ser UUID)" }), { status: 400, headers: corsHeaders });
    }
    const seenItemIds = new Set<string>();
    for (const it of itens) {
      if (!UUID_RE.test(it.sale_order_item_id) || !Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
        return new Response(JSON.stringify({ error: "Item inválido na lista de devolução" }), { status: 400, headers: corsHeaders });
      }
      if (seenItemIds.has(it.sale_order_item_id)) {
        return new Response(JSON.stringify({ error: "Item repetido na lista de devolução" }), { status: 400, headers: corsHeaders });
      }
      seenItemIds.add(it.sale_order_item_id);
      if (!it.grade || typeof it.grade !== "object" || Array.isArray(it.grade)) {
        return new Response(JSON.stringify({ error: "Informe a grade exata devolvida por numeração" }), { status: 400, headers: corsHeaders });
      }
      const gradeTotal = Object.entries(it.grade).reduce((sum, [size, qty]) => {
        if (size.startsWith("_")) return sum;
        const value = Number(qty);
        return Number.isInteger(value) && value >= 0 ? sum + value : Number.NaN;
      }, 0);
      if (!Number.isFinite(gradeTotal) || gradeTotal !== Number(it.qty)) {
        return new Response(JSON.stringify({ error: "A grade devolvida deve ter inteiros e somar a quantidade do item" }), { status: 400, headers: corsHeaders });
      }
    }

    // 1) NF original
    const { data: nfeOriginal, error: nfeErr } = await adminClient
      .from("nfe_emitidas").select("*").eq("id", nfe_original_id).single();
    if (nfeErr || !nfeOriginal) {
      return new Response(JSON.stringify({ error: "NF-e original não encontrada" }), { status: 404, headers: corsHeaders });
    }
    if (nfeOriginal.status !== "autorizada") {
      return new Response(JSON.stringify({ error: `NF-e original com status '${nfeOriginal.status}' — só NFs autorizadas podem ser devolvidas.` }), { status: 400, headers: corsHeaders });
    }
    if (!nfeOriginal.chave_acesso || nfeOriginal.chave_acesso.length !== 44) {
      return new Response(JSON.stringify({ error: "NF-e original sem chave de acesso (44 dígitos) — sincronize o status antes de devolver." }), { status: 400, headers: corsHeaders });
    }

    // 2) Sale order + cliente + items
    const { data: saleOrder } = await adminClient
      .from("sale_orders").select("*").eq("id", nfeOriginal.sale_order_id).maybeSingle();
    if (!saleOrder) {
      return new Response(JSON.stringify({ error: "Pedido vinculado à NF não encontrado" }), { status: 404, headers: corsHeaders });
    }

    let client: any = null;
    if (saleOrder.client_id) {
      const { data: c } = await adminClient.from("clients").select("*").eq("id", saleOrder.client_id).maybeSingle();
      client = c;
    }
    if (!client) {
      return new Response(JSON.stringify({ error: "Cliente do pedido não encontrado" }), { status: 404, headers: corsHeaders });
    }
    if (!client.gestaoclick_id) {
      return new Response(JSON.stringify({ error: "Cliente sem id no ClickNotas — emita a NF original primeiro pra sincronizar." }), { status: 400, headers: corsHeaders });
    }

    const itemIds = itens.map(i => i.sale_order_item_id);
    const { data: soItems } = await adminClient
      .from("sale_order_items")
      .select("*, technical_sheets(id, name, code, ncm, gestaoclick_id), products(id, name, sku, ncm, gestaoclick_id, active)")
      .eq("sale_order_id", nfeOriginal.sale_order_id)
      .in("id", itemIds);
    if (!soItems || soItems.length !== itens.length) {
      return new Response(JSON.stringify({ error: "Alguns itens informados não pertencem ao pedido" }), { status: 400, headers: corsHeaders });
    }

    // O payload persistido da NF original é a fonte mais forte para recuperar
    // o produto_id externo realmente usado naquela emissão. Para variantes, a
    // identidade é o par descrição+SKU do snapshot — nunca o cache compartilhado
    // da ficha técnica.
    const originalNfeProducts = Array.isArray(nfeOriginal.gc_request_payload?.produtos)
      ? nfeOriginal.gc_request_payload.produtos
      : [];

    // 3) Validação de saldo por item
    const itensFinal: any[] = [];
    for (const req of itens) {
      const item = soItems.find(i => i.id === req.sale_order_item_id);
      if (!item) continue;
      const qtyOriginal = Number(item.quantity || 0);
      const qtyDevolvida = Number(item.qty_devolvida || 0);
      const qtyAvail = qtyOriginal - qtyDevolvida;
      const qtyToReturn = Number(req.qty);
      if (qtyToReturn > qtyAvail) {
        return new Response(JSON.stringify({
          error: `Item ${item.technical_sheets?.code || item.id} — saldo de ${qtyAvail} pares; tentou devolver ${qtyToReturn}.`,
        }), { status: 400, headers: corsHeaders });
      }
      const rawSnapshot = item.material_variant_commercial_snapshot;
      const variant = rawSnapshot && typeof rawSnapshot === 'object' && !Array.isArray(rawSnapshot)
        ? rawSnapshot
        : null;
      const hasMaterialVariant = !!item.material_variant_id;
      const directProduct = item.product_id ? item.products : null;
      if (item.product_id && (!directProduct || directProduct.active !== true)) {
        return new Response(JSON.stringify({
          error: `Produto direto ${directProduct?.sku || item.product_id} ausente ou inativo; regularize o cadastro antes da devolução.`,
        }), { status: 409, headers: corsHeaders });
      }
      if (hasMaterialVariant && (
        !variant
        || String(variant.material_variant_id || '') !== String(item.material_variant_id)
        || !String(variant.description || '').trim()
        || !String(variant.sku || '').trim()
      )) {
        return new Response(JSON.stringify({
          error: `Item ${item.technical_sheets?.code || item.id} [item ${item.id}] sem snapshot comercial válido. Este é um bloqueio de integridade: acione a administração para diagnosticar o item no banco; a devolução não consultará o catálogo vivo nem inventará identidade histórica.`,
        }), { status: 400, headers: corsHeaders });
      }
      if (hasMaterialVariant && variant?.provenance?.historical_truth === 'unknown') {
        return new Response(JSON.stringify({
          error: `Item ${item.technical_sheets?.code || item.id} [item ${item.id}] tem identidade comercial legada ainda não comprovada. Comercial/Gerência deve validar SKU, NCM, descrição, cor e preço contra a NF/pedido original e chamar a RPC administrativa review_legacy_material_variant_commercial_snapshot com p_attested_identity: primeiro p_apply=false (preview), depois p_apply=true usando o mesmo p_expected_snapshot. O catálogo atual não será tratado como verdade histórica.`,
        }), { status: 409, headers: corsHeaders });
      }
      // Devolução usa exatamente o preço contratado do item original. Alterar
      // o override vivo da variante nunca reprecifica a operação histórica.
      const unitPrice = Number(item.unit_price ?? 0);
      const itemColor = String((hasMaterialVariant ? variant?.color : item.color) || item.color || '').trim();
      const baseName = item.technical_sheets?.name || directProduct?.name || '';
      const productName = String((
        hasMaterialVariant
          ? variant?.description
          : (itemColor ? `${baseName} - ${itemColor}` : baseName)
      ) || '').trim().slice(0, 120);
      const productCode = String(
        (hasMaterialVariant ? variant?.sku : (item.technical_sheets?.code || directProduct?.sku)) || ''
      ).trim();
      let technicalProductName = productName;
      if (hasMaterialVariant) {
        try {
          technicalProductName = buildClickNotasTechnicalProductName(productName, productCode);
        } catch (identityError) {
          return new Response(JSON.stringify({
            error: `Identidade ClickNotas inválida para "${productName}" / SKU "${productCode || '<vazio>'}": ${identityError instanceof Error ? identityError.message : String(identityError)}`,
          }), { status: 400, headers: corsHeaders });
        }
      }
      const normalizedProductName = productName.toUpperCase();
      const normalizedProductCode = productCode.toUpperCase();
      const originalIdentityMatches = originalNfeProducts.filter((product) => {
        const candidateName = String(product.nome_produto || product.nome || '')
          .trim().toUpperCase();
        const candidateCode = String(product.codigo_produto || product.codigo || '')
          .trim().toUpperCase();
        return candidateName === normalizedProductName
          && (!normalizedProductCode || candidateCode === normalizedProductCode);
      });
      const originalCodeMatches = normalizedProductCode
        ? originalNfeProducts.filter((product) =>
            String(product.codigo_produto || product.codigo || '').trim().toUpperCase()
              === normalizedProductCode
          )
        : [];
      const originalProduct = originalIdentityMatches[0]
        || (originalCodeMatches.length === 1 ? originalCodeMatches[0] : null);
      const originalGcProductId = originalProduct?.produto_id
        ? String(originalProduct.produto_id)
        : null;
      itensFinal.push({
        sale_order_item_id: item.id,
        reference_id: item.reference_id,
        product_id: item.product_id || null,
        material_variant_id: item.material_variant_id || null,
        stock_color: String(item.color || '').trim(),
        color: itemColor,
        ts_id: item.technical_sheets?.id || directProduct?.id,
        ts_code: item.technical_sheets?.code || directProduct?.sku,
        ts_name: item.technical_sheets?.name || directProduct?.name,
        ts_ncm: hasMaterialVariant ? variant?.ncm : (item.technical_sheets?.ncm || directProduct?.ncm),
        gc_product_id: hasMaterialVariant
          ? originalGcProductId
          : (originalGcProductId || directProduct?.gestaoclick_id || item.technical_sheets?.gestaoclick_id),
        product_code: productCode,
        product_name: productName,
        technical_product_name: technicalProductName,
        qty: qtyToReturn,
        grade: req.grade,
        valor_unit: unitPrice,
        valor_total: Number((qtyToReturn * unitPrice).toFixed(2)),
      });
    }

    if (itensFinal.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum item válido pra devolver" }), { status: 400, headers: corsHeaders });
    }

    // 4) Empresa emitente (mesma da NF original)
    let fiscal: any = null;
    if (nfeOriginal.company_id) {
      const { data: c } = await adminClient.from("companies").select("*").eq("id", nfeOriginal.company_id).maybeSingle();
      fiscal = c;
    }
    if (!fiscal) {
      const { data: c } = await adminClient.from("companies").select("*").eq("is_primary", true).eq("active", true).limit(1).maybeSingle();
      fiscal = c;
    }
    if (!fiscal) {
      return new Response(JSON.stringify({ error: "Empresa emitente não configurada" }), { status: 400, headers: corsHeaders });
    }

    // 5) NCM check
    const itemsMissingNcm = itensFinal.filter(it => !it.ts_ncm || !/^\d{8}$/.test(it.ts_ncm));
    if (itemsMissingNcm.length > 0) {
      return new Response(JSON.stringify({
        error: `Itens sem NCM válido: ${itemsMissingNcm.map(i => i.ts_code).join(", ")}`,
      }), { status: 400, headers: corsHeaders });
    }

    // Reclama saldo/grade e congela o intent antes de qualquer efeito no
    // ClickNotas. O mesmo request_id retoma exatamente o mesmo comando.
    const { data: beginResult, error: beginError } = await adminClient.rpc(
      "begin_nfe_devolucao_command" as never,
      {
        p_request_id: idempotency_key,
        p_nfe_original_id: nfe_original_id,
        p_items: itensFinal,
        p_motivo: motivo.trim(),
        p_actor_id: userId,
      },
    );
    if (beginError) {
      return new Response(JSON.stringify({ error: beginError.message }), { status: 409, headers: corsHeaders });
    }
    if (beginResult?.effects_applied || beginResult?.completed) {
      return new Response(JSON.stringify({
        success: true,
        idempotent_replay: true,
        devolucao: beginResult,
      }), { status: 200, headers: corsHeaders });
    }
    if (beginResult?.reconciliation_required) {
      return new Response(JSON.stringify({
        error: beginResult.reconciliation_reason || "Devolução exige reconciliação administrativa.",
        reconciliation_required: true,
        devolucao: beginResult,
      }), { status: 409, headers: corsHeaders });
    }
    if (beginResult?.provider_submission_state === "rejected") {
      return new Response(JSON.stringify({
        error: beginResult.error || "Devolução rejeitada anteriormente.",
        devolucao: beginResult,
      }), { status: 422, headers: corsHeaders });
    }

    // 6) Resolve produto ClickNotas pela identidade congelada. O nome técnico
    // incorpora o SKU porque o ClickNotas ignora `codigo` no cadastro e gera
    // um código interno. A linha fiscal mantém product_name sem esse sufixo.
    // Uma variante nunca grava technical_sheets.gestaoclick_id: esse cache é
    // compartilhado pela ficha e colidiria SOFT/MADRI ou cores diferentes.
    for (const it of itensFinal) {
      if (it.gc_product_id) continue;
      const identityKind = it.material_variant_id ? 'material_variant_sku' : 'technical_name';
      const identityValue = it.material_variant_id ? it.product_code : it.technical_product_name;
      const ownerToken = crypto.randomUUID();
      try {
        const provisioned = await provisionClickNotasProductIdentity({
          claim: async () => {
            const { data, error } = await adminClient.rpc('claim_clicknotas_product_identity', {
              p_identity_kind: identityKind,
              p_identity_value: identityValue,
              p_technical_name: it.technical_product_name,
              p_owner_token: ownerToken,
              p_correlation_id: `emit-nfe-devolucao:${nfeOriginal.id}:${it.sale_order_item_id}`,
              p_lease_seconds: 120,
            });
            if (error) throw new Error(`Falha ao adquirir claim ClickNotas: ${error.message}`);
            return data as ClickNotasProductClaimResult;
          },
          lookup: async (technicalName) => {
            const lookup = await gcFetch(`/produtos?nome=${encodeURIComponent(technicalName)}`);
            if (!lookup.ok || lookup.json?.status === 'error') {
              throw new Error(
                `Falha ao consultar identidade ClickNotas "${technicalName}": ${lookup.json?.data?.mensagem || lookup.json?.message || lookup.json?.mensagem || JSON.stringify(lookup.json)}`,
              );
            }
            const foundList = Array.isArray(lookup.json?.data) ? lookup.json.data : [];
            const resolution = resolveClickNotasProductIdentity(foundList, technicalName);
            if (resolution.kind === 'match' && resolution.product.id) {
              return { kind: 'match', providerId: String(resolution.product.id) };
            }
            if (resolution.kind === 'conflict' || resolution.kind === 'match') {
              return {
                kind: 'conflict',
                message: `Conflito de identidade no ClickNotas para "${technicalName}"; revise cadastros duplicados ou sem ID.`,
              };
            }
            return { kind: 'not_found' };
          },
          beginPost: async (leaseGeneration) => {
            const { data, error } = await adminClient.rpc('begin_clicknotas_product_post', {
              p_identity_kind: identityKind,
              p_identity_value: identityValue,
              p_owner_token: ownerToken,
              p_lease_generation: leaseGeneration,
            });
            if (error) throw new Error(`Falha ao registrar início do POST ClickNotas: ${error.message}`);
            return data as ClickNotasProductBeginPostResult;
          },
          create: async (technicalName) => {
            const r = await gcFetch("/produtos", {
              method: "POST",
              body: JSON.stringify({
                nome: technicalName,
                codigo: it.product_code || `ITEM-${it.ts_id}`,
                valor_venda: it.valor_unit.toFixed(2),
                unidade: "PAR",
                ncm: it.ts_ncm,
                tipo: "P",
              }),
            });
            if (!r.ok || r.json?.status === "error") {
              if (r.status === 429) {
                throw new ClickNotasProductPostDefinitelyRejectedError(
                  `ClickNotas recusou por limite de requisições sem processar o produto "${technicalName}".`,
                );
              }
              throw new Error(
                `Falha ao sincronizar produto ${it.ts_code} com ClickNotas: ${r.json?.message || JSON.stringify(r.json)}`,
              );
            }
            const providerId = String(r.json?.data?.id || '').trim();
            if (!providerId) throw new Error('ClickNotas criou produto sem retornar ID.');
            return { providerId };
          },
          complete: async (leaseGeneration, providerId) => {
            const { data, error } = await adminClient.rpc('complete_clicknotas_product_identity', {
              p_identity_kind: identityKind,
              p_identity_value: identityValue,
              p_owner_token: ownerToken,
              p_lease_generation: leaseGeneration,
              p_provider_id: providerId,
            });
            if (error) throw new Error(`Falha ao concluir claim ClickNotas: ${error.message}`);
            return data as ClickNotasProductCompletionResult;
          },
          recordOutcome: async (leaseGeneration, outcome, errorMessage, retrySeconds) => {
            const { error } = await adminClient.rpc('record_clicknotas_product_identity_outcome', {
              p_identity_kind: identityKind,
              p_identity_value: identityValue,
              p_owner_token: ownerToken,
              p_lease_generation: leaseGeneration,
              p_outcome: outcome,
              p_error: errorMessage,
              p_retry_seconds: retrySeconds,
            });
            if (error) throw error;
          },
          reconcile: async (observation, providerId, errorMessage) => {
            const { data, error } = await adminClient.rpc('reconcile_clicknotas_product_identity', {
              p_identity_kind: identityKind,
              p_identity_value: identityValue,
              p_observation: observation,
              p_provider_id: providerId,
              p_error: errorMessage,
              p_correlation_id: `emit-nfe-devolucao:${nfeOriginal.id}:${it.sale_order_item_id}`,
            });
            if (error) throw new Error(`Falha ao reconciliar identidade ClickNotas: ${error.message}`);
            return data as ClickNotasProductReconciliationResult;
          },
        });
        it.gc_product_id = provisioned.providerId;
      } catch (identityError) {
        const status = identityError instanceof ClickNotasProductClaimBusyError
          || identityError instanceof ClickNotasProductIdentityConflictError
          || identityError instanceof ClickNotasProductReconciliationRequiredError
          ? 409
          : 502;
        const message = identityError instanceof Error ? identityError.message : String(identityError);
        const { data: abortResult, error: abortError } = await adminClient.rpc(
          "abort_nfe_devolucao_before_provider" as never,
          {
            p_request_id: idempotency_key,
            p_reason: `Falha antes da criação da NF fiscal: ${message}`.slice(0, 1000),
          },
        );
        if (abortError) {
          return new Response(JSON.stringify({
            error: `${message} A liberação da intenção fiscal falhou: ${abortError.message}`,
            reconciliation_required: true,
          }), { status: 409, headers: corsHeaders });
        }
        return new Response(JSON.stringify({
          error: message,
          terminal_rejected: true,
          devolucao: abortResult,
        }), { status, headers: corsHeaders });
      }
      if (!it.material_variant_id && it.product_id) {
        await adminClient.from("products")
          .update({ gestaoclick_id: it.gc_product_id })
          .eq("id", it.product_id);
      } else if (!it.material_variant_id && it.ts_id) {
        await adminClient.from("technical_sheets")
          .update({ gestaoclick_id: it.gc_product_id })
          .eq("id", it.ts_id);
      }
    }

    // 7) Payload ClickNotas — NF de entrada por devolução
    const cfopOriginal = String(fiscal.cfop || "5102");
    const cfopEntrada = cfopDevolucao(cfopOriginal);
    const valorTotal = Number(itensFinal.reduce((s, it) => s + it.valor_total, 0).toFixed(2));

    // Auditoria A13: peso/volumes em devolução. Antes assumia volume=1 hardcoded
    // sem peso → XML inconsistente (1 volume pra centenas de pares). Calcula
    // via RPC; fallback 0.5 kg/par se ficha não tem weight_per_pair_kg.
    let pesoBrutoStr: string | undefined;
    let pesoLiquidoStr: string | undefined;
    const totalPairsDev = itensFinal.reduce((s, it) => s + Number(it.qty || 0), 0);
    try {
      // Calcula peso real: SUM(qty × weight_per_pair_kg) por item da devolução.
      // Não pode usar calculate_sale_order_weight direto porque devolução pode
      // ser parcial (subset dos itens do PV original).
      const itemRefIds = [...new Set(itensFinal.map(it => it.reference_id).filter(Boolean))];
      if (itemRefIds.length > 0) {
        const { data: weights } = await adminClient
          .from("technical_sheets")
          .select("id, weight_per_pair_kg, box_weight_kg")
          .in("id", itemRefIds);
        const weightById = new Map<string, { wpp: number; box: number }>();
        for (const w of (weights || []) as any[]) {
          weightById.set(w.id, {
            wpp: Number(w.weight_per_pair_kg) || 0,
            box: Number(w.box_weight_kg) || 0,
          });
        }
        let netKg = 0;
        let grossKg = 0;
        for (const it of itensFinal) {
          const w = weightById.get(it.reference_id);
          const wpp = w?.wpp || 0;
          const box = w?.box || 0;
          netKg += wpp * it.qty;
          grossKg += (wpp + box) * it.qty;
        }
        if (netKg > 0) pesoLiquidoStr = netKg.toFixed(3);
        if (grossKg > 0) pesoBrutoStr = grossKg.toFixed(3);
      }
    } catch (e) {
      console.warn("[emit-nfe-devolucao] Falha calc peso:", e instanceof Error ? e.message : String(e));
    }
    // Fallback 0.5 kg/par quando fichas não têm peso cadastrado
    if ((!pesoBrutoStr || !pesoLiquidoStr) && totalPairsDev > 0) {
      const fb = (totalPairsDev * 0.5).toFixed(3);
      if (!pesoLiquidoStr) pesoLiquidoStr = fb;
      if (!pesoBrutoStr) pesoBrutoStr = fb;
    }
    // Volumes = caixas. Como devolução pode ser de múltiplos solados, usa
    // CEIL(totalPairs/12) como aproximação razoável (default pares/caixa).
    const qtdVolumes = totalPairsDev > 0 ? Math.max(1, Math.ceil(totalPairsDev / 12)) : 1;
    const transporteBlockDev = {
      modalidade_frete: "9",
      volumes: [{
        quantidade: String(qtdVolumes),
        especie: "VOLUME",
        ...(pesoLiquidoStr ? { peso_liquido: pesoLiquidoStr } : {}),
        ...(pesoBrutoStr ? { peso_bruto: pesoBrutoStr } : {}),
      }],
    };

    const ref = `nfe-dev-${idempotency_key}`;
    // Configuração explícita pedida pelo user em 15/05/2026:
    //   - Natureza: "Devolução de venda de produção do estabelecimento"
    //   - Forma de emissão (tipo_emissao): "1" = normal
    //   - Finalidade (finalidade_nf): "4" = devolução de mercadoria
    //   - Consumidor final: "0" = não
    //   - Tipo de atendimento (indicador_presenca): "9" = operação não presencial, outros
    // Sem isso o GC defaultava algumas pra valores diferentes do exigido pela contabilidade.
    // loja_id (obrigatório na doc ClickNotas). Quando null, GC usa matriz.
    const gcLojaId = await resolveGcLojaId();

    const nfePayload: any = {
      tipo_nf: 0, // 0 = entrada (devolução). Doc da API exige int.
      ...(gcLojaId ? { loja_id: Number(gcLojaId) } : {}),
      finalidade_nf: "4", // 4 = devolução de mercadoria
      tipo_emissao: "1", // 1 = emissão normal
      natureza_operacao: "Devolução de venda de produção do estabelecimento",
      id_destinatario: client.gestaoclick_id,
      codigo_cfop: cfopEntrada,
      modelo: "55",
      serie: fiscal.serie_nfe || "1",
      consumidor_final: "0", // 0 = não
      tipo_atendimento: "9", // 9 = operação não presencial, outros
      chave_referenciada: nfeOriginal.chave_acesso,
      informacoes_complementares: `Devolução referente à NF ${nfeOriginal.numero || nfeOriginal.chave_acesso}. Motivo: ${motivo.trim()}`,
      produtos: itensFinal.map(it => ({
        produto_id: it.gc_product_id,
        ...(it.product_code ? { codigo_produto: it.product_code } : {}),
        nome_produto: it.product_name,
        quantidade: it.qty.toFixed(2),
        // valor_venda é o preço UNITÁRIO — o ClickNotas multiplica por
        // quantidade internamente. Mandar o total da linha aqui fazia o
        // valor sair qtd² × preço (mesmo bug já corrigido no emit-nfe).
        valor_venda: it.valor_unit.toFixed(2),
        cfop: cfopEntrada,
        unidade: "PAR",
        NCM: it.ts_ncm,
        tipo: "P",
      })),
      transporte: transporteBlockDev,
    };

    // 8) O banco reclama de forma durável a única criação externa permitida.
    // Em timeout de POST, não repetimos: a NF pode existir no ClickNotas mesmo
    // sem a resposta ter chegado ao Edge.
    const { data: claimResult, error: claimError } = await adminClient.rpc(
      "claim_nfe_devolucao_provider_submission" as never,
      { p_request_id: idempotency_key, p_provider_payload: nfePayload },
    );
    if (claimError) {
      return new Response(JSON.stringify({ error: claimError.message }), { status: 409, headers: corsHeaders });
    }
    if (claimResult?.completed) {
      return new Response(JSON.stringify({
        success: true,
        idempotent_replay: true,
        devolucao: claimResult,
      }), { status: 200, headers: corsHeaders });
    }
    if (claimResult?.rejected) {
      return new Response(JSON.stringify({
        success: false,
        error: claimResult.error || "Devolução rejeitada anteriormente.",
        devolucao: claimResult,
      }), { status: 422, headers: corsHeaders });
    }
    if (claimResult?.reconciliation_required) {
      return new Response(JSON.stringify({
        success: false,
        error: claimResult.reconciliation_reason || "Devolução exige reconciliação administrativa.",
        reconciliation_required: true,
        devolucao: claimResult,
      }), { status: 409, headers: corsHeaders });
    }

    let gcNfeId = String(claimResult?.provider_nfe_id || "").trim();
    let createResponseJson: unknown = null;
    const immutableProviderPayload = claimResult?.provider_request_payload || nfePayload;

    if (claimResult?.provider_call_required) {
      let createResp: Awaited<ReturnType<typeof gcFetch>>;
      try {
        createResp = await gcFetch("/notas_fiscais_produtos", {
          method: "POST",
          body: JSON.stringify(immutableProviderPayload),
        });
      } catch (providerError) {
        const reason = `Resposta do POST de criação não chegou; localizar a referência ${ref} no ClickNotas antes de repetir: ${providerError instanceof Error ? providerError.message : String(providerError)}`;
        await adminClient.rpc("mark_nfe_devolucao_reconciliation_required" as never, {
          p_request_id: idempotency_key,
          p_reason: reason,
        });
        return new Response(JSON.stringify({
          success: false,
          error: reason,
          reconciliation_required: true,
        }), { status: 409, headers: corsHeaders });
      }

      createResponseJson = createResp.json;
      const createData = createResp.json?.data;
      const rawProviderId = typeof createData?.dados === "object"
        ? createData?.dados?.id
        : createData?.dados;
      gcNfeId = String(rawProviderId || createData?.id || "").trim();
      const providerReportedError = createResp.json?.status === "error"
        || createResp.json?.data?.ok === false;

      if (!createResp.ok || providerReportedError || !gcNfeId) {
        const msg = String(
          createResp.json?.data?.mensagem
          || createResp.json?.message
          || createResp.json?.mensagem
          || JSON.stringify(createResp.json),
        ).slice(0, 900);
        // 408/409/429 e 5xx são ambíguos: o provedor pode ter criado a NF.
        // Demais 4xx e erro de negócio 2xx são rejeições explícitas sem ID.
        const definitelyRejected = !gcNfeId && (
          providerReportedError && createResp.ok
          || (createResp.status >= 400 && createResp.status < 500
            && ![408, 409, 429].includes(createResp.status))
        );
        if (definitelyRejected) {
          const { data: abortResult, error: abortError } = await adminClient.rpc(
            "abort_nfe_devolucao_before_provider" as never,
            { p_request_id: idempotency_key, p_reason: `Cadastro recusado: ${msg}` },
          );
          if (abortError) {
            return new Response(JSON.stringify({ error: abortError.message }), { status: 409, headers: corsHeaders });
          }
          return new Response(JSON.stringify({
            success: false,
            error: `Falha ao cadastrar devolução: ${msg}`,
            devolucao: abortResult,
            provider_response: { create: createResp.json },
          }), { status: 422, headers: corsHeaders });
        }

        const reason = `Criação externa teve resultado ambíguo (HTTP ${createResp.status}); localizar a referência ${ref} no ClickNotas antes de repetir: ${msg}`;
        await adminClient.rpc("mark_nfe_devolucao_reconciliation_required" as never, {
          p_request_id: idempotency_key,
          p_reason: reason,
        });
        return new Response(JSON.stringify({
          success: false,
          error: reason,
          reconciliation_required: true,
          provider_response: { create: createResp.json },
        }), { status: 409, headers: corsHeaders });
      }

      const { error: recordCreationError } = await adminClient.rpc(
        "record_nfe_devolucao_provider_creation" as never,
        {
          p_request_id: idempotency_key,
          p_provider_nfe_id: gcNfeId,
          p_provider_response: createResp.json,
        },
      );
      if (recordCreationError) {
        const reason = `NF ${gcNfeId} foi criada no ClickNotas, mas o ID não pôde ser confirmado localmente: ${recordCreationError.message}`;
        await adminClient.rpc("mark_nfe_devolucao_reconciliation_required" as never, {
          p_request_id: idempotency_key,
          p_reason: reason,
        });
        return new Response(JSON.stringify({
          success: false,
          error: reason,
          reconciliation_required: true,
          provider_nfe_id: gcNfeId,
        }), { status: 409, headers: corsHeaders });
      }
    }

    if (!gcNfeId) {
      return new Response(JSON.stringify({
        error: "O comando não possui ID persistido da NF no ClickNotas.",
        reconciliation_required: true,
      }), { status: 409, headers: corsHeaders });
    }

    // 9) A partir daqui toda retomada atua sobre a MESMA NF externa. O detalhe
    // é a fonte de verdade; /emitir é apenas um disparo best-effort desse ID.
    let detailResponseJson: unknown = null;
    let emitResponseJson: unknown = null;
    let chave = "";
    let protocolo = "";
    let situacao = "";
    let numero = "";
    let serie = fiscal.serie_nfe ? String(fiscal.serie_nfe) : "1";
    let dataEmissao: string | null = null;
    let motivoRejeicao = "";

    const readProviderDetail = async () => {
      const detail = await gcFetch(`/notas_fiscais_produtos/${gcNfeId}`);
      if (!detail.ok || detail.json?.status === "error") {
        throw new Error(
          detail.json?.data?.mensagem
          || detail.json?.message
          || `HTTP ${detail.status} ao consultar a NF`,
        );
      }
      detailResponseJson = detail.json;
      const d = detail.json?.data || {};
      chave = String(d.chave || chave || "").trim();
      protocolo = String(d.protocolo || protocolo || "").trim();
      situacao = String(d.situacao_nf || situacao || "").trim();
      numero = d.numero_nf ? String(d.numero_nf) : numero;
      serie = d.serie ? String(d.serie) : serie;
      motivoRejeicao = String(d.motivo_rejeicao_sefaz || d.motivo_rejeicao || motivoRejeicao || "").trim();
      if (d.data_emissao) {
        const raw = d.hora_emissao
          ? `${d.data_emissao}T${d.hora_emissao}`
          : String(d.data_emissao);
        const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}-03:00`;
        const timestamp = new Date(normalized).getTime();
        if (!Number.isNaN(timestamp) && timestamp > 0) {
          dataEmissao = new Date(timestamp).toISOString();
        }
      }
    };
    const providerStatus = () => {
      const normalized = situacao.toLowerCase();
      if (
        motivoRejeicao
        || normalized.includes("reprovada")
        || normalized.includes("rejeitada")
        || normalized.includes("denegada")
        || normalized.includes("cancelada")
        || normalized.includes("erro")
      ) return "rejeitada";
      if (
        chave.length === 44
        || normalized.includes("aprovada")
        || normalized.includes("autorizada")
        || normalized.includes("corrigida")
      ) return "autorizada";
      return "processando";
    };

    let detailError: string | null = null;
    try {
      await readProviderDetail();
    } catch (error) {
      detailError = error instanceof Error ? error.message : String(error);
    }

    if (providerStatus() === "processando") {
      try {
        const emitResp = await gcFetch(`/notas_fiscais_produtos/emitir/${gcNfeId}`, { method: "POST" });
        emitResponseJson = emitResp.json;
      } catch (error) {
        emitResponseJson = { error: error instanceof Error ? error.message : String(error) };
      }
      // Autorização pode levar alguns segundos; nunca inferimos sucesso pelo
      // HTTP do disparo. Poll curto e seguro sobre o mesmo objeto externo.
      for (let attempt = 0; attempt < 4 && providerStatus() === "processando"; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          await readProviderDetail();
          detailError = null;
        } catch (error) {
          detailError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    const finalStatus = providerStatus();
    if (detailError && !detailResponseJson) {
      return new Response(JSON.stringify({
        success: false,
        pending: true,
        error: `NF ${gcNfeId} já criada; não foi possível consultar o status agora: ${detailError}`,
        provider_nfe_id: gcNfeId,
      }), { status: 202, headers: corsHeaders });
    }

    const providerResultPayload = {
      create: createResponseJson,
      emit: emitResponseJson,
      detail: detailResponseJson,
    };
    const { data: recordedResult, error: recordResultError } = await adminClient.rpc(
      "record_nfe_devolucao_provider_result" as never,
      {
        p_request_id: idempotency_key,
        p_provider_nfe_id: gcNfeId,
        p_provider_status: finalStatus,
        p_chave_acesso: chave || null,
        p_protocolo: protocolo || null,
        p_numero: numero || null,
        p_serie: serie || null,
        p_data_emissao: dataEmissao,
        p_error: finalStatus === "rejeitada"
          ? (motivoRejeicao || situacao || "Rejeitada pelo provedor")
          : null,
        p_provider_response: providerResultPayload,
      },
    );
    if (recordResultError) {
      return new Response(JSON.stringify({ error: recordResultError.message }), { status: 409, headers: corsHeaders });
    }
    if (recordedResult?.reconciliation_required) {
      return new Response(JSON.stringify({
        success: false,
        error: recordedResult.reconciliation_reason || "Devolução exige reconciliação administrativa.",
        reconciliation_required: true,
        devolucao: recordedResult,
      }), { status: 409, headers: corsHeaders });
    }
    if (finalStatus === "rejeitada") {
      return new Response(JSON.stringify({
        success: false,
        error: motivoRejeicao || situacao || "NF-e de devolução rejeitada pelo provedor.",
        devolucao: recordedResult,
        provider_response: providerResultPayload,
      }), { status: 422, headers: corsHeaders });
    }
    if (finalStatus === "processando") {
      return new Response(JSON.stringify({
        success: false,
        pending: true,
        devolucao: recordedResult,
        provider_response: providerResultPayload,
      }), { status: 202, headers: corsHeaders });
    }

    // 10) Um único commit local atômico: grade/estoque, qty devolvida,
    // contas a receber e estorno contábil. Qualquer falha reverte tudo.
    const { data: completion, error: completionError } = await adminClient.rpc(
      "complete_nfe_devolucao_command" as never,
      { p_request_id: idempotency_key },
    );
    if (completionError) {
      return new Response(JSON.stringify({ error: completionError.message }), { status: 409, headers: corsHeaders });
    }
    if (completion?.reconciliation_required) {
      return new Response(JSON.stringify({
        success: false,
        error: completion.reconciliation_reason || "NF autorizada, mas os efeitos locais exigem reconciliação.",
        reconciliation_required: true,
        devolucao: completion,
      }), { status: 409, headers: corsHeaders });
    }
    return new Response(JSON.stringify({
      success: true,
      devolucao: completion,
      provider_response: providerResultPayload,
    }), { status: 200, headers: corsHeaders });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("emit-nfe-devolucao error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
