import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const CLICKNOTAS_BASE = "https://api.clicknotas.com";

interface CancellationBeginResult {
  ok: boolean;
  code?: string;
  provider_call_required?: boolean;
  reconciliation_required?: boolean;
  cancellation_state?: string | null;
  next_retry_at?: string | null;
  data_emissao?: string | null;
  provider_nfe_id?: string | null;
}

interface CancellationProviderResponse {
  status?: string;
  mensagem?: string;
  data?: { ok?: boolean };
  [key: string]: unknown;
}

interface LocalCancellationResult {
  reconciliation_needed?: boolean;
  reconciliation_reason?: string | null;
  idempotent_replay?: boolean;
  [key: string]: unknown;
}

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

  let _adminClientForAbort: ReturnType<typeof createClient> | null = null;
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
    _adminClientForAbort = adminClient;
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
      p.can_view === true &&
      p.can_edit === true &&
      (p.module === "nfe" || p.module === "/nfe")
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

    // NF-e e PV são lidos/travados no banco na ordem fiscal canônica. A Edge
    // nunca faz UPDATE service-role cru desses agregados.
    const { data: beginRaw, error: beginErr } = await adminClient.rpc(
      "begin_nfe_cancellation_command",
      { p_nfe_id: nfe_id, p_justification: justificativa.trim() },
    );
    if (beginErr || !beginRaw?.ok) {
      const code = beginErr?.code;
      const status = code === "P0002" ? 404
        : ["PZ220", "PZ221", "40001", "55P03"].includes(String(code)) ? 409
        : 400;
      return new Response(JSON.stringify({
        error: beginErr?.message || beginRaw?.code || "Cancelamento recusado pelo banco.",
      }), { status, headers: corsHeaders });
    }
    const begin = beginRaw as unknown as CancellationBeginResult;
    const providerCallRequired = begin.provider_call_required === true;
    const resumableProviderConfirmedStates = new Set([
      "provider_cancelled",
      "manual_review",
      "completed",
    ]);
    if (
      !providerCallRequired &&
      begin.reconciliation_required === true &&
      !resumableProviderConfirmedStates.has(String(begin.cancellation_state || ""))
    ) {
      // Um POST anterior pode ter chegado ao provedor e a resposta ter se
      // perdido. Nesse estado, completar localmente seria tão perigoso quanto
      // repetir cegamente o cancelamento externo: o poller monotônico precisa
      // primeiro observar uma confirmação conclusiva do ClickNotas.
      return new Response(JSON.stringify({
        success: false,
        pending: true,
        reconciliation_needed: true,
        error: "Cancelamento ainda sem confirmação conclusiva do provedor.",
        cancellation_state: begin.cancellation_state,
        next_retry_at: begin.next_retry_at,
      }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    _claimedNfeId = providerCallRequired ? nfe_id : null;

    const abortClaim = async (reason: string) => {
      const { data, error } = await adminClient.rpc(
        "abort_nfe_cancellation_command",
        { p_nfe_id: nfe_id, p_reason: reason },
      );
      if (error || data?.ok !== true) {
        console.error("cancel-nfe: falha ao abortar claim:", error || data);
        return false;
      }
      _claimedNfeId = null;
      return true;
    };

    let providerData: CancellationProviderResponse | null = providerCallRequired
      ? null
      : { idempotent_replay: true, provider_call_skipped: true };
    let cancellationProtocol: string | null = null;

    if (providerCallRequired) {
      // data_emissao e provider_nfe_id vêm do mesmo claim transacional que
      // recusou PV Expedido/Concluído/Finalizado.
      const dataEmissaoForCheck = begin.data_emissao;
      if (!dataEmissaoForCheck) {
        const aborted = await abortClaim("Claim sem data de emissão; provedor não chamado");
        return new Response(JSON.stringify({
          error: "NF-e sem data de emissão registrada — impossível verificar prazo de 24h. Sincronize o status da NF-e antes de tentar cancelar.",
          ...(!aborted ? { reconciliation_needed: true } : {}),
        }), { status: aborted ? 400 : 500, headers: corsHeaders });
      }
      const raw = String(dataEmissaoForCheck);
      // Sem timezone explícito, normaliza como horário de Brasília (−03:00),
      // idêntico ao que emit-nfe grava.
      const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw + "-03:00";
      const emittedAt = new Date(normalized).getTime();
      if (Number.isNaN(emittedAt)) {
        const aborted = await abortClaim("Data de emissão inválida; provedor não chamado");
        return new Response(JSON.stringify({
          error: "Data de emissão da NF-e inválida — impossível verificar prazo de 24h.",
          ...(!aborted ? { reconciliation_needed: true } : {}),
        }), { status: aborted ? 400 : 500, headers: corsHeaders });
      }
      const hoursSince = (Date.now() - emittedAt) / 36e5;
      if (hoursSince > 24) {
        const aborted = await abortClaim("Prazo de 24h expirado; provedor não chamado");
        return new Response(JSON.stringify({
          error: `Prazo de cancelamento expirado (NF emitida há ${hoursSince.toFixed(1)}h, limite é 24h). Use Carta de Correção (CC-e) se aplicável.`,
          ...(!aborted ? { reconciliation_needed: true } : {}),
        }), { status: aborted ? 400 : 500, headers: corsHeaders });
      }

      const providerHeaders = gcHeaders();
      _providerCalled = true;
      const providerResp = await fetch(
        `${CLICKNOTAS_BASE}/notas_fiscais_produtos/cancelar/${begin.provider_nfe_id}`,
        {
          method: "POST",
          headers: providerHeaders,
          body: JSON.stringify({ motivo: justificativa.trim() }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const providerText = await providerResp.text();
      if (providerText.length > 524_288) {
        throw new Error("Resposta do ClickNotas excede o tamanho máximo permitido.");
      }
      try { providerData = JSON.parse(providerText) as CancellationProviderResponse; } catch { providerData = { mensagem: providerText }; }

      const providerConfirmed = providerResp.ok
        && providerData?.status !== "error"
        && providerData?.data?.ok !== false;
      if (!providerConfirmed) {
        // 4xx e erro funcional em resposta 2xx são rejeições conclusivas. Em
        // 5xx/timeout a resposta é ambígua: mantém cancelando para reconciliação
        // e jamais reautoriza uma NF que pode ter sido cancelada externamente.
        const deterministicRejection =
          (providerResp.status >= 400 && providerResp.status < 500)
          || providerResp.ok;
        let claimAborted = false;
        if (deterministicRejection) {
          claimAborted = await abortClaim(
            `Provedor recusou o cancelamento (HTTP ${providerResp.status})`,
          );
        }
        const reconciliationNeeded = !deterministicRejection || !claimAborted;
        return new Response(JSON.stringify({
          success: false,
          provider_response: providerData,
          ...(reconciliationNeeded ? {
            reconciliation_needed: true,
            error: "Resposta do provedor/local é ambígua; NF-e mantida em cancelando para reconciliação.",
          } : {}),
        }), {
          status: reconciliationNeeded ? 502 : 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        const detailResp = await fetch(`${CLICKNOTAS_BASE}/notas_fiscais_produtos/${begin.provider_nfe_id}`, {
          headers: providerHeaders,
          signal: AbortSignal.timeout(15_000),
        });
        const detailText = await detailResp.text();
        const detail = JSON.parse(detailText);
        cancellationProtocol = detail?.data?.protocolo_cancelamento ?? null;
      } catch (e) {
        console.warn("cancel-nfe: falha ao buscar protocolo de cancelamento:", e);
      }
    }

    const { data: localRaw, error: localErr } = providerCallRequired
      ? await adminClient.rpc(
        "observe_nfe_provider_status_126",
        {
          p_nfe_id: nfe_id,
          p_provider_status: "cancelada",
          p_snapshot: {
            provider_nfe_id: begin.provider_nfe_id,
            ...(cancellationProtocol
              ? { protocolo_cancelamento: cancellationProtocol }
              : {}),
          },
          p_source: "cancel-nfe",
        },
      )
      : await adminClient.rpc(
        "complete_nfe_cancellation_command",
        {
          p_nfe_id: nfe_id,
          p_justification: justificativa.trim(),
          p_cancellation_protocol: cancellationProtocol,
        },
      );
    if (localErr || localRaw?.ok !== true) {
      return new Response(JSON.stringify({
        error: localErr?.message || localRaw?.code || "Provedor confirmou, mas o commit local falhou.",
        reconciliation_needed: true,
        provider_response: providerData,
      }), { status: 500, headers: corsHeaders });
    }
    _claimedNfeId = null;
    const localCancellation = localRaw as unknown as LocalCancellationResult;

    const cleanupWarnings: string[] = [];
    const standaloneStockWarning = localCancellation.reconciliation_needed === true
      ? String(localCancellation.reconciliation_reason || "Estorno de estoque avulso pendente")
      : null;
    if (standaloneStockWarning) {
      cleanupWarnings.push(`Estorno de estoque pendente: ${standaloneStockWarning}`);
    }
    return new Response(JSON.stringify({
      success: true,
      idempotent_replay: localCancellation.idempotent_replay === true,
      provider_response: providerData,
      local_cancellation: localCancellation,
      ...(standaloneStockWarning ? {
        reconciliation_needed: true,
        stock_reconciliation_warning: standaloneStockWarning,
      } : {}),
      ...(cleanupWarnings.length > 0 ? { partial_cleanup_warning: cleanupWarnings.join("; ") } : {}),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("cancel-nfe error:", error);
    let reconciliationNeeded = _providerCalled && _claimedNfeId !== null;
    if (!_providerCalled && _adminClientForAbort && _claimedNfeId) {
      const { error: abortErr } = await _adminClientForAbort.rpc(
        "abort_nfe_cancellation_command",
        {
          p_nfe_id: _claimedNfeId,
          p_reason: "Falha local antes da chamada ao provedor",
        },
      );
      reconciliationNeeded = !!abortErr;
    }
    return new Response(JSON.stringify({
      error: msg,
      ...(reconciliationNeeded ? { reconciliation_needed: true } : {}),
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
