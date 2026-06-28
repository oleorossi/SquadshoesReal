// ════════════════════════════════════════════════════════════════════════
// Extração via Anthropic API (Messages API, HTTP direto — sem SDK no Deno).
//
// Fase 1: SÓ texto → conta a pagar. Visão (foto de boleto/NF) entra na Fase 2
// reusando `callAnthropic` com um content block de imagem.
//
// Estratégia (§8): pedimos JSON puro (sem prosa/markdown) e validamos com zod
// antes de stagear. Campo ausente = null; se faltar obrigatório, o chamador
// pergunta no Zap em vez de chutar.
// ════════════════════════════════════════════════════════════════════════

import { z } from "https://esm.sh/zod@3.23.8";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6"; // workhorse barato p/ extração (definido na spec)

interface AnthropicBody {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
}

async function callAnthropic(body: AnthropicBody): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY ausente");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = await res.json();
  const block = (data?.content ?? []).find((b: any) => b?.type === "text");
  const text: string = block?.text ?? "";
  if (!text) throw new Error("Anthropic devolveu resposta vazia");
  return text;
}

// Extrai o objeto JSON da resposta do modelo, tolerando cercas ```json e
// qualquer prosa acidental ao redor (pega do 1º "{" ao último "}").
function parseJsonObject(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`resposta sem JSON: ${text.slice(0, 200)}`);
  }
  return JSON.parse(t.slice(start, end + 1));
}

// ── Conta a pagar (§8.2 da spec) ─────────────────────────────────────────

// zod: fonte da verdade do tipo + validação final. coerce em números pra
// tolerar o modelo devolver "1250.00" como string.
export const PayableExtract = z.object({
  supplier_name: z.string().nullable(),
  amount: z.coerce.number().nullable(),
  due_date: z.string().nullable(), // "YYYY-MM-DD"
  due_in_days: z.coerce.number().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  barcode: z.string().nullable(),
  boleto_number: z.string().nullable(),
  installment_number: z.coerce.number().nullable(),
  total_installments: z.coerce.number().nullable(),
  notes: z.string().nullable(),
});
export type PayableExtract = z.infer<typeof PayableExtract>;

const PAYABLE_SYSTEM =
  `Você extrai dados de uma CONTA A PAGAR (débito a fornecedor) de fábrica de calçado a partir de texto livre em português.
Responda APENAS com JSON válido, sem texto fora do JSON, sem markdown. Não invente valores: campo ausente = null.
Schema exato (todas as chaves presentes):
{"supplier_name":string|null,"amount":number|null,"due_date":"YYYY-MM-DD"|null,"due_in_days":number|null,"description":string|null,"category":string|null,"barcode":string|null,"boleto_number":string|null,"installment_number":number|null,"total_installments":number|null,"notes":string|null}
Regras:
- amount: valor em reais como número (ex.: "R$ 1.250,00" -> 1250.00). Ponto decimal.
- due_date: data de vencimento absoluta "YYYY-MM-DD" se houver data explícita.
- due_in_days: se o prazo for relativo ("vence em 21 dias", "21 ddl"), o número de dias; senão null.
- category: natureza do gasto se dita (ex.: "Material","Frete","Energia"); senão null.
- installment_number/total_installments: parcela "2/5" -> 2 e 5.`;

// Extrai conta a pagar de texto. `todayISO` ("YYYY-MM-DD") resolve prazo
// relativo em data absoluta (ex.: hoje + 21 dias).
export async function extractPayableFromText(
  text: string,
  todayISO: string,
): Promise<PayableExtract> {
  const raw = await callAnthropic({
    model: MODEL,
    max_tokens: 1024,
    system: PAYABLE_SYSTEM,
    messages: [{ role: "user", content: text }],
  });

  const parsed = PayableExtract.parse(parseJsonObject(raw));

  // Pós-processamento: prazo relativo -> data absoluta (§8.2).
  if (!parsed.due_date && parsed.due_in_days != null) {
    parsed.due_date = addDays(todayISO, parsed.due_in_days);
  }
  return parsed;
}

// ── Roteamento por IA (fallback do §7) ───────────────────────────────────

export async function classifyIntent(
  text: string,
): Promise<"catalog" | "payable" | "other"> {
  try {
    const raw = await callAnthropic({
      model: MODEL,
      max_tokens: 32,
      system:
        `Classifique a mensagem de um dono de fábrica de calçado em UMA intenção:
"payable" = registrar um débito/conta a pagar (valor, vencimento, boleto, fornecedor a pagar);
"catalog" = cadastrar item/preço de fornecedor (material, cor, medida, preço de tabela);
"other" = qualquer outra coisa.
Responda APENAS com JSON: {"intent":"payable"} ou {"intent":"catalog"} ou {"intent":"other"}.`,
      messages: [{ role: "user", content: text }],
    });
    const intent = (parseJsonObject(raw) as any)?.intent;
    return intent === "catalog" || intent === "payable" ? intent : "other";
  } catch (e) {
    console.error("[anthropic] classifyIntent falhou:", e);
    return "other";
  }
}

// soma dias a uma data "YYYY-MM-DD" e devolve "YYYY-MM-DD" (UTC, date-only).
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}
