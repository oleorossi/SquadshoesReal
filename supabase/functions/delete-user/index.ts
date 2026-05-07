import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callingUser }, error: authError } = await userClient.auth.getUser();
    if (authError || !callingUser) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if calling user is admin — capture error so a policy regression fails closed.
    const { data: roles, error: rolesErr } = await userClient.from("user_roles").select("role").eq("user_id", callingUser.id);
    if (rolesErr) {
      return new Response(JSON.stringify({ error: "Falha ao validar permissão" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isAdmin = roles?.some((r: any) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Apenas administradores podem excluir usuários" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: "ID do usuário é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(String(user_id))) {
      return new Response(JSON.stringify({ error: "ID inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (user_id === callingUser.id) {
      return new Response(JSON.stringify({ error: "Você não pode excluir sua própria conta" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Safeguards: bloqueia deleção se o usuário for owner de dados que seriam
    // perdidos via CASCADE em auth.users. Sem isso, deletar um operador ou
    // gerente apaga silenciosamente sales orders, OPs, time records, etc.
    // Operador deve transferir ownership ou desativar (auth ban) antes.
    const ownershipChecks = await Promise.all([
      adminClient.from("sale_orders").select("id", { count: "exact", head: true }).eq("created_by", user_id),
      adminClient.from("orders").select("id", { count: "exact", head: true }).eq("created_by", user_id),
      adminClient.from("time_records").select("id", { count: "exact", head: true }).eq("approved_by", user_id),
      adminClient.from("nfe_emitidas").select("id", { count: "exact", head: true }).eq("emitted_by", user_id),
      adminClient.from("audit_logs").select("id", { count: "exact", head: true }).eq("user_id", user_id),
    ]);

    const blockers: string[] = [];
    const labels = ["sale_orders", "orders", "time_records", "nfe_emitidas", "audit_logs"];
    ownershipChecks.forEach((res, i) => {
      // Tolera erro de coluna inexistente — algumas tabelas podem não ter created_by
      if (res.error && !/column .* does not exist/i.test(res.error.message)) {
        // Falha no check = falha closed
        blockers.push(`erro ao verificar ${labels[i]}: ${res.error.message}`);
      } else if ((res.count ?? 0) > 0) {
        blockers.push(`${res.count} ${labels[i]}`);
      }
    });

    if (blockers.length > 0) {
      return new Response(JSON.stringify({
        error: `Usuário possui dados associados: ${blockers.join(", ")}. ` +
               `Transfira a propriedade para outro usuário ou desative a conta (em vez de excluir) ` +
               `para preservar trilha de auditoria.`,
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await adminClient.auth.admin.deleteUser(user_id);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
