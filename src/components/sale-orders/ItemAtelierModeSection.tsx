/**
 * Cabedal complexo no item do PV: sempre prestador.
 * O preferido reutiliza outsourced_sectors (costura e aviamento).
 * Não cria coluna nova. Pedido já gravado como interno não é reescrito aqui.
 */
import { Truck } from '@phosphor-icons/react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useContractors, type Contractor } from '@/hooks/useContractors';
import { useAtelierContractorSectors, useAtelierReferenceConfig } from '@/hooks/useAtelier';
import { atelierContractorCanTake } from '@/lib/atelierAdmin';
import type { AtelierSector } from '@/lib/atelier';

const NONE = '__none__';

interface Props {
  referenceId: string | null | undefined;
  contractorId?: string | null;
  onContractor: (next: string | null) => void;
  disabled?: boolean;
}

export function ItemAtelierModeSection({
  referenceId,
  contractorId,
  onContractor,
  disabled,
}: Props) {
  const { data: config, isLoading } = useAtelierReferenceConfig(referenceId);
  const { data: contractors = [] } = useContractors();
  const { data: sectors = [] } = useAtelierContractorSectors();
  const street = (config?.rows ?? []).filter(
    (row) => row.active && (row.sector === 'costura_cabedal' || row.sector === 'aviamento'),
  );
  if (!referenceId || isLoading || street.length === 0) return null;

  const sector = (street[0]?.sector || 'costura_cabedal') as AtelierSector;
  const eligible = (contractors as Contractor[]).filter((person) =>
    person.active && atelierContractorCanTake(person, sector, sectors),
  );

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <p className="flex items-center gap-1 text-xs font-medium text-foreground">
        <Truck className="h-3.5 w-3.5" /> Prestador preferido
      </p>
      <p className="text-[11px] text-muted-foreground">
        Costura e aviamento deste cabedal vão para prestador. Dá para dividir no lançamento.
      </p>
      <Select
        value={contractorId || NONE}
        onValueChange={(value) => onContractor(value === NONE ? null : value)}
        disabled={disabled}
      >
        <SelectTrigger className="h-9" aria-label="Prestador preferido">
          <SelectValue placeholder="Escolher prestador" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Sem preferência</SelectItem>
          {eligible.map((person) => (
            <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {eligible.length === 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          Nenhum prestador ativo para este setor. Cadastre em Terceirizados.
        </p>
      )}
    </div>
  );
}
