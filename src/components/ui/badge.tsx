import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Industrial Editorial Pro (22/05/2026): badges retangulares (rounded-sm),
// uppercase tracking-wide, font-bold pra peso editorial. Default = INK preto,
// vermelho squad reservado pra destructive. Outline com borda 1.5px decisive.
// F6 (22/05/2026): variants semânticos success/warning/info pra padronizar
// uso (antes cada componente usava green-500/amber-500 ad-hoc).
const badgeVariants = cva(
  "inline-flex items-center rounded-sm border-[1.5px] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background hover:bg-foreground/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90",
        success: "border-transparent bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]",
        warning: "border-transparent bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
        info: "border-transparent bg-[hsl(var(--info))] text-[hsl(var(--info-foreground))]",
        outline: "border-foreground/20 text-foreground bg-transparent",
        // Variantes soft (fundo claro + texto colorido) pra estados menos
        // urgentes (ex: "Aguardando" vs "Faturado"). Bordas 1.5px alinhadas
        // com a paleta soft.
        "success-soft": "border-[hsl(var(--success-soft-foreground))]/30 bg-[hsl(var(--success-soft))] text-[hsl(var(--success-soft-foreground))]",
        "warning-soft": "border-[hsl(var(--warning-soft-foreground))]/30 bg-[hsl(var(--warning-soft))] text-[hsl(var(--warning-soft-foreground))]",
        "destructive-soft": "border-[hsl(var(--destructive-soft-foreground))]/30 bg-[hsl(var(--destructive-soft))] text-[hsl(var(--destructive-soft-foreground))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
