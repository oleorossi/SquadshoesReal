import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Industrial Editorial Pro (22/05/2026): rounded-sm em vez de xl, font-bold
  // tracking-wide pra dar peso editorial. Tipografia decisiva, sem shadow.
  // min-h/min-w garantem alvo de toque mínimo (WCAG 2.5.5) mesmo com classes
  // utilitárias customizadas reduzindo h/w.
  // Micro-interação padrão (11/06/2026): `active:scale-[0.97]` dá feedback
  // tátil de clique em TODOS os botões (fonte única — antes era duplicado e
  // inconsistente por variante). `motion-reduce:*` respeita prefers-reduced-motion
  // (WCAG 2.3.3) zerando transição/scale pra quem desativa animações.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-bold tracking-wide ring-offset-background transition-all duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-[24px] min-w-[24px]",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background hover:bg-foreground/90",
        destructive: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border-[1.5px] border-foreground/20 bg-transparent hover:border-foreground hover:bg-foreground/5",
        secondary: "border-[1.5px] border-foreground/15 bg-card hover:bg-foreground/5",
        ghost: "hover:bg-foreground/5 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Industrial Editorial Pro 2.0 — opt-in variants pra hero CTAs.
        // editorial: bloco INK uppercase MONO statement.
        // editorial-outline: outline 1.5px foreground uppercase MONO.
        // editorial-red: bloco squad red uppercase MONO.
        editorial: "bg-foreground text-background font-mono uppercase tracking-widest text-[11px] hover:bg-foreground/90 shadow-sharp",
        "editorial-outline": "border-[1.5px] border-foreground bg-transparent font-mono uppercase tracking-widest text-[11px] text-foreground hover:bg-foreground hover:text-background",
        "editorial-red": "bg-primary text-primary-foreground font-mono uppercase tracking-widest text-[11px] hover:bg-primary/90 shadow-stamp-red",
      },
      size: {
        default: "h-10 min-h-11 px-5 py-2.5",
        sm: "h-9 min-h-9 px-4",
        lg: "h-12 min-h-11 px-10 text-base",
        icon: "h-10 w-10 min-h-11 min-w-11",
        // Variantes icon por densidade — usar em vez de className="h-7 w-7" ad-hoc.
        // Convenção (CLAUDE.md): xs=toolbar de tabela, sm=filter row, default/icon=header de página, lg=CTA modal.
        "icon-xs": "h-7 w-7",
        "icon-sm": "h-8 w-8",
        "icon-lg": "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
