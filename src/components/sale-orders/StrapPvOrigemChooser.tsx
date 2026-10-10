import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  STRAP_PV_ORIGEM_LABEL,
  normalizeSelectableStrapPvOrigem,
  type SelectableStrapPvOrigem,
} from '@/lib/strapPvOrigem';

/**
 * Valores gravados no PV. `fabrica` SIGNIFICA Prestador desde a Revisão 2 de
 * `specs/tiras-redesenho.md` (a fábrica nunca corta tira); o enum do banco
 * não foi renomeado. `prestador` legado é a mesma origem.
 */
export type StrapPvOrigemChoice = SelectableStrapPvOrigem;

interface Props {
  label: string;
  /** Valor em vigor na linha: escolha explícita ou padrão do catálogo. */
  value: StrapPvOrigemChoice | 'prestador' | null;
  /** Padrão do catálogo (Hub) — o PV só troca na exceção (R2). */
  catalogDefault?: StrapPvOrigemChoice | null;
  onChange: (value: StrapPvOrigemChoice) => void;
  disabled?: boolean;
  /** Sem grupo acabado na ficha, comprar pronto não materializa (G03). */
  allowBuyReady?: boolean;
  /** Tira de identidade acabada (ex.: Strass da ficha) não tem napa para o prestador. */
  allowPrestador?: boolean;
}

/**
 * Seletor de origem da tira no item do PV: sempre visível, pré-selecionado
 * com o padrão do catálogo; a escolha explícita do PV vence o catálogo.
 */
export default function StrapPvOrigemChooser({
  label, value, catalogDefault, onChange, disabled, allowBuyReady = true, allowPrestador = true,
}: Props) {
  const selectable = normalizeSelectableStrapPvOrigem(value);
  const isException = !!selectable && !!catalogDefault && selectable !== catalogDefault;
  return (
    <div className="space-y-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Label className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Origem
        </Label>
        <Select
          value={selectable ?? undefined}
          disabled={disabled}
          onValueChange={(next) => {
            if (next === 'fabrica' && allowPrestador) onChange(next);
            if (next === 'sku_acabado' && allowBuyReady) onChange(next);
          }}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label={`Origem de ${label}`}>
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            {allowPrestador && (
              <SelectItem value="fabrica">{STRAP_PV_ORIGEM_LABEL.fabrica}</SelectItem>
            )}
            {allowBuyReady && (
              <SelectItem value="sku_acabado">{STRAP_PV_ORIGEM_LABEL.sku_acabado}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      {catalogDefault && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          {isException
            ? <>Exceção deste pedido · padrão do catálogo: <strong className="text-foreground">{STRAP_PV_ORIGEM_LABEL[catalogDefault]}</strong></>
            : <>Padrão do catálogo</>}
        </p>
      )}
    </div>
  );
}

interface BulkProps {
  onAllPrestador: () => void;
  onAllBuyReady: () => void;
  disabled?: boolean;
}

export function StrapPvOrigemBulkActions({ onAllPrestador, onAllBuyReady, disabled }: BulkProps) {
  return (
    <div className="flex flex-wrap gap-1">
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" disabled={disabled} onClick={onAllPrestador}>
        Todas prestador
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" disabled={disabled} onClick={onAllBuyReady}>
        Todas comprar pronto
      </Button>
    </div>
  );
}
