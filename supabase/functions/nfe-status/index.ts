import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  };
}

function mapSituacao(situacao: string): string {
  const s = (situacao || "").toLowerCase();
  if (s.includes("aprovada") || s.includes("autorizada")) return "autorizada";
  if (s.includes("cancelada")) return "cancelada";
  if (s.includes("rejeitada") || s.includes("denegada") || s.includes("erro")) return "rejeitada";
  if (s.includes("processando") || s.includes("aberta") || s.includes("aguardando")) return "processando";
  return "processando";
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
      return new Response(JSON.stringify({ error: "Forbidden: apenas admin, gerente ou operador NF-e podem atualizar NF-e" }), { status: 403, headers: corsHeaders });
    }

    const { nfe_id } = await req.json();
    if (!nfe_id) {
      return new Response(JSON.stringify({ error: "nfe_id é obrigatório" }), { status: 400, headers: corsHeaders });
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(String(nfe_id))) {
      return new Response(JSON.stringify({ error: "nfe_id inválido" }), { status: 400, headers: corsHeaders });
    }

    const { data: nfe, error: nfeErr } = await adminClient
      .from("nfe_emitidas").select("*").eq("id", nfe_id).single();
    if (nfeErr || !nfe) {
      return new Response(JSON.stringify({ error: "NF-e não encontrada" }), { status: 404, headers: corsHeaders });
    }
    if (!nfe.provider_nfe_id) {
      return new Response(JSON.stringify({
        error: "NF-e sem ID do provedor — sincronização indisponível. Verifique a NF no painel GestaoClick.",
      }), { status: 400, headers: corsHeaders });
    }

    const detailResp = await fetch(
      `${GESTAOCLICK_BASE}/notas_fiscais_produtos/${nfe.provider_nfe_id}`,
      { headers: gcHeaders(), signal: AbortSignal.timeout(20_000) },
    );
    const detailText = await detailResp.text();
    if (detailText.length > 524_288) throw new Error("Resposta do GestaoClick excede o tamanho máximo permitido.");
    let detailData: any;
    try { detailData = JSON.parse(detailText); } catch { detailData = { mensagem: detailText }; }

    if (!detailResp.ok || detailData?.status === "error") {
      return new Response(JSON.stringify({
        error: `GestaoClick retornou ${detailResp.status}: ${detailData?.message || detailData?.mensagem || detailText}`,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const d = detailData?.data || {};
    const newStatus = mapSituacao(d.situacao_nf);

    const updateData: any = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };
    if (d.chave) updateData.chave_acesso = d.chave;
    if (d.numero_nf) updateData.numero = String(d.numero_nf);
    if (d.serie) updateData.serie = String(d.serie);
    if (d.protocolo) updateData.protocolo = d.protocolo;

    // GestaoClick retorna URLs do DANFE/XML em campos variáveis — tenta os
    // nomes mais comuns. Antes ficavam vazios no DB e o user não tinha como
    // baixar PDF/XML pelo menu da NF (botões não apareciam).
    const danfeUrl = d.url_danfe || d.danfe_url || d.url_pdf || d.link_pdf || d.url_pdf_danfe || d.link_danfe || '';
    const xmlUrl = d.url_xml || d.xml_url || d.link_xml || d.url_xml_nfe || '';
    if (danfeUrl) updateData.danfe_url = String(danfeUrl);
    if (xmlUrl) updateData.xml_url = String(xmlUrl);
    if (d.data_emissao && !nfe.data_emissao) {
      const time = d.hora_emissao ? `${d.data_emissao}T${d.hora_emissao}` : d.data_emissao;
      const norm = /Z$|[+-]\d{2}:\d{2}$/.test(time) ? time : time + "-03:00";
      const t = new Date(norm).getTime();
      if (!Number.isNaN(t) && t > 0 && t < Date.now() + 86_400_000) {
        updateData.data_emissao = norm;
      }
    }
    if (newStatus === "rejeitada" && d.mensagem) updateData.motivo_rejeicao = d.mensagem;

    const { data: updatedRows, error: updateNfeErr } = await adminClient
      .from("nfe_emitidas")
      .update(updateData)
      .eq("id", nfe_id)
      .eq("status", nfe.status)
      .select("id");
    if (updateNfeErr) throw new Error(`Falha ao atualizar NF-e: ${updateNfeErr.message}`);

    if (newStatus === "autorizada" && d.numero_nf && nfe.sale_order_id
        && updatedRows && updatedRows.length > 0) {
      // FIX M1: avança PV pra "Faturado" quando NF-e autoriza via polling
      // (status='processando' → 'autorizada'). Antes só o caminho síncrono
      // do emit-nfe disparava esse update — emissão assíncrona ficava com
      // AR/financial_entries órfãos.
      const { error: updateSoErr } = await adminClient
        .from("sale_orders")
        .update({ nfe: String(d.numero_nf), status: "Faturado" })
        .eq("id", nfe.sale_order_id)
        .not("status", "in", "(Cancelado,Faturado)");
      if (updateSoErr) console.error("nfe-status: failed to update sale_order:", updateSoErr.message);
    }

    return new Response(JSON.stringify({
      success: true,
      nfe: { ...nfe, ...updateData },
      provider_response: detailData,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("nfe-status error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
