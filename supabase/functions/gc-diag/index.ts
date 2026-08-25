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

// Tombstone deliberado: a função de diagnóstico remota aceitava um nfe_id
// arbitrário e consultava o provedor fiscal com segredos do projeto. O endpoint
// não é parte da aplicação e não deve continuar expondo metadados fiscais.
Deno.serve((request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error: "endpoint_retired",
      message: "Este diagnóstico temporário foi desativado.",
    }),
    { status: 410, headers: corsHeaders },
  );
});
