/**
 * Calculadora de Tiras — rendimento de corte (metragem de tira por metro linear).
 *
 * Ferramenta avulsa. O usuário preenche largura do material, largura da tira, perda e
 * comprimento do rolo (+ custo opcional) e clica em CALCULAR. Devolve: quantos metros
 * de tira saem por metro linear (número-herói), o total do rolo, e quanto se gasta em
 * material. Modelo contínuo (sem piso) — ver `@/lib/strapYield`.
 */
import { useMemo, useRef, useState } from 'react';
import { Scissors, ArrowRight, Info, Ruler, Warning, Plus, Trash, ArrowCounterClockwise } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NumberInput } from '@/components/ui/number-input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { cn, formatCurrency } from '@/lib/utils';
import {
  computeStrapYield,
  partialCutYield,
  PARTIAL_CUT_UNIT_TO_M,
  STRAP_YIELD_DEFAULTS,
  type PartialCutUnit,
  type StrapYieldInput,
} from '@/lib/strapYield';

/** Número pt-BR com até `dec` casas, sem zeros à direita. '—' se não-finito. */
const nf = (n: number, dec = 2): string =>
  Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: dec }) : '—';

/** Comprimentos parciais (mm) que a tabela "Cortes Parciais" traz prontos. */
const PARTIAL_PRESETS_MM = [30, 50, 100, 300, 500, 1000];

/** Uma linha da tabela de cortes parciais (comprimento na unidade selecionada). */
type LinhaParcial = { id: number; comprimento: number };

