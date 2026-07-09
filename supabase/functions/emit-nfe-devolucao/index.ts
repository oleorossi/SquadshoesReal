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
    const { data: roles, error: rolesErr } = await adminClient
      .from("user_roles").select("role").eq("user_id", userId);
    if (rolesErr) {
      return new Response(JSON.stringify({ error: "Role check failed" }), { status: 500, headers: corsHeaders });
    }
    const allowed = roles?.some((r: { role: string }) => ["admin", "gerente", "nfe_operator"].includes(r.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden: apenas admin, gerente ou operador NF-e podem emitir devolução" }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const { nfe_original_id, itens, motivo, idempotency_key } = body as {
      nfe_original_id: string;
      itens: Array<{ sale_order_item_id: string; qty: number }>;
      motivo: string;
      idempotency_key?: string;
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
    if (idempotency_key && !UUID_RE.test(idempotency_key)) {
      return new Response(JSON.stringify({ error: "idempotency_key inválido (deve ser UUID)" }), { status: 400, headers: corsHeaders });
    }
    for (const it of itens) {
      if (!UUID_RE.test(it.sale_order_item_id) || !Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
        return new Response(JSON.stringify({ error: "Item inválido na lista de devolução" }), { status: 400, headers: corsHeaders });
      }
    }

    // Auditoria A2: se idempotency_key foi passado, checa se devolução com
    // essa chave já existe. Bloqueia retry duplicado (clique 2x, retry de
    // network, etc) — antes criava 2 nfe_devolucoes + 2× redução de AR.
    if (idempotency_key) {
      const { data: existingDev } = await adminClient
        .from("nfe_devolucoes")
        .select("id, status, provider_nfe_id, chave_acesso, numero")
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();
      if (existingDev) {
        return new Response(JSON.stringify({
          success: existingDev.status === "autorizada",
          devolucao: existingDev,
          idempotent_replay: true,
          message: "Devolução já processada anteriormente (idempotency_key idêntico). Retornando resultado existente.",
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
      .select("*, technical_sheets(id, name, code, ncm, gestaoclick_id), reference_material_variants(sku, ncm, description_override, unit_price_override)")
      .in("id", itemIds);
    if (!soItems || soItems.length !== itens.length) {
      return new Response(JSON.stringify({ error: "Alguns itens informados não pertencem ao pedido" }), { status: 400, headers: corsHeaders });
    }

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
      const variant = item.reference_material_variants;
      const unitPrice = Number(variant?.unit_price_override ?? item.unit_price ?? 0);
      itensFinal.push({
        sale_order_item_id: item.id,
        reference_id: item.reference_id,
        color: item.color,
        ts_id: item.technical_sheets?.id,
        ts_code: item.technical_sheets?.code,
        ts_name: item.technical_sheets?.name,
        ts_ncm: variant?.ncm || item.technical_sheets?.ncm,
        ts_gc_id: item.technical_sheets?.gestaoclick_id,
        variant_sku: variant?.sku,
        variant_desc: variant?.description_override,
        qty: qtyToReturn,
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

    // 6) Sync produtos no ClickNotas (caso falte)
    for (const it of itensFinal) {
      if (it.ts_gc_id) continue;
      const desc = (it.variant_desc || (it.color ? `${it.ts_name} - ${it.color}` : it.ts_name)).trim();
      const r = await gcFetch("/produtos", {
        method: "POST",
        body: JSON.stringify({
          nome: desc.slice(0, 120),
          codigo: it.variant_sku || it.ts_code || `ITEM-${it.ts_id}`,
          valor_venda: it.valor_unit.toFixed(2),
          unidade: "PAR",
          ncm: it.ts_ncm,
          tipo: "P",
        }),
      });
      if (!r.ok || r.json?.status === "error") {
        return new Response(JSON.stringify({
          error: `Falha ao sincronizar produto ${it.ts_code} com ClickNotas: ${r.json?.message || JSON.stringify(r.json)}`,
        }), { status: 502, headers: corsHeaders });
      }
      it.ts_gc_id = String(r.json?.data?.id);
      if (it.ts_id) await adminClient.from("technical_sheets").update({ gestaoclick_id: it.ts_gc_id }).eq("id", it.ts_id);
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

    const ref = `nfe-dev-${nfe_original_id}-${Date.now()}`;
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
        produto_id: it.ts_gc_id,
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

    // 8) Grava rascunho local com status processando.
    // Auditoria A2: persiste idempotency_key recebido pra bloquear retries
    // duplicados (índice unique uq_nfe_devolucoes_idempotency_key).
    const devolucaoRecord: any = {
      nfe_original_id,
      sale_order_id: nfeOriginal.sale_order_id,
      status: "processando",
      ref_nfe: ref,
      valor_total: valorTotal,
      itens: itensFinal,
      motivo: motivo.trim(),
      cnpj_emitente: nfeOriginal.cnpj_emitente,
      company_id: fiscal.id,
      created_by: userId,
      ...(idempotency_key ? { idempotency_key } : {}),
    };
    const { data: devLocal, error: devLocalErr } = await adminClient
      .from("nfe_devolucoes").insert(devolucaoRecord).select().single();
    if (devLocalErr) {
      return new Response(JSON.stringify({ error: `Falha ao gravar devolução local: ${devLocalErr.message}` }), { status: 500, headers: corsHeaders });
    }

    // 9) POST cadastro NF
    const createResp = await gcFetch("/notas_fiscais_produtos", {
      method: "POST",
      body: JSON.stringify(nfePayload),
    });
    if (!createResp.ok || createResp.json?.status === "error" || createResp.json?.data?.ok === false) {
      const msg = createResp.json?.data?.mensagem || createResp.json?.message || JSON.stringify(createResp.json);
      await adminClient.from("nfe_devolucoes")
        .update({ status: "rejeitada", motivo_rejeicao: `Cadastro: ${msg}`, updated_at: new Date().toISOString() })
        .eq("id", devLocal.id);
      return new Response(JSON.stringify({ error: `Falha ao cadastrar devolução: ${msg}` }), { status: 422, headers: corsHeaders });
    }
    const gcNfeId = String(createResp.json?.data?.dados || createResp.json?.data?.id);

    // 10) Emite
    const emitResp = await gcFetch(`/notas_fiscais_produtos/emitir/${gcNfeId}`, { method: "POST" });
    const emitOk = emitResp.ok && emitResp.json?.data?.ok !== false && emitResp.json?.status !== "error";

    let chave = "";
    let protocolo = "";
    let situacao = "";
    let numero = "";
    let dataEmissao = "";
    if (emitOk) {
      const detail = await gcFetch(`/notas_fiscais_produtos/${gcNfeId}`);
      const d = detail.json?.data || {};
      chave = d.chave || "";
      protocolo = d.protocolo || "";
      situacao = d.situacao_nf || "";
      numero = d.numero_nf ? String(d.numero_nf) : "";
      if (d.data_emissao) {
        const time = d.hora_emissao ? `${d.data_emissao}T${d.hora_emissao}-03:00` : d.data_emissao;
        const t = new Date(time).getTime();
        if (!Number.isNaN(t)) dataEmissao = new Date(t).toISOString();
      }
    }
    const finalStatus = emitOk
      ? (situacao?.toLowerCase().includes("aprovada") ? "autorizada" : "processando")
      : "rejeitada";

    const emitMsg = emitResp.json?.data?.mensagem || emitResp.json?.message || "";

    // 11) Atualiza registro local
    const updatePayload: any = {
      status: finalStatus,
      provider_nfe_id: gcNfeId,
      chave_acesso: chave || null,
      protocolo: protocolo || null,
      numero: numero || null,
      serie: fiscal.serie_nfe ? String(fiscal.serie_nfe) : "1",
      data_emissao: dataEmissao || null,
      motivo_rejeicao: emitOk ? null : emitMsg,
      updated_at: new Date().toISOString(),
    };
    await adminClient.from("nfe_devolucoes").update(updatePayload).eq("id", devLocal.id);

    // 12) Se autorizada: estoque + qty_devolvida + AR proporcional
    const cleanupWarnings: string[] = [];
    if (finalStatus === "autorizada") {
      // 12a) Incrementa qty_devolvida em sale_order_items
      for (const it of itensFinal) {
        const { error: e } = await adminClient.rpc("increment_qty_devolvida" as any, {
          p_item_id: it.sale_order_item_id,
          p_qty: it.qty,
        });
        if (e) {
          // Fallback: update direto se RPC não existe
          const { data: cur } = await adminClient
            .from("sale_order_items").select("qty_devolvida").eq("id", it.sale_order_item_id).single();
          const novoTotal = Number(cur?.qty_devolvida || 0) + Number(it.qty);
          await adminClient.from("sale_order_items")
            .update({ qty_devolvida: novoTotal }).eq("id", it.sale_order_item_id);
        }
      }

      // 12b) Stock movement de entrada + restaura products.quantity
      // FIX C3: antes só inseria stock_movement com product_id=null — mercadoria
      // voltava fisicamente mas estoque ficava subdimensionado. Agora faz lookup
      // por (reference_id, color) e atualiza products.quantity quando achar.
      try {
        for (const it of itensFinal) {
          // Lookup do product representando (ref, color)
          let productId: string | null = null;
          let prevQty = 0;
          if (it.reference_id) {
            const { data: prodRow } = await adminClient
              .from("products")
              .select("id, quantity")
              .eq("reference_id", it.reference_id)
              .eq("color", it.color || "")
              .eq("active", true)
              .limit(1)
              .maybeSingle();
            if (prodRow) {
              productId = prodRow.id;
              prevQty = Number(prodRow.quantity || 0);
              const newQty = prevQty + Number(it.qty);
              const { error: updErr } = await adminClient.from("products")
                .update({ quantity: newQty, updated_at: new Date().toISOString() })
                .eq("id", productId);
              if (updErr) cleanupWarnings.push(`products.quantity não atualizado (${it.reference_id}/${it.color}): ${updErr.message}`);
            } else {
              cleanupWarnings.push(`Produto (ref ${it.reference_id}, cor ${it.color || '—'}) não encontrado — devolução registrada sem update de estoque.`);
            }
          }

          await adminClient.from("stock_movements").insert({
            movement_type: "in",
            type: "Devolução cliente",
            product_id: productId,
            reference_id: it.reference_id,
            color: it.color,
            quantity: it.qty,
            previous_stock: prevQty,
            new_stock: prevQty + Number(it.qty),
            sale_order_id: nfeOriginal.sale_order_id,
            description: `NF devolução ${chave || gcNfeId} — motivo: ${motivo.trim()}`,
            notes: `NF devolução ${chave || gcNfeId} — motivo: ${motivo.trim()}`,
            created_by: userId,
          } as any);
        }
      } catch (e: any) {
        cleanupWarnings.push(`Stock movement não criado: ${e.message}`);
      }

      // 12c) Reduz accounts_receivable proporcional ao valor devolvido
      try {
        const { data: arList } = await adminClient
          .from("accounts_receivable")
          .select("id, amount, amount_received, status")
          .eq("sale_order_id", nfeOriginal.sale_order_id)
          .not("status", "in", "(received,cancelled)");
        if (arList && arList.length > 0) {
          const totalAR = arList.reduce((s, a: any) => s + Number(a.amount || 0), 0);
          if (totalAR > 0) {
            // Reduz proporcionalmente cada AR pelo valor devolvido total
            for (const ar of arList as any[]) {
              const share = Number(ar.amount) / totalAR;
              const reducao = Number((share * valorTotal).toFixed(2));
              const novoAmount = Math.max(0, Number(ar.amount) - reducao);
              if (novoAmount <= 0.01) {
                await adminClient.from("accounts_receivable")
                  .update({ status: "cancelled", notes: `Cancelado por devolução total via NF ${chave || gcNfeId}` })
                  .eq("id", ar.id);
              } else {
                await adminClient.from("accounts_receivable")
                  .update({ amount: novoAmount, notes: `Reduzido R$ ${reducao.toFixed(2)} por devolução NF ${chave || gcNfeId}` })
                  .eq("id", ar.id);
              }
            }
          }
        }
      } catch (e: any) {
        cleanupWarnings.push(`AR não ajustado: ${e.message}`);
      }

      // 12d) Se já houver financial_entry confirmado (receita já reconhecida),
      // registra ajuste de crédito negativo pra cancelar a receita devolvida.
      // Audit Phase 3 fix: usa nfe_devolucoes.id como reference_id pra evitar
      // duplicar estorno em retry (mesma devolução nunca cria 2 entries).
      try {
        const { data: existingEntries } = await adminClient
          .from("financial_entries")
          .select("id, status, amount, type")
          .eq("reference_id", nfeOriginal.sale_order_id)
          .eq("reference_type", "sale_order")
          .in("status", ["confirmed", "posted", "reconciled", "paid"]);
        if (existingEntries && existingEntries.length > 0) {
          const { data: existingEstorno } = await adminClient
            .from("financial_entries")
            .select("id")
            .eq("reference_id", devLocal.id)
            .eq("reference_type", "sale_order_devolucao")
            .limit(1);
          if (!existingEstorno || existingEstorno.length === 0) {
            await adminClient.from("financial_entries").insert({
              type: "receita",
              category: "venda",
              amount: -valorTotal,
              status: "confirmed",
              description: `Estorno por devolução NF ${chave || gcNfeId} (PV ${nfeOriginal.sale_order_id})`,
              reference_id: devLocal.id,
              reference_type: "sale_order_devolucao",
              entry_date: new Date().toISOString().split("T")[0],
              created_by: userId,
            } as any);
          }
        }
      } catch (e: any) {
        cleanupWarnings.push(`Lançamento de estorno não criado: ${e.message}`);
      }
    }

    return new Response(JSON.stringify({
      success: emitOk,
      devolucao: { ...devLocal, ...updatePayload },
      provider_response: { create: createResp.json, emit: emitResp.json },
      ...(cleanupWarnings.length > 0 ? { partial_cleanup_warning: cleanupWarnings.join("; ") } : {}),
    }), {
      status: emitOk ? 200 : 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("emit-nfe-devolucao error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
