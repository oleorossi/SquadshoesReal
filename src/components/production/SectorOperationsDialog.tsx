// Etapas que compõem um setor numa ficha (ex.: Costura Cabedal × Costura Palmilha).
//
// O fluxo de produção trata "Costura" como um estágio só — o Kanban, a
// programação diária e a terceirização dependem disso. Mas o CUSTO precisa
// distinguir as duas etapas, porque têm tempos diferentes e nem todo modelo faz
// as duas. Este dialog abre o setor nas operações que o compõem: cada uma com
// seu tempo por par, seu custo-hora e sua parcela de mão de obra.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotch as Loader2, Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { getSheetSectorOperations, setSheetSectorOperation } from "@/services/capacityService";

/** Etapas sugeridas por setor — o usuário pode nomear qualquer outra. */
const ETAPAS_SUGERIDAS: Record<string, string[]> = {
  Costura: ["Costura Cabedal", "Costura Palmilha"],
};

export interface SectorOperationsDialogProps {
  sheetId: string | null;
  sheetName: string;
  sector: string;
  onClose: () => void;
}

export function SectorOperationsDialog({
  sheetId,
  sheetName,
  sector,
  onClose,
}: SectorOperationsDialogProps) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [novaEtapa, setNovaEtapa] = useState("");
  const [novoTempo, setNovoTempo] = useState("");

  const { data: ops, isLoading, error } = useQuery({
    queryKey: ["sheet-sector-operations", sheetId, sector],
    queryFn: () => getSheetSectorOperations(sheetId!, sector),
    enabled: !!sheetId,
  });

  useEffect(() => {
    if (!ops) return;
    setDraft(Object.fromEntries(ops.map((o) => [o.id, String(o.minutos)])));
  }, [ops]);

  const salvar = useMutation({
    mutationFn: async (p: { operacao: string; minutos: number }) => {
      return await setSheetSectorOperation({
        sheetId: sheetId!,
        sector,
        operacao: p.operacao,
        minutos: p.minutos,
      });
    },
    onSuccess: () => {
      toast.success("Etapa atualizada — o custo do modelo já reflete");
      setNovaEtapa("");
      setNovoTempo("");
      qc.invalidateQueries({ queryKey: ["sheet-sector-operations"] });
      qc.invalidateQueries({ queryKey: ["model-productivity"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sugeridas = (ETAPAS_SUGERIDAS[sector] ?? []).filter(
    (s) => !(ops ?? []).some((o) => o.operacao.toLowerCase() === s.toLowerCase()),
  );

  const totalMin = (ops ?? []).filter((o) => o.ativa).reduce((a, o) => a + o.minutos, 0);
  const totalMo = (ops ?? []).filter((o) => o.ativa).reduce((a, o) => a + o.mo_por_par, 0);

  return (
    <Dialog open={!!sheetId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {sector} — {sheetName}
          </DialogTitle>
          <DialogDescription>
            Etapas que compõem este setor. Cada uma tem seu tempo e entra no custo por par. No
            fluxo de produção elas continuam aparecendo como um bloco só.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando etapas…
          </div>
        ) : error ? (
          <p className="text-xs text-red-600 py-2">
            Não foi possível carregar as etapas: {(error as Error).message}
          </p>
        ) : (
          <div className="space-y-3">
            {(ops ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma etapa lançada neste setor para esta ficha.
              </p>
            )}

            {(ops ?? []).map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 min-h-11">
                <div className="flex-1 min-w-[120px]">
                  <span className={cn("text-sm", !o.ativa && "text-muted-foreground line-through")}>
                    {o.operacao}
                  </span>
                  <span className="block text-[11px] text-muted-foreground font-mono">
                    {formatCurrency(o.custo_hora)}/h · {formatCurrency(o.mo_por_par)}/par
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-mono uppercase border-transparent shrink-0",
                    o.time_source === "manual" || o.time_source === "cronoanalise"
                      ? "bg-green-500/10 text-green-600"
                      : "bg-amber-500/10 text-amber-600",
                  )}
                >
                  {o.time_source}
                </Badge>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Tempo de ${o.operacao} em minutos por par`}
                    className="h-11 w-20 text-right font-mono"
                    value={draft[o.id] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [o.id]: e.target.value }))}
                    onBlur={() => {
                      const raw = (draft[o.id] ?? "").replace(",", ".");
                      const v = Number(raw);
                      if (raw !== String(o.minutos) && Number.isFinite(v) && v >= 0) {
                        salvar.mutate({ operacao: o.operacao, minutos: v });
                      }
                    }}
                  />
                  <span className="text-[11px] text-muted-foreground w-12">min/par</span>
                </div>
              </div>
            ))}

            {(ops ?? []).length > 0 && (
              <div className="flex items-baseline gap-2 border-t border-border pt-2 text-xs font-mono tabular-nums">
                <span className="text-muted-foreground">Total do setor</span>
                <span className="ml-auto">
                  {formatNumber(totalMin, 2)} min/par · <b>{formatCurrency(totalMo)}/par</b>
                </span>
              </div>
            )}

            {/* Adicionar etapa */}
            <div className="space-y-2 border-t border-border pt-3">
              {sugeridas.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sugeridas.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 text-xs"
                      onClick={() => setNovaEtapa(s)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> {s}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Nome da etapa"
                  className="h-11 flex-1 min-w-[140px]"
                  value={novaEtapa}
                  onChange={(e) => setNovaEtapa(e.target.value)}
                />
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="min/par"
                  aria-label="Tempo da nova etapa em minutos por par"
                  className="h-11 w-24 text-right font-mono"
                  value={novoTempo}
                  onChange={(e) => setNovoTempo(e.target.value)}
                />
                <Button
                  className="h-11"
                  disabled={!novaEtapa.trim() || !novoTempo.trim() || salvar.isPending}
                  onClick={() => {
                    const v = Number(novoTempo.replace(",", "."));
                    if (!Number.isFinite(v) || v < 0) {
                      toast.error("Informe o tempo em minutos por par");
                      return;
                    }
                    salvar.mutate({ operacao: novaEtapa.trim(), minutos: v });
                  }}
                >
                  {salvar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Adicionar
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Tempo 0 desativa a etapa sem apagar o histórico.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
