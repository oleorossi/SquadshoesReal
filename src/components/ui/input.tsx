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
