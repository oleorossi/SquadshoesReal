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

  let _adminClientForRollback: ReturnType<typeof createClient> | null = null;
  let _claimedNfeId: string | null = null;
  let _focusCalled = false; // set to true just before the Focus NFe HTTP call
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
      return new Response(JSON.stringify({ error: "Forbidden: apenas admin ou gerente podem cancelar NF-e" }), { status: 403, headers: corsHeaders });
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

    const FOCUS_TOKEN = Deno.env.get("FOCUS_NFE_API_TOKEN");
    if (!FOCUS_TOKEN) {
      return new Response(JSON.stringify({ error: "Token da Focus NFe não configurado" }), { status: 500, headers: corsHeaders });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    _adminClientForRollback = adminClient;

    const { data: nfe, error: nfeErr } = await adminClient
      .from("nfe_emitidas")
      .select("*")
      .eq("id", nfe_id)
      .single();

    if (nfeErr || !nfe) {
      return new Response(JSON.stringify({ error: "NF-e não encontrada" }), { status: 404, headers: corsHeaders });
    }

    if (nfe.status !== "autorizada") {
      return new Response(JSON.stringify({ error: "Somente NF-e autorizadas podem ser canceladas" }), { status: 400, headers: corsHeaders });
    }

    // Atomic claim: flip status to 'cancelando' so a concurrent cancel call
    // (double-click, retry after timeout) is rejected immediately without
    // burning an API call or generating a duplicate SEFAZ event.
    const { data: claimed, error: claimErr } = await adminClient
      .from("nfe_emitidas")
      .update({ status: "cancelando" })
      .eq("id", nfe_id)
      .eq("status", "autorizada")
      .select("id");
    if (claimErr) throw new Error(`Falha ao reservar cancelamento: ${claimErr.message}`);
    if (!claimed || claimed.length === 0) {
      return new Response(JSON.stringify({
        error: "NF-e já está sendo cancelada ou seu status foi alterado por outro processo.",
      }), { status: 409, headers: corsHeaders });
    }
    _claimedNfeId = nfe_id;

    // Server-side enforcement of SEFAZ 24h cancellation window. The frontend
    // already validates this, but defense-in-depth: a buggy/tampered client
    // would otherwise hit Focus NFe and either incur API cost or fail with a
    // less friendly message. Normalize timestamps lacking a TZ suffix as UTC.
    // SECURITY: refuse cancellation if data_emissao is missing — without it we can't
    // verify the 24h window, and silently bypassing the check is a regulatory risk.
    if (!nfe.data_emissao) {
      return new Response(JSON.stringify({
        error: "NF-e sem data de emissão registrada — impossível verificar prazo de 24h. Sincronize o status da NF-e antes de tentar cancelar.",
      }), { status: 400, headers: corsHeaders });
    }
    {
      const raw = String(nfe.data_emissao);
      const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw + "Z";
      const emittedAt = new Date(normalized).getTime();
      if (Number.isNaN(emittedAt)) {
        return new Response(JSON.stringify({
          error: "Data de emissão da NF-e inválida — impossível verificar prazo de 24h.",
        }), { status: 400, headers: corsHeaders });
      }
      const hoursSince = (Date.now() - emittedAt) / 36e5;
      if (hoursSince > 24) {
        return new Response(JSON.stringify({
          error: `Prazo de cancelamento expirado (NF emitida há ${hoursSince.toFixed(1)}h, limite é 24h). Use Carta de Correção (CC-e) se aplicável.`,
        }), { status: 400, headers: corsHeaders });
      }
    }

    // Determine environment from the company that emitted this NF-e.
    // Fall back to fiscal_config only for legacy rows without company_id.
    let ambiente = "homologacao";
    if (nfe.company_id) {
      const { data: company } = await adminClient.from("companies").select("ambiente").eq("id", nfe.company_id).single();
      if (company?.ambiente) ambiente = company.ambiente;
    } else {
      const { data: fiscalConfigs } = await adminClient.from("fiscal_config").select("ambiente").limit(1);
      if (fiscalConfigs?.[0]?.ambiente) ambiente = fiscalConfigs[0].ambiente;
    }
    const baseUrl = ambiente === "producao"
      ? "https://api.focusnfe.com.br"
      : "https://homologacao.focusnfe.com.br";

    // Cancel via Focus NFe — set flag before the call so a timeout that
    // arrives after SEFAZ accepted the cancellation does not auto-rollback.
    _focusCalled = true;
    const focusResponse = await fetch(`${baseUrl}/v2/nfe/${nfe.ref_nfe}`, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${btoa(`${FOCUS_TOKEN}:`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ justificativa: justificativa.trim() }),
      signal: AbortSignal.timeout(30_000),
    });

    const focusText = await focusResponse.text();
    if (focusText.length > 524_288) throw new Error("Resposta da Focus NFe excede o tamanho máximo permitido.");
    let focusData: any;
    try { focusData = JSON.parse(focusText); } catch { focusData = { mensagem: focusText }; }

    // Both conditions must be true: HTTP success AND Focus NFe confirmed status.
    // A 200 with status:'erro' in the body would otherwise be misclassified as
    // success, causing AR to be cancelled while the NF-e is still active.
    const success = focusResponse.ok && focusData?.status === "cancelado";
    const newStatus = success ? "cancelada" : nfe.status;

    // SEFAZ pode devolver o protocolo do evento de cancelamento em campos com
    // nomes diferentes dependendo do status retornado. Capturamos os mais
    // comuns sem sobrescrever `protocolo` (que guarda o protocolo de autorização).
    // Only accept cancellation-event-specific protocol fields; never fall back
    // to focusData?.protocolo (authorization protocol) to avoid writing the
    // authorization protocol into protocolo_cancelamento in audit records.
    const cancellationProtocol = success
      ? (focusData?.protocolo_cancelamento ?? focusData?.numero_protocolo ?? null)
      : null;
    if (success && !cancellationProtocol) {
      console.warn(`cancel-nfe: protocolo de cancelamento ausente na resposta do Focus NFe para nfe_id=${nfe_id}`);
    }

    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      justificativa_cancelamento: justificativa.trim(),
      data_cancelamento: success ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    if (cancellationProtocol) {
      updatePayload.protocolo_cancelamento = cancellationProtocol;
    }

    const { error: updateErr } = await adminClient.from("nfe_emitidas")
      .update(updatePayload)
      .eq("id", nfe_id);
    if (updateErr) throw new Error(`Falha ao salvar cancelamento: ${updateErr.message}`);

    // Cancel the linked accounts_receivable and remove the revenue financial_entry
    // so Finance/DRE stops counting the cancelled sale as income.
    const cleanupWarnings: string[] = [];
    if (success && nfe.sale_order_id) {
      const { error: arErr } = await adminClient.from("accounts_receivable")
        .update({ status: "cancelled" })
        .eq("sale_order_id", nfe.sale_order_id)
        .not("status", "in", "(received,cancelled)");
      if (arErr) {
        console.warn(`cancel-nfe: failed to cancel accounts_receivable for sale_order_id=${nfe.sale_order_id}: ${arErr.message}`);
        cleanupWarnings.push(`AR não cancelada: ${arErr.message}`);
      }

      // Remove only unposted/unpaid revenue entries so DRE doesn't show ghost income.
      // Entries already posted/reconciled are preserved for the accounting audit trail.
      const { error: feErr } = await adminClient.from("financial_entries")
        .delete()
        .eq("reference_id", nfe.sale_order_id)
        .eq("reference_type", "sale_order")
        .not("status", "in", "(posted,reconciled,paid)");
      if (feErr) {
        console.warn(`cancel-nfe: failed to delete financial_entries for sale_order_id=${nfe.sale_order_id}: ${feErr.message}`);
        cleanupWarnings.push(`Lançamento financeiro não removido: ${feErr.message}`);
      }

      // Clear the NF-e number from the sale order so shipping docs and lists don't
      // show a cancelled NF-e number. This is a best-effort cleanup — non-fatal.
      if (nfe.numero) {
        const { error: soErr } = await adminClient.from("sale_orders")
          .update({ nfe: null })
          .eq("id", nfe.sale_order_id)
          .eq("nfe", String(nfe.numero));
        if (soErr) {
          console.warn(`cancel-nfe: failed to clear sale_orders.nfe for ${nfe.sale_order_id}: ${soErr.message}`);
          cleanupWarnings.push(`Número NF-e não removido do PV: ${soErr.message}`);
        }
      }
    }

    return new Response(JSON.stringify({
      success,
      focus_response: focusData,
      ...(cleanupWarnings.length > 0 ? { partial_cleanup_warning: cleanupWarnings.join('; ') } : {}),
    }), {
      status: success ? 200 : 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("cancel-nfe error:", error);
    // Only rollback the 'cancelando' claim if the Focus NFe call had NOT yet
    // started. If it was already called (e.g. AbortSignal timeout mid-response),
    // SEFAZ may have accepted the cancellation — rollback would create a DB/SEFAZ
    // desync. Leave as 'cancelando' so the operator can use "Atualizar status" to
    // poll Focus NFe and reconcile authoritatively.
    if (!_focusCalled && _adminClientForRollback && _claimedNfeId) {
      await _adminClientForRollback.from("nfe_emitidas")
        .update({ status: "autorizada" })
        .eq("id", _claimedNfeId)
        .eq("status", "cancelando");
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
