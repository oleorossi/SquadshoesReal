import { format } from 'date-fns';
import {
  CheckCircle as CheckCircle2, CurrencyDollar as DollarSign, Package,
  Warning as AlertTriangle, ArrowRight,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { isOsDone } from '@/lib/osStatusMachine';
import type { ServiceOrderOverview } from '@/hooks/useContractors';

/**
 * Indicadores de estado da OS partilhados entre a visão em cartões e a tabela.
 * Extraídos de Contractors.tsx (que passava de 2.900 linhas) para que a mesma
 * leitura de pagamento e saldo valha nas duas visões — antes o pagamento só
 * existia no rodapé do cartão, e a tabela, que é a visão PADRÃO, não o mostrava.
 */

// ── Indicador de pagamento da OS (vem da view v_service_order_overview) ───────
// Mostra Pago/A pagar + vencimento da conta a pagar gerada na finalização da OS.
//
// Ausência de conta a pagar tem DOIS significados e eles não podem ficar mudos
// do mesmo jeito: OS ainda aberta legitimamente não tem conta (a AP nasce na
// finalização) — silêncio correto; mas OS FINALIZADA sem conta é dinheiro que
// ninguém vai cobrar, e antes disso não aparecia em lugar nenhum da tela.
export function OsPaymentBadge({ ov, osStatus }: { ov?: ServiceOrderOverview; osStatus?: string }) {
  if (!ov || !ov.has_payable) {
    if (!isOsDone(osStatus)) return null; // OS aberta: a conta ainda não deve existir
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400"
        title="OS finalizada sem conta a pagar — o prestador não será cobrado. Verifique o lançamento no financeiro."
      >
        <AlertTriangle className="h-3 w-3" />
        Sem conta a pagar
      </span>
    );
  }
  if (ov.is_paid) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" />
        Pago{ov.payment_date ? ` · ${format(new Date(ov.payment_date + 'T12:00:00'), 'dd/MM')}` : ''}
      </span>
    );
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdue = !!ov.payment_due_date && ov.payment_due_date < todayIso;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', overdue ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>
      <DollarSign className="h-3 w-3" />
      A pagar{ov.payment_due_date ? ` · vence ${format(new Date(ov.payment_due_date + 'T12:00:00'), 'dd/MM')}` : ''}
    </span>
  );
}

// ── Saldo de recebimento parcial (Enviado / Devolvido bom / Na rua) ──────────
// Só aparece quando houve algum retorno mas ainda há pares na rua (parcial).
export function OsBalanceLine({ ov }: { ov?: ServiceOrderOverview }) {
  if (!ov) return null;
  const sent = Number(ov.qty_sent ?? 0);
  const good = Number(ov.qty_returned_good ?? 0);
  const defect = Number(ov.qty_returned_defect ?? 0);
  const loss = Number(ov.qty_loss ?? 0);
  const inField = Number(ov.qty_in_field ?? 0);
  const returned = good + defect + loss;
  const rework = Number(ov.qty_defect_pending_rework ?? 0);
  const short = Number(ov.qty_short ?? 0);
  // Defeito e perda precisam aparecer MESMO com a OS sem saldo na rua: são
  // justamente os casos em que o par sumiu do controle (voltou com defeito ou
  // se perdeu no prestador) e alguém precisa decidir retrabalho ou reposição.
  if (sent <= 0 || returned <= 0) return null;
  if (inField <= 0 && rework <= 0 && short <= 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      {inField > 0 && (
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
              title={`Bons ${good} · Defeito ${defect} · Perda ${loss}`}>
          <Package className="h-3 w-3" />
          Devolvido {returned}/{sent} · {inField} na rua
        </span>
      )}
      {rework > 0 && (
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
              title="Pares com defeito aguardando retrabalho — podem ser enviados de volta ao prestador">
          <ArrowRight className="h-3 w-3" />
          {rework} p/ retrabalho
        </span>
      )}
      {short > 0 && (
        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400"
              title="Perda no prestador + sucata: a OS não entrega essa quantidade sem repor material">
          <AlertTriangle className="h-3 w-3" />
          {short} a repor
        </span>
      )}
    </span>
  );
}
