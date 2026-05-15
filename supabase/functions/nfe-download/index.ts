// nfe-download — proxy GestaoClick → cliente pra DANFE (PDF) e XML.
//
// Por quê: GestaoClick não devolve URLs prontas no detalhe da NF — tem
// endpoints separados (auth-protegidos) pra cada formato. O front não pode
// chamar direto (precisaria expor token), então essa edge fn faz o fetch
// no GC com header de auth e devolve o binário com Content-Disposition
// pra forçar download no navegador.
//
// Tenta múltiplos caminhos comuns no GC porque a doc varia por versão da API:
//   - /notas_fiscais_produtos/{id}/danfe
//   - /notas_fiscais_produtos/{id}/pdf
//   - /notas_fiscais_produtos/{id}/imprimir
// e equivalentes pra XML.

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
];
const XML_PATHS = [
  "/notas_fiscais_produtos/{id}/xml",
  "/notas_fiscais_produtos/{id}/xml-autorizado",
  "/notas_fiscais_produtos/{id}/download-xml",
];

async function tryPaths(paths: string[], id: string): Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  body: Uint8Array | null;
  errors: string[];
}> {
  const errors: string[] = [];
  for (const tmpl of paths) {
    const url = `${GESTAOCLICK_BASE}${tmpl.replace("{id}", id)}`;
    try {
      const r = await fetch(url, {
        method: "GET",
        headers: gcHeaders(),
        signal: AbortSignal.timeout(25_000),
      });
      const contentType = r.headers.get("content-type") || "application/octet-stream";
      if (r.ok && !contentType.startsWith("text/html")) {
        const buf = new Uint8Array(await r.arrayBuffer());
        // Algumas APIs retornam JSON com `{ url: ... }` em vez do binário —
        // detecta e re-fetcha a URL embutida.
        if (contentType.includes("application/json")) {
          try {
            const j = JSON.parse(new TextDecoder().decode(buf));
            const inlineUrl = j?.url || j?.data?.url || j?.link || j?.data?.link;
            if (typeof inlineUrl === "string" && inlineUrl.startsWith("http")) {
              const r2 = await fetch(inlineUrl, { signal: AbortSignal.timeout(25_000) });
              if (r2.ok) {
                return {
                  ok: true,
                  status: r2.status,
                  contentType: r2.headers.get("content-type") || contentType,
                  body: new Uint8Array(await r2.arrayBuffer()),
                  errors,
                };
              }
              errors.push(`inline-url ${inlineUrl} → ${r2.status}`);
              continue;
            }
            errors.push(`${tmpl} JSON sem url: ${new TextDecoder().decode(buf).slice(0, 200)}`);
            continue;
          } catch {
            // não era JSON real — assume binário
          }
        }
        return { ok: true, status: r.status, contentType, body: buf, errors };
      }
      const text = await r.text().catch(() => "");
      errors.push(`${tmpl} → ${r.status}: ${text.slice(0, 200)}`);
    } catch (e: unknown) {
      errors.push(`${tmpl} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: false, status: 502, contentType: "", body: null, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const nfeId = url.searchParams.get("nfe_id");
    const format = (url.searchParams.get("format") || "").toLowerCase();
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

    const paths = format === "danfe" ? DANFE_PATHS : XML_PATHS;
    const result = await tryPaths(paths, nfe.provider_nfe_id);

    if (!result.ok || !result.body) {
      console.error("nfe-download falhas:", result.errors);
      return new Response(JSON.stringify({
        error: `Não foi possível baixar ${format.toUpperCase()} no GestaoClick.`,
        attempts: result.errors,
        hint: "Verifique a NF no painel GestaoClick. Pode ser que o endpoint da API esteja diferente do esperado — me cola os detalhes do erro pra eu ajustar.",
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const filename = format === "danfe"
      ? `DANFE-${nfe.numero || nfe.provider_nfe_id}.pdf`
      : `NFe-${nfe.numero || nfe.provider_nfe_id}.xml`;

    return new Response(result.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": format === "danfe" ? "application/pdf" : "application/xml",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("nfe-download error:", error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
