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
  /**
   * Teclado virtual. Default `decimal` (vírgula/ponto). Grade de numeração
   * e pares inteiros devem passar `numeric` — no iOS abre o pad de inteiros.
   */
  inputMode?: "decimal" | "numeric" | "text";
  /** Foca o campo automaticamente ao montar (ex.: input de quantidade que abre
   *  em dialog). Opcional — sem efeito nos demais usos. */
  autoFocus?: boolean;
}

export function NumberInput({ value, onChange, id, className, required, min = 0, step = "0.0001", placeholder, decimals = 6, disabled, unit, autoFocus, inputMode = "decimal" }: NumberInputProps) {
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
