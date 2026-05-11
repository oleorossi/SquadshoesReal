// =============================================================================
// setup-nfe-certificate — endpoint obsoleto após migração pra GestaoClick.
//
// A configuração do certificado A1 passou a ser feita diretamente no painel
// do GestaoClick (https://app.clicknotas.com). A API pública deles não expõe
// endpoint pra upload de certificado, e o certificado já fica vinculado à
// empresa cadastrada no painel — não há sentido em manter este endpoint.
// =============================================================================
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({
    error: "Configuração de certificado migrou para o painel GestaoClick. Acesse https://app.clicknotas.com para configurar o certificado A1 da empresa.",
  }), { status: 410, headers: corsHeaders });
});
