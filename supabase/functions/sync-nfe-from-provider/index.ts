import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ⚠ Esta função roda com verify_jwt=FALSE (supabase/config.toml). O pg_cron
// (trigger_nfe_sync_cron, */30) chama SEM header Authorization, autenticando por
// X-Cron-Secret (validado no handler contra get_nfe_sync_cron_secret); chamadas de
// usuário caem no fallback de JWT. Com verify_jwt=true (default) o GATEWAY derrubava
// o cron com 401 ANTES da função rodar — o sync de NF ficou parado e o banco local
// atrasado vs o ClickNotas. Não reabilitar verify_jwt sem mover a auth do cron.
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const CLICKNOTAS_BASE = "https://api.clicknotas.com";
const MAX_PAGES = 20;

function gcHeaders() {
  const access = Deno.env.get("CLICKNOTAS_ACCESS_TOKEN");
  const secret = Deno.env.get("CLICKNOTAS_SECRET_TOKEN");
  if (!access || !secret) {
    throw new Error("Tokens CLICKNOTAS_ACCESS_TOKEN/CLICKNOTAS_SECRET_TOKEN não configurados.");
  }
  return {
    "Access-Token": access,
    "Secret-Access-Token": secret,
  };
}

async function gcFetch(path: string) {
  const res = await fetch(`${CLICKNOTAS_BASE}${path}`, {
    headers: gcHeaders(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (text.length > 2_097_152) throw new Error("Resposta do ClickNotas excede o tamanho máximo.");
  let json: any;
  try { json = JSON.parse(text); } catch { json = { mensagem: text }; }
  return { ok: res.ok, status: res.status, json };
}

// Valores REAIS de situacao_nf na conta (varredura das 64 notas em
// 31/07/2026): Aprovada, Cancelada, Reprovada, Corrigida, Em aberto.
//   ⚠ "Reprovada" é rejeição da SEFAZ e não casa com "aprovada" nem com
//   "rejeitada" — caía no default "processando", deixando NF rejeitada
//   eternamente "em andamento". Testada PRIMEIRO agora.
//   "Corrigida" = autorizada com CC-e aplicada.
function mapSituacao(situacao: string, motivoRej?: string): string {
  const s = (situacao || "").toLowerCase();
  const m = (motivoRej || "").toLowerCase();
  if (s.includes("reprovada") || s.includes("rejeitada") || s.includes("denegada") || s.includes("erro")) return "rejeitada";
  if (s.includes("aprovada") || s.includes("autorizada") || s.includes("corrigida")) return "autorizada";
  if (s.includes("cancelada")) return "cancelada";
  // SEFAZ pode devolver situacao_nf vazia mas com motivo_rejeicao_sefaz/mensagem
  // preenchido — sem este check, NF rejeitada ficava eternamente "processando"
  // (bug encontrado em 2026-05-15, 7 NFs do PV-00104 com "Rejeição 696").
  if (m.includes("rejei") || m.includes("denegad")) return "rejeitada";
  if (s.includes("processando") || s.includes("aberta") || s.includes("aguardando")) return "processando";
  return "processando";
}

function extractPvNumber(info: string | null | undefined): string | null {
  if (!info) return null;
  const m = info.match(/Pedido\s+de\s+Venda\s*:?\s*([A-Za-z0-9-]+)/i);
  return m ? m[1].trim() : null;
}

function parseEmissaoTs(d: any): string | null {
  const date = d?.data_emissao;
  const time = d?.hora_emissao;
  if (!date) return null;
  const iso = time ? `${date}T${time}` : String(date);
  const norm = /Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + "-03:00";
  const t = new Date(norm).getTime();
  if (Number.isNaN(t) || t <= 0 || t > Date.now() + 86_400_000) return null;
  return norm;
}

function digitsOnly(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Cron bypass: requests vindas do pg_cron interno mandam X-Cron-Secret
    // (lido do vault.decrypted_secrets). Permite sync automático periódico
    // sem precisar de JWT de usuário. Não conta como ação de user — fica
    // só logado no edge function logs.
    const cronSecretHeader = req.headers.get("X-Cron-Secret");
    let isCronCaller = false;
    if (cronSecretHeader) {
      const { data: storedSecret, error: secretErr } = await adminClient.rpc("get_nfe_sync_cron_secret");
      if (secretErr) {
        return new Response(JSON.stringify({ error: `Falha ao ler secret: ${secretErr.message}` }), { status: 500, headers: corsHeaders });
      }
      // Comparação constant-time pra prevenir timing attack na descoberta do
      // secret. Implementação simples sem dependência crypto.subtle.timingSafeEqual
      // (não disponível em Deno edge runtime sem flag).
      const a = storedSecret ? String(storedSecret) : "";
      const b = cronSecretHeader;
      let diff = a.length ^ b.length;
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
      }
      if (a.length > 0 && diff === 0) {
        isCronCaller = true;
      } else {
        return new Response(JSON.stringify({ error: "Cron secret inválido" }), { status: 401, headers: corsHeaders });
      }
    }

    if (!isCronCaller) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const token = authHeader.replace("Bearer ", "");
      const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
      if (claimsError || !claims?.claims?.sub) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const userId = claims.claims.sub as string;

      const { data: roles, error: rolesErr } = await adminClient
        .from("user_roles").select("role").eq("user_id", userId);
      if (rolesErr) {
        return new Response(JSON.stringify({ error: "Role check failed" }), { status: 500, headers: corsHeaders });
      }
      const allowed = roles?.some((r: { role: string }) => ["admin", "gerente", "nfe_operator"].includes(r.role));
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Forbidden: apenas admin, gerente ou operador NF-e podem sincronizar" }), { status: 403, headers: corsHeaders });
      }
    }

    // ---------- Pré-carrega lookups (empresas e PVs por número) ----------
    const { data: companies } = await adminClient
      .from("companies")
      .select("id, cnpj")
      .eq("active", true);
    const companyByCnpj = new Map<string, string>();
    for (const c of companies || []) {
      const key = digitsOnly(c.cnpj);
      if (key) companyByCnpj.set(key, c.id);
    }

    // ---------- Pagina endpoint de NFs até esgotar ----------
    const collected: any[] = [];
    let pagesFetched = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      pagesFetched = page;
      // `pagina` é o nome documentado (doc §"Introdução": "&pagina=10").
      // Verificado ao vivo em 31/07/2026: a API aceita `page` E `pagina` com
      // resultado idêntico — usamos o documentado por segurança, caso o alias
      // não-documentado saia do ar.
      const r = await gcFetch(`/notas_fiscais_produtos?pagina=${page}`);
      // 429 = teto de 3 req/s. Não aborta o sync inteiro: para de paginar e
      // processa o que já veio; o cron pega o resto na próxima rodada.
      if (r.status === 429) {
        console.warn(`[sync-nfe] 429 na página ${page} — parando a paginação e processando ${collected.length} registros`);
        break;
      }
      if (!r.ok || r.json?.status === "error") {
        return new Response(JSON.stringify({
          error: `ClickNotas retornou ${r.status}: ${r.json?.message || r.json?.mensagem || JSON.stringify(r.json)}`,
        }), { status: 502, headers: corsHeaders });
      }
      const list: any[] = Array.isArray(r.json?.data)
        ? r.json.data
        : Array.isArray(r.json?.data?.data)
        ? r.json.data.data
        : [];
      if (list.length === 0) break;
      collected.push(...list);
      // Parada: o retorno traz `meta.total_paginas` (confirmado ao vivo:
      // total_paginas=4, total_registros=64). O nome `total_pages` (inglês)
      // nunca existiu, então a condição jamais disparava e o loop só parava na
      // primeira página VAZIA — uma requisição extra por rodada.
      const totalPages = r.json?.meta?.total_paginas
        || r.json?.meta?.total_pages
        || r.json?.meta?.pagination?.total_pages;
      if (totalPages && page >= Number(totalPages)) break;
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ provider_id: string | null; error: string }> = [];

    for (const summary of collected) {
      const providerId = String(summary?.id || "");
      if (!providerId) {
        errors.push({ provider_id: null, error: "NF sem id no retorno do provedor" });
        continue;
      }

      // Detalhe completo: lista resumida não traz chave/protocolo na maioria
      // dos casos; busca individual pra preencher os campos legais.
      let d: any = summary;
      const detail = await gcFetch(`/notas_fiscais_produtos/${providerId}`);
      if (detail.ok && detail.json?.data && typeof detail.json.data === "object") {
        d = { ...summary, ...detail.json.data };
      }

      // Coleta motivo de rejeição antes de mapear status — usado pra inferir
      // "rejeitada" quando situacao_nf vem vazia mas SEFAZ deu mensagem.
      // Shape confirmado via gc-diag: motivo_rejeicao_sefaz, mensagem_sefaz,
      // mensagem_motivo. Fallback genérico pra `motivo` ou `mensagem`.
      const motivoRejGc =
        d?.motivo_rejeicao_sefaz ||
        d?.mensagem_sefaz ||
        d?.mensagem_motivo ||
        d?.motivo ||
        d?.mensagem ||
        "";
      const status = mapSituacao(d?.situacao_nf || d?.situacao || "", motivoRejGc);
      const chave = d?.chave || "";
      const protocolo = d?.protocolo || "";
      const numero = d?.numero_nf ? String(d.numero_nf) : (d?.numero ? String(d.numero) : "");
      const serie = d?.serie ? String(d.serie) : "";
      // ClickNotas devolve `valor_total_nf` no detalhe (string com 2 casas).
      // Fallback p/ valor_produtos / valor_total / valor caso o schema mude.
      const valor = Number(
        d?.valor_total_nf ?? d?.valor_produtos ?? d?.valor_total ?? d?.valor ?? 0,
      );
      const emissaoTs = parseEmissaoTs(d);
      const cnpjEmit = digitsOnly(d?.cnpj_emitente || d?.emitente?.cnpj);
      const info = d?.informacoes_complementares || d?.observacao || "";
      const pvNum = extractPvNumber(info);

      // Destinatário: gravado direto na NF pra identificar quando não há PV vinculado.
      // ClickNotas usa prefixo `destinatario_*` no detalhe da nota (verificado
      // via gc-diag em mai/2026): destinatario_nome, destinatario_cnpj,
      // destinatario_cpf, destinatario_fornecedor_nome (quando é fornecedor).
      // Fallback p/ `cliente.*` caso o shape mude em versões futuras da API.
      const nomeDest =
        d?.destinatario_nome ||
        d?.destinatario_fornecedor_nome ||
        d?.cliente?.nome ||
        d?.cliente?.razao_social ||
        null;
      const cnpjDest = digitsOnly(
        d?.destinatario_cnpj ||
          d?.destinatario_cpf ||
          d?.cliente?.cnpj ||
          d?.cliente?.cpf ||
          "",
      ) || null;

      // A11 (auditoria): pular notas de ENTRADA/DEVOLUÇÃO ao gravar em nfe_emitidas
      // (que representa SAÍDA/faturamento). Sem isso, devolução/entrada entra como
      // +receita na apuração de impostos e duplica com nfe_devolucoes. Checa campos
      // NF-e padrão (tpNF/finalidade/natureza) + candidatos do ClickNotas; em dúvida,
      // mantém o comportamento atual (importa como saída).
      const _tipoNf = String(d?.tipo_nf ?? d?.tipo ?? d?.tipo_operacao ?? d?.tpNF ?? "").toLowerCase().trim();
      // ⚠ O campo real é `finalidade_nf` (doc §Listar NF). O código lia
      // `finalidade`/`finalidade_nfe`/`finNFe`, que não existem no retorno.
      // Na prática nenhuma devolução escapou, porque todas as 11 da conta têm
      // também `tipo_nf=0` (pego por _isEntrada) — mas era redundância cega:
      // uma devolução de SAÍDA (tipo_nf=1, finalidade_nf=4) passaria direto e
      // entraria como receita. Endurecido em 31/07/2026.
      const _finalidade = String(d?.finalidade_nf ?? d?.finalidade ?? d?.finalidade_nfe ?? d?.finNFe ?? "").toLowerCase().trim();
      const _natureza = String(d?.natureza_operacao ?? d?.natureza ?? "").toLowerCase();
      const _isEntrada = _tipoNf === "0" || _tipoNf === "entrada" || _tipoNf === "e";
      const _isDevolucao = _finalidade === "4" || _finalidade.includes("devol") || _natureza.includes("devol");
      if (_isEntrada || _isDevolucao) {
        skipped++;
        continue;
      }

      // Resolve sale_order_id: 1) mantém o existente se já tem registro; 2)
      // tenta achar por número do PV mencionado nas observações; 3) deixa NULL.
      let saleOrderId: string | null = null;
      const { data: existing } = await adminClient
        .from("nfe_emitidas")
        .select("id, sale_order_id, status")
        .eq("provider_nfe_id", providerId)
        .maybeSingle();

      if (existing?.sale_order_id) {
        saleOrderId = existing.sale_order_id;
      } else if (pvNum) {
        const { data: so } = await adminClient
          .from("sale_orders")
          .select("id")
          .eq("order_number", pvNum)
          .maybeSingle();
        saleOrderId = so?.id ?? null;
      }

      const companyId = cnpjEmit ? (companyByCnpj.get(cnpjEmit) ?? null) : null;

      const refNfe = existing
        ? undefined
        : (saleOrderId ? `gc-sync-${saleOrderId}-${providerId}` : `gc-sync-${providerId}`);

      const providerSnapshot: Record<string, unknown> = {
        provider_nfe_id: providerId,
      };
      if (chave) providerSnapshot.chave_acesso = chave;
      if (protocolo) providerSnapshot.protocolo = protocolo;
      if (numero) providerSnapshot.numero = numero;
      if (serie) providerSnapshot.serie = serie;
      if (emissaoTs) providerSnapshot.data_emissao = emissaoTs;
      if (d?.protocolo_cancelamento) {
        providerSnapshot.protocolo_cancelamento = String(d.protocolo_cancelamento);
      }
      if (status === "rejeitada") {
        providerSnapshot.motivo_rejeicao = motivoRejGc || "Rejeitada pela SEFAZ";
      }

      // Metadados de vínculo/cadastro podem ser enriquecidos fora do estado
      // fiscal. Status e identidade legal de registro existente passam apenas
      // pela RPC monotônica da migration 126.
      const metadataPayload: Record<string, unknown> = {
        cnpj_emitente: cnpjEmit || "",
        company_id: companyId,
        nome_destinatario: nomeDest,
        cnpj_destinatario: cnpjDest,
        updated_at: new Date().toISOString(),
      };
      // Nunca desliga um PV já vinculado por uma corrida com observação pobre.
      if (saleOrderId) metadataPayload.sale_order_id = saleOrderId;
      // M6 (auditoria): só grava valor_total com valor real (>0) — não rebaixar
      // um valor já correto num re-sync degradado. NF nova grava 0 só se não existir.
      if (Number.isFinite(valor) && valor > 0) metadataPayload.valor_total = valor;

      const reconcileExisting = async (existingId: string): Promise<string | null> => {
        const { error: metadataErr } = await adminClient
          .from("nfe_emitidas")
          .update(metadataPayload)
          .eq("id", existingId);
        if (metadataErr) return `metadata: ${metadataErr.message}`;

        const { data: observation, error: observationErr } = await adminClient.rpc(
          "observe_nfe_provider_status_126",
          {
            p_nfe_id: existingId,
            p_provider_status: status,
            p_snapshot: providerSnapshot,
            p_source: "sync-nfe-from-provider",
          },
        );
        if (observationErr) return `observation: ${observationErr.message}`;
        if (observation?.ok === false) {
          return `reconciliation (${observation.cancellation_state || "pending"}): ${
            observation.error || "estado fiscal requer nova observação"
          }`;
        }
        return null;
      };

      if (existing) {
        const reconciliationError = await reconcileExisting(existing.id);
        if (reconciliationError) {
          errors.push({ provider_id: providerId, error: reconciliationError });
        } else {
          updated++;
        }
      } else {
        const insertPayload: Record<string, unknown> = {
          ...metadataPayload,
          ...providerSnapshot,
          status,
          sale_order_id: saleOrderId,
          ref_nfe: refNfe,
          valor_total: Number.isFinite(valor) && valor > 0 ? valor : 0,
        };
        const { error: insErr } = await adminClient
          .from("nfe_emitidas")
          .insert(insertPayload);
        if (insErr) {
          // 23505 = corrida com outro sync: resolve a identidade criada e
          // submete a observação pela mesma fronteira monotônica.
          if ((insErr as any)?.code === "23505") {
            const { data: collided, error: collidedErr } = await adminClient
              .from("nfe_emitidas")
              .select("id")
              .eq("provider_nfe_id", providerId)
              .maybeSingle();
            const retryError = collidedErr
              ? `retry lookup: ${collidedErr.message}`
              : !collided?.id
              ? "retry lookup: identidade concorrente não encontrada"
              : await reconcileExisting(collided.id);
            if (retryError) {
              errors.push({ provider_id: providerId, error: retryError });
            } else {
              updated++;
            }
          } else {
            errors.push({ provider_id: providerId, error: `insert: ${insErr.message}` });
          }
        } else {
          created++;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      pages_fetched: pagesFetched,
      total_seen: collected.length,
      created,
      updated,
      skipped_entrada_devolucao: skipped,
      errors,
    }), {
      headers: corsHeaders,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("sync-nfe-from-provider error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
