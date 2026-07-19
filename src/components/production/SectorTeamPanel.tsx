// Painel ÚNICO de Equipe por setor (specs/equipe-e-capacidade-fonte-unica.md, R1).
//
// Usado SEM VARIAÇÃO em Produção → Setores e no botão Equipe da Produtividade por
// Modelo — os dois gravam no mesmo campo (sector_settings.headcount). Antes o
// mesmo fato vivia em três lugares que não conversavam (employees.department,
// team_size e headcount), e foi isso que fez a Costura parecer "não cadastrada".
//
// R2/R6: o número vem do RH sozinho; a origem de cada linha fica à vista.
// R5:    setor sem ninguém no RH mantém o ajuste manual (nunca propõe 0).
// R17:   abre no primeiro pendente, destaca não dimensionados, adota do RH em 1 clique.
// R18:   360px, alvos de 44px.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UsersThree, CircleNotch as Loader2, ArrowsClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatNumber } from "@/lib/utils";
import { assertHeadcount, listSectorTeam, updateSectorHeadcounts } from "@/services/capacityService";
import type { SectorTeamRow, TeamSource } from "@/types/capacity";

const ORIGEM_LABEL: Record<TeamSource, string> = {
  rh: "do RH",
  manual: "manual",
  nao_informado: "preencher",
};

function OrigemBadge({ origem }: { origem: TeamSource }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-mono uppercase tracking-wider border-transparent shrink-0",
        origem === "rh" && "bg-green-500/10 text-green-600",
        origem === "manual" && "bg-blue-500/10 text-blue-600",
        origem === "nao_informado" && "bg-primary/10 text-primary border-primary/30",
      )}
    >
      {ORIGEM_LABEL[origem]}
    </Badge>
  );
}

export interface SectorTeamPanelProps {
  /** Chamado após salvar, para a tela hospedeira invalidar o que depende da equipe. */
  onSaved?: () => void;
  /** Renderiza os botões de ação (usar false quando o dialog já tem footer próprio). */
  showActions?: boolean;
  className?: string;
}

export function SectorTeamPanel({ onSaved, showActions = true, className }: SectorTeamPanelProps) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const firstPendingRef = useRef<HTMLInputElement | null>(null);
  const [focado, setFocado] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["sector-team"],
    queryFn: listSectorTeam,
  });

  // Draft parte do ajuste manual salvo (vazio = segue o RH).
  useEffect(() => {
    if (!rows) return;
    setDraft(Object.fromEntries(rows.map((r) => [r.sector, r.override == null ? "" : String(r.override)])));
  }, [rows]);

  // R17: foco no primeiro setor pendente ao abrir.
  useEffect(() => {
    if (!focado && firstPendingRef.current) {
      firstPendingRef.current.focus();
      setFocado(true);
    }
  }, [rows, focado]);

  const pendentes = useMemo(() => (rows ?? []).filter((r) => r.origem === "nao_informado"), [rows]);

  const salvar = useMutation({
    mutationFn: async () => {
      const changes: Record<string, number | null> = {};
      for (const r of rows ?? []) {
        const d = draft[r.sector];
        if (d === undefined) continue;
        const parsed = d.trim() === "" ? null : Number(d.replace(",", "."));
        assertHeadcount(parsed);
        if (parsed !== r.override) changes[r.sector] = parsed;
      }
      if (Object.keys(changes).length === 0) return 0;
      return await updateSectorHeadcounts(changes);
    },
    onSuccess: (n) => {
      toast.success(n > 0 ? `Equipe atualizada (${n} setor${n === 1 ? "" : "es"})` : "Nada pra salvar");
      onSaved?.();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["sector-team"] });
      qc.invalidateQueries({ queryKey: ["sector-headcount"] });
      qc.invalidateQueries({ queryKey: ["model-productivity"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando equipe…
      </div>
    );
  }

  let pendenteVisto = false;

  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-xs text-muted-foreground">
        O número vem dos funcionários cadastrados no RH. Preencha à mão só onde o RH não cobre
        (terceirizado, reforço) — deixe vazio para voltar a seguir o RH.
      </p>

      {pendentes.length > 0 && (
        <div className="rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
          {pendentes.length} setor{pendentes.length === 1 ? "" : "es"} sem equipe:{" "}
          <b>{pendentes.map((p) => p.sector).join(", ")}</b> — fica fora do cálculo até ser informado.
        </div>
      )}

      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto -mx-1 px-1">
        {(rows ?? []).map((r) => {
          const isPendente = r.origem === "nao_informado";
          const ref = isPendente && !pendenteVisto ? (pendenteVisto = true, firstPendingRef) : undefined;
          const divergeRh = r.override != null && r.rh_count > 0 && r.override !== r.rh_count;
          return (
            <div
              key={r.sector}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 min-h-11",
                isPendente && "bg-primary/5",
              )}
            >
              <div className="min-w-[104px] flex-1">
                <span className="text-sm">{r.sector}</span>
                {divergeRh && (
                  <span className="block text-[11px] text-muted-foreground font-mono">
                    RH: {r.rh_count} · você usa {formatNumber(r.override ?? 0, (r.override ?? 0) % 1 ? 1 : 0)}
                  </span>
                )}
                {!divergeRh && r.rh_count > 0 && (
                  <span className="block text-[11px] text-muted-foreground font-mono">
                    RH: {r.rh_count} funcionário{r.rh_count === 1 ? "" : "s"}
                  </span>
                )}
                {r.rh_count === 0 && (
                  <span className="block text-[11px] text-muted-foreground font-mono">RH: ninguém</span>
                )}
              </div>
              <OrigemBadge origem={r.origem} />
              {r.rh_count > 0 && (draft[r.sector] ?? "") !== String(r.rh_count) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 px-2 text-[11px]"
                  onClick={() => setDraft((d) => ({ ...d, [r.sector]: String(r.rh_count) }))}
                  title={`Usar os ${r.rh_count} funcionários do RH`}
                >
                  <ArrowsClockwise className="h-3.5 w-3.5 mr-1" /> RH: {r.rh_count}
                </Button>
              )}
              <div className="flex items-center gap-1.5">
                <Input
                  ref={ref}
                  type="text"
                  inputMode="decimal"
                  aria-label={`Equipe de ${r.sector} (pessoas)`}
                  placeholder={r.rh_count > 0 ? String(r.rh_count) : "—"}
                  className={cn("h-11 w-20 text-right font-mono", isPendente && "border-primary")}
                  value={draft[r.sector] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.sector]: e.target.value }))}
                />
                <span className="text-[11px] text-muted-foreground w-12">pessoas</span>
              </div>
            </div>
          );
        })}
      </div>

      {showActions && (
        <div className="flex justify-end">
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending} className="h-11">
            {salvar.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <UsersThree className="h-4 w-4 mr-2" />
            )}
            Salvar equipe
          </Button>
        </div>
      )}
    </div>
  );
}

/** Permite que a tela hospedeira dispare o submit do painel pelo próprio footer. */
export function useSectorTeamSave() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["sector-team"] });
    qc.invalidateQueries({ queryKey: ["model-productivity"] });
  };
}
