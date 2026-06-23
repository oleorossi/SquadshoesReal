import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight } from '@phosphor-icons/react';
import { cn } from "@/lib/utils";
import { getDashboardPeriodRange, type DashboardPeriod } from "@/lib/dashboardPeriod";

type OPStatus = "ok" | "warn" | "err";

const STATUS_DOT: Record<OPStatus, string> = {
  ok:   "bg-green-500",
  warn: "bg-amber-500",
  err:  "bg-red-500",
};

const STATUS_TAG: Record<OPStatus, string> = {
  ok:   "bg-green-500/10 text-green-600 border-green-500/20",
  warn: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  err:  "bg-red-500/10   text-red-600   border-red-500/20",
};

const STATUS_LABEL: Record<string, string> = {
  completed:   "Concluída",
  in_progress: "Em andamento",
  pending:     "Aguardando",
  approved:    "Aprovada",
  cancelled:   "Cancelada",
};

export function BottomRow({ period = 'current_month' }: { period?: DashboardPeriod } = {}) {
  const navigate = useNavigate();
  const range = getDashboardPeriodRange(period);

  const { data: recentOps = [] } = useQuery({
    queryKey: ["dashboard-recent-ops", range.cacheKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, quantity, status, planned_delivery, created_at")
        .gte("created_at", range.startISO)
        .lte("created_at", range.endISO)
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return (data || []).map((op: any) => {
        const isLate = op.planned_delivery && new Date(op.planned_delivery) < new Date() && op.status !== "completed";
        let status: OPStatus = "ok";
        if (isLate) status = "err";
        else if (op.status === "pending" || op.status === "awaiting") status = "warn";
        return {
          // Auditoria visual 11/06/2026: order_number já vem com o prefixo
          // "OP-" do banco — concatenar de novo gerava "OP-OP-2026-00951".
          // Só prefixamos no fallback (id curto), que não tem prefixo.
          id:     op.order_number ?? `OP-${op.id.slice(0, 6)}`,
          qty:    `${Number(op.quantity).toLocaleString("pt-BR")} pares`,
          status,
          label:  STATUS_LABEL[op.status] ?? op.status ?? "Em andamento",
        };
      });
    },
    staleTime: 60_000,
  });

  // Top modelos vendidos no período: filtra sale_order_items pelo created_at
  // do PV pai (via inner join). Antes pegava all-time, agora respeita o filtro.
  const { data: topProducts = [] } = useQuery({
    queryKey: ["dashboard-top-sold-models", range.cacheKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_order_items")
        .select("quantity, sale_orders!inner(created_at), technical_sheets(id, name, code)")
        .gte("sale_orders.created_at", range.startISO)
        .lte("sale_orders.created_at", range.endISO);
      if (error) throw error;
      const grouped = (data || []).reduce((acc: any, item: any) => {
        const ref = item.technical_sheets;
        if (!ref) return acc;
        if (!acc[ref.id]) acc[ref.id] = { id: ref.id, name: ref.name, ref: ref.code || "N/A", qty: 0 };
        acc[ref.id].qty += Number(item.quantity) || 0;
        return acc;
      }, {});
      const sorted = Object.values(grouped).sort((a: any, b: any) => b.qty - a.qty).slice(0, 5);
      const maxQty = (sorted[0] as any)?.qty || 1;
      return sorted.map((p: any) => ({ ...p, pct: Math.round((p.qty / maxQty) * 100) }));
    },
    staleTime: 5 * 60_000,
  });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-3">

      {/* ── Top Modelos ── */}
      <div className="bg-card rounded-xl border border-border shadow-card hover:shadow-card-hover transition-shadow duration-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border/60 flex items-center justify-between bg-muted/20">
          <h3 className="text-base font-semibold text-foreground tracking-tight">Top Modelos Produzidos</h3>
          <button
            onClick={() => navigate("/fichas-tecnicas")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2.5 py-1 hover:bg-muted/50 transition-colors"
          >
            Ver todos <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Modelo", "Referência", "Qtd", "Volume"].map((h, i) => (
                <th key={h} className={cn(
                  "text-xs font-bold uppercase tracking-[0.07em] text-muted-foreground py-2.5 border-b border-border/60 bg-muted/30",
                  i === 0 ? "pl-5 text-left" : i === 3 ? "pr-5 text-right" : "px-4 text-left"
                )}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topProducts.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                  Sem dados disponíveis
                </td>
              </tr>
            ) : topProducts.map((m: any) => (
              <tr
                key={m.id}
                className="hover:bg-primary/[0.03] transition-colors cursor-pointer border-b border-border/40 last:border-0"
                onClick={() => navigate("/fichas-tecnicas")}
              >
                <td className="py-2.5 pl-5 text-[12.5px] font-medium text-foreground">{m.name}</td>
                <td className="py-2.5 px-4 text-sm font-mono text-muted-foreground">{m.ref}</td>
                <td className="py-2.5 px-4 text-sm font-mono font-semibold text-foreground tabular-nums">{m.qty.toLocaleString("pt-BR")}</td>
                <td className="py-2.5 pr-5">
                  <div className="flex items-center gap-2 justify-end">
                    <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${m.pct}%` }} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground w-8 text-right tabular-nums">{m.pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── OPs Recentes ── */}
      <div className="bg-card rounded-xl border border-border shadow-card hover:shadow-card-hover transition-shadow duration-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border/60 flex items-center justify-between bg-muted/20">
          <h3 className="text-base font-semibold text-foreground tracking-tight">OPs Recentes</h3>
          <button
            onClick={() => navigate("/orders")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2.5 py-1 hover:bg-muted/50 transition-colors"
          >
            Todas <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        <div>
          {recentOps.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma OP encontrada
            </div>
          ) : recentOps.map((op: any) => (
            <div
              key={op.id}
              className="flex items-center gap-3 px-5 py-2.5 border-b border-border/40 last:border-0 hover:bg-primary/[0.03] transition-colors cursor-pointer"
              onClick={() => navigate("/orders")}
            >
              <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_DOT[op.status as OPStatus])} />
              <span className="flex-1 text-sm font-medium text-foreground font-mono">{op.id}</span>
              <span className="text-xs font-mono text-muted-foreground tabular-nums">{op.qty}</span>
              <span className={cn(
                "text-xs font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border",
                STATUS_TAG[op.status as OPStatus]
              )}>
                {op.label}
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
