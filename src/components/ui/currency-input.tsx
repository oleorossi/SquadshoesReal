import * as React from "react";
import { cn } from "@/lib/utils";

interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  id?: string;
  className?: string;
  required?: boolean;
}

/**
 * Parse permissivo: aceita formato pt-BR e formato programador.
 *
 *   "30,19"         → 30.19   (vírgula = decimal pt-BR)
 *   "30.19"         → 30.19   (ponto único, ≤2 casas → decimal programador)
 *   "1.234,56"      → 1234.56 (ponto = milhar, vírgula = decimal pt-BR)
 *   "1,234.56"      → 1234.56 (vírgula = milhar, ponto = decimal en-US)
 *   "1.234.567"     → 1234567 (múltiplos pontos sem vírgula = milhares)
 *   "30.190"        → 30190   (>2 casas depois do ponto = milhares)
 *
 * Heurística: o ÚLTIMO separador é o decimal quando faz sentido (≤2 dígitos
 * depois). Se ambos aparecem, o que aparece por último vira decimal.
 */
function parseUserValue(input: string): number | null {
  const cleaned = input.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned || cleaned === "-") return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    // Ambos presentes: o que aparece por último é o decimal
    if (lastComma > lastDot) {
      // pt-BR: 1.234,56 → 1234.56
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // en-US: 1,234.56 → 1234.56
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    // Só vírgula: sempre decimal pt-BR (vírgula raramente é milhar isolado)
    normalized = cleaned.replace(",", ".");
    // Se aparecer mais de uma vírgula, mantém só a última como decimal
    const parts = normalized.split(".");
    if (parts.length > 2) normalized = parts.slice(0, -1).join("") + "." + parts.slice(-1);
  } else if (lastDot >= 0) {
    // Só ponto(s)
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount === 1) {
      // Um ponto: trato como decimal (30.19 → 30.19), independente de quantas casas.
      // Usuário que quer "trinta mil cento e noventa" digita "30190" ou "30.190,00"
      normalized = cleaned;
    } else {
      // Múltiplos pontos: todos milhares
      normalized = cleaned.replace(/\./g, "");
    }
  }

  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}

const formatToBRL = (num: number): string =>
  num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export function CurrencyInput({ value, onChange, id, className, required }: CurrencyInputProps) {
  const [displayValue, setDisplayValue] = React.useState(() => formatToBRL(value));
  const [focused, setFocused] = React.useState(false);

  // Mantém o display sincronizado com prop quando ele muda externamente
  // e o campo não está sendo editado (evita atropelar o que o usuário digita).
  const prevValueRef = React.useRef(value);
  React.useEffect(() => {
    if (focused) return;
    if (prevValueRef.current !== value) {
      setDisplayValue(formatToBRL(value));
      prevValueRef.current = value;
    }
  }, [value, focused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Aceita só dígitos, vírgula e ponto durante a edição — preserva exatamente
    // o que o usuário tá digitando (sem reformat) pra cursor não pular.
    const cleaned = e.target.value.replace(/[^\d,.-]/g, "");
    setDisplayValue(cleaned);

    const parsed = parseUserValue(cleaned);
    if (parsed !== null) {
      prevValueRef.current = parsed;
      onChange(parsed);
    } else if (cleaned === "") {
      prevValueRef.current = 0;
      onChange(0);
    }
  };

  const handleBlur = () => {
    setFocused(false);
    // Reformata pro padrão pt-BR ao sair do campo
    setDisplayValue(formatToBRL(value));
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(true);
    const el = e.currentTarget;
    if (!value) {
      // Valor 0: LIMPA o campo ao focar. Sem isso o "0,00" não some — e como o
      // select() abaixo corre contra o cursor que o clique posiciona, ele falha
      // com frequência. Digitar "5" sobre "0,00" virava "0,005" (=0.005): o zero
      // não era excluído e a casa decimal ficava errada, então o custo "não
      // deixava" ser alterado. Mesma estratégia do NumberInput.
      setDisplayValue("");
      return;
    }
    // Valor existente: seleciona tudo pra digitar por cima. setTimeout pra rodar
    // DEPOIS do cursor que o clique posiciona (senão a seleção some na hora).
    setTimeout(() => el.select(), 0);
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
