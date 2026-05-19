import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Roles válidas no app — espelha o enum app_role no banco. Se mudar aqui,
// mudar tb em /src/hooks/useAccessControl.ts (ROLE_MODULES).
const VALID_ROLES = [
  "admin", "gerente", "producao", "almoxarifado", "comercial",
  "consulta", "nfe_operator", "rh",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    // Caller precisa ser admin
    const { data: callerRoles, error: rolesErr } = await userClient
      .from("user_roles").select("role").eq("user_id", callingUser.id);
    if (rolesErr) {
      return new Response(JSON.stringify({ error: "Falha ao validar permissão" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isAdmin = callerRoles?.some((r: any) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Apenas administradores podem criar usuários" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      email,
      password,
      full_name,
      // Novos: roles atribuídas + flag de aprovação imediata
      roles,
      approve,
    } = body as {
      email?: string;
      password?: string;
      full_name?: string;
      roles?: string[];
      approve?: boolean;
    };

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "E-mail e senha são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Senha deve ter ao menos 8 caracteres" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sanitiza roles — só aceita as válidas
    const cleanRoles = Array.isArray(roles)
      ? Array.from(new Set(roles.filter((r): r is string => typeof r === "string" && (VALID_ROLES as readonly string[]).includes(r))))
      : [];

    if (cleanRoles.length === 0) {
      return new Response(JSON.stringify({
        error: "Selecione pelo menos uma role (admin, gerente, comercial, producao, etc).",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: createData, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name || "" },
    });

    if (createErr || !createData?.user) {
      return new Response(JSON.stringify({ error: createErr?.message || "Falha ao criar usuário" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newUserId = createData.user.id;

    // Insere user_roles. Trigger no DB já criou profile com approved=false,
    // então precisamos: (1) inserir roles, (2) opcional setar approved=true.
    const rolesRows = cleanRoles.map(role => ({ user_id: newUserId, role }));
    const { error: rolesInsErr } = await adminClient.from("user_roles").insert(rolesRows);
    if (rolesInsErr) {
      // Rollback: deletar o user pra não deixar órfão sem role
      await adminClient.auth.admin.deleteUser(newUserId);
      return new Response(JSON.stringify({
        error: `Falha ao atribuir roles: ${rolesInsErr.message}. Usuário desfeito.`,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Aprovação opcional. Default = true porque o caso de uso comum é admin
    // criar usuário pra alguém já existente que precisa entrar agora. Se quiser
    // criar "pendente de aprovação", passar approve: false explicitamente.
    const shouldApprove = approve !== false; // default true
    if (shouldApprove) {
      const { error: approveErr } = await adminClient
        .from("profiles")
        .update({ approved: true })
        .eq("id", newUserId);
      if (approveErr) {
        // Não rollbacka — user e roles já foram criados, só aprovação ficou
        // pendente. Admin pode aprovar manualmente. Reporta no response.
        return new Response(JSON.stringify({
          user: createData.user,
          roles: cleanRoles,
          approved: false,
          warning: `Usuário criado e roles atribuídas, mas falha ao aprovar: ${approveErr.message}. Aprove manualmente em profiles.`,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({
      user: createData.user,
      roles: cleanRoles,
      approved: shouldApprove,
    }), {
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
