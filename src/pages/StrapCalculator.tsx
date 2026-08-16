/**
 * Calculadora de Tiras — rendimento de corte (metragem de tira por metro linear).
 *
 * Ferramenta avulsa com DOIS sentidos, alternados por um seletor no topo das entradas:
 *  • "Quanto rende" (direto): largura do material, largura da banda de corte, rendimento
 *    confirmado e comprimento do rolo → quantos metros de tira saem por metro linear,
 *    total do rolo, custo e a tabela de cortes parciais.
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
import { cn, formatCurrency } from '@/lib/utils';
import {
  computeStrapYield,
  computeStrapMaterialNeeded,
  partialCutYield,
  PARTIAL_CUT_UNIT_TO_M,
  STRAP_YIELD_DEFAULTS,
  type PartialCutUnit,
  type StrapMaterialNeededResult,
  type StrapYieldInput,
  type StrapMaterialNeededInput,
} from '@/lib/strapYield';

/** Número pt-BR com até `dec` casas, sem zeros à direita. '—' se não-finito. */
const nf = (n: number, dec = 2): string =>
  Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: dec }) : '—';

/**
 * Larguras na TELA são em cm (decisão do Leonardo 2026-07-24); só a largura da
 * banda de corte é digitada em mm. O motor (`strapYield`) continua em mm —
 * a conversão mora só na borda de entrada/exibição.
 */
const MM_POR_CM = 10;
/** Formata uma medida que está em mm para exibição em cm. */
const nfCm = (mm: number, dec = 2): string => nf(mm / MM_POR_CM, dec);

/** Comprimentos parciais (mm) que a tabela "Cortes Parciais" traz prontos. */
const PARTIAL_PRESETS_MM = [30, 50, 100, 300, 500, 1000];

/** Uma linha da tabela de cortes parciais (comprimento na unidade selecionada). */
type LinhaParcial = { id: number; comprimento: number };

/**
 * Selo da unidade de preenchimento, ao lado do rótulo do campo. A unidade que o
 * `NumberInput` desenha dentro do campo é `aria-hidden` e discreta — este selo
 * deixa explícito em QUE unidade digitar (evita, ex., digitar 1370 num campo
 * que agora é cm).
 */
function UnitTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase leading-none tracking-wider text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Sentido do cálculo: rendimento (direto) ou necessidade de material (inverso). */
type Modo = 'rendimento' | 'necessidade';

/** Snapshot submetido no clique de Calcular — inclui o modo e a tira desejada. */
type Snapshot = StrapYieldInput & { modo: Modo; tiraDesejadaM?: number };

interface StrapCalculatorProps {
  embedded?: boolean;
  larguraMaterialInicialMm?: number;
  larguraBandaInicialMm?: number;
  rendimentoConfirmadoInicialMPerM?: number;
  canShowFinancialValues?: boolean;
}

