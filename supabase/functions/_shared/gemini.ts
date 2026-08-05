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
//   429 → CASCATEIA também, e só falha quando acabam os modelos.
//         A cota do free tier é POR MODELO
//         (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`), então o
//         modelo seguinte da lista costuma responder na hora.
//         ⚠ Isto foi decidido duas vezes. Em 04/08/2026 o ADR 0002 mandou o
//         429 falhar alto, partindo de que a chave estava num projeto pago.
//         A premissa não se confirmou: medido contra a chave real, 4 de 6
//         modelos deram 429 imediato e a quota veio marcada `-FreeTier`.
//         Não volte a "falhar alto" sem antes CONFERIR o tier da chave em uso
//         — é o mesmo erro, e o sintoma é o extract-clients quebrando na cara
//         do usuário no primeiro upload do dia.
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
// Medido em 05/08/2026 contra a chave real: `gemini-2.5-flash` retorna 404
// ("no longer available to new users") e os `gemini-2.0-flash*` retornam 429
// no free tier. Os aliases `-latest` seguem o modelo corrente do Google, então
// resistem a renomeação — por isso vêm primeiro.
const DEFAULT_TEXT_MODELS = [
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
  "gemini-flash-lite-latest",
];
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
    // Defensivo: no fluxo normal o 429 cascateia e nunca chega aqui (ver
    // política no topo). Fica para quem chamar errorFor de outro caminho.
    return new GeminiError(
      "quota",
      "Cota do Gemini esgotada neste modelo. No free tier o limite é por modelo e por minuto; " +
        "aguarde alguns minutos ou habilite faturamento no projeto.",
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

    // 404 (modelo renomeado) e 429 (cota do free tier, que é por modelo)
    // continuam a cascata. Todo o resto para aqui — ver política no topo.
    if (r.status !== 404 && r.status !== 429) {
      throw errorFor(r.status, detail, model, attempts);
    }
  }

  // Chegou aqui ⇒ todos os nomes configurados deram 404 (renomeados) ou 429
  // (cota estourada naquele modelo). Pergunta o que a chave tem, e tenta um
  // nome que não esteja entre os já queimados nesta chamada.
  const available = await listAvailableModels(apiKey);
  const tried = new Set(attempts.map((a) => a.model));
  const statuses = attempts.map((a) => a.status).join("/");
  console.log(`[${label}] Cascata esgotada (${statuses}). Disponíveis: ${available.join(", ") || "(nenhum)"}`);
  const candidate = pickCandidate(available.filter((m) => !tried.has(m)), modality);

  if (candidate) {
    const r = await post(candidate);
    if (r.ok) {
      console.log(`[${label}] OK com modelo dinâmico ${candidate}`);
      return await r.json();
    }
    const detail = await readError(r);
    attempts.push({ model: candidate, status: r.status, detail });
    if (r.status !== 404 && r.status !== 429) {
      throw errorFor(r.status, detail, candidate, attempts);
    }
  }

  // Esgotou tudo. A mensagem depende de POR QUE esgotou: cota estourada em
  // todos os modelos é problema de plano; 404 em todos é nome de modelo.
  const allQuota = attempts.length > 0 && attempts.every((a) => a.status === 429);
  if (allQuota) {
    throw new GeminiError(
      "quota",
      "Cota do Gemini esgotada em todos os modelos disponíveis. No free tier o limite é por modelo e " +
        "por minuto — costuma liberar sozinho em alguns minutos. Se for constante, habilite faturamento " +
        "no projeto em https://aistudio.google.com/apikey.",
      429,
      attempts,
    );
  }

  throw new GeminiError(
    "model",
    `Nenhum modelo de ${modality === "image" ? "imagem" : "texto"} respondeu (${attempts.map((a) => `${a.model}=${a.status}`).join(", ")}). ` +
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
