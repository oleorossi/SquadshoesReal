// nfe-download v3 — proxy GestaoClick → cliente pra DANFE (PDF) e XML.
//
// V3: além de tentar paths estáticos, busca o JSON de detalhe da NF e
// extrai recursivamente qualquer string que pareça URL (.pdf, .xml,
// http://...) e tenta fazer fetch dela. Diagnóstico verbose no response
// de erro.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const GESTAOCLICK_BASE = "https://api.gestaoclick.com";

function gcHeaders() {
  return {
    "access-token": Deno.env.get("GESTAOCLICK_TOKEN") ?? "",
    "user-token": Deno.env.get("GESTAOCLICK_USER_TOKEN") ?? "",
  };
}

const DANFE_PATHS = [
  "/notas_fiscais_produtos/{id}/danfe",
  "/notas_fiscais_produtos/{id}/pdf",
  "/notas_fiscais_produtos/{id}/imprimir",
  "/notas_fiscais_produtos/{id}/baixar/danfe",
  "/notas_fiscais_produtos/{id}/baixar",
  "/notas_fiscais_produtos/{id}/arquivo/pdf",
  "/notas_fiscais_produtos/{id}/arquivo/danfe",
  "/notas_fiscais_produtos/danfe/{id}",
  "/notas_fiscais_produtos/pdf/{id}",
  "/notas_fiscais/{id}/danfe",
  "/notas_fiscais/{id}/pdf",
];
const XML_PATHS = [
  "/notas_fiscais_produtos/{id}/xml",
  "/notas_fiscais_produtos/{id}/xml-autorizado",
  "/notas_fiscais_produtos/{id}/download-xml",
  "/notas_fiscais_produtos/{id}/baixar/xml",
  "/notas_fiscais_produtos/{id}/arquivo/xml",
  "/notas_fiscais_produtos/xml/{id}",
  "/notas_fiscais/{id}/xml",
];

function collectUrls(obj: any, format: "danfe" | "xml", out: string[] = []): string[] {
  if (!obj || out.length > 50) return out;
  if (typeof obj === "string") {
    const s = obj.trim();
    if (s.startsWith("http") && s.length < 2000) {
      const lower = s.toLowerCase();
      const wantPdf = format === "danfe" && (lower.includes(".pdf") || lower.includes("danfe") || lower.includes("pdf"));
      const wantXml = format === "xml" && (lower.includes(".xml") || lower.includes("xml"));
      if (wantPdf || wantXml) out.push(s);
    }
    return out;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) collectUrls(v, format, out);
    return out;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const lower = k.toLowerCase();
      const v = obj[k];
      if (typeof v === "string" && v.startsWith("http")) {
        const isDanfeKey = /danfe|pdf|imprim/.test(lower);
        const isXmlKey = /xml/.test(lower);
        if ((format === "danfe" && isDanfeKey) || (format === "xml" && isXmlKey)) {
          if (!out.includes(v)) out.push(v);
        }
      }
      collectUrls(v, format, out);
    }
  }
  return out;
}

