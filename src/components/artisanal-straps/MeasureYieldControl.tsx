import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowsClockwise, FloppyDisk, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import {
  confirmArtisanalStrapMeasureYield,
  strapYieldCeiling,
} from '@/lib/confirmArtisanalStrapMeasureYield';

/** Uma napa vigente da medida, já achatada pela página. */
export interface MeasureYieldRecipeRow {
  recipeId: string;
  baseGroupId: string;
  baseGroupName: string;
  usableWidthMm: number;
  cutBandWidthMm: number;
  confirmedYieldMPerM: number;
}

interface MeasureYieldControlProps {
  measureId: string;
  measureLabel: string;
  recipes: MeasureYieldRecipeRow[];
  canEdit: boolean;
}

const formatNumber = (value: number, decimals = 2) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: decimals });

/** Valor comum a todas as linhas, ou `null` quando elas divergem. */
function uniformValue(values: number[]): number | null {
  if (values.length === 0) return null;
  const [first] = values;
  return values.every((value) => value === first) ? first : null;
}

/**
 * Controle de LOTE do rendimento, irmão do `MeasureLaborCostControl`.
 *
 * O rendimento é gravado por (medida × napa) — por isso a lista acima mostra
 * uma linha por napa. Mas corrigir um número errado abrindo a gaveta N vezes
 * convida a deixar napa para trás com o valor velho, e a napa a enviar ao
 * prestador sai de `tira ÷ rendimento`: uma napa esquecida vira pedido de
 * compra errado. Aqui o número vai para todas de uma vez (decisão do dono,
 * 14/10/2026), com opt-out por napa para o caso de geometria diferente.
 *
 * ⚠ O teto é POR NAPA (`floor(largura útil ÷ banda)`) porque a largura vem da
 * Ficha de Componente de cada uma. A tela calcula o mesmo teto que o CHECK do
 * banco e marca a napa que não comporta o número ANTES do envio — o SQL ainda
 * valida o lote inteiro e aborta tudo, então nunca há meia-aplicação.
 */
