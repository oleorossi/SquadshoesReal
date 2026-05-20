import { useMemo } from 'react';
import { Calculator, Warning as AlertTriangle } from '@phosphor-icons/react';
import { calculateSeverance } from '@/lib/severanceCalculator';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  salary: number;
  admissionDate: string | null | undefined;
  terminationDate: string | null | undefined;
}

/**
 * Mostra estimativa de indenização (rescisão sem justa causa CLT) quando
 * operador preenche termination_date no cadastro do funcionário.
 *
 * Renderiza nada quando faltam dados ou termination_date é vazia. Não há
 * persistência — é só simulação visual baseada nos valores do form atual.
 */
export function SeveranceSimulator({ salary, admissionDate, terminationDate }: Props) {
  const result = useMemo(() => {
    if (!terminationDate || !admissionDate || !salary || salary <= 0) return null;
    return calculateSeverance({ salary, admissionDate, terminationDate });
  }, [salary, admissionDate, terminationDate]);

  if (!result) return null;

  const items: Array<{ label: string; value: number; hint?: string }> = [
    {
      label: `Saldo de salário (${result.diasMesDemissao} dias)`,
      value: result.saldoSalario,
    },
    {
      label: `13º proporcional (${result.mesesAnoAtual}/12 do ano)`,
      value: result.decimoTerceiroProporcional,
    },
    ...(result.feriasVencidas > 0 ? [{
      label: `Férias vencidas + 1/3 (${result.anosCompletos} período(s))`,
      value: result.feriasVencidas,
      hint: 'Assume que NENHUM período vencido foi gozado. Confirme histórico de férias.',
    }] : []),
    {
      label: `Férias proporcionais + 1/3 (${result.mesesAquisitivoAtual}/12 do período aquisitivo)`,
      value: result.feriasProporcionais,
    },
    {
      label: `Aviso prévio indenizado (${result.diasAviso} dias)`,
      value: result.avisoPrevioIndenizado,
      hint: '30 dias base + 3 dias por ano completo, máx 90 dias.',
    },
    {
      label: `Multa 40% FGTS`,
      value: result.multaFgts,
      hint: `Estimativa: 8% × salário × ${result.mesesTrabalhadosTotal} meses = ${fmt(result.fgtsDepositadoEstimado)} de FGTS. Multa = 40% disso. Consulte saldo real na Caixa.`,
    },
  ];

  return (
    <div className="col-span-2 rounded-lg border border-rose-300/50 bg-rose-50/30 dark:bg-rose-950/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-rose-700 dark:text-rose-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
          Indenização estimada (rescisão sem justa causa)
        </span>
      </div>

      <div className="space-y-1.5 text-xs">
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground flex items-center gap-1.5">
              {it.label}
              {it.hint && (
                <span title={it.hint} className="cursor-help">
                  <AlertTriangle className="h-3 w-3 text-amber-600 inline" />
                </span>
              )}
            </span>
            <span className="font-mono text-foreground">{fmt(it.value)}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-rose-300/40 pt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-rose-700 dark:text-rose-400">Total estimado</span>
        <span className="font-mono font-bold text-lg text-rose-700 dark:text-rose-400">{fmt(result.total)}</span>
      </div>

      <p className="text-xs text-muted-foreground italic leading-relaxed">
        Cálculo de referência baseado em rescisão CLT padrão. Multa FGTS é
        estimada (não consulta saldo real na Caixa). Contabilidade deve
        validar antes de qualquer pagamento oficial.
      </p>
    </div>
  );
}
