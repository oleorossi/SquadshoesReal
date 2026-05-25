import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Unauthorized", 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", "")
  );
  if (userError || !userData?.user) {
    return errorResponse("Unauthorized", 401);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace("/time-control", "").replace(/^\//, "");

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const validateDate = (v: string | null, name: string) => {
    if (v && !ISO_DATE.test(v)) return errorResponse(`${name} deve estar no formato YYYY-MM-DD`);
    return null;
  };

  try {
    // GET /time-control/records
    if (req.method === "GET" && path === "records") {
      const employee_id = url.searchParams.get("employee_id");
      const date_from = url.searchParams.get("date_from");
      const date_to = url.searchParams.get("date_to");
      const department = url.searchParams.get("department");

      const df = validateDate(date_from, "date_from"); if (df) return df;
      const dt = validateDate(date_to, "date_to"); if (dt) return dt;

      let q = supabase
        .from("time_records")
        .select("*")
        .order("record_date", { ascending: false })
        .order("employee_name");

      if (employee_id) q = q.eq("employee_external_id", employee_id);
      if (date_from) q = q.gte("record_date", date_from);
      if (date_to) q = q.lte("record_date", date_to);
      if (department) q = q.eq("department", department);

      const { data, error } = await q.limit(1000);
      if (error) throw error;
      return jsonResponse(data);
    }

    // GET /time-control/exceptions
    if (req.method === "GET" && path === "exceptions") {
      const status = url.searchParams.get("status");
      const severity = url.searchParams.get("severity");
      const date_from = url.searchParams.get("date_from");
      const date_to = url.searchParams.get("date_to");

      const df = validateDate(date_from, "date_from"); if (df) return df;
      const dt = validateDate(date_to, "date_to"); if (dt) return dt;

      let q = supabase
        .from("time_exceptions")
        .select("*")
        .order("record_date", { ascending: false })
        .order("employee_name");

      if (status) q = q.eq("status", status);
      if (severity) q = q.eq("severity", severity);
      if (date_from) q = q.gte("record_date", date_from);
      if (date_to) q = q.lte("record_date", date_to);

      const { data, error } = await q.limit(500);
      if (error) throw error;
      return jsonResponse(data);
    }

    // PATCH /time-control/exceptions/:id
    if (req.method === "PATCH" && path.startsWith("exceptions/")) {
      const id = path.replace("exceptions/", "");
      if (!id) return errorResponse("ID obrigatório");

      // Only admin/gerente/rh may modify time exceptions (assignment, severity, status).
      const adminAuthClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: roles, error: rolesErr } = await adminAuthClient
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id);
      if (rolesErr) return errorResponse("Falha ao validar permissão", 500);
      const allowed = roles?.some((r: { role: string }) => ["admin", "gerente", "rh"].includes(r.role));
      if (!allowed) return errorResponse("Forbidden: apenas admin, gerente ou rh podem alterar exceções de ponto", 403);

      const body = await req.json();
      const allowedFields = ["status", "resolution_notes", "assigned_to", "severity"];
      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

      for (const field of allowedFields) {
        if (body[field] !== undefined) updateData[field] = body[field];
      }

      // Atomic status guard: terminal transitions (→resolved/→ignored) only
      // succeed when the exception is still 'pending'. Concurrent resolves by
      // two HR operators return 0 rows; the loser sees a 409 instead of
      // silently overwriting resolution notes.
      let updateQuery = supabase.from("time_exceptions").update(updateData).eq("id", id);
      if (body.status === "resolved" || body.status === "ignored") {
        updateQuery = (updateQuery as any).eq("status", "pending");
      }
      const { data: updRows, error } = await (updateQuery as any).select();
      if (error) throw error;
      if (!updRows || (updRows as any[]).length === 0) {
        return errorResponse("Exceção já foi processada por outro usuário ou não encontrada", 409);
      }
      return jsonResponse((updRows as any[])[0]);
    }

    // GET /time-control/analytics
    if (req.method === "GET" && path === "analytics") {
      const date_from = url.searchParams.get("date_from");
      const date_to = url.searchParams.get("date_to");
      if (!date_from || !date_to) return errorResponse("date_from e date_to obrigatórios");
      const adf = validateDate(date_from, "date_from"); if (adf) return adf;
      const adt = validateDate(date_to, "date_to"); if (adt) return adt;

      // Fetch records and exceptions in parallel
      const [recordsRes, exceptionsRes] = await Promise.all([
        supabase
          .from("time_records")
          .select("employee_name, record_date, punches, department")
          .gte("record_date", date_from)
          .lte("record_date", date_to)
          .limit(1000),
        supabase
          .from("time_exceptions")
          .select("id, status, type, severity")
          .gte("record_date", date_from)
          .lte("record_date", date_to),
      ]);

      if (recordsRes.error) throw recordsRes.error;
      if (exceptionsRes.error) throw exceptionsRes.error;

      const records = recordsRes.data || [];
      const exceptions = exceptionsRes.data || [];

      const empNames = new Set(records.map((r) => r.employee_name));
      let totalDaysExpected = 0;
      let totalDaysPresent = 0;
      let totalDaysPunctual = 0;        // punches presente E primeiro punch ≤ schedule
      let totalCompleteDays = 0;
      let totalDaysProcessed = 0;
      let totalOvertimeMinutes = 0;
      const overtimeByDept: Record<string, number> = {};

      // Standard schedule (08:00) — em produção viria de work_schedules por funcionário.
      const SCHEDULE_START_MIN = 8 * 60;        // 08:00
      const SCHEDULE_END_MIN   = 17 * 60 + 48;  // 17:48 (jornada de 8h48min com 1h almoço)
      const PUNCTUAL_TOLERANCE_MIN = 10;        // 10min de tolerância

      const punchToMinutes = (p: string): number | null => {
        const m = /^(\d{2}):(\d{2})/.exec(p);
        if (!m) return null;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      };

      empNames.forEach((name) => {
        const empRecords = records.filter((r) => r.employee_name === name);
        empRecords.forEach((rec) => {
          const punches = (rec.punches as string[]) || [];
          const date = new Date(rec.record_date + "T12:00:00");
          const dayOfWeek = date.getDay();
          const isWorkday = dayOfWeek !== 0; // domingo não conta

          if (isWorkday) {
            totalDaysExpected++;
            if (punches.length > 0) {
              totalDaysPresent++;
              // Punctuality: primeiro punch dentro da tolerância da jornada
              const firstMin = punchToMinutes(punches[0]);
              if (firstMin !== null && firstMin <= SCHEDULE_START_MIN + PUNCTUAL_TOLERANCE_MIN) {
                totalDaysPunctual++;
              }
            }
          }
          if (punches.length > 0 && punches.length % 2 === 0) totalCompleteDays++;
          if (punches.length > 0) totalDaysProcessed++;

          // Overtime: para cada par (entrada, saída), soma minutos trabalhados,
          // depois subtrai a jornada padrão. Apenas em dias úteis.
          if (isWorkday && punches.length >= 2 && punches.length % 2 === 0) {
            let workedMin = 0;
            for (let i = 0; i < punches.length; i += 2) {
              const inMin = punchToMinutes(punches[i]);
              const outMin = punchToMinutes(punches[i + 1]);
              if (inMin !== null && outMin !== null && outMin > inMin) {
                workedMin += (outMin - inMin);
              }
            }
            const standardMin = SCHEDULE_END_MIN - SCHEDULE_START_MIN - 60; // -1h almoço
            const overtime = Math.max(0, workedMin - standardMin);
            totalOvertimeMinutes += overtime;
            const dept = (rec as { department?: string }).department || 'Sem departamento';
            overtimeByDept[dept] = (overtimeByDept[dept] || 0) + overtime;
          }
        });
      });

      const attendanceRate = totalDaysExpected > 0 ? (totalDaysPresent / totalDaysExpected) * 100 : 0;
      const punctualityRate = totalDaysPresent > 0 ? (totalDaysPunctual / totalDaysPresent) * 100 : 0;
      const dataQualityScore = totalDaysProcessed > 0 ? (totalCompleteDays / totalDaysProcessed) * 100 : 0;
      const avgOvertimeHours = empNames.size > 0 ? (totalOvertimeMinutes / 60) / empNames.size : 0;

      // Group exceptions by type
      const exceptionsByType: Record<string, number> = {};
      exceptions.forEach((e) => {
        exceptionsByType[e.type] = (exceptionsByType[e.type] || 0) + 1;
      });

      return jsonResponse({
        total_employees: empNames.size,
        attendance_rate: Math.round(attendanceRate * 10) / 10,
        punctuality_rate: Math.round(punctualityRate * 10) / 10,
        avg_overtime_hours: Math.round(avgOvertimeHours * 10) / 10,
        total_exceptions: exceptions.filter((e) => e.status === "pending").length,
        data_quality_score: Math.round(dataQualityScore * 10) / 10,
        trends: {
          late_arrivals: [],
          overtime_by_department: Object.entries(overtimeByDept).map(([department, mins]) => ({
            department,
            hours: Math.round((mins / 60) * 10) / 10,
          })),
          exceptions_by_type: Object.entries(exceptionsByType).map(([type, count]) => ({
            type,
            count,
          })),
        },
      });
    }

    // GET /time-control/work-days
    if (req.method === "GET" && path === "work-days") {
      const employee_id = url.searchParams.get("employee_id");
      const date_from = url.searchParams.get("date_from");
      const date_to = url.searchParams.get("date_to");

      let q = supabase
        .from("time_records")
        .select("*")
        .order("record_date", { ascending: true })
        .order("employee_name");

      if (employee_id) q = q.eq("employee_external_id", employee_id);
      if (date_from) q = q.gte("record_date", date_from);
      if (date_to) q = q.lte("record_date", date_to);

      const { data, error } = await q.limit(1000);
      if (error) throw error;
      return jsonResponse(data);
    }

    return errorResponse("Rota não encontrada", 404);
  } catch (err) {
    console.error("time-control error:", err);
    return errorResponse(err instanceof Error ? err.message : "Erro interno", 500);
  }
});