export function MeasureYieldControl({
  measureId,
  measureLabel,
  recipes,
  canEdit,
}: MeasureYieldControlProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [yieldValue, setYieldValue] = useState(0);
  const [changeBand, setChangeBand] = useState(false);
  const [bandValue, setBandValue] = useState(0);
  const [excluded, setExcluded] = useState<string[]>([]);

  const currentYield = useMemo(
    () => uniformValue(recipes.map((recipe) => recipe.confirmedYieldMPerM)),
    [recipes],
  );
  const currentBand = useMemo(
    () => uniformValue(recipes.map((recipe) => recipe.cutBandWidthMm)),
    [recipes],
  );

  // Reidrata pela COMPOSIÇÃO da lista, não pela identidade do array: o catálogo
  // é refetchado pelo React Query e um `[recipes]` cru apagaria o formulário
  // no meio do preenchimento.
  const recipesSignature = recipes.map((recipe) => recipe.recipeId).join('|');
  useEffect(() => {
    if (!open) return;
    setYieldValue(currentYield ?? 0);
    setBandValue(currentBand ?? 0);
    setChangeBand(false);
    setExcluded([]);
  }, [open, currentYield, currentBand, recipesSignature]);

  const selected = recipes.filter((recipe) => !excluded.includes(recipe.baseGroupId));
  const effectiveBandOf = (recipe: MeasureYieldRecipeRow) =>
    (changeBand && bandValue > 0 ? bandValue : recipe.cutBandWidthMm);
  const ceilingOf = (recipe: MeasureYieldRecipeRow) =>
    strapYieldCeiling(recipe.usableWidthMm, effectiveBandOf(recipe));
  const overCeiling = selected.filter((recipe) => yieldValue > ceilingOf(recipe));

  if (recipes.length === 0) return null;

  if (!canEdit) {
    if (currentYield == null) return null;
    return (
      <p className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Rendimento {formatNumber(currentYield)} m/m · todas as {recipes.length} Napas desta medida
      </p>
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
        <ArrowsClockwise className="h-4 w-4" weight="bold" />
        {currentYield != null
          ? `Mudar rendimento das ${recipes.length} Napas (${formatNumber(currentYield)} m/m)`
          : `Igualar rendimento das ${recipes.length} Napas`}
      </Button>
    );
  }

  const handleSave = async () => {
    if (saving) return;
    if (!(yieldValue > 0)) {
      toast.error('Informe um rendimento maior que zero.');
      return;
    }
    if (selected.length === 0) {
      toast.error('Selecione ao menos uma Napa.');
      return;
    }
    if (changeBand && !(bandValue > 0)) {
      toast.error('Informe uma banda de corte maior que zero.');
      return;
    }
    if (overCeiling.length > 0) {
      toast.error(
        `${overCeiling[0].baseGroupName} não comporta ${formatNumber(yieldValue)} m/m (teto ${formatNumber(ceilingOf(overCeiling[0]))} m/m).`,
      );
      return;
    }

    const allSelected = selected.length === recipes.length;
    try {
      setSaving(true);
      const result = await confirmArtisanalStrapMeasureYield(
        measureId,
        {
          confirmedYieldMPerM: yieldValue,
          cutBandWidthMm: changeBand ? bandValue : null,
          ...(allSelected ? {} : { baseGroupIds: selected.map((recipe) => recipe.baseGroupId) }),
        },
        `Rendimento ${formatNumber(yieldValue)} m/m aplicado${changeBand ? ` com banda ${formatNumber(bandValue)} mm` : ''} a ${selected.length} Napa(s) de ${measureLabel} pelo cadastro de tipos`,
      );
      await queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
      toast.success(
        `${formatNumber(yieldValue)} m/m aplicado a ${result.applied_count} Napa(s) de ${measureLabel}`,
      );
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível aplicar o rendimento às Napas desta medida.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="space-y-1">
        <Label htmlFor={`measure-yield-${measureId}`}>Rendimento das Napas (m/m)</Label>
        <p className="text-xs text-muted-foreground">
          Metros de tira por metro de napa. Um número para {measureLabel}, aplicado de uma vez
          às Napas marcadas. Cada uma ganha uma versão nova; a anterior fica no histórico.
        </p>
      </div>

      <NumberInput
        id={`measure-yield-${measureId}`}
        value={yieldValue}
        onChange={setYieldValue}
        min={0}
        decimals={6}
        unit="m/m"
        autoFocus
      />

      <div className="space-y-2 rounded-md border border-border bg-card p-3">
        <label className="flex items-start gap-2 text-xs">
          <Checkbox
            checked={changeBand}
            onCheckedChange={(checked) => setChangeBand(checked === true)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-foreground">Corrigir também a banda de corte</span>
            <span className="block text-muted-foreground">
              A banda é a faixa de napa cortada antes de dobrar/overlocar. Ela define o teto do
              rendimento — banda menor, teto maior.
              {currentBand != null ? ` Hoje: ${formatNumber(currentBand)} mm.` : ''}
            </span>
          </span>
        </label>
        {changeBand && (
          <NumberInput
            id={`measure-band-${measureId}`}
            value={bandValue}
            onChange={setBandValue}
            min={0}
            decimals={6}
            unit="mm"
          />
        )}
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Napas alcançadas ({selected.length} de {recipes.length})
        </p>
        <div className="space-y-1">
          {recipes.map((recipe) => {
            const checked = !excluded.includes(recipe.baseGroupId);
            const ceiling = ceilingOf(recipe);
            const blocked = checked && yieldValue > ceiling;
            return (
              <label
                key={recipe.baseGroupId}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) => setExcluded((previous) => (
                    next === true
                      ? previous.filter((id) => id !== recipe.baseGroupId)
                      : [...previous, recipe.baseGroupId]
                  ))}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {recipe.baseGroupName}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    ficha {formatNumber(recipe.usableWidthMm)} mm · banda{' '}
                    {formatNumber(effectiveBandOf(recipe))} mm · teto {formatNumber(ceiling)} m/m
                  </span>
                </span>
                <span
                  className={`shrink-0 font-mono tabular-nums ${blocked ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {formatNumber(recipe.confirmedYieldMPerM)}
                  {checked && yieldValue > 0 ? ` → ${formatNumber(yieldValue)}` : ''}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {overCeiling.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" weight="fill" />
          <span>
            {overCeiling.map((recipe) => recipe.baseGroupName).join(', ')}{' '}
            não comporta{overCeiling.length > 1 ? 'm' : ''} {formatNumber(yieldValue)} m/m.
            Desmarque {overCeiling.length > 1 ? 'essas Napas' : 'essa Napa'} ou reduza a banda.
          </span>
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 flex-1"
          disabled={saving}
          onClick={() => setOpen(false)}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-9 flex-1 gap-2"
          disabled={saving || overCeiling.length > 0 || selected.length === 0}
          onClick={() => void handleSave()}
        >
          <FloppyDisk className="h-4 w-4" weight="bold" />
          {saving ? 'Aplicando…' : `Aplicar a ${selected.length} Napa(s)`}
        </Button>
      </div>
    </div>
  );
}
