/**
 * Calculadora de Tiras — rendimento de corte (metragem de tira por metro linear).
 *
 * Ferramenta avulsa com DOIS sentidos, alternados por um seletor no topo das entradas:
 *  • "Quanto rende" (direto): largura do material, largura da tira, perda e comprimento
 *    do rolo → quantos metros de tira saem por metro linear (número-herói), total do
 *    rolo, custo e a tabela de cortes parciais. Modelo contínuo (sem piso).
 *  • "Quanto preciso" (inverso): a mesma geometria, mas partindo dos metros de TIRA
 *    PRONTA desejados → quantos metros de material (e quantos rolos / quanto custa) são
 *    necessários. Ver `computeStrapMaterialNeeded` em `@/lib/strapYield`.
 */
import { useMemo, useRef, useState } from 'react';
import {
  Scissors,
  ArrowRight,
  ArrowsLeftRight,
  Info,
  Ruler,
  Warning,
  Plus,
  Trash,
  Package,
  ArrowCounterClockwise,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NumberInput } from '@/components/ui/number-input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { formatCurrency } from '@/lib/utils';
import {
  computeStrapYield,
  computeStrapMaterialNeeded,
  partialCutYield,
  PARTIAL_CUT_UNIT_TO_M,
  STRAP_YIELD_DEFAULTS,
  type PartialCutUnit,
  type StrapYieldInput,
  type StrapMaterialNeededInput,
} from '@/lib/strapYield';

/** Número pt-BR com até `dec` casas, sem zeros à direita. '—' se não-finito. */
const nf = (n: number, dec = 2): string =>
  Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: dec }) : '—';

/**
 * Larguras na TELA são em cm (decisão do Leonardo 2026-07-24); só a "largura da
 * tira" é digitada em mm e convertida. O motor (`strapYield`) continua em mm —
 * a conversão mora só na borda de entrada/exibição.
 */
const MM_POR_CM = 10;
/** Formata uma medida que está em mm para exibição em cm. */
const nfCm = (mm: number, dec = 2): string => nf(mm / MM_POR_CM, dec);

/** Comprimentos parciais (mm) que a tabela "Cortes Parciais" traz prontos. */
const PARTIAL_PRESETS_MM = [30, 50, 100, 300, 500, 1000];

/** Uma linha da tabela de cortes parciais (comprimento na unidade selecionada). */
type LinhaParcial = { id: number; comprimento: number };

/** Sentido do cálculo: rendimento (direto) ou necessidade de material (inverso). */
type Modo = 'rendimento' | 'necessidade';

/** Snapshot submetido no clique de Calcular — inclui o modo e a tira desejada. */
type Snapshot = StrapYieldInput & { modo: Modo; tiraDesejadaM?: number };

