import { useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import {
  ROLO_COMPRIMENTO_M,
  ROLO_LARGURA_MM,
  napaFromConfirmedYield,
  planStrapCutHeight,
  simulateStrapFromHeight,
  strapCutRollBreakdownLabel,
} from '@/lib/strapCutPlanner';

export interface StrapCutPlannerDefaults {
  /** Largura da banda (mm) do cadastro — 0/ausente ⇒ campo vazio. */
  bandMm?: number | null;
  /** Largura útil (mm) do cadastro — 0/ausente ⇒ pré 1370. */
  usableWidthMm?: number | null;
  /** Rendimento confirmado (m/m) — só conferência. */
  confirmedYieldMPerM?: number | null;
}

interface Props {
  /** Metros de tira da linha (agregado tipo × cor). */
  strapNeededM: number;
  /** Comprimento do rolo compartilhado na sessão da página. */
  rollLengthM: number;
  onRollLengthMChange: (value: number) => void;
  defaults: StrapCutPlannerDefaults;
}

function positiveOrZero(value: number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Mini-planejador de corte intermediário (só tela). Não grava cadastro nem
 * altera a coluna Napa oficial.
 */
export default function StrapCutPlannerPanel({
  strapNeededM,
  rollLengthM,
  onRollLengthMChange,
  defaults,
}: Props) {
  const initialBand = positiveOrZero(defaults.bandMm);
  const initialUsable = positiveOrZero(defaults.usableWidthMm) || ROLO_LARGURA_MM;

  const [bandMm, setBandMm] = useState(initialBand);
  const [usableWidthMm, setUsableWidthMm] = useState(initialUsable);
  const [simHeightMm, setSimHeightMm] = useState(0);

  // Reidrata quando a linha muda (outra expansão / defaults novos).
  useEffect(() => {
    setBandMm(positiveOrZero(defaults.bandMm));
    setUsableWidthMm(positiveOrZero(defaults.usableWidthMm) || ROLO_LARGURA_MM);
    setSimHeightMm(0);
  }, [defaults.bandMm, defaults.usableWidthMm]);

  const plan = useMemo(
    () => planStrapCutHeight({
      strapNeededM,
      rollLengthM,
      bandMm,
      usableWidthMm,
    }),
    [strapNeededM, rollLengthM, bandMm, usableWidthMm],
  );

  const simulation = useMemo(() => {
    if (!(simHeightMm > 0)) return null;
    return simulateStrapFromHeight({
      heightMm: simHeightMm,
      rollLengthM,
      bandMm,
      usableWidthMm,
      strapNeededM,
    });
  }, [simHeightMm, rollLengthM, bandMm, usableWidthMm, strapNeededM]);

  const napaCheck = napaFromConfirmedYield(strapNeededM, defaults.confirmedYieldMPerM);
  const rollBreakdown = plan.valid ? strapCutRollBreakdownLabel(plan) : null;

  return (
    <div className="col-span-full mt-2 space-y-2 rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-red-600/80 dark:text-red-400/80">
        Planejar napa do prestador
      </p>
      <p className="text-[11px] text-red-600/75 dark:text-red-400/75">
        Só planejamento — não altera a napa oficial da linha.
        Necessidade:{' '}
        <span className="font-mono font-semibold tabular-nums">
          {strapNeededM.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m
        </span>
        {' '}de tira.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="strap-cut-roll" className="text-[10px] uppercase tracking-wider text-red-600/70">
            Rolo (m)
          </Label>
          <NumberInput
            id="strap-cut-roll"
            decimals={4}
            className="h-8 border-red-500/30 bg-background text-sm"
            value={rollLengthM}
            onChange={(n) => onRollLengthMChange(n > 0 ? n : ROLO_COMPRIMENTO_M)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="strap-cut-usable" className="text-[10px] uppercase tracking-wider text-red-600/70">
            Largura útil (mm)
          </Label>
          <NumberInput
            id="strap-cut-usable"
            decimals={2}
            className="h-8 border-red-500/30 bg-background text-sm"
            value={usableWidthMm}
            placeholder={String(ROLO_LARGURA_MM)}
            onChange={setUsableWidthMm}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="strap-cut-band" className="text-[10px] uppercase tracking-wider text-red-600/70">
            Banda (mm)
          </Label>
          <NumberInput
            id="strap-cut-band"
            decimals={2}
            className="h-8 border-red-500/30 bg-background text-sm"
            value={bandMm}
            placeholder="20"
            onChange={setBandMm}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="strap-cut-sim-height" className="text-[10px] uppercase tracking-wider text-red-600/70">
            E se altura (mm)?
          </Label>
          <NumberInput
            id="strap-cut-sim-height"
            decimals={2}
            className="h-8 border-red-500/30 bg-background text-sm"
            value={simHeightMm}
            placeholder="300"
            onChange={setSimHeightMm}
          />
        </div>
      </div>

      {plan.valid ? (
        <div className="rounded-sm border border-red-500/20 bg-background/60 px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-600/70 dark:text-red-400/70">
            Altura a cortar
          </p>
          <p className="font-mono text-xl font-bold tabular-nums text-red-700 dark:text-red-300">
            {plan.heightMm.toLocaleString('pt-BR')}
            <span className="ml-1 text-xs font-normal text-red-600/70">mm</span>
          </p>
          <p className="mt-0.5 text-[11px] text-red-600/80 dark:text-red-400/80">
            {plan.bandsNeeded} banda{plan.bandsNeeded === 1 ? '' : 's'}
            {' · '}
            rende {plan.strapProducedM.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m de tira
            {plan.strapSurplusM > 0
              ? ` (sobra ${plan.strapSurplusM.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m)`
              : null}
          </p>
          {rollBreakdown ? (
            <p className="mt-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">
              {rollBreakdown}
            </p>
          ) : null}
          {plan.multiRoll && plan.rolls > 1 && plan.heightOnLastRollMm > 0 ? (
            <p className="text-[11px] text-red-600/75 dark:text-red-400/75">
              Em cada rolo completo: {(plan.bandsPerRoll * bandMm).toLocaleString('pt-BR')} mm
              ({plan.bandsPerRoll} bandas).
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-red-600 dark:text-red-400">
          {plan.error || 'Preencha rolo, largura útil e banda para calcular a altura.'}
        </p>
      )}

      {simulation ? (
        simulation.valid ? (
          <div className="rounded-sm border border-dashed border-red-500/25 px-2.5 py-2 text-[11px] text-red-700 dark:text-red-300">
            <span className="font-bold uppercase tracking-wider text-red-600/70">Simulação · </span>
            {simulation.bandsInHeight} banda{simulation.bandsInHeight === 1 ? '' : 's'}
            {' → '}
            <span className="font-mono font-semibold tabular-nums">
              {simulation.strapPerRollM.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m
            </span>
            {' '}de tira por rolo
            {simulation.coversInOneRoll
              ? ' — cobre a necessidade em 1 rolo.'
              : simulation.rollsToCover > 0
                ? ` — precisa de ${simulation.rollsToCover} rolo${simulation.rollsToCover === 1 ? '' : 's'}.`
                : '.'}
            {simulation.exceedsUsableWidth
              ? ' Altura maior que a largura útil.'
              : null}
          </div>
        ) : (
          <p className="text-[11px] text-red-600 dark:text-red-400">{simulation.error}</p>
        )
      ) : null}

      {napaCheck != null ? (
        <p className="text-[11px] text-red-600/75 dark:text-red-400/75">
          Pelo rendimento cadastrado ≈{' '}
          <span className="font-mono font-semibold tabular-nums">
            {napaCheck.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} m
          </span>
          {' '}de napa (conferência — igual à coluna Napa).
        </p>
      ) : null}
    </div>
  );
}
