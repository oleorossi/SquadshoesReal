// Comparativo da capacidade do Planejamento Diário (R10 de
// specs/equipe-e-capacidade-fonte-unica.md).
//
// O Planejamento usa hoje 600 pares/dia fixos por setor. Trocar pela capacidade
// derivada move as datas de toda a fábrica (a medição real dá de -58% a +105%
// dependendo do setor), então o dono confere lado a lado ANTES de aplicar —
// aplicar é ação explícita, nunca automática.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotch as Loader2, ArrowsClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn, formatNumber } from "@/lib/utils";
import { applyCapacityToPlanning, getPlanningComparison } from "@/services/capacityService";

export function PlanningCapacityComparison() {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["planning-capacity-comparison"],
    queryFn: getPlanningComparison,
  });

  const aplicar = useMutation({
    mutationFn: applyCapacityToPlanning,
    onSuccess: (r) => {
      toast.success(
        r.alterados > 0
          ? `Capacidade aplicada em ${r.alterados} setor${r.alterados === 1 ? "" : "es"} — o Planejamento vai recalcular as datas`
          : "Nenhum setor precisou de ajuste",
      );
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["planning-capacity-comparison"] });
      qc.invalidateQueries({ queryKey: ["sector-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aplicaveis = (rows ?? []).filter((r) => r.capacidade_nova != null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando comparativo…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground max-w-2xl">
        O Planejamento Diário usa a coluna "hoje". A coluna "derivada" vem da equipe e da
        produtividade medida de cada setor. Aplicar troca a fonte e faz o motor recalcular as datas
        de todas as OPs abertas — confira o impacto antes.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <th className="text-left py-2 pr-3 font-semibold">Setor</th>
              <th className="text-right py-2 px-3 font-semibold">Hoje</th>
              <th className="text-right py-2 px-3 font-semibold">Derivada</th>
              <th className="text-right py-2 px-3 font-semibold">Variação</th>
              <th className="text-left py-2 pl-3 font-semibold">Origem</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.setor} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3">{r.setor}</td>
                <td className="py-2 px-3 text-right font-mono tabular-nums">{r.capacidade_atual}</td>
                <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">
                  {r.capacidade_nova == null ? "—" : formatNumber(r.capacidade_nova, 0)}
                </td>
                <td
                  className={cn(
                    "py-2 px-3 text-right font-mono tabular-nums",
                    r.variacao_pct == null
                      ? "text-muted-foreground"
                      : r.variacao_pct < 0
                        ? "text-red-600"
                        : "text-green-600",
                  )}
                >
                  {r.variacao_pct == null ? "—" : `${r.variacao_pct > 0 ? "+" : ""}${formatNumber(r.variacao_pct, 1)}%`}
                </td>
                <td className="py-2 pl-3">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-mono uppercase border-transparent",
                      r.fonte_nova === "medido" && "bg-green-500/10 text-green-600",
                      r.fonte_nova === "teorico" && "bg-blue-500/10 text-blue-600",
                      r.fonte_nova === "sem_dado" && "bg-amber-500/10 text-amber-600",
                    )}
                    title={r.detalhe}
                  >
                    {r.fonte_nova === "medido" ? "medido" : r.fonte_nova === "teorico" ? "teórico" : "sem dado"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          className="h-9"
          onClick={() => setConfirmOpen(true)}
          disabled={aplicaveis.length === 0}
        >
          <ArrowsClockwise className="h-4 w-4 mr-2" />
          Aplicar no Planejamento ({aplicaveis.length})
        </Button>
        <span className="text-xs text-muted-foreground">
          Setores sem dado ficam como estão.
        </span>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar a capacidade do Planejamento Diário?</AlertDialogTitle>
            <AlertDialogDescription>
              {aplicaveis.length} setor(es) terão a capacidade alterada e o motor vai recalcular as
              datas de todas as OPs abertas. Isso pode antecipar ou atrasar entregas já planejadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => aplicar.mutate()} disabled={aplicar.isPending}>
              {aplicar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
