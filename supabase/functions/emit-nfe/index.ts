import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildClickNotasTechnicalProductName,
  ClickNotasProductPostDefinitelyRejectedError,
  ClickNotasProductClaimBusyError,
  ClickNotasProductIdentityConflictError,
  ClickNotasProductReconciliationRequiredError,
  provisionClickNotasProductIdentity,
  resolveClickNotasProductIdentity,
  type ClickNotasProductBeginPostResult,
  type ClickNotasProductClaimResult,
  type ClickNotasProductCompletionResult,
  type ClickNotasProductReconciliationResult,
} from "../_shared/clickNotasProductIdentity.ts";
import {
  assertNfeCfopColumns,
  classifyNfeItemOrigin,
  resolveHeaderNfeCfop,
  resolveNfeCfop,
  type NfeCfopKind,
} from "../_shared/nfeCfop.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const CLICKNOTAS_BASE = "https://api.clicknotas.com";

// Marca default — usada quando o PV não tem brand cadastrada explícita.
// Era hardcoded até 15/05/2026; agora é override-able via sale_orders.brand.
// 19/05/2026: 'SquadShoes' (junto) → 'Squad Shoes' (com espaço). Migração
// DB 20260519130000 também muda o default da coluna e backfilla os 39 PVs
// existentes. xMarca no XML SEFAZ agora sai escrito como o nome da empresa.
const DEFAULT_BRAND = "Squad Shoes";

function gcHeaders() {
  const access = Deno.env.get("CLICKNOTAS_ACCESS_TOKEN");
  const secret = Deno.env.get("CLICKNOTAS_SECRET_TOKEN");
  if (!access || !secret) {
    throw new Error("Tokens CLICKNOTAS_ACCESS_TOKEN/CLICKNOTAS_SECRET_TOKEN não configurados.");
  }
  return {
    "Access-Token": access,
    "Secret-Access-Token": secret,
    "Content-Type": "application/json",
  };
}

// ── Throttle: a API ClickNotas limita a 3 requisições/segundo por empresa ──
// (doc §"Limite de requisições"; estourar devolve 429 "O limite de requisicoes
// foi atingido"). Uma emissão de 8 itens dispara ~30 chamadas — cidades,
// cliente (PUT+GET), 2 por produto, lojas, transportadoras, POST da NF e o
// poll do detalhe. Sem serialização isso estoura o teto no meio da emissão e
// o operador leva um 502 genérico. Serializamos numa cadeia única com
// intervalo mínimo e fazemos backoff no 429 em vez de abortar.
// Auditoria 31/07/2026 (docs/AUDITORIA_NFE_2026-07-31.md).
const GC_MIN_INTERVAL_MS = 350; // ~2,8 req/s, com folga sob o teto de 3
let _gcChain: Promise<unknown> = Promise.resolve();
let _gcLastCallAt = 0;

function gcThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const run = _gcChain.then(async () => {
    const wait = GC_MIN_INTERVAL_MS - (Date.now() - _gcLastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      _gcLastCallAt = Date.now();
    }
  });
  // A cadeia NUNCA pode rejeitar: uma falha propagada travaria todas as
  // chamadas seguintes do isolate. O erro segue pro caller via `run`.
  _gcChain = run.catch(() => {});
  return run as Promise<T>;
}

async function gcFetch(path: string, init: RequestInit = {}) {
  const MAX_429_RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    const r = await gcThrottle(async () => {
      const res = await fetch(`${CLICKNOTAS_BASE}${path}`, {
        ...init,
        headers: { ...gcHeaders(), ...(init.headers || {}) },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = { mensagem: text }; }
      return { ok: res.ok, status: res.status, json };
    });
    // 429 = requisição RECUSADA, não processada — repetir é seguro inclusive
    // no POST da NF (nada foi criado do outro lado).
    if (r.status !== 429 || attempt >= MAX_429_RETRIES) return r;
    console.warn(`[emit-nfe] 429 em ${path} — backoff ${1000 * 2 ** attempt}ms (tentativa ${attempt + 1}/${MAX_429_RETRIES})`);
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
  }
}

// ── NUMERAÇÃO DA NF: deixamos o ClickNotas atribuir ─────────────────────────
// Existiu aqui um gcMaxNfNumber() que buscava o maior número já emitido pra
// mandar (maior + 1). REMOVIDO em 31/07/2026 (docs/AUDITORIA_NFE_2026-07-31.md)
// pelos motivos abaixo (verificados ao vivo contra a API em 31/07/2026):
//   1. A condição de parada lia `meta.total_pages`; o retorno traz
//      `total_paginas`. O loop só parava na 1ª página VAZIA — hoje são 4
//      páginas de dados, então eram 5 requisições ANTES de cada emissão,
//      contra um teto de 3 req/s.
//   2. `numero` não é campo documentado do POST.
//   (A paginação em si funcionava: a API aceita `page` e `pagina`. A versão
//   anterior deste comentário afirmava o contrário — estava errada.)
// `numero` também não é campo documentado do POST, e nas 3 NFs com payload
// gravado ele está null (nunca foi exercido de fato). Evidência de que o GC
// numera certo sozinho: as 9 notas emitidas no painel saíram 279→287 sem
// buraco. O número real é lido de volta no detalhe (readDetail → numero_nf).
// NÃO reintroduzir sem confirmar `numero` com o suporte ClickNotas.

// Quando clients.endereco vem concatenado tipo "Rua X, PARTE GALPAO" (vírgula
// como separador entre logradouro e complemento), o XML SEFAZ saía com o
// complemento DENTRO do logradouro — fica feio no DANFE e tecnicamente
// errado (Receita espera logradouro limpo, complemento em tag própria).
// 19/05/2026: bug visto em PV-00116, cliente LNG cadastrado como
// "Rua Maria Soares Sendas, PARTE GALPAO". Helper separa pela 1ª vírgula.
function splitAddress(addr: string | null | undefined, manualComplemento?: string | null): { logradouro: string; complemento: string } {
  const raw = (addr || "").trim();
  const manual = (manualComplemento || "").trim();
  if (!raw) return { logradouro: "", complemento: manual };
  const idx = raw.indexOf(",");
  if (idx < 0) return { logradouro: raw, complemento: manual };
  const logradouro = raw.slice(0, idx).trim();
  const restoDoEndereco = raw.slice(idx + 1).trim();
  // Junta manual + extraído (manual primeiro se houver, separado por " - ")
  const complemento = manual && restoDoEndereco
    ? `${manual} - ${restoDoEndereco}`
    : (manual || restoDoEndereco);
  return { logradouro, complemento };
}

// Cache do id da loja no ClickNotas. A doc da API marca `loja_id` como
// obrigatório no POST /notas_fiscais_produtos. Quando ausente, o GC usa
// "matriz ou loja que o usuário tem permissão" — funciona, mas explícito
// é mais seguro (e cumpre o contrato da doc). Cache em memória do isolate
// — válido enquanto o edge function fica quente. Reseta a cada cold start.
// ⚠ `GET /lojas` devolve APENAS { id, nome } — sem CNPJ, sem flag de matriz,
// sem situação (spec §Lojas). Logo NÃO existe forma automática de descobrir
// qual loja corresponde a qual CNPJ: o fallback só consegue chutar a primeira.
// Por isso, empresa NÃO-primária é OBRIGADA a ter companies.gestaoclick_loja_id
// mapeado — sem isso a NF sairia sob o CNPJ da matriz, com o registro local
// dizendo outra coisa (erro fiscal silencioso). Auditoria 31/07/2026.
let _gcLojaListCache: Array<{ id?: string; nome?: string }> | null = null;
async function resolveGcLojaId(fiscal: any): Promise<{ lojaId: string | null; blockReason: string | null }> {
  // Loja mapeada explicitamente → usa direto. É o único caminho correto pra
  // um 2º CNPJ.
  const mapped = fiscal?.gestaoclick_loja_id;
  if (mapped != null && String(mapped).trim() !== "") {
    return { lojaId: String(mapped).trim(), blockReason: null };
  }

  const nomeEmpresa = fiscal?.razao_social || fiscal?.nome_fantasia || "esta empresa";
  if (fiscal?.is_primary !== true) {
    return {
      lojaId: null,
      blockReason:
        `A empresa "${nomeEmpresa}" não tem a loja do ClickNotas mapeada e não é a empresa principal. ` +
        `Emitir assim faria a NF sair sob o CNPJ da matriz. ` +
        `Abra Configurações → Empresas e preencha o "ID da loja no ClickNotas" ` +
        `(o id vem de GET /lojas no painel).`,
    };
  }

  // Empresa principal: mantém o fallback histórico (primeira loja da conta).
  // Os predicados de matriz/situação ficam por defesa — a doc não documenta
  // esses campos, mas se a API real os devolver, eles melhoram o palpite.
  try {
    if (!_gcLojaListCache) {
      const r = await gcFetch("/lojas");
      _gcLojaListCache = Array.isArray(r.json?.data) ? r.json.data : [];
    }
    const list = _gcLojaListCache;
    if (!list || list.length === 0) return { lojaId: null, blockReason: null };
    const matriz = list.find((l: any) => l.matriz === 1 || l.matriz === "1" || l.matriz === true);
    const ativa = list.find((l: any) => l.situacao === 1 || l.situacao === "1" || l.situacao === true);
    const pick = matriz || ativa || list[0];
    return { lojaId: pick?.id ? String(pick.id) : null, blockReason: null };
  } catch (e) {
    console.warn("[emit-nfe] resolveGcLojaId falhou:", e instanceof Error ? e.message : String(e));
    return { lojaId: null, blockReason: null };
  }
}

