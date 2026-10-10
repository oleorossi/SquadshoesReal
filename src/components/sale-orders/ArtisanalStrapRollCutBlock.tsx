import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { CaretDown, CaretUp, Scissors, Warning } from '@phosphor-icons/react';
import {
  aggregateStrapNapaSector,
  artisanalStrapTypeKey,
  type ArtisanalStrapCutRow,
  type StrapTypeNapaAgg,
} from '@/lib/strapRollCut';
import { ROLO_COMPRIMENTO_M } from '@/lib/strapCutPlanner';
import StrapMeasureYieldDialog from '@/components/sale-orders/StrapMeasureYieldDialog';
import StrapCutPlannerPanel, {
  type StrapCutPlannerDefaults,
} from '@/components/sale-orders/StrapCutPlannerPanel';

interface YieldTarget {
  typeLabel: string;
  measureId?: string;
  measureName?: string;
  suggestedCutBandMm?: number;
  suggestedYieldMPerM?: number;
}

function yieldTargetFromType(
  type: StrapTypeNapaAgg,
  rows: ArtisanalStrapCutRow[],
): YieldTarget {
  const matching = rows.filter((row) => artisanalStrapTypeKey(row) === type.typeKey);
  const sample = matching.find((row) => row.measureId || row.measureName)
    || matching[0];
  return {
    typeLabel: type.typeName,
    measureId: type.measureId || sample?.measureId,
    measureName: type.measureName || sample?.measureName,
    suggestedCutBandMm: sample?.largura_mm && sample.largura_mm > 0
      ? sample.largura_mm
      : undefined,
    suggestedYieldMPerM: Number(sample?.canonical?.theoreticalYieldMPerM) > 0
      ? Number(sample?.canonical?.theoreticalYieldMPerM)
      : undefined,
  };
}

/** Defaults do planejador a partir das rows fonte do tipo × cor. */
function plannerDefaultsFromType(
  type: StrapTypeNapaAgg,
  rows: ArtisanalStrapCutRow[],
): StrapCutPlannerDefaults {
  const matching = rows.filter((row) => {
    if (artisanalStrapTypeKey(row) !== type.typeKey) return false;
    const color = (row.color || '').trim() || '—';
    return color === type.color;
  });
  const sample = matching.find((row) => row.largura_mm > 0 || Number(row.canonical?.usableBaseWidthMm) > 0)
    || matching[0];
  const bandMm = Number(sample?.largura_mm) || 0;
  const usableWidthMm = Number(sample?.canonical?.usableBaseWidthMm) || 0;
  const confirmedYieldMPerM = Number(sample?.canonical?.confirmedYieldMPerM) || 0;
  return {
    bandMm: bandMm > 0 ? bandMm : null,
    usableWidthMm: usableWidthMm > 0 ? usableWidthMm : null,
    confirmedYieldMPerM: confirmedYieldMPerM > 0 ? confirmedYieldMPerM : null,
  };
}

function rowPlanKey(type: StrapTypeNapaAgg): string {
  return `${type.typeKey}\0${type.color}\0${type.blocked ? 'blocked' : 'ok'}`;
}

function showBaseSuffix(type: StrapTypeNapaAgg): boolean {
  const base = (type.baseName || '').trim();
  if (!base) return false;
  return !type.typeName.toLocaleLowerCase('pt-BR').includes(base.toLocaleLowerCase('pt-BR'));
}

/**
 * Bloco próprio de napa para tiras (separado de Cabedal/Forração).
 * Por tipo × cor: metros de tira + metros de napa; rodapé: total de napa (18-A).
 * Tipos sem rendimento abrem o modal de cadastro (mesmo writer do Hub).
 * Planejador de corte por linha = só tela (não altera napa oficial).
 */
