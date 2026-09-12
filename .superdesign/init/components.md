# Shared UI primitives (PV-critical)
Framework: React 18 + Vite. Component library: shadcn/ui (Radix + cva) with Industrial Editorial Pro tokens. Icons: @phosphor-icons/react. CSS: Tailwind + CSS variables in src/index.css.

## `src/components/ui/button.tsx`
- Path: `src/components/ui/button.tsx`
- Lines: 67

```tsx
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
        default: "h-10 px-5 py-2.5",
        sm: "h-9 px-4",
        lg: "h-12 px-10 text-base",
        icon: "h-10 w-10",
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

```

## `src/components/ui/input.tsx`
- Path: `src/components/ui/input.tsx`
- Lines: 51

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onFocus, onClick, onWheel, step, ...props }, ref) => {
    const isNumber = type === "number";

    return (
      <input
        type={type}
        step={isNumber ? (step ?? "any") : step}
        onFocus={(e) => {
          if (isNumber) e.currentTarget.select();
          onFocus?.(e);
        }}
        onClick={(e) => {
          if (isNumber) setTimeout(() => e.currentTarget.select(), 0);
          onClick?.(e);
        }}
        onWheel={(e) => {
          // Roda do mouse sobre input numérico FOCADO altera o valor sem o
          // usuário perceber (comportamento nativo do type="number") — em grade
          // de PV isso corrompe quantidade silenciosamente. Blur cancela o
          // spin sem bloquear o scroll da página.
          if (isNumber && e.currentTarget === document.activeElement) {
            e.currentTarget.blur();
          }
          onWheel?.(e);
        }}
        className={cn(
          // Industrial Editorial Pro (22/05/2026): borda 1.5px decisive em vez
          // de border default + rounded-sm. Focus: borda foreground sólida (sem
          // ring colorido em volta — borda mais decisive). Mono font pra numéricos.
          // Vermelho de "inválido" SÓ via aria-invalid (validação explícita do
          // react-hook-form/zod). Removido o `invalid:` NATIVO — ele pintava
          // QUALQUER campo `required` VAZIO de vermelho em repouso (parecia erro
          // antes de digitar). Agora campo vazio fica neutro até o form validar.
          "flex h-9 w-full rounded-sm border-[1.5px] border-foreground/15 bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm aria-[invalid=true]:border-primary",
          isNumber && "font-mono tabular-nums",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };

```

## `src/components/ui/textarea.tsx`
- Path: `src/components/ui/textarea.tsx`
- Lines: 21

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/50 invalid:border-destructive invalid:ring-destructive/50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };

```

## `src/components/ui/label.tsx`
- Path: `src/components/ui/label.tsx`
- Lines: 17

```tsx
import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const labelVariants = cva("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70");

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };

```

## `src/components/ui/badge.tsx`
- Path: `src/components/ui/badge.tsx`
- Lines: 57

```tsx
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
        // mono: Fira Code pra códigos/IDs/datas em telas-hero
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

```

## `src/components/ui/card.tsx`
- Path: `src/components/ui/card.tsx`
- Lines: 84

```tsx
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

```

## `src/components/ui/dialog.tsx`
- Path: `src/components/ui/dialog.tsx`
- Lines: 151

```tsx
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from '@phosphor-icons/react';

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-modal bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Quando Dialog está aberto, Enter aciona o botão primário declarado:
 *   - <button type="submit"> (forms já fazem isso nativamente, mas alguns
 *     Dialogs põem o submit-equivalent sem form wrapping)
 *   - Elemento com data-dialog-primary="true" (atribua explicitamente no
 *     botão "Salvar"/"Confirmar"/"Adicionar" pra ativar)
 *
 * Ignora:
 *   - Enter em <textarea> (newline)
 *   - Enter com Shift/Ctrl/Alt/Meta (atalhos reservados)
 *   - Dialog que já tem <form> com submit listener (deixa o form nativo agir)
 */
function handleDialogEnter(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "Enter") return;
  if (e.defaultPrevented) return;
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const target = e.target as HTMLElement;
  if (target.tagName === "TEXTAREA") return;
  // Enter num botão focado ativa o PRÓPRIO botão (Cancelar, X, SelectTrigger…)
  // — nunca sequestrar pro primário, senão "Cancelar" vira "Salvar" no teclado
  if (target.tagName === "BUTTON" || target.closest('[aria-haspopup],[role="combobox"]')) return;
  // Se está dentro de form, deixa o submit nativo agir (não interfere)
  if (target.closest("form")) return;
  // Procura botão primário explícito
  const primary =
    e.currentTarget.querySelector<HTMLButtonElement>(
      '[data-dialog-primary="true"]',
    ) ||
    e.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (primary && !primary.disabled) {
    e.preventDefault();
    primary.click();
  }
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Esconde o X padrão (16px, canto) — use quando o diálogo traz o próprio fechar. */
    hideCloseButton?: boolean;
  }
>(({ className, children, onKeyDown, hideCloseButton = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Industrial Editorial Pro (22/05/2026): dialog com borda 2px decisive
        // INK em vez de shadow-lg, rounded-sm (era lg). Bg PAPER (background).
        // Sem zoom/slide animations excessivas — só fade.
        // max-h em dvh (não vh): no mobile o vh inclui a barra do browser e o
        // rodapé do dialog (botões de confirmação) ficaria escondido sob ela.
        "fixed left-[50%] top-[50%] z-modal grid w-[95vw] max-w-3xl translate-x-[-50%] translate-y-[-50%] gap-3 sm:gap-4 border-[2px] border-foreground bg-background p-4 sm:p-6 duration-150 max-h-[90dvh] overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 rounded-sm",
        className,
      )}
      onKeyDown={(e) => {
        handleDialogEnter(e);
        onKeyDown?.(e);
      }}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close aria-label="Fechar diálogo" className="absolute right-4 top-4 p-2 -m-2 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

// `sm:flex-wrap` (29/07/2026): sem ele a fileira de botões é indivisível e vira
// a largura MÍNIMA do DialogContent — que é grid, então a coluna estica até o
// rodapé e arrasta junto todos os irmãos (cards, alerts), cortando o que passa
// da moldura. Sintoma no SectorOverloadDialog (4 botões p/ admin): scroll
// horizontal dentro do modal e conteúdo invisível à direita.
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  // Industrial Editorial Pro: título em ed-display (Anton uppercase) com
  // tamanho compacto. Espelha a hierarquia do EditorialPageHeader.
  <DialogPrimitive.Title
    ref={ref}
    className={cn("ed-display text-2xl text-foreground leading-none", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};

```

## `src/components/ui/checkbox.tsx`
- Path: `src/components/ui/checkbox.tsx`
- Lines: 26

```tsx
import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from '@phosphor-icons/react';

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/50",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };

```

## `src/components/ui/empty-state.tsx`
- Path: `src/components/ui/empty-state.tsx`
- Lines: 66

```tsx
import { ReactNode } from 'react';
import { Icon as LucideIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** Ícone Lucide pra exibir no topo (h-12 w-12 dentro de bg-muted/60). */
  icon?: LucideIcon;
  /** Título principal (font-semibold, text-base). */
  title: string;
  /** Descrição opcional (text-sm muted, max-w-xs). */
  description?: string;
  /** Ação primária opcional (CTA) — pode ser Button, Link, etc. */
  action?: ReactNode;
  /** Padding vertical (default py-16). Use 'sm' pra py-8 em containers pequenos. */
  size?: 'sm' | 'default';
  className?: string;
}

/**
 * EmptyState — placeholder unificado pra listas/tabelas vazias.
 *
 * Substitui ~23 variantes ad-hoc espalhadas no projeto que usavam
 * combinações soltas de Card + ícone + texto. Garante consistência
 * visual: ícone em circle bg-muted, título font-semibold, descrição
 * muted small, espaçamento padrão.
 *
 * Uso:
 * ```tsx
 * <EmptyState
 *   icon={Package}
 *   title="Nenhum produto encontrado"
 *   description="Tente ajustar os filtros ou cadastre um novo produto."
 *   action={<Button onClick={openCreate}>Novo produto</Button>}
 * />
 * ```
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'default',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center gap-3 px-6',
        size === 'sm' ? 'py-8' : 'py-16',
        className,
      )}
      role="status"
    >
      {Icon && (
        <div className="h-12 w-12 rounded-2xl bg-muted/60 flex items-center justify-center text-muted-foreground/50 mb-1">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
      )}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

```

## `src/components/ui/panel.tsx`
- Path: `src/components/ui/panel.tsx`
- Lines: 56

```tsx
/**
 * Panel — contêiner de seção do design system "Novidade Editorial".
 *
 * Substitui o padrão `<Card><CardHeader><CardTitle>` para blocos de
 * conteúdo (tabelas, listas, gráficos). Header editorial com eyebrow
 * opcional + título + slot de ações, separado do corpo por uma rule.
 *
 * Chrome 100% via design tokens. Para tabelas, passe `flush` (remove o
 * padding do corpo) — a tabela encosta nas bordas.
 */
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PanelProps {
  /** Eyebrow ALL-CAPS acima do título (ex: "PRODUÇÃO · ONDAS"). */
  eyebrow?: string;
  /** Título do painel. */
  title?: ReactNode;
  /** Subtítulo / descrição curta abaixo do título. */
  subtitle?: ReactNode;
  /** Slot direito do header — botões, filtros, badges. */
  actions?: ReactNode;
  /** Remove o padding do corpo (ideal para tabelas full-bleed). */
  flush?: boolean;
  children: ReactNode;
  className?: string;
  /** Classes extras no corpo. */
  bodyClassName?: string;
}

export function Panel({
  eyebrow, title, subtitle, actions, flush, children, className, bodyClassName,
}: PanelProps) {
  const hasHeader = eyebrow || title || subtitle || actions;
  return (
    <div className={cn('bg-card border border-border rounded-lg overflow-hidden', className)}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
          <div className="min-w-0 space-y-0.5">
            {eyebrow && <div className="section-label">{eyebrow}</div>}
            {title && (
              <h3 className="text-sm font-bold tracking-tight text-foreground leading-tight">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn(!flush && 'p-4', bodyClassName)}>{children}</div>
    </div>
  );
}

```

## `src/components/ui/table.tsx`
- Path: `src/components/ui/table.tsx`
- Lines: 91

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  // Industrial Editorial Pro: header com regra preta 1.5px decisive.
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b-[1.5px] [&_tr]:border-foreground", className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("border-b transition-colors data-[state=selected]:bg-muted hover:bg-muted/50", className)}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  // Industrial Editorial Pro: header cells em eyebrow style (10px uppercase
  // tracking wider, Fira Code via font-mono). Mais compactos (h-10) e
  // foreground sólido em vez de muted.
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      // Acessibilidade: scope="col" por padrão (leitor de tela associa célula ao
      // header). Sobrescrever com scope="row" em headers de linha.
      scope="col"
      className={cn(
        "h-10 px-4 text-left align-middle text-[10px] font-bold uppercase tracking-wider text-foreground font-mono [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /**
   * Célula numérica (R$, quantidades): text-right + tabular-nums pra coluna
   * não "dançar" entre linhas. Use em toda célula de valor/moeda.
   */
  numeric?: boolean;
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric, ...props }, ref) => (
    <td
      ref={ref}
      className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", numeric && "text-right tabular-nums", className)}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };

```

## `src/components/ui/select.tsx`
- Path: `src/components/ui/select.tsx`
- Lines: 373

```tsx
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, CaretDown as ChevronDown, CaretUp as ChevronUp } from '@phosphor-icons/react';

import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import { searchMatchesAllTerms } from "@/lib/searchUtils";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      // Industrial Editorial Pro: borda 1.5px decisive + rounded-sm.
      // Focus: borda foreground sólida sem ring colorido (igual Input).
      // 44px no mobile evita alvo de toque apertado; no desktop, h-9 alinha com
      // Input e SearchableSelect sem desperdiçar altura em telas operacionais.
      "flex h-11 w-full items-center justify-between rounded-sm border-[1.5px] border-foreground/15 bg-background px-3 py-2 text-base md:h-9 md:text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:border-foreground focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 aria-[invalid=true]:border-primary",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

interface SelectContentProps extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> {
  /**
   * `auto` ativa a busca quando a lista ultrapassa `searchThreshold` itens.
   * Use `true` para forçar ou `false` para manter um seletor curto sem busca.
   */
  searchable?: boolean | 'auto';
  /** Quantidade de opções a partir da qual `searchable="auto"` é ativado. */
  searchThreshold?: number;
  /** Placeholder específico do catálogo, ex.: "Buscar produto, SKU ou cor…". */
  searchPlaceholder?: string;
  /** Rótulo curto exibido acima da busca. */
  searchLabel?: string;
  /** Mensagem exibida quando nenhuma opção corresponde à busca. */
  searchEmptyText?: string;
}

interface FilteredSelectNodes {
  nodes: React.ReactNode;
  totalItems: number;
  matchedItems: number;
}

function textFromReactNode(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromReactNode).join(' ');
  if (!React.isValidElement(node)) return '';
  return textFromReactNode((node.props as { children?: React.ReactNode }).children);
}

function isSelectItemElement(node: React.ReactNode): node is React.ReactElement<
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
> {
  if (!React.isValidElement(node)) return false;
  const elementType = node.type as { displayName?: string };
  return node.type === SelectItem || elementType?.displayName === SelectItem.displayName;
}

/**
 * Percorre também SelectGroup/Fragment, preservando os grupos que ainda têm
 * resultados. Como o filtro acontece nos React children, as opções que não
 * casam nem entram no Collection do Radix: teclado e leitor de tela enxergam
 * exatamente a mesma lista que o usuário vê.
 */
function filterSelectNodes(children: React.ReactNode, query: string): FilteredSelectNodes {
  let totalItems = 0;
  let matchedItems = 0;
  const hasQuery = query.trim().length > 0;

  const nodes = React.Children.map(children, (child) => {
    if (isSelectItemElement(child)) {
      totalItems += 1;
      const props = child.props as React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
        'aria-label'?: string;
      };
      const matches = !hasQuery || searchMatchesAllTerms(
        query,
        props.textValue,
        props.value,
        props['aria-label'],
        textFromReactNode(props.children),
      );
      if (matches) matchedItems += 1;
      return matches ? child : null;
    }

    if (!React.isValidElement(child)) return child;
    const props = child.props as { children?: React.ReactNode };
    if (props.children == null) {
      // Separadores soltos não agregam informação durante um refinamento.
      if (hasQuery && child.type === SelectSeparator) return null;
      return child;
    }

    const nested = filterSelectNodes(props.children, query);
    totalItems += nested.totalItems;
    matchedItems += nested.matchedItems;

    // Se este elemento agrupava opções e nenhuma casou, remove o grupo inteiro
    // (inclusive label/separadores), evitando cabeçalhos órfãos.
    if (nested.totalItems > 0 && nested.matchedItems === 0) return null;
    return React.cloneElement(child, undefined, nested.nodes);
  });

  return { nodes, totalItems, matchedItems };
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(({
  className,
  children,
  position = "popper",
  searchable = 'auto',
  searchThreshold = 8,
  searchPlaceholder = 'Buscar nesta lista…',
  searchLabel = 'Localizar opção',
  searchEmptyText = 'Nenhuma opção encontrada.',
  onEscapeKeyDown,
  onKeyDownCapture,
  ...props
}, ref) => {
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const contentRef = React.useRef<React.ElementRef<typeof SelectPrimitive.Content>>(null);
  const filtered = React.useMemo(() => filterSelectNodes(children, query), [children, query]);
  const searchEnabled = searchable === true || (searchable === 'auto' && filtered.totalItems >= searchThreshold);

  const setContentRef = React.useCallback((node: React.ElementRef<typeof SelectPrimitive.Content> | null) => {
    contentRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const focusFirstVisibleOption = () => {
    const firstOption = contentRef.current?.querySelector<HTMLElement>('[role="option"]:not([data-disabled])');
    firstOption?.focus();
  };

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={setContentRef}
        className={cn(
          // Industrial Editorial Pro: popover com borda 1.5px decisive em vez
          // de shadow-md, rounded-sm. Animations só fade (sem zoom/slide).
          // max-h respeita a altura disponível calculada pelo Radix (teclado
          // virtual/landscape), com teto de 24rem no desktop.
          "relative z-popover max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[8rem] overflow-hidden rounded-sm border-[1.5px] border-foreground bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event);
          if (event.defaultPrevented || !query) return;
          event.preventDefault();
          setQuery('');
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onKeyDownCapture={(event) => {
          onKeyDownCapture?.(event);
          if (event.defaultPrevented || !searchEnabled) return;

          // O Radix trata Esc antes do bubble do Input. Interceptar aqui faz o
          // primeiro Esc apenas limpar o refinamento; com a busca vazia, o
          // próximo Esc volta ao comportamento nativo e fecha a lista.
          if (event.key === 'Escape' && query) {
            event.preventDefault();
            event.stopPropagation();
            setQuery('');
            inputRef.current?.focus();
            return;
          }

          if (event.target === inputRef.current) {
            return;
          }

          // Digitar com uma opção focada transfere o texto para a busca, em vez
          // de acionar o typeahead de uma letra do Radix.
          const isPrintable = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
          if (isPrintable) {
            event.preventDefault();
            event.stopPropagation();
            setQuery((current) => current + event.key);
            inputRef.current?.focus();
          }
        }}
        {...props}
      >
        {searchEnabled && (
          <div className="border-b border-foreground/10 bg-muted-soft p-2" data-select-search>
            <div className="mb-1 flex items-center justify-between gap-3 px-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span>{searchLabel}</span>
              <span aria-live="polite" className="shrink-0 tabular-nums">
                {query ? `${filtered.matchedItems} de ` : ''}{filtered.totalItems.toLocaleString('pt-BR')}
              </span>
            </div>
            <SearchInput
              ref={inputRef}
              value={query}
              onChange={setQuery}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              hideHint
              disableSlashFocus
              className="w-full"
              inputClassName="h-11 bg-background sm:h-8"
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  event.stopPropagation();
                  focusFirstVisibleOption();
                  return;
                }
                // O primeiro Esc limpa a busca (SearchInput); o segundo fecha o
                // seletor pelo comportamento nativo do Radix.
                if (event.key === 'Escape' && query) {
                  event.stopPropagation();
                  return;
                }
                if (event.key !== 'Tab') event.stopPropagation();
              }}
            />
          </div>
        )}
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {filtered.matchedItems > 0 || !searchEnabled ? filtered.nodes : (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground" role="status">
              {searchEmptyText}
            </div>
          )}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)} {...props} />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

/**
 * Sentinela usado quando algum SelectItem é renderizado com value vazio,
 * null ou undefined. Radix proíbe value="" (empty string é reservado pra
 * "limpar seleção"), e qualquer linha com value inválido **crasha** o app
 * inteiro com a exceção `A <Select.Item /> must have a value prop that is
 * not an empty string`. Em vez de deixar o app cair quando dados sujos do
 * banco chegam (department='', refs com id ausente, etc), substituímos
 * por essa sentinela e logamos um warning em DEV.
 */
const __INVALID_VALUE_SENTINEL = '__invalid_select_value__';

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, value, ...props }, ref) => {
  // Guard universal: value '' / null / undefined / só-whitespace é inválido.
  const isInvalid = value == null || (typeof value === 'string' && value.trim() === '');
  if (isInvalid) {
    if (import.meta.env.DEV) {

      console.warn(
        '[SelectItem] value vazio detectado — substituído por sentinela. ' +
          'Origem provável: dado sujo (ex: department="" no DB) sendo passado direto pro value. ' +
          'Filtre antes de mapear ou use uma sentinela explícita (ex: "all", "none"). children:',
        children,
      );
    }
  }
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex min-h-11 w-full cursor-default select-none items-center rounded-sm py-2.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground md:min-h-0 md:py-1.5",
        className,
      )}
      value={isInvalid ? __INVALID_VALUE_SENTINEL : (value as string)}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>

      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};