// Cache do id da transportadora "própria" (Squad Shoes) no ClickNotas.
// modFrete=3 (transporte próprio do remetente) exige que a NF aponte pra uma
// transportadora cadastrada — mas o painel GC não puxa automaticamente do
// emitente. A doc da API de /notas_fiscais_produtos não documenta bloco
// `transporte.transportador.*` (silenciosamente ignorado) — só aceita
// `transportadora_id` (FK pra /transportadoras). Solução: criar a transportadora
// "Squad Shoes" uma vez (idempotente por CNPJ) e referenciar pelo ID.
// 19/05/2026: bug visto em PV-00107+, transportador saía em branco no DANFE.
// Cache do id da transportadora "própria" no ClickNotas, POR CNPJ do emitente.
// Cache global misturava Matriz e LRMS no mesmo isolate (auditoria NF-e).
const _gcTransportadoraIdByCnpj = new Map<string, string>();
async function resolveGcTransportadoraEmitenteId(fiscal: any): Promise<string | null> {
  const cnpjDigits = (fiscal?.cnpj || "").replace(/\D/g, "");
  if (cnpjDigits.length !== 14) {
    console.warn("[emit-nfe] resolveGcTransportadoraEmitenteId: CNPJ do emitente inválido — pulando");
    return null;
  }
  const cached = _gcTransportadoraIdByCnpj.get(cnpjDigits);
  if (cached) return cached;
  try {
    // 1. Tenta achar transportadora existente com mesmo CNPJ. GC filtra por
    // nome (não por CNPJ), então buscamos pelo nome e validamos no client.
    const nomeBusca = fiscal.nome_fantasia || fiscal.razao_social || "Squad Shoes";
    const listResp = await gcFetch(`/transportadoras?nome=${encodeURIComponent(nomeBusca)}`);
    const list = Array.isArray(listResp.json?.data) ? listResp.json.data : [];
    const match = list.find((t: any) => {
      const tCnpj = (t?.cnpj || "").replace(/\D/g, "");
      return tCnpj && tCnpj === cnpjDigits;
    });
    if (match?.id) {
      const id = String(match.id);
      _gcTransportadoraIdByCnpj.set(cnpjDigits, id);
      console.log(`[emit-nfe] Transportadora emitente já existe no GC: id=${id}`);
      return id;
    }

    // 2. Não achou — cria. POST /transportadoras.
    const ieDigits = (fiscal?.inscricao_estadual || "").replace(/\D/g, "");
    const logradouro = fiscal?.logradouro || fiscal?.endereco || "";
    const body: Record<string, any> = {
      tipo_pessoa: "PJ",
      nome: fiscal.nome_fantasia || fiscal.razao_social || "Squad Shoes",
      razao_social: fiscal.razao_social || fiscal.nome_fantasia || "Squad Shoes",
      cnpj: cnpjDigits,
      ativo: "1",
    };
    if (ieDigits) body.inscricao_estadual = ieDigits;
    if (fiscal?.telefone) body.telefone = fiscal.telefone;
    if (fiscal?.email) body.email = fiscal.email;
    if (logradouro || fiscal?.cidade) {
      body.enderecos = [{
        endereco: {
          cep: (fiscal?.cep || "").replace(/\D/g, ""),
          logradouro: logradouro,
          numero: fiscal?.numero || "S/N",
          complemento: fiscal?.complemento || "",
          bairro: fiscal?.bairro || "",
          nome_cidade: fiscal?.cidade || "",
          estado: fiscal?.uf || "",
        },
      }];
    }
    const createResp = await gcFetch("/transportadoras", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const newId = createResp.json?.data?.id;
    if (createResp.ok && newId) {
      const id = String(newId);
      _gcTransportadoraIdByCnpj.set(cnpjDigits, id);
      console.log(`[emit-nfe] Transportadora emitente criada no GC: id=${id}`);
      return id;
    }
    console.warn("[emit-nfe] Falha ao criar transportadora emitente:", createResp.status, JSON.stringify(createResp.json).slice(0, 300));
    return null;
  } catch (e) {
    console.warn("[emit-nfe] resolveGcTransportadoraEmitenteId exceção:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// Mapeia situacao_nf do ClickNotas → status canônico interno. Mesma lógica
// de nfe-status / sync-nfe-from-provider (evita drift entre os caminhos).
// Cobre múltiplas situações que a SEFAZ pode retornar.
// Valores REAIS de situacao_nf observados na conta em 31/07/2026 (varredura
// das 64 notas via GET /notas_fiscais_produtos): Aprovada, Cancelada,
// Reprovada, Corrigida, Em aberto.
//   ⚠ "Reprovada" (rejeição da SEFAZ) NÃO casava com nenhum predicado — não
//   contém "aprovada" nem "rejeitada" — e caía no default "processando": NF
//   rejeitada ficava eternamente "em andamento" pro operador. Por isso a
//   rejeição é testada PRIMEIRO.
//   "Corrigida" = autorizada com CC-e aplicada (só se emite carta de correção
//   sobre nota já autorizada).
function mapSituacao(situacao: string): string {
  const s = (situacao || "").toLowerCase();
  if (s.includes("reprovada") || s.includes("rejeitada") || s.includes("denegada") || s.includes("erro")) return "rejeitada";
  if (s.includes("aprovada") || s.includes("autorizada") || s.includes("corrigida")) return "autorizada";
  if (s.includes("cancelada")) return "cancelada";
  if (s.includes("processando") || s.includes("aberta") || s.includes("aguardando")) return "processando";
  return "processando";
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMPO DE "QUANTIDADE DE VOLUMES" DA NF-e — PONTO ÚNICO DE AJUSTE
// ─────────────────────────────────────────────────────────────────────────────
// O ClickNotas IGNORA os campos de volume que mandamos hoje (a NF sai com a Σ das
// quantidades dos ITENS em vez do nº de CAIXAS). O nome/estrutura EXATA do campo
// é INDOCUMENTADO. Assim que o suporte ClickNotas confirmar, ajuste SÓ AQUI:
//
//   • Campo escalar top-level (ex.: suporte diz "use qtd_volumes"):
//       NFE_VOLUME_FIELD = "qtd_volumes";   NFE_VOLUME_IS_ARRAY = false;
//   • Campo ARRAY top-level (ex.: "use volumes: [{ quantidade, ... }]"):
//       NFE_VOLUME_FIELD = "volumes";       NFE_VOLUME_IS_ARRAY = true;
//
// NFE_VOLUME_FIELD === null  → modo SHOTGUN: manda TODOS os candidatos
// (inofensivo — o ClickNotas descarta os que não reconhece). Confirmado → manda
// SÓ o campo certo (payload limpo). NADA mais no arquivo precisa mudar.
const NFE_VOLUME_FIELD: string | null = null;
const NFE_VOLUME_IS_ARRAY: boolean = false;
const NFE_VOLUME_SCALAR_CANDIDATES = [
  "quantidade_volumes", "quantidade_volume", "qtd_volumes", "numero_volumes",
];

// Monta os campos de quantidade de volumes pro top-level do payload da NF-e,
// respeitando NFE_VOLUME_FIELD (confirmado) ou o shotgun (não confirmado).
function buildVolumeCountFields(
  qty: number | undefined,
  pesoBrutoStr?: string,
  pesoLiquidoStr?: string,
): Record<string, unknown> {
  if (qty === undefined) return {};
  const arrItem = {
    quantidade: qty,
    especie: "Volumes",
    marca: "",
    ...(pesoBrutoStr ? { peso_bruto: pesoBrutoStr } : {}),
    ...(pesoLiquidoStr ? { peso_liquido: pesoLiquidoStr } : {}),
  };
  if (NFE_VOLUME_FIELD) {
    return NFE_VOLUME_IS_ARRAY
      ? { [NFE_VOLUME_FIELD]: [arrItem] }
      : { [NFE_VOLUME_FIELD]: qty };
  }
  // Shotgun: array `volumes` + todos os nomes escalares candidatos.
  const out: Record<string, unknown> = { volumes: [arrItem] };
  for (const name of NFE_VOLUME_SCALAR_CANDIDATES) out[name] = qty;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: roles, error: rolesErr } = await adminClient
      .from("user_roles").select("role").eq("user_id", userId);
    if (rolesErr) {
      return new Response(JSON.stringify({ error: "Role check failed" }), { status: 500, headers: corsHeaders });
    }
    const allowed = roles?.some((r: { role: string }) => ["admin", "gerente", "nfe_operator"].includes(r.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden: apenas admin, gerente ou operador NF-e podem emitir NF-e" }), { status: 403, headers: corsHeaders });
    }

    const { sale_order_id, company_id, dry_run = false, first_due_date = null } = await req.json();
    // 1ª data de vencimento (faturamento antecipado), ISO yyyy-mm-dd. Quando
    // presente, ancora a 1ª duplicata nesta data e as demais seguem os GAPS da
    // payment_condition. Inválida/ausente → base = hoje + dias (comportamento atual).
    const firstDueIso = typeof first_due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(first_due_date)
      ? first_due_date
      : null;
    if (!sale_order_id) {
      return new Response(JSON.stringify({ error: "sale_order_id é obrigatório" }), { status: 400, headers: corsHeaders });
    }
    // dry_run=true: roda TODAS as validações + computa peso/volumes/pagamento +
    // monta payload, mas NÃO faz POST/PUT no ClickNotas e NÃO insere em
    // nfe_emitidas. Retorna { dry_run:true, payload, preview, warnings }
    // pra EmitDialog renderizar a tela de conferência (passo 2 do wizard).
    // Side-effects pulados: POST /clientes, PUT /clientes/:id, POST /produtos,
    // POST /notas_fiscais_produtos, POST /emitir, UPDATE clients/products.
    // GETs (cidades, produtos por nome) continuam — são read-only e enriquecem
    // o preview (ex: detecta produto já cadastrado e mostra id real).
    const isDryRun = dry_run === true;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(String(sale_order_id))) {
      return new Response(JSON.stringify({ error: "sale_order_id inválido" }), { status: 400, headers: corsHeaders });
    }
    if (company_id && !UUID_RE.test(String(company_id))) {
      return new Response(JSON.stringify({ error: "company_id inválido" }), { status: 400, headers: corsHeaders });
    }

    const { data: order, error: orderErr } = await adminClient
      .from("sale_orders").select("*").eq("id", sale_order_id).single();
    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Pedido não encontrado" }), { status: 404, headers: corsHeaders });
    }

    if (order.nfe_required === false) {
      return new Response(JSON.stringify({
        error: "Pedido marcado como informal (sem NF-e). Para emitir, edite o pedido e desmarque \"Pedido informal\".",
      }), { status: 400, headers: corsHeaders });
    }

    const { data: existingActiveNfe } = await adminClient
      .from("nfe_emitidas")
      .select("id, status, ref_nfe")
      .eq("sale_order_id", sale_order_id)
      .in("status", ["processando", "autorizada", "cancelando"])
      .limit(1);
    if (existingActiveNfe && existingActiveNfe.length > 0) {
      const ex = existingActiveNfe[0];
      return new Response(JSON.stringify({
        error: `Já existe uma NF-e ${ex.status} para este pedido (ref ${ex.ref_nfe || ex.id}). Aguarde a autorização ou cancele antes de re-emitir.`,
        existing_nfe_id: ex.id,
        existing_status: ex.status,
      }), { status: 409, headers: corsHeaders });
    }

    // Limite de retentativas (qualquer status): PV-00104 acumulou 10 NFs em mai/2026
    // (r1+r2 rejeitada pelo mesmo motivo, r3-r9 ficaram em processando, r10 cancelada).
    // Cada tentativa ocupa numeração SEFAZ. >= 5 NFs do mesmo PV = sinal de cadastro
    // quebrado — bloqueia até alguém investigar (cancelar antigas no painel GC).
    const { count: totalNfes } = await adminClient
      .from("nfe_emitidas")
      .select("id", { count: "exact", head: true })
      .eq("sale_order_id", sale_order_id);
    if (totalNfes !== null && totalNfes >= 5) {
      return new Response(JSON.stringify({
        error: `Limite de retentativas atingido: ${totalNfes} NF-es já criadas pra este pedido. ` +
               `Provável problema persistente no cadastro do cliente. ` +
               `Verifique o histórico de NF-es, cancele as antigas no painel ClickNotas e corrija o erro antes de re-emitir.`,
        nfe_count: totalNfes,
      }), { status: 429, headers: corsHeaders });
    }

    const { data: items, error: itemsErr } = await adminClient
      .from("sale_order_items")
      .select("*, technical_sheets(id, name, code, ncm, gestaoclick_id, description, shoe_category, upper_material, lining_material, insole_material, sole_material, weight_per_pair_kg), products(id, name, sku, ncm, gestaoclick_id, unit)")
      .eq("sale_order_id", sale_order_id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    // Defesa: sem essa checagem, FK ausente fazia items=null e a validação
    // de total mostrava "soma 0.00 difere de X" mesmo com itens válidos.
    if (itemsErr) {
      return new Response(JSON.stringify({ error: `Falha ao carregar itens do pedido: ${itemsErr.message}` }), { status: 500, headers: corsHeaders });
    }
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: "Pedido sem itens. Adicione produtos antes de emitir a NF-e." }), { status: 400, headers: corsHeaders });
    }

    let fiscal: any = null;
    let resolvedCompanyId: string | null = company_id || null;
    if (company_id) {
      const { data: companyData } = await adminClient
        .from("companies").select("*").eq("id", company_id).eq("active", true).maybeSingle();
      if (!companyData) {
        return new Response(JSON.stringify({ error: "Empresa selecionada está inativa ou não encontrada." }), { status: 400, headers: corsHeaders });
      }
      fiscal = companyData;
    }
    if (!fiscal) {
      const { data: primaryCompany } = await adminClient
        .from("companies").select("*").eq("is_primary", true).eq("active", true).limit(1).maybeSingle();
      if (primaryCompany) { fiscal = primaryCompany; resolvedCompanyId = primaryCompany.id; }
    }
    if (!fiscal) {
      const { data: fiscalConfigs } = await adminClient.from("fiscal_config").select("*").limit(1);
      fiscal = fiscalConfigs?.[0];
    }
    if (!fiscal) {
      return new Response(JSON.stringify({ error: "Configuração fiscal não encontrada. Configure os dados fiscais em Configurações ou cadastre uma Empresa." }), { status: 400, headers: corsHeaders });
    }

    let client: any = null;
    if (order.client_id) {
      const { data: byId } = await adminClient.from("clients").select("*").eq("id", order.client_id).maybeSingle();
      client = byId;
    }
    if (!client) {
      const { data: byName } = await adminClient.from("clients").select("*").eq("razao_social", order.client_name).limit(1);
      client = byName?.[0];
    }

    const cnpjDestRaw = (order.client_cnpj || client?.cnpj || "").replace(/\D/g, "");
    if (!cnpjDestRaw || (cnpjDestRaw.length !== 11 && cnpjDestRaw.length !== 14)) {
      return new Response(JSON.stringify({ error: "Cliente sem CNPJ/CPF válido. Cadastre o documento do cliente antes de emitir a NF-e." }), { status: 400, headers: corsHeaders });
    }

    const missingAddrFields: string[] = [];
    if (!client?.endereco?.trim())  missingAddrFields.push("endereço");
    if (!client?.bairro?.trim())    missingAddrFields.push("bairro");
    if (!client?.cidade?.trim())    missingAddrFields.push("cidade");
    if (!client?.estado?.trim())    missingAddrFields.push("UF");
    if (!(client?.cep || "").replace(/\D/g, "")) missingAddrFields.push("CEP");
    if (missingAddrFields.length > 0) {
      return new Response(JSON.stringify({ error: `Endereço do cliente incompleto: ${missingAddrFields.join(", ")}. Atualize o cadastro antes de emitir.` }), { status: 400, headers: corsHeaders });
    }

    // ---------- Validação de Inscrição Estadual do destinatário ----------
    // A SEFAZ exige decisão explícita sobre contribuição de ICMS do destinatário:
    //  - Contribuinte de ICMS  → IE numérica obrigatória (sem ela → Rejeição 232).
    //  - Isento / não contribuinte → o campo precisa dizer "ISENTO" explícito,
    //    senão o sistema não tem como saber e a NF pode sair com indicador
    //    errado (Rejeição 696).
    // Campo vazio é AMBÍGUO — bloqueamos aqui, antes de qualquer chamada ao
    // ClickNotas/SEFAZ, pra forçar o cadastro correto do cliente.
    const ieDestRaw = (client.inscricao_estadual || "").trim().toUpperCase();
    const ieDestDigits = ieDestRaw.replace(/\D/g, "");
    // Auditoria 16/05/2026: novo campo `clients.icms_contribuinte` (boolean
    // nullable) tem PRIORIDADE sobre a inferência via IE. Operador define no
    // cadastro do cliente — antes era inferido só do texto da IE (ambiguidade
    // quando IE vazia). Fallback pra IE quando flag for NULL (clientes legados).
    let isContribuinte: boolean;
    let isIsento: boolean;
    if (client.icms_contribuinte === true) {
      isContribuinte = true;
      isIsento = false;
    } else if (client.icms_contribuinte === false) {
      isContribuinte = false;
      isIsento = true;
    } else {
      isIsento = ieDestRaw === "ISENTO" || ieDestRaw === "ISENTA" || ieDestRaw === "NAO CONTRIBUINTE";
      isContribuinte = ieDestDigits.length > 0 && !isIsento;
    }
    if (!isContribuinte && !isIsento) {
      const nomeCli = client.razao_social || client.nome || order.client_name || "destinatário";
      return new Response(JSON.stringify({
        error: `Cliente "${nomeCli}" sem definição de contribuição de ICMS. ` +
               `Abra o cadastro do cliente e selecione "Contribuinte de ICMS" (Sim ou Não). ` +
               `Sem essa informação a NF-e é rejeitada pela SEFAZ (Rejeição 232 ou 696).`,
      }), { status: 400, headers: corsHeaders });
    }
    // Quando flag explícita diz contribuinte mas IE está vazia/inválida.
    if (isContribuinte && ieDestDigits.length < 6) {
      const nomeCli = client.razao_social || client.nome || order.client_name || "destinatário";
      return new Response(JSON.stringify({
        error: `Cliente "${nomeCli}" marcado como Contribuinte de ICMS mas sem IE válida (precisa ao menos 6 dígitos). ` +
               `Edite o cadastro: informe a Inscrição Estadual do cliente ou marque como Isento.`,
      }), { status: 400, headers: corsHeaders });
    }

    const resolvedItems = (items || []).map((it: any) => {
      const snapshot = it.material_variant_commercial_snapshot;
      return {
        ...it,
        _hasMaterialVariant: !!it.material_variant_id,
        _variantSnapshot: snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
          ? snapshot
          : null,
      };
    });

    const billableItems = resolvedItems.filter((it) => Number(it.quantity) > 0);

    const itemsInvalidVariantSnapshot = billableItems
      .filter((it) => it._hasMaterialVariant && (
        !it._variantSnapshot
        || String(it._variantSnapshot.material_variant_id || '') !== String(it.material_variant_id)
        || !String(it._variantSnapshot.description || '').trim()
        || !String(it._variantSnapshot.sku || '').trim()
      ))
      .map((it) => `${it.technical_sheets?.code || it.reference_id || it.id} [item ${it.id}]`);
    if (itemsInvalidVariantSnapshot.length > 0) {
      return new Response(JSON.stringify({
        error: `Snapshot comercial ausente ou inválido nas referências: ${itemsInvalidVariantSnapshot.join('; ')}. Este é um bloqueio de integridade: acione a administração para diagnosticar o item no banco; a emissão não consultará o catálogo vivo nem inventará identidade histórica.`,
      }), { status: 400, headers: corsHeaders });
    }

    const itemsPendingLegacyReview = billableItems
      .filter((it) => it._hasMaterialVariant
        && it._variantSnapshot?.provenance?.historical_truth === 'unknown')
      .map((it) => `${it.technical_sheets?.code || it.reference_id || it.id} [item ${it.id}]`);
    if (itemsPendingLegacyReview.length > 0) {
      return new Response(JSON.stringify({
        error: `Identidade comercial legada ainda não comprovada nas referências: ${itemsPendingLegacyReview.join('; ')}. Comercial/Gerência deve validar SKU, NCM, descrição, cor e preço contra o pedido original e chamar a RPC administrativa review_legacy_material_variant_commercial_snapshot com p_attested_identity: primeiro p_apply=false (preview), depois p_apply=true usando o mesmo p_expected_snapshot. O catálogo atual não será tratado como verdade histórica.`,
      }), { status: 409, headers: corsHeaders });
    }

    const itemsMissingNcm: string[] = [];
    for (const it of billableItems) {
      // NF avulsa (product_id): usa NCM do produto direto.
      // NF normal (reference_id): usa NCM da variant/ficha.
      const ncm = String((
        it._hasMaterialVariant
          ? it._variantSnapshot?.ncm
          : (it.technical_sheets?.ncm || it.products?.ncm)
      ) || "").trim();
      if (!ncm || ncm.length !== 8 || !/^\d{8}$/.test(ncm)) {
        const ref = it.technical_sheets?.code || it.products?.sku || it.reference_id || it.product_id;
        itemsMissingNcm.push(`${ref} (NCM atual: "${ncm || "vazio"}")`);
      }
    }
    if (itemsMissingNcm.length > 0) {
      return new Response(JSON.stringify({ error: `NCM ausente ou inválido (precisa 8 dígitos) nas referências: ${itemsMissingNcm.join("; ")}. Corrija o item enquanto o PV estiver em Rascunho/Pendente ou faça uma revisão comercial explícita; itens avulsos usam o cadastro do produto.` }), { status: 400, headers: corsHeaders });
    }

    // Preço fiscal = preço contratado e congelado no item do PV. O override
    // vivo da variante é apenas sugestão durante a edição e nunca reprecifica NF.
    const effectivePrice = (it) => Number(it.unit_price ?? 0);
    const sumItems = billableItems.reduce(
      (s: number, it: any) => s + Number(((Number(it.quantity) || 0) * effectivePrice(it)).toFixed(2)),
      0,
    );
    const orderTotalNum = Number(order.total) || 0;
    if (Math.abs(sumItems - orderTotalNum) > 0.01) {
      return new Response(JSON.stringify({
        error: `Valor total do pedido (R$ ${orderTotalNum.toFixed(2)}) difere da soma dos itens (R$ ${sumItems.toFixed(2)}). Atualize o pedido antes de emitir a NF-e.`,
      }), { status: 400, headers: corsHeaders });
    }
    // Frete NÃO entra na NF (pedido Leonardo 2026-06-18): a NF, as duplicatas e a
    // conta a receber ficam SÓ com a mercadoria (sumItems). O frete é lançado
    // APENAS no financeiro, como despesa "Frete a pagar" — gerada pelo gatilho
    // tg_sale_order_creates_shipping_expense (financial_entries, reference_type
    // 'sale_order_frete'). valorFrete fica só pra EXIBIR no preview (informativo);
    // NUNCA vai no payload da NF nem no valor_total.
    const valorFrete = Number(order.valor_frete) || 0;
    const nfTotal = sumItems;

    // CFOP: indústria (ficha) vs revenda (avulso) × intra vs inter.
    // A tela de tributação grava 4 colunas; até agora a emissão só lia
    // companies.cfop e flipava 5↔6 — o CFOP de revenda nunca saía.
    const isInterstate = !!(client?.estado && fiscal.uf && client.estado.toUpperCase() !== String(fiscal.uf).toUpperCase());
    try {
      assertNfeCfopColumns(fiscal);
    } catch (cfopErr) {
      return new Response(JSON.stringify({
        error: cfopErr instanceof Error ? cfopErr.message : String(cfopErr),
      }), { status: 400, headers: corsHeaders });
    }
    const itemCfopResolutions: Array<{ cfop: string; kind: NfeCfopKind }> = [];

    const { count: priorCount, error: countErr } = await adminClient
      .from("nfe_emitidas").select("id", { count: "exact", head: true }).eq("sale_order_id", sale_order_id);
    if (countErr) {
      return new Response(JSON.stringify({ error: `Falha ao calcular revisão da NF-e: ${countErr.message}. Tente novamente.` }), { status: 500, headers: corsHeaders });
    }
    const revision = priorCount ?? 0;
    const ref = revision === 0 ? `nfe-${sale_order_id}` : `nfe-${sale_order_id}-r${revision + 1}`;

    if (!fiscal.cnpj || !fiscal.inscricao_estadual || !fiscal.cep) {
      return new Response(JSON.stringify({ error: "Configuração fiscal incompleta: CNPJ, Inscrição Estadual e CEP do emitente são obrigatórios." }), { status: 400, headers: corsHeaders });
    }

    // ---------- Sync lazy: cliente no ClickNotas ----------
    // O ClickNotas NÃO aceita cidade por nome — exige `cidade_id` (id interno
    // da tabela de cidades deles). E o endereço vai aninhado: enderecos[].endereco.
    // Histórico do bug "É necessário informar a cidade do destinatário":
    //  v17-v19: mandavam `cidade_nome` num endereço flat → ClickNotas ignorava
    //           o campo e gravava cidade_id="" → NF-e rejeitada.
    //  v20: resolve o cidade_id via GET /cidades?codigo=<IBGE> usando o
    //       codigo_municipio do cliente, e manda o endereço no formato
    //       aninhado correto { endereco: { cidade_id, ... } }.
    let gcClientId: string | null = client?.gestaoclick_id || null;
    // isContribuinte / isIsento / ieDestDigits já foram derivados e validados
    // logo após a checagem de endereço (campo IE vazio é bloqueado lá).

    {
      const isPj = cnpjDestRaw.length === 14;
      const ibge = (client.codigo_municipio || "").replace(/\D/g, "");

      // Resolve o id interno da cidade no ClickNotas (por código IBGE, fallback nome)
      let gcCidadeId = "";
      try {
        let cidResp = ibge ? await gcFetch(`/cidades?codigo=${ibge}`) : { ok: false, json: null };
        if ((!cidResp.ok || !cidResp.json?.data?.length) && client.cidade) {
          cidResp = await gcFetch(`/cidades?nome=${encodeURIComponent(client.cidade)}`);
        }
        const found = Array.isArray(cidResp.json?.data) ? cidResp.json.data : [];
        // Se buscou por nome e voltou mais de um, prioriza match pela UF
        const pick = found.length === 1
          ? found[0]
          : found.find((c: any) => !ibge || String(c.codigo) === ibge) || found[0];
        gcCidadeId = pick?.id ? String(pick.id) : "";
      } catch (e) {
        console.warn("[emit-nfe] lookup /cidades falhou:", e instanceof Error ? e.message : String(e));
      }
      if (!gcCidadeId) {
        return new Response(JSON.stringify({
          error: `Não foi possível resolver a cidade "${client.cidade}" (cód. IBGE ${ibge || "—"}) no ClickNotas. ` +
                 `Verifique o cadastro do cliente: cidade e Cód. Município (IBGE) precisam estar corretos.`,
        }), { status: 400, headers: corsHeaders });
      }

      const buildPayload = () => ({
        tipo_pessoa: isPj ? "PJ" : "PF",
        nome: order.client_name || client?.razao_social || client?.nome,
        // tipo_contribuinte do ClickNotas: 1=contribuinte de ICMS,
        // 2=isento de IE. O caso "sem IE e sem ISENTO" já foi bloqueado na
        // pré-validação acima, então aqui só chega contribuinte ou isento.
        tipo_contribuinte: isContribuinte ? "1" : "2",
        ...(isPj
          ? { cnpj: cnpjDestRaw, inscricao_estadual: (client.inscricao_estadual || "").replace(/\D/g, "") }
          : { cpf: cnpjDestRaw }),
        ...(client.telefone ? { telefone: client.telefone } : {}),
        ...(client.email ? { email: client.email } : {}),
        // Formato ClickNotas: array de objetos { endereco: {...} }, cidade por id.
        // splitAddress separa "Rua X, PARTE GALPAO" em logradouro+complemento
        // pra não aparecer concatenado no DANFE (fix 19/05/2026 PV-00116).
        enderecos: (() => {
          const { logradouro, complemento } = splitAddress(client.endereco, (client as any).complemento);
          return [{
            endereco: {
              cep: (client.cep || "").replace(/\D/g, ""),
              logradouro,
              numero: (client as any).numero || "S/N",
              ...(complemento ? { complemento } : {}),
              bairro: client.bairro,
              cidade_id: gcCidadeId,
              estado: client.estado,
            },
          }];
        })(),
      });

      // cidade_id preenchido no endereço retornado pelo ClickNotas?
      const hasCidade = (gcData: any): boolean => {
        const wrap = Array.isArray(gcData?.enderecos) ? gcData.enderecos[0] : null;
        const e = wrap?.endereco || wrap;
        return !!(e && String(e.cidade_id || "").trim());
      };

      const createFresh = async (): Promise<string> => {
        const r = await gcFetch("/clientes", { method: "POST", body: JSON.stringify(buildPayload()) });
        if (!r.ok || r.json?.status === "error") {
          throw new Error(`Falha ao criar cliente no ClickNotas: ${r.json?.message || r.json?.mensagem || JSON.stringify(r.json)}`);
        }
        return String(r.json?.data?.id);
      };

      if (isDryRun) {
        // Preview: não cria/atualiza cliente no GC. Apenas marca se já existe
        // cadastro (gcClientId vindo do cache) ou se será criado na emissão.
        // gcCidadeId já foi resolvido via GET acima (read-only, seguro).
      } else {
        try {
          if (!gcClientId) {
            gcClientId = await createFresh();
            if (client?.id) await adminClient.from("clients").update({ gestaoclick_id: gcClientId }).eq("id", client.id);
          } else {
            // PUT atualiza o cliente (e endereço) in-place. Retry 1x antes de
            // recriar — falha transitória do ClickNotas não deve duplicar
            // cadastro de cliente. Só recriamos se a verificação seguinte
            // realmente acusar cidade_id vazia.
            let putOk = false;
            for (let attempt = 0; attempt < 2 && !putOk; attempt++) {
              if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
              const u = await gcFetch(`/clientes/${gcClientId}`, {
                method: "PUT",
                body: JSON.stringify(buildPayload()),
              });
              putOk = u.ok && u.json?.status !== "error";
              if (!putOk) {
                console.warn(`[emit-nfe] PUT /clientes/${gcClientId} tentativa ${attempt + 1} falhou:`, u.json?.message || u.json?.mensagem || JSON.stringify(u.json));
              }
            }
            // Verifica: se mesmo assim ficou sem cidade_id, recria do zero
            const verify = await gcFetch(`/clientes/${gcClientId}`);
            if (!hasCidade(verify.json?.data)) {
              console.warn(`[emit-nfe] cliente ${gcClientId} sem cidade_id após PUT — recriando do zero`);
              gcClientId = await createFresh();
              if (client?.id) await adminClient.from("clients").update({ gestaoclick_id: gcClientId }).eq("id", client.id);
            }
          }
        } catch (e) {
          return new Response(JSON.stringify({
            error: e instanceof Error ? e.message : `Falha ao sincronizar cliente com ClickNotas: ${String(e)}`,
          }), { status: 502, headers: corsHeaders });
        }
      }
    }

    // ---------- Sync lazy: produtos no ClickNotas + payload itens ----------
    // Marca: vem do PV (sale_orders.brand). Default 'SquadShoes' (mesma default
    // do DB). Vai pro xMarca do XML SEFAZ — pedido pode override quando emite
    // pra cliente OEM/private label.
    const orderBrand = (order.brand && String(order.brand).trim()) || DEFAULT_BRAND;
    // Marca POR ITEM = silk do solado (cascata cliente→grupo econômico→padrão),
    // fallback 'Squad Shoes'. Pedido user 2026-06-07: o nome do silk ligado ao
    // solado vira a MARCA no <prod><xMarca>. Resolvido via RPC resolve_item_brand
    // (mesma cascata do app). Cache por ref+cor pra não repetir RPC por item.
    const brandCache = new Map<string, string>();
    const resolveItemBrand = async (sheetId: string | null | undefined, color: string | null | undefined): Promise<string> => {
      if (!sheetId) return DEFAULT_BRAND; // NF avulsa / sem ficha → sem solado
      const key = `${sheetId}|${(color || "").toUpperCase().trim()}`;
      const cached = brandCache.get(key);
      if (cached !== undefined) return cached;
      let brand = DEFAULT_BRAND;
      try {
        const { data } = await adminClient.rpc("resolve_item_brand", {
          p_sheet_id: sheetId,
          p_color: color ?? "",
          p_client_id: client?.id ?? null,
        });
        if (data && String(data).trim()) brand = String(data).trim();
      } catch (_e) { /* mantém DEFAULT_BRAND */ }
      brandCache.set(key, brand);
      return brand;
    };
    const produtosGC: any[] = [];
    // Companion array só pra preview: dados legíveis (descrição, cor, status no GC).
    // Não vai pro payload do GC — usado apenas no dry_run pra montar a tabela
    // de conferência do EmitDialog.
    const produtosPreview: Array<{
      descricao: string;
      codigo: string;
      ncm: string;
      cfop: string;
      origem: NfeCfopKind;
      quantidade: number;
      unidade: string;
      valor_unitario: number;
      valor_total: number;
      marca: string;
      gc_status: 'cached' | 'found_by_name' | 'pending_create';
      gc_id: string | null;
    }> = [];
    for (const it of billableItems) {
      const ts = it.technical_sheets;
      const prod = it.products; // NF avulsa: dados vêm de products
      const variant = it._variantSnapshot;
      const hasMaterialVariant = it._hasMaterialVariant;
      const isStandalone = !ts && !!prod;
      const itemKind = classifyNfeItemOrigin({
        technical_sheets: ts,
        reference_id: it.reference_id,
        products: prod,
      });
      const itemCfop = resolveNfeCfop({ isInterstate, kind: itemKind, fiscal });
      itemCfopResolutions.push(itemCfop);
      const ncm = String((
        hasMaterialVariant ? variant?.ncm : (ts?.ncm || prod?.ncm)
      ) || "").trim();
      const price = effectivePrice(it);
      const baseName = ts?.name || prod?.name || "Produto";
      const itemColor = (variant?.color || it.color || '').toString().trim();
      const desc = (
        hasMaterialVariant
          ? String(variant?.description || '')
          : (itemColor ? `${baseName} - ${itemColor}` : baseName)
      ).trim();
      // Código do produto na NF (cProd no XML / "CÓDIGO PRODUTO" no DANFE) = o
      // SKU/Código da ficha (technical_sheets.code). Pedido do dono 2026-06-20:
      // a NF deve mostrar o NOSSO código, não o codigo_interno auto do ClickNotas
      // (ex.: 903927). Variante pode sobrescrever (variant.sku); NF avulsa usa o
      // products.sku/code. Mandamos tanto na linha quanto no cadastro do produto.
      const codigoNf = String((
        hasMaterialVariant
          ? variant?.sku
          : (ts?.code || prod?.sku || prod?.code)
      ) || "").trim();
      // Unidade comercial na NF. Pedido do dono em 01/06/2026, validando contra
      // a NF #248 revisada pela contabilidade (o DANFE de referência sai com
      // "UN", não "PAR"): forçar "UN". Vale também p/ NF avulsa de standalone
      // (antes puxava products.unit que podia vir "kg"/etc).
      const unidade = "UN";

      // Marca deste item: silk do solado (cascata) ou 'Squad Shoes'.
      const itemBrand = await resolveItemBrand(it.reference_id, itemColor);

      // Resolução do produto no ClickNotas — descrição + SKU congelados.
      // O ClickNotas ignora `codigo` no POST e gera um código interno; por isso
      // o nome técnico do cadastro incorpora o SKU. O nome fiscal da linha
      // continua sendo somente a descrição congelada do snapshot.
      // technical_sheets.gestaoclick_id NUNCA é usado (uma ficha = N cores).
      // products.gestaoclick_id (NF avulsa) continua sendo cache válido.
      const nomeProduto = desc.slice(0, 120);
      let nomeProdutoCadastro = nomeProduto;
      if (hasMaterialVariant) {
        try {
          nomeProdutoCadastro = buildClickNotasTechnicalProductName(desc, codigoNf);
        } catch (identityError) {
          return new Response(JSON.stringify({
            error: `Identidade ClickNotas inválida para "${nomeProduto}" / SKU "${codigoNf || '<vazio>'}": ${identityError instanceof Error ? identityError.message : String(identityError)}`,
          }), { status: 400, headers: corsHeaders });
        }
      }
      let gcProductId: string | null = isStandalone ? (prod?.gestaoclick_id || null) : null;
      let gcStatus: 'cached' | 'found_by_identity' | 'pending_create' = gcProductId ? 'cached' : 'pending_create';
      if (!gcProductId) {
        if (isDryRun) {
          // Preview não cria claim nem produto. A execução real consulta o
          // registry distribuído e pode reutilizar um technical_name anterior.
          const lookup = await gcFetch(`/produtos?nome=${encodeURIComponent(nomeProdutoCadastro)}`);
          const foundList = Array.isArray(lookup.json?.data) ? lookup.json.data : [];
          const identityResolution = resolveClickNotasProductIdentity(foundList, nomeProdutoCadastro);
          if (identityResolution.kind === 'match' && identityResolution.product.id) {
            gcProductId = String(identityResolution.product.id);
            gcStatus = 'found_by_identity';
          } else if (identityResolution.kind === 'conflict') {
            return new Response(JSON.stringify({
              error: `Conflito de identidade no ClickNotas para "${nomeProdutoCadastro}": ${identityResolution.reason}. O cadastro externo não será reutilizado; revise a duplicidade antes de emitir.`,
            }), { status: 409, headers: corsHeaders });
          }
        } else {
          const identityKind = hasMaterialVariant ? 'material_variant_sku' : 'technical_name';
          const identityValue = hasMaterialVariant ? codigoNf : nomeProdutoCadastro;
          const ownerToken = crypto.randomUUID();
          try {
            const provisioned = await provisionClickNotasProductIdentity({
              claim: async () => {
                const { data, error } = await adminClient.rpc('claim_clicknotas_product_identity', {
                  p_identity_kind: identityKind,
                  p_identity_value: identityValue,
                  p_technical_name: nomeProdutoCadastro,
                  p_owner_token: ownerToken,
                  p_correlation_id: `emit-nfe:${sale_order_id}:${it.id}`,
                  p_lease_seconds: 120,
                });
                if (error) throw new Error(`Falha ao adquirir claim ClickNotas: ${error.message}`);
                return data as ClickNotasProductClaimResult;
              },
              lookup: async (technicalName) => {
                const lookup = await gcFetch(`/produtos?nome=${encodeURIComponent(technicalName)}`);
                if (!lookup.ok || lookup.json?.status === 'error') {
                  throw new Error(
                    `Falha ao consultar identidade ClickNotas "${technicalName}": ${lookup.json?.data?.mensagem || lookup.json?.message || lookup.json?.mensagem || JSON.stringify(lookup.json)}`,
                  );
                }
                const foundList = Array.isArray(lookup.json?.data) ? lookup.json.data : [];
                const resolution = resolveClickNotasProductIdentity(foundList, technicalName);
                if (resolution.kind === 'match' && resolution.product.id) {
                  return { kind: 'match', providerId: String(resolution.product.id) };
                }
                if (resolution.kind === 'conflict' || resolution.kind === 'match') {
                  return {
                    kind: 'conflict',
                    message: `Conflito de identidade no ClickNotas para "${technicalName}"; revise cadastros duplicados ou sem ID.`,
                  };
                }
                return { kind: 'not_found' };
              },
              beginPost: async (leaseGeneration) => {
                const { data, error } = await adminClient.rpc('begin_clicknotas_product_post', {
                  p_identity_kind: identityKind,
                  p_identity_value: identityValue,
                  p_owner_token: ownerToken,
                  p_lease_generation: leaseGeneration,
                });
                if (error) throw new Error(`Falha ao registrar início do POST ClickNotas: ${error.message}`);
                return data as ClickNotasProductBeginPostResult;
              },
              create: async (technicalName) => {
                // Cadastro enriquecido: a linha fiscal usa nomeProduto; somente
                // o cadastro externo usa o technical_name write-once do claim.
                const techDescParts = [
                  ts?.description?.trim(),
                  ts?.upper_material ? `Cabedal: ${ts.upper_material}` : null,
                  ts?.lining_material ? `Forro: ${ts.lining_material}` : null,
                  ts?.insole_material ? `Palmilha: ${ts.insole_material}` : null,
                  ts?.sole_material ? `Solado: ${ts.sole_material}` : null,
                  itemColor ? `Cor: ${itemColor}` : null,
                ].filter(Boolean);
                const fullDesc = hasMaterialVariant
                  ? desc.slice(0, 500)
                  : techDescParts.join(' | ').slice(0, 500);
                const gtinVariante = (variant?.gtin || '').trim();
                const pesoKg = Number(ts?.weight_per_pair_kg || 0);
                const productPayload: Record<string, unknown> = {
                  nome: technicalName,
                  valor_venda: price.toFixed(2),
                  unidade: "UN",
                  ncm,
                  tipo: "P",
                  marca: itemBrand,
                };
                if (fullDesc) productPayload.descricao = fullDesc;
                if (codigoNf) productPayload.codigo = codigoNf;
                if (gtinVariante) productPayload.gtin = gtinVariante;
                if (pesoKg > 0) {
                  productPayload.peso_bruto = pesoKg.toFixed(3);
                  productPayload.peso_liquido = pesoKg.toFixed(3);
                }
                if (ts?.shoe_category) productPayload.categoria = ts.shoe_category;
                const r = await gcFetch("/produtos", {
                  method: "POST",
                  body: JSON.stringify(productPayload),
                });
                if (!r.ok || r.json?.status === "error") {
                  if (r.status === 429) {
                    throw new ClickNotasProductPostDefinitelyRejectedError(
                      `ClickNotas recusou por limite de requisições sem processar o produto "${technicalName}".`,
                    );
                  }
                  throw new Error(
                    `Falha ao sincronizar produto "${technicalName}" com ClickNotas: ${r.json?.data?.mensagem || r.json?.message || r.json?.mensagem || JSON.stringify(r.json)}`,
                  );
                }
                const providerId = String(r.json?.data?.id || '').trim();
                if (!providerId) throw new Error('ClickNotas criou produto sem retornar ID.');
                return { providerId };
              },
              complete: async (leaseGeneration, providerId) => {
                const { data, error } = await adminClient.rpc('complete_clicknotas_product_identity', {
                  p_identity_kind: identityKind,
                  p_identity_value: identityValue,
                  p_owner_token: ownerToken,
                  p_lease_generation: leaseGeneration,
                  p_provider_id: providerId,
                });
                if (error) throw new Error(`Falha ao concluir claim ClickNotas: ${error.message}`);
                return data as ClickNotasProductCompletionResult;
              },
              recordOutcome: async (leaseGeneration, outcome, errorMessage, retrySeconds) => {
                const { error } = await adminClient.rpc('record_clicknotas_product_identity_outcome', {
                  p_identity_kind: identityKind,
                  p_identity_value: identityValue,
                  p_owner_token: ownerToken,
                  p_lease_generation: leaseGeneration,
                  p_outcome: outcome,
                  p_error: errorMessage,
                  p_retry_seconds: retrySeconds,
                });
                if (error) throw error;
              },
              reconcile: async (observation, providerId, errorMessage) => {
                const { data, error } = await adminClient.rpc('reconcile_clicknotas_product_identity', {
                  p_identity_kind: identityKind,
                  p_identity_value: identityValue,
                  p_observation: observation,
                  p_provider_id: providerId,
                  p_error: errorMessage,
                  p_correlation_id: `emit-nfe:${sale_order_id}:${it.id}`,
                });
                if (error) throw new Error(`Falha ao reconciliar identidade ClickNotas: ${error.message}`);
                return data as ClickNotasProductReconciliationResult;
              },
            });
            gcProductId = provisioned.providerId;
            gcStatus = provisioned.source === 'external_lookup'
              ? 'found_by_identity'
              : 'cached';
          } catch (identityError) {
            const status = identityError instanceof ClickNotasProductClaimBusyError
              || identityError instanceof ClickNotasProductIdentityConflictError
              || identityError instanceof ClickNotasProductReconciliationRequiredError
              ? 409
              : 502;
            return new Response(JSON.stringify({
              error: identityError instanceof Error ? identityError.message : String(identityError),
            }), { status, headers: corsHeaders });
          }
        }
        if (isStandalone && prod?.id && gcProductId && !isDryRun) {
          await adminClient.from("products").update({ gestaoclick_id: gcProductId }).eq("id", prod.id);
        }
      }

      const qty = Number(it.quantity) || 0;
      produtosGC.push({
        produto_id: gcProductId,
        // Código do produto na linha da NF = nosso SKU/Código (ficha.code).
        // ⚠ O nome do campo é `codigo_produto` — a spec lista, como campos do
        // item que sobrescrevem o cadastro: produto_id, codigo_produto,
        // nome_produto, unidade, quantidade, valor_venda, valor_custo, NCM.
        // Até 31/07/2026 mandávamos `codigo` (inexistente) e o DANFE saía com o
        // EAN auto do ClickNotas (ex.: 4715271514130 na NF #255) em vez do nosso
        // SKU — o pedido do dono de 2026-06-20 nunca chegou a funcionar.
        ...(codigoNf ? { codigo_produto: codigoNf } : {}),
        // nome_produto: trava a descrição da linha no que o preview mostrou,
        // em vez de herdar silenciosamente o nome do cadastro no GC.
        nome_produto: nomeProduto,
        quantidade: qty.toFixed(2),
        // valor_venda é o preço UNITÁRIO — o ClickNotas multiplica por
        // quantidade internamente. Antes mandávamos (qtd × preço) e o
        // total saía qtd² × preço (ex: R$ 8.3M em vez de R$ 25k).
        valor_venda: price.toFixed(2),
        cfop: itemCfop.cfop,
        unidade: unidade,
        NCM: ncm,
        tipo: "P",
        marca: itemBrand, // marca por item = silk do solado (fallback Squad Shoes)
      });
      produtosPreview.push({
        descricao: nomeProduto,
        codigo: codigoNf,
        ncm,
        cfop: itemCfop.cfop,
        origem: itemKind,
        quantidade: qty,
        unidade,
        valor_unitario: price,
        valor_total: Number((qty * price).toFixed(2)),
        marca: itemBrand,
        gc_status: gcStatus,
        gc_id: gcProductId,
      });
    }

    const headerCfop = resolveHeaderNfeCfop(itemCfopResolutions);
    const resolvedCfop = headerCfop.cfop;
    const ncmChapterWarnings = produtosPreview
      .filter((p) => p.origem === 'industrial' && p.ncm && !p.ncm.startsWith('64'))
      .map((p) => `${p.codigo || p.descricao} (NCM ${p.ncm})`);

    // ---------- Calcula peso bruto/líquido via RPC ----------
    // Soma SUM(items.quantity × technical_sheets.weight_per_pair_kg) e
    // adiciona peso da caixinha individual (box_weight_kg). Itens com
    // ficha sem peso vão pra `incomplete_items` — não bloqueamos a
    // emissão, apenas anotamos em informacoes_complementares pra
    // contabilidade revisar depois.
    let pesoBrutoStr: string | undefined;
    let pesoLiquidoStr: string | undefined;
    let qtdVolumesStr: string | undefined;
    let weightWarning: string | undefined;
    // TRUE quando NENHUM peso veio das fichas e caímos no chute cego de 0,5
    // kg/par — sinal forte pra UI destacar (não é estimativa por solado, é
    // fallback genérico que pode estar bem longe do peso real).
    let weightFallbackBlind = false;
    try {
      const { data: weightData, error: weightErr } = await adminClient.rpc(
        "calculate_sale_order_weight",
        { p_sale_order_id: sale_order_id },
      );
      if (weightErr) {
        console.warn(
          "[emit-nfe] calculate_sale_order_weight falhou — NF-e seguirá sem peso (provedor preencherá default):",
          weightErr.message,
        );
      } else if (weightData) {
        const wd: any = weightData;
        const net = Number(wd.net_weight_kg) || 0;
        const gross = Number(wd.gross_weight_kg) || 0;
        const estimated = Number(wd.net_weight_estimated_kg) || 0;
        if (net > 0) pesoLiquidoStr = net.toFixed(3);
        if (gross > 0) pesoBrutoStr = gross.toFixed(3);
        if (wd.is_complete === false && Array.isArray(wd.incomplete_items)) {
          const n = wd.incomplete_items.length;
          const semEstimativa = wd.incomplete_items.filter(
            (it: any) => !it.estimated_kg_per_pair || Number(it.estimated_kg_per_pair) <= 0,
          ).length;
          const comEstimativa = n - semEstimativa;
          if (comEstimativa > 0 && estimated > 0) {
            weightWarning = `Peso parcial: ${comEstimativa} item(s) com peso ESTIMADO via média do solado (~${estimated.toFixed(3)} kg).`;
          }
          if (semEstimativa > 0) {
            weightWarning = (weightWarning ? weightWarning + " " : "")
              + `${semEstimativa} item(s) sem cadastro de peso na ficha técnica (e sem outras fichas com mesmo solado pra estimar).`;
          }
          console.warn(
            `[emit-nfe] PV ${sale_order_id} com peso parcial — ${n} ficha(s) incompletas (${comEstimativa} estimadas, ${semEstimativa} sem estimativa).`,
          );
        }
      }
    } catch (e) {
      console.warn(
        "[emit-nfe] Exceção ao calcular peso — NF-e seguirá sem peso:",
        e instanceof Error ? e.message : String(e),
      );
    }

    // Auditoria A8: garante que peso sempre vai pra SEFAZ. Se RPC falhou ou
    // todas as fichas estão sem weight_per_pair_kg, usa fallback de 0.5 kg
    // por par (média histórica da indústria pra calçado feminino completo
    // com caixa individual). Sem peso, XML sai com <pesoB/> vazio e SEFAZ
    // pode rejeitar dependendo do NCM. Aviso registrado em informacoes
    // complementares pra contabilidade revisar.
    if (!pesoBrutoStr || !pesoLiquidoStr) {
      const totalPairsFallback = billableItems.reduce(
        (s: number, it: any) => s + (Number(it.quantity) || 0),
        0,
      );
      if (totalPairsFallback > 0) {
        const estimatedKg = (totalPairsFallback * 0.5).toFixed(3);
        if (!pesoLiquidoStr) pesoLiquidoStr = estimatedKg;
        if (!pesoBrutoStr) pesoBrutoStr = estimatedKg;
        weightFallbackBlind = true;
        weightWarning = (weightWarning ? weightWarning + " " : "")
          + `⚠ PESO CHUTADO: nenhuma ficha tem peso cadastrado — usado fallback CEGO de `
          + `0,5 kg/par (${totalPairsFallback} pares = ${estimatedKg} kg), que pode estar `
          + `bem longe do real. Cadastre weight_per_pair_kg nas fichas técnicas antes de emitir.`;
        console.warn(
          `[emit-nfe] ⚠ PV ${sale_order_id} SEM peso cadastrado — fallback CEGO 0,5 kg/par = ${estimatedKg} kg (peso da NF pode estar errado)`,
        );
      }
    }

    // ---------- Calcula volumes da NF segundo packaging_mode do PV ----------
    // Regras (confirmadas com usuário em 2026-05-16):
    //   individual_master           → cada CAIXA MASTER = 1 volume (12 pares dentro)
    //   colmeia                     → cada CAIXA COLMEIA = 1 volume (12 pares dentro)
    //   individual_fitilho/amarrado → cada PAR = 1 volume (fitilho amarra mas não
    //                                  agrupa em master; transportadora conta par a par)
    //
    // Implementado em compute_sale_order_nfe_volumes(): consome packaging_mode
    // + technical_sheet_box_types + box_types.pairs_per_box_default. Substituiu
    // o cálculo antigo que sempre dividia por pairs_per_box_individual, ignorando
    // o modo do PV (gerava NFs com volumes errados no modo master/colmeia).
    // volumesWarning: a RPC devolve unconfigured=true quando o modo do PV exige
    // uma caixa (colmeia/master) que NÃO existe no cadastro e o nº de volumes
    // saiu do default de 12 pares/caixa embutido no SQL. Auditoria de volumes
    // 31/07/2026: isso vale HOJE pra 52 dos 58 PVs — nenhum box_type do tipo
    // 'colmeia'/'master' está cadastrado, então TODO volume de NF-e é um chute.
    // Não bloqueamos (volume é campo obrigatório e travar a emissão por falta de
    // cadastro seria pior), mas o operador tem que ver.
    let volumesWarning: string | undefined;
    try {
      const { data: volRow, error: volErr } = await adminClient
        .rpc("compute_sale_order_nfe_volumes", { p_sale_order_id: sale_order_id });
      if (volErr) {
        console.warn("[emit-nfe] compute_sale_order_nfe_volumes falhou:", volErr.message);
      } else {
        // RPC retorna TABLE(...) → array de rows. Aceita tb objeto direto
        // por defesa contra mudanças no comportamento do supabase-js.
        const row = Array.isArray(volRow) ? volRow[0] : volRow;
        const v = Number((row as any)?.volumes) || 0;
        const mode = (row as any)?.mode || "?";
        const unconfigured = (row as any)?.unconfigured === true;
        if (v > 0) {
          qtdVolumesStr = String(v);
          console.log(`[emit-nfe] volumes=${v} (mode=${mode}, unconfigured=${unconfigured}) PV ${sale_order_id}`);
        } else {
          console.warn(`[emit-nfe] compute_sale_order_nfe_volumes retornou v=${v} (mode=${mode}). Fallback=1.`);
        }
        if (unconfigured) {
          volumesWarning =
            `Volumes (${v || "?"}) calculados com o DEFAULT de 12 pares por caixa — não há caixa do tipo `
            + `"${mode}" cadastrada para as referências deste pedido. Se a caixa real levar outra quantidade, `
            + `o número de volumes da NF está errado. Cadastre em Estoque → Grupos → editar o solado → aba Embalagem.`;
          console.warn(`[emit-nfe] PV ${sale_order_id}: volumes vindos de fallback (nenhum box_type '${mode}' cadastrado)`);
        }
      }
    } catch (e) {
      console.warn("[emit-nfe] Exceção ao calcular volumes:", e instanceof Error ? e.message : String(e));
    }
    // Defesa: nunca enviar quantidade vazia/nula. Mínimo 1 volume.
    if (!qtdVolumesStr || qtdVolumesStr === "0") qtdVolumesStr = "1";

    // Fallback baseado em packaging_mode QUANDO a RPC falhou completamente.
    // Não valida "volumes > total_pairs" porque em modos individual_fitilho/
    // amarrado a quantidade de volumes É IGUAL ao total de pares (1 par = 1
    // volume amarrado/com fitilho) — não é bug. Em individual_master/colmeia,
    // dividir pelo pairs_per_box_default (12 é padrão histórico Squad Shoes).
    if (qtdVolumesStr === "1") {
      // Só recalcula se temos sinal claro de que a RPC não retornou um
      // valor sensato — o "1" é o fallback default. Pra outros modos,
      // a RPC sabe melhor.
      const pkgMode = (order as any).packaging_mode || "";
      const totalPairsForVolumeCheck = billableItems.reduce(
        (s: number, it: any) => s + (Number(it.quantity) || 0), 0,
      );
      if (totalPairsForVolumeCheck > 1) {
        if (pkgMode === "individual_fitilho" || pkgMode === "individual_amarrado") {
          // Cada par = 1 volume amarrado/com fitilho
          qtdVolumesStr = String(totalPairsForVolumeCheck);
        } else if (pkgMode === "individual_master" || pkgMode === "colmeia") {
          // Cada caixa master/colmeia agrupa pairs_per_box_default pares
          // (default histórico = 12). RPC normalmente cobre esse caso —
          // este é só fallback se a RPC falhou.
          qtdVolumesStr = String(Math.max(1, Math.ceil(totalPairsForVolumeCheck / 12)));
        }
        // Outros modos (sem packaging_mode definido) ficam com "1".
        console.log(`[emit-nfe] fallback de volumes aplicado: mode=${pkgMode} → ${qtdVolumesStr}`);
      }
    }

    // ---------- Coerência do packaging_mode ----------
    // PV em modo amarrado/fitilho declara 1 volume por PAR. Se as fichas dos
    // itens têm caixa MASTER/COLMEIA cadastrada, o mais provável é que o modo
    // tenha ficado no default (amarrado) sem revisão — a NF sairia com muitos
    // volumes a mais. Avisa (não bloqueia: amarrado é um modo legítimo).
    let packagingModeWarning: string | undefined;
    try {
      const pkgM = String((order as any).packaging_mode || "");
      if (pkgM === "individual_amarrado" || pkgM === "individual_fitilho") {
        const refIds = [...new Set(
          billableItems.map((it: any) => it.reference_id).filter(Boolean),
        )];
        if (refIds.length > 0) {
          const { data: collBoxes } = await adminClient
            .from("technical_sheet_box_types")
            .select("box_types!inner(tipo)")
            .in("sheet_id", refIds);
          const hasCollective = (collBoxes || []).some((r: any) =>
            ["master", "colmeia"].includes(String(r.box_types?.tipo)));
          if (hasCollective) {
            packagingModeWarning =
              `Modo "${pkgM}" declara 1 volume por par (${qtdVolumesStr} volumes), mas as `
              + `fichas têm caixa master/colmeia cadastrada. Confira o modo do PV — se os `
              + `pares vão em caixa coletiva, troque pra "Master" pra a NF declarar o nº `
              + `correto de caixas.`;
            console.warn(
              `[emit-nfe] PV ${sale_order_id}: packaging_mode possivelmente incoerente (${pkgM} com caixa coletiva cadastrada)`,
            );
          }
        }
      }
    } catch (e) {
      console.warn("[emit-nfe] check de packaging_mode falhou:", e instanceof Error ? e.message : String(e));
    }

    // Informações Complementares — concatena ordem que aparece no XML:
    //   [OC do cliente] · [Texto livre do user] · [PV interno] · [Aviso peso]
    // OC é puxada de sale_orders.client_order_number (preenchida no PV pelo
    // operador). Texto livre vem de sale_orders.informacoes_complementares_nf
    // (campo dedicado que aparece SÓ aqui, não polui notes internas).
    const ocPart = order.client_order_number
      ? `OC do Cliente: ${String(order.client_order_number).trim()}`
      : null;
    const livrePart = order.informacoes_complementares_nf
      ? String(order.informacoes_complementares_nf).trim()
      : null;
    // Simples Nacional (companies.regime_tributario = '1'): o aviso da
    // LC 123/2006 é OBRIGATÓRIO no campo de informações complementares.
    // O ClickNotas injeta esse texto quando NÃO mandamos o campo — mas quando
    // mandamos, ele SUBSTITUI: a NF #278 saiu só com "OC do Cliente: 300102" e
    // perdeu o aviso legal (auditoria 31/07/2026). E o comportamento sem o
    // campo não é determinístico (#256 veio com o texto, #255 veio vazio).
    // Então prefixamos nós mesmos, com o texto exato que o painel usa.
    const avisoSimplesNacional = String(fiscal.regime_tributario ?? "") === "1"
      ? "I - DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL.\r\n"
        + "II - NAO GERA DIREITO A CREDITO FISCAL DE IPI."
      : null;
    // ⚠ O trecho "Pedido de Venda: <numero>" precisa continuar íntegro: o
    // sync-nfe-from-provider usa exatamente esse texto (extractPvNumber) pra
    // religar a nota ao PV. Não reformatar sem ajustar o regex de lá.
    const complementoOperacional = [
      ocPart,
      livrePart,
      order.order_number ? `Pedido de Venda: ${order.order_number}` : null,
      weightWarning,
    ].filter(Boolean).join(" · ");
    // Aviso legal e texto operacional separados por quebra de linha (o " · "
    // fica ilegível depois de um bloco legal de 2 linhas).
    const informacoesComplementares = [avisoSimplesNacional, complementoOperacional]
      .filter(Boolean).join("\r\n") || undefined;

    // ---------- Monta as duplicatas (campo `pagamento` da NF) ----------
    // A NF-e precisa da fatura/duplicata pra ficar completa (a NF de
    // referência emitida pelo painel tem). Derivamos as parcelas da
    // `payment_condition` do PV: ela pode ser "60", "30/60/90", "à vista"…
    // — extraímos os prazos em dias; cada um vira uma parcela com
    // vencimento = data de emissão + prazo. forma_pagamento_id 6519268 =
    // "Boleto Bancário" (tipo BB) no ClickNotas — padrão da Squad Shoes.
    const FORMA_PAGAMENTO_BOLETO = "6519268";
    const buildPagamento = (): any[] => {
      const cond = String(order.payment_condition || "").trim();
      const prazos = (cond.match(/\d+/g) || []).map(Number).filter((n) => n >= 0);
      const lista = prazos.length > 0 ? prazos : [0]; // sem prazo → à vista
      const n = lista.length;
      const totalCent = Math.round(nfTotal * 100);
      const baseCent = Math.floor(totalCent / n);
      const hoje = new Date();
      // Override: ancora na 1ª data escolhida; demais seguem os gaps da condição
      // (dias[i] - dias[0]). Sem override: base = hoje + dias[i] (comportamento atual).
      const anchor = firstDueIso ? new Date(`${firstDueIso}T00:00:00`) : null;
      const firstOffset = lista[0];
      return lista.map((dias, i) => {
        const venc = anchor ? new Date(anchor) : new Date(hoje);
        venc.setDate(venc.getDate() + (anchor ? dias - firstOffset : dias));
        const dd = String(venc.getDate()).padStart(2, "0");
        const mm = String(venc.getMonth() + 1).padStart(2, "0");
        const yyyy = venc.getFullYear();
        // última parcela absorve o resto do arredondamento
        const cent = i === n - 1 ? totalCent - baseCent * (n - 1) : baseCent;
        return {
          numero_duplicata: String(i + 1),
          forma_pagamento_id: FORMA_PAGAMENTO_BOLETO,
          data_vencimento: `${dd}/${mm}/${yyyy}`,
          valor_pagamento: (cent / 100).toFixed(2),
          tipo_pagamento: "BB",
        };
      });
    };
    const pagamentoArr = buildPagamento();

    // ---------- Cria a NF-e no ClickNotas (rascunho) ----------
    // Natureza de operação: usa fiscal.natureza_operacao (cadastro de
    // companies) — antes era hardcode "Operação não presencial, outros"
    // mas a NF modelo #248 (revisada pela contabilidade em 19/05/2026)
    // saiu com "Venda de Produção do Estabelecimento". Empresa atualizou
    // o cadastro pra refletir isso (companies.natureza_operacao). Sem
    // fallback, usa o nome do XML padrão SEFAZ.
    // O painel ClickNotas é a fonte da verdade pra consumidor_final /
    // indicador_destinatario / CFOP e para a tributação (IPI/PIS/COFINS/CSOSN)
    // — campos do payload da API são ignorados. Os CSTs (IPI 99/enq.999,
    // PIS 49, COFINS 49) e o CSOSN saem do cadastro da natureza no painel
    // ClickNotas (a API não tem endpoint de tributação).
    const naturezaEsperada = (fiscal.natureza_operacao || "").trim()
      || "Venda de Produção do Estabelecimento";

    // ---------- Bloco `transporte` (peso bruto / líquido / volumes) ----------
    // ClickNotas ignora `peso_bruto` / `peso_liquido` / `quantidade_volumes`
    // se mandados no top-level — a doc deles exige dentro de
    // `transporte.volumes[]`. Mandávamos no topo até NF #244 e o XML saía com
    // <pesoB>/<pesoL> vazios. especie: "Volumes" — XML SEFAZ alvo confirmado
    // pelo user em 19/05/2026 (era "Volumes" caps, antes "CX"). Plural com
    // capital só na 1ª letra é o que sai no DANFE/XML aprovado pela contabilidade.
    // modalidade_frete (SEFAZ modFrete):
    //   0 = Frete por conta do REMETENTE (CIF)
    //   1 = Frete por conta do DESTINATÁRIO (FOB)
    //   2 = Frete por conta de terceiros
    //   3 = Transporte próprio por conta do REMETENTE   ← Squad Shoes (pedido user 18/05/2026)
    //   4 = Transporte próprio por conta do destinatário
    //   9 = Sem ocorrência de transporte
    // Histórico de mudança: era "9" (sem frete) → "3" (transporte próprio) →
    // "0" (CIF) → "3" (Transporte próprio do remetente — Squad usa veículo próprio,
    // não terceiriza nem deixa pro cliente; é a categoria fiscalmente correta).
    // modFrete=3 (transporte próprio do REMETENTE) exige que o bloco
    // <transporta> da NF-e seja preenchido com os dados do PRÓPRIO emitente
    // — sem isso, contabilidade reclama porque o XML sai com transportador
    // vazio mas indicando "transporte próprio" (incongruente fiscalmente).
    // Pedido user 18/05/2026: "frete próprio, então os dados do frete devem
    // ser os meus". Tudo puxado de fiscal.* (companies/fiscal_config já carregado).
    const emitenteCnpjDigits = (fiscal.cnpj || "").replace(/\D/g, "");
    const emitenteIeDigits = (fiscal.inscricao_estadual || "").replace(/\D/g, "");
    const emitenteEndereco = [fiscal.logradouro || fiscal.endereco, fiscal.numero || "S/N"]
      .filter(Boolean).join(", ");
    const transportadorBlock: Record<string, string> = {};
    if (fiscal.razao_social || fiscal.nome_fantasia) {
      transportadorBlock.nome = fiscal.razao_social || fiscal.nome_fantasia;
    }
    if (emitenteCnpjDigits.length === 14) transportadorBlock.cnpj = emitenteCnpjDigits;
    if (emitenteIeDigits) transportadorBlock.inscricao_estadual = emitenteIeDigits;
    if (emitenteEndereco) transportadorBlock.endereco = emitenteEndereco;
    if (fiscal.cidade) transportadorBlock.cidade = fiscal.cidade;
    if (fiscal.uf) transportadorBlock.estado = fiscal.uf;

    // Resolve loja_id do ClickNotas — obrigatório segundo a doc da API.
    // Empresa não-primária SEM loja mapeada é bloqueada aqui: a NF sairia sob o
    // CNPJ da matriz enquanto o registro local diria outra empresa. Vale também
    // no dry_run — o operador precisa ver isso no preview, não na emissão.
    const { lojaId: gcLojaId, blockReason: lojaBlockReason } = await resolveGcLojaId(fiscal);
    if (lojaBlockReason) {
      return new Response(JSON.stringify({ error: lojaBlockReason }), { status: 400, headers: corsHeaders });
    }

    // Resolve (cria se preciso) transportadora "Squad Shoes" no ClickNotas.
    const gcTransportadoraId = await resolveGcTransportadoraEmitenteId(fiscal);

    // Estrutura reformulada 20/05/2026 — NF #248 saiu com modFrete=0 e volumes
    // vazios mesmo passando "3" em ambos níveis. Hipóteses do que mudou:
    //  1) GC espera modalidade_frete como INT (não string)
    //  2) GC espera `transportadora.id` aninhado (não `transportador` com nome/cnpj)
    //  3) GC espera `volumes` como OBJETO (não array)
    //  4) Espécie correta é "Volumes" caps (não "Volumes")
    //  5) `marca` precisa ser explícita (pedido user: "Squad Shoes")
    // marca do <vol> = marcação de TRANSPORTE do volume (não a marca do
    // produto). A Squad Shoes não usa marcação por volume → vai VAZIA. Pôr a
    // marca comercial aqui era semanticamente errado (a marca do produto já
    // vai em <prod><xMarca> por item = silk do solado).
    const volumesObj: Record<string, string | number> = {
      especie: "Volumes",
      marca: "",
    };
    // qVol é INTEIRO no XML SEFAZ — envia como number, não string. Esta é a
    // quantidade DENTRO de transporte.volumes — só mais UM candidato (shotgun).
    // Quando o campo for confirmado (NFE_VOLUME_FIELD), o nº de volumes vai só no
    // campo certo (top-level, via buildVolumeCountFields) — aqui fica só o peso.
    if (qtdVolumesStr && !NFE_VOLUME_FIELD) volumesObj.quantidade = Math.max(1, Math.trunc(Number(qtdVolumesStr)) || 1);
    if (pesoLiquidoStr) volumesObj.peso_liquido = pesoLiquidoStr;
    if (pesoBrutoStr) volumesObj.peso_bruto = pesoBrutoStr;
    // Variantes de nomes de campo de modalidade de frete — diferentes ERPs
    // brasileiros usam nomes diferentes. Como o GC ignorou todos os anteriores
    // (NF 253 saiu com modFrete=0), bombardeamos com todas as variantes que
    // existem em emissoras NF-e brasileiras: modFrete (SEFAZ literal),
    // modalidade_frete, frete_por_conta, tipo_frete.
    const transporteBlock: Record<string, unknown> = {
      modalidade_frete: 3,
      modFrete: 3,
      frete_por_conta: 3,
      tipo_frete: 3,
      frete: 3,
      volumes: volumesObj,
    };
    if (gcTransportadoraId) {
      const tid = Number(gcTransportadoraId);
      transporteBlock.transportadora = { id: tid };
      transporteBlock.transportadora_id = tid;
      transporteBlock.transportador_id = tid;
    }
    if (Object.keys(transportadorBlock).length > 0) {
      // Mantém o bloco com dados crus em paralelo — alguns endpoints aceitam.
      transporteBlock.transportador = transportadorBlock;
    }

    // ---------- Numeração da NF: atribuída pelo ClickNotas ----------
    // Não enviamos `numero` (ver bloco no topo do arquivo). O número real é
    // lido de volta no detalhe (readDetail → numero_nf) e gravado em
    // nfe_emitidas.numero.
    const serieAtual = String(fiscal.serie_nfe || "1");
    const numeroWarning: string | undefined =
      `O número da NF (série ${serieAtual}) é atribuído pelo ClickNotas na emissão e confirmado depois pelo detalhe da nota.`;

    const nfePayload = {
      // tipo_nf como INT (doc especifica int; antes mandávamos string "1").
      tipo_nf: 1,
      // envio_automatico=1 (ClickNotas): o próprio cadastro JÁ
      // dispara a transmissão pra SEFAZ, pelo MÉTODO de cadastro — que este
      // token TEM permissão de chamar. Antes dependíamos do método separado
      // POST /notas_fiscais_produtos/emitir/{id}, que retorna 403 "este
      // usuário não possui permissão para acessar este método" (a API key não
      // tem o método /emitir liberado). Com envio automático a NF transmite
      // sem precisar daquele método. Ver doc oficial clicknotas.apib.
      envio_automatico: 1,
      // loja_id (obrigatório na doc). Quando null, GC usa matriz por default.
      ...(gcLojaId ? { loja_id: Number(gcLojaId) } : {}),
      natureza_operacao: naturezaEsperada,
      id_destinatario: gcClientId,
      codigo_cfop: resolvedCfop,
      modelo: "55",
      serie: fiscal.serie_nfe || "1",
      // `numero` NÃO é enviado: não é campo documentado do POST e a busca do
      // último número estava quebrada (ver bloco no topo do arquivo).
      finalidade_nf: "1",
      // tipo_emissao=1 ("Normal") — pedido em 16/05/2026. Antes não era
      // enviado; ClickNotas assumia default mas explícito blinda contra
      // mudança de default deles.
      tipo_emissao: "1",
      // tipo_atendimento=9 ("Operação não presencial, outros") — pedido em
      // 16/05/2026 pela Squad Shoes. Nome correto do campo no ClickNotas
      // é `tipo_atendimento` (confirmado em emit-nfe-devolucao que funciona).
      // V1 desta mudança usou `indicador_presenca` (nome do XML SEFAZ) e o
      // GC ignorou silenciosamente — XML saía com indPres=0 (não aplicável).
      tipo_atendimento: "9",
      indicador_final: isContribuinte ? 0 : 1,
      informacoes_complementares: informacoesComplementares,
      // Espelha modalidade_frete + transportadora_id no top-level como
      // redundância — em algumas rotas do GC só o top-level pega (Vendas/Pedidos).
      // Agora ambos com tipo INT (era "3" string e o GC ignorava).
      modalidade_frete: 3,
      frete_por_conta: 3,
      ...(gcTransportadoraId ? { transportadora_id: Number(gcTransportadoraId) } : {}),
      // Peso/volumes top-level (Webmania-style fallback).
      ...(pesoBrutoStr ? { peso_bruto: pesoBrutoStr } : {}),
      ...(pesoLiquidoStr ? { peso_liquido: pesoLiquidoStr } : {}),
      especie_volumes: "Volumes",
      // Quantidade de volumes: montada por buildVolumeCountFields, controlada pelo
      // PONTO ÚNICO DE AJUSTE `NFE_VOLUME_FIELD` (topo do arquivo). Hoje em SHOTGUN
      // (ClickNotas ignora os campos atuais); quando o suporte confirmar o nome,
      // seta NFE_VOLUME_FIELD lá e sai só ele — nada aqui muda.
      ...buildVolumeCountFields(
        qtdVolumesStr ? Math.max(1, Math.trunc(Number(qtdVolumesStr)) || 1) : undefined,
        pesoBrutoStr,
        pesoLiquidoStr,
      ),
      // valor_frete REMOVIDO do payload (2026-06-18): o frete NÃO compõe a NF —
      // é lançado só no financeiro (despesa "Frete a pagar"). A NF sai com vFrete=0
      // e valor_total = só mercadoria. (Antes somava ao vNF — pedido Leonardo.)
      produtos: produtosGC,
      ...(pagamentoArr.length ? { pagamento: pagamentoArr } : {}),
      transporte: transporteBlock,
    };

    // Log estruturado pro próximo debug se algum campo ainda não pegar.
    // Permite ver no Supabase Functions Logs exatamente o que foi enviado.
    console.log(`[emit-nfe] payload transporte: modFrete=${nfePayload.modalidade_frete} transp_id=${gcTransportadoraId || '∅'} qtdVol=${qtdVolumesStr || '∅'} pesoB=${pesoBrutoStr || '∅'} pesoL=${pesoLiquidoStr || '∅'}`);

    // ---------- DRY_RUN: retorna preview sem emitir ----------
    // Roda TODAS as validações + computa tudo (peso, volumes, pagamento,
    // payload) mas pula POSTs destrutivos. Operador conferimos no EmitDialog
    // antes de chamar a emissão real. Veja `isDryRun` no topo do handler.
    if (isDryRun) {
      const previewWarnings: string[] = [];
      if (numeroWarning) previewWarnings.push(numeroWarning);
      if (weightWarning) previewWarnings.push(weightWarning);
      if (packagingModeWarning) previewWarnings.push(packagingModeWarning);
      if (volumesWarning) previewWarnings.push(volumesWarning);
      if (ncmChapterWarnings.length > 0) {
        previewWarnings.push(
          `NCM fora do capítulo 64 (calçados) em item de produção: ${ncmChapterWarnings.join("; ")}. Confira se a classificação está certa pra indústria.`,
        );
      }
      if (!gcClientId) {
        previewWarnings.push(
          `Cliente ainda não está cadastrado no ClickNotas — será criado automaticamente na emissão.`,
        );
      }
      const pendingProducts = produtosPreview.filter((p) => p.gc_status === 'pending_create');
      if (pendingProducts.length > 0) {
        previewWarnings.push(
          `${pendingProducts.length} produto(s) serão cadastrados no ClickNotas na emissão: ${pendingProducts.map((p) => p.descricao).join('; ')}`,
        );
      }
      return new Response(JSON.stringify({
        dry_run: true,
        payload: nfePayload,
        preview: {
          ref_nfe: ref,
          revision,
          emitente: {
            razao_social: fiscal.razao_social || null,
            nome_fantasia: fiscal.nome_fantasia || null,
            cnpj: fiscal.cnpj,
            inscricao_estadual: fiscal.inscricao_estadual,
            uf: fiscal.uf,
            cidade: fiscal.cidade || null,
            serie_nfe: fiscal.serie_nfe || "1",
            ambiente: fiscal.ambiente || null,
          },
          destinatario: (() => {
            const { logradouro, complemento } = splitAddress(client.endereco, (client as any).complemento);
            return {
              tipo_pessoa: cnpjDestRaw.length === 14 ? 'PJ' : 'PF',
              nome: order.client_name || client?.razao_social || client?.nome,
              documento: cnpjDestRaw,
              ie_status: isContribuinte ? 'contribuinte' : 'isento',
              ie_valor: isContribuinte ? ieDestDigits : 'ISENTO',
              endereco: logradouro,
              numero: (client as any).numero || 'S/N',
              complemento: complemento || null,
              bairro: client.bairro,
              cidade: client.cidade,
              uf: client.estado,
              cep: (client.cep || '').replace(/\D/g, ''),
              telefone: client.telefone || null,
              email: client.email || null,
              gc_id: gcClientId,
              gc_cidade_id: nfePayload.id_destinatario ? null : null,
            };
          })(),
          operacao: {
            natureza_operacao: naturezaEsperada,
            cfop: resolvedCfop,
            cfop_kind: headerCfop.kind,
            cfop_interstate: isInterstate,
            modelo: '55',
            finalidade: '1 (NF-e normal)',
            tipo_emissao: '1 (Emissão normal)',
            indicador_presenca: '9 (Operação não presencial, outros)',
            indicador_final: isContribuinte ? '0 (Contribuinte)' : '1 (Consumidor final)',
            tipo_nf: '1 (Saída)',
            marca_xmarca: orderBrand,
            loja_gc_id: gcLojaId,
          },
          produtos: produtosPreview,
          totais: {
            soma_itens: Number(sumItems.toFixed(2)),
            total_pedido: nfTotal, // = mercadoria (frete fora da NF)
            valor_frete: Number(valorFrete.toFixed(2)), // só informativo no preview
            qtd_itens: produtosPreview.length,
            qtd_pares: produtosPreview.reduce((s, p) => s + p.quantidade, 0),
          },
          transporte: {
            // ⚠ NADA deste bloco chega na NF-e: a API do ClickNotas não tem
            // campo de transporte/volume/peso/frete (0 ocorrências na spec, 0
            // chaves em todas as respostas reais). O que sai no DANFE é o que o
            // ClickNotas decide sozinho. Mantido no preview porque é o número
            // que a EXPEDIÇÃO usa pra montar a carga — mas a flag abaixo evita
            // que o operador confira aqui achando que confere a nota.
            enviado_a_sefaz: false,
            observacao: 'Calculado para a expedição. Estes campos NÃO são aceitos pela API do ClickNotas — o DANFE traz o volume que o provedor calcula.',
            modalidade_frete: '3 (Transporte próprio por conta do remetente)',
            transportadora_id_gc: gcTransportadoraId,
            transportador: Object.keys(transportadorBlock).length > 0
              ? transportadorBlock
              : null,
            qtd_volumes: qtdVolumesStr ? Math.max(1, Math.trunc(Number(qtdVolumesStr)) || 1) : null,
            // true = o nº de volumes veio do default de 12 pares/caixa, não de
            // cadastro (nenhum box_type do tipo do modo existe).
            volumes_estimado_cego: !!volumesWarning,
            especie: 'VOLUME',
            marca: '',
            peso_bruto_kg: pesoBrutoStr || null,
            peso_liquido_kg: pesoLiquidoStr || null,
            peso_estimado_cego: weightFallbackBlind,
          },
          pagamento: pagamentoArr.map((p: any) => ({
            numero: p.numero_duplicata,
            forma: 'Boleto Bancário',
            vencimento: p.data_vencimento,
            valor: Number(p.valor_pagamento),
          })),
          informacoes_complementares: informacoesComplementares || null,
          warnings: previewWarnings,
        },
      }), { status: 200, headers: corsHeaders });
    }

    // Auditoria A4: wrappa POST em try/catch específico pra distinguir
    // timeout/network (NF pode ter sido criada no GC e sistema local não saber)
    // de rejeição estruturada (sem ambiguidade). Em caso de timeout, registra
    // status='reconciliation_needed' pra bloquear retry cego.

    // Log estruturado do BODY enviado pra investigar campos que o GC ignora.
    // 20/05/2026: NF 253 saiu com modFrete=0 / transportador vazio / espécie
    // vazia / marca vazia mesmo passando tudo. Adicionado log integral pra
    // ver no Supabase Functions Logs o que sai e o que volta.
    console.log("[emit-nfe] POST /notas_fiscais_produtos body:", JSON.stringify(nfePayload).slice(0, 2000));

    // ── CLAIM ATÔMICO anti-dupla-emissão (auditoria 2026-06-14, Top10 #1) ──
    // O pre-check lá em cima é só UX (SELECT — não trava corrida): dois requests
    // concorrentes passavam ambos e cada um POSTava à SEFAZ → DOIS documentos
    // fiscais reais (numeração queimada, cancelamento manual). O índice único
    // parcial uq_nfe_active_per_sale_order (status processando/autorizada/
    // cancelando) só batia no INSERT final — DEPOIS dos POSTs à SEFAZ.
    // Aqui inserimos a linha 'processando' ANTES de qualquer POST: o índice
    // rejeita o 2º request com 23505 e ele aborta sem chamar a SEFAZ. Os inserts
    // de resultado mais abaixo viram UPDATE desta mesma linha (claimId).
    let claimId: string;
    {
      const claimRecord: any = {
        sale_order_id,
        ref_nfe: ref,
        status: "processando",
        valor_total: nfTotal,
        cnpj_emitente: fiscal.cnpj.replace(/\D/g, ""),
        nome_destinatario: order.client_name || client?.razao_social || client?.nome || null,
        cnpj_destinatario: cnpjDestRaw || null,
      };
      if (resolvedCompanyId) claimRecord.company_id = resolvedCompanyId;
      const { data: claimRow, error: claimErr } = await adminClient
        .from("nfe_emitidas").insert(claimRecord).select("id").single();
      if (claimErr) {
        if ((claimErr as any)?.code === "23505") {
          return new Response(JSON.stringify({
            error: "Já existe uma emissão de NF-e em andamento para este pedido. Aguarde concluir ou cancele antes de re-emitir.",
            conflict: true,
          }), { status: 409, headers: corsHeaders });
        }
        return new Response(JSON.stringify({
          error: `Falha ao reservar a emissão da NF-e: ${claimErr.message}. Tente novamente.`,
        }), { status: 500, headers: corsHeaders });
      }
      if (!claimRow?.id) {
        return new Response(JSON.stringify({
          error: "Falha ao reservar a emissão da NF-e (sem id retornado). Tente novamente.",
        }), { status: 500, headers: corsHeaders });
      }
      claimId = claimRow.id as string;
    }

    let createResp;
    try {
      createResp = await gcFetch("/notas_fiscais_produtos", {
        method: "POST",
        body: JSON.stringify(nfePayload),
      });
      console.log("[emit-nfe] response status:", createResp.status, "body:", JSON.stringify(createResp.json).slice(0, 1500));
    } catch (createErr: unknown) {
      const isTimeout = createErr instanceof DOMException && createErr.name === "AbortError";
      const errMsg = createErr instanceof Error ? createErr.message : String(createErr);
      const nfeRecord: any = {
        sale_order_id,
        ref_nfe: ref,
        status: "rejeitada",
        valor_total: nfTotal,
        motivo_rejeicao: isTimeout
          ? `Timeout no ClickNotas (>30s). NF pode ter sido criada lá — confira no painel pelo número de PV antes de re-emitir (evita NF duplicada). Detalhe: ${errMsg}`
          : `Erro de rede: ${errMsg}`,
        cnpj_emitente: fiscal.cnpj.replace(/\D/g, ""),
        nome_destinatario: order.client_name || client?.razao_social || client?.nome || null,
        cnpj_destinatario: cnpjDestRaw || null,
      };
      if (resolvedCompanyId) nfeRecord.company_id = resolvedCompanyId;
      // UPDATE do claim (não insert) — a linha 'processando' já existe.
      await adminClient.from("nfe_emitidas").update(nfeRecord).eq("id", claimId);
      return new Response(JSON.stringify({
        error: isTimeout
          ? "Timeout ao falar com ClickNotas. ATENÇÃO: A NF pode ter sido criada no painel deles. Confira antes de re-emitir pra evitar duplicata fiscal. Em caso de duplicata, cancele a antiga no painel ou use Sincronizar com ClickNotas."
          : `Falha de rede ao emitir: ${errMsg}`,
        reconciliation_needed: isTimeout,
      }), { status: 502, headers: corsHeaders });
    }
    if (!createResp.ok || createResp.json?.status === "error" || createResp.json?.data?.ok === false) {
      const msg = createResp.json?.data?.mensagem || createResp.json?.message || createResp.json?.mensagem || JSON.stringify(createResp.json);
      const nfeRecord: any = {
        sale_order_id,
        ref_nfe: ref,
        status: "rejeitada",
        valor_total: nfTotal,
        motivo_rejeicao: `Cadastro: ${msg}`,
        cnpj_emitente: fiscal.cnpj.replace(/\D/g, ""),
        nome_destinatario: order.client_name || client?.razao_social || client?.nome || null,
        cnpj_destinatario: cnpjDestRaw || null,
        gc_request_payload: nfePayload as any,
        gc_response_payload: createResp.json as any,
      };
      if (resolvedCompanyId) nfeRecord.company_id = resolvedCompanyId;
      // UPDATE do claim (não insert) — a linha 'processando' já existe.
      await adminClient.from("nfe_emitidas").update(nfeRecord).eq("id", claimId);
      return new Response(JSON.stringify({ error: `Falha ao cadastrar NF-e no ClickNotas: ${msg}` }), { status: 422, headers: corsHeaders });
    }
    const gcNfeId = String(createResp.json?.data?.dados || createResp.json?.data?.id);

    // ---------- Transmissão pra SEFAZ ----------
    // A emissão foi disparada pelo próprio cadastro (envio_automatico=1). A
    // FONTE DA VERDADE do status é o DETALHE (situacao_nf/chave), consultado em
    // poll — NÃO o método /emitir (que dá 403 de permissão neste token). O
    // /emitir vira só fallback best-effort caso o envio automático não tenha
    // transmitido (NF segue "em aberto").
    let chave = "";
    let protocolo = "";
    let situacao = "";
    let numeroNf = "";
    let serieNf = "";
    let dataEmissao = "";
    let motivoRejeicaoSefaz = "";
    let tipoAmbienteReal = "";
    let detailResponseJson: unknown = null;

    const readDetail = async () => {
      const detail = await gcFetch(`/notas_fiscais_produtos/${gcNfeId}`).catch(() => ({ json: null as any }));
      detailResponseJson = detail.json ?? detailResponseJson;
      const d = detail.json?.data || {};
      chave = d.chave || chave;
      protocolo = d.protocolo || protocolo;
      situacao = d.situacao_nf || situacao;
      // motivo_rejeicao_sefaz vem preenchido quando a SEFAZ rejeitou — sinal
      // forte de rejeição, mesmo que situacao_nf venha estranha.
      motivoRejeicaoSefaz = d.motivo_rejeicao_sefaz || d.motivo_rejeicao || motivoRejeicaoSefaz;
      // numero_nf / serie só vêm no detalhe — sem isso o registro local ficava
      // com numero/serie vazios (quebrava a aba "NF-es Emitidas" e a devolução).
      numeroNf = d.numero_nf ? String(d.numero_nf) : numeroNf;
      serieNf = d.serie ? String(d.serie) : serieNf;
      // tipo_ambiente real que o ClickNotas aplicou (1=Produção, 2=Homologação).
      // É a fonte da verdade do ambiente — vem da config da conta/loja no ClickNotas,
      // NÃO do nosso payload. Usado pra avisar mismatch com fiscal.ambiente do app.
      tipoAmbienteReal = d.tipo_ambiente ? String(d.tipo_ambiente) : tipoAmbienteReal;
      // data_emissao real da SEFAZ — sem isso a coluna assumia o default now()
      // do insert e a janela de 24h pra cancelamento ficava imprecisa.
      if (d.data_emissao) {
        const t = d.hora_emissao ? `${d.data_emissao}T${d.hora_emissao}` : String(d.data_emissao);
        const norm = /Z$|[+-]\d{2}:\d{2}$/.test(t) ? t : t + "-03:00";
        const ts = new Date(norm).getTime();
        if (!Number.isNaN(ts) && ts > 0 && ts < Date.now() + 86_400_000) dataEmissao = norm;
      }
    };
    // NF chegou a um desfecho (autorizada / rejeitada / cancelada)?
    const isTerminal = () => {
      const s = situacao.toLowerCase();
      // "reprovada" e "corrigida" são situações REAIS da conta que faltavam
      // aqui — sem elas a NF rejeitada seguia dando volta no poll até o fim.
      return !!chave || motivoRejeicaoSefaz.trim() !== "" ||
        s.includes("autoriz") || s.includes("aprovada") || s.includes("rejeit") ||
        s.includes("reprovada") || s.includes("corrigida") ||
        s.includes("denegada") || s.includes("cancel");
    };
    // NF ainda só cadastrada, sem transmitir.
    const isOpen = () => {
      const s = situacao.toLowerCase();
      return s === "" || s.includes("aberto") || s.includes("aberta") ||
        s.includes("digita");
    };

    // Poll pós-cadastro (a autorização SEFAZ leva alguns segundos).
    for (let i = 0; i < 4; i++) {
      await readDetail();
      if (isTerminal()) break;
      if (i < 3) await new Promise((r) => setTimeout(r, 2000));
    }

    // Fallback: se ainda "em aberto" (envio automático não transmitiu), tenta o
    // método /emitir. Pode dar 403 (sem permissão) — best-effort, não fatal.
    let emitResp: { ok: boolean; json: any } = { ok: true, json: null };
    let emitMsg = "";
    if (!isTerminal() && isOpen()) {
      emitResp = await gcFetch(`/notas_fiscais_produtos/emitir/${gcNfeId}`, { method: "POST" })
        .catch(() => ({ ok: false, json: null as any }));
      emitMsg = emitResp.json?.data?.mensagem || emitResp.json?.message || emitResp.json?.mensagem || "";
      for (let i = 0; i < 3; i++) {
        await readDetail();
        if (isTerminal()) break;
        if (i < 2) await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Status final via mapSituacao() canônico. Rejeição só com sinal REAL
    // (motivo SEFAZ, situacao rejeitada/denegada, ou emitMsg "rejei"). O 403 de
    // PERMISSÃO do /emitir NÃO marca mais rejeitada — a NF pode ter sido
    // transmitida pelo envio automático.
    const msg = (emitMsg || "").toLowerCase();
    const sLow = situacao.toLowerCase();
    // "reprovada" é como a SEFAZ/ClickNotas devolve a rejeição nesta conta —
    // e NÃO casa com "rejeit" nem com "aprovada". Sem ela, uma NF rejeitada
    // caía em mapSituacao() e virava "processando": o operador ficava
    // esperando uma autorização que nunca vinha. Testada ANTES de authorized.
    const sefazRejected = motivoRejeicaoSefaz.trim() !== "" ||
      sLow.includes("rejeit") || sLow.includes("reprovada") ||
      sLow.includes("denegada") || msg.includes("rejei") || msg.includes("reprovad");
    const authorized = !!chave || sLow.includes("autoriz") || sLow.includes("aprovada")
      || sLow.includes("corrigida");
    const finalStatus = sefazRejected ? "rejeitada" : (authorized ? "autorizada" : mapSituacao(situacao));
    // Cadastrada mas NÃO transmitida após todas as tentativas (envio automático
    // ignorado E /emitir sem permissão) → avisa o operador; não é autorizada.
    const notTransmitted = finalStatus === "processando" && !chave && !protocolo && isOpen();
    const transmitWarning = notTransmitted
      ? `NF nº ${numeroNf || gcNfeId} cadastrada no ClickNotas mas NÃO transmitida automaticamente${emitMsg ? ` (emitir: ${emitMsg})` : ""}. Emita manualmente no painel ClickNotas ou verifique a permissão de emissão da API key.`
      : null;
    const emitOk = finalStatus === "autorizada" || finalStatus === "processando";

    // ---------- Ambiente real (homologação x produção) ----------
    // O ambiente é definido na conta/loja do ClickNotas (portal deles), NÃO no
    // nosso payload — o ClickNotas ignora campo de ambiente que a gente mande.
    // Aqui só DETECTAMOS o que ele REALMENTE aplicou (tipo_ambiente do detalhe:
    // 1=Produção, 2=Homologação) e avisamos se diverge do fiscal.ambiente do app.
    // Protege os dois desastres: (a) querer testar em homologação mas sair nota
    // REAL; (b) esquecer de voltar pra produção e emitir venda real como
    // homologação (sem valor fiscal).
    const ambienteEsperadoHomolog = /homolog/i.test(String(fiscal?.ambiente || ""));
    const ambienteRealStr = tipoAmbienteReal === "2" ? "homologacao"
      : tipoAmbienteReal === "1" ? "producao" : "";
    let ambienteWarning: string | null = null;
    if (ambienteRealStr && ambienteEsperadoHomolog !== (tipoAmbienteReal === "2")) {
      ambienteWarning = ambienteEsperadoHomolog
        ? `⚠ Você queria HOMOLOGAÇÃO (teste), mas o ClickNotas emitiu em PRODUÇÃO — esta é uma NF-e REAL (nº ${numeroNf || gcNfeId}). Troque o ambiente para Homologação no painel ClickNotas e cancele esta nota.`
        : `⚠ Esta NF saiu em HOMOLOGAÇÃO — SEM VALOR FISCAL! Volte o ambiente para Produção no painel ClickNotas e reemita para gerar a nota válida.`;
      console.warn(`[emit-nfe] AMBIENTE MISMATCH PV ${sale_order_id}: app=${ambienteEsperadoHomolog ? "homologacao" : "producao"} real=${ambienteRealStr}`);
    }

    const nfeRecord: any = {
      sale_order_id,
      ref_nfe: ref,
      status: finalStatus,
      valor_total: nfTotal,
      // Sempre grava o motivo quando rejeitada. Precedência: motivo da SEFAZ
      // (mais específico) > emitMsg (genérico do emit) > situacao > fallback.
      motivo_rejeicao: finalStatus === "rejeitada"
        ? (motivoRejeicaoSefaz.trim() || emitMsg || situacao || "Rejeitada pela SEFAZ")
        : "",
      cnpj_emitente: fiscal.cnpj.replace(/\D/g, ""),
      chave_acesso: chave || null,
      protocolo: protocolo || null,
      provider_nfe_id: gcNfeId,
      nome_destinatario: order.client_name || client?.razao_social || client?.nome || null,
      cnpj_destinatario: cnpjDestRaw || null,
      ...(numeroNf ? { numero: numeroNf } : {}),
      ...(serieNf ? { serie: serieNf } : {}),
      ...(dataEmissao ? { data_emissao: dataEmissao } : {}),
      // Auditoria fiscal forense (20/05/2026): grava o body completo do
      // request/response do GC pra diagnosticar campos ignorados pela API.
      // Permite consultar via SQL exatamente o que foi enviado/recebido,
      // sem depender de Supabase Function Logs (que apaga em ~24h).
      gc_request_payload: nfePayload as any,
      gc_response_payload: createResp.json as any,
      gc_emit_response: emitResp.json as any,
      gc_detail_response: detailResponseJson as any,
    };
    if (resolvedCompanyId) nfeRecord.company_id = resolvedCompanyId;

    // UPDATE do claim 'processando' (não insert) — preenche o resultado final.
    const { data: nfe, error: nfeErr } = await adminClient
      .from("nfe_emitidas").update(nfeRecord).eq("id", claimId).select().single();

    if (nfeErr) {
      const code = (nfeErr as any)?.code;
      if (code === "23505") {
        return new Response(JSON.stringify({
          error: `Outra NF-e foi criada simultaneamente para este pedido. Verifique o painel ClickNotas (NF id ${gcNfeId}) e cancele a duplicata se necessário.`,
          provider_nfe_id: gcNfeId,
          conflict: true,
        }), { status: 409, headers: corsHeaders });
      }
      return new Response(JSON.stringify({
        error: `Erro ao salvar NF-e no banco: ${nfeErr.message}`,
        provider_nfe_id: gcNfeId,
        reconciliation_needed: true,
      }), { status: 500, headers: corsHeaders });
    }

    // Faturamento MANUAL (pedido do usuário, 2026-06-13): a NF costuma ser emitida
    // DIAS ANTES da entrega, então emitir a NF NÃO deve avançar o PV pra 'Faturado'
    // automaticamente. Aqui só registramos o NÚMERO da NF no PV (rastreabilidade);
    // o status 'Faturado' — e, com ele, o reconhecimento de receita via
    // syncFinancialRecords (que exige Faturado + NF autorizada) — fica para o
    // usuário acionar manualmente quando faturar de fato (dropdown de status do PV
    // em Pedidos de Venda: 'Em Produção' → 'Faturado').
    // (Antes, o auto-avanço também escondia OPs ainda em produção do picking.)
    let arSyncWarning: string | null = null;
    if (finalStatus === "autorizada" && order.status !== "Faturado" && order.status !== "Cancelado") {
      const numeroNfe = nfe?.numero || (await gcFetch(`/notas_fiscais_produtos/${gcNfeId}`)).json?.data?.numero_nf || null;
      if (numeroNfe) {
        const { error: soUpdErr } = await adminClient
          .from("sale_orders")
          .update({ nfe: String(numeroNfe) }) // só o nº da NF; status NÃO muda
          .eq("id", sale_order_id)
          .neq("status", "Cancelado");
        if (soUpdErr) {
          arSyncWarning = `NF autorizada mas falhou ao registrar o número no PV: ${soUpdErr.message}.`;
          console.warn("emit-nfe SO nfe-number update failed:", soUpdErr);
        }
      }
    }

    return new Response(JSON.stringify({
      success: emitOk,
      nfe,
      ambiente: ambienteRealStr || null,
      provider_response: { create: createResp.json, emit: emitResp.json },
      ...(arSyncWarning ? { ar_sync_warning: arSyncWarning } : {}),
      ...(transmitWarning ? { transmit_warning: transmitWarning } : {}),
      ...(ambienteWarning ? { ambiente_warning: ambienteWarning } : {}),
    }), {
      status: emitOk ? 200 : 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("emit-nfe error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
