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
    if (nfe.status !== "autorizada") {
      return new Response(JSON.stringify({ error: "Somente NF-e autorizadas podem ser canceladas" }), { status: 400, headers: corsHeaders });
    }
    if (!nfe.provider_nfe_id) {
      return new Response(JSON.stringify({
        error: "NF-e sem ID do provedor — impossível cancelar via API. Use o painel do GestaoClick.",
      }), { status: 400, headers: corsHeaders });
    }

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

    _providerCalled = true;
    const providerResp = await fetch(
      `${GESTAOCLICK_BASE}/notas_fiscais_produtos/cancelar/${nfe.provider_nfe_id}`,
      {
        method: "POST",
        headers: gcHeaders(),
        body: JSON.stringify({ motivo: justificativa.trim() }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const providerText = await providerResp.text();
    if (providerText.length > 524_288) throw new Error("Resposta do GestaoClick excede o tamanho máximo permitido.");
    let providerData: any;
    try { providerData = JSON.parse(providerText); } catch { providerData = { mensagem: providerText }; }

    const success = providerResp.ok
      && providerData?.status !== "error"
      && providerData?.data?.ok !== false;

    let cancellationProtocol: string | null = null;
    if (success) {
      try {
        const detailResp = await fetch(`${GESTAOCLICK_BASE}/notas_fiscais_produtos/${nfe.provider_nfe_id}`, {
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
    if (success && nfe.sale_order_id) {
      const { error: arErr } = await adminClient.from("accounts_receivable")
        .update({ status: "cancelled" })
        .eq("sale_order_id", nfe.sale_order_id)
        .not("status", "in", "(received,cancelled)");
      if (arErr) cleanupWarnings.push(`AR não cancelada: ${arErr.message}`);

      const { error: feErr } = await adminClient.from("financial_entries")
        .delete()
        .eq("reference_id", nfe.sale_order_id)
        .eq("reference_type", "sale_order")
        .not("status", "in", "(posted,reconciled,paid,confirmed)");
      if (feErr) cleanupWarnings.push(`Lançamento financeiro não removido: ${feErr.message}`);

      if (nfe.numero) {
        const { error: soErr } = await adminClient.from("sale_orders")
          .update({ nfe: null })
          .eq("id", nfe.sale_order_id)
          .eq("nfe", String(nfe.numero));
        if (soErr) cleanupWarnings.push(`Número NF-e não removido do PV: ${soErr.message}`);
      }
    }

    return new Response(JSON.stringify({
      success,
      provider_response: providerData,
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
