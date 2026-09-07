import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { normalizeStrapOrigemPadrao, type StrapOrigemPadrao } from '@/lib/strapBaseNapaPeel';

export type StrapPvOrigemChoice = 'fabrica' | 'prestador';

interface Props {
  label: string;
  origemPadrao: StrapOrigemPadrao | string | null | undefined;
  value: StrapPvOrigemChoice | null;
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
        Origem fixa no Hub: <strong className="text-foreground">fábrica</strong>
      </p>
    );
  }
  if (mode === 'sempre_sku_acabado') {
    return (
      <p className="text-[10px] text-muted-foreground">
        Origem fixa no Hub: <strong className="text-foreground">SKU acabado</strong>
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Fábrica ou prestador · {label}
      </Label>
      <Select
        value={value || ''}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === 'fabrica' || next === 'prestador') onChange(next);
        }}
      >
        <SelectTrigger className="h-8 text-xs" aria-label={`Origem de ${label}`}>
          <SelectValue placeholder="Escolha a origem" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fabrica">Feita na fábrica</SelectItem>
          <SelectItem value="prestador">Comprar pronto (prestador · OS + remessa)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

interface BulkProps {
  onAllFactory: () => void;
  onAllContractor: () => void;
  disabled?: boolean;
}

export function StrapPvOrigemBulkActions({ onAllFactory, onAllContractor, disabled }: BulkProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" disabled={disabled} onClick={onAllFactory}>
        Todas na fábrica
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" disabled={disabled} onClick={onAllContractor}>
        Todas no prestador
      </Button>
    </div>
  );
}
