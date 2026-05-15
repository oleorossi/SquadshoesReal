import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const GESTAOCLICK_BASE = "https://api.gestaoclick.com";
const MAX_PAGES = 20;

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

async function gcFetch(path: string) {
  const res = await fetch(`${GESTAOCLICK_BASE}${path}`, {
    headers: gcHeaders(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (text.length > 2_097_152) throw new Error("Resposta do GestaoClick excede o tamanho máximo.");
  let json: any;
  try { json = JSON.parse(text); } catch { json = { mensagem: text }; }
  return { ok: res.ok, status: res.status, json };
}

function mapSituacao(situacao: string): string {
  const s = (situacao || "").toLowerCase();
  if (s.includes("aprovada") || s.includes("autorizada")) return "autorizada";
  if (s.includes("cancelada")) return "cancelada";
  if (s.includes("rejeitada") || s.includes("denegada") || s.includes("erro")) return "rejeitada";
  if (s.includes("processando") || s.includes("aberta") || s.includes("aguardando")) return "processando";
  return "processando";
}

function extractPvNumber(info: string | null | undefined): string | null {
  if (!info) return null;
  const m = info.match(/Pedido\s+de\s+Venda\s*:?\s*([A-Za-z0-9-]+)/i);
  return m ? m[1].trim() : null;
}

function parseEmissaoTs(d: any): string | null {
  const date = d?.data_emissao;
  const time = d?.hora_emissao;
  if (!date) return null;
  const iso = time ? `${date}T${time}` : String(date);
  const norm = /Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + "-03:00";
  const t = new Date(norm).getTime();
  if (Number.isNaN(t) || t <= 0 || t > Date.now() + 86_400_000) return null;
  return norm;
}

function digitsOnly(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
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
      return new Response(JSON.stringify({ error: "Forbidden: apenas admin, gerente ou operador NF-e podem sincronizar" }), { status: 403, headers: corsHeaders });
    }

    // ---------- Pré-carrega lookups (empresas e PVs por número) ----------
    const { data: companies } = await adminClient
      .from("companies")
      .select("id, cnpj")
      .eq("active", true);
    const companyByCnpj = new Map<string, string>();
    for (const c of companies || []) {
      const key = digitsOnly(c.cnpj);
      if (key) companyByCnpj.set(key, c.id);
    }

    // ---------- Pagina endpoint de NFs até esgotar ----------
    const collected: any[] = [];
    let pagesFetched = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      pagesFetched = page;
      const r = await gcFetch(`/notas_fiscais_produtos?page=${page}`);
      if (!r.ok || r.json?.status === "error") {
        return new Response(JSON.stringify({
          error: `GestaoClick retornou ${r.status}: ${r.json?.message || r.json?.mensagem || JSON.stringify(r.json)}`,
        }), { status: 502, headers: corsHeaders });
      }
      const list: any[] = Array.isArray(r.json?.data)
        ? r.json.data
        : Array.isArray(r.json?.data?.data)
        ? r.json.data.data
        : [];
      if (list.length === 0) break;
      collected.push(...list);
      // Heurística de parada: se o provedor retorna meta.total_pages, respeita.
      const totalPages = r.json?.meta?.total_pages || r.json?.meta?.pagination?.total_pages;
      if (totalPages && page >= Number(totalPages)) break;
    }

    let created = 0;
    let updated = 0;
    const errors: Array<{ provider_id: string | null; error: string }> = [];

    for (const summary of collected) {
      const providerId = String(summary?.id || "");
      if (!providerId) {
        errors.push({ provider_id: null, error: "NF sem id no retorno do provedor" });
        continue;
      }

      // Detalhe completo: lista resumida não traz chave/protocolo na maioria
      // dos casos; busca individual pra preencher os campos legais.
      let d: any = summary;
      const detail = await gcFetch(`/notas_fiscais_produtos/${providerId}`);
      if (detail.ok && detail.json?.data && typeof detail.json.data === "object") {
        d = { ...summary, ...detail.json.data };
      }

      const status = mapSituacao(d?.situacao_nf || d?.situacao || "");
      const chave = d?.chave || "";
      const protocolo = d?.protocolo || "";
      const numero = d?.numero_nf ? String(d.numero_nf) : (d?.numero ? String(d.numero) : "");
      const serie = d?.serie ? String(d.serie) : "";
      // GestaoClick devolve `valor_total_nf` no detalhe (string com 2 casas).
      // Fallback p/ valor_produtos / valor_total / valor caso o schema mude.
      const valor = Number(
        d?.valor_total_nf ?? d?.valor_produtos ?? d?.valor_total ?? d?.valor ?? 0,
      );
      const emissaoTs = parseEmissaoTs(d);
      const cnpjEmit = digitsOnly(d?.cnpj_emitente || d?.emitente?.cnpj);
      const info = d?.informacoes_complementares || d?.observacao || "";
      const pvNum = extractPvNumber(info);

      // Destinatário: gravado direto na NF pra identificar quando não há PV vinculado.
      // GestaoClick varia o shape entre endpoints: `cliente` (objeto) no detalhe,
      // `cliente_nome`/`cliente_cnpj` (string) no resumo de algumas versões da API.
      const nomeDest =
        d?.cliente?.nome ||
        d?.cliente?.razao_social ||
        d?.destinatario?.nome ||
        d?.cliente_nome ||
        d?.nome_cliente ||
        null;
      const cnpjDest = digitsOnly(
        d?.cliente?.cnpj ||
          d?.cliente?.cpf ||
          d?.destinatario?.cnpj ||
          d?.destinatario?.cpf ||
          d?.cliente_cnpj ||
          d?.cliente_cpf ||
          "",
      ) || null;

      // Resolve sale_order_id: 1) mantém o existente se já tem registro; 2)
      // tenta achar por número do PV mencionado nas observações; 3) deixa NULL.
      let saleOrderId: string | null = null;
      const { data: existing } = await adminClient
        .from("nfe_emitidas")
        .select("id, sale_order_id")
        .eq("provider_nfe_id", providerId)
        .maybeSingle();

      if (existing?.sale_order_id) {
        saleOrderId = existing.sale_order_id;
      } else if (pvNum) {
        const { data: so } = await adminClient
          .from("sale_orders")
          .select("id")
          .eq("order_number", pvNum)
          .maybeSingle();
        saleOrderId = so?.id ?? null;
      }

      const companyId = cnpjEmit ? (companyByCnpj.get(cnpjEmit) ?? null) : null;

      const refNfe = existing
        ? undefined
        : (saleOrderId ? `gc-sync-${saleOrderId}-${providerId}` : `gc-sync-${providerId}`);

      const payload: Record<string, any> = {
        provider_nfe_id: providerId,
        status,
        chave_acesso: chave || null,
        protocolo: protocolo || null,
        numero: numero || "",
        serie: serie || "",
        valor_total: Number.isFinite(valor) ? valor : 0,
        cnpj_emitente: cnpjEmit || "",
        sale_order_id: saleOrderId,
        company_id: companyId,
        nome_destinatario: nomeDest,
        cnpj_destinatario: cnpjDest,
        updated_at: new Date().toISOString(),
      };
      if (emissaoTs) payload.data_emissao = emissaoTs;
      if (refNfe) payload.ref_nfe = refNfe;

      if (existing) {
        const { error: upErr } = await adminClient
          .from("nfe_emitidas")
          .update(payload)
          .eq("id", existing.id);
        if (upErr) {
          errors.push({ provider_id: providerId, error: `update: ${upErr.message}` });
        } else {
          updated++;
        }
      } else {
        const { error: insErr } = await adminClient
          .from("nfe_emitidas")
          .insert(payload);
        if (insErr) {
          // 23505 = conflito (race condition): tenta update
          if ((insErr as any)?.code === "23505") {
            const { error: retryErr } = await adminClient
              .from("nfe_emitidas")
              .update(payload)
              .eq("provider_nfe_id", providerId);
            if (retryErr) {
              errors.push({ provider_id: providerId, error: `retry: ${retryErr.message}` });
            } else {
              updated++;
            }
          } else {
            errors.push({ provider_id: providerId, error: `insert: ${insErr.message}` });
          }
        } else {
          created++;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      pages_fetched: pagesFetched,
      total_seen: collected.length,
      created,
      updated,
      errors,
    }), {
      headers: corsHeaders,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("sync-nfe-from-provider error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
