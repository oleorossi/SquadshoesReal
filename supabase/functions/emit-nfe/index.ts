import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const GESTAOCLICK_BASE = "https://api.gestaoclick.com";

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

async function gcFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GESTAOCLICK_BASE}${path}`, {
    ...init,
    headers: { ...gcHeaders(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { mensagem: text }; }
  return { ok: res.ok, status: res.status, json };
}

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

// Cache do id da loja no GestaoClick. A doc da API marca `loja_id` como
// obrigatório no POST /notas_fiscais_produtos. Quando ausente, o GC usa
// "matriz ou loja que o usuário tem permissão" — funciona, mas explícito
// é mais seguro (e cumpre o contrato da doc). Cache em memória do isolate
// — válido enquanto o edge function fica quente. Reseta a cada cold start.
let _gcLojaIdCache: string | null = null;
async function resolveGcLojaId(preferredLojaId?: string | null): Promise<string | null> {
  // Empresa (ex.: 2º CNPJ) com loja mapeada em companies.gestaoclick_loja_id →
  // usa direto, garantindo que a NF saia sob o CNPJ certo em vez da matriz.
  // NULL/vazio = comportamento atual (resolve matriz/primeira ativa).
  if (preferredLojaId != null && String(preferredLojaId).trim() !== "") {
    return String(preferredLojaId).trim();
  }
  if (_gcLojaIdCache) return _gcLojaIdCache;
  try {
    const r = await gcFetch("/lojas");
    const list = Array.isArray(r.json?.data) ? r.json.data : [];
    if (list.length === 0) return null;
    // Prefere matriz (situacao=1 ativa + matriz=1 quando disponível),
    // senão pega a primeira ativa, senão a primeira.
    const matriz = list.find((l: any) => l.matriz === 1 || l.matriz === "1" || l.matriz === true);
    const ativa = list.find((l: any) => l.situacao === 1 || l.situacao === "1" || l.situacao === true);
    const pick = matriz || ativa || list[0];
    _gcLojaIdCache = pick?.id ? String(pick.id) : null;
    return _gcLojaIdCache;
  } catch (e) {
    console.warn("[emit-nfe] resolveGcLojaId falhou:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// Cache do id da transportadora "própria" (Squad Shoes) no GestaoClick.
// modFrete=3 (transporte próprio do remetente) exige que a NF aponte pra uma
// transportadora cadastrada — mas o painel GC não puxa automaticamente do
// emitente. A doc da API de /notas_fiscais_produtos não documenta bloco
// `transporte.transportador.*` (silenciosamente ignorado) — só aceita
// `transportadora_id` (FK pra /transportadoras). Solução: criar a transportadora
// "Squad Shoes" uma vez (idempotente por CNPJ) e referenciar pelo ID.
// 19/05/2026: bug visto em PV-00107+, transportador saía em branco no DANFE.
let _gcTransportadoraIdCache: string | null = null;
async function resolveGcTransportadoraEmitenteId(fiscal: any): Promise<string | null> {
  if (_gcTransportadoraIdCache) return _gcTransportadoraIdCache;
  const cnpjDigits = (fiscal?.cnpj || "").replace(/\D/g, "");
  if (cnpjDigits.length !== 14) {
    console.warn("[emit-nfe] resolveGcTransportadoraEmitenteId: CNPJ do emitente inválido — pulando");
    return null;
  }
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
      _gcTransportadoraIdCache = String(match.id);
      console.log(`[emit-nfe] Transportadora emitente já existe no GC: id=${_gcTransportadoraIdCache}`);
      return _gcTransportadoraIdCache;
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
      _gcTransportadoraIdCache = String(newId);
      console.log(`[emit-nfe] Transportadora emitente criada no GC: id=${_gcTransportadoraIdCache}`);
      return _gcTransportadoraIdCache;
    }
    console.warn("[emit-nfe] Falha ao criar transportadora emitente:", createResp.status, JSON.stringify(createResp.json).slice(0, 300));
    return null;
  } catch (e) {
    console.warn("[emit-nfe] resolveGcTransportadoraEmitenteId exceção:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// Mapeia situacao_nf do GestaoClick → status canônico interno. Mesma lógica
// de nfe-status / sync-nfe-from-provider (evita drift entre os caminhos).
// Cobre múltiplas situações que a SEFAZ pode retornar.
function mapSituacao(situacao: string): string {
  const s = (situacao || "").toLowerCase();
  if (s.includes("aprovada") || s.includes("autorizada")) return "autorizada";
  if (s.includes("cancelada")) return "cancelada";
  if (s.includes("rejeitada") || s.includes("denegada") || s.includes("erro")) return "rejeitada";
  if (s.includes("processando") || s.includes("aberta") || s.includes("aguardando")) return "processando";
  return "processando";
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

    const { sale_order_id, company_id, dry_run = false } = await req.json();
    if (!sale_order_id) {
      return new Response(JSON.stringify({ error: "sale_order_id é obrigatório" }), { status: 400, headers: corsHeaders });
    }
    // dry_run=true: roda TODAS as validações + computa peso/volumes/pagamento +
    // monta payload, mas NÃO faz POST/PUT no GestaoClick e NÃO insere em
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
               `Verifique o histórico de NF-es, cancele as antigas no painel GestaoClick e corrija o erro antes de re-emitir.`,
        nfe_count: totalNfes,
      }), { status: 429, headers: corsHeaders });
    }

    const { data: items, error: itemsErr } = await adminClient
      .from("sale_order_items")
      .select("*, technical_sheets(id, name, code, ncm, gestaoclick_id, description, shoe_category, upper_material, lining_material, insole_material, sole_material, weight_per_pair_kg), reference_material_variants(sku, barcode, ncm, description_override, active, unit_price_override), products(id, name, sku, ncm, gestaoclick_id, unit)")
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
    // GestaoClick/SEFAZ, pra forçar o cadastro correto do cliente.
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

    const itemsInactiveVariant: string[] = [];
    const resolvedItems = (items || []).map((it: any) => {
      const v = it.reference_material_variants;
      if (it.material_variant_id && (!v || !v.active)) {
        const ref = it.technical_sheets?.code || it.reference_id;
        itemsInactiveVariant.push(`${ref} (variation_id=${it.material_variant_id})`);
      }
      return { ...it, _variant: v && v.active ? v : null };
    });
    if (itemsInactiveVariant.length > 0) {
      return new Response(JSON.stringify({
        error: `Variação de material inativa ou removida nas referências: ${itemsInactiveVariant.join("; ")}. Reative a variação no cadastro da ficha técnica ou edite o pedido para selecionar outra variação antes de emitir.`,
      }), { status: 400, headers: corsHeaders });
    }

    const billableItems = resolvedItems.filter((it: any) => Number(it.quantity) > 0);

    const itemsMissingNcm: string[] = [];
    for (const it of billableItems) {
      // NF avulsa (product_id): usa NCM do produto direto.
      // NF normal (reference_id): usa NCM da variant/ficha.
      const ncm = (it._variant?.ncm || it.technical_sheets?.ncm || it.products?.ncm || "").trim();
      if (!ncm || ncm.length !== 8 || !/^\d{8}$/.test(ncm)) {
        const ref = it.technical_sheets?.code || it.products?.sku || it.reference_id || it.product_id;
        itemsMissingNcm.push(`${ref} (NCM atual: "${ncm || "vazio"}")`);
      }
    }
    if (itemsMissingNcm.length > 0) {
      return new Response(JSON.stringify({ error: `NCM ausente ou inválido (precisa 8 dígitos) nas referências: ${itemsMissingNcm.join("; ")}. Atualize a ficha técnica, variação de material ou produto antes de emitir.` }), { status: 400, headers: corsHeaders });
    }

    const effectivePrice = (it: any) => Number(it._variant?.unit_price_override ?? it.unit_price ?? 0);
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
    // Frete (auditoria fiscal 01/06/2026): order.total e sumItems são SÓ
    // mercadoria; valor_frete é coluna à parte e o GestaoClick soma ao vNF.
    // Pra a NF fechar (soma das duplicatas + valor_total gravado = mercadoria +
    // frete = vNF), calculamos o total-com-frete e usamos nas duplicatas e no
    // valor_total. Sem frete, totalComFrete == sumItems (comportamento intacto).
    const valorFrete = Number(order.valor_frete) || 0;
    const totalComFrete = Number((sumItems + valorFrete).toFixed(2));

    // CFOP por código (GestaoClick aceita `codigo_cfop` diretamente).
    // Auditoria A14: valida formato do CFOP configurado. Se preenchido mas
    // não tem 4 dígitos começando em 5 ou 6, bloqueia emissão — sem isso
    // SEFAZ rejeita com mensagem confusa.
    const isInterstate = !!(client?.estado && fiscal.uf && client.estado.toUpperCase() !== String(fiscal.uf).toUpperCase());
    const defaultCfop = isInterstate ? "6101" : "5101";
    const cfopConfigured = fiscal.cfop ? String(fiscal.cfop).trim() : "";
    if (cfopConfigured && !/^[56]\d{3}$/.test(cfopConfigured)) {
      return new Response(JSON.stringify({
        error: `CFOP configurado inválido: "${cfopConfigured}". Deve ter 4 dígitos começando em 5 (intra-estadual) ou 6 (inter-estadual). Edite a configuração fiscal antes de emitir.`,
      }), { status: 400, headers: corsHeaders });
    }
    let resolvedCfop = cfopConfigured || defaultCfop;
    if (cfopConfigured && /^[56]\d{3}$/.test(cfopConfigured)) {
      if (isInterstate && cfopConfigured.startsWith("5")) resolvedCfop = "6" + cfopConfigured.slice(1);
      if (!isInterstate && cfopConfigured.startsWith("6")) resolvedCfop = "5" + cfopConfigured.slice(1);
    }

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

    // ---------- Sync lazy: cliente no GestaoClick ----------
    // O GestaoClick NÃO aceita cidade por nome — exige `cidade_id` (id interno
    // da tabela de cidades deles). E o endereço vai aninhado: enderecos[].endereco.
    // Histórico do bug "É necessário informar a cidade do destinatário":
    //  v17-v19: mandavam `cidade_nome` num endereço flat → GestaoClick ignorava
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

      // Resolve o id interno da cidade no GestaoClick (por código IBGE, fallback nome)
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
          error: `Não foi possível resolver a cidade "${client.cidade}" (cód. IBGE ${ibge || "—"}) no GestaoClick. ` +
                 `Verifique o cadastro do cliente: cidade e Cód. Município (IBGE) precisam estar corretos.`,
        }), { status: 400, headers: corsHeaders });
      }

      const buildPayload = () => ({
        tipo_pessoa: isPj ? "PJ" : "PF",
        nome: order.client_name || client?.razao_social || client?.nome,
        // tipo_contribuinte do GestaoClick: 1=contribuinte de ICMS,
        // 2=isento de IE. O caso "sem IE e sem ISENTO" já foi bloqueado na
        // pré-validação acima, então aqui só chega contribuinte ou isento.
        tipo_contribuinte: isContribuinte ? "1" : "2",
        ...(isPj
          ? { cnpj: cnpjDestRaw, inscricao_estadual: (client.inscricao_estadual || "").replace(/\D/g, "") }
          : { cpf: cnpjDestRaw }),
        ...(client.telefone ? { telefone: client.telefone } : {}),
        ...(client.email ? { email: client.email } : {}),
        // Formato GestaoClick: array de objetos { endereco: {...} }, cidade por id.
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

      // cidade_id preenchido no endereço retornado pelo GestaoClick?
      const hasCidade = (gcData: any): boolean => {
        const wrap = Array.isArray(gcData?.enderecos) ? gcData.enderecos[0] : null;
        const e = wrap?.endereco || wrap;
        return !!(e && String(e.cidade_id || "").trim());
      };

      const createFresh = async (): Promise<string> => {
        const r = await gcFetch("/clientes", { method: "POST", body: JSON.stringify(buildPayload()) });
        if (!r.ok || r.json?.status === "error") {
          throw new Error(`Falha ao criar cliente no GestaoClick: ${r.json?.message || r.json?.mensagem || JSON.stringify(r.json)}`);
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
            // recriar — falha transitória do GestaoClick não deve duplicar
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
            error: e instanceof Error ? e.message : `Falha ao sincronizar cliente com GestaoClick: ${String(e)}`,
          }), { status: 502, headers: corsHeaders });
        }
      }
    }

    // ---------- Sync lazy: produtos no GestaoClick + payload itens ----------
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
      ncm: string;
      cfop: string;
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
      const variant = it._variant;
      const isStandalone = !ts && !!prod;
      const ncm = (variant?.ncm || ts?.ncm || prod?.ncm || "").trim();
      const price = effectivePrice(it);
      const baseName = ts?.name || prod?.name || "Produto";
      const desc = (variant?.description_override || (it.color ? `${baseName} - ${it.color}` : baseName)).trim();
      // Unidade comercial na NF. Pedido do dono em 01/06/2026, validando contra
      // a NF #248 revisada pela contabilidade (o DANFE de referência sai com
      // "UN", não "PAR"): forçar "UN". Vale também p/ NF avulsa de standalone
      // (antes puxava products.unit que podia vir "kg"/etc).
      const unidade = "UN";

      // Marca deste item: silk do solado (cascata) ou 'Squad Shoes'.
      const itemBrand = await resolveItemBrand(it.reference_id, it.color);

      // Resolução do produto no GestaoClick — POR NOME.
      // BUG CRÍTICO da cor (e do duplicado) corrigido aqui:
      //  - O `codigo` que mandamos no POST /produtos é IGNORADO pelo
      //    GestaoClick (ele gera um codigo_interno próprio) → busca por
      //    código nunca acha nada.
      //  - POST /produtos com nome JÁ EXISTENTE → erro 404 "URL do produto
      //    já está sendo utilizada".
      //  - O `nome` ("SP117 - CARAMELO") já é único por cor e a busca
      //    /produtos?nome= funciona.
      // Logo: buscamos por nome exato; se achar, reusa; senão cria.
      // technical_sheets.gestaoclick_id NUNCA é usado (uma ficha = N cores).
      // products.gestaoclick_id (NF avulsa) continua sendo cache válido.
      const nomeProduto = desc.slice(0, 120);
      let gcProductId: string | null = isStandalone ? (prod?.gestaoclick_id || null) : null;
      let gcStatus: 'cached' | 'found_by_name' | 'pending_create' = gcProductId ? 'cached' : 'pending_create';
      if (!gcProductId) {
        const lookup = await gcFetch(`/produtos?nome=${encodeURIComponent(nomeProduto)}`);
        const foundList = Array.isArray(lookup.json?.data) ? lookup.json.data : [];
        const match = foundList.find(
          (p: any) => String(p.nome || "").trim().toUpperCase() === nomeProduto.trim().toUpperCase(),
        );
        if (match?.id) {
          gcProductId = String(match.id);
          gcStatus = 'found_by_name';
        } else if (isDryRun) {
          // Preview: não cria produto. gcProductId fica null (warning no preview).
          gcStatus = 'pending_create';
        } else {
          // Cadastro enriquecido (20/05/2026 — pedido user): leva todos os
          // dados úteis da ficha técnica + variante pro GestaoClick. Antes
          // só ia nome+preco+unidade+ncm+marca → produto novo nascia
          // "pelado" e a contabilidade tinha que editar depois.
          //
          // Campos adicionais:
          //  - descricao: combina ficha.description + materiais técnicos
          //  - codigo: SKU da variante (quando houver) — facilita auditoria
          //  - gtin/cean: código de barras (XML SEFAZ <cEAN>)
          //  - peso_bruto/peso_liquido: weight_per_pair_kg da ficha
          //  - categoria: shoe_category ('Adulto', 'Infantil', etc)
          //  - cest: campo fiscal (opcional, copia da ficha se houver)
          const techDescParts = [
            ts?.description?.trim(),
            ts?.upper_material ? `Cabedal: ${ts.upper_material}` : null,
            ts?.lining_material ? `Forro: ${ts.lining_material}` : null,
            ts?.insole_material ? `Palmilha: ${ts.insole_material}` : null,
            ts?.sole_material ? `Solado: ${ts.sole_material}` : null,
            it.color ? `Cor: ${it.color}` : null,
          ].filter(Boolean);
          const fullDesc = techDescParts.join(' | ').slice(0, 500);
          const skuVariante = (variant?.sku || '').trim();
          const gtinVariante = (variant?.barcode || '').trim();
          const pesoKg = Number(ts?.weight_per_pair_kg || 0);
          const productPayload: Record<string, unknown> = {
            nome: nomeProduto,
            valor_venda: price.toFixed(2),
            unidade: "UN",
            ncm,
            tipo: "P",
            marca: itemBrand, // marca aparece no XML SEFAZ <prod><xMarca> — silk do solado
          };
          if (fullDesc) productPayload.descricao = fullDesc;
          if (skuVariante) productPayload.codigo = skuVariante;
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
            return new Response(JSON.stringify({
              error: `Falha ao sincronizar produto "${nomeProduto}" com GestaoClick: ${r.json?.data?.mensagem || r.json?.message || r.json?.mensagem || JSON.stringify(r.json)}`,
            }), { status: 502, headers: corsHeaders });
          }
          gcProductId = String(r.json?.data?.id);
          gcStatus = 'cached'; // recém criado, agora cacheado pro próximo uso
        }
        if (isStandalone && prod?.id && gcProductId && !isDryRun) {
          await adminClient.from("products").update({ gestaoclick_id: gcProductId }).eq("id", prod.id);
        }
      }

      const qty = Number(it.quantity) || 0;
      produtosGC.push({
        produto_id: gcProductId,
        quantidade: qty.toFixed(2),
        // valor_venda é o preço UNITÁRIO — o GestaoClick multiplica por
        // quantidade internamente. Antes mandávamos (qtd × preço) e o
        // total saía qtd² × preço (ex: R$ 8.3M em vez de R$ 25k).
        valor_venda: price.toFixed(2),
        cfop: resolvedCfop,
        unidade: "UN",
        NCM: ncm,
        tipo: "P",
        marca: itemBrand, // marca por item = silk do solado (fallback Squad Shoes)
      });
      produtosPreview.push({
        descricao: nomeProduto,
        ncm,
        cfop: resolvedCfop,
        quantidade: qty,
        unidade: "UN",
        valor_unitario: price,
        valor_total: Number((qty * price).toFixed(2)),
        marca: itemBrand,
        gc_status: gcStatus,
        gc_id: gcProductId,
      });
    }

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
        if (v > 0) {
          qtdVolumesStr = String(v);
          console.log(`[emit-nfe] volumes=${v} (mode=${mode}) PV ${sale_order_id}`);
        } else {
          console.warn(`[emit-nfe] compute_sale_order_nfe_volumes retornou v=${v} (mode=${mode}). Fallback=1.`);
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
    const informacoesComplementares = [
      ocPart,
      livrePart,
      order.numero_pv ? `Pedido de Venda: ${order.numero_pv}` : null,
      weightWarning,
    ].filter(Boolean).join(" · ") || undefined;

    // ---------- Monta as duplicatas (campo `pagamento` da NF) ----------
    // A NF-e precisa da fatura/duplicata pra ficar completa (a NF de
    // referência emitida pelo painel tem). Derivamos as parcelas da
    // `payment_condition` do PV: ela pode ser "60", "30/60/90", "à vista"…
    // — extraímos os prazos em dias; cada um vira uma parcela com
    // vencimento = data de emissão + prazo. forma_pagamento_id 6519268 =
    // "Boleto Bancário" (tipo BB) no GestaoClick — padrão da Squad Shoes.
    const FORMA_PAGAMENTO_BOLETO = "6519268";
    const buildPagamento = (): any[] => {
      const cond = String(order.payment_condition || "").trim();
      const prazos = (cond.match(/\d+/g) || []).map(Number).filter((n) => n >= 0);
      const lista = prazos.length > 0 ? prazos : [0]; // sem prazo → à vista
      const n = lista.length;
      const totalCent = Math.round(totalComFrete * 100);
      const baseCent = Math.floor(totalCent / n);
      const hoje = new Date();
      return lista.map((dias, i) => {
        const venc = new Date(hoje);
        venc.setDate(venc.getDate() + dias);
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

    // ---------- Cria a NF-e no GestaoClick (rascunho) ----------
    // Natureza de operação: usa fiscal.natureza_operacao (cadastro de
    // companies) — antes era hardcode "Operação não presencial, outros"
    // mas a NF modelo #248 (revisada pela contabilidade em 19/05/2026)
    // saiu com "Venda de Produção do Estabelecimento". Empresa atualizou
    // o cadastro pra refletir isso (companies.natureza_operacao). Sem
    // fallback, usa o nome do XML padrão SEFAZ.
    // O painel GestaoClick é a fonte da verdade pra consumidor_final /
    // indicador_destinatario / CFOP e para a tributação (IPI/PIS/COFINS/CSOSN)
    // — campos do payload da API são ignorados. Os CSTs (IPI 99/enq.999,
    // PIS 49, COFINS 49) e o CSOSN saem do cadastro da natureza no painel
    // GestaoClick (a API não tem endpoint de tributação).
    const naturezaEsperada = (fiscal.natureza_operacao || "").trim()
      || "Venda de Produção do Estabelecimento";

    // ---------- Bloco `transporte` (peso bruto / líquido / volumes) ----------
    // GestaoClick ignora `peso_bruto` / `peso_liquido` / `quantidade_volumes`
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

    // Resolve loja_id do GestaoClick — obrigatório segundo a doc da API.
    // Usa a loja mapeada na empresa (companies.gestaoclick_loja_id) quando houver
    // — essencial pra NF sair sob o 2º CNPJ; senão cai na matriz.
    const gcLojaId = await resolveGcLojaId(fiscal?.gestaoclick_loja_id);

    // Resolve (cria se preciso) transportadora "Squad Shoes" no GestaoClick.
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
    // qVol é INTEIRO no XML SEFAZ — envia como number, não string.
    if (qtdVolumesStr) volumesObj.quantidade = Math.max(1, Math.trunc(Number(qtdVolumesStr)) || 1);
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

    const nfePayload = {
      // tipo_nf como INT (doc especifica int; antes mandávamos string "1").
      tipo_nf: 1,
      // loja_id (obrigatório na doc). Quando null, GC usa matriz por default.
      ...(gcLojaId ? { loja_id: Number(gcLojaId) } : {}),
      natureza_operacao: naturezaEsperada,
      id_destinatario: gcClientId,
      codigo_cfop: resolvedCfop,
      modelo: "55",
      serie: fiscal.serie_nfe || "1",
      finalidade_nf: "1",
      // tipo_emissao=1 ("Normal") — pedido em 16/05/2026. Antes não era
      // enviado; GestaoClick assumia default mas explícito blinda contra
      // mudança de default deles.
      tipo_emissao: "1",
      // tipo_atendimento=9 ("Operação não presencial, outros") — pedido em
      // 16/05/2026 pela Squad Shoes. Nome correto do campo no GestaoClick
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
      ...(qtdVolumesStr ? { quantidade_volumes: Math.max(1, Math.trunc(Number(qtdVolumesStr)) || 1) } : {}),
      especie_volumes: "Volumes",
      // valor_frete: bug fix 20/05/2026 (PV-00122). Antes a UI somava
      // mercadoria+frete (R$ 0,50/par × N pares) mas a NF emitia só
      // mercadoria — divergência entre tela e fiscal. Agora envia o
      // valor_frete gravado no PV (atualizado pelo useUpdate/CreateSaleOrder).
      ...(Number(order.valor_frete) > 0
        ? { valor_frete: Number(Number(order.valor_frete).toFixed(2)) }
        : {}),
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
      if (weightWarning) previewWarnings.push(weightWarning);
      if (packagingModeWarning) previewWarnings.push(packagingModeWarning);
      if (!gcClientId) {
        previewWarnings.push(
          `Cliente ainda não está cadastrado no GestaoClick — será criado automaticamente na emissão.`,
        );
      }
      const pendingProducts = produtosPreview.filter((p) => p.gc_status === 'pending_create');
      if (pendingProducts.length > 0) {
        previewWarnings.push(
          `${pendingProducts.length} produto(s) serão cadastrados no GestaoClick na emissão: ${pendingProducts.map((p) => p.descricao).join('; ')}`,
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
            total_pedido: totalComFrete,
            qtd_itens: produtosPreview.length,
            qtd_pares: produtosPreview.reduce((s, p) => s + p.quantidade, 0),
          },
          transporte: {
            modalidade_frete: '3 (Transporte próprio por conta do remetente)',
            transportadora_id_gc: gcTransportadoraId,
            transportador: Object.keys(transportadorBlock).length > 0
              ? transportadorBlock
              : null,
            qtd_volumes: qtdVolumesStr ? Math.max(1, Math.trunc(Number(qtdVolumesStr)) || 1) : null,
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
        valor_total: totalComFrete,
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
        valor_total: totalComFrete,
        motivo_rejeicao: isTimeout
          ? `Timeout no GestaoClick (>30s). NF pode ter sido criada lá — confira no painel pelo número de PV antes de re-emitir (evita NF duplicada). Detalhe: ${errMsg}`
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
          ? "Timeout ao falar com GestaoClick. ATENÇÃO: A NF pode ter sido criada no painel deles. Confira antes de re-emitir pra evitar duplicata fiscal. Em caso de duplicata, cancele a antiga no painel ou use Sincronizar com GestaoClick."
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
        valor_total: totalComFrete,
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
      return new Response(JSON.stringify({ error: `Falha ao cadastrar NF-e no GestaoClick: ${msg}` }), { status: 422, headers: corsHeaders });
    }
    const gcNfeId = String(createResp.json?.data?.dados || createResp.json?.data?.id);

    // ---------- Emite a NF-e (envia pra SEFAZ) ----------
    const emitResp = await gcFetch(`/notas_fiscais_produtos/emitir/${gcNfeId}`, { method: "POST" });
    const emitOk = emitResp.ok && emitResp.json?.data?.ok !== false && emitResp.json?.status !== "error";
    const emitMsg = emitResp.json?.data?.mensagem || emitResp.json?.message || emitResp.json?.mensagem || "";

    // ---------- Consulta status final + protocolo/chave ----------
    let chave = "";
    let protocolo = "";
    let situacao = "";
    let numeroNf = "";
    let serieNf = "";
    let dataEmissao = "";
    let motivoRejeicaoSefaz = "";
    let detailResponseJson: unknown = null;
    if (emitOk) {
      const detail = await gcFetch(`/notas_fiscais_produtos/${gcNfeId}`);
      detailResponseJson = detail.json ?? null;
      const d = detail.json?.data || {};
      chave = d.chave || "";
      protocolo = d.protocolo || "";
      situacao = d.situacao_nf || "";
      // motivo_rejeicao_sefaz vem preenchido quando a SEFAZ rejeitou no
      // pós-emit. Detector antigo só lia situacao_nf; agora usamos esse
      // campo como sinal forte de rejeição.
      motivoRejeicaoSefaz = d.motivo_rejeicao_sefaz || d.motivo_rejeicao || "";
      // numero_nf / serie só vêm no detalhe — sem isso o registro local
      // ficava com numero/serie vazios (quebrava a aba "NF-es Emitidas" e
      // a devolução, que referencia nfeOriginal.numero).
      numeroNf = d.numero_nf ? String(d.numero_nf) : "";
      serieNf = d.serie ? String(d.serie) : "";
      // data_emissao real da SEFAZ — sem isso a coluna assumia o default
      // now() do insert e a janela de 24h pra cancelamento ficava imprecisa.
      if (d.data_emissao) {
        const t = d.hora_emissao ? `${d.data_emissao}T${d.hora_emissao}` : String(d.data_emissao);
        const norm = /Z$|[+-]\d{2}:\d{2}$/.test(t) ? t : t + "-03:00";
        const ts = new Date(norm).getTime();
        if (!Number.isNaN(ts) && ts > 0 && ts < Date.now() + 86_400_000) dataEmissao = norm;
      }
    }
    // Status final via mapSituacao() canônico (mesma lógica de nfe-status e
    // sync-nfe-from-provider). Sinais fortes de rejeição que sobrescrevem o
    // mapper:
    //   - emitOk=false → POST /emitir já falhou
    //   - motivo_rejeicao_sefaz preenchido → SEFAZ rejeitou pós-emit, mesmo
    //     que situacao_nf venha estranha
    //   - emitMsg contém "rejei" → mensagem de erro da chamada de emit
    const msg = (emitMsg || "").toLowerCase();
    const explicitRejection = !emitOk || motivoRejeicaoSefaz.trim() !== "" || msg.includes("rejei");
    const finalStatus = explicitRejection ? "rejeitada" : mapSituacao(situacao);

    const nfeRecord: any = {
      sale_order_id,
      ref_nfe: ref,
      status: finalStatus,
      valor_total: totalComFrete,
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
          error: `Outra NF-e foi criada simultaneamente para este pedido. Verifique o painel GestaoClick (NF id ${gcNfeId}) e cancele a duplicata se necessário.`,
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
      provider_response: { create: createResp.json, emit: emitResp.json },
      ...(arSyncWarning ? { ar_sync_warning: arSyncWarning } : {}),
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
