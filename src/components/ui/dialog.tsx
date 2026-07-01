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
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
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
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onKeyDown, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Industrial Editorial Pro (22/05/2026): dialog com borda 2px decisive
        // INK em vez de shadow-lg, rounded-sm (era lg). Bg PAPER (background).
        // Sem zoom/slide animations excessivas — só fade.
        "fixed left-[50%] top-[50%] z-50 grid w-[95vw] max-w-3xl translate-x-[-50%] translate-y-[-50%] gap-4 border-[2px] border-foreground bg-background p-6 duration-150 max-h-[90vh] overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 rounded-sm",
        className,
      )}
      onKeyDown={(e) => {
        handleDialogEnter(e);
        onKeyDown?.(e);
      }}
      {...props}
    >
      {children}
      <DialogPrimitive.Close aria-label="Fechar diálogo" className="absolute right-4 top-4 p-2 -m-2 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Fechar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
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
