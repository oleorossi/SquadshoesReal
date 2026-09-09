import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ||
    "https://squadshoes-real.vercel.app",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "OPTIONS, GET, POST",
  "Content-Type": "application/json",
  "Vary": "Origin",
};

// Tombstone deliberado: substitui uma função temporária que permaneceu ativa
// fora do Git e expunha metadados fiscais sem autenticação. Não consulta banco,
// Vault, provedor fiscal ou qualquer outro serviço externo.
Deno.serve((request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error: "endpoint_retired",
      message: "Este endpoint temporário foi desativado.",
    }),
    { status: 410, headers: corsHeaders },
  );
});
