// Roteamento de intenção (§7). Determinístico primeiro (barato e previsível);
// IA só como fallback, no handler. Aqui ficam apenas as regras por prefixo/
// palavra-chave, sem efeito colateral.

export type Route = "catalog" | "payable" | "confirm" | "cancel" | "unknown";

export function routeDeterministic(text: string): Route {
  const t = text.trim().toLowerCase();
  if (!t) return "unknown";

  // Confirmação / cancelamento da última pendência.
  if (/^(sim|ok|okay|confirma(r|do|)|confirmo|pode|isso)\b/.test(t)) return "confirm";
  if (/^(n[aã]o|cancela(r|)|cancelado|nao)\b/.test(t)) return "cancel";

  // Prefixos explícitos.
  if (/^cat\b/.test(t)) return "catalog";
  if (/^pagar\b/.test(t)) return "payable";

  return "unknown";
}

// Remove o prefixo de comando ("PAGAR ", "CAT ") do corpo antes de extrair.
export function stripPrefix(text: string): string {
  return text.replace(/^\s*(pagar|cat)\b[\s:>-]*/i, "").trim();
}
