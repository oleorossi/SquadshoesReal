import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const adminAuthClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: roles, error: rolesErr } = await adminAuthClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rolesErr) {
      return new Response(JSON.stringify({ error: "Role check failed" }), { status: 500, headers: corsHeaders });
    }
    const allowed = roles?.some((r: { role: string }) => ["admin", "gerente"].includes(r.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden: apenas admin ou gerente podem emitir NF-e" }), { status: 403, headers: corsHeaders });
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

    const FOCUS_TOKEN = Deno.env.get("FOCUS_NFE_API_TOKEN");
    if (!FOCUS_TOKEN) {
      return new Response(JSON.stringify({ error: "Token da Focus NFe não configurado" }), { status: 500, headers: corsHeaders });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch sale order
    const { data: order, error: orderErr } = await adminClient
      .from("sale_orders")
      .select("*")
      .eq("id", sale_order_id)
      .single();
    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Pedido não encontrado" }), { status: 404, headers: corsHeaders });
    }

    // Idempotency pre-check: refuse to emit if an active NF-e already exists
    // for this sale_order. The DB also enforces this via uq_nfe_active_per_sale_order
    // (migration 20260508150000) but we fail fast here to avoid a redundant
    // submission to Focus NFe before the unique constraint rejects the insert.
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

    // Fetch sale order items (join technical_sheets for name/code/ncm, join variant
    // for SKU/NCM overrides). Order by created_at so numero_item is stable across
    // re-emissions of the same order (cancel + re-emit must produce the same line
    // numbering for fiscal reconciliation).
    const { data: items } = await adminClient
      .from("sale_order_items")
      .select("*, technical_sheets(name, code, ncm), reference_material_variants(sku, ncm, description_override, active, unit_price_override)")
      .eq("sale_order_id", sale_order_id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    // Resolve emitter: prefer companies table (multi-CNPJ), fallback to fiscal_config
    let fiscal: any = null;
    let resolvedCompanyId: string | null = company_id || null;

    if (company_id) {
      // Only allow active companies — inactive companies must not emit NF-e.
      const { data: companyData } = await adminClient
        .from("companies")
        .select("*")
        .eq("id", company_id)
        .eq("active", true)
        .maybeSingle();
      if (!companyData) {
        return new Response(JSON.stringify({
          error: "Empresa selecionada está inativa ou não encontrada.",
        }), { status: 400, headers: corsHeaders });
      }
      fiscal = companyData;
    }

    if (!fiscal) {
      // Try primary company first
      const { data: primaryCompany } = await adminClient
        .from("companies")
        .select("*")
        .eq("is_primary", true)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      if (primaryCompany) {
        fiscal = primaryCompany;
        resolvedCompanyId = primaryCompany.id;
      }
    }

    if (!fiscal) {
      // Legacy fallback: fiscal_config
      const { data: fiscalConfigs } = await adminClient.from("fiscal_config").select("*").limit(1);
      fiscal = fiscalConfigs?.[0];
    }

    if (!fiscal) {
      return new Response(JSON.stringify({ error: "Configuração fiscal não encontrada. Configure os dados fiscais em Configurações ou cadastre uma Empresa." }), { status: 400, headers: corsHeaders });
    }

    // Fetch client data — prefer FK client_id (canonical) over razao_social
    // text-match. Two clients can share the same razao_social (chains/branches);
    // a rename of razao_social must not break NF-e emission for active orders.
    let client: any = null;
    if (order.client_id) {
      const { data: byId } = await adminClient
        .from("clients")
        .select("*")
        .eq("id", order.client_id)
        .maybeSingle();
      client = byId;
    }
    if (!client) {
      // Legacy fallback for orders created before client_id was populated
      const { data: byName } = await adminClient
        .from("clients")
        .select("*")
        .eq("razao_social", order.client_name)
        .limit(1);
      client = byName?.[0];
    }

    // Validação fiscal: destinatário precisa ter CNPJ/CPF válido. SEFAZ rejeita
    // NF-e sem documento do destinatário ou com documento mal formado.
    const cnpjDestRaw = (order.client_cnpj || client?.cnpj || "").replace(/\D/g, "");
    if (!cnpjDestRaw || (cnpjDestRaw.length !== 11 && cnpjDestRaw.length !== 14)) {
      return new Response(JSON.stringify({
        error: "Cliente sem CNPJ/CPF válido. Cadastre o documento do cliente antes de emitir a NF-e.",
      }), { status: 400, headers: corsHeaders });
    }

    // Validação fiscal: endereço completo do destinatário é obrigatório (SEFAZ
    // rejeita Rejeição 226/231/793 quando logradouro/CEP/cidade/UF estão vazios).
    // Falhar aqui antes de queimar uma sequência de NF-e em rejeição inevitável.
    const missingAddrFields: string[] = [];
    if (!client?.endereco?.trim())  missingAddrFields.push("endereço");
    if (!client?.bairro?.trim())    missingAddrFields.push("bairro");
    if (!client?.cidade?.trim())    missingAddrFields.push("cidade");
    if (!client?.estado?.trim())    missingAddrFields.push("UF");
    if (!(client?.cep || "").replace(/\D/g, "")) missingAddrFields.push("CEP");
    if (!String((client as any)?.codigo_municipio || "").trim()) missingAddrFields.push("código IBGE do município");
    if (missingAddrFields.length > 0) {
      return new Response(JSON.stringify({
        error: `Endereço do cliente incompleto: ${missingAddrFields.join(", ")}. Atualize o cadastro antes de emitir.`,
      }), { status: 400, headers: corsHeaders });
    }

    // Variant active validation: silent fallback to defaults would emit
    // NF-e with the wrong SKU/NCM (Rejeição 608 risk + audit divergence).
    // If the order pinned a variant but the variant was deactivated since,
    // refuse the emission and require manual intervention.
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
        error:
          `Variação de material inativa ou removida nas referências: ${itemsInactiveVariant.join("; ")}. ` +
          `Reative a variação no cadastro da ficha técnica ou edite o pedido para selecionar outra variação antes de emitir.`,
      }), { status: 400, headers: corsHeaders });
    }

    // Filter to billable items (qty > 0) before validation — zero-qty lines would
    // be excluded from the payload anyway but could trigger spurious NCM errors.
    const billableItems = resolvedItems.filter((it: any) => Number(it.quantity) > 0);

    // Validação fiscal: NCM é obrigatório por item (SEFAZ Rejeição 778). Resolve
    // na cadeia variant.ncm → technical_sheets.ncm. Falhar aqui antes de queimar
    // uma sequência em rejeição garantida.
    const itemsMissingNcm: string[] = [];
    for (const it of billableItems) {
      const ncm = (it._variant?.ncm || it.technical_sheets?.ncm || "").trim();
      if (!ncm || ncm.length !== 8 || !/^\d{8}$/.test(ncm)) {
        const ref = it.technical_sheets?.code || it.reference_id;
        itemsMissingNcm.push(`${ref} (NCM atual: "${ncm || "vazio"}")`);
      }
    }
    if (itemsMissingNcm.length > 0) {
      return new Response(JSON.stringify({
        error: `NCM ausente ou inválido (precisa 8 dígitos) nas referências: ${itemsMissingNcm.join("; ")}. Atualize a ficha técnica ou variação de material antes de emitir.`,
      }), { status: 400, headers: corsHeaders });
    }

    // Validate total: SEFAZ rejects NF-e where order.total != sum(item.quantity * item.unit_price)
    // Apply variant.unit_price_override (if set) when summing — this is the same
    // price the NF-e payload will use, so validation must agree.
    const effectivePrice = (it: any) => Number(
      it._variant?.unit_price_override ?? it.unit_price ?? 0,
    );
    // Round per-item before summing so the validation matches what SEFAZ will
    // aggregate from the per-line valor_bruto strings (prevents Rejeição 531/536
    // on high-item-count PVs where unrounded accumulation exceeds R$0.01).
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

    // Determine CFOP: 5xxx = intra-estadual; 6xxx = inter-estadual.
    // SEFAZ rejeita NF-e com CFOP incompatível com o destino.
    const isInterstate = !!(client?.estado && fiscal.uf && client.estado.toUpperCase() !== String(fiscal.uf).toUpperCase());
    const defaultCfop = isInterstate ? "6102" : "5102";
    const cfopConfigured = fiscal.cfop ? String(fiscal.cfop) : "";
    // If user configured a 5xxx CFOP but operation is interstate, swap the leading digit
    let resolvedCfop = cfopConfigured || defaultCfop;
    if (cfopConfigured && /^[56]\d{3}$/.test(cfopConfigured)) {
      if (isInterstate && cfopConfigured.startsWith("5")) resolvedCfop = "6" + cfopConfigured.slice(1);
      if (!isInterstate && cfopConfigured.startsWith("6")) resolvedCfop = "5" + cfopConfigured.slice(1);
    }

    // Deterministic ref with revision counter. After cancellation, Focus NFe
    // already "knows" the previous ref and will conflict on re-emission.
    // Count prior NF-e rows (any status) for this order to derive revision.
    const { count: priorCount, error: countErr } = await adminClient
      .from("nfe_emitidas")
      .select("id", { count: "exact", head: true })
      .eq("sale_order_id", sale_order_id);
    if (countErr) {
      return new Response(JSON.stringify({
        error: `Falha ao calcular revisão da NF-e: ${countErr.message}. Tente novamente.`,
      }), { status: 500, headers: corsHeaders });
    }
    const revision = priorCount ?? 0;
    const ref = revision === 0 ? `nfe-${sale_order_id}` : `nfe-${sale_order_id}-r${revision + 1}`;

    // Validate fiscal config — SEFAZ rejects NF-e without emitter CNPJ/IE/CEP.
    if (!fiscal.cnpj || !fiscal.inscricao_estadual || !fiscal.cep) {
      return new Response(JSON.stringify({
        error: "Configuração fiscal incompleta: CNPJ, Inscrição Estadual e CEP do emitente são obrigatórios.",
      }), { status: 400, headers: corsHeaders });
    }

    // Build NF-e payload
    const nfePayload: any = {
      natureza_operacao: fiscal.natureza_operacao || "Venda de Mercadoria",
      forma_pagamento: "0",
      tipo_documento: "1",
      local_destino: "1",
      finalidade_emissao: "1",
      consumidor_final: "0",
      presenca_comprador: "9",
      modalidade_frete: "9",
      cnpj_emitente: fiscal.cnpj.replace(/\D/g, ""),
      nome_emitente: fiscal.razao_social,
      nome_fantasia_emitente: fiscal.nome_fantasia || fiscal.razao_social,
      inscricao_estadual_emitente: fiscal.inscricao_estadual.replace(/\D/g, ""),
      logradouro_emitente: fiscal.logradouro,
      numero_emitente: fiscal.numero,
      bairro_emitente: fiscal.bairro,
      municipio_emitente: fiscal.cidade,
      uf_emitente: fiscal.uf,
      cep_emitente: fiscal.cep.replace(/\D/g, ""),
      codigo_municipio_emitente: fiscal.codigo_municipio,
      regime_tributario_emitente: fiscal.regime_tributario,
      // Destinatário — 14 digits = CNPJ (PJ), 11 digits = CPF (PF).
      // SEFAZ validates the checksum for each field separately.
      ...(cnpjDestRaw.length === 14
        ? { cnpj_destinatario: cnpjDestRaw }
        : { cpf_destinatario: cnpjDestRaw }),
      nome_destinatario: order.client_name,
      // Strip non-digits: "ISENTO" → "" → indicator "9" (não contribuinte).
      // Using raw string for the indicator check would flag "ISENTO" as "1"
      // (Contribuinte ICMS) while sending empty digits — SEFAZ Rejeição 793.
      inscricao_estadual_destinatario: (client?.inscricao_estadual || "").replace(/\D/g, ""),
      logradouro_destinatario: client?.endereco || "",
      numero_destinatario: (client as any)?.numero || "S/N",
      bairro_destinatario: client?.bairro || "",
      municipio_destinatario: client?.cidade || "",
      uf_destinatario: client?.estado || "",
      cep_destinatario: (client?.cep || "").replace(/\D/g, ""),
      codigo_municipio_destinatario: (client as any)?.codigo_municipio || "",
      // PF (CPF, 11 digits) can never be ICMS contributor — force "9".
      indicador_inscricao_estadual_destinatario: cnpjDestRaw.length === 11 ? "9"
        : (client?.inscricao_estadual || "").replace(/\D/g, "").length >= 2 ? "1" : "9",
      // Optional fields — included when available to improve DANFE delivery and
      // avoid UF-specific rejections (some states require phone for B2B NF-e).
      ...((client as any)?.telefone ? { telefone_destinatario: (client as any).telefone.replace(/\D/g, "") } : {}),
      ...((client as any)?.email ? { email_destinatario: (client as any).email } : {}),
      ...((client as any)?.complemento ? { complemento_destinatario: (client as any).complemento } : {}),
      items: billableItems.map((item: any, idx: number) => {
        const variant = item._variant;  // already filtered by active=true
        const price = effectivePrice(item);
        // Item description: avoid trailing " - " when color is empty
        const baseName = item.technical_sheets?.name || "Produto";
        const builtDesc = item.color
          ? `${baseName} - ${item.color}`
          : baseName;
        return {
          numero_item: String(idx + 1),
          codigo_produto: variant?.sku || item.technical_sheets?.code || `ITEM-${idx + 1}`,
          descricao: (variant?.description_override || builtDesc).trim(),
          // NCM already validated 8-digit upstream
          ncm: (variant?.ncm || item.technical_sheets?.ncm || "").trim(),
          cfop: resolvedCfop,
          unidade_comercial: "PAR",
          // SEFAZ NT 2018.005: qCom/qTrib até 4 decimais; vUnCom/vUnTrib exatamente 4 decimais.
          // Truncar a 2 decimais provoca rejeição rule 559/610.
          quantidade_comercial: Number(item.quantity).toFixed(4),
          valor_unitario_comercial: price.toFixed(4),
          valor_bruto: (Number(item.quantity) * price).toFixed(2),
          unidade_tributavel: "PAR",
          quantidade_tributavel: Number(item.quantity).toFixed(4),
          valor_unitario_tributavel: price.toFixed(4),
          origem: "0",
          icms_situacao_tributaria: fiscal.regime_tributario === "1" ? "102" : "00",
          icms_modalidade_base_calculo: "0",
          pis_situacao_tributaria: fiscal.regime_tributario === "1" ? "49" : "01",
          cofins_situacao_tributaria: fiscal.regime_tributario === "1" ? "49" : "01",
          // Non-Simples (CST 01) requires base, aliquota, valor — Simples (CST 49) omits them
          ...(fiscal.regime_tributario !== "1" ? {
            pis_base_calculo: (Number(item.quantity) * price).toFixed(2),
            pis_aliquota: "1.65",
            pis_valor: (Number(item.quantity) * price * 0.0165).toFixed(2),
            cofins_base_calculo: (Number(item.quantity) * price).toFixed(2),
            cofins_aliquota: "7.60",
            cofins_valor: (Number(item.quantity) * price * 0.076).toFixed(2),
          } : {}),
        };
      }),
      // Explicit totals prevent SEFAZ Rejeição 531/536 when item-level rounding
      // creates tiny diffs between item sum and NF-e header total.
      serie: fiscal.serie_nfe || "1",
      valor_produtos: sumItems.toFixed(2),
      valor_frete: "0.00",
      valor_seguro: "0.00",
      valor_outras_despesas: "0.00",
      valor_total_nf: sumItems.toFixed(2),
    };

    const baseUrl = fiscal.ambiente === "producao"
      ? "https://api.focusnfe.com.br"
      : "https://homologacao.focusnfe.com.br";

    const focusResponse = await fetch(`${baseUrl}/v2/nfe?ref=${ref}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${FOCUS_TOKEN}:`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(nfePayload),
      // 30s timeout — Focus NFe normally responds in <5s; longer indicates a hang.
      signal: AbortSignal.timeout(30_000),
    });

    const focusText = await focusResponse.text();
    if (focusText.length > 524_288) throw new Error("Resposta da Focus NFe excede o tamanho máximo permitido.");
    let focusData: any;
    try { focusData = JSON.parse(focusText); } catch { focusData = { mensagem: focusText }; }

    const nfeRecord: any = {
      sale_order_id,
      ref_nfe: ref,
      status: focusResponse.ok ? "processando" : "rejeitada",
      valor_total: Number(sumItems.toFixed(2)),
      motivo_rejeicao: focusResponse.ok ? "" : (focusData?.mensagem || focusData?.erros?.[0]?.mensagem || JSON.stringify(focusData)),
      cnpj_emitente: fiscal.cnpj.replace(/\D/g, ""),
    };
    if (resolvedCompanyId) nfeRecord.company_id = resolvedCompanyId;

    const { data: nfe, error: nfeErr } = await adminClient
      .from("nfe_emitidas")
      .insert(nfeRecord)
      .select()
      .single();

    if (nfeErr) {
      // 23505 = unique_violation — typically the partial unique index
      // uq_nfe_active_per_sale_order racing with another concurrent caller.
      // The Focus NFe submission already happened (ref `ref` is in flight), so
      // include it in the response so the operator can reconcile manually.
      const code = (nfeErr as any)?.code;
      if (code === "23505") {
        return new Response(JSON.stringify({
          error: `Outra NF-e foi criada simultaneamente para este pedido. A submissão para Focus NFe pode ter ocorrido (ref ${ref}); verifique o painel Focus NFe e cancele a duplicata se necessário.`,
          focus_ref: ref,
          conflict: true,
        }), { status: 409, headers: corsHeaders });
      }
      // Focus NFe already accepted the submission — include focus_ref so the
      // operator can manually reconcile in the Focus NFe panel even though our
      // DB write failed. Without this, the ref would be permanently lost.
      return new Response(JSON.stringify({
        error: `Erro ao salvar NF-e no banco: ${nfeErr.message}`,
        focus_ref: ref,
        reconciliation_needed: true,
      }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      success: focusResponse.ok,
      nfe,
      focus_response: focusData,
    }), {
      status: focusResponse.ok ? 200 : 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("emit-nfe error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
