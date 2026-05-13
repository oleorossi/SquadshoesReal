import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const GESTAOCLICK_BASE = "https://api.gestaoclick.com";

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
  const res = await fetch(`${GESTAOCLICK_BASE}${path}`, {
    ...init,
    headers: { ...gcHeaders(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { mensagem: text }; }
  return { ok: res.ok, status: res.status, json };
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
      return new Response(JSON.stringify({ error: "Forbidden: apenas admin, gerente ou operador NF-e podem emitir NF-e" }), { status: 403, headers: corsHeaders });
    }

    const { sale_order_id, company_id } = await req.json();
    if (!sale_order_id) {
      return new Response(JSON.stringify({ error: "sale_order_id é obrigatório" }), { status: 400, headers: corsHeaders });
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(String(sale_order_id))) {
      return new Response(JSON.stringify({ error: "sale_order_id inválido" }), { status: 400, headers: corsHeaders });
    }
    if (company_id && !UUID_RE.test(String(company_id))) {
      return new Response(JSON.stringify({ error: "company_id inválido" }), { status: 400, headers: corsHeaders });
    }

    const { data: order, error: orderErr } = await adminClient
      .from("sale_orders").select("*").eq("id", sale_order_id).single();
    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Pedido não encontrado" }), { status: 404, headers: corsHeaders });
    }

    if (order.nfe_required === false) {
      return new Response(JSON.stringify({
        error: "Pedido marcado como informal (sem NF-e). Para emitir, edite o pedido e desmarque \"Pedido informal\".",
      }), { status: 400, headers: corsHeaders });
    }

    const { data: existingActiveNfe } = await adminClient
      .from("nfe_emitidas")
      .select("id, status, ref_nfe")
      .eq("sale_order_id", sale_order_id)
      .in("status", ["processando", "autorizada", "cancelando"])
      .limit(1);
    if (existingActiveNfe && existingActiveNfe.length > 0) {
      const ex = existingActiveNfe[0];
      return new Response(JSON.stringify({
        error: `Já existe uma NF-e ${ex.status} para este pedido (ref ${ex.ref_nfe || ex.id}). Aguarde a autorização ou cancele antes de re-emitir.`,
        existing_nfe_id: ex.id,
        existing_status: ex.status,
      }), { status: 409, headers: corsHeaders });
    }

    const { data: items } = await adminClient
      .from("sale_order_items")
      .select("*, technical_sheets(id, name, code, ncm, gestaoclick_id), reference_material_variants(sku, ncm, description_override, active, unit_price_override), products(id, name, sku, ncm, gestaoclick_id, unit)")
      .eq("sale_order_id", sale_order_id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    let fiscal: any = null;
    let resolvedCompanyId: string | null = company_id || null;
    if (company_id) {
      const { data: companyData } = await adminClient
        .from("companies").select("*").eq("id", company_id).eq("active", true).maybeSingle();
      if (!companyData) {
        return new Response(JSON.stringify({ error: "Empresa selecionada está inativa ou não encontrada." }), { status: 400, headers: corsHeaders });
      }
      fiscal = companyData;
    }
    if (!fiscal) {
      const { data: primaryCompany } = await adminClient
        .from("companies").select("*").eq("is_primary", true).eq("active", true).limit(1).maybeSingle();
      if (primaryCompany) { fiscal = primaryCompany; resolvedCompanyId = primaryCompany.id; }
    }
    if (!fiscal) {
      const { data: fiscalConfigs } = await adminClient.from("fiscal_config").select("*").limit(1);
      fiscal = fiscalConfigs?.[0];
    }
    if (!fiscal) {
      return new Response(JSON.stringify({ error: "Configuração fiscal não encontrada. Configure os dados fiscais em Configurações ou cadastre uma Empresa." }), { status: 400, headers: corsHeaders });
    }

    let client: any = null;
    if (order.client_id) {
      const { data: byId } = await adminClient.from("clients").select("*").eq("id", order.client_id).maybeSingle();
      client = byId;
    }
    if (!client) {
      const { data: byName } = await adminClient.from("clients").select("*").eq("razao_social", order.client_name).limit(1);
      client = byName?.[0];
    }

    const cnpjDestRaw = (order.client_cnpj || client?.cnpj || "").replace(/\D/g, "");
    if (!cnpjDestRaw || (cnpjDestRaw.length !== 11 && cnpjDestRaw.length !== 14)) {
      return new Response(JSON.stringify({ error: "Cliente sem CNPJ/CPF válido. Cadastre o documento do cliente antes de emitir a NF-e." }), { status: 400, headers: corsHeaders });
    }

    const missingAddrFields: string[] = [];
    if (!client?.endereco?.trim())  missingAddrFields.push("endereço");
    if (!client?.bairro?.trim())    missingAddrFields.push("bairro");
    if (!client?.cidade?.trim())    missingAddrFields.push("cidade");
    if (!client?.estado?.trim())    missingAddrFields.push("UF");
    if (!(client?.cep || "").replace(/\D/g, "")) missingAddrFields.push("CEP");
    if (missingAddrFields.length > 0) {
      return new Response(JSON.stringify({ error: `Endereço do cliente incompleto: ${missingAddrFields.join(", ")}. Atualize o cadastro antes de emitir.` }), { status: 400, headers: corsHeaders });
    }

    const itemsInactiveVariant: string[] = [];
    const resolvedItems = (items || []).map((it: any) => {
      const v = it.reference_material_variants;
      if (it.material_variant_id && (!v || !v.active)) {
        const ref = it.technical_sheets?.code || it.reference_id;
        itemsInactiveVariant.push(`${ref} (variation_id=${it.material_variant_id})`);
      }
      return { ...it, _variant: v && v.active ? v : null };
    });
    if (itemsInactiveVariant.length > 0) {
      return new Response(JSON.stringify({
        error: `Variação de material inativa ou removida nas referências: ${itemsInactiveVariant.join("; ")}. Reative a variação no cadastro da ficha técnica ou edite o pedido para selecionar outra variação antes de emitir.`,
      }), { status: 400, headers: corsHeaders });
    }

    const billableItems = resolvedItems.filter((it: any) => Number(it.quantity) > 0);

    const itemsMissingNcm: string[] = [];
    for (const it of billableItems) {
      // NF avulsa (product_id): usa NCM do produto direto.
      // NF normal (reference_id): usa NCM da variant/ficha.
      const ncm = (it._variant?.ncm || it.technical_sheets?.ncm || it.products?.ncm || "").trim();
      if (!ncm || ncm.length !== 8 || !/^\d{8}$/.test(ncm)) {
        const ref = it.technical_sheets?.code || it.products?.sku || it.reference_id || it.product_id;
        itemsMissingNcm.push(`${ref} (NCM atual: "${ncm || "vazio"}")`);
      }
    }
    if (itemsMissingNcm.length > 0) {
      return new Response(JSON.stringify({ error: `NCM ausente ou inválido (precisa 8 dígitos) nas referências: ${itemsMissingNcm.join("; ")}. Atualize a ficha técnica, variação de material ou produto antes de emitir.` }), { status: 400, headers: corsHeaders });
    }

    const effectivePrice = (it: any) => Number(it._variant?.unit_price_override ?? it.unit_price ?? 0);
    const sumItems = billableItems.reduce(
      (s: number, it: any) => s + Number(((Number(it.quantity) || 0) * effectivePrice(it)).toFixed(2)),
      0,
    );
    const orderTotalNum = Number(order.total) || 0;
    if (Math.abs(sumItems - orderTotalNum) > 0.01) {
      return new Response(JSON.stringify({
        error: `Valor total do pedido (R$ ${orderTotalNum.toFixed(2)}) difere da soma dos itens (R$ ${sumItems.toFixed(2)}). Atualize o pedido antes de emitir a NF-e.`,
      }), { status: 400, headers: corsHeaders });
    }

    // CFOP por código (GestaoClick aceita `codigo_cfop` diretamente).
    const isInterstate = !!(client?.estado && fiscal.uf && client.estado.toUpperCase() !== String(fiscal.uf).toUpperCase());
    const defaultCfop = isInterstate ? "6102" : "5102";
    const cfopConfigured = fiscal.cfop ? String(fiscal.cfop) : "";
    let resolvedCfop = cfopConfigured || defaultCfop;
    if (cfopConfigured && /^[56]\d{3}$/.test(cfopConfigured)) {
      if (isInterstate && cfopConfigured.startsWith("5")) resolvedCfop = "6" + cfopConfigured.slice(1);
      if (!isInterstate && cfopConfigured.startsWith("6")) resolvedCfop = "5" + cfopConfigured.slice(1);
    }

    const { count: priorCount, error: countErr } = await adminClient
      .from("nfe_emitidas").select("id", { count: "exact", head: true }).eq("sale_order_id", sale_order_id);
    if (countErr) {
      return new Response(JSON.stringify({ error: `Falha ao calcular revisão da NF-e: ${countErr.message}. Tente novamente.` }), { status: 500, headers: corsHeaders });
    }
    const revision = priorCount ?? 0;
    const ref = revision === 0 ? `nfe-${sale_order_id}` : `nfe-${sale_order_id}-r${revision + 1}`;

    if (!fiscal.cnpj || !fiscal.inscricao_estadual || !fiscal.cep) {
      return new Response(JSON.stringify({ error: "Configuração fiscal incompleta: CNPJ, Inscrição Estadual e CEP do emitente são obrigatórios." }), { status: 400, headers: corsHeaders });
    }

    // ---------- Sync lazy: cliente no GestaoClick ----------
    let gcClientId: string | null = client?.gestaoclick_id || null;
    if (!gcClientId) {
      const isPj = cnpjDestRaw.length === 14;
      const payload: any = {
        tipo_pessoa: isPj ? "PJ" : "PF",
        nome: order.client_name || client?.razao_social || client?.nome,
        ...(isPj
          ? { cnpj: cnpjDestRaw, inscricao_estadual: (client.inscricao_estadual || "").replace(/\D/g, "") }
          : { cpf: cnpjDestRaw }),
        ...(client.telefone ? { telefone: client.telefone } : {}),
        ...(client.email ? { email: client.email } : {}),
        enderecos: [{
          logradouro: client.endereco,
          numero: (client as any).numero || "S/N",
          ...(client.complemento ? { complemento: client.complemento } : {}),
          bairro: client.bairro,
          cep: (client.cep || "").replace(/\D/g, ""),
          cidade_nome: client.cidade,
          estado: client.estado,
        }],
      };
      const r = await gcFetch("/clientes", { method: "POST", body: JSON.stringify(payload) });
      if (!r.ok || r.json?.status === "error") {
        return new Response(JSON.stringify({
          error: `Falha ao sincronizar cliente com GestaoClick: ${r.json?.message || r.json?.mensagem || JSON.stringify(r.json)}`,
        }), { status: 502, headers: corsHeaders });
      }
      gcClientId = String(r.json?.data?.id);
      if (client?.id) {
        await adminClient.from("clients").update({ gestaoclick_id: gcClientId }).eq("id", client.id);
      }
    }

    // ---------- Sync lazy: produtos no GestaoClick + payload itens ----------
    const produtosGC: any[] = [];
    for (const it of billableItems) {
      const ts = it.technical_sheets;
      const prod = it.products; // NF avulsa: dados vêm de products
      const variant = it._variant;
      const isStandalone = !ts && !!prod;
      const ncm = (variant?.ncm || ts?.ncm || prod?.ncm || "").trim();
      const price = effectivePrice(it);
      const baseName = ts?.name || prod?.name || "Produto";
      const desc = (variant?.description_override || (it.color ? `${baseName} - ${it.color}` : baseName)).trim();
      const codigo = variant?.sku || ts?.code || prod?.sku || `ITEM-${ts?.id || prod?.id || it.reference_id}`;
      const unidade = (prod?.unit || "PAR").toUpperCase();

      let gcProductId = ts?.gestaoclick_id || prod?.gestaoclick_id || null;
      if (!gcProductId) {
        const r = await gcFetch("/produtos", {
          method: "POST",
          body: JSON.stringify({
            nome: desc.slice(0, 120),
            codigo,
            valor_venda: price.toFixed(2),
            unidade: isStandalone ? unidade : "PAR",
            ncm,
            tipo: "P",
          }),
        });
        if (!r.ok || r.json?.status === "error") {
          return new Response(JSON.stringify({
            error: `Falha ao sincronizar produto "${codigo}" com GestaoClick: ${r.json?.message || r.json?.mensagem || JSON.stringify(r.json)}`,
          }), { status: 502, headers: corsHeaders });
        }
        gcProductId = String(r.json?.data?.id);
        if (ts?.id) {
          await adminClient.from("technical_sheets").update({ gestaoclick_id: gcProductId }).eq("id", ts.id);
        } else if (prod?.id) {
          await adminClient.from("products").update({ gestaoclick_id: gcProductId }).eq("id", prod.id);
        }
      }

      produtosGC.push({
        produto_id: gcProductId,
        quantidade: Number(it.quantity).toFixed(2),
        valor_venda: (Number(it.quantity) * price).toFixed(2),
        cfop: resolvedCfop,
        unidade: isStandalone ? unidade : "PAR",
        NCM: ncm,
        tipo: "P",
      });
    }

    // ---------- Cria a NF-e no GestaoClick (rascunho) ----------
    const nfePayload = {
      tipo_nf: "1",
      natureza_operacao: fiscal.natureza_operacao || "Venda",
      id_destinatario: gcClientId,
      codigo_cfop: resolvedCfop,
      modelo: "55",
      serie: fiscal.serie_nfe || "1",
      finalidade_nf: "1",
      consumidor_final: "0",
      informacoes_complementares: order.numero_pv ? `Pedido de Venda: ${order.numero_pv}` : undefined,
      produtos: produtosGC,
    };

    const createResp = await gcFetch("/notas_fiscais_produtos", {
      method: "POST",
      body: JSON.stringify(nfePayload),
    });
    if (!createResp.ok || createResp.json?.status === "error" || createResp.json?.data?.ok === false) {
      const msg = createResp.json?.data?.mensagem || createResp.json?.message || createResp.json?.mensagem || JSON.stringify(createResp.json);
      const nfeRecord: any = {
        sale_order_id,
        ref_nfe: ref,
        status: "rejeitada",
        valor_total: Number(sumItems.toFixed(2)),
        motivo_rejeicao: `Cadastro: ${msg}`,
        cnpj_emitente: fiscal.cnpj.replace(/\D/g, ""),
      };
      if (resolvedCompanyId) nfeRecord.company_id = resolvedCompanyId;
      await adminClient.from("nfe_emitidas").insert(nfeRecord);
      return new Response(JSON.stringify({ error: `Falha ao cadastrar NF-e no GestaoClick: ${msg}` }), { status: 422, headers: corsHeaders });
    }
    const gcNfeId = String(createResp.json?.data?.dados || createResp.json?.data?.id);

    // ---------- Emite a NF-e (envia pra SEFAZ) ----------
    const emitResp = await gcFetch(`/notas_fiscais_produtos/emitir/${gcNfeId}`, { method: "POST" });
    const emitOk = emitResp.ok && emitResp.json?.data?.ok !== false && emitResp.json?.status !== "error";
    const emitMsg = emitResp.json?.data?.mensagem || emitResp.json?.message || emitResp.json?.mensagem || "";

    // ---------- Consulta status final + protocolo/chave ----------
    let chave = "";
    let protocolo = "";
    let situacao = "";
    if (emitOk) {
      const detail = await gcFetch(`/notas_fiscais_produtos/${gcNfeId}`);
      const d = detail.json?.data || {};
      chave = d.chave || "";
      protocolo = d.protocolo || "";
      situacao = d.situacao_nf || "";
    }
    const finalStatus = emitOk
      ? (situacao?.toLowerCase().includes("aprovada") ? "autorizada" : "processando")
      : "rejeitada";

    const nfeRecord: any = {
      sale_order_id,
      ref_nfe: ref,
      status: finalStatus,
      valor_total: Number(sumItems.toFixed(2)),
      motivo_rejeicao: emitOk ? "" : emitMsg,
      cnpj_emitente: fiscal.cnpj.replace(/\D/g, ""),
      chave_acesso: chave || null,
      protocolo: protocolo || null,
      provider_nfe_id: gcNfeId,
    };
    if (resolvedCompanyId) nfeRecord.company_id = resolvedCompanyId;

    const { data: nfe, error: nfeErr } = await adminClient
      .from("nfe_emitidas").insert(nfeRecord).select().single();

    if (nfeErr) {
      const code = (nfeErr as any)?.code;
      if (code === "23505") {
        return new Response(JSON.stringify({
          error: `Outra NF-e foi criada simultaneamente para este pedido. Verifique o painel GestaoClick (NF id ${gcNfeId}) e cancele a duplicata se necessário.`,
          provider_nfe_id: gcNfeId,
          conflict: true,
        }), { status: 409, headers: corsHeaders });
      }
      return new Response(JSON.stringify({
        error: `Erro ao salvar NF-e no banco: ${nfeErr.message}`,
        provider_nfe_id: gcNfeId,
        reconciliation_needed: true,
      }), { status: 500, headers: corsHeaders });
    }

    // Audit Phase 3 fix: NF autorizada → advance SO para 'Faturado' pra disparar
    // syncFinancialRecords (cria AR + financial_entries). Antes ficava órfão se o
    // operador NF emitia mas ninguém ajustava o status manualmente.
    let arSyncWarning: string | null = null;
    if (finalStatus === "autorizada" && order.status !== "Faturado" && order.status !== "Cancelado") {
      const numeroNfe = nfe?.numero || (await gcFetch(`/notas_fiscais_produtos/${gcNfeId}`)).json?.data?.numero_nf || null;
      const { error: soUpdErr } = await adminClient
        .from("sale_orders")
        .update({
          status: "Faturado",
          nfe: numeroNfe ? String(numeroNfe) : order.nfe,
        })
        .eq("id", sale_order_id)
        .neq("status", "Cancelado");
      if (soUpdErr) {
        arSyncWarning = `NF autorizada mas falhou ao avançar PV pra Faturado: ${soUpdErr.message}. Ajuste o status manualmente pra gerar AR.`;
        console.warn("emit-nfe SO status update failed:", soUpdErr);
      }
    }

    return new Response(JSON.stringify({
      success: emitOk,
      nfe,
      provider_response: { create: createResp.json, emit: emitResp.json },
      ...(arSyncWarning ? { ar_sync_warning: arSyncWarning } : {}),
    }), {
      status: emitOk ? 200 : 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("emit-nfe error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
