import { Prohibit } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  saleOrderShowsGateBlocks,
  type SaleOrderGateBlockLine,
} from '@/hooks/useSaleOrderGateBlocks';

interface Props {
  status: string | null | undefined;
  blocks: SaleOrderGateBlockLine[] | undefined;
  className?: string;
}

/**
 * Selo "Não aprova (N)" na lista de PVs.
 *
 * Mostra, ANTES do clique, os itens que o motor vai recusar na aprovação — a
 * mesma lista que o pré-voo do `enqueue_sale_order_materialization` devolve em
 * <1s quando o clique acontece. Vermelho e não âmbar de propósito: isto NÃO é
 * aviso de falta de material (esse é o `SaleOrderMaterialShortageBadge`, âmbar,
 * e aprovar com falta é permitido). Aqui a aprovação falha de verdade.
 *
 * Sem bloqueio → não renderiza nada. Status fora de Rascunho/Pendente também
 * não: depois de aprovado o item já tem OP e o gate não roda mais para ele.
 */
export function SaleOrderGateBlockBadge({ status, blocks, className }: Props) {
  if (!saleOrderShowsGateBlocks(status)) return null;
  if (!blocks || blocks.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={e => e.stopPropagation()}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-700 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-red-400',
            className,
          )}
          aria-label={`${blocks.length} ${blocks.length === 1 ? 'item bloqueado' : 'itens bloqueados'} para aprovação. Ver detalhes`}
        >
          <Prohibit className="h-3 w-3" weight="fill" />
          Não aprova ({blocks.length})
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-semibold text-foreground">
            Itens bloqueados para produção
          </p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            A aprovação vai ser recusada enquanto o cadastro destes itens não fechar.
          </p>
        </div>
        <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto">
          {blocks.map(line => (
            <li key={line.itemId} className="px-3 py-2 text-xs">
              <div className="font-medium text-foreground">
                {line.referenceCode} · {line.color}
              </div>
              <p className="mt-0.5 leading-snug text-red-700 dark:text-red-400">
                {line.reason}
              </p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
