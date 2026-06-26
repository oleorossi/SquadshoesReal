// ════════════════════════════════════════════════════════════════════════
// wa-agent — Edge Function (Deno). Webhook do agente WhatsApp da SquadShoes.
//
// FASE 1 (esta entrega): contas a pagar por TEXTO, ponta a ponta.
//   webhook → guarda(allowlist) → idempotência → roteia → extrai(IA)
//   → casa fornecedor → staging → confirmação → commit em accounts_payable.
//   Sem imagem (Fase 2), sem catálogo (Fase 3).
//
// Segredos (Supabase secrets): EVOLUTION_BASE_URL, EVOLUTION_INSTANCE,
//   EVOLUTION_API_KEY, ANTHROPIC_API_KEY, ALLOWED_NUMBERS (CSV de dígitos),
//   WA_WEBHOOK_SECRET (opcional). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//   já vêm do ambiente da função.
//
// verify_jwt=false (a Evolution não manda JWT do Supabase) — a função se
// protege com allowlist + segredo de webhook opcional. Ver config.toml.
// ════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

import { type Inbound, parseInbound, sendText } from "./transport/evolution.ts";
import { normalizePhone } from "./lib/normalize.ts";
import { routeDeterministic, stripPrefix } from "./router.ts";
import {
  classifyIntent,
  extractPayableFromText,
  type PayableExtract,
} from "./extract/anthropic.ts";
import { matchSupplier } from "./match/supplier.ts";
import { commitPayable } from "./commit/payable.ts";
import { ambiguousSuppliers, payableSummary } from "./lib/format.ts";

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

function svc() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function allowedNumbers(): string[] {
  return (Deno.env.get("ALLOWED_NUMBERS") ?? "")
    .split(",").map((s) => normalizePhone(s)).filter(Boolean);
}

// Allowlist tolerante a variação de 9º dígito / DDI (compara sufixos).
function isAllowed(from: string): boolean {
  const list = allowedNumbers();
  return list.some((a) =>
    a === from ||
    (from.length >= 8 && a.length >= 8 && (from.endsWith(a) || a.endsWith(from)))
  );
}

function todaySaoPaulo(): string {
  // en-CA formata como YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function plausibleDueDate(iso: string, todayISO: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const due = Date.parse(`${iso}T00:00:00Z`);
  const today = Date.parse(`${todayISO}T00:00:00Z`);
  if (Number.isNaN(due)) return false;
  const day = 86_400_000;
  return due >= today - 365 * day && due <= today + 1825 * day; // [-1 ano, +5 anos]
}

serve(async (req) => {
  if (req.method === "GET") return ok({ service: "wa-agent", phase: 1 });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Segredo de webhook (opcional) — header `apikey` ou ?secret=.
  const secret = Deno.env.get("WA_WEBHOOK_SECRET");
  if (secret) {
    const url = new URL(req.url);
    const sent = req.headers.get("apikey") ?? url.searchParams.get("secret") ?? "";
    if (sent !== secret) return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return ok({ ignored: "body inválido" });
  }

  const inbound = parseInbound(payload);
  if (!inbound || inbound.fromMe || !inbound.fromNumber) {
    return ok({ ignored: "sem mensagem aplicável" });
  }

  // GUARDA: allowlist. Qualquer outro número é ignorado em silêncio (§10).
  if (!isAllowed(inbound.fromNumber)) {
    console.log(`[wa-agent] número fora da allowlist: ${inbound.fromNumber}`);
    return ok({ ignored: "fora da allowlist" });
  }

  const supabase = svc();

  // IDEMPOTÊNCIA: 1 linha por wa_message_id. Retry de webhook = no-op (§10).
  const { error: dupErr } = await supabase.from("wa_messages").insert({
    wa_message_id: inbound.waMessageId,
    from_number: inbound.fromNumber,
    kind: inbound.kind === "image" ? "image" : "text",
    raw: inbound.raw,
  });
  if (dupErr) {
    if (dupErr.code === "23505" || /duplicate/i.test(dupErr.message ?? "")) {
      return ok({ ignored: "mensagem já processada" });
    }
    console.error("[wa-agent] insert wa_messages:", dupErr.message);
    // segue (best-effort) — o commit de dinheiro é guardado pelo status da pendência
  }

  try {
    await handle(supabase, inbound);
  } catch (e) {
    console.error("[wa-agent] erro no processamento:", e);
    await sendText(
      inbound.fromNumber,
      "⚠️ Deu um erro aqui processando sua mensagem. Tenta de novo em instantes.",
    ).catch(() => {});
  }
  return ok();
});

// ── Orquestração ──────────────────────────────────────────────────────────

