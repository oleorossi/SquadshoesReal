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
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/50 invalid:border-destructive invalid:ring-destructive/50",
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
