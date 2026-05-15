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
}

export function NumberInput({ value, onChange, id, className, required, min = 0, step = "0.0001", placeholder, decimals = 6, disabled, unit }: NumberInputProps) {
  const [displayValue, setDisplayValue] = React.useState("");
  const [justFocused, setJustFocused] = React.useState(false);

  const formatValue = (num: number | string | null | undefined): string => {
    const safeNum = parseSafeNumber(num);
    // Guard: only finite numbers reach toFixed. Anything else renders as empty.
    if (!Number.isFinite(safeNum) || safeNum === 0) return "";
    // Show up to `decimals` decimal places, removing trailing zeros
    const str = safeToFixed(safeNum, decimals).replace(/\.?0+$/, "");
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
    let raw = e.target.value;
    
    // Accept comma as decimal separator (Brazilian locale)
    raw = raw.replace(',', '.');
    
    // If just focused and user starts typing, replace entire value
    if (justFocused) {
      setJustFocused(false);
      if (raw.length > 0 && raw !== displayValue) {
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
    
    // Remove leading zeros (but keep "0." for decimals)
    let cleaned = raw;
    if (cleaned.match(/^0\d/) && !cleaned.startsWith("0.")) {
      cleaned = cleaned.replace(/^0+/, "");
    }
    
    // Allow intermediate states like "0.", "0.0", "0.00" etc.
    if (cleaned === "" || cleaned === "0" || /^0\.0*$/.test(cleaned) || /^\d*\.?\d*$/.test(cleaned)) {
      setDisplayValue(cleaned);
    }
    
    const parsed = parseFloat(cleaned);
    if (Number.isFinite(parsed)) {
      prevValueRef.current = parsed;
      onChange(parsed);
    } else if (cleaned === "" || cleaned === "0") {
      prevValueRef.current = 0;
      onChange(0);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setJustFocused(true);
    if (parseSafeNumber(value) === 0) {
      setDisplayValue("");
    }
    // Use setTimeout to ensure select works after React re-render
    setTimeout(() => {
      e.target.select();
    }, 0);
  };

  const handleBlur = () => {
    setJustFocused(false);
    setDisplayValue(formatValue(value));
  };

  const input = (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      required={required}
      disabled={disabled}
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
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {unit}
      </span>
    </div>
  );
}