async function fetchBinary(url: string, errors: string[]): Promise<{
  ok: boolean; status: number; contentType: string; body: Uint8Array | null;
}> {
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: gcHeaders(),
      signal: AbortSignal.timeout(25_000),
    });
    const contentType = r.headers.get("content-type") || "application/octet-stream";
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      errors.push(`${url} → ${r.status}: ${text.slice(0, 200)}`);
      return { ok: false, status: r.status, contentType, body: null };
    }
    if (contentType.startsWith("text/html")) {
      errors.push(`${url} → HTML em vez de binário`);
      return { ok: false, status: r.status, contentType, body: null };
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (contentType.includes("application/json")) {
      try {
        const j = JSON.parse(new TextDecoder().decode(buf));
        const inline = j?.url || j?.data?.url || j?.link || j?.data?.link || j?.data?.url_pdf || j?.data?.url_xml;
        if (typeof inline === "string" && inline.startsWith("http")) {
          const r2 = await fetch(inline, { signal: AbortSignal.timeout(25_000) });
          if (r2.ok) {
            return {
              ok: true,
              status: r2.status,
              contentType: r2.headers.get("content-type") || contentType,
              body: new Uint8Array(await r2.arrayBuffer()),
            };
          }
          errors.push(`inline ${inline} → ${r2.status}`);
          return { ok: false, status: r2.status, contentType, body: null };
        }
        errors.push(`${url} JSON sem url: ${new TextDecoder().decode(buf).slice(0, 250)}`);
        return { ok: false, status: r.status, contentType, body: null };
      } catch { /* binário JSON-like, ignora */ }
    }
    return { ok: true, status: r.status, contentType, body: buf };
  } catch (e: unknown) {
    errors.push(`${url} → ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, status: 0, contentType: "", body: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const nfeId = url.searchParams.get("nfe_id");
    const format = (url.searchParams.get("format") || "").toLowerCase() as "danfe" | "xml";
    if (!nfeId || (format !== "danfe" && format !== "xml")) {
      return new Response(JSON.stringify({
        error: "Parâmetros obrigatórios: nfe_id (uuid) e format=danfe|xml",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: nfe, error: nfeErr } = await adminClient
      .from("nfe_emitidas")
      .select("id, provider_nfe_id, numero, serie, chave_acesso, status")
      .eq("id", nfeId)
      .single();
    if (nfeErr || !nfe) {
      return new Response(JSON.stringify({ error: "NF-e não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!nfe.provider_nfe_id) {
      return new Response(JSON.stringify({
        error: "NF-e sem provider_nfe_id — não dá pra baixar do GestaoClick.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (nfe.status !== "autorizada") {
      return new Response(JSON.stringify({
        error: `NF-e em status '${nfe.status}' — download disponível só pra autorizada.`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const errors: string[] = [];
    const id = String(nfe.provider_nfe_id);

    // FASE 1: tenta caminhos diretos
    const staticPaths = format === "danfe" ? DANFE_PATHS : XML_PATHS;
    for (const tmpl of staticPaths) {
      const u = `${GESTAOCLICK_BASE}${tmpl.replace("{id}", id)}`;
      const res = await fetchBinary(u, errors);
      if (res.ok && res.body) {
        const filename = format === "danfe"
          ? `DANFE-${nfe.numero || id}.pdf`
          : `NFe-${nfe.numero || id}.xml`;
        return new Response(res.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": format === "danfe" ? "application/pdf" : "application/xml",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "private, max-age=0, no-store",
          },
        });
      }
    }

    // FASE 2: busca URLs no detalhe da NF
    let detailJson: any = null;
    try {
      const detailResp = await fetch(`${GESTAOCLICK_BASE}/notas_fiscais_produtos/${id}`, {
        headers: gcHeaders(),
        signal: AbortSignal.timeout(20_000),
      });
      const detailText = await detailResp.text();
      try { detailJson = JSON.parse(detailText); } catch { /* não-JSON */ }
    } catch (e) {
      errors.push(`detail fetch → ${e instanceof Error ? e.message : String(e)}`);
    }

    if (detailJson) {
      const urls = collectUrls(detailJson, format);
      errors.push(`detail keys: ${Object.keys(detailJson?.data || detailJson || {}).slice(0, 40).join(",")}`);
      errors.push(`urls encontradas: ${urls.join(" | ") || "nenhuma"}`);
      for (const u of urls) {
        const res = await fetchBinary(u, errors);
        if (res.ok && res.body) {
          const filename = format === "danfe"
            ? `DANFE-${nfe.numero || id}.pdf`
            : `NFe-${nfe.numero || id}.xml`;
          return new Response(res.body, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": format === "danfe" ? "application/pdf" : "application/xml",
              "Content-Disposition": `attachment; filename="${filename}"`,
              "Cache-Control": "private, max-age=0, no-store",
            },
          });
        }
      }
    }

    console.error("nfe-download falhas:", errors);
    return new Response(JSON.stringify({
      error: `Não foi possível baixar ${format.toUpperCase()} no GestaoClick.`,
      provider_nfe_id: id,
      chave_acesso: nfe.chave_acesso,
      attempts: errors,
      detail_sample: detailJson ? JSON.stringify(detailJson).slice(0, 1500) : null,
    }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("nfe-download error:", error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
