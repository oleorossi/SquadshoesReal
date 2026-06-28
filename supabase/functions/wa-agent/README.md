# wa-agent — Agente WhatsApp (SquadShoes)

Webhook que recebe mensagens do WhatsApp do Leonardo (via **Evolution API**),
extrai dados com a **Anthropic API** e lança no ERP **após confirmação humana**.

> **Status: Fase 1** — contas a pagar por **texto**, ponta a ponta. Sem imagem
> (Fase 2), sem catálogo de fornecedor (Fase 3). Roadmap completo na spec.

## Fluxo (Fase 1)

```
WhatsApp → Evolution API (VPS) ──POST──▶ Edge Function wa-agent
  1. guarda: allowlist de número (ALLOWED_NUMBERS) + WA_WEBHOOK_SECRET opcional
  2. idempotência: wa_messages (key.id único) — retry de webhook é no-op
  3. roteia (§7): PAGAR / SIM / NÃO determinístico; senão IA classifica
  4. extrai débito (claude-sonnet-4-6, structured outputs + zod)
  5. casa fornecedor (suppliers.search_norm / cnpj)
  6. staging em wa_pending_actions + resumo de confirmação no Zap
  7. "SIM" → commit em accounts_payable (status pending) → "✅ Lançado"
```

Exemplo de conversa:

```
você> PAGAR Soares Napa 1.250,00 vence 21 dias
bot > 📌 CONTA A PAGAR
      Fornecedor: Soares Napa
      Valor: R$ 1.250,00
      Vence: 16/07 (21 dias)

      Confirma? responde SIM
você> SIM
bot > ✅ Lançado em Contas a Pagar.
```

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.ts` | Handler: guarda + idempotência + roteamento + máquina de estados |
| `transport/evolution.ts` | Adaptador isolado da Evolution (`parseInbound` / `sendText`). Trocar p/ Meta Cloud API = só este arquivo |
| `router.ts` | Roteamento determinístico (PAGAR / CAT / SIM / NÃO) |
| `extract/anthropic.ts` | Chamadas à Anthropic + validação zod (`extractPayableFromText`, `classifyIntent`) |
| `match/supplier.ts` | Match de fornecedor por `search_norm` / `cnpj` |
| `commit/payable.ts` | Insert em `accounts_payable` (só após SIM) |
| `lib/normalize.ts` · `lib/format.ts` | Normalização e formatação das respostas |

## Tabelas de controle

Criadas pela migration `20260626120000_wa-agent-control-tables.sql` (RLS on, sem
policy pública — só a função, via `service_role`, acessa):

- **`wa_messages`** — idempotência (1 linha por `key.id` da Evolution).
- **`wa_pending_actions`** — staging das ações pendentes de confirmação.

As tabelas de negócio (`accounts_payable`, `suppliers`, …) **já existiam**.

## Variáveis de ambiente (Supabase secrets)

| Secret | Obrigatório | Descrição |
|---|---|---|
| `EVOLUTION_BASE_URL` | sim | URL da Evolution API (ex.: `https://zap.suavps.com`) |
| `EVOLUTION_INSTANCE` | sim | Nome da instância conectada ao número |
| `EVOLUTION_API_KEY` | sim | API key da Evolution (header `apikey` no envio) |
| `ANTHROPIC_API_KEY` | sim | Chave da Anthropic (extração/classificação) |
| `ALLOWED_NUMBERS` | sim | CSV de números autorizados, só dígitos (ex.: `5521999998888`) |
| `WA_WEBHOOK_SECRET` | opcional | Se setado, exige header `apikey` ou `?secret=` igual no webhook |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | auto | Injetados pelo ambiente da função |

```bash
supabase secrets set \
  EVOLUTION_BASE_URL="https://zap.suavps.com" \
  EVOLUTION_INSTANCE="squadshoes" \
  EVOLUTION_API_KEY="..." \
  ANTHROPIC_API_KEY="sk-ant-..." \
  ALLOWED_NUMBERS="5521999998888" \
  WA_WEBHOOK_SECRET="um-segredo-aleatorio" \
  --project-ref ssvxfoybzmjlypnipqzn
```

## Deploy

```bash
supabase functions deploy wa-agent --project-ref ssvxfoybzmjlypnipqzn
```

`verify_jwt = false` já está em `supabase/config.toml` (a Evolution não manda JWT
do Supabase; a função se protege com allowlist + segredo).

URL do webhook após deploy:
`https://ssvxfoybzmjlypnipqzn.supabase.co/functions/v1/wa-agent`
(adicione `?secret=...` se usar `WA_WEBHOOK_SECRET`).

## Configurar a Evolution API

1. Suba a Evolution via Docker e conecte o número via QR Code.
2. Crie a instância (`EVOLUTION_INSTANCE`).
3. Aponte o webhook da instância para a URL acima, escutando **`MESSAGES_UPSERT`**.
4. Ative **`webhook_base64: true`** (necessário só nas Fases 2/3, mas já deixe ligado).

## Teste rápido (sem WhatsApp)

Simula um inbound da Evolution (ajuste número p/ um da allowlist):

```bash
curl -X POST "https://ssvxfoybzmjlypnipqzn.supabase.co/functions/v1/wa-agent?secret=SEU_SEGREDO" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "data": {
      "key": { "remoteJid": "5521999998888@s.whatsapp.net", "fromMe": false, "id": "TESTE-0001" },
      "message": { "conversation": "PAGAR Soares Napa 1250 vence 21 dias" }
    }
  }'
```

Deve chegar o resumo no WhatsApp; responda `SIM` (outra mensagem) pra lançar.

## Próximas fases

- **Fase 2** — foto de boleto/NF (visão) no fluxo de pagar.
- **Fase 3** — catálogo de fornecedor → `group_supplier_materials` (+ promover p/ `materials`).
- **Fase 4** — seleção de fornecedor ambíguo por número, criar fornecedor pelo Zap,
  expiração de pendências por cron, auditoria em `audit_logs`.
