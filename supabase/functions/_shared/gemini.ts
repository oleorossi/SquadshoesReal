// ═══════════════════════════════════════════════════════════════════════════
// _shared/gemini.ts — cliente único do Google Gemini para as edge functions.
//
// Decisão registrada em docs/adr/0002-chave-gemini-propria-e-saida-do-gateway-lovable.md.
// Uma credencial só (GEMINI_API_KEY, projeto Cloud do dono com faturamento
// ativo) atende suggest-ncm, extract-clients, generate-catalog-photo e
// recolor-image.
//
// ── POLÍTICA DE ERRO (é a decisão do ADR, não detalhe de implementação) ────
//
//   404 → CASCATEIA pro próximo nome de modelo, e se todos falharem, pergunta
//         à API quais modelos a chave realmente tem. O Google renomeou
//         modelos ao menos duas vezes em três meses; nome alternativo resolve
//         sozinho, sem deploy.
//
//   429 → FALHA ALTO. Não cascateia.
//         A chave vive num projeto com billing ativo, então 429 é cota REAL.
//         Trocar de modelo aqui esconderia do dono a única informação que ele
//         precisa ver. Sob o plano Free antigo o 429 era rotina e a cascata
//         fazia sentido — não faz mais. Quem for "consertar" um 429
//         reintroduzindo fallback está revertendo o ADR 0002 sem saber.
//
//   400/401/403 → falha imediata. É chave ou request errado; outro modelo não
//         muda nada.
//
//   5xx  → falha como indisponibilidade. Não cascateia: instabilidade do
//         Google não é problema de nome de modelo.
// ═══════════════════════════════════════════════════════════════════════════

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Nomes-padrão. O secret correspondente tem precedência e é o caminho de
// conserto sem deploy quando o Google renomeia algo.
const DEFAULT_TEXT_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const DEFAULT_IMAGE_MODELS = ["gemini-3.1-flash-image"];

export type GeminiErrorKind =
  | "config" // secret ausente
  | "quota" // 429 — cota real do projeto pago
  | "auth" // 401/403 ou API_KEY_INVALID
  | "model" // 404 em todos os nomes tentados
  | "request" // 400 — payload rejeitado
  | "upstream" // 5xx / timeout
  | "empty"; // 200 sem o conteúdo esperado

export interface GeminiAttempt {
  model: string;
  status: number;
  detail: string;
}

/**
 * Erro já traduzido para o usuário final. `message` é pt-BR e acionável —
 * as funções devolvem direto no corpo da resposta.
 */
export class GeminiError extends Error {
  readonly kind: GeminiErrorKind;
  readonly httpStatus: number;
  readonly attempts: GeminiAttempt[];

  constructor(
    kind: GeminiErrorKind,
    message: string,
    httpStatus: number,
    attempts: GeminiAttempt[] = [],
  ) {
    super(message);
    this.name = "GeminiError";
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.attempts = attempts;
  }
}

/** Lê o secret. Mensagem aponta onde cadastrar — o erro mais comum em deploy novo. */
export function getGeminiApiKey(): string {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    throw new GeminiError(
      "config",
      "GEMINI_API_KEY não configurada. Cadastre em Supabase → Edge Functions → Secrets. " +
        "A chave é a do projeto Google Cloud com faturamento ativo (formato AIza...).",
      503,
    );
  }
  return key;
}

function modelsFrom(envVar: string, defaults: string[]): string[] {
  const override = Deno.env.get(envVar)?.trim();
  if (!override) return defaults;
  // O override entra na frente, mas os defaults seguem como rede de cascata
  // pra 404 — um secret desatualizado não derruba a função sozinho.
  return [override, ...defaults.filter((m) => m !== override)];
}

export const textModels = (): string[] => modelsFrom("GEMINI_TEXT_MODEL", DEFAULT_TEXT_MODELS);
export const imageModels = (): string[] => modelsFrom("GEMINI_IMAGE_MODEL", DEFAULT_IMAGE_MODELS);

/**
 * Pergunta à API quais modelos essa chave enxerga. Usado só como diagnóstico
 * quando TODOS os nomes configurados deram 404 — é metadata, não consome cota.
 */
