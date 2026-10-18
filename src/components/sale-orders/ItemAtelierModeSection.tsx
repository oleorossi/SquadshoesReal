/**
 * Sugestão de modo Ateliê no item do PV (interno | prestador).
 * Só aparece quando a referência está no cadastro Ateliê (Costura/Aviamento).
 * O relatório pode sobrescrever o job antes do 1º OK.
 */
import { Factory, Truck } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
  ATELIER_EXECUTION_MODE_LABEL,
  type AtelierExecutionMode,
} from '@/lib/atelier';
import { useAtelierReferenceConfig } from '@/hooks/useAtelier';

interface Props {
  referenceId: string | null | undefined;
  value?: AtelierExecutionMode | null;
  onChange: (next: AtelierExecutionMode | null) => void;
  disabled?: boolean;
}

export function ItemAtelierModeSection({
  referenceId,
  value,
  onChange,
  disabled,
}: Props) {
  const { data: config, isLoading } = useAtelierReferenceConfig(referenceId);
  const streetActive = (config?.rows ?? []).some(
    (r) =>
      r.active
      && (r.sector === 'costura_cabedal' || r.sector === 'aviamento'),
  );

  if (!referenceId || isLoading || !streetActive) return null;

  const mode = value === 'internal' || value === 'contractor' ? value : null;

  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-xs font-medium text-foreground">Ateliê · onde faz Costura/Aviamento</p>
      <p className="text-[11px] text-muted-foreground">
        Sugestão para o pedido. Dá pra ajustar no relatório antes do primeiro OK.
      </p>
      <div className="inline-flex rounded-md border border-border p-0.5">
        {([
          { id: 'internal' as const, icon: Factory },
          { id: 'contractor' as const, icon: Truck },
        ]).map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(mode === id ? null : id)}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60',
              mode === id
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            <Icon className="h-3 w-3" />
            {ATELIER_EXECUTION_MODE_LABEL[id]}
          </button>
        ))}
      </div>
    </div>
  );
}
