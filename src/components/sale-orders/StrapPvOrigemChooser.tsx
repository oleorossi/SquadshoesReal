import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { normalizeStrapOrigemPadrao, type StrapOrigemPadrao } from '@/lib/strapBaseNapaPeel';
import { normalizeSelectableStrapPvOrigem } from '@/lib/strapPvOrigem';

/** Só as duas origens do contrato 16-B (prestador legado → fazer). */
export type StrapPvOrigemChoice = 'fabrica' | 'sku_acabado';

interface Props {
  label: string;
  origemPadrao: StrapOrigemPadrao | string | null | undefined;
  value: StrapPvOrigemChoice | 'prestador' | null;
  onChange: (value: StrapPvOrigemChoice) => void;
  disabled?: boolean;
}

/** Seletor do PV: só aparece quando o Hub marca escolhe_no_pv. */
export default function StrapPvOrigemChooser({
  label, origemPadrao, value, onChange, disabled,
}: Props) {
  const mode = normalizeStrapOrigemPadrao(origemPadrao);
  if (mode === 'sempre_fabrica') {
    return (
      <p className="text-[10px] text-muted-foreground">
        Origem fixa no Hub: <strong className="text-foreground">fazer (fábrica)</strong>
      </p>
    );
  }
  if (mode === 'sempre_sku_acabado') {
    return (
      <p className="text-[10px] text-muted-foreground">
        Origem fixa no Hub: <strong className="text-foreground">comprar pronto</strong>
      </p>
    );
  }
  const selectable = normalizeSelectableStrapPvOrigem(value);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Label className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Origem
      </Label>
      <Select
        value={selectable ?? undefined}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === 'fabrica' || next === 'sku_acabado') onChange(next);
        }}
      >
        <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label={`Origem de ${label}`}>
          <SelectValue placeholder="Escolha a origem" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fabrica">Fazer (fábrica)</SelectItem>
          <SelectItem value="sku_acabado">Comprar pronto</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

interface BulkProps {
  onAllFactory: () => void;
  onAllBuyReady: () => void;
  disabled?: boolean;
}

export function StrapPvOrigemBulkActions({ onAllFactory, onAllBuyReady, disabled }: BulkProps) {
  return (
    <div className="flex flex-wrap gap-1">
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" disabled={disabled} onClick={onAllFactory}>
        Todas fazer
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" disabled={disabled} onClick={onAllBuyReady}>
        Todas comprar pronto
      </Button>
    </div>
  );
}
