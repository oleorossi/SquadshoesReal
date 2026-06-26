// ════════════════════════════════════════════════════════════════════════
// Adaptador de transporte — Evolution API (self-hosted).
//
// É a ÚNICA camada que conhece o formato da Evolution. Trocar pra Cloud API
// oficial da Meta depois = reescrever só este arquivo. O resto do agente fala
// com `parseInbound()` (entrada normalizada) e `sendText()` (saída).
//
// Evento escutado: MESSAGES_UPSERT. Recomendado configurar a instância com
// `webhook_base64: true` pra mídia já vir em base64 (evita 2ª chamada). Esse
// campo só é usado nas Fases 2/3 (visão); na Fase 1 lidamos só com texto.
// ════════════════════════════════════════════════════════════════════════

import { normalizePhone } from "../lib/normalize.ts";

export interface Inbound {
  waMessageId: string; // key.id — usado pra idempotência
  fromNumber: string; // só dígitos (E.164 sem +)
  fromMe: boolean; // mensagem enviada pela PRÓPRIA instância (ignorar)
  kind: "text" | "image" | "other";
  text: string; // texto da msg (ou caption da imagem)
  imageBase64: string | null; // só quando kind=image e webhook_base64=true
  imageMimeType: string | null;
  raw: unknown; // payload bruto p/ auditoria
}

// A Evolution manda ora `data` como objeto, ora como array (batch). Pega o 1º.
function firstMessage(payload: any): any | null {
  const d = payload?.data;
  if (!d) return null;
  return Array.isArray(d) ? (d[0] ?? null) : d;
}

export function parseInbound(payload: any): Inbound | null {
  // Aceita "messages.upsert" / "MESSAGES_UPSERT" (a Evolution varia o casing).
  const event = String(payload?.event ?? "").toLowerCase().replace(/_/g, ".");
  if (event && event !== "messages.upsert") return null;

  const msg = firstMessage(payload);
  if (!msg?.key?.id) return null;

  const m = msg.message ?? {};
  const fromMe = Boolean(msg.key?.fromMe);
  const remoteJid: string = msg.key?.remoteJid ?? "";
  const fromNumber = normalizePhone(remoteJid.split("@")[0] ?? "");

  // Tipo + conteúdo. Evolution aninha conforme o tipo de mídia.
  let kind: Inbound["kind"] = "other";
  let text = "";
  let imageBase64: string | null = null;
  let imageMimeType: string | null = null;

  if (typeof m.conversation === "string") {
    kind = "text";
    text = m.conversation;
  } else if (m.extendedTextMessage?.text) {
    kind = "text";
    text = m.extendedTextMessage.text;
  } else if (m.imageMessage) {
    kind = "image";
    text = m.imageMessage.caption ?? "";
    imageMimeType = m.imageMessage.mimetype ?? "image/jpeg";
    // webhook_base64=true entrega a mídia decodificada em `message.base64`.
    imageBase64 = msg.base64 ?? m.base64 ?? null;
  } else if (m.documentMessage || m.documentWithCaptionMessage) {
    // Boleto/NF às vezes chega como documento (PDF). Tratado nas Fases 2/3.
    kind = "other";
    text = m.documentMessage?.caption ??
      m.documentWithCaptionMessage?.message?.documentMessage?.caption ?? "";
  }

  return {
    waMessageId: String(msg.key.id),
    fromNumber,
    fromMe,
    kind,
    text: (text ?? "").trim(),
    imageBase64,
    imageMimeType,
    raw: payload,
  };
}

// Envia texto de volta pro número. Idempotência de ENVIO não é garantida pela
// Evolution; o agente evita reenvio porque cada inbound é processado 1x só
// (dedup em wa_messages).
export async function sendText(to: string, body: string): Promise<void> {
  const base = Deno.env.get("EVOLUTION_BASE_URL");
  const instance = Deno.env.get("EVOLUTION_INSTANCE");
  const apiKey = Deno.env.get("EVOLUTION_API_KEY");
  if (!base || !instance || !apiKey) {
    console.error("[evolution] EVOLUTION_BASE_URL/INSTANCE/API_KEY ausentes — não enviou");
    return;
  }

  const url = `${base.replace(/\/+$/, "")}/message/sendText/${instance}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    // Evolution API v2: { number, text }. `number` aceita só dígitos.
    body: JSON.stringify({ number: to, text: body }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[evolution] sendText falhou ${res.status}: ${detail.slice(0, 300)}`);
  }
}
