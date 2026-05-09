// =============================================================================
// setup-nfe-certificate — Cadastra/atualiza certificado A1 na Focus NFe
// =============================================================================
// Recebe FormData com:
//   - cnpj (string): CNPJ da empresa cadastrada localmente
//   - certificate (File): arquivo .pfx ou .p12
//   - password (string): senha do certificado
//
// Fluxo:
//   1. Auth do usuário (admin ou gerente)
//   2. Lê empresa local pelo CNPJ
//   3. Verifica se empresa já existe na Focus NFe (GET /v2/empresas/{cnpj})
//      - Se sim: PUT /v2/empresas/{cnpj} (atualiza certificado)
//      - Se não: POST /v2/empresas (cria com certificado)
//   4. Atualiza companies com metadados do certificado
//   5. Sistema NÃO persiste a senha — só Focus NFe armazena.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claims.claims.sub as string;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const allowed = roles?.some((r: { role: string }) => ["admin", "gerente"].includes(r.role));
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Forbidden: apenas admin ou gerente podem configurar certificado NF-e" }),
        { status: 403, headers: corsHeaders },
      );
    }

    const FOCUS_TOKEN = Deno.env.get("FOCUS_NFE_API_TOKEN");
    if (!FOCUS_TOKEN) {
      return new Response(
        JSON.stringify({ error: "Token da Focus NFe não configurado no servidor" }),
        { status: 500, headers: corsHeaders },
      );
    }

    // FormData parsing
    const formData = await req.formData();
    const cnpjRaw = formData.get("cnpj")?.toString() || "";
    const certificate = formData.get("certificate") as File | null;
    const password = formData.get("password")?.toString() || "";

    const cnpj = cnpjRaw.replace(/\D/g, "");
    if (!cnpj || (cnpj.length !== 14)) {
      return new Response(
        JSON.stringify({ error: "CNPJ inválido (14 dígitos)" }),
        { status: 400, headers: corsHeaders },
      );
    }
    if (!certificate || certificate.size === 0) {
      return new Response(
        JSON.stringify({ error: "Arquivo do certificado é obrigatório" }),
        { status: 400, headers: corsHeaders },
      );
    }
    if (certificate.size > 5 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: "Certificado deve ter no máximo 5MB" }),
        { status: 400, headers: corsHeaders },
      );
    }
    const ext = certificate.name.toLowerCase();
    if (!ext.endsWith(".pfx") && !ext.endsWith(".p12")) {
      return new Response(
        JSON.stringify({ error: "Arquivo deve ser .pfx ou .p12" }),
        { status: 400, headers: corsHeaders },
      );
    }
    if (!password || password.length < 4) {
      return new Response(
        JSON.stringify({ error: "Senha do certificado é obrigatória" }),
        { status: 400, headers: corsHeaders },
      );
    }

    // Lê empresa local
    const { data: company, error: companyErr } = await adminClient
      .from("companies")
      .select("*")
      .eq("cnpj", cnpjRaw)
      .or(`cnpj.eq.${cnpj}`)
      .maybeSingle();
    if (companyErr || !company) {
      return new Response(
        JSON.stringify({ error: `Empresa ${cnpjRaw} não cadastrada no sistema. Cadastre-a primeiro.` }),
        { status: 404, headers: corsHeaders },
      );
    }

    // Marca status pendente enquanto processa
    await adminClient.from("companies").update({
      cert_status: "pendente",
      cert_uploaded_at: new Date().toISOString(),
    }).eq("id", company.id);

    // Verifica se empresa já existe na Focus
    const focusBase = "https://api.focusnfe.com.br";
    const focusAuth = `Basic ${btoa(`${FOCUS_TOKEN}:`)}`;

    const checkResp = await fetch(`${focusBase}/v2/empresas/${cnpj}`, {
      method: "GET",
      headers: { Authorization: focusAuth },
      signal: AbortSignal.timeout(20_000),
    });
    const exists = checkResp.ok;

    // Monta payload pra Focus NFe (multipart). Eles aceitam PFX em base64
    // OU upload multipart. Vamos usar multipart pra evitar dobrar tamanho.
    const focusFormData = new FormData();
    focusFormData.append("cnpj", cnpj);
    focusFormData.append("nome", company.razao_social || "");
    if (company.nome_fantasia) focusFormData.append("nome_fantasia", company.nome_fantasia);
    if (company.inscricao_estadual) focusFormData.append("inscricao_estadual", company.inscricao_estadual.replace(/\D/g, ""));
    if (company.regime_tributario) focusFormData.append("regime_tributario", company.regime_tributario);
    if (company.logradouro) focusFormData.append("logradouro", company.logradouro);
    if (company.numero) focusFormData.append("numero", company.numero);
    if (company.bairro) focusFormData.append("bairro", company.bairro);
    if (company.cidade) focusFormData.append("municipio", company.cidade);
    if (company.uf) focusFormData.append("uf", company.uf);
    if (company.cep) focusFormData.append("cep", company.cep.replace(/\D/g, ""));
    if (company.codigo_municipio) focusFormData.append("codigo_municipio", company.codigo_municipio);
    if (company.serie_nfe) focusFormData.append("nfe_serie_em_homologacao", String(company.serie_nfe));
    if (company.serie_nfe) focusFormData.append("nfe_serie_em_producao", String(company.serie_nfe));
    if (company.cfop) focusFormData.append("nfe_cfop_padrao", String(company.cfop));
    if (company.natureza_operacao) focusFormData.append("nfe_natureza_operacao_padrao", company.natureza_operacao);
    focusFormData.append("habilita_nfe", "true");
    focusFormData.append("arquivo_certificado_base64", await certificateToBase64(certificate));
    focusFormData.append("senha_certificado", password);

    const focusUrl = exists
      ? `${focusBase}/v2/empresas/${cnpj}`
      : `${focusBase}/v2/empresas`;
    const focusMethod = exists ? "PUT" : "POST";

    const focusResp = await fetch(focusUrl, {
      method: focusMethod,
      headers: { Authorization: focusAuth },
      body: focusFormData,
      signal: AbortSignal.timeout(60_000), // upload de cert pode demorar
    });

    const respText = await focusResp.text();
    let respData: any;
    try { respData = JSON.parse(respText); } catch { respData = { mensagem: respText }; }

    if (!focusResp.ok) {
      // Marca erro
      await adminClient.from("companies").update({
        cert_status: "erro",
        cert_focus_synced_at: new Date().toISOString(),
      }).eq("id", company.id);

      return new Response(
        JSON.stringify({
          error: respData?.mensagem || respData?.erros?.[0]?.mensagem || "Erro ao configurar certificado na Focus NFe",
          focus_response: respData,
          focus_status: focusResp.status,
        }),
        { status: 422, headers: corsHeaders },
      );
    }

    // Focus retorna metadados — pegar validade e subject quando disponíveis
    // Fields conhecidos: certificado_valido_de, certificado_valido_ate, certificado_subject
    // Estrutura pode variar; lemos defensivamente.
    const certValidUntil = respData?.certificado_valido_ate
      ? String(respData.certificado_valido_ate).slice(0, 10)
      : null;
    const certSubject = respData?.certificado_subject
      || respData?.certificado_dn
      || null;

    await adminClient.from("companies").update({
      cert_status: "ativo",
      cert_valid_until: certValidUntil,
      cert_subject_name: certSubject,
      cert_focus_synced_at: new Date().toISOString(),
    }).eq("id", company.id);

    return new Response(
      JSON.stringify({
        success: true,
        focus_response: respData,
        cert_valid_until: certValidUntil,
        cert_subject_name: certSubject,
        message: exists
          ? "Certificado atualizado na Focus NFe."
          : "Empresa criada na Focus NFe com certificado.",
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("setup-nfe-certificate error:", error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});

async function certificateToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
