/**
 * Extrai a mensagem real de erro de uma Edge Function.
 *
 * O `supabase.functions.invoke` mascara qualquer resposta não-2xx com
 * "Edge Function returned a non-2xx status code" — a mensagem que o servidor
 * escreveu fica no corpo, dentro de `error.context`, e some se ninguém ler.
 *
 * Isso importa desde o ADR 0002: as funções de IA devolvem 429 com uma
 * mensagem específica de cota do Gemini ("faturamento ativo, isto é limite
 * real de uso"). Sem desembrulhar, o usuário vê o genérico e a mensagem que
 * existe justamente pra orientar a ação nunca aparece.
 *
 * O formato de `context` variou entre versões do supabase-js — às vezes é a
 * própria Response, às vezes um objeto com `.response`. Cobre os dois.
 */
export async function extractEdgeFunctionError(error: unknown): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FunctionsHttpError não expõe context tipado
  const ctx = (error as any)?.context;
  if (!ctx) return null;

  const resp = typeof ctx.clone === 'function' ? ctx : ctx.response;
  if (!resp || typeof resp.clone !== 'function') return null;

  try {
    const body = await resp.clone().json();
    if (body?.error) return String(body.error);
  } catch {
    // Corpo não é JSON — devolve o texto cru, truncado.
    try {
      const text = await resp.clone().text();
      if (text) return text.slice(0, 300);
    } catch { /* sem corpo legível */ }
  }
  return null;
}

/**
 * Converte o erro do invoke num Error com a mensagem do servidor quando ela
 * existir, caindo pro genérico quando não existir.
 */
export async function edgeFunctionError(error: unknown, fallback: string): Promise<Error> {
  const serverMsg = await extractEdgeFunctionError(error);
  if (serverMsg) return new Error(serverMsg);
  const msg = error instanceof Error ? error.message : '';
  return new Error(msg || fallback);
}