export default function StrapCalculator() {
  const [modo, setModo] = useState<Modo>('rendimento');
  // Largura do material é digitada em CM na tela; o motor recebe em mm.
  const [larguraMaterialCm, setLarguraMaterialCm] = useState<number>(
    STRAP_YIELD_DEFAULTS.larguraMaterialMm / MM_POR_CM,
  );
  const [larguraTiraMm, setLarguraTiraMm] = useState<number>(0);
  const [perdaPct, setPerdaPct] = useState<number>(STRAP_YIELD_DEFAULTS.perdaPct);
  const [comprimentoRoloM, setComprimentoRoloM] = useState<number>(STRAP_YIELD_DEFAULTS.comprimentoRoloM);
  const [custoMetroLinear, setCustoMetroLinear] = useState<number>(0);
  // Modo inverso: quantos metros de tira pronta o usuário precisa produzir.
  const [tiraDesejadaM, setTiraDesejadaM] = useState<number>(0);

  // Cálculo é disparado pelo botão CALCULAR (não reativo ao digitar): guarda um
  // snapshot das entradas no clique e calcula em cima dele.
  const [submitted, setSubmitted] = useState<Snapshot | null>(null);
  const [runId, setRunId] = useState(0);

  const baseInput: StrapYieldInput = {
    larguraMaterialMm: larguraMaterialCm * MM_POR_CM,
    larguraTiraMm,
    perdaPct,
    comprimentoRoloM,
    custoMetroLinear: custoMetroLinear > 0 ? custoMetroLinear : null,
  };
  const current: Snapshot =
    modo === 'necessidade' ? { ...baseInput, modo, tiraDesejadaM } : { ...baseInput, modo };

  const rendResult = useMemo(
    () => (submitted?.modo === 'rendimento' ? computeStrapYield(submitted) : null),
    [submitted],
  );
  const needResult = useMemo(
    () => (submitted?.modo === 'necessidade' ? computeStrapMaterialNeeded(submitted as StrapMaterialNeededInput) : null),
    [submitted],
  );
  const active = submitted?.modo === 'necessidade' ? needResult : rendResult;
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
    setLarguraMaterialCm(STRAP_YIELD_DEFAULTS.larguraMaterialMm / MM_POR_CM);
    setLarguraTiraMm(0);
    setPerdaPct(STRAP_YIELD_DEFAULTS.perdaPct);
    setComprimentoRoloM(STRAP_YIELD_DEFAULTS.comprimentoRoloM);
    setCustoMetroLinear(0);
    setTiraDesejadaM(0);
    setSubmitted(null);
    restaurarPresetsParciais();
  };

  const showCostRend = rendResult?.valid && rendResult.custoMaterialRolo != null;
  const showCostNeed = needResult?.valid && needResult.custoMaterialNecessario != null;
  const inverso = modo === 'necessidade';

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="ENGENHARIA · CORTE"
        title="Calculadora de Tiras"
        description="Nos dois sentidos: quanto de tira sai de um material — ou quanto da largura do rolo cortar pra uma metragem de tira. Preencha os dados e clique em Calcular. Defaults do rolo padrão (137 cm × 40 m, 15%), todos editáveis. Larguras em cm; só a largura da tira é em mm."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* ── ENTRADAS ──────────────────────────────────────────────── */}
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Ruler className="h-4 w-4 text-muted-foreground" weight="bold" />
              Entradas
            </div>

            {/* Seletor de sentido do cálculo */}
            <ToggleGroup
              type="single"
              value={modo}
              onValueChange={(v) => v && setModo(v as Modo)}
              variant="outline"
              className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/30 p-1"
              aria-label="Sentido do cálculo"
            >
              <ToggleGroupItem
                value="rendimento"
                className="h-9 gap-1.5 rounded-md border-0 text-xs font-semibold text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                <Scissors className="h-3.5 w-3.5" weight="fill" />
                Quanto rende
              </ToggleGroupItem>
              <ToggleGroupItem
                value="necessidade"
                className="h-9 gap-1.5 rounded-md border-0 text-xs font-semibold text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                <ArrowsLeftRight className="h-3.5 w-3.5" weight="bold" />
                Quanto preciso
              </ToggleGroupItem>
            </ToggleGroup>

            {/* Modo inverso: metragem de tira pronta desejada (entrada-chave) */}
            {inverso && (
              <div className="space-y-1.5 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                <Label htmlFor="td" className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                  Tira pronta que preciso
                </Label>
                <NumberInput id="td" value={tiraDesejadaM} onChange={setTiraDesejadaM} unit="m" decimals={2} placeholder="1000" />
                <p className="text-xs text-muted-foreground">Metros de tira já cortada que o pedido exige.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="lm">Largura útil do material</Label>
              <NumberInput id="lm" value={larguraMaterialCm} onChange={setLarguraMaterialCm} unit="cm" decimals={2} placeholder="137" />
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
                {inverso && <p className="text-[11px] text-muted-foreground">Comprimento em que a faixa é cortada.</p>}
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
          {!submitted || !active ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <Scissors className="h-8 w-8 text-muted-foreground/50" weight="light" />
                <p className="text-sm text-muted-foreground">
                  Preencha os dados e clique em <span className="font-semibold text-foreground">Calcular</span>.
                </p>
              </CardContent>
            </Card>
          ) : !active.valid ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex items-center gap-3 py-8">
                <Warning className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" weight="fill" />
                <p className="text-sm text-amber-700 dark:text-amber-300">{active.error}</p>
              </CardContent>
            </Card>
          ) : submitted.modo === 'necessidade' && needResult?.valid ? (
            /* ── MODO INVERSO: quanto material preciso ─────────────────── */
            <div key={runId} className="space-y-4 duration-300 animate-in fade-in-50 slide-in-from-bottom-2">
              {/* Número-herói: largura a cortar do rolo */}
              <Card className="overflow-hidden border-red-500/30 bg-red-500/10">
                <CardContent className="py-6">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-red-600/80 dark:text-red-400/80">
                    <ArrowsLeftRight className="h-3.5 w-3.5" weight="bold" />
                    Largura a cortar do rolo
                  </div>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-6xl font-bold leading-none tabular-nums text-red-600 dark:text-red-400">
                      {nfCm(needResult.larguraCortarMm, 2)}
                    </span>
                    <span className="text-lg font-medium text-red-600/80 dark:text-red-400/80">
                      cm · de {nfCm(submitted.larguraMaterialMm, 1)} cm
                    </span>
                    <span className="rounded-md bg-red-500/15 px-2 py-0.5 font-mono text-sm font-bold tabular-nums text-red-600 dark:text-red-400">
                      {nf(needResult.larguraPctDoRolo, 1)}% do rolo
                    </span>
                  </div>

                  {/* Barra: quanto da largura do rolo é cortado */}
                  <div className="mt-5">
                    <div className="mb-1 flex items-baseline justify-between font-mono text-[10px] tracking-wide text-red-700/60 dark:text-red-300/60">
                      <span>faixa cortada · {nf(needResult.larguraPctDoRolo, 1)}%</span>
                      <span>{nfCm(submitted.larguraMaterialMm, 1)} cm</span>
                    </div>
                    <div className="h-4 overflow-hidden rounded-md border border-red-500/30 bg-red-500/10">
                      <div
                        className="h-full min-w-[3px] rounded-r-sm bg-red-500 transition-all duration-300 dark:bg-red-400"
                        style={{ width: `${Math.min(100, needResult.larguraPctDoRolo)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-red-700/80 dark:text-red-300/80">
                      Corte uma faixa de <span className="font-mono font-semibold text-red-700 dark:text-red-300">{nfCm(needResult.larguraCortarMm, 2)} cm</span> →{' '}
                      <span className="font-mono font-semibold text-red-700 dark:text-red-300">{nf(needResult.tirasNecessarias, 1)}</span> tiras de {nf(submitted.larguraTiraMm, 0)} mm,{' '}
                      <span className="font-semibold">cada uma com {nf(submitted.comprimentoRoloM, 0)} m</span> (o comprimento do rolo).
                    </p>
                  </div>

                  {/* Passo a passo: bruto → perda aumenta → largura a cortar */}
                  <div className="mt-4 space-y-1.5 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-red-700/80 dark:text-red-300/80">
                        1. Largura bruta <span className="text-red-700/50 dark:text-red-300/50">(sem perda)</span>
                      </span>
                      <span className="shrink-0 font-mono font-semibold tabular-nums text-red-700 dark:text-red-300">
                        {nfCm(needResult.larguraCortarBrutaMm, 2)} cm
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-red-700/80 dark:text-red-300/80">
                        2. Perda de {nf(needResult.perdaPct, 0)}% <span className="text-red-700/50 dark:text-red-300/50">(corta mais)</span>
                      </span>
                      <span className="shrink-0 font-mono font-semibold tabular-nums text-red-700 dark:text-red-300">
                        + {nfCm(needResult.larguraExtraPerdaMm, 2)} cm
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-red-500/20 pt-1.5 text-xs">
                      <span className="font-semibold text-red-700 dark:text-red-300">3. Largura a cortar</span>
                      <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-red-600 dark:text-red-400">
                        {nfCm(needResult.larguraCortarMm, 2)} cm
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Aviso: faixa passa da largura do rolo */}
              {needResult.passaLargura && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
                  <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" weight="fill" />
                  <span>
                    A faixa ({nfCm(needResult.larguraCortarMm, 1)} cm) passa da largura do rolo ({nfCm(submitted.larguraMaterialMm, 1)} cm) —
                    é preciso de <span className="font-semibold">{nf(needResult.rolosInteiros, 0)}</span> rolos de {nf(submitted.comprimentoRoloM, 0)} m no comprimento cheio.
                  </span>
                </div>
              )}

              {/* Contexto: tira final + material linear + rolos */}
              <Card className="overflow-hidden">
                <CardContent className="divide-y divide-border/60 py-0">
                  <div className="flex items-center justify-between gap-4 bg-red-500/5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-600/80 dark:text-red-400/80">
                        <Scissors className="h-3.5 w-3.5" weight="fill" />
                        Tiras somadas · bruto
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {nf(needResult.tirasNecessarias, 1)} tiras × {nf(submitted.comprimentoRoloM, 0)} m — total cortado da faixa
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        − perda {nf(needResult.perdaPct, 0)}% →{' '}
                        <span className="font-mono font-semibold text-foreground">{nf(needResult.tiraDesejadaM, 2)} m</span> aproveitáveis
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{nf(needResult.tiraBrutaTotalM, 2)}</span>
                      <span className="ml-1 text-sm text-muted-foreground">m de tira</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Package className="h-3.5 w-3.5" weight="bold" />
                        Material necessário
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">comprimento linear a passar (largura cheia)</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-2xl font-bold tabular-nums text-foreground">{nf(needResult.materialNecessarioM, 2)}</span>
                      <span className="ml-1 text-sm text-muted-foreground">m</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">Rolos necessários</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        abrir <span className="font-semibold text-foreground">{nf(needResult.rolosInteiros, 0)}</span> rolo{needResult.rolosInteiros === 1 ? '' : 's'} de {nf(submitted.comprimentoRoloM, 0)} m
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-2xl font-bold tabular-nums text-foreground">{nf(needResult.rolosNecessarios, 2)}</span>
                      <span className="ml-1 text-sm text-muted-foreground">rolo{needResult.rolosNecessarios === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Custo do material necessário */}
              {showCostNeed ? (
                <Card className="border-red-500/20">
                  <CardContent className="divide-y divide-border/60 py-0">
                    <div className="flex items-center justify-between gap-4 py-4">
                      <div>
                        <div className="text-sm font-medium text-foreground">Custo do material necessário</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(submitted.custoMetroLinear)} /m × {nf(needResult.materialNecessarioM, 3)} m
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-2xl font-bold tabular-nums text-foreground">
                        {formatCurrency(needResult.custoMaterialNecessario)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-3">
                      <div className="text-sm text-foreground">
                        Custo por metro de tira
                        <span className="ml-1 text-xs text-muted-foreground">(material ÷ rendimento)</span>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(needResult.custoPorMetroTira)} /m
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                  <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                  Informe o custo do material para ver quanto você gasta.
                </div>
              )}
            </div>
          ) : rendResult?.valid ? (
            /* ── MODO DIRETO: quanto rende ─────────────────────────────── */
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
                      {nf(rendResult.metragemPorMetroLiq, 3)}
                    </span>
                    <span className="text-lg font-medium text-red-600/80 dark:text-red-400/80">m de tira / m linear</span>
                  </div>
                  <p className="mt-3 font-mono text-xs text-red-700/70 dark:text-red-300/70">
                    {nf(larguraMaterialCm, 2)} cm ÷ {nfCm(larguraTiraMm, 2)} cm × (1 − {nf(rendResult.perdaPct, 2)}%) = {nf(rendResult.metragemPorMetroLiq, 3)} m/m
                    <span className="text-red-600/50 dark:text-red-400/50"> · bruto {nf(rendResult.metragemPorMetroBruto, 3)} m/m</span>
                  </p>
                </CardContent>
              </Card>

              {/* Total no rolo */}
              <Card>
                <CardContent className="flex items-center justify-between gap-4 py-5">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total no rolo</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {nf(rendResult.metragemPorMetroLiq, 3)} m/m × {nf(submitted.comprimentoRoloM, 2)} m de rolo
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-mono text-3xl font-bold tabular-nums text-foreground">{nf(rendResult.totalRoloLiq, 2)}</span>
                    <span className="ml-1 text-sm text-muted-foreground">m</span>
                  </div>
                </CardContent>
              </Card>

              {/* Custo do material */}
              {showCostRend && (
                <Card className="border-red-500/20">
                  <CardContent className="divide-y divide-border/60 py-0">
                    <div className="flex items-center justify-between gap-4 py-4">
                      <div>
                        <div className="text-sm font-medium text-foreground">Custo do material do rolo</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(submitted.custoMetroLinear)} /m × {nf(submitted.comprimentoRoloM, 2)} m
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-2xl font-bold tabular-nums text-foreground">
                        {formatCurrency(rendResult.custoMaterialRolo)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-3">
                      <div className="text-sm text-foreground">
                        Custo por metro de tira
                        <span className="ml-1 text-xs text-muted-foreground">(material ÷ rendimento)</span>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(rendResult.custoPorMetroTira)} /m
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!showCostRend && (
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
                  <div className="flex items-center gap-3 border-b border-border/60 px-2 pb-2">
                    <span className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Comprimento
                    </span>
                    <span className="flex-1 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Tira que sai
                    </span>
                    {showCostRend && (
                      <span className="w-20 shrink-0 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Custo
                      </span>
                    )}
                    <span className="w-7 shrink-0" />
                  </div>

                  {linhasParciais.map((linha) => {
                    const comprimentoM = linha.comprimento * PARTIAL_CUT_UNIT_TO_M[unidadeParcial];
                    const vazio = !(linha.comprimento > 0);
                    const { tiraM, custo } = partialCutYield(
                      rendResult.metragemPorMetroLiq,
                      comprimentoM,
                      showCostRend ? submitted.custoMetroLinear : null,
                    );
                    const maiorQueRolo = comprimentoM > submitted.comprimentoRoloM;
                    return (
                      <div
                        key={linha.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 px-2 py-1.5 first:border-t-0 hover:bg-muted/40"
                      >
                        <div className="w-24 shrink-0">
                          <NumberInput
                            value={linha.comprimento}
                            onChange={(v) => setComprimentoParcial(linha.id, v)}
                            unit={unidadeParcial}
                            decimals={2}
                            className="h-9 text-right"
                          />
                        </div>
                        <div className="min-w-0 flex-1 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
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
                        {showCostRend && (
                          <div className="w-20 shrink-0 text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                            {vazio ? <span className="text-muted-foreground/60">—</span> : formatCurrency(custo)}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeLinhaParcial(linha.id)}
                          aria-label="Remover linha"
                          title="Remover linha"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
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
          ) : null}

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
