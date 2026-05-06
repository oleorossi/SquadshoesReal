import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function cleanCnpj(cnpj: string) {
  return cnpj.replace(/\D/g, "");
}

function cleanCep(cep: string) {
  return cep.replace(/\D/g, "");
}

function buildAddress(street?: string | null, number?: string | null, complement?: string | null) {
  if (!street) return null;

  const normalizedStreet = street.trim();
  const normalizedNumber = number?.trim() ? `, ${number.trim()}` : "";
  const normalizedComplement = complement?.trim() ? ` - ${complement.trim()}` : "";

  return `${normalizedStreet}${normalizedNumber}${normalizedComplement}`;
}

async function fetchCnpjData(cnpj: string) {
  const clean = cleanCnpj(cnpj);
  if (clean.length !== 14) return null;

  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`BrasilAPI returned ${res.status} for CNPJ ${clean}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error(`Error fetching CNPJ ${clean}:`, err);
    return null;
  }
}

async function fetchCepData(cep: string) {
  const clean = cleanCep(cep);
  if (clean.length !== 8) return null;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`ViaCEP returned ${res.status} for CEP ${clean}`);
      return null;
    }

    const data = await res.json();
    if (data?.erro) return null;
    return data;
  } catch (err) {
    console.error(`Error fetching CEP ${clean}:`, err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Require Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Validate JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    // 3) Require admin or gerente role (server-side authorization)
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rolesError) {
      return new Response(JSON.stringify({ success: false, error: "Role check failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const allowed = roles?.some((r: { role: string }) => ["admin", "gerente"].includes(r.role));
    if (!allowed) {
      return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let singleClientId: string | null = null;
    try {
      const body = await req.json();
      singleClientId = body?.client_id ?? null;
    } catch {
      singleClientId = null;
    }

    // Validate the client_id is a real UUID before using it in a DB filter.
    // An invalid value is rejected with 400 instead of silently degrading to
    // a full-table sync (which would burn external CNPJ-API quota / slow down).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (singleClientId !== null && !UUID_RE.test(String(singleClientId))) {
      return new Response(JSON.stringify({ success: false, error: "client_id inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let query = supabase
      .from("clients")
      .select("id, cnpj, razao_social, nome_fantasia, endereco, bairro, cidade, estado, cep, inscricao_estadual, endereco_manual_override, endereco_updated_at")
      .not("cnpj", "is", null)
      .neq("cnpj", "");

    if (singleClientId) {
      query = query.eq("id", singleClientId);
    } else {
      query = query.limit(50);
    }

    const { data: clients, error } = await query;

    if (error) {
      console.error("Error fetching clients:", error);
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!clients || clients.length === 0) {
      return new Response(JSON.stringify({ success: true, updated: 0, message: "Nenhum cliente com CNPJ encontrado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    let errors = 0;
    const results: { id: string; name: string; status: string }[] = [];

    for (const client of clients) {
      await new Promise((resolve) => setTimeout(resolve, 350));

      const cnpjData = await fetchCnpjData(client.cnpj!);
      if (!cnpjData) {
        errors++;
        results.push({ id: client.id, name: client.nome_fantasia || client.razao_social || client.id, status: "error" });
        continue;
      }

      const cepData = cnpjData.cep ? await fetchCepData(cnpjData.cep) : null;
      const updates: Record<string, unknown> = {};

      const officialStreet = cepData?.logradouro || cnpjData.logradouro || null;
      const officialNeighborhood = cepData?.bairro || cnpjData.bairro || null;
      const officialCity = cepData?.localidade || cnpjData.municipio || null;
      const officialMunicipioCod = cepData?.ibge || null;
      const officialState = cepData?.uf || cnpjData.uf || null;
      const officialCep = cleanCep(cepData?.cep || cnpjData.cep || "");
      const officialAddress = buildAddress(officialStreet, cnpjData.numero, cnpjData.complemento);

      // Respeita override manual: se usuário marcou que o endereço foi
      // editado manualmente (ex: filial diferente da sede do CNPJ), o
      // sync NÃO sobrescreve campos de endereço. Demais campos
      // (razão social, IE) seguem sendo preenchidos.
      const manualOverride = (client as any).endereco_manual_override === true;
      if (!manualOverride) {
        if (officialAddress) updates.endereco = officialAddress;
        if (officialNeighborhood) updates.bairro = officialNeighborhood;
        if (officialCity) updates.cidade = officialCity;
        if (officialState) updates.estado = officialState;
        if (officialCep) updates.cep = officialCep;
        if (officialMunicipioCod) updates.codigo_municipio = officialMunicipioCod;
        // Sinaliza para o trigger fn_track_client_address_manual_edit que esta
        // alteração veio do sync (não foi edição humana). Mantém o timestamp
        // anterior para que o trigger não interprete como override manual.
        if (Object.keys(updates).length > 0 && (client as any).endereco_updated_at) {
          updates.endereco_updated_at = (client as any).endereco_updated_at;
        }
      }

      if (!client.razao_social && cnpjData.razao_social) {
        updates.razao_social = cnpjData.razao_social;
      }
      if (!client.nome_fantasia && cnpjData.nome_fantasia) {
        updates.nome_fantasia = cnpjData.nome_fantasia;
      }
      // BrasilAPI may return inscricao_estadual as an array of objects
      // ({ inscricao_estadual: string, ativo: bool }) or as a plain string.
      // Writing the raw value would store "[object Object]" in the DB.
      const rawIe = cnpjData.inscricao_estadual;
      const normalizedIe = Array.isArray(rawIe)
        ? ((rawIe as any[]).find((x: any) => x.ativo)?.inscricao_estadual ?? null)
        : (typeof rawIe === 'string' ? rawIe : null);
      if (!client.inscricao_estadual && normalizedIe) {
        updates.inscricao_estadual = normalizedIe;
      }

      if (Object.keys(updates).length === 0) {
        results.push({ id: client.id, name: client.nome_fantasia || client.razao_social || client.id, status: "no_changes" });
        continue;
      }

      updates.updated_at = new Date().toISOString();

      const { error: updateError } = await supabase.from("clients").update(updates).eq("id", client.id);

      if (updateError) {
        console.error(`Error updating client ${client.id}:`, updateError);
        errors++;
        results.push({ id: client.id, name: client.nome_fantasia || client.razao_social || client.id, status: "update_error" });
      } else {
        updated++;
        results.push({ id: client.id, name: client.nome_fantasia || client.razao_social || client.id, status: "updated" });
      }
    }

    console.log(`CNPJ sync complete: ${updated} updated, ${errors} errors out of ${clients.length} clients`);

    return new Response(JSON.stringify({ success: true, total: clients.length, updated, errors, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});