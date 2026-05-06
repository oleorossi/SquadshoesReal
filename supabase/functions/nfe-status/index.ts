import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    // Server-side role authorization: only admin/gerente can update NF-e records
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
      return new Response(JSON.stringify({ error: "Forbidden: apenas admin ou gerente podem atualizar NF-e" }), { status: 403, headers: corsHeaders });
    }

    const { nfe_id } = await req.json();
    if (!nfe_id) {
      return new Response(JSON.stringify({ error: "nfe_id é obrigatório" }), { status: 400, headers: corsHeaders });
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(String(nfe_id))) {
      return new Response(JSON.stringify({ error: "nfe_id inválido" }), { status: 400, headers: corsHeaders });
    }

    const FOCUS_TOKEN = Deno.env.get("FOCUS_NFE_API_TOKEN");
    if (!FOCUS_TOKEN) {
      return new Response(JSON.stringify({ error: "Token da Focus NFe não configurado" }), { status: 500, headers: corsHeaders });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get NF-e record
    const { data: nfe, error: nfeErr } = await adminClient
      .from("nfe_emitidas")
      .select("*")
      .eq("id", nfe_id)
      .single();

    if (nfeErr || !nfe) {
      return new Response(JSON.stringify({ error: "NF-e não encontrada" }), { status: 404, headers: corsHeaders });
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

    // Query Focus NFe for status
    const focusResponse = await fetch(`${baseUrl}/v2/nfe/${nfe.ref_nfe}`, {
      headers: {
        Authorization: `Basic ${btoa(`${FOCUS_TOKEN}:`)}`,
      },
      signal: AbortSignal.timeout(20_000),
    });

    const focusText = await focusResponse.text();
    if (focusText.length > 524_288) throw new Error("Resposta da Focus NFe excede o tamanho máximo permitido.");
    let focusData: any;
    try {
      focusData = JSON.parse(focusText);
    } catch {
      focusData = { mensagem: focusText };
    }

    // A non-OK Focus response (auth failure, not-found, 5xx) must not be treated
    // as success — the frontend would silently keep the old status forever.
    if (!focusResponse.ok) {
      return new Response(JSON.stringify({
        error: `Focus NFe retornou ${focusResponse.status}: ${focusData?.mensagem || focusText}`,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Map Focus NFe status
    let newStatus = nfe.status;
    if (focusData.status === "autorizado") newStatus = "autorizada";
    else if (focusData.status === "cancelado") newStatus = "cancelada";
    else if (focusData.status === "erro_autorizacao") newStatus = "rejeitada";
    else if (focusData.status === "processando_autorizacao") newStatus = "processando";

    // Update record
    const updateData: any = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (focusData.chave_nfe) updateData.chave_acesso = focusData.chave_nfe;
    if (focusData.numero) updateData.numero = String(focusData.numero);
    if (focusData.serie) updateData.serie = String(focusData.serie);
    if (focusData.caminho_xml_nota_fiscal) updateData.xml_url = focusData.caminho_xml_nota_fiscal;
    if (focusData.caminho_danfe) updateData.danfe_url = focusData.caminho_danfe;
    if (focusData.protocolo) updateData.protocolo = focusData.protocolo;
    // Persist data_emissao whenever Focus returns it and we don't have it yet.
    // Focus may return it before the final 'autorizada' status (e.g., during
    // processando_autorizacao). Without this, if Focus stops returning it on
    // later polls, cancel-nfe would block on "NF-e sem data de emissão".
    if (focusData.data_emissao && !nfe.data_emissao) {
      // Validate before persisting: a bad date would break cancel-nfe's 24h guard.
      const raw = String(focusData.data_emissao);
      const norm = /Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw + "Z";
      const t = new Date(norm).getTime();
      if (!Number.isNaN(t) && t > 0 && t < Date.now() + 86_400_000) {
        updateData.data_emissao = focusData.data_emissao;
      } else {
        console.warn(`nfe-status: ignoring invalid data_emissao from Focus NFe: ${raw}`);
      }
    }
    if (focusData.mensagem_sefaz) updateData.motivo_rejeicao = focusData.mensagem_sefaz;

    // Conditional update: only apply changes if the row hasn't already been
    // transitioned by a parallel poll (e.g. two browser tabs). Without this,
    // last-write-wins can revert "autorizada" back to "processando".
    const { data: updatedRows, error: updateNfeErr } = await adminClient
      .from("nfe_emitidas")
      .update(updateData)
      .eq("id", nfe_id)
      .eq("status", nfe.status)
      .select("id");
    if (updateNfeErr) throw new Error(`Falha ao atualizar NF-e: ${updateNfeErr.message}`);
    if (!updatedRows || updatedRows.length === 0) {
      // Another poll already advanced the status — return current state without re-applying.
      console.warn(`nfe-status: status changed concurrently for nfe ${nfe_id}; skipping update.`);
    }

    // Update sale order nfe field if authorized — skip when the conditional
    // update matched 0 rows (concurrent poll already advanced status).
    if (newStatus === "autorizada" && focusData.numero && nfe.sale_order_id
        && updatedRows && updatedRows.length > 0) {
      const { error: updateSoErr } = await adminClient
        .from("sale_orders")
        .update({ nfe: String(focusData.numero) })
        .eq("id", nfe.sale_order_id);
      if (updateSoErr) console.error("nfe-status: failed to update sale_order.nfe:", updateSoErr.message);
    }

    return new Response(JSON.stringify({
      success: true,
      nfe: { ...nfe, ...updateData },
      focus_response: focusData,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("nfe-status error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
