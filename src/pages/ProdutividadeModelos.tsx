// Produtividade por Modelo — engine de capacidade (specs/produtividade-por-modelo.md).
// THROUGHPUT em regime permanente (pares/dia da equipe atual, gargalo, custo/par
// pelos métodos custo-minuto e gargalo). NÃO confundir com lead time/agenda das
// ondas/production engine — são perguntas diferentes sobre os mesmos setores.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Gauge,
  UsersThree,
  Sliders,
  FloppyDisk,
  ClockCounterClockwise,
  PencilSimple,
  ListBullets,
  Plus,
  X,
  Trash,
  MagnifyingGlass,
  CircleNotch as Loader2,
  Warning as AlertTriangle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { SectorTeamPanel } from "@/components/production/SectorTeamPanel";
import { SectorOperationsDialog } from "@/components/production/SectorOperationsDialog";
import {
  deleteProductivitySnapshot,
  getCapacityParameters,
  getModelProductivity,
  listActiveSheets,
  listProductivitySnapshots,
  listSectorTeam,
  saveProductivitySnapshot,
  setModelSectorCapacity,
  updateCapacityParameters,
} from "@/services/capacityService";
import type { ModelProductivity, SectorProductivity } from "@/types/capacity";

const MAX_MODELOS = 8;

/** Chip de proveniência do tempo (R16): de onde veio o min/par do setor. */
function SourceChip({ sector }: { sector: SectorProductivity }) {
  if (sector.minutes_source === "faltando") {
    return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-transparent text-[10px]">sem tempo</Badge>;
  }
  if (sector.minutes_source === "medido") {
    const cob = sector.cobertura_medicao === "parcial"
      ? ` · parcial ${sector.pessoas_medidas}/${sector.pessoas_total}`
      : "";
    return (
      <Badge
        variant="outline"
        className="bg-green-500/10 text-green-600 border-transparent text-[10px]"
        title={`Soma da produtividade das pessoas do setor${cob ? " (cobertura parcial — extrapolado pela média)" : ""}`}
      >
        medido{cob}
      </Badge>
    );
  }
  if (sector.minutes_source === "default") {
    return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-transparent text-[10px]">padrão</Badge>;
  }
  const detalhe = sector.time_sources.includes("cronoanalise")
    ? "cronoanálise"
    : sector.time_sources.includes("manual")
      ? "manual"
      : "capacidade";
  return (
    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-transparent text-[10px]" title={`Tempo da própria ficha (${detalhe})`}>
      ficha · {detalhe}
    </Badge>
  );
}