```

## `src/components/ui/dropdown-menu.tsx`
- Path: `src/components/ui/dropdown-menu.tsx`
- Lines: 179

```tsx
import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, CaretRight as ChevronRight, Circle } from '@phosphor-icons/react';

import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-popover min-w-[8rem] overflow-hidden rounded-sm border-[1.5px] border-foreground bg-popover p-1 text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-popover min-w-[8rem] overflow-hidden rounded-sm border-[1.5px] border-foreground bg-popover p-1 text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn("ml-auto text-xs tracking-widest opacity-60", className)} {...props} />;
};
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
};

```

## `src/components/ui/number-input.tsx`
- Path: `src/components/ui/number-input.tsx`
- Lines: 126

```tsx
import * as React from "react";
import { cn, parseSafeNumber, safeToFixed } from "@/lib/utils";

interface NumberInputProps {
  value: number | string | null | undefined;
  onChange: (value: number) => void;
  id?: string;
  className?: string;
  required?: boolean;
  min?: number;
  step?: string;
  placeholder?: string;
  decimals?: number;
  disabled?: boolean;
  /**
   * Unidade de medida exibida dentro do campo, à direita (ex: 'kg', 'm',
   * 'dm²', 'par', 'g/par'). Quando informada, o input ganha padding-right
   * pra não sobrepor o texto. Documentar a unidade no input mata erros
   * de cadastro como "14" digitado achando que era gramas mas o produto
   * estava em kg.
   */
  unit?: string;
  /** Foca o campo automaticamente ao montar (ex.: input de quantidade que abre
   *  em dialog). Opcional — sem efeito nos demais usos. */
  autoFocus?: boolean;
  /** Teclado virtual: `numeric` pra inteiros (grade), `decimal` pro resto. */
  inputMode?: 'decimal' | 'numeric';
}

