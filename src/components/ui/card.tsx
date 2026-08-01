import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Industrial Editorial Pro 2.0 (29/05/2026): variants opt-in pra cards-hero.
// - default: borda 1.5px foreground/15 (atual, refinado em 22/05/2026)
// - editorial: surface-sharp (radius 2px + shadow-sharp seca)
// - stamp: surface-sharp-stamp (radius 2px + border 1.5px FULL foreground +
//   shadow-stamp deslocada 4x4) — statement editorial dramático
// - ink: surface-ink (fundo preto + texto paper) — pra cards-destaque
// - paper: surface-paper (off-white creme explícito)
const cardVariants = cva(
  "bg-card text-card-foreground",
  {
    variants: {
      variant: {
        default: "rounded-sm border-[1.5px] border-foreground/15",
        editorial: "surface-sharp",
        stamp: "surface-sharp-stamp",
        ink: "surface-ink",
        paper: "surface-paper",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /**
   * Nível semântico do heading (default h3, sem mudança visual). Use as="h2"
   * quando o card é a seção de topo logo abaixo do h1 da página, pra não
   * furar o outline de leitor de tela (salto h1→h3).
   */
  as?: 'h2' | 'h3' | 'h4';
}

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, as: Tag = 'h3', ...props }, ref) => (
    <Tag ref={ref} className={cn("text-base font-semibold leading-none tracking-tight", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />,
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants };
