import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

/**
 * Quando AlertDialog está aberto, Enter equivale a clicar no botão de Ação
 * (Sim/Confirmar/Aprovar). Atalho UX padrão de confirmação. Ignora Enter
 * dentro de <textarea> (newline) e respeita modificadores (Shift/Ctrl/Alt/Meta
 * são reservados pra outros atalhos).
 *
 * Como Radix renderiza AlertDialogAction com data-radix-collection-item NÃO
 * único, marcamos via data-alert-dialog-action="true" no AlertDialogAction
 * abaixo. Esse atributo é o seletor canônico.
 */
function handleAlertDialogEnter(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "Enter") return;
  if (e.defaultPrevented) return;
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const target = e.target as HTMLElement;
  // Enter em textarea = nova linha (não deve confirmar)
  if (target.tagName === "TEXTAREA") return;
  // Enter num botão focado ativa o PRÓPRIO botão (Cancelar etc.) — não sequestrar
  if (target.tagName === "BUTTON" || target.closest('[aria-haspopup],[role="combobox"]')) return;
  // Se o foco já está no botão Cancel, Enter clica nele (comportamento padrão)
  if (target.closest('[data-alert-dialog-cancel="true"]')) return;
  // Procura o action button dentro do dialog
  const action = e.currentTarget.querySelector<HTMLButtonElement>(
    '[data-alert-dialog-action="true"]',
  );
  if (action && !action.disabled) {
    e.preventDefault();
    action.click();
  }
}

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, onKeyDown, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        // Industrial Editorial Pro: espelha o DialogContent (borda 2px INK,
        // rounded-sm, sem shadow, fade-only) + margem lateral e scroll no mobile.
        "fixed left-[50%] top-[50%] z-50 grid w-[95vw] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border-[2px] border-foreground bg-background p-6 duration-150 max-h-[90vh] overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 rounded-sm",
        className,
      )}
      onKeyDown={(e) => {
        handleAlertDialogEnter(e);
        onKeyDown?.(e);
      }}
      {...props}
    />
  </AlertDialogPortal>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    data-alert-dialog-action="true"
    className={cn(buttonVariants(), className)}
    {...props}
  />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    data-alert-dialog-cancel="true"
    className={cn(buttonVariants({ variant: "outline" }), className)}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
