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

// Tombstone versionado do fluxo antigo de certificado. A configuração A1 foi
// migrada para o provedor fiscal; este endpoint não consulta banco ou segredos.
Deno.serve((request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error: "endpoint_retired",
      message: "A configuração do certificado migrou para o provedor fiscal.",
    }),
    { status: 410, headers: corsHeaders },
  );
});