export default function ProdutividadeModelos() {
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [teamOpen, setTeamOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [historySheet, setHistorySheet] = useState<{ id: string; name: string } | null>(null);
  const [paramsDraft, setParamsDraft] = useState<Record<string, string>>({});
  // Edição de capacidade POR MODELO × SETOR (R19): pares/dia → min/par.
  const [capEdit, setCapEdit] = useState<{
    sheetId: string;
    sheetName: string;
    sectorKey: string;
    sectorLabel: string;
    headcount: number | null;
    hourlyRate: number;
    currentMinutes: number | null;
  } | null>(null);
  const [capDraft, setCapDraft] = useState("");
  // Etapas dentro de um setor (Costura Cabedal × Costura Palmilha): o fluxo trata
  // o setor como bloco, mas o custo distingue as etapas.
  const [opsEdit, setOpsEdit] = useState<{ sheetId: string; sheetName: string; sector: string } | null>(null);

  const { data: sheetOptions } = useQuery({
    queryKey: ["capacity-sheet-options"],
    queryFn: listActiveSheets,
    staleTime: 5 * 60_000,
  });

  const sortedIds = useMemo(() => [...selectedIds].sort(), [selectedIds]);
  const { data: result, isLoading: calcLoading, error: calcError } = useQuery({
    queryKey: ["model-productivity", sortedIds],
    queryFn: () => getModelProductivity(selectedIds),
    enabled: selectedIds.length > 0,
  });

  const { data: params } = useQuery({
    queryKey: ["capacity-parameters"],
    queryFn: getCapacityParameters,
  });
  const { data: teamRows } = useQuery({
    queryKey: ["sector-team"],
    queryFn: listSectorTeam,
  });
  const { data: snapshots, isLoading: snapsLoading } = useQuery({
    queryKey: ["productivity-snapshots", historySheet?.id],
    queryFn: () => listProductivitySnapshots(historySheet!.id),
    enabled: !!historySheet,
  });

  const invalidateCalc = () => {
    qc.invalidateQueries({ queryKey: ["model-productivity"] });
  };

  const saveSnapshotMutation = useMutation({
    mutationFn: saveProductivitySnapshot,
    onSuccess: () => {
      toast.success("Custos salvos no histórico da referência");
      qc.invalidateQueries({ queryKey: ["productivity-snapshots"] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar: " + e.message),
  });

  const deleteSnapshotMutation = useMutation({
    mutationFn: deleteProductivitySnapshot,
    onSuccess: () => {
      toast.success("Snapshot removido");
      qc.invalidateQueries({ queryKey: ["productivity-snapshots"] });
    },
    onError: (e: Error) => toast.error("Não foi possível remover: " + e.message),
  });

  const setCapacityMutation = useMutation({
    mutationFn: async () => {
      if (!capEdit) return null;
      const pairs = Number(capDraft.replace(",", "."));
      return await setModelSectorCapacity(capEdit.sheetId, capEdit.sectorLabel, pairs);
    },
    onSuccess: (r) => {
      if (!r) return;
      toast.success(
        `${r.sector}: ${r.pairs_per_day} pares/dia → ${formatNumber(r.minutes_per_pair, 2)} min/par (MO ${formatCurrency(r.mo_per_pair)}/par)`,
      );
      setCapEdit(null);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => invalidateCalc(),
  });

  const saveParamsMutation = useMutation({
    mutationFn: async () => {
      const patch: Record<string, number> = {};
      for (const key of ["journey_minutes", "efficiency_pct", "working_days_per_month"]) {
        const draft = paramsDraft[key];
        if (draft !== undefined && draft.trim() !== "") {
          patch[key] = Number(draft.replace(",", "."));
        }
      }
      await updateCapacityParameters(patch);
      return Object.keys(patch).length;
    },
    onSuccess: (n) => {
      toast.success(n > 0 ? "Parâmetros atualizados" : "Nada pra salvar — preencha algum valor");
      if (n > 0) setParamsOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["capacity-parameters"] });
      invalidateCalc();
    },
  });

  const models = result?.models ?? [];
  const rankedModels = useMemo(
    () => [...models].filter((m) => !m.incomplete).sort((a, b) => (b.pairs_per_day ?? 0) - (a.pairs_per_day ?? 0)),
    [models],
  );
  const incompleteModels = models.filter((m) => m.incomplete);

  /** União dos setores na ordem canônica de flow_order (setor ausente no 1º
   *  modelo mas presente no 2º entraria no fim sem esta ordenação). */
  const sectorRows = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of models) for (const s of m.sectors) if (!seen.has(s.sector_key)) seen.set(s.sector_key, s.label);
    const ordem = new Map((teamRows ?? []).map((r) => [r.sector, r.flow_order]));
    return [...seen.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => (ordem.get(a.label) ?? 999) - (ordem.get(b.label) ?? 999));
  }, [models, teamRows]);

  const nomePorId = useMemo(() => new Map((sheetOptions ?? []).map((s) => [s.id, s.name])), [sheetOptions]);

  /** R16: avisos que IMPEDEM o número aparecem sempre, no topo, com ação. */
  const undimAvisos = useMemo(() => {
    const set = new Set<string>();
    for (const m of models) {
      for (const u of m.undimensioned ?? []) {
        set.add(`${u} está sem equipe informada — fora do cálculo de capacidade`);
      }
    }
    return [...set];
  }, [models]);

  const allWarnings = useMemo(() => {
    const set = new Set<string>();
    for (const id of result?.missing_sheet_ids ?? []) {
      set.add(`${nomePorId.get(id) ?? id.slice(0, 8)}: ficha removida ou indisponível — retirada do comparativo`);
    }
    for (const m of models) {
      for (const w of m.warnings) {
        if (w.includes("sem equipe cadastrada")) continue; // já está no bloco do topo
        set.add(`${m.name}: ${w}`);
      }
    }
    return [...set];
  }, [models, result?.missing_sheet_ids, nomePorId]);

  const teamTotal = (teamRows ?? []).reduce((acc, r) => acc + (r.valor ?? 0), 0);
  const setoresPendentes = (teamRows ?? []).filter((r) => r.origem === "nao_informado").length;

  const toggleSheet = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_MODELOS) {
        toast.warning(`Compare até ${MAX_MODELOS} modelos por vez`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const filteredOptions = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const terms = norm(pickerSearch).split(/\s+/).filter(Boolean);
    return (sheetOptions ?? []).filter((s) => {
      const alvo = norm(`${s.name} ${s.shoe_category ?? ""}`);
      return terms.every((t) => alvo.includes(t));
    });
  }, [sheetOptions, pickerSearch]);

  return (
    <div className="space-y-5 p-4 md:p-6 max-w-[1220px] mx-auto">
      {/* Header canônico do sistema. Os parâmetros vigentes viraram o `meta`
          (mono, números em <strong>) — é a mesma linha de antes, agora colada
          no título em vez de solta abaixo da toolbar. */}
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · PRODUTIVIDADE"
        title="Produtividade por Modelo"
        description="Gargalo, pares/dia da equipe atual e custo por par (custo-minuto × gargalo) — direto da ficha técnica."
        meta={
          params ? (
            <>
              JORNADA <strong>{formatNumber(params.journey_minutes / 60, 1)}H</strong>
              {"  ·  "}EFICIÊNCIA <strong>{formatNumber(params.efficiency_pct, 0)}%</strong>
              {"  ·  "}DIAS ÚTEIS <strong>{formatNumber(params.working_days_per_month, 0)}</strong>
              {result?.params?.overhead_monthly_total != null && (
                <>
                  {"  ·  "}FIXO MENSAL <strong>{formatCurrency(result.params.overhead_monthly_total)}</strong>
                </>
              )}
            </>
          ) : undefined
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => {
                setParamsDraft({
                  journey_minutes: String(params?.journey_minutes ?? ""),
                  efficiency_pct: String(params?.efficiency_pct ?? ""),
                  working_days_per_month: String(params?.working_days_per_month ?? ""),
                });
                setParamsOpen(true);
              }}
            >
              <Sliders className="h-4 w-4 mr-1.5" /> Parâmetros
            </Button>
            <Button
              size="sm"
              className="h-9"
              onClick={() => setTeamOpen(true)}
            >
              <UsersThree className="h-4 w-4 mr-1.5" /> Equipe
              {setoresPendentes > 0
                ? ` (${setoresPendentes} pendente${setoresPendentes === 1 ? "" : "s"})`
                : teamTotal > 0
                  ? ` (${formatNumber(teamTotal, teamTotal % 1 ? 1 : 0)})`
                  : ""}
            </Button>
          </>
        }
      />

      {/* Toolbar: seleção de fichas (as ações da página foram pro header) */}
      <div className="flex flex-wrap items-center gap-2">
        {selectedIds.map((id) => (
          <Button key={id} variant="outline" size="sm" className="h-9" onClick={() => toggleSheet(id)}>
            {nomePorId.get(id) ?? id.slice(0, 8)}
            <X className="h-3.5 w-3.5 ml-1.5 text-muted-foreground" />
          </Button>
        ))}
        <Button variant="outline" size="sm" className="h-9 border-dashed" onClick={() => setPickerOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Adicionar ficha
        </Button>
      </div>

      {selectedIds.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={Gauge}
            title="Selecione fichas pra comparar"
            description="Escolha 1 a 8 referências ativas — o motor calcula gargalo, pares/dia e custo por par com a equipe atual."
            action={
              <Button onClick={() => setPickerOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Adicionar ficha
              </Button>
            }
          />
        </div>
      ) : calcLoading ? (
        <div className="flex items-center gap-2 py-16 justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Calculando produtividade…
        </div>
      ) : calcError ? (
        <div className="rounded-md bg-red-500/10 text-red-600 px-4 py-3 text-sm">
          Falha no cálculo: {(calcError as Error).message}
        </div>
      ) : (
        <>
          {/* Ranking */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rankedModels.map((m) => (
              <ModelCard
                key={m.sheet_id}
                model={m}
                onSave={() => saveSnapshotMutation.mutate(m.sheet_id)}
                saving={saveSnapshotMutation.isPending && saveSnapshotMutation.variables === m.sheet_id}
                onHistory={() => setHistorySheet({ id: m.sheet_id, name: m.name })}
              />
            ))}
            {incompleteModels.map((m) => (
              <div key={m.sheet_id} className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="display text-lg uppercase">{m.name}</span>
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-transparent text-[10px]">incompleta</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Nenhum setor tem tempo cadastrado — preencha as operações na ficha técnica ou os padrões da categoria.
                </p>
              </div>
            ))}
          </div>

          {/* Matriz por setor */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <h2 className="display text-sm uppercase tracking-wide">Capacidade por setor · pares/dia</h2>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-transparent text-[10px]">ficha</Badge>
                <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-transparent text-[10px]">última ref</Badge>
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-transparent text-[10px]">padrão</Badge>
                <Badge variant="outline" className="bg-red-500/10 text-red-600 border-transparent text-[10px]">sem tempo</Badge>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-semibold">Setor · equipe</th>
                    {models.map((m) => (
                      <th key={m.sheet_id} className="text-left py-2 px-3 font-semibold border-l border-border/60">{m.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sectorRows.map((row) => (
                    <tr key={row.key} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="font-medium">{row.label}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {(() => {
                            const sec = models.flatMap((m) => m.sectors).find((s) => s.sector_key === row.key);
                            const hc = sec?.headcount;
                            if (hc == null) return "sem equipe";
                            const origem = sec?.team_source === "rh" ? " · do RH" : sec?.team_source === "manual" ? " · manual" : "";
                            return `${formatNumber(hc, hc % 1 ? 1 : 0)} pessoa${hc === 1 ? "" : "s"}${origem}`;
                          })()}
                        </span>
                      </td>
                      {models.map((m) => {
                        const s = m.sectors.find((x) => x.sector_key === row.key);
                        if (!s) return <td key={m.sheet_id} className="py-2 px-3 border-l border-border/60 text-muted-foreground">—</td>;
                        return (
                          <td
                            key={m.sheet_id}
                            className={cn(
                              "py-2 px-3 border-l border-border/60 align-top",
                              s.is_bottleneck && "bg-primary/10",
                            )}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs tabular-nums">
                                {s.minutes_per_pair == null ? "—" : `${formatNumber(s.minutes_per_pair, 2)} min`}
                              </span>
                              <SourceChip sector={s} />
                              <span className={cn("font-mono text-xs tabular-nums ml-auto", s.is_bottleneck ? "text-primary font-semibold" : "text-muted-foreground")}>
                                {s.nao_dimensionado
                                  ? "sem equipe"
                                  : s.pairs_per_day == null
                                    ? ""
                                    : `${s.pairs_per_day} p/d`}
                              </span>
                              <button
                                type="button"
                                className="text-muted-foreground/50 hover:text-foreground shrink-0"
                                title={`Editar capacidade — ${s.label} · ${m.name}`}
                                aria-label={`Editar capacidade de ${s.label} do modelo ${m.name}`}
                                onClick={() => {
                                  // R11: prefill = o mesmo número exibido na célula.
                                  setCapDraft(s.pairs_per_day != null ? String(s.pairs_per_day) : "");
                                  setCapEdit({
                                    sheetId: m.sheet_id,
                                    sheetName: m.name,
                                    sectorKey: s.sector_key,
                                    sectorLabel: s.label,
                                    headcount: s.headcount,
                                    hourlyRate: s.hourly_rate,
                                    currentMinutes: s.minutes_per_pair,
                                  });
                                }}
                              >
                                <PencilSimple className="h-3.5 w-3.5" />
                              </button>
                              {/* Etapas do setor (ex.: Costura Cabedal × Palmilha):
                                  o fluxo trata o setor como bloco, o custo distingue. */}
                              <button
                                type="button"
                                className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
                                aria-label={`Etapas de ${s.label} em ${m.name}`}
                                title="Ver e editar as etapas deste setor"
                                onClick={() =>
                                  setOpsEdit({ sheetId: m.sheet_id, sheetName: m.name, sector: s.label })
                                }
                              >
                                <ListBullets className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border">
                    <td className="py-2 pr-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Total min/par · pares/dia</td>
                    {models.map((m) => {
                      const totalMin = m.sectors.reduce((acc, s) => acc + (s.minutes_per_pair ?? 0), 0);
                      return (
                        <td key={m.sheet_id} className="py-2 px-3 border-l border-border/60 font-mono text-xs tabular-nums">
                          {formatNumber(totalMin, 2)} · <b>{m.pairs_per_day ?? "—"} p/d</b>
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Custos */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="display text-sm uppercase tracking-wide">Custo por par · dois métodos</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-semibold">Modelo</th>
                    <th className="text-right py-2 px-3 font-semibold">MO (custo-minuto)</th>
                    <th className="text-right py-2 px-3 font-semibold">Fixo/par</th>
                    <th className="text-right py-2 px-3 font-semibold">Total custo-minuto</th>
                    <th className="text-right py-2 px-3 font-semibold border-l border-border/60">Custo gargalo</th>
                    <th className="text-right py-2 pl-3 font-semibold">Δ ociosidade</th>
                  </tr>
                </thead>
                <tbody>
                  {models.filter((m) => !m.incomplete).map((m) => {
                    const delta =
                      m.costs.bottleneck_cost_per_pair != null && m.costs.total_cost_minute_method != null
                        ? m.costs.bottleneck_cost_per_pair - m.costs.total_cost_minute_method
                        : null;
                    return (
                      <tr key={m.sheet_id} className="border-b border-border/60 last:border-0 font-mono text-xs tabular-nums">
                        <td className="py-2 pr-3 font-sans text-sm font-medium">{m.name}</td>
                        <td className="py-2 px-3 text-right">{m.costs.mo_per_pair == null ? "—" : formatCurrency(m.costs.mo_per_pair)}</td>
                        <td className="py-2 px-3 text-right">{m.costs.overhead_per_pair == null ? "—" : formatCurrency(m.costs.overhead_per_pair)}</td>
                        <td className="py-2 px-3 text-right font-semibold">
                          {m.costs.total_cost_minute_method == null ? "—" : formatCurrency(m.costs.total_cost_minute_method)}
                        </td>
                        <td className="py-2 px-3 text-right border-l border-border/60">
                          {m.costs.bottleneck_cost_per_pair == null ? "—" : formatCurrency(m.costs.bottleneck_cost_per_pair)}
                        </td>
                        <td className={cn("py-2 pl-3 text-right", delta != null && delta > 0 ? "text-amber-600" : "text-muted-foreground")}>
                          {delta == null ? "—" : `${delta < 0 ? "− " : "+ "}${formatCurrency(Math.abs(delta))}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground border-l-2 border-border pl-3 max-w-3xl">
              <b>Custo-minuto</b> = Σ(min/par × custo-hora ÷ 60) + fixo rateado pela meta mensal — mesma fórmula do custeio real
              (order_costs). <b>Gargalo</b> = custo diário (equipe + fixo) ÷ pares/dia no gargalo — a diferença é o custo da
              ociosidade da equipe no mix atual.
            </p>
          </div>

          {/* Avisos */}
          {undimAvisos.length > 0 && (
            <div className="space-y-1.5">
              {undimAvisos.map((w) => (
                <div key={w} className="flex items-start gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                  <span className="flex-1">{w}</span>
                  <button
                    type="button"
                    className="text-primary underline shrink-0 font-medium"
                    onClick={() => setTeamOpen(true)}
                  >
                    Informar equipe
                  </button>
                </div>
              ))}
            </div>
          )}

          {allWarnings.length > 0 && (
            <div className="space-y-1.5">
              {allWarnings.slice(0, 8).map((w) => (
                <div key={w} className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                  <span>{w}</span>
                </div>
              ))}
              {allWarnings.length > 8 && (
                <p className="text-[11px] text-muted-foreground pl-1">
                  + {allWarnings.length - 8} aviso(s) — detalhes completos em Diagnóstico → Consistência de capacidade.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Dialog: seletor de fichas */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar fichas</DialogTitle>
            <DialogDescription>Compare até {MAX_MODELOS} referências ativas.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <MagnifyingGlass className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Buscar por nome ou categoria…"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-0.5">
            {filteredOptions.map((s) => {
              const active = selectedIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSheet(s.id)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-left hover:bg-muted/40",
                    active && "bg-primary/10 text-primary font-medium",
                  )}
                >
                  <span>{s.name}</span>
                  <span className="text-[11px] text-muted-foreground">{s.shoe_category ?? ""}</span>
                </button>
              );
            })}
            {filteredOptions.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma ficha encontrada.</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setPickerOpen(false)}>Concluir ({selectedIds.length})</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SectorOperationsDialog
        sheetId={opsEdit?.sheetId ?? null}
        sheetName={opsEdit?.sheetName ?? ""}
        sector={opsEdit?.sector ?? ""}
        onClose={() => setOpsEdit(null)}
      />

      {/* Dialog: equipe por setor — painel ÚNICO compartilhado com Produção → Setores (R1) */}
      <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Equipe por setor</DialogTitle>
            <DialogDescription>
              Quantas pessoas trabalham em cada setor. O mesmo painel está em Produção → Setores.
            </DialogDescription>
          </DialogHeader>
          <SectorTeamPanel onSaved={() => setTeamOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Dialog: parâmetros */}
      <Dialog open={paramsOpen} onOpenChange={setParamsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Parâmetros de capacidade</DialogTitle>
            <DialogDescription>
              Valem pra fábrica toda. Jornada canônica = escala default (9h), a mesma da folha.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {[
              { key: "journey_minutes", label: "Jornada", unidade: "min/dia" },
              { key: "efficiency_pct", label: "Eficiência", unidade: "%" },
              { key: "working_days_per_month", label: "Dias úteis", unidade: "dias/mês" },
            ].map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3">
                <span className="text-sm">{f.label}</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="text"
                    inputMode="decimal"
                    aria-label={`${f.label} (${f.unidade})`}
                    className="h-8 w-24 text-right font-mono"
                    value={paramsDraft[f.key] ?? ""}
                    onChange={(e) => setParamsDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                  <span className="text-[11px] text-muted-foreground w-14">{f.unidade}</span>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParamsOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveParamsMutation.mutate()} disabled={saveParamsMutation.isPending}>
              {saveParamsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: capacidade do dia por modelo × setor (R19) */}
      <Dialog open={!!capEdit} onOpenChange={(open) => !open && setCapEdit(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Capacidade do dia — {capEdit?.sectorLabel} · {capEdit?.sheetName}
            </DialogTitle>
            <DialogDescription>
              Quantos pares a equipe atual produz num dia NESTE modelo. Modelo mais difícil rende
              menos pares — e o custo/par sobe sozinho.
            </DialogDescription>
          </DialogHeader>
          {(capEdit?.headcount ?? 0) <= 0 ? (
            <div className="space-y-3">
              <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">
                Cadastre a equipe de {capEdit?.sectorLabel} primeiro — a conversão pares/dia →
                min/par precisa do headcount do setor.
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setCapEdit(null);
                  setTeamOpen(true);
                }}
              >
                <UsersThree className="h-4 w-4 mr-1.5" /> Abrir Equipe
              </Button>
            </div>
          ) : (
            (() => {
              const journey = params?.journey_minutes ?? 540;
              const eff = params?.efficiency_pct ?? 85;
              const hc = capEdit?.headcount ?? 0;
              const rate = capEdit?.hourlyRate ?? 0;
              const pairsNum = Number(capDraft.replace(",", "."));
              const valido = Number.isFinite(pairsNum) && pairsNum > 0;
              const previewMin = valido ? (hc * journey) / pairsNum : null;
              const previewMo = previewMin != null ? (previewMin * rate) / 60 : null;
              const refs = models
                .filter((m) => m.sheet_id !== capEdit?.sheetId)
                .map((m) => ({
                  name: m.name,
                  s: m.sectors.find((x) => x.sector_key === capEdit?.sectorKey),
                }))
                .filter((x) => x.s && (x.s.minutes_per_pair ?? 0) > 0)
                .map((x) => ({
                  name: x.name,
                  pares: Math.round((hc * journey) / (x.s!.minutes_per_pair as number)),
                }));
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">Capacidade neste modelo</span>
                    <div className="flex items-center gap-1.5">
                      <Input
                        autoFocus
                        type="text"
                        inputMode="decimal"
                        aria-label={`Capacidade de ${capEdit?.sectorLabel} no modelo ${capEdit?.sheetName} (pares/dia)`}
                        className="h-9 w-28 text-right font-mono"
                        value={capDraft}
                        onChange={(e) => setCapDraft(e.target.value)}
                      />
                      <span className="text-[11px] text-muted-foreground w-14">pares/dia</span>
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/40 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed tabular-nums">
                    <p>
                      {formatNumber(hc, hc % 1 ? 1 : 0)} pessoa{hc === 1 ? "" : "s"} × {formatNumber(journey, 0)} min ÷{" "}
                      {valido ? formatNumber(pairsNum, 0) : "—"} pares ={" "}
                      <b>{previewMin == null ? "—" : formatNumber(previewMin, 2)} min/par</b>
                    </p>
                    <p>
                      MO custo-minuto: {previewMin == null ? "—" : formatNumber(previewMin, 2)} min ×{" "}
                      {formatCurrency(rate)}/h ÷ 60 ={" "}
                      <b>{previewMo == null ? "—" : formatCurrency(previewMo)}/par</b>
                    </p>
                    <p className="text-muted-foreground">
                      Capacidade informada {valido ? formatNumber(pairsNum, 0) : "—"} p/d — é o que a tela vai
                      exibir. O fator de eficiência ({formatNumber(eff, 0)}%) só vale para setor sem medição,
                      porque o número que você observou já embute a ineficiência real.
                    </p>
                  </div>
                  {refs.length > 0 && (
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p className="font-medium text-foreground">Referência dos outros modelos neste setor:</p>
                      {refs.map((r) => (
                        <p key={r.name} className="font-mono tabular-nums">
                          {r.name}: ~{r.pares} pares/dia
                        </p>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Grava como tempo manual no BOM desta ficha — o custeio dos PVs deste modelo
                    recalcula sozinho, sem alterar o tempo das demais referências.
                  </p>
                </div>
              );
            })()
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCapEdit(null)}>Cancelar</Button>
            <Button
              onClick={() => setCapacityMutation.mutate()}
              disabled={
                setCapacityMutation.isPending ||
                (capEdit?.headcount ?? 0) <= 0 ||
                !(Number(capDraft.replace(",", ".")) > 0)
              }
            >
              {setCapacityMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar capacidade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: histórico de custos salvos */}
      <Dialog open={!!historySheet} onOpenChange={(open) => !open && setHistorySheet(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Histórico de custos — {historySheet?.name}</DialogTitle>
            <DialogDescription>
              Snapshots congelados (corrigir a ficha depois não altera os antigos).
            </DialogDescription>
          </DialogHeader>
          {snapsLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (snapshots ?? []).length === 0 ? (
            <EmptyState
              size="sm"
              icon={ClockCounterClockwise}
              title="Nenhum custo salvo"
              description="Use “Salvar custos” no card do modelo pra congelar o cálculo atual aqui."
            />
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto -mx-1 px-1">
              {(snapshots ?? []).map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-muted-foreground">
                      {new Date(s.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </p>
                    <p className="text-sm">
                      <b>{s.pairs_per_day ?? "—"} p/d</b>
                      <span className="text-muted-foreground"> · gargalo {s.bottleneck_sector ?? "—"}</span>
                    </p>
                  </div>
                  <div className="text-right font-mono text-xs tabular-nums shrink-0">
                    <p>{s.total_cost_minute == null ? "—" : formatCurrency(s.total_cost_minute)} <span className="text-muted-foreground">c-min</span></p>
                    <p>{s.bottleneck_cost_per_pair == null ? "—" : formatCurrency(s.bottleneck_cost_per_pair)} <span className="text-muted-foreground">garg</span></p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-600"
                    onClick={() => deleteSnapshotMutation.mutate(s.id)}
                    title="Remover snapshot"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModelCard({
  model,
  onSave,
  saving,
  onHistory,
}: {
  model: ModelProductivity;
  onSave: () => void;
  saving: boolean;
  onHistory: () => void;
}) {
  const isBest = model.productivity_index === 100;
  return (
    <div className={cn("rounded-lg border bg-card p-4 space-y-3", isBest ? "border-foreground" : "border-border")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="display text-xl uppercase truncate">{model.name}</span>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {model.shoe_category ?? "—"} · {formatNumber(model.sectors.reduce((a, s) => a + (s.minutes_per_pair ?? 0), 0), 2)} min/par
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="bignum text-5xl leading-none">{model.pairs_per_day ?? "—"}</span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">pares/dia</span>
      </div>
      {model.somente_padrao && (
        <p className="text-[11px] text-amber-600">
          Tempos padrão da categoria — capacidade ainda não medida neste modelo.
        </p>
      )}
      {model.partial && model.undimensioned.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Sem <b>{model.undimensioned.join(", ")}</b> no cálculo (equipe não informada).
        </p>
      )}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] font-mono text-muted-foreground">
          <span>Índice de produtividade</span>
          <b className="text-foreground">{model.somente_padrao ? "não medido" : (model.productivity_index ?? "—")}</b>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${model.productivity_index ?? 0}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {model.bottleneck_sector && (
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px] font-mono uppercase tracking-wider">
            Gargalo · {model.bottleneck_sector}
          </Badge>
        )}
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onHistory}>
            <ClockCounterClockwise className="h-3.5 w-3.5 mr-1" /> Histórico
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onSave} disabled={saving || model.incomplete}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FloppyDisk className="h-3.5 w-3.5 mr-1" />}
            Salvar custos
          </Button>
        </div>
      </div>
    </div>
  );
}
