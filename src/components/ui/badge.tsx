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
        // Industrial Editorial Pro 2.0 — variants opt-in
        // live: dot red animado + INK fundo + texto paper, pra realtime
        // mono: JetBrains Mono pra códigos/IDs/datas em telas-hero
        // ink: bloco INK puro (statement decisivo)
        live: "border-transparent bg-foreground text-background font-mono tracking-wider gap-1.5 before:content-[''] before:block before:w-1.5 before:h-1.5 before:rounded-full before:bg-primary before:animate-pulse-slow",
        mono: "border-foreground/20 bg-card text-foreground font-mono tracking-wider",
        ink: "border-transparent bg-foreground text-background font-mono tracking-widest",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

// Bug fix 23/05/2026: function component sem forwardRef quebra quando
// usado dentro de `<TooltipTrigger asChild>` / `<SlotClone>` (Radix usa
// Slot que tenta passar ref pro filho). Resultado: warning "Function
// components cannot be given refs" + ref descartada silenciosamente.
const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
