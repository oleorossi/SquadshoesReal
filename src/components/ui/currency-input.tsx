import * as React from "react";
import { cn } from "@/lib/utils";

interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  id?: string;
  className?: string;
  required?: boolean;
}

export function CurrencyInput({ value, onChange, id, className, required }: CurrencyInputProps) {
  const [displayValue, setDisplayValue] = React.useState("");
  const [justFocused, setJustFocused] = React.useState(false);

  // Format number to BRL display string
  const formatToBRL = (num: number): string => {
    return num.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  };

  // Initialize display value from prop
  React.useEffect(() => {
    setDisplayValue(formatToBRL(value));
  }, []);

  // Sync when value changes externally (e.g. form reset)
  const prevValueRef = React.useRef(value);
  React.useEffect(() => {
    if (prevValueRef.current !== value) {
      setDisplayValue(formatToBRL(value));
      prevValueRef.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value;
    
    // If just focused and user starts typing, replace entire value
    if (justFocused) {
      setJustFocused(false);
      // Extract only the newly typed character(s)
      const sel = e.target;
      // If the old displayValue is still partially there, keep only new input
      if (raw.length > 0 && raw !== displayValue) {
        // Find what was typed by removing the old selected text
        const diff = raw.replace(displayValue, "");
        if (diff.length > 0) {
          raw = diff;
        } else if (raw.length <= displayValue.length) {
          // User replaced selection - use raw as-is
        } else {
          raw = raw.slice(-1);
        }
      }
    }

    // Allow only digits, comma and dot
    const cleaned = raw.replace(/[^\d,.]/g, "");
    setDisplayValue(cleaned);

    // Parse: replace dots (thousands sep in pt-BR) then comma to dot
    const normalized = cleaned
      .replace(/\./g, "")
      .replace(",", ".");
    const parsed = parseFloat(normalized);
    if (!isNaN(parsed)) {
      prevValueRef.current = parsed;
      onChange(parsed);
    } else if (cleaned === "" || cleaned === "0") {
      prevValueRef.current = 0;
      onChange(0);
    }
  };

  const handleBlur = () => {
    setJustFocused(false);
    // Re-format on blur
    setDisplayValue(formatToBRL(value));
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setJustFocused(true);
    setTimeout(() => {
      e.target.select();
    }, 0);
  };

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">
        R$
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        required={required}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm font-mono text-right",
          className
        )}
      />
    </div>
  );
}