export function NumberInput({ value, onChange, id, className, required, min = 0, step = "0.0001", placeholder, decimals = 6, disabled, unit, autoFocus, inputMode = 'decimal' }: NumberInputProps) {
  const [displayValue, setDisplayValue] = React.useState("");

  const formatValue = (num: number | string | null | undefined): string => {
    const safeNum = parseSafeNumber(num);
    // Guard: only finite numbers reach toFixed. Anything else renders as empty.
    if (!Number.isFinite(safeNum) || safeNum === 0) return "";
    // Mostra até `decimals` casas, tirando zeros à direita SÓ da parte decimal.
    //
    // ⚠ Bug 2026-08-03: o regex antigo era /\.?0+$/, com o ponto OPCIONAL — em
    // `decimals={0}` o toFixed não produz ponto nenhum, então ele comia os zeros
    // do INTEIRO: 600 virava "6", 350 virava "35", 500 virava "5". Pegou os 29
    // call-sites com decimals={0} (capacidade por setor, matriz do PV, grade de
    // solado, apontamento do Kanban…) — o valor gravado seguia certo, mas a tela
    // mostrava outro número, então ninguém confiava no que estava cadastrado.
    // Agora o ponto é OBRIGATÓRIO no match: inteiro nunca é tocado.
    const str = safeToFixed(safeNum, decimals)
      .replace(/(\.\d*?)0+$/, "$1")  // 1.500 → 1.5   |  600 → 600 (não casa)
      .replace(/\.$/, "");           // 1.000 → "1." → "1"
    return str;
  };

  React.useEffect(() => {
    setDisplayValue(formatValue(value));
  }, []);

  const prevValueRef = React.useRef(value);
  React.useEffect(() => {
    if (prevValueRef.current !== value) {
      setDisplayValue(formatValue(value));
      prevValueRef.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Vírgula (locale BR) → ponto decimal.
    let raw = e.target.value.replace(',', '.');
    // Aceita só dígitos e UM ponto. Rejeita o resto SEM bloquear o decimal
    // (permite "12.", "0.", "0.0", "0.05" — estados intermediários da digitação).
    if (!/^\d*\.?\d*$/.test(raw)) return;
    // Tira zeros à esquerda, mas preserva "0", "0." e "0.x".
    if (/^0\d/.test(raw)) raw = raw.replace(/^0+/, '');
    setDisplayValue(raw);
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) {
      prevValueRef.current = parsed;
      onChange(parsed);
    } else {
      // raw vazio ou só "." — vale 0, mas mantém o que o usuário digitou no display.
      prevValueRef.current = 0;
      onChange(0);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Seleciona tudo: o 1º caractere digitado SUBSTITUI o valor atual (não
    // concatena). Resolve "comecei a digitar e o número velho não some".
    e.target.select();
  };

  const handleBlur = () => {
    setDisplayValue(formatValue(value));
  };

  const input = (
    <input
      id={id}
      type="text"
      inputMode={inputMode}
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      required={required}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={placeholder || "0"}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm font-mono",
        unit && "pr-9",
        className
      )}
    />
  );
  if (!unit) return input;
  return (
    <div className="relative">
      {input}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {unit}
      </span>
    </div>
  );
}

```

## `src/components/ui/search-input.tsx`
- Path: `src/components/ui/search-input.tsx`
- Lines: 231

```tsx
import * as React from 'react';
import { MagnifyingGlass as Search, X } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * SearchInput — barra de busca PADRÃO do sistema (spec melhorias-busca-sistema).
 *
 * Toda busca de tela/dialog usa este componente com `searchMatchesAllTerms`
 * (filtro local) ou `searchNormOrFilter` (server-side). Provê:
 * - lupa + botão × pra limpar (só com texto);
 * - placeholder específico por tela ("Buscar por referência, cliente, cor…");
 * - hint do refinamento (espaço/"/" = termos AND) no ícone da lupa;
 * - contador "N de M" quando `totalCount` é passado e há query ativa;
 * - debounce opcional (`debounceMs` — use ~300 pra busca server-side);
 * - atalho global "/" foca a busca visível mais recente (dialogs têm prioridade
 *   por montarem depois). Dentro de um campo editável, "/" é caractere normal.
 */

const HINT_TEXT =
  'Espaço ou "/" combinam termos: "stx alcineu" acha o registro que contém os dois. ' +
  'Acentos, maiúsculas e pontuação são ignorados.';

// ── Atalho "/" ──────────────────────────────────────────────────────────────
// Registry módulo-level: cada SearchInput montado (sem disableSlashFocus) entra
// aqui; o listener único foca o ÚLTIMO registrado que esteja visível — dialogs
// montam por último, então ganham do fundo da tela, que é o esperado.
const slashTargets: HTMLInputElement[] = [];
let slashListenerAttached = false;

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function handleSlashKey(e: KeyboardEvent) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (isEditableTarget(e.target)) return;
  for (let i = slashTargets.length - 1; i >= 0; i--) {
    const el = slashTargets[i];
    // offsetParent === null ⇒ escondido (display:none / aba inativa)
    if (el.isConnected && el.offsetParent !== null) {
      e.preventDefault();
      el.focus();
      el.select();
      return;
    }
  }
}

