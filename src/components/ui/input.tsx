import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onFocus, onClick, step, ...props }, ref) => {
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
        className={cn(
          // Industrial Editorial Pro (22/05/2026): borda 1.5px decisive em vez
          // de border default + rounded-sm. Focus: borda foreground sólida (sem
          // ring colorido em volta — borda mais decisive). Estado inválido
          // vermelho squad. Mono font pra inputs numéricos.
          "flex h-9 w-full rounded-sm border-[1.5px] border-foreground/15 bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm aria-[invalid=true]:border-primary invalid:border-primary",
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
