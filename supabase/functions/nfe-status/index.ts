import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  };
}

// Espelha mapSituacao de emit-nfe / sync-nfe-from-provider — ver o comentário
// completo lá. "Reprovada" (rejeição SEFAZ) e "Corrigida" (autorizada com
// CC-e) são valores reais da conta que caíam no default "processando".
function mapSituacao(situacao: string): string {
  const s = (situacao || "").toLowerCase();
  if (s.includes("reprovada") || s.includes("rejeitada") || s.includes("denegada") || s.includes("erro")) return "rejeitada";
  if (s.includes("aprovada") || s.includes("autorizada") || s.includes("corrigida")) return "autorizada";
  if (s.includes("cancelada")) return "cancelada";
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
        error: "NF-e sem ID do provedor — sincronização indisponível. Verifique a NF no painel ClickNotas.",
      }), { status: 400, headers: corsHeaders });
    }

    const detailResp = await fetch(
      `${CLICKNOTAS_BASE}/notas_fiscais_produtos/${nfe.provider_nfe_id}`,
      { headers: gcHeaders(), signal: AbortSignal.timeout(20_000) },
    );
    const detailText = await detailResp.text();
    if (detailText.length > 524_288) throw new Error("Resposta do ClickNotas excede o tamanho máximo permitido.");
    let detailData: any;
    try { detailData = JSON.parse(detailText); } catch { detailData = { mensagem: detailText }; }

    if (!detailResp.ok || detailData?.status === "error") {
      return new Response(JSON.stringify({
        error: `ClickNotas retornou ${detailResp.status}: ${detailData?.message || detailData?.mensagem || detailText}`,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const d = detailData?.data || {};
    const newStatus = mapSituacao(d.situacao_nf);

    const providerSnapshot: Record<string, unknown> = {
      provider_nfe_id: nfe.provider_nfe_id,
    };
    if (d.chave) providerSnapshot.chave_acesso = d.chave;
    if (d.numero_nf) providerSnapshot.numero = String(d.numero_nf);
    if (d.serie) providerSnapshot.serie = String(d.serie);
    if (d.protocolo) providerSnapshot.protocolo = d.protocolo;
    if (d.protocolo_cancelamento) {
      providerSnapshot.protocolo_cancelamento = d.protocolo_cancelamento;
    }

    // ⚠ NENHUM destes campos existe na API do ClickNotas — a spec não traz
    // URL de arquivo em lugar nenhum, e `danfe_url`/`xml_url` estão vazios em
    // 100% das notas do banco (auditoria 31/07/2026). O DANFE é renderizado no
    // app (lib/danfe.ts) e o XML fica no viewer meudanfe.com.br/consulta/{chave}
    // — ver nfe-download, já descontinuada. As tentativas ficam por defesa,
    // caso o provedor passe a expor: não custam requisição, é só leitura do
    // detalhe que já foi buscado. Não gastar tempo "consertando" isso.
    const danfeUrl = d.url_danfe || d.danfe_url || d.url_pdf || d.link_pdf || d.url_pdf_danfe || d.link_danfe || '';
    const xmlUrl = d.url_xml || d.xml_url || d.link_xml || d.url_xml_nfe || '';
    if (danfeUrl) providerSnapshot.danfe_url = String(danfeUrl);
    if (xmlUrl) providerSnapshot.xml_url = String(xmlUrl);
    if (d.data_emissao) {
      const time = d.hora_emissao ? `${d.data_emissao}T${d.hora_emissao}` : d.data_emissao;
      const norm = /Z$|[+-]\d{2}:\d{2}$/.test(time) ? time : time + "-03:00";
      const t = new Date(norm).getTime();
      if (!Number.isNaN(t) && t > 0 && t < Date.now() + 86_400_000) {
        providerSnapshot.data_emissao = norm;
      }
    }
    if (newStatus === "rejeitada" && d.mensagem) {
      providerSnapshot.motivo_rejeicao = d.mensagem;
    }

    // A RPC serializa NF/PV na ordem fiscal canônica, impede regressão de
    // estado e grava o número no PV sem faturá-lo automaticamente.
    const { data: observation, error: observationErr } = await adminClient.rpc(
      "observe_nfe_provider_status_126",
      {
        p_nfe_id: nfe_id,
        p_provider_status: newStatus,
        p_snapshot: providerSnapshot,
        p_source: "nfe-status",
      },
    );
    if (observationErr) {
      throw new Error(`Falha ao reconciliar NF-e: ${observationErr.message}`);
    }
    const reconciliationPending = observation?.ok === false
      && observation?.reconciliation_required === true;

    return new Response(JSON.stringify({
      success: !reconciliationPending,
      ...(reconciliationPending ? { reconciliation_needed: true } : {}),
      nfe: {
        ...nfe,
        ...providerSnapshot,
        status: observation?.local_status ?? nfe.status,
      },
      observation,
      provider_response: detailData,
    }), {
      status: reconciliationPending ? 202 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("nfe-status error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
