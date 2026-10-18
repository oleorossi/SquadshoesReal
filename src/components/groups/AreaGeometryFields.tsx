/**
 * Bloco único de dimensões (largura × comprimento + unidade).
 * Usado na criação/edição de grupo e no inline da aba Estoque quando a unidade
 * de estoque é de área. Sempre grava no GRUPO (porta canônica).
 */
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberInput } from '@/components/ui/number-input';
import {
  DIMENSION_UNITS,
  assertAreaGeometry,
  plateAreaDm2,
  toMm,
  type AreaGeometryInput,
} from '@/lib/areaGeometry';
import { cn } from '@/lib/utils';

export type AreaGeometryValue = {
  width: number | null;
  length: number | null;
  thickness?: number | null;
  dimensionsUnit: string;
};

interface Props {
  value: AreaGeometryValue;
  onChange: (next: AreaGeometryValue) => void;
  /** Exige L×A+unidade (unidade de estoque de área). */
  required?: boolean;
  showThickness?: boolean;
  showPreview?: boolean;
  className?: string;
  idPrefix?: string;
}

export function areaGeometryFromValue(value: AreaGeometryValue): AreaGeometryInput {
  return {
    width: value.width,
    length: value.length,
    dimensionsUnit: value.dimensionsUnit,
  };
}

export function validateAreaGeometryFields(
  value: AreaGeometryValue,
  required: boolean,
): string | null {
  if (!required) return null;
  const result = assertAreaGeometry(areaGeometryFromValue(value));
  if (result.ok) return null;
  return result.message;
}

export default function AreaGeometryFields({
  value,
  onChange,
  required = false,
  showThickness = false,
  showPreview = true,
  className,
  idPrefix = 'area-geom',
}: Props) {
  const width = Number(value.width) || 0;
  const length = Number(value.length) || 0;
  const unit = value.dimensionsUnit || 'mm';
  const widthMm = toMm(width, unit);
  const lengthMm = toMm(length, unit);
  const previewLinear = widthMm > 0 ? 100 / (widthMm / 10) : null;
  const area = plateAreaDm2(areaGeometryFromValue(value));
  const validation = required ? assertAreaGeometry(areaGeometryFromValue(value)) : null;

  return (
    <div className={cn('space-y-3', className)}>
      {showPreview && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="border-l-2 border-foreground/20 bg-muted/20 px-3 py-2">
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Conversão linear
            </p>
            <p className="mt-1 font-mono text-sm font-semibold">
              {previewLinear == null
                ? 'Largura pendente'
                : `100 dm² = ${previewLinear.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m`}
            </p>
          </div>
          <div className="border-l-2 border-foreground/20 bg-muted/20 px-3 py-2">
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Área da placa
            </p>
            <p className="mt-1 font-mono text-sm font-semibold">
              {area > 0
                ? `${area.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} dm²`
                : 'Comprimento pendente'}
            </p>
          </div>
        </div>
      )}

      <div className={cn('grid gap-3', showThickness ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        <div>
          <Label htmlFor={`${idPrefix}-width`} className="text-xs">
            Largura útil{required ? ' *' : ''}
          </Label>
          <NumberInput
            id={`${idPrefix}-width`}
            value={width}
            onChange={(n) => onChange({ ...value, width: n > 0 ? n : null })}
            min={0}
            className="mt-1 h-9 text-xs"
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-length`} className="text-xs">
            Comprimento{required ? ' *' : ''}
          </Label>
          <NumberInput
            id={`${idPrefix}-length`}
            value={length}
            onChange={(n) => onChange({ ...value, length: n > 0 ? n : null })}
            min={0}
            className="mt-1 h-9 text-xs"
          />
        </div>
        {showThickness && (
          <div>
            <Label htmlFor={`${idPrefix}-thickness`} className="text-xs">Espessura</Label>
            <NumberInput
              id={`${idPrefix}-thickness`}
              value={Number(value.thickness) || 0}
              onChange={(n) => onChange({ ...value, thickness: n > 0 ? n : null })}
              min={0}
              className="mt-1 h-9 text-xs"
            />
          </div>
        )}
        <div>
          <Label htmlFor={`${idPrefix}-unit`} className="text-xs">
            Unidade{required ? ' *' : ''}
          </Label>
          <Select
            value={unit}
            onValueChange={(dimensionsUnit) => onChange({ ...value, dimensionsUnit })}
          >
            <SelectTrigger id={`${idPrefix}-unit`} className="mt-1 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIMENSION_UNITS.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {required && validation && validation.ok === false && (
        <p className="text-xs text-destructive">{validation.message}</p>
      )}
      {required && (
        <p className="text-[11px] text-muted-foreground">
          Unidade de estoque em área exige <strong className="text-foreground">largura × comprimento</strong> no grupo.
          É a porta única — a ficha de componente herda estas medidas.
        </p>
      )}
    </div>
  );
}

/** Campo só de largura (bobina / setores Cabedal) — fora do escopo L×A de área. */
export function WidthOnlyField({
  value,
  onChange,
  required,
  id = 'group-width',
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  required?: boolean;
  id?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>Largura útil (mm){required ? ' *' : ''}</Label>
      <Input
        id={id}
        type="number"
        min="1"
        step="1"
        className="mt-1"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        placeholder="Ex: 1370"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Divisor dm² → metro da bobina. Sem largura o consumo linear sai ~100× inflado.
      </p>
      {required && !(Number(value) > 0) && (
        <p className="mt-1 text-xs text-destructive">Obrigatória para material de bobina neste setor.</p>
      )}
    </div>
  );
}