export default function StrapCalculator() {
  const [larguraMaterialMm, setLarguraMaterialMm] = useState<number>(STRAP_YIELD_DEFAULTS.larguraMaterialMm);
  const [larguraTiraMm, setLarguraTiraMm] = useState<number>(0);
  const [perdaPct, setPerdaPct] = useState<number>(STRAP_YIELD_DEFAULTS.perdaPct);
  const [comprimentoRoloM, setComprimentoRoloM] = useState<number>(STRAP_YIELD_DEFAULTS.comprimentoRoloM);
  const [custoMetroLinear, setCustoMetroLinear] = useState<number>(0);

  // Cálculo é disparado pelo botão CALCULAR (não reativo ao digitar): guarda um
  // snapshot das entradas no clique e calcula em cima dele.
  const [submitted, setSubmitted] = useState<StrapYieldInput | null>(null);
  const [runId, setRunId] = useState(0);

  const current: StrapYieldInput = {
    larguraMaterialMm,
    larguraTiraMm,
    perdaPct,
    comprimentoRoloM,
    custoMetroLinear: custoMetroLinear > 0 ? custoMetroLinear : null,
  };

  const result = useMemo(() => (submitted ? computeStrapYield(submitted) : null), [submitted]);
  const dirty = submitted != null && JSON.stringify(current) !== JSON.stringify(submitted);

  // ── Cortes parciais: tabela de trechos do rolo (só o comprimento varia) ──────
  const [unidadeParcial, setUnidadeParcial] = useState<PartialCutUnit>('mm');
  const partialIdRef = useRef(0);
  const mkPartialRows = (mms: number[]): LinhaParcial[] =>
    mms.map((mm) => ({ id: (partialIdRef.current += 1), comprimento: mm }));
  const [linhasParciais, setLinhasParciais] = useState<LinhaParcial[]>(() => mkPartialRows(PARTIAL_PRESETS_MM));

  const addLinhaParcial = () =>
    setLinhasParciais((prev) => [...prev, { id: (partialIdRef.current += 1), comprimento: 0 }]);
  const removeLinhaParcial = (id: number) =>
    setLinhasParciais((prev) => prev.filter((l) => l.id !== id));
  const setComprimentoParcial = (id: number, comprimento: number) =>
    setLinhasParciais((prev) => prev.map((l) => (l.id === id ? { ...l, comprimento } : l)));
  const restaurarPresetsParciais = () => {
    setUnidadeParcial('mm');
    setLinhasParciais(mkPartialRows(PARTIAL_PRESETS_MM));
  };

  const calcular = () => {
    setSubmitted({ ...current });
    setRunId((n) => n + 1);
  };

  const restaurar = () => {
    setLarguraMaterialMm(STRAP_YIELD_DEFAULTS.larguraMaterialMm);
    setLarguraTiraMm(0);
    setPerdaPct(STRAP_YIELD_DEFAULTS.perdaPct);
    setComprimentoRoloM(STRAP_YIELD_DEFAULTS.comprimentoRoloM);
    setCustoMetroLinear(0);
    setSubmitted(null);
    restaurarPresetsParciais();
  };

  const showCost = result?.valid && result.custoMaterialRolo != null;

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="ENGENHARIA · CORTE"
        title="Calculadora de Tiras"
        description="Quantos metros de tira saem por metro linear de material — e quanto você gasta. Preencha os dados e clique em Calcular. Defaults do rolo padrão (1370 mm × 40 m, 15%), todos editáveis."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* ── ENTRADAS ──────────────────────────────────────────────── */}
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Ruler className="h-4 w-4 text-muted-foreground" weight="bold" />
              Entradas
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lm">Largura útil do material</Label>
              <NumberInput id="lm" value={larguraMaterialMm} onChange={setLarguraMaterialMm} unit="mm" decimals={2} placeholder="1370" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lt">Largura da tira</Label>
              <NumberInput id="lt" value={larguraTiraMm} onChange={setLarguraTiraMm} unit="mm" decimals={2} placeholder="20" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p">Perda de processo</Label>
                <NumberInput id="p" value={perdaPct} onChange={setPerdaPct} unit="%" decimals={2} placeholder="15" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr">Comprimento do rolo</Label>
                <NumberInput id="cr" value={comprimentoRoloM} onChange={setComprimentoRoloM} unit="m" decimals={2} placeholder="40" />
              </div>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-3">
              <Label htmlFor="cml" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Custo do material (opcional)
              </Label>
              <CurrencyInput id="cml" value={custoMetroLinear} onChange={setCustoMetroLinear} />
              <p className="text-xs text-muted-foreground">R$ por metro linear do material comprado.</p>
            </div>

            <div className="space-y-2 pt-1">
              <Button onClick={calcular} className="h-11 w-full gap-2 text-base font-semibold" size="lg">
                <Scissors className="h-4 w-4" weight="fill" />
                Calcular
              </Button>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={restaurar}
                  className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Restaurar padrão
                </button>
                {dirty && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Dados alterados — recalcular
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── RESULTADO ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {!result ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <Scissors className="h-8 w-8 text-muted-foreground/50" weight="light" />
                <p className="text-sm text-muted-foreground">
                  Preencha os dados e clique em <span className="font-semibold text-foreground">Calcular</span>.
                </p>
              </CardContent>
            </Card>
          ) : !result.valid ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex items-center gap-3 py-8">
                <Warning className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" weight="fill" />
                <p className="text-sm text-amber-700 dark:text-amber-300">{result.error}</p>
              </CardContent>
            </Card>
          ) : (
            <div key={runId} className="space-y-4 duration-300 animate-in fade-in-50 slide-in-from-bottom-2">
              {/* Número-herói */}
              <Card className="overflow-hidden border-red-500/30 bg-red-500/10">
                <CardContent className="py-6">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-red-600/80 dark:text-red-400/80">
                    <Scissors className="h-3.5 w-3.5" weight="fill" />
                    Rendimento · por metro linear
                  </div>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-6xl font-bold leading-none tabular-nums text-red-600 dark:text-red-400">
                      {nf(result.metragemPorMetroLiq, 3)}
                    </span>
                    <span className="text-lg font-medium text-red-600/80 dark:text-red-400/80">m de tira / m linear</span>
                  </div>
                  <p className="mt-3 font-mono text-xs text-red-700/70 dark:text-red-300/70">
                    {nf(larguraMaterialMm, 2)} ÷ {nf(larguraTiraMm, 2)} × (1 − {nf(result.perdaPct, 2)}%) = {nf(result.metragemPorMetroLiq, 3)} m/m
                    <span className="text-red-600/50 dark:text-red-400/50"> · bruto {nf(result.metragemPorMetroBruto, 3)} m/m</span>
                  </p>
                </CardContent>
              </Card>

              {/* Total no rolo */}
              <Card>
                <CardContent className="flex items-center justify-between gap-4 py-5">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total no rolo</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {nf(result.metragemPorMetroLiq, 3)} m/m × {nf(submitted!.comprimentoRoloM, 2)} m de rolo
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-mono text-3xl font-bold tabular-nums text-foreground">{nf(result.totalRoloLiq, 2)}</span>
                    <span className="ml-1 text-sm text-muted-foreground">m</span>
                  </div>
                </CardContent>
              </Card>

              {/* Custo do material */}
              {showCost && (
                <Card className="border-red-500/20">
                  <CardContent className="divide-y divide-border/60 py-0">
                    <div className="flex items-center justify-between gap-4 py-4">
                      <div>
                        <div className="text-sm font-medium text-foreground">Custo do material do rolo</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(submitted!.custoMetroLinear)} /m × {nf(submitted!.comprimentoRoloM, 2)} m
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-2xl font-bold tabular-nums text-foreground">
                        {formatCurrency(result.custoMaterialRolo)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-3">
                      <div className="text-sm text-foreground">
                        Custo por metro de tira
                        <span className="ml-1 text-xs text-muted-foreground">(material ÷ rendimento)</span>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(result.custoPorMetroTira)} /m
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!showCost && (
                <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                  <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                  Informe o custo do material para ver quanto você gasta.
                </div>
              )}

              {/* Cortes parciais — quanto rende cada trecho do rolo */}
              <Card className="overflow-hidden">
                <div className="flex items-center gap-3 px-4 pb-3 pt-4">
                  <Scissors className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" weight="fill" />
                  <div className="min-w-0">
                    <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-foreground">
                      Cortes Parciais
                    </div>
                    <div className="text-xs text-muted-foreground">Quanto rende cada trecho do rolo</div>
                  </div>
                  <div className="flex-1" />
                  <ToggleGroup
                    type="single"
                    value={unidadeParcial}
                    onValueChange={(v) => v && setUnidadeParcial(v as PartialCutUnit)}
                    variant="outline"
                    size="sm"
                    className="gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5"
                    aria-label="Unidade do comprimento"
                  >
                    {(['mm', 'cm', 'm'] as const).map((u) => (
                      <ToggleGroupItem
                        key={u}
                        value={u}
                        className="h-7 rounded-md border-0 px-2.5 font-mono text-xs font-semibold text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                      >
                        {u}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <div className="px-2 pb-1">
                  <div
                    className={cn(
                      'grid items-center gap-3 border-b border-border/60 px-2 pb-2',
                      showCost ? 'grid-cols-[7.5rem_1fr_5.5rem_1.75rem]' : 'grid-cols-[7.5rem_1fr_1.75rem]',
                    )}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Comprimento
                    </span>
                    <span className="text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Tira que sai
                    </span>
                    {showCost && (
                      <span className="text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Custo
                      </span>
                    )}
                    <span />
                  </div>

                  {linhasParciais.map((linha) => {
                    const comprimentoM = linha.comprimento * PARTIAL_CUT_UNIT_TO_M[unidadeParcial];
                    const vazio = !(linha.comprimento > 0);
                    const { tiraM, custo } = partialCutYield(
                      result.metragemPorMetroLiq,
                      comprimentoM,
                      showCost ? submitted!.custoMetroLinear : null,
                    );
                    const maiorQueRolo = comprimentoM > submitted!.comprimentoRoloM;
                    return (
                      <div
                        key={linha.id}
                        className={cn(
                          'grid items-center gap-3 border-t border-border/40 px-2 py-1.5 first:border-t-0 hover:bg-muted/40',
                          showCost ? 'grid-cols-[7.5rem_1fr_5.5rem_1.75rem]' : 'grid-cols-[7.5rem_1fr_1.75rem]',
                        )}
                      >
                        <NumberInput
                          value={linha.comprimento}
                          onChange={(v) => setComprimentoParcial(linha.id, v)}
                          unit={unidadeParcial}
                          decimals={2}
                          className="h-9 text-right"
                        />
                        <div className="text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                          {vazio ? (
                            <span className="font-normal text-muted-foreground/60">—</span>
                          ) : (
                            <>
                              {nf(tiraM, 3)} m
                              {maiorQueRolo && (
                                <span className="block text-[9.5px] font-medium text-amber-600 dark:text-amber-400">
                                  maior que o rolo
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        {showCost && (
                          <div className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                            {vazio ? <span className="text-muted-foreground/60">—</span> : formatCurrency(custo)}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeLinhaParcial(linha.id)}
                          aria-label="Remover linha"
                          title="Remover linha"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-4 py-3">
                  <Button type="button" size="sm" onClick={addLinhaParcial} className="h-8 gap-1.5">
                    <Plus className="h-3.5 w-3.5" weight="bold" />
                    Adicionar comprimento
                  </Button>
                  <button
                    type="button"
                    onClick={restaurarPresetsParciais}
                    className="ml-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    <ArrowCounterClockwise className="h-3.5 w-3.5" />
                    Restaurar presets
                  </button>
                </div>
              </Card>
            </div>
          )}

          {/* Aviso de estimativa (fixo) */}
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Estimativa. Confira no corte real — a % de perda cobre a variação do corte artesanal.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
