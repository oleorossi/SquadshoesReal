import { useMemo, useState } from 'react';
import { FloppyDisk } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  type ArtisanalStrapCatalog,
  useConfirmArtisanalStrapMaterialConversion,
  useStrapBaseGroupCandidates,
} from '@/hooks/useArtisanalStraps';

interface Props {
  catalog: ArtisanalStrapCatalog;
  /** Largura útil da napa em mm (da calculadora). */
  usableWidthMm: number;
  /** Largura da banda de corte em mm. */
  cutBandWidthMm: number;
  /** Rendimento a gravar (real se informado, senão teórico geométrico). */
  confirmedYieldMPerM: number;
}

/**
 * Persistência da calculadora no catálogo por (medida × napa-base).
 * Tipo/medida novos continuam no editor de conversão; aqui só confirma rendimento.
 */
export default function StrapCalculatorCatalogSave({
  catalog,
  usableWidthMm,
  cutBandWidthMm,
  confirmedYieldMPerM,
}: Props) {
  const canWrite = catalog.capabilities.manage_strap_catalog === true;
  const { data: baseCandidates = [], isLoading: basesLoading } = useStrapBaseGroupCandidates(canWrite);
  const confirmConversion = useConfirmArtisanalStrapMaterialConversion();

  const measures = useMemo(
    () => [...catalog.measures]
      .filter((m) => m.active !== false)
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'pt-BR')),
    [catalog.measures],
  );
  const typesById = useMemo(
    () => new Map(catalog.types.map((t) => [t.id, t])),
    [catalog.types],
  );

  const [measureId, setMeasureId] = useState('');
  const [baseGroupId, setBaseGroupId] = useState('');

  const measure = measures.find((m) => m.id === measureId);
  const type = measure ? typesById.get(measure.strap_type_id) : null;
  const base = baseCandidates.find((g) => g.id === baseGroupId);

  const canSave = canWrite
    && !!measure
    && !!type
    && !!baseGroupId
    && cutBandWidthMm > 0
    && confirmedYieldMPerM > 0
    && usableWidthMm > 0
    && !confirmConversion.isPending;

  const onSave = async () => {
    if (!canSave || !measure || !type) return;
    await confirmConversion.mutateAsync({
      reason: 'Confirmado pela calculadora de tiras',
      payload: {
        type: { id: type.id, name: type.name, active: true },
        measure: {
          id: measure.id,
          display_name: measure.display_name,
          finished_width_mm: Number(measure.finished_width_mm) || undefined,
          active: true,
        },
        base_group_id: baseGroupId,
        recipe: {
          cut_band_width_mm: cutBandWidthMm,
          confirmed_yield_m_per_m: confirmedYieldMPerM,
          executor_type: 'factory',
          default_contractor_id: null,
        },
      },
    });
  };

  if (!canWrite) {
    return (
      <p className="text-xs text-muted-foreground">
        Sem permissão para gravar no catálogo. Use a simulação livre acima.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">Salvar no catálogo</p>
        <p className="text-xs text-muted-foreground">
          Escolha a napa-base e a medida de tira já cadastrada. O rendimento abaixo vira a
          receita aprovada para todas as cores dessa combinação.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Material-base (napa)</Label>
          <Select
            value={baseGroupId || undefined}
            disabled={basesLoading}
            onValueChange={setBaseGroupId}
          >
            <SelectTrigger aria-label="Material-base da tira">
              <SelectValue placeholder={basesLoading ? 'Carregando…' : 'Ex.: NAPA SOFT'} />
            </SelectTrigger>
            <SelectContent>
              {baseCandidates.map((group) => (
                <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Medida da tira</Label>
          <Select value={measureId || undefined} onValueChange={setMeasureId}>
            <SelectTrigger aria-label="Medida da tira">
              <SelectValue placeholder="Ex.: Overlock 5 mm" />
            </SelectTrigger>
            <SelectContent>
              {measures.map((entry) => {
                const typeName = typesById.get(entry.strap_type_id)?.name;
                return (
                  <SelectItem key={entry.id} value={entry.id}>
                    {typeName ? `${typeName} · ${entry.display_name}` : entry.display_name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Largura útil</dt>
          <dd className="font-mono font-semibold tabular-nums">
            {usableWidthMm > 0 ? `${usableWidthMm.toLocaleString('pt-BR')} mm` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Banda</dt>
          <dd className="font-mono font-semibold tabular-nums">
            {cutBandWidthMm > 0 ? `${cutBandWidthMm.toLocaleString('pt-BR')} mm` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Rendimento</dt>
          <dd className="font-mono font-semibold tabular-nums">
            {confirmedYieldMPerM > 0
              ? `${confirmedYieldMPerM.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} m/m`
              : '—'}
          </dd>
        </div>
      </dl>

      {base?.usable_width_mm != null && usableWidthMm > 0
        && Math.abs(Number(base.usable_width_mm) - usableWidthMm) > 1 ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          A napa {base.name} tem largura útil cadastrada de{' '}
          {Number(base.usable_width_mm).toLocaleString('pt-BR')} mm — confira se a calculadora
          está na mesma geometria.
        </p>
      ) : null}

      <Button
        type="button"
        className="gap-2"
        disabled={!canSave}
        onClick={() => void onSave()}
      >
        <FloppyDisk className="h-4 w-4" weight="bold" />
        {confirmConversion.isPending ? 'Salvando…' : 'Confirmar rendimento no catálogo'}
      </Button>
    </div>
  );
}
