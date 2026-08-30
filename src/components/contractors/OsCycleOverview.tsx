import {
  ArrowUUpLeft,
  ClipboardText,
  CurrencyDollar,
  Package,
  PaperPlaneTilt,
  Receipt,
  SquaresFour,
  Sneaker,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { OsCycleTotals } from '@/lib/serviceOrderCockpit';

interface Props {
  totals: OsCycleTotals;
  onFilter?: (filter: 'active' | 'na_rua' | 'Concluído') => void;
}

const integer = new Intl.NumberFormat('pt-BR');
const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});
const qty = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/**
 * Leitura do ciclo diário da OS, na linguagem do chão: gerou, cobrou, enviou,
 * voltou, quanto de material saiu e se o recibo já voltou assinado.
 */
export function OsCycleOverview({ totals, onFilter }: Props) {
  const cells = [
    {
      label: 'OS geradas',
      value: integer.format(totals.osCount),
      hint: 'ficha → ordem de serviço',
      icon: ClipboardText,
      onClick: () => onFilter?.('active'),
    },
    {
      label: 'Valor gerado',
      value: currency.format(totals.generatedValue),
      hint: 'soma das OS ativas e recebidas',
      icon: CurrencyDollar,
    },
    {
      label: 'Cobrança',
      value: currency.format(totals.billingValue),
      hint: `${integer.format(totals.billingCount)} ${totals.billingCount === 1 ? 'conta aberta' : 'contas abertas'}`,
      icon: Receipt,
      tone: totals.billingValue > 0 ? 'warning' : 'default',
    },
    {
      label: 'Itens',
      value: integer.format(totals.itemCount),
      hint: 'referências cobertas',
      icon: SquaresFour,
    },
    {
      label: 'Peças',
      value: integer.format(totals.pairCount),
      hint: 'pares das OS',
      icon: Sneaker,
    },
    {
      label: 'Material enviado',
      value: qty.format(totals.materialQty),
      hint: `${integer.format(totals.materialLines)} ${totals.materialLines === 1 ? 'linha' : 'linhas'} na remessa`,
      icon: Package,
    },
    {
      label: 'Já foi',
      value: integer.format(totals.sentPairs),
      hint: 'pares enviados ao prestador',
      icon: PaperPlaneTilt,
      onClick: () => onFilter?.('na_rua'),
    },
    {
      label: 'Já voltou',
      value: integer.format(totals.returnedPairs),
      hint: 'pares conferidos no retorno',
      icon: ArrowUUpLeft,
      onClick: () => onFilter?.('Concluído'),
    },
    {
      label: 'Recibo',
      value: integer.format(totals.unsignedReceipts),
      hint: totals.unsignedReceipts > 0 ? 'aguardando assinatura de volta' : 'nenhum recibo pendente',
      icon: Receipt,
      tone: totals.unsignedReceipts > 0 ? 'warning' : 'success',
      onClick: () => onFilter?.('na_rua'),
    },
  ] as const;

  return (
    <section aria-label="Ciclo da ordem de serviço" className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Ciclo da ordem de serviço</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Da ficha técnica ao recibo assinado: o que gerou, o que saiu, o que voltou.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-9">
        {cells.map((cell, index) => {
          const Icon = cell.icon;
          const interactive = 'onClick' in cell && !!cell.onClick;
          const tone = 'tone' in cell ? cell.tone : 'default';
          const className = cn(
            'flex min-h-[5.5rem] flex-col justify-between border-border p-3 text-left',
            index % 2 === 1 && 'sm:border-l',
            index % 3 !== 0 && 'sm:border-l',
            index > 1 && 'border-t sm:border-t-0 xl:border-t-0',
            index >= 3 && 'sm:border-t xl:border-t-0',
            index > 0 && 'xl:border-l xl:border-t-0',
            interactive && 'transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          );
          const content = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{cell.label}</span>
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className={cn(
                  'font-mono text-lg font-bold leading-none tabular-nums',
                  tone === 'warning' && 'text-warning',
                  tone === 'success' && 'text-success',
                )}>{cell.value}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{cell.hint}</p>
              </div>
            </>
          );
          if (interactive) {
            return (
              <button key={cell.label} type="button" onClick={cell.onClick} className={className}>
                {content}
              </button>
            );
          }
          return <div key={cell.label} className={className}>{content}</div>;
        })}
      </div>
    </section>
  );
}
