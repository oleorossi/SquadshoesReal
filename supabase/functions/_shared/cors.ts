// CORS allowlist — substitui o fallback "*" inseguro que existia antes.
//
// Em PROD: configure a env var `ALLOWED_ORIGIN` como CSV de origens
// permitidas (ex: "https://squadshoes-real.vercel.app,https://prod.app").
// Em DEV: se ALLOWED_ORIGIN não estiver setada, usa o fallback abaixo
// (Vercel prod + localhost dev). NUNCA retorna "*".
//
// Uso:
//   import { corsHeadersFor, handleOptions } from "../_shared/cors.ts";
//   Deno.serve(async (req) => {
//     if (req.method === "OPTIONS") return handleOptions(req);
//     const cors = corsHeadersFor(req);
//     // ...
//     return new Response(json, { headers: { ...cors, "Content-Type": "application/json" } });
//   });

const FALLBACK_ALLOWED = [
  "https://squadshoes-real.vercel.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

function getAllowedOrigins(): string[] {
  const env = Deno.env.get("ALLOWED_ORIGIN");
  if (!env) return FALLBACK_ALLOWED;
  return env.split(",").map((o) => o.trim()).filter(Boolean);
}

export function corsHeadersFor(req: Request): Record<string, string> {
  const reqOrigin = req.headers.get("origin") || "";
  const allowed = getAllowedOrigins();
  // Match exato; nunca espelha origens arbitrárias. Se não está na lista,
  // não retorna o header Access-Control-Allow-Origin (browser bloqueia).
  const allowOrigin = allowed.includes(reqOrigin) ? reqOrigin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

export function handleOptions(req: Request): Response {
  return new Response("ok", { headers: corsHeadersFor(req) });
}

// Compat: alias com o nome antigo pra functions que ainda não migraram.
// IMPORTANTE: o objeto retornado depende do request, então NÃO use como
// const top-level — sempre chame corsHeadersFor(req) dentro do handler.
export const corsHeaders = {
  "Access-Control-Allow-Origin": getAllowedOrigins()[0] || "",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
