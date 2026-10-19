/**
 * Configuração: rendimento por medida × geometria de bobina.
 * Um número cobre todas as famílias com a mesma ficha (1000×1370 ≡ 1370×1000).
 */
import { useEffect, useMemo, useState } from 'react';
import { FloppyDisk, Warning } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import {
  useSetStrapMeasureGeometryYield,
  type StrapMeasureYieldBoardRow,
  type StrapMeasureYieldGeometry,
} from '@/hooks/useStrapMeasureYieldBoard';
import {
  formatStrapNapaGeometryLabel,
  strapGeometryYieldCeiling,
  type StrapNapaGeometryKey,
} from '@/lib/strapNapaGeometry';

interface MeasureGeometryYieldPanelProps {
  row: StrapMeasureYieldBoardRow;
  canEdit: boolean;
  /** Abre já em modo edição (CTA “preencher faltantes”). */
  defaultOpen?: boolean;
}

const formatNumber = (value: number, decimals = 2) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: decimals });

function geomKey(g: StrapMeasureYieldGeometry): StrapNapaGeometryKey {
  return { minMm: Number(g.geom_min_mm) || 0, maxMm: Number(g.geom_max_mm) || 0 };
}

export function MeasureGeometryYieldPanel({
  row,
  canEdit,
  defaultOpen = false,
}: MeasureGeometryYieldPanelProps) {
  const save = useSetStrapMeasureGeometryYield();
  const primary = useMemo(() => {
    if (!row.geometries.length) return null;
    // Preferência: geometria com mais famílias (bobina padrão 1370).
    return [...row.geometries].sort((a, b) => b.family_count - a.family_count)[0];
  }, [row.geometries]);

  const [open, setOpen] = useState(defaultOpen || row.missing_yield);
  const [yieldValue, setYieldValue] = useState(0);
  const [bandValue, setBandValue] = useState(0);

  useEffect(() => {
    if (!open) return;
    const current = primary?.yield_m_per_m
      ?? row.sample_yield_m_per_m
      ?? 0;
    const band = Number(row.cut_band_width_mm) || 0;
    const theoretical = primary
      ? strapGeometryYieldCeiling(geomKey(primary), band || undefined)
      : 0;
    // Prefill: teórico se ainda não há yield; senão o valor gravado.
    setYieldValue(current > 0 ? current : theoretical);
    setBandValue(band);
  }, [open, primary, row.cut_band_width_mm, row.sample_yield_m_per_m, row.measure_id]);

  useEffect(() => {
    if (defaultOpen || row.missing_yield) setOpen(true);
  }, [defaultOpen, row.missing_yield]);

  if (!row.uses_napa) {
    return (
      <p className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Esta tira não usa napa — rendimento por bobina não se aplica.
      </p>
    );
  }

  if (!row.strap_group_id) {
    return (
      <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
        <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" weight="bold" />
        Medida sem grupo de estoque mapeado. Cadastre o tipo de tira no Estoque.
      </p>
    );
  }

  const theoretical = primary
    ? strapGeometryYieldCeiling(geomKey(primary), bandValue || row.cut_band_width_mm)
    : 0;
  const familyNames = primary?.family_names ?? row.families.map((f) => f.napa_group_name);

  if (!canEdit) {
    return (
      <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {row.has_yield ? (
          <p>
            Rendimento {formatNumber(Number(row.sample_yield_m_per_m) || 0)} m/m
            {primary ? ` · ${formatStrapNapaGeometryLabel(geomKey(primary))}` : ''}
            {' · '}{familyNames.length} famíli{familyNames.length === 1 ? 'a' : 'as'}
          </p>
        ) : (
          <p className="text-amber-700 dark:text-amber-300">Rendimento pendente</p>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 h-9 w-full gap-2"
        onClick={() => setOpen(true)}
      >
        {row.has_yield
          ? `Ajustar rendimento (${formatNumber(Number(row.sample_yield_m_per_m) || 0)} m/m)`
          : 'Informar rendimento da bobina'}
      </Button>
    );
  }

  const handleSave = () => {
    if (!(yieldValue > 0)) return;
    save.mutate(
      {
        measureId: row.measure_id,
        yieldMPerM: yieldValue,
        cutBandWidthMm: bandValue > 0 ? bandValue : null,
        geometryWidthMm: primary?.geom_max_mm || null,
        geometryLengthMm: primary?.geom_min_mm || null,
      },
      { onSuccess: () => setOpen(false) },
    );
  };

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/15 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {row.missing_yield ? (
          <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200">
            Falta rendimento
          </Badge>
        ) : (
          <Badge variant="secondary">Com rendimento</Badge>
        )}
        {primary && (
          <span className="text-xs text-muted-foreground">
            {formatStrapNapaGeometryLabel(geomKey(primary))}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`yield-${row.measure_id}`}>Rendimento (m tira / m napa)</Label>
          <NumberInput
            id={`yield-${row.measure_id}`}
            value={yieldValue}
            onChange={(v) => setYieldValue(Number(v) || 0)}
            min={0}
            step="1"
            decimals={2}
            unit="m/m"
          />
          {theoretical > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Sugestão teórica (floor bobina ÷ banda): {formatNumber(theoretical, 0)} m/m
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`band-${row.measure_id}`}>Banda de corte (mm)</Label>
          <NumberInput
            id={`band-${row.measure_id}`}
            value={bandValue}
            onChange={(v) => setBandValue(Number(v) || 0)}
            min={0}
            step="1"
            decimals={1}
            unit="mm"
          />
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Famílias cobertas ({familyNames.length})
        </p>
        <p className="mt-1 text-xs text-foreground">
          {familyNames.length === 0
            ? 'Nenhuma napa elegível com ficha nesta geometria.'
            : familyNames.join(' · ')}
        </p>
        {row.geometries.length > 1 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Há {row.geometries.length} geometrias distintas; o save aplica só à bobina acima.
            Outras geometrias pedem rendimento próprio.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-9 gap-2"
          disabled={save.isPending || !(yieldValue > 0) || familyNames.length === 0}
          onClick={handleSave}
        >
          <FloppyDisk className="h-4 w-4" weight="bold" />
          {save.isPending ? 'Gravando…' : 'Salvar e espalhar'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-9"
          disabled={save.isPending}
          onClick={() => setOpen(false)}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
