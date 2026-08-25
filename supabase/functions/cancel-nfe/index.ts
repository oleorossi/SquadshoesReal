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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let _adminClientForRollback: ReturnType<typeof createClient> | null = null;
  let _claimedNfeId: string | null = null;
  let _providerCalled = false;
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
    _adminClientForRollback = adminClient;
    const { data: roles, error: rolesErr } = await adminClient
      .from("user_roles").select("role").eq("user_id", userId);
    if (rolesErr) {
      return new Response(JSON.stringify({ error: "Role check failed" }), { status: 500, headers: corsHeaders });
    }
    const allowed = roles?.some((r: { role: string }) => ["admin", "gerente", "nfe_operator"].includes(r.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden: apenas admin, gerente ou operador NF-e podem cancelar NF-e" }), { status: 403, headers: corsHeaders });
    }
    const { data: granularPermissions, error: permissionsErr } = await adminClient
      .from("user_permissions")
      .select("module, can_view, can_edit")
      .eq("user_id", userId);
    if (permissionsErr) {
      return new Response(JSON.stringify({ error: "Permission check failed" }), { status: 500, headers: corsHeaders });
    }
    const hasGranularAllowList = (granularPermissions || []).some(
      (p: { can_view: boolean }) => p.can_view === true,
    );
    const canCancelNfe = (granularPermissions || []).some((p: {
      module: string;
      can_view: boolean;
      can_edit: boolean;
    }) =>
      p.can_view === true && (
        p.module === "nfe" || (p.module === "/nfe" && p.can_edit === true)
      )
    );
    if (hasGranularAllowList && !canCancelNfe) {
      return new Response(JSON.stringify({
        error: "Forbidden: cancelamento exige permissão granular de edição em /nfe",
      }), { status: 403, headers: corsHeaders });
    }

    const { nfe_id, justificativa } = await req.json();
    if (!nfe_id) {
      return new Response(JSON.stringify({ error: "nfe_id é obrigatório" }), { status: 400, headers: corsHeaders });
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(String(nfe_id))) {
      return new Response(JSON.stringify({ error: "nfe_id inválido" }), { status: 400, headers: corsHeaders });
    }
    if (!justificativa || justificativa.trim().length < 15) {
      return new Response(JSON.stringify({ error: "Justificativa deve ter ao menos 15 caracteres" }), { status: 400, headers: corsHeaders });
    }

    const { data: nfe, error: nfeErr } = await adminClient
      .from("nfe_emitidas").select("*").eq("id", nfe_id).single();
    if (nfeErr || !nfe) {
      return new Response(JSON.stringify({ error: "NF-e não encontrada" }), { status: 404, headers: corsHeaders });
    }
    let standaloneOrder: { id: string; is_standalone_nfe: boolean } | null = null;
    if (nfe.sale_order_id) {
      const { data: saleOrder } = await adminClient
        .from("sale_orders")
        .select("id, is_standalone_nfe")
        .eq("id", nfe.sale_order_id)
        .maybeSingle();
      standaloneOrder = saleOrder as typeof standaloneOrder;
    }
    const isStandaloneNfe = standaloneOrder?.is_standalone_nfe === true;

    // Retry seguro depois de o provedor já ter confirmado o cancelamento: não
    // chama o ClickNotas de novo; apenas conclui/reexecuta o estorno local.
    if (nfe.status === "cancelada" && isStandaloneNfe) {
      const { data: reversed, error: reverseErr } = await adminClient.rpc(
        "reverse_standalone_nfe_stock_for_cancel",
        { p_nfe_id: nfe_id },
      );
      if (reverseErr || reversed?.ok !== true) {
        return new Response(JSON.stringify({
          error: reverseErr?.message || reversed?.code || "Cancelamento fiscal confirmado, mas o estorno de estoque segue pendente.",
          reconciliation_needed: true,
        }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({
        success: true,
        idempotent_replay: true,
        stock_reversal: reversed,
      }), { status: 200, headers: corsHeaders });
    }
    if (nfe.status !== "autorizada") {
      return new Response(JSON.stringify({ error: "Somente NF-e autorizadas podem ser canceladas" }), { status: 400, headers: corsHeaders });
    }
    if (!nfe.provider_nfe_id) {
      return new Response(JSON.stringify({
        error: "NF-e sem ID do provedor — impossível cancelar via API. Use o painel do ClickNotas.",
      }), { status: 400, headers: corsHeaders });
    }

    const { data: claimed, error: claimErr } = await adminClient
      .from("nfe_emitidas")
      .update({ status: "cancelando" })
      .eq("id", nfe_id)
      .eq("status", "autorizada")
      .select("id, data_emissao");
    if (claimErr) throw new Error(`Falha ao reservar cancelamento: ${claimErr.message}`);
    if (!claimed || claimed.length === 0) {
      return new Response(JSON.stringify({
        error: "NF-e já está sendo cancelada ou seu status foi alterado por outro processo.",
      }), { status: 409, headers: corsHeaders });
    }
    _claimedNfeId = nfe_id;

    // Auditoria A1: usar data_emissao do CLAIM (UPDATE returning) ao invés do
    // SELECT inicial. Se sync-nfe-from-provider rodou em paralelo e mudou a
    // data, o cálculo de 24h ficaria stale. Pós-claim, o status está
    // 'cancelando' (lockado) e o registro retornado é a fonte da verdade.
    const dataEmissaoForCheck = (claimed[0] as any).data_emissao || nfe.data_emissao;
    if (!dataEmissaoForCheck) {
      await adminClient.from("nfe_emitidas")
        .update({ status: "autorizada" })
        .eq("id", nfe_id)
        .eq("status", "cancelando");
      _claimedNfeId = null;
      return new Response(JSON.stringify({
        error: "NF-e sem data de emissão registrada — impossível verificar prazo de 24h. Sincronize o status da NF-e antes de tentar cancelar.",
      }), { status: 400, headers: corsHeaders });
    }
    {
      const raw = String(dataEmissaoForCheck);
      // Sem timezone explícito, normaliza como horário de Brasília (−03:00),
      // IDÊNTICO ao que emit-nfe grava (t + "-03:00"). Antes anexava "Z" (UTC) →
      // a data lida ficava 3h "mais cedo", inflando hoursSince e podendo bloquear
      // indevidamente um cancelamento ainda dentro das 24h. Auditoria 2026-06-14, #10.
      const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw + "-03:00";
      const emittedAt = new Date(normalized).getTime();
      if (Number.isNaN(emittedAt)) {
        await adminClient.from("nfe_emitidas")
          .update({ status: "autorizada" })
          .eq("id", nfe_id)
          .eq("status", "cancelando");
        _claimedNfeId = null;
        return new Response(JSON.stringify({
          error: "Data de emissão da NF-e inválida — impossível verificar prazo de 24h.",
        }), { status: 400, headers: corsHeaders });
      }
      const hoursSince = (Date.now() - emittedAt) / 36e5;
      if (hoursSince > 24) {
        await adminClient.from("nfe_emitidas")
          .update({ status: "autorizada" })
          .eq("id", nfe_id)
          .eq("status", "cancelando");
        _claimedNfeId = null;
        return new Response(JSON.stringify({
          error: `Prazo de cancelamento expirado (NF emitida há ${hoursSince.toFixed(1)}h, limite é 24h). Use Carta de Correção (CC-e) se aplicável.`,
        }), { status: 400, headers: corsHeaders });
      }
    }

    _providerCalled = true;
    const providerResp = await fetch(
      `${CLICKNOTAS_BASE}/notas_fiscais_produtos/cancelar/${nfe.provider_nfe_id}`,
      {
        method: "POST",
        headers: gcHeaders(),
        body: JSON.stringify({ motivo: justificativa.trim() }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const providerText = await providerResp.text();
    if (providerText.length > 524_288) throw new Error("Resposta do ClickNotas excede o tamanho máximo permitido.");
    let providerData: any;
    try { providerData = JSON.parse(providerText); } catch { providerData = { mensagem: providerText }; }

    const success = providerResp.ok
      && providerData?.status !== "error"
      && providerData?.data?.ok !== false;

    let cancellationProtocol: string | null = null;
    if (success) {
      try {
        const detailResp = await fetch(`${CLICKNOTAS_BASE}/notas_fiscais_produtos/${nfe.provider_nfe_id}`, {
          headers: gcHeaders(),
          signal: AbortSignal.timeout(15_000),
        });
        const detailText = await detailResp.text();
        const detail = JSON.parse(detailText);
        cancellationProtocol = detail?.data?.protocolo_cancelamento ?? null;
      } catch (e) {
        console.warn("cancel-nfe: falha ao buscar protocolo de cancelamento:", e);
      }
    }

    const updatePayload: Record<string, unknown> = {
      status: success ? "cancelada" : nfe.status,
      justificativa_cancelamento: justificativa.trim(),
      data_cancelamento: success ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    if (cancellationProtocol) updatePayload.protocolo_cancelamento = cancellationProtocol;

    const { error: updateErr } = await adminClient.from("nfe_emitidas")
      .update(updatePayload).eq("id", nfe_id);
    if (updateErr) throw new Error(`Falha ao salvar cancelamento: ${updateErr.message}`);

    const cleanupWarnings: string[] = [];
    let standaloneStockWarning: string | null = null;
    if (success && isStandaloneNfe) {
      const { data: reversed, error: reverseErr } = await adminClient.rpc(
        "reverse_standalone_nfe_stock_for_cancel",
        { p_nfe_id: nfe_id },
      );
      if (reverseErr || reversed?.ok !== true) {
        standaloneStockWarning = reverseErr?.message || reversed?.code
          || "Falha ao estornar estoque da NF-e avulsa cancelada.";
        cleanupWarnings.push(`Estorno de estoque pendente: ${standaloneStockWarning}`);
      }
    }
    if (success && nfe.sale_order_id) {
      // Auditoria A3: ordem invertida — antes era AR cancel → estorno; agora
      // estorno PRIMEIRO. Razão: se estorno falhar (FK violation, conflict),
      // AR fica intacta (status pendente original) e operador pode tentar de
      // novo sem ficar com AR cancelada + receita órfã. Estorno bem-sucedido
      // pode coexistir com AR cancelada ou pendente — ambos resolvíveis.
      // Idempotência do estorno: se já existe estorno desta NF
      // (reference_type='sale_order_cancel_nfe', reference_id=nfe_id), NÃO insere
      // de novo — senão um retry geraria receita negativa em DOBRO. O pré-check é
      // seguro contra corrida porque o claim status='cancelando' (acima) já
      // serializa o cancelamento. Auditoria 2026-06-14, #10.
      const { data: existingReversals } = await adminClient.from("financial_entries")
        .select("id")
        .eq("reference_id", nfe_id)
        .eq("reference_type", "sale_order_cancel_nfe")
        .limit(1);
      const alreadyReversed = !!(existingReversals && existingReversals.length > 0);

      const { data: feToReverse, error: feFetchErr } = await adminClient.from("financial_entries")
        .select("id, amount, type, description, account_id, entry_date, due_date, status")
        .eq("reference_id", nfe.sale_order_id)
        .eq("reference_type", "sale_order");
      if (alreadyReversed) {
        cleanupWarnings.push("Estorno da NF-e já havia sido lançado anteriormente — pulado (idempotência).");
      } else if (feFetchErr) {
        cleanupWarnings.push(`Lançamento financeiro não localizado: ${feFetchErr.message}`);
      } else if (feToReverse && feToReverse.length > 0) {
        const protectedStatuses = new Set(["posted", "reconciled", "paid", "confirmed"]);
        const reversals: any[] = [];
        const deletableIds: string[] = [];
        for (const fe of feToReverse) {
          if (protectedStatuses.has(fe.status)) {
            // Estorno: entry com valor negativo + reference_type marcando estorno NF-e.
            // Auditoria A15: vincula nfe_id pra rastreabilidade direta via JOIN
            // (antes só dava pra ligar via reference_id text — sem FK formal).
            reversals.push({
              type: fe.type,
              amount: -Number(fe.amount || 0),
              description: `Estorno NF-e cancelada — ${fe.description || ''}`,
              account_id: fe.account_id,
              entry_date: new Date().toISOString().slice(0, 10),
              due_date: fe.due_date,
              status: "confirmed",
              reference_id: nfe_id,
              reference_type: "sale_order_cancel_nfe",
              nfe_id,
            });
          } else {
            deletableIds.push(fe.id);
          }
        }
        if (reversals.length > 0) {
          const { error: revErr } = await adminClient.from("financial_entries").insert(reversals);
          if (revErr) cleanupWarnings.push(`Estorno não inserido: ${revErr.message}`);
        }
        if (deletableIds.length > 0) {
          const { error: delErr } = await adminClient.from("financial_entries")
            .delete().in("id", deletableIds);
          if (delErr) cleanupWarnings.push(`Lançamento não removido: ${delErr.message}`);
        }
      }

      // AR cancel: depois do estorno (auditoria A3 — antes era ao contrário).
      const { error: arErr } = await adminClient.from("accounts_receivable")
        .update({ status: "cancelled" })
        .eq("sale_order_id", nfe.sale_order_id)
        .not("status", "in", "(received,cancelled)");
      if (arErr) cleanupWarnings.push(`AR não cancelada: ${arErr.message}`);

      // FIX S3: reabrir PV pra 'Em Produção' quando a NF cancelada era a única ativa.
      // Antes ficava em 'Faturado' órfão sem NF-e nem AR.
      // Auditoria A9: cleanupWarnings já cobre falhas no reopen (linhas
      // soErr abaixo). UI deve mostrar warning pra operador conferir status do PV.
      const { data: otherActiveNfes } = await adminClient.from("nfe_emitidas")
        .select("id")
        .eq("sale_order_id", nfe.sale_order_id)
        .in("status", ["autorizada", "processando"])
        .neq("id", nfe_id);
      const reopenStatus = (!otherActiveNfes || otherActiveNfes.length === 0)
        ? (isStandaloneNfe ? "Rascunho" : "Em Produção")
        : null;

      if (nfe.numero) {
        const soUpdate: any = { nfe: null };
        if (reopenStatus) soUpdate.status = reopenStatus;
        const { error: soErr } = await adminClient.from("sale_orders")
          .update(soUpdate)
          .eq("id", nfe.sale_order_id)
          .eq("nfe", String(nfe.numero));
        if (soErr) cleanupWarnings.push(`PV ${nfe.sale_order_id} pode ter ficado em 'Faturado' órfão — ${soErr.message}. Conferir manualmente.`);
      } else if (reopenStatus) {
        const { error: soErr } = await adminClient.from("sale_orders")
          .update({ status: reopenStatus })
          .eq("id", nfe.sale_order_id)
          .eq("status", "Faturado");
        if (soErr) cleanupWarnings.push(`PV ${nfe.sale_order_id} pode ter ficado em 'Faturado' órfão — ${soErr.message}. Conferir manualmente.`);
      }
    }

    return new Response(JSON.stringify({
      success,
      provider_response: providerData,
      ...(standaloneStockWarning ? {
        reconciliation_needed: true,
        stock_reconciliation_warning: standaloneStockWarning,
      } : {}),
      ...(cleanupWarnings.length > 0 ? { partial_cleanup_warning: cleanupWarnings.join("; ") } : {}),
    }), {
      status: success ? 200 : 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("cancel-nfe error:", error);
    if (!_providerCalled && _adminClientForRollback && _claimedNfeId) {
      await _adminClientForRollback.from("nfe_emitidas")
        .update({ status: "autorizada" })
        .eq("id", _claimedNfeId)
        .eq("status", "cancelando");
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