function registerSlashTarget(el: HTMLInputElement) {
  slashTargets.push(el);
  if (!slashListenerAttached) {
    document.addEventListener('keydown', handleSlashKey);
    slashListenerAttached = true;
  }
  return () => {
    const idx = slashTargets.indexOf(el);
    if (idx >= 0) slashTargets.splice(idx, 1);
    if (slashTargets.length === 0 && slashListenerAttached) {
      document.removeEventListener('keydown', handleSlashKey);
      slashListenerAttached = false;
    }
  };
}

export interface SearchInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onKeyDown' | 'onFocus'> {
  value: string;
  onChange: (value: string) => void;
  /** Diga O QUE a tela busca: "Buscar por referência, cliente, cor…" */
  placeholder?: string;
  /** Resultados após o filtro — exibe "N de M" junto com totalCount. */
  resultCount?: number;
  /** Total sem filtro — exibe "N de M" quando há query ativa. */
  totalCount?: number;
  /** Debounce do onChange em ms. 0 = imediato (filtro local); ~300 p/ server. */
  debounceMs?: number;
  /** Esconde o tooltip de dica do refinamento. */
  hideHint?: boolean;
  /** Não participa do atalho global "/" (raro — buscas secundárias). */
  disableSlashFocus?: boolean;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  'aria-label'?: string;
  id?: string;
  /** Rótulo da tecla Enter no teclado virtual (mobile) — ex.: 'search'. */
  enterKeyHint?: React.InputHTMLAttributes<HTMLInputElement>['enterKeyHint'];
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onChange,
      placeholder = 'Buscar…',
      resultCount,
      totalCount,
      debounceMs = 0,
      hideHint = false,
      disableSlashFocus = false,
      className,
      inputClassName,
      autoFocus,
      onKeyDown,
      onFocus,
      id,
      enterKeyHint,
      'aria-label': ariaLabel,
      // rest vai pro wrapper div — necessário p/ composição via Slot/asChild
      // (ex.: SmartSearch embrulha em PopoverTrigger, que injeta handlers).
      ...rest
    },
    forwardedRef,
  ) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    // Estado local pro debounce: a digitação atualiza `local` na hora; o
    // onChange do consumidor dispara depois de `debounceMs`.
    const [local, setLocal] = React.useState(value);
    React.useEffect(() => setLocal(value), [value]);
    React.useEffect(() => {
      if (!debounceMs || local === value) return;
      const t = setTimeout(() => onChange(local), debounceMs);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [local, debounceMs]);

    const handleChange = (v: string) => {
      setLocal(v);
      if (!debounceMs) onChange(v);
    };

    const clear = () => {
      setLocal('');
      onChange(''); // limpar não espera debounce
      inputRef.current?.focus();
    };

    React.useEffect(() => {
      if (disableSlashFocus) return;
      const el = inputRef.current;
      if (!el) return;
      return registerSlashTarget(el);
    }, [disableSlashFocus]);

    const showCounter = totalCount != null && local.trim().length > 0;

    return (
      <div className={cn('relative', className)} {...rest}>
        {hideHint ? (
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
          />
        ) : (
          /* Provider próprio: o componente precisa funcionar também fora do
             TooltipProvider global (testes isolados, portais). Aninhar é ok. */
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={-1}
                  aria-label="Dica de busca"
                  className="absolute left-3 top-1/2 -translate-y-1/2 cursor-help"
                >
                  <Search aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-[280px] text-xs">
                {HINT_TEXT}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Input
          ref={inputRef}
          id={id}
          value={local}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            // Consumidor primeiro (ex.: SmartSearch fecha o popover com Esc);
            // se ele tratou (preventDefault), não limpamos por cima.
            onKeyDown?.(e);
            if (e.defaultPrevented) return;
            if (e.key === 'Escape' && local) {
              e.preventDefault();
              e.stopPropagation();
              clear();
            }
          }}
          onFocus={onFocus}
          placeholder={placeholder}
          autoFocus={autoFocus}
          enterKeyHint={enterKeyHint}
          autoComplete="off"
          aria-label={ariaLabel ?? placeholder}
          className={cn(
            'h-11 pl-9 md:h-9',
            showCounter ? 'pr-[6.5rem]' : local ? 'pr-9' : 'pr-3',
            inputClassName,
          )}
        />
        {showCounter && (
          <span
            aria-live="polite"
            className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-muted-foreground whitespace-nowrap"
          >
            {(resultCount ?? 0).toLocaleString('pt-BR')} de {totalCount.toLocaleString('pt-BR')}
          </span>
        )}
        {local && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Limpar busca"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = 'SearchInput';

```

## `src/lib/utils.ts`
- Path: `src/lib/utils.ts`
- Lines: 230

```tsx
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Strip duplicated color suffix from product name (e.g. "Material: Cor" → "Material" when color="Cor") */
export function stripColorFromName(name: string, color?: string | null): string {
  if (!color || !name) return name;
  const colors = color.split(/[,;]/).map(c => c.trim()).filter(Boolean);
  let clean = name;
  for (const c of colors) {
    clean = clean.replace(new RegExp(`[:\\-–]\\s*${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim();
  }
  return clean;
}

/** Normalize sole names by preserving the model name and removing only the explicit color suffix when provided */
export function getSoleModelName(name: string, color?: string | null): string {
  const raw = (name || '').trim();
  // 1. If color field is provided, strip it
  let normalized = stripColorFromName(raw, color).trim();
  // 2. If color was empty or stripping had no effect, fallback: strip last " - <word(s)>" suffix
  if (!color || normalized === raw) {
    const dashIdx = normalized.lastIndexOf(' - ');
    if (dashIdx > 0) {
      normalized = normalized.substring(0, dashIdx).trim();
    }
  }
  return normalized || raw;
}

/** Convert empty strings to null for UUID and date columns before sending to the database */
export function sanitizeUuidFields(obj: Record<string, any>): Record<string, any> {
  const DATE_KEYS = ['data_ultima_revisao', 'data_aprovacao', 'approved_at', 'completed_at', 'started_at', 'payment_date', 'issue_date', 'invoice_date', 'admission_date', 'advance_date', 'holiday_date'];
  const result = { ...obj };
  for (const [key, value] of Object.entries(result)) {
    if (key.endsWith('_id') && value === '') {
      result[key] = null;
    }
    if ((DATE_KEYS.includes(key) || key.startsWith('data_') || key.endsWith('_date') || key.endsWith('_at')) && value === '') {
      result[key] = null;
    }
  }
  return result;
}

/**
 * Dev-only warning when a non-finite/invalid value reaches a numeric formatter.
 * Throttled per (label + value-type) so the console isn't flooded.
 * No-op in production builds.
 */
const __nonFiniteWarned = new Set<string>();
function warnNonFinite(val: any, label: string): void {
  if (typeof import.meta === 'undefined' || !(import.meta as any).env?.DEV) return;
  const key = `${label}|${typeof val}|${val === null ? 'null' : val === undefined ? 'undef' : String(val).slice(0, 40)}`;
  if (__nonFiniteWarned.has(key)) return;
  __nonFiniteWarned.add(key);

  console.warn(
    `[ficha-tecnica/${label}] Non-finite value coerced to fallback. ` +
    `Received: ${typeof val} →`, val,
  );
  // Notify any UI listener (dev-only banner / toast on the ficha técnica page).
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('ficha-tecnica:non-finite', {
          detail: {
            label,
            valueType: typeof val,
            value: val === null || val === undefined ? String(val) : String(val).slice(0, 80),
            timestamp: Date.now(),
          },
        }),
      );
    } catch {
      // ignore — never break runtime because of dev instrumentation
    }
  }
}

/**
 * Safe numeric conversion for string/number/null/undefined values before `toFixed`
 * or any math. Returns `fallback` for null/undefined/empty/NaN/Infinity inputs.
 * Always returns a finite number — safe to call `.toFixed()` on the result.
 *
 * In development, logs a one-time warning per offending value-shape so that
 * remaining bad data flowing into ficha técnica formatters can be located.
 */
export function parseSafeNumber(val: any, fallback = 0, label = 'parseSafeNumber'): number {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'number') {
    if (Number.isFinite(val)) return val;
    warnNonFinite(val, label);
    return fallback;
  }
  if (typeof val === 'boolean') return val ? 1 : 0;
  // Accept Brazilian decimal commas in string inputs ("1,5" → 1.5)
  const normalized = typeof val === 'string' ? val.trim().replace(',', '.') : val;
  const num = Number(normalized);
  if (Number.isFinite(num)) return num;
  warnNonFinite(val, label);
  return fallback;
}

/**
 * Format a number as currency (BRL) with safe input handling.
 *
 * ⚠ Vai até 4 casas de propósito: é o formatador de **PREÇO UNITÁRIO / taxa**,
 * onde a precisão cadastrada importa (R$ 0,031/un arredondado pra R$ 0,03
 * distorce o total em ~10%). Para **TOTAIS e SUBTOTAIS use `formatMoney`** —
 * dinheiro fechado é sempre 2 casas (R$ 0.000,00). Misturar os dois foi o que
 * produzia "Total estimado: R$ 12.689,945" no relatório de Compras por Pedido.
 */
// ⚠ PERF (2026-07-26): as instâncias de Intl.NumberFormat são de MÓDULO, criadas uma
// única vez. Construir o formatador a cada chamada custava ~34µs contra ~0,5µs de uma
// instância reaproveitada (70×) — e estes são os helpers canônicos do projeto, com
// ~300 call sites, muitos dentro de `.map()` de render em telas com centenas de linhas.
// Instância de Intl é imutável e stateless: reusar é seguro.
// Ao adicionar um formatador novo, hoiste do mesmo jeito — não chame o construtor
// dentro da função.
const BRL_UNIT_PRICE = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const BRL_MONEY = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(val: any): string {
  const num = parseSafeNumber(val, 0, 'formatCurrency');
  return BRL_UNIT_PRICE.format(num);
}

/**
 * Dinheiro FECHADO (total, subtotal, saldo) em BRL — sempre 2 casas,
 * `R$ 0.000,00`, conforme a convenção do projeto. Use em qualquer valor que o
 * usuário lê como "quanto vou pagar". Para preço unitário/taxa use
 * `formatCurrency` (mantém a precisão cadastrada).
 */
export function formatMoney(val: any): string {
  const num = parseSafeNumber(val, 0, 'formatMoney');
  return BRL_MONEY.format(num);
}

/**
 * Safely format any value (string, number, null, undefined) to a fixed-decimal string.
 * Replaces direct `.toFixed()` calls and prevents `num.toFixed is not a function` errors.
 *
 * In development, emits a one-time warning when a non-finite value is received,
 * including the optional `label` so the offending field can be identified.
 */
export function safeToFixed(val: any, digits = 2, fallback = '0', label = 'safeToFixed'): string {
  if (val === null || val === undefined || val === '') {
    const fb = Number(fallback);
    return isNaN(fb) ? fallback : fb.toFixed(digits);
  }
  const normalized = typeof val === 'string' ? val.trim().replace(',', '.') : val;
  const num = typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isFinite(num)) {
    warnNonFinite(val, label);
    const fb = Number(fallback);
    return isNaN(fb) ? fallback : fb.toFixed(digits);
  }
  return num.toFixed(digits);
}

/**
 * Format a number with locale-aware thousands separators and configurable decimals.
 * Safe for string/number/null inputs.
 */
// `digits` é parâmetro, então o cache é por número de casas. Na prática o app usa
// meia dúzia de valores (0, 2, 3, 4), logo o Map fica minúsculo e estável.
const NUMBER_FORMATTERS = new Map<number, Intl.NumberFormat>();

export function formatNumber(val: any, digits = 2): string {
  const num = parseSafeNumber(val, 0, 'formatNumber');
  let fmt = NUMBER_FORMATTERS.get(digits);
  if (!fmt) {
    fmt = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    NUMBER_FORMATTERS.set(digits, fmt);
  }
  return fmt.format(num);
 }

 /** Standard production sectors in correct order */
 export const PRODUCTION_SECTORS_ORDER = [
   'Corte',
   'Forração',
   'Aviamento',
   'Silk',
   'Colagem',
   'Montagem',
   'Solagem',
   'Acabamento',
   'Expedição'
 ];

 /** Centralized logging for production flow validation */
 export function logProductionFlow(context: string, data: any) {
   if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
     console.group(`[ProductionFlow] ${context}`);
     if (data.stages) {
       const isValid = data.stages.every((s: string) => PRODUCTION_SECTORS_ORDER.includes(s));
       const isOrdered = data.stages.every((s: string, i: number) => {
         if (i === 0) return true;
         const currIdx = PRODUCTION_SECTORS_ORDER.indexOf(s);
         const prevIdx = PRODUCTION_SECTORS_ORDER.indexOf(data.stages[i-1]);
         return currIdx === -1 || prevIdx === -1 || currIdx >= prevIdx;
       });
       console.log('Stages:', data.stages);
       console.log('Validation:', isValid ? '✅ Valid Sectors' : '❌ Invalid Sectors Detected');
       console.log('Order:', isOrdered ? '✅ Correct Order' : '⚠️ Order Mismatch');
     }
     if (data.error) console.error('Error:', data.error);
     console.log('Full Data:', data);
     console.groupEnd();
   }
 }

```
