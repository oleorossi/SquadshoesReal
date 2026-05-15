// nfe-download — DEPRECATED.
//
// A API do GestaoClick (CakePHP) NÃO expõe DANFE/XML pra download via endpoint
// próprio. Probamos exaustivamente: todas as variantes (/danfe, /xml, /pdf,
// /imprimir, /download_arquivo_*, /visualizar/{id}/{fmt}, ?formato=) retornam
// 404 "Action not found" ou 400 "ID inválido". A resposta de detalhe também
// não traz nenhum campo URL.
//
// Substituímos pelo viewer público meudanfe.com.br/consulta/{chave}, aberto
// direto pelo frontend (src/hooks/useNfe.ts → useDownloadNfeFile). Esta edge
// function ficou só pra retornar 410 caso algum cliente cacheado ainda chame.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      error: "Endpoint descontinuado",
      detail:
        "Para baixar DANFE/XML use o viewer público https://www.meudanfe.com.br/consulta/<chave_acesso>. " +
        "A API do GestaoClick não expõe esses arquivos.",
    }),
    {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
