import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { normalizeStrapOrigemPadrao, type StrapOrigemPadrao } from '@/lib/strapBaseNapaPeel';

export type StrapPvOrigemChoice = 'fabrica' | 'prestador' | 'sku_acabado';

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
        Origem · {label}
      </Label>
      <Select
        value={value ?? undefined}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === 'fabrica' || next === 'prestador' || next === 'sku_acabado') onChange(next);
        }}
      >
        <SelectTrigger className="h-8 text-xs" aria-label={`Origem de ${label}`}>
          <SelectValue placeholder="Escolha a origem" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fabrica">Feita na fábrica</SelectItem>
          <SelectItem value="prestador">Prestador (OS + remessa de napa)</SelectItem>
          <SelectItem value="sku_acabado">Tira pronta (fornecedor)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

interface BulkProps {
  onAllFactory: () => void;
  onAllContractor: () => void;
  onAllBuyReady: () => void;
  disabled?: boolean;
}

export function StrapPvOrigemBulkActions({ onAllFactory, onAllContractor, onAllBuyReady, disabled }: BulkProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" disabled={disabled} onClick={onAllFactory}>
        Todas na fábrica
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" disabled={disabled} onClick={onAllContractor}>
        Todas no prestador
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" disabled={disabled} onClick={onAllBuyReady}>
        Todas tira pronta
      </Button>
    </div>
  );
}
