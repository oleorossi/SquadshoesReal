import { lazy, Suspense } from 'react';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';

// Reorganização 2026-06-28: a "Folha do Mês" foi FUNDIDA no "Relatório" — a mesma
// tela já faz filtro de período + calcular + KPIs + tabela + holerite/espelho por
// funcionário. Em 2026-06-28 a aba "Adiantamentos" saiu daqui e foi pra página
// Funcionários (adiantamento é gestão do funcionário, não da folha; o líquido segue
// descontando). Sobra só o Relatório consolidado → renderiza Payroll direto.
const Payroll = lazy(() => import('@/pages/Payroll'));

export default function FolhaConsolidada() {
  return (
    <Suspense fallback={(
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )}>
      <Payroll />
    </Suspense>
  );
}
