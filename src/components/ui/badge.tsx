import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Industrial Editorial Pro (22/05/2026): badges retangulares (rounded-sm),
// uppercase tracking-wide, font-bold pra peso editorial. Default = INK preto,
// vermelho squad reservado pra destructive. Outline com borda 1.5px decisive.
const badgeVariants = cva(
  "inline-flex items-center rounded-sm border-[1.5px] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background hover:bg-foreground/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border-foreground/20 text-foreground bg-transparent",
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
