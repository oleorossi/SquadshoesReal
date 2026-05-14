/**
 * RefChip — badge monoespaçado com o código de referência do modelo.
 * Componente do design system "Novidade" (handoff Squad Shoes).
 *
 * Aparece em listas, fichas, etiquetas, OPs — qualquer lugar que mostre
 * um código de referência (ex: REF I901). A prop chama `code`, não `ref`,
 * porque `ref` é reservada no React.
 *
 * Cores via design tokens: variant 'ink' = bg-foreground (preto editorial),
 * variant 'red' = bg-primary (vermelho Squad).
 */
import { cn } from '@/lib/utils';

interface RefChipProps {
  code: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ink' | 'red';
  /** Prefixo antes do código. Default 'REF'. Passe '' pra omitir. */
  prefix?: string;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<RefChipProps['size']>, string> = {
  sm: 'text-[9px] px-1.5 py-0.5 tracking-[0.08em]',
  md: 'text-[10px] px-2 py-0.5 tracking-[0.08em]',
  lg: 'text-xs px-2.5 py-1 tracking-[0.08em]',
};

export function RefChip({ code, size = 'sm', variant = 'ink', prefix = 'REF', className }: RefChipProps) {
  return (
    <span
      className={cn(
        'inline-block font-mono font-bold leading-none whitespace-nowrap rounded-[2px]',
        variant === 'red' ? 'bg-primary text-primary-foreground' : 'bg-foreground text-background',
        SIZE_CLASSES[size],
        className,
      )}
    >
      {prefix ? `${prefix} ` : ''}{code}
    </span>
  );
}
