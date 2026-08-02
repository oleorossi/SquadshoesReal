import { toast } from 'sonner';

type DebitEntry = {
  status?: string;
  packaging_type?: string;
  box_name?: string;
  unit?: string;
  needed_qty?: number | string;
  debited_qty?: number | string;
  shortfall?: number | string;
  /** 'sheet_without_sole_group' | 'box_inactive_or_missing' (migration 20261110120000) */
  reason?: string;
};

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/**
 * Rede de segurança: desde a migration `20261025120000` a RPC não levanta mais
 * exceção por falta de estoque de embalagem, mas um ambiente ainda não migrado
 * (ou um rollback) volta a levantar `Estoque insuficiente para embalagem "X"`.
 *
 * Esse erro NÃO pode entrar em `secondaryDebitErrors` no `useSaleOrders.ts`: lá
 * qualquer erro libera as reservas (`release_order_reservations`, `restore_*`) e
 * CANCELA a OP recém-criada — foi exatamente isso que quebrou o lançamento de
 * Pedido de Venda em 31/07/2026, quando a caixa colmeia (estoque 0) foi vinculada
 * aos grupos de solado. Embalagem é insumo de EXPEDIÇÃO: falta dela avisa, não
 * derruba o pedido.
 */
export function isPackagingStockShortage(message?: string | null): boolean {
  return /estoque insuficiente para embalagem/i.test(message || '');
}

/** Números vêm do Postgres como `numeric` → chegam string no JSON. */
function num(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function qty(v: number | string | null | undefined, unit?: string): string {
  return `${nf.format(num(v))}${unit ? ` ${unit}` : ''}`;
}

/**
 * Inspeciona o retorno JSON de `debit_packaging_for_order` e avisa o usuário
 * (toast âmbar, não-bloqueante) quando a embalagem NÃO foi debitada — por falta
 * de CADASTRO (nenhuma caixa configurada no grupo do solado, ou um tipo de caixa
 * do modo sem caixa vinculada) ou por falta de ESTOQUE. O pedido/OP segue em
 * frente nos dois casos; isto só torna visível o "silêncio" que antes passava
 * batido (cadastro) ou que derrubava a OP inteira (estoque).
 *
 * Falta de estoque: desde a migration `20261025120000` a RPC não levanta mais
 * exceção — debita `LEAST(necessário, disponível)` e devolve o buraco em
 * `status: 'partial' | 'insufficient_stock'`. Sem este aviso, a caixa sumiria do
 * estoque sem ninguém saber que faltou.
 */
export function warnPackagingDebit(data: unknown, contextLabel?: string): void {
  if (!Array.isArray(data)) return;
  const prefix = contextLabel ? `${contextLabel}: ` : '';
  const noConfig = data.some((e: DebitEntry) => e?.status === 'no_packaging_configured');
  const skipped = data
    .filter((e: DebitEntry) => e?.status === 'skipped_no_box_linked')
    .map((e: DebitEntry) => e.packaging_type)
    .filter(Boolean);
  const short = data.filter(
    (e: DebitEntry) => e?.status === 'insufficient_stock' || e?.status === 'partial',
  ) as DebitEntry[];

  // Falta de estoque vem primeiro: é a única que já mexeu (ou deixou de mexer)
  // no estoque real, então é a que o operador precisa resolver.
  if (short.length > 0) {
    for (const e of short) {
      const nome = e.box_name || e.packaging_type || 'embalagem';
      const unidade = e.unit || '';
      const debitado = num(e.debited_qty);
      const falta = num(e.shortfall);
      toast.warning(
        debitado > 0
          ? `${prefix}Embalagem "${nome}" debitada parcialmente — faltaram ${qty(falta, unidade)}.`
          : `${prefix}Embalagem "${nome}" sem estoque — nada foi debitado (faltam ${qty(falta, unidade)}).`,
        {
          description:
            `Necessário ${qty(e.needed_qty, unidade)} · debitado ${qty(debitado, unidade)} · falta ${qty(falta, unidade)}. ` +
            'O pedido seguiu normalmente. Reponha em Logística → Embalagens; ao repor, o débito se completa sozinho na próxima ação da OP.',
          duration: 12000,
        },
      );
    }
    return;
  }

  if (noConfig) {
    // Duas causas MUITO diferentes, e o conserto de cada uma é em outra tela:
    // ficha sem solado → vincular o solado NA FICHA; solado sem caixa → cadastrar
    // a caixa em Solados. Mandar o operador pro lugar errado é como o aviso
    // antigo apontava pra Estoque → Grupos, que desde 02/08/2026 nem edita mais.
    const semSolado = data.some(
      (e: DebitEntry) => e?.status === 'no_packaging_configured' && e?.reason === 'sheet_without_sole_group',
    );
    toast.warning(
      semSolado
        ? `${prefix}Embalagem não debitada — a ficha desta referência não tem solado vinculado.`
        : `${prefix}Embalagem não debitada — nenhuma caixa configurada no solado.`,
      {
        description: semSolado
          ? 'A embalagem é definida pelo modelo de solado. Vincule o solado na ficha técnica (aba Solado).'
          : 'Cadastre em Solados → escolha o solado → Consumos → Embalagem.',
      },
    );
  } else if (skipped.length > 0) {
    toast.warning(`${prefix}Sem caixa vinculada para: ${skipped.join(', ')}.`, {
      description: 'Vincule em Solados → escolha o solado → Consumos → Embalagem.',
    });
  }
}