function ConfirmedNeedResult({
  result,
  submitted,
  showCost,
}: {
  result: StrapMaterialNeededResult;
  submitted: Snapshot;
  showCost: boolean;
}) {
  return (
    <div className="space-y-4 duration-300 animate-in fade-in-50 slide-in-from-bottom-2">
      <Card className="overflow-hidden border-red-500/30 bg-red-500/10">
        <CardContent className="py-6">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-red-600/80 dark:text-red-400/80">
            <Package className="h-3.5 w-3.5" weight="bold" />
            Napa-base necessária
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-6xl font-bold leading-none tabular-nums text-red-600 dark:text-red-400">
              {nf(result.materialNecessarioM, 6)}
            </span>
            <span className="text-lg font-medium text-red-600/80 dark:text-red-400/80">m lineares</span>
          </div>
          <p className="mt-3 font-mono text-xs text-red-700/70 dark:text-red-300/70">
            {nf(result.tiraDesejadaM, 6)} m de tira ÷ {nf(result.metragemPorMetroLiq, 6)} m/m confirmados = {nf(result.materialNecessarioM, 6)} m de napa
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 py-5 sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tira pronta</p>
            <p className="mt-1 font-mono text-lg font-bold text-foreground">{nf(result.tiraDesejadaM, 6)} m</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rendimento confirmado</p>
            <p className="mt-1 font-mono text-lg font-bold text-foreground">{nf(result.metragemPorMetroLiq, 6)} m/m</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Capacidade teórica</p>
            <p className="mt-1 font-mono text-lg font-bold text-foreground">{nf(result.metragemPorMetroBruto, 0)} m/m</p>
            <p className="text-[10px] text-muted-foreground">
              floor({nf(submitted.larguraMaterialMm, 0)} ÷ {nf(submitted.larguraTiraMm, 0)})
            </p>
          </div>
        </CardContent>
      </Card>

      {showCost ? (
        <Card className="border-red-500/20">
          <CardContent className="divide-y divide-border/60 py-0">
            <div className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="text-sm font-medium text-foreground">Custo da napa necessária</div>
                <div className="text-xs text-muted-foreground">
                  {formatCurrency(submitted.custoMetroLinear)} /m × {nf(result.materialNecessarioM, 6)} m
                </div>
              </div>
              <span className="shrink-0 font-mono text-2xl font-bold tabular-nums text-foreground">
                {formatCurrency(result.custoMaterialNecessario)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <span className="text-sm text-foreground">Custo por metro de tira</span>
              <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatCurrency(result.custoPorMetroTira)} /m
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

      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          A largura útil e a banda conferem o teto geométrico. A necessidade operacional usa exclusivamente o rendimento confirmado da receita aprovada.
        </span>
      </div>
    </div>
  );
}

export default function StrapCalculator({
  embedded = false,
  larguraMaterialInicialMm,
  larguraBandaInicialMm,
  rendimentoConfirmadoInicialMPerM,
  canShowFinancialValues = true,
}: StrapCalculatorProps = {}) {
  const larguraMaterialPadraoMm = larguraMaterialInicialMm && larguraMaterialInicialMm > 0
    ? larguraMaterialInicialMm
    : STRAP_YIELD_DEFAULTS.larguraMaterialMm;
  const larguraBandaPadraoMm = larguraBandaInicialMm && larguraBandaInicialMm > 0
    ? larguraBandaInicialMm
    : 0;
  const rendimentoConfirmadoPadrao = rendimentoConfirmadoInicialMPerM && rendimentoConfirmadoInicialMPerM > 0
    ? rendimentoConfirmadoInicialMPerM
    : null;
  const [modo, setModo] = useState<Modo>('rendimento');
  // Largura do material é digitada em CM na tela; o motor recebe em mm.
  const [larguraMaterialCm, setLarguraMaterialCm] = useState<number>(
    larguraMaterialPadraoMm / MM_POR_CM,
  );
  const [larguraTiraMm, setLarguraTiraMm] = useState<number>(larguraBandaPadraoMm);
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
    comprimentoRoloM,
    custoMetroLinear: custoMetroLinear > 0 ? custoMetroLinear : null,
    rendimentoConfirmadoMPerM: rendimentoConfirmadoPadrao,
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
    setLarguraMaterialCm(larguraMaterialPadraoMm / MM_POR_CM);
    setLarguraTiraMm(larguraBandaPadraoMm);
    setComprimentoRoloM(STRAP_YIELD_DEFAULTS.comprimentoRoloM);
    setCustoMetroLinear(0);
    setTiraDesejadaM(0);
    setSubmitted(null);
    restaurarPresetsParciais();
  };

  const showCostRend = rendResult?.valid && rendResult.custoMaterialRolo != null;
  const showCostNeed = needResult?.valid && needResult.custoMaterialReal != null;
  const inverso = modo === 'necessidade';

  return (
    <div className="space-y-5 page-enter">
      {!embedded && (
        <EditorialPageHeader
          sectionLabel="ENGENHARIA · CORTE"
          title="Calculadora de Tiras"
          description="Nos dois sentidos: quanto de tira sai de um material — ou quantas bandas e quantos rolos cortar para uma metragem de tira. A conta usa somente bandas físicas completas, sem perda percentual adicional. Largura útil em cm; banda de corte em mm."
        />
      )}

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
                <div className="flex items-center gap-2">
                  <Label htmlFor="td" className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                    Tira pronta que preciso
                  </Label>
                  <UnitTag className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">m</UnitTag>
                </div>
                <NumberInput id="td" value={tiraDesejadaM} onChange={setTiraDesejadaM} unit="m" decimals={2} placeholder="1000" />
                <p className="text-xs text-muted-foreground">Metros de tira já cortada que o pedido exige.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="lm">Largura útil do material</Label>
                <UnitTag>cm</UnitTag>
              </div>
              <NumberInput id="lm" value={larguraMaterialCm} onChange={setLarguraMaterialCm} unit="cm" decimals={2} placeholder="137" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="lt">Largura da banda de corte</Label>
                <UnitTag>mm</UnitTag>
              </div>
              <NumberInput id="lt" value={larguraTiraMm} onChange={setLarguraTiraMm} unit="mm" decimals={2} placeholder="20" />
              <p className="text-xs text-muted-foreground">
                Use a largura consumida no material, não a medida final da tira. Ex.: uma tira pronta de 8 mm pode exigir uma banda de 20 mm.
              </p>
            </div>

            {rendimentoConfirmadoPadrao != null && (
              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Rendimento confirmado da receita
                </p>
                <p className="mt-1 font-mono text-lg font-bold text-foreground">
                  {nf(rendimentoConfirmadoPadrao, 6)} m/m
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Valor aprovado e usado em metragem, custo e estoque.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="cr">Comprimento do rolo</Label>
                <UnitTag>m</UnitTag>
              </div>
              <NumberInput id="cr" value={comprimentoRoloM} onChange={setComprimentoRoloM} unit="m" decimals={2} placeholder="40" />
              {inverso && <p className="text-[11px] text-muted-foreground">Comprimento em que a faixa é cortada.</p>}
            </div>

            {canShowFinancialValues && (
              <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="cml" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Custo do material (opcional)
                  </Label>
                  <UnitTag>R$/m</UnitTag>
                </div>
                <CurrencyInput id="cml" value={custoMetroLinear} onChange={setCustoMetroLinear} />
                <p className="text-xs text-muted-foreground">R$ por metro linear do material comprado.</p>
              </div>
            )}

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
          ) : submitted.modo === 'necessidade' && needResult?.valid && submitted.rendimentoConfirmadoMPerM != null ? (
            <ConfirmedNeedResult result={needResult} submitted={submitted} showCost={showCostNeed} />
          ) : submitted.modo === 'necessidade' && needResult?.valid ? (
            /* ── MODO INVERSO: quanto material preciso ─────────────────── */
            <div key={runId} className="space-y-4 duration-300 animate-in fade-in-50 slide-in-from-bottom-2">
              {/* Número-herói: largura a cortar do rolo */}
              <Card className="overflow-hidden border-red-500/30 bg-red-500/10">
                <CardContent className="py-6">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-red-600/80 dark:text-red-400/80">
                    <ArrowsLeftRight className="h-3.5 w-3.5" weight="bold" />
                    Largura total de corte
                  </div>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-6xl font-bold leading-none tabular-nums text-red-600 dark:text-red-400">
                      {nfCm(needResult.larguraRealMm, 2)}
                    </span>
                    <span className="text-lg font-medium text-red-600/80 dark:text-red-400/80">
                      cm somados · rolo de {nfCm(submitted.larguraMaterialMm, 1)} cm
                    </span>
                    <span className="rounded-md bg-red-500/15 px-2 py-0.5 font-mono text-sm font-bold tabular-nums text-red-600 dark:text-red-400">
                      {nf(needResult.larguraRealPctDoRolo, 1)}% de largura equivalente
                    </span>
                  </div>

                  {/* Barra: quanto da largura do rolo é cortado */}
                  <div className="mt-5">
                    <div className="mb-1 flex items-baseline justify-between font-mono text-[10px] tracking-wide text-red-700/60 dark:text-red-300/60">
                      <span>largura somada · {nf(needResult.larguraRealPctDoRolo, 1)}%</span>
                      <span>{nfCm(submitted.larguraMaterialMm, 1)} cm</span>
                    </div>
                    <div className="h-4 overflow-hidden rounded-md border border-red-500/30 bg-red-500/10">
                      <div
                        className="h-full min-w-[3px] rounded-r-sm bg-red-500 transition-all duration-300 dark:bg-red-400"
                        style={{ width: `${Math.min(100, needResult.larguraRealPctDoRolo)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-red-700/80 dark:text-red-300/80">
                      Corte <span className="font-mono font-semibold text-red-700 dark:text-red-300">{nf(needResult.tirasInteiras, 0)}</span> bandas inteiras de{' '}
                      <span className="font-mono font-semibold text-red-700 dark:text-red-300">{nf(submitted.larguraTiraMm, 0)} mm</span>, distribuídas em{' '}
                      <span className="font-semibold">{nf(needResult.rolosRealInteiros, 0)} rolo{needResult.rolosRealInteiros === 1 ? '' : 's'}</span> de {nf(submitted.comprimentoRoloM, 0)} m.
                    </p>
                  </div>

                  {/* Passo a passo: faixa exata → bandas físicas completas */}
                  <div className="mt-4 space-y-1.5 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-red-700/80 dark:text-red-300/80">
                        1. Faixa exata <span className="text-red-700/50 dark:text-red-300/50">({nf(needResult.tirasNecessarias, 2)} bandas)</span>
                      </span>
                      <span className="shrink-0 font-mono font-semibold tabular-nums text-red-700 dark:text-red-300">
                        {nfCm(needResult.larguraCortarBrutaMm, 2)} cm
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-red-500/20 pt-1.5 text-xs">
                      <span className="font-semibold text-red-700 dark:text-red-300">
                        2. Bandas inteiras{' '}
                        <span className="font-normal text-red-700/60 dark:text-red-300/60">
                          ({nf(needResult.tirasInteiras, 0)} × {nf(submitted.larguraTiraMm, 0)} mm)
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-red-600 dark:text-red-400">
                        {nfCm(needResult.larguraRealMm, 2)} cm
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
                    A largura total das bandas ({nfCm(needResult.larguraRealMm, 1)} cm) passa da largura do rolo ({nfCm(submitted.larguraMaterialMm, 1)} cm) —
                    distribua o corte em <span className="font-semibold">{nf(needResult.rolosRealInteiros, 0)}</span> rolos de {nf(submitted.comprimentoRoloM, 0)} m no comprimento cheio.
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
                        Bandas somadas · bruto
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {nf(needResult.tirasInteiras, 0)} bandas × {nf(submitted.comprimentoRoloM, 0)} m — total bruto cortado
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        <span className="font-mono font-semibold text-foreground">{nf(needResult.tiraLiquidaRealM, 2)} m</span> produzidos, sem perda adicional
                        {needResult.sobraTiraM > 0.005 && (
                          <span className="text-muted-foreground">
                            {' '}(sobra <span className="font-mono">{nf(needResult.sobraTiraM, 2)} m</span> além dos {nf(needResult.tiraDesejadaM, 2)} m pedidos)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{nf(needResult.tiraBrutaRealM, 2)}</span>
                      <span className="ml-1 text-sm text-muted-foreground">m de tira</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Package className="h-3.5 w-3.5" weight="bold" />
                        Material necessário
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">comprimento linear equivalente em largura cheia</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-2xl font-bold tabular-nums text-foreground">{nf(needResult.materialRealM, 2)}</span>
                      <span className="ml-1 text-sm text-muted-foreground">m</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">Rolos necessários</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        abrir <span className="font-semibold text-foreground">{nf(needResult.rolosRealInteiros, 0)}</span> rolo{needResult.rolosRealInteiros === 1 ? '' : 's'} de {nf(submitted.comprimentoRoloM, 0)} m
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-2xl font-bold tabular-nums text-foreground">{nf(needResult.rolosRealInteiros, 0)}</span>
                      <span className="ml-1 text-sm text-muted-foreground">rolo{needResult.rolosRealInteiros === 1 ? '' : 's'}</span>
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
                          {formatCurrency(submitted.custoMetroLinear)} /m × {nf(needResult.materialRealM, 3)} m
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-2xl font-bold tabular-nums text-foreground">
                        {formatCurrency(needResult.custoMaterialReal)}
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
                    {submitted.rendimentoConfirmadoMPerM != null ? 'Rendimento confirmado da receita' : 'Rendimento teórico · por metro linear'}
                  </div>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-6xl font-bold leading-none tabular-nums text-red-600 dark:text-red-400">
                      {nf(rendResult.metragemPorMetroLiq, 3)}
                    </span>
                    <span className="text-lg font-medium text-red-600/80 dark:text-red-400/80">m de tira / m linear</span>
                  </div>
                  <p className="mt-3 font-mono text-xs text-red-700/70 dark:text-red-300/70">
                    {submitted.rendimentoConfirmadoMPerM != null
                      ? `${nf(rendResult.metragemPorMetroLiq, 6)} m/m confirmados · teto geométrico ${nf(rendResult.metragemPorMetroBruto, 0)} m/m`
                      : `floor(${nfCm(submitted.larguraMaterialMm, 2)} cm ÷ ${nfCm(submitted.larguraTiraMm, 2)} cm) = ${nf(rendResult.bandasCompletas, 0)} bandas`}
                    <span className="text-red-600/50 dark:text-red-400/50"> · sobra lateral {nf(submitted.larguraMaterialMm - rendResult.bandasCompletas * submitted.larguraTiraMm, 2)} mm</span>
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

          {/* Fonte do cálculo */}
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {rendimentoConfirmadoPadrao != null
                ? 'Cálculo operacional baseado na receita aprovada, sem percentual de perda adicional.'
                : 'Sugestão geométrica para conferência. Cadastre e aprove o rendimento real antes de usar em estoque, custo ou produção.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
