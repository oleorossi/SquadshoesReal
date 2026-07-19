// Produtividade de cada pessoa do setor (specs/equipe-e-capacidade-fonte-unica.md,
// R19/R22/R23/R25/R27).
//
// O número vem da Chamada do Dia quando existe lançamento; onde não existe, o dono
// digita a média da pessoa aqui. A capacidade do setor é a SOMA das pessoas, e a
// tela mostra a composição — não um número solto.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotch as Loader2 } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatNumber } from "@/lib/utils";
import { getSectorMeasuredCapacity, upsertEmployeeProductivity } from "@/services/capacityService";
import type { SectorMemberProductivity } from "@/types/capacity";

const FONTE_LABEL: Record<SectorMemberProductivity["fonte"], string> = {
  informado: "informado",
  chamada: "chamada do dia",
  chamada_historico: "chamada (histórico)",
  estimado_media: "estimado pela média",
  nao_medido: "sem medição",
};

function FonteBadge({ fonte }: { fonte: SectorMemberProductivity["fonte"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-mono uppercase border-transparent shrink-0",
        (fonte === "chamada" || fonte === "chamada_historico") && "bg-green-500/10 text-green-600",
        fonte === "informado" && "bg-blue-500/10 text-blue-600",
        fonte === "estimado_media" && "bg-amber-500/10 text-amber-600",
        fonte === "nao_medido" && "bg-muted text-muted-foreground",
      )}
    >
      {FONTE_LABEL[fonte]}
    </Badge>
  );
}

export function SectorPeopleProductivity({ sector }: { sector: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["sector-measured-capacity", sector],
    queryFn: () => getSectorMeasuredCapacity(sector),
  });

  useEffect(() => {
    if (!data) return;
    setDraft(
      Object.fromEntries(
        data.membros.map((m) => [
          m.employee_id,
          m.fonte === "informado" && m.pares_dia != null ? String(m.pares_dia) : "",
        ]),
      ),
    );
  }, [data]);

  const salvar = useMutation({
    mutationFn: async (m: SectorMemberProductivity) => {
      const raw = draft[m.employee_id] ?? "";
      const valor = raw.trim() === "" ? null : Number(raw.replace(",", "."));
      await upsertEmployeeProductivity({
        employeeId: m.employee_id,
        sector,
        pairsPerDay: valor,
        allocationFraction: m.fracao,
      });
    },
    onSuccess: () => {
      toast.success("Produtividade atualizada");
      qc.invalidateQueries({ queryKey: ["sector-measured-capacity", sector] });
      qc.invalidateQueries({ queryKey: ["model-productivity"] });
      qc.invalidateQueries({ queryKey: ["planning-capacity-comparison"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando pessoas…
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-red-600 py-2">
        Não foi possível carregar as pessoas deste setor: {(error as Error).message}
      </p>
    );
  }
  if (!data || data.membros.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        Nenhum funcionário ativo cadastrado neste setor no RH.
      </p>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        <span className="font-mono tabular-nums">
          <b>{data.pessoas_total}</b> pessoa{data.pessoas_total === 1 ? "" : "s"}
          {data.pairs_per_day != null && (
            <>
              {" · "}
              <b>{formatNumber(data.pairs_per_day, 0)}</b> pares/dia
            </>
          )}
          {data.min_person_per_pair != null && (
            <span className="text-muted-foreground">
              {" · "}
              {formatNumber(data.min_person_per_pair, 2)} min/par
            </span>
          )}
        </span>
        {data.cobertura === "parcial" && (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-transparent text-[10px]">
            parcial · {data.pessoas_medidas} de {data.pessoas_total} medidos
          </Badge>
        )}
        {data.cobertura === "nenhum" && (
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px]">
            ninguém medido — setor não dimensionado
          </Badge>
        )}
      </div>

      {data.membros.map((m) => (
        <div key={m.employee_id} className="flex flex-wrap items-center gap-2 min-h-11">
          <span className="text-sm flex-1 min-w-[120px]">
            {m.nome}
            {m.fracao < 1 && (
              <span className="text-[11px] text-muted-foreground font-mono">
                {" "}
                · {formatNumber(m.fracao * 100, 0)}% da jornada
              </span>
            )}
            {m.dias_medidos > 0 && (
              <span className="block text-[11px] text-muted-foreground font-mono">
                {formatNumber(m.pares_dia ?? 0, 0)} pares/dia · {m.dias_medidos} dia
                {m.dias_medidos === 1 ? "" : "s"} lançado{m.dias_medidos === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <FonteBadge fonte={m.fonte} />
          <div className="flex items-center gap-1.5">
            <Input
              type="text"
              inputMode="decimal"
              aria-label={`Produtividade de ${m.nome} em ${sector} (pares por dia)`}
              placeholder={m.pares_dia != null ? formatNumber(m.pares_dia, 0) : "—"}
              className="h-11 w-24 text-right font-mono"
              value={draft[m.employee_id] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [m.employee_id]: e.target.value }))}
              onBlur={() => {
                const raw = draft[m.employee_id] ?? "";
                const atual = m.fonte === "informado" && m.pares_dia != null ? String(m.pares_dia) : "";
                if (raw !== atual) salvar.mutate(m);
              }}
            />
            <span className="text-[11px] text-muted-foreground w-14">pares/dia</span>
          </div>
        </div>
      ))}

      <p className="text-[11px] text-muted-foreground">
        Deixe vazio para usar a média da Chamada do Dia. Quem ainda não foi medido entra pela média
        dos colegas do setor, marcado como estimativa.
      </p>
    </div>
  );
}