export async function listAvailableModels(apiKey: string): Promise<string[]> {
  try {
    const r = await fetch(`${API_BASE}/models`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return [];
    const j = await r.json();
    const list = Array.isArray(j?.models) ? j.models : [];
    return list
      .filter((m: { supportedGenerationMethods?: string[] }) =>
        Array.isArray(m?.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("generateContent")
      )
      .map((m: { name?: string }) => String(m?.name || "").replace(/^models\//, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Escolhe, entre os modelos que a chave tem, um que sirva pra modalidade pedida. */
function pickCandidate(available: string[], modality: "text" | "image"): string | undefined {
  if (modality === "image") {
    return available.find((m) => /image/i.test(m) && !/embedding|tts|audio/i.test(m));
  }
  const flash = available.filter((m) => /flash/i.test(m) && !/embedding|tts|image|audio/i.test(m));
  return flash[0] ||
    available.find((m) => /gemini.*pro/i.test(m) && !/vision|embedding|image/i.test(m));
}

async function readError(r: Response): Promise<string> {
  const raw = await r.text();
  try {
    return JSON.parse(raw)?.error?.message || raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

/** Traduz um status HTTP do Gemini no erro pt-BR correspondente. */
function errorFor(
  status: number,
  detail: string,
  model: string,
  attempts: GeminiAttempt[],
): GeminiError {
  if (status === 429) {
    // A mensagem específica de cota é decisão de produto: o usuário precisa
    // saber que é limite de uso real, não falha transitória a "tentar de novo".
    return new GeminiError(
      "quota",
      "Cota do Gemini esgotada. O projeto tem faturamento ativo, então isto é limite real de uso — " +
        "confira consumo e limites em https://console.cloud.google.com/billing antes de tentar de novo.",
      429,
      attempts,
    );
  }
  if (status === 401 || status === 403 || /API_KEY_INVALID/i.test(detail)) {
    return new GeminiError(
      "auth",
      "Chave do Gemini inválida ou sem permissão para este modelo. Confira o secret GEMINI_API_KEY.",
      502,
      attempts,
    );
  }
  if (status === 400) {
    return new GeminiError(
      "request",
      `Requisição rejeitada pelo Gemini (modelo ${model}). Arquivo grande demais ou conteúdo inválido. Detalhe: ${detail.slice(0, 160)}`,
      400,
      attempts,
    );
  }
  return new GeminiError(
    "upstream",
    `Gemini indisponível no momento (HTTP ${status}). Tente novamente em alguns minutos.`,
    502,
    attempts,
  );
}

export interface CallGeminiOptions {
  apiKey: string;
  /** Nomes em ordem de preferência. Só o 404 avança na lista. */
  models: string[];
  /** Corpo do generateContent, já montado pela função chamadora. */
  body: unknown;
  modality: "text" | "image";
  timeoutMs?: number;
  /** Prefixo dos logs, ex.: "extract-clients". */
  label: string;
}

/**
 * Chama generateContent aplicando a política de erro do ADR 0002.
 * Devolve o JSON cru da API; extrair `candidates[]` é responsabilidade de quem chamou.
 */
export async function callGemini(opts: CallGeminiOptions): Promise<any> {
  const { apiKey, models, body, modality, label } = opts;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const payload = JSON.stringify(body);
  const attempts: GeminiAttempt[] = [];

  const post = async (model: string): Promise<Response> =>
    await fetch(`${API_BASE}/models/${model}:generateContent`, {
      method: "POST",
      // Chave no header, não na query: não vaza em log de URL nem em referer.
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });

  for (const model of models) {
    const r = await post(model);
    if (r.ok) {
      console.log(`[${label}] OK com modelo ${model}`);
      return await r.json();
    }

    const detail = await readError(r);
    attempts.push({ model, status: r.status, detail });
    console.warn(`[${label}] ${model} → ${r.status}: ${detail.slice(0, 200)}`);

    // Só 404 continua a cascata. Todo o resto para aqui — ver política no topo.
    if (r.status !== 404) throw errorFor(r.status, detail, model, attempts);
  }

  // Chegou aqui ⇒ todos os nomes configurados retornaram 404. O Google
  // provavelmente renomeou de novo: pergunta o que a chave tem e tenta uma vez.
  const available = await listAvailableModels(apiKey);
  console.log(`[${label}] Todos 404. Modelos disponíveis pra chave: ${available.join(", ") || "(nenhum)"}`);
  const candidate = pickCandidate(available, modality);

  if (candidate) {
    const r = await post(candidate);
    if (r.ok) {
      console.log(`[${label}] OK com modelo dinâmico ${candidate}`);
      return await r.json();
    }
    const detail = await readError(r);
    attempts.push({ model: candidate, status: r.status, detail });
    if (r.status !== 404) throw errorFor(r.status, detail, candidate, attempts);
  }

  throw new GeminiError(
    "model",
    `Nenhum modelo de ${modality === "image" ? "imagem" : "texto"} respondeu — os nomes configurados retornaram 404. ` +
      `Modelos disponíveis pra esta chave: ${available.join(", ") || "(nenhum)"}. ` +
      `Ajuste o secret ${modality === "image" ? "GEMINI_IMAGE_MODEL" : "GEMINI_TEXT_MODEL"}.`,
    502,
    attempts,
  );
}

/** Primeira parte `inlineData` da resposta — o caminho das funções de imagem. */
export function extractInlineImage(
  data: any,
): { base64: string; mimeType: string } | null {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const part = parts.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);
  if (!part?.inlineData?.data) return null;
  return {
    base64: part.inlineData.data,
    mimeType: part.inlineData.mimeType || "image/png",
  };
}

/** Texto do primeiro candidate — o caminho das funções de texto/JSON. */
export function extractText(data: any): string | null {
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" && text.length > 0 ? text : null;
}

/**
 * Converte qualquer erro em Response. GeminiError já vem com mensagem pt-BR
 * e status corretos; o resto vira 500 genérico.
 */
export function geminiErrorResponse(
  e: unknown,
  corsHeaders: Record<string, string>,
): Response {
  if (e instanceof GeminiError) {
    return new Response(
      JSON.stringify({ error: e.message, kind: e.kind, attempts: e.attempts }),
      { status: e.httpStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const msg = e instanceof Error ? e.message : "Erro desconhecido";
  return new Response(JSON.stringify({ error: msg }), {
    status: 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
