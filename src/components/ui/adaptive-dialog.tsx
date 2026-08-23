import * as React from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { shouldPresentAsSheet, useViewport } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const AdaptiveCtx = React.createContext(false);

/**
 * Dialog no ponteiro fino / viewport lg+; Sheet (bottom) em ponteiro grosso
 * abaixo de lg. Quem abre decide o conteúdo; o invólucro acompanha o form factor.
 *
 * Use AdaptiveDialog + AdaptiveDialogContent juntos. Títulos e descrições do
 * Dialog (Radix) funcionam dentro do Sheet — os dois primitivos são o mesmo.
 */
export function AdaptiveDialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  const { isCoarse, width } = useViewport();
  const asSheet = shouldPresentAsSheet(isCoarse, width);
  return (
    <AdaptiveCtx.Provider value={asSheet}>
      {asSheet ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          {children}
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          {children}
        </Dialog>
      )}
    </AdaptiveCtx.Provider>
  );
}

type AdaptiveDialogContentProps = React.ComponentPropsWithoutRef<typeof DialogContent> & {
  side?: "bottom" | "right" | "left" | "top";
};

export const AdaptiveDialogContent = React.forwardRef<
  HTMLDivElement,
  AdaptiveDialogContentProps
>(function AdaptiveDialogContent({ side = "bottom", className, children, ...props }, ref) {
  const asSheet = React.useContext(AdaptiveCtx);
  if (asSheet) {
    return (
      <SheetContent
        ref={ref}
        side={side}
        data-adaptive="sheet"
        className={cn("safe-bot", side === "bottom" && "max-h-[92dvh]", className)}
        {...props}
      >
        {children}
      </SheetContent>
    );
  }
  return (
    <DialogContent ref={ref} data-adaptive="dialog" className={className} {...props}>
      {children}
    </DialogContent>
  );
});

export function AdaptiveDialogHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  const asSheet = React.useContext(AdaptiveCtx);
  return asSheet ? <SheetHeader {...props} /> : <DialogHeader {...props} />;
}

export function AdaptiveDialogTitle(props: React.ComponentPropsWithoutRef<typeof DialogTitle>) {
  const asSheet = React.useContext(AdaptiveCtx);
  return asSheet ? <SheetTitle {...props} /> : <DialogTitle {...props} />;
}

export function AdaptiveDialogDescription(props: React.ComponentPropsWithoutRef<typeof DialogDescription>) {
  const asSheet = React.useContext(AdaptiveCtx);
  return asSheet ? <SheetDescription {...props} /> : <DialogDescription {...props} />;
}

export function AdaptiveDialogFooter(props: React.HTMLAttributes<HTMLDivElement>) {
  const asSheet = React.useContext(AdaptiveCtx);
  return asSheet ? <SheetFooter {...props} /> : <DialogFooter {...props} />;
}

export function useAdaptiveSheet() {
  return React.useContext(AdaptiveCtx);
}