export default function ArtisanalStrapRollCutBlock({
  rows,
  onYieldSaved,
}: {
  rows: ArtisanalStrapCutRow[];
  /** Após confirmar rendimento — tipicamente refetch do consumo. */
  onYieldSaved?: () => void;
}) {
  const [yieldTarget, setYieldTarget] = useState<YieldTarget | null>(null);
  /** Comprimento do rolo lembrado na sessão desta página (entre linhas). */
  const [rollLengthM, setRollLengthM] = useState(ROLO_COMPRIMENTO_M);
  const [expandedPlanKey, setExpandedPlanKey] = useState<string | null>(null);

  if (!rows || rows.length === 0) return null;

  const sector = aggregateStrapNapaSector(rows);
  const anyBlocked = sector.types.some((t) => t.blocked);
  const anyNeedsYield = sector.types.some((t) => t.needsYield);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-1.5">
        <Scissors className="h-4 w-4 text-red-600 dark:text-red-400" weight="fill" />
        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
          Setor de Tiras
        </h3>
        <Badge className="ml-1 border border-red-500/30 bg-red-500/15 text-[10px] uppercase tracking-wide text-red-600 hover:bg-red-500/15 dark:text-red-400">
          Setor próprio
        </Badge>
      </div>
      <p className="px-3 text-xs text-red-600/80 dark:text-red-400/80">
        Só tiras de Prestador: a fábrica não corta tira — a napa vai ao prestador, que devolve a
        tira. Por tipo e cor: metros de tira pelo prestador (depois do estoque de tira pronta) e
        napa a enviar (÷ rendimento). Não se mistura com Cabedal/Forração. Total de napa a enviar
        no rodapé.
      </p>

      <div className="keep-together overflow-hidden rounded-lg border border-red-500/30">
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(4.5rem,0.7fr)_auto_auto] gap-x-3 border-b border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-600/70 dark:text-red-400/70">
          <span>Tipo de tira</span>
          <span>Cor</span>
          <span className="text-right">Tira</span>
          <span className="text-right">Napa a enviar</span>
        </div>
        <div className="divide-y divide-red-500/20">
          {sector.types.map((type) => {
            const planKey = rowPlanKey(type);
            const planOpen = expandedPlanKey === planKey;
            return (
              <div key={planKey} className="px-3 py-2.5 hover:bg-red-500/5">
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(4.5rem,0.7fr)_auto_auto] items-baseline gap-x-3">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-red-700 dark:text-red-300">
                      {type.typeName}
                    </span>
                    {showBaseSuffix(type) ? (
                      <span className="text-xs text-red-600/70 dark:text-red-400/70">
                        {' '}· base {type.baseName}
                      </span>
                    ) : null}
                    {type.blocked ? (
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-red-600 dark:text-red-400">
                        <span className="inline-flex items-center gap-1">
                          <Warning className="h-3 w-3" /> Cadastro incompleto
                        </span>
                        {type.blockedReason ? (
                          <span className="basis-full text-[11px] text-red-600/80 dark:text-red-400/80">
                            {type.blockedReason}
                          </span>
                        ) : null}
                        {type.needsYield ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 border-red-500/40 px-2 text-[11px] text-red-700 hover:bg-red-500/10 dark:text-red-300"
                            onClick={() => setYieldTarget(yieldTargetFromType(type, rows))}
                          >
                            Informar rendimento
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {type.strapM > 0 ? (
                      <div className="mt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1.5 text-[11px] text-red-700 hover:bg-red-500/10 dark:text-red-300"
                          onClick={() => setExpandedPlanKey(planOpen ? null : planKey)}
                          aria-expanded={planOpen}
                        >
                          {planOpen ? (
                            <CaretUp className="mr-1 h-3 w-3" />
                          ) : (
                            <CaretDown className="mr-1 h-3 w-3" />
                          )}
                          Planejar corte
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <span className="truncate text-sm font-medium text-red-700 dark:text-red-300">
                    {type.color}
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums text-red-700 dark:text-red-300">
                    {type.strapM.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                    <span className="text-[10px] font-normal text-red-600/70"> m</span>
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums text-red-600 dark:text-red-400">
                    {type.napaM > 0
                      ? type.napaM.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
                      : '—'}
                    {type.napaM > 0 ? (
                      <span className="text-[10px] font-normal text-red-600/70"> m</span>
                    ) : null}
                  </span>
                </div>
                {planOpen ? (
                  <StrapCutPlannerPanel
                    strapNeededM={type.strapM}
                    rollLengthM={rollLengthM}
                    onRollLengthMChange={setRollLengthM}
                    defaults={plannerDefaultsFromType(type, rows)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(4.5rem,0.7fr)_auto_auto] items-baseline gap-x-3 border-t-2 border-red-500/40 bg-red-500/10 px-3 py-3">
          <span className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
            Total de napa a enviar ao prestador
          </span>
          <span />
          <span className="font-mono text-xs tabular-nums text-red-600/70 dark:text-red-400/70">
            {sector.totalStrapM.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m tira
          </span>
          <span className="font-mono text-lg font-bold tabular-nums text-red-600 dark:text-red-400">
            {sector.totalNapaM > 0
              ? sector.totalNapaM.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
              : '—'}
            {sector.totalNapaM > 0 ? (
              <span className="text-xs font-normal text-red-600/70"> m</span>
            ) : null}
          </span>
        </div>
      </div>

      {anyBlocked ? (
        <p className="px-3 text-[11px] text-red-600/80 dark:text-red-400/80">
          Tipos sem rendimento ficam com napa em “—”.
          {anyNeedsYield ? ' Informe o rendimento aqui ou ' : ' '}
          <Link to="/tiras-artesanais?tab=calculadora" className="underline">
            {anyNeedsYield ? 'abra a calculadora de tiras →' : 'Abrir calculadora de tiras →'}
          </Link>
        </p>
      ) : null}

      {yieldTarget ? (
        <StrapMeasureYieldDialog
          open
          onOpenChange={(next) => {
            if (!next) setYieldTarget(null);
          }}
          measureId={yieldTarget.measureId}
          measureName={yieldTarget.measureName}
          typeLabel={yieldTarget.typeLabel || 'Tira'}
          suggestedCutBandMm={yieldTarget.suggestedCutBandMm}
          suggestedYieldMPerM={yieldTarget.suggestedYieldMPerM}
          onSaved={onYieldSaved}
        />
      ) : null}
    </div>
  );
}