async function handle(supabase: any, inbound: Inbound): Promise<void> {
  const from = inbound.fromNumber;

  // Foto → Fase 2.
  if (inbound.kind === "image") {
    await sendText(from, "📷 Foto ainda não — chega na Fase 2. Por ora manda o débito em *texto* (ex.: PAGAR Soares Napa 1250 vence 21 dias).");
    return;
  }
  // Sem texto utilizável → ajuda.
  if (!inbound.text) {
    await sendText(from, helpText());
    return;
  }

  const route = routeDeterministic(inbound.text);

  if (route === "confirm") return handleConfirm(supabase, from);
  if (route === "cancel") return handleCancel(supabase, from);
  if (route === "catalog") {
    await sendText(from, "📦 Catálogo de fornecedor chega na Fase 3. Por ora só *contas a pagar* (PAGAR ...).");
    return;
  }
  if (route === "payable") {
    return handlePayable(supabase, from, stripPrefix(inbound.text));
  }

  // Sem prefixo → IA classifica (§7 fallback).
  const intent = await classifyIntent(inbound.text);
  if (intent === "payable") return handlePayable(supabase, from, inbound.text);
  if (intent === "catalog") {
    await sendText(from, "📦 Isso parece cadastro de catálogo — chega na Fase 3. Por ora só *contas a pagar*.");
    return;
  }
  await sendText(from, helpText());
}

async function handlePayable(supabase: any, from: string, text: string): Promise<void> {
  const todayISO = todaySaoPaulo();
  let extracted: PayableExtract;
  try {
    extracted = await extractPayableFromText(text, todayISO);
  } catch (e) {
    console.error("[wa-agent] extração payable:", e);
    await sendText(from, "Não consegui ler o débito. Tenta: *PAGAR Soares Napa 1250 vence 21 dias*.");
    return;
  }

  // Validações de segurança (§10): valor > 0 e vencimento plausível.
  if (extracted.amount == null || !(extracted.amount > 0)) {
    await sendText(from, "❌ Não peguei o *valor*. Manda assim: PAGAR <fornecedor> <valor> vence <data ou dias>.");
    return;
  }
  if (!extracted.due_date) {
    await sendText(from, "❌ Falta o *vencimento*. Ex.: \"vence 16/07\" ou \"vence em 21 dias\".");
    return;
  }
  if (!plausibleDueDate(extracted.due_date, todayISO)) {
    await sendText(from, `❌ Vencimento ${extracted.due_date} parece estranho. Confere a data?`);
    return;
  }

  // Match de fornecedor (§6).
  const match = await matchSupplier(supabase, extracted.supplier_name, null);
  if (match.status === "ambiguous") {
    await sendText(from, ambiguousSuppliers(match.candidates.map((c) => c.name), extracted.supplier_name));
    return;
  }
  if (match.status === "none") {
    await sendText(
      from,
      `❌ Não achei o fornecedor "${extracted.supplier_name ?? "?"}". Confere o nome ou cadastra no ERP. (Criar fornecedor pelo Zap chega na Fase 4.)`,
    );
    return;
  }

  // Staging + confirmação (§9). NADA grava em accounts_payable ainda.
  const summary = payableSummary(extracted, match.supplier.name);
  const { error } = await supabase.from("wa_pending_actions").insert({
    from_number: from,
    intent: "payable",
    extracted,
    supplier_id: match.supplier.id,
    status: "pending",
    summary_sent: summary,
  });
  if (error) throw new Error(`wa_pending_actions insert: ${error.message}`);

  await sendText(from, summary);
}

async function handleConfirm(supabase: any, from: string): Promise<void> {
  const pending = await lastPending(supabase, from);
  if (!pending) {
    await sendText(from, "Não tem nada pendente pra confirmar.");
    return;
  }

  if (pending.intent === "payable") {
    const supplierName = await supplierNameById(supabase, pending.supplier_id);
    const inserted = await commitPayable(supabase, pending, supplierName);
    await supabase.from("wa_pending_actions")
      .update({ status: "committed", resolved_at: new Date().toISOString() })
      .eq("id", pending.id);
    console.log(`[wa-agent] payable lançado ${inserted.id} (pending ${pending.id})`);
    await sendText(from, "✅ Lançado em Contas a Pagar.");
    return;
  }

  // (catalog → Fase 3)
  await sendText(from, "Essa pendência não é de pagamento — ignora.");
}

async function handleCancel(supabase: any, from: string): Promise<void> {
  const pending = await lastPending(supabase, from);
  if (!pending) {
    await sendText(from, "Não tem nada pendente pra cancelar.");
    return;
  }
  await supabase.from("wa_pending_actions")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("id", pending.id);
  await sendText(from, "❌ Cancelado.");
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function lastPending(supabase: any, from: string): Promise<any | null> {
  const { data, error } = await supabase
    .from("wa_pending_actions")
    .select("id, intent, supplier_id, extracted")
    .eq("from_number", from)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`wa_pending_actions select: ${error.message}`);
  return data?.[0] ?? null;
}

async function supplierNameById(supabase: any, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabase.from("suppliers").select("name").eq("id", id).single();
  return data?.name ?? null;
}

function helpText(): string {
  return [
    "👋 Sou o agente da SquadShoes (Fase 1: *contas a pagar*).",
    "",
    "Pra lançar um débito, manda algo como:",
    "• PAGAR Soares Napa 1.250,00 vence 21 dias",
    "• PAGAR Quimicolla 890 boleto 4567 vence 16/07",
    "",
    "Depois eu mostro um resumo e você responde *SIM* pra lançar (ou *NÃO* pra cancelar).",
  ].join("\n");
}
