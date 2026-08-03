/**
 * Paginação server-side — núcleo compartilhado (2026-08-03).
 *
 * ## Por que existe
 *
 * O PostgREST devolve no máximo 1.000 linhas por padrão, **sem erro e sem
 * aviso**. Sete tabelas do sistema já passam disso (`time_records` 4.076,
 * `production_schedule` 2.729, `order_stages` 2.548, `material_reservations`
 * 1.472, `audit_logs` 1.414, `production_consumptions` 1.295,
 * `material_audit_log` 1.274). Como o filtro dessas telas era client-side, elas
 * filtravam e somavam em cima de um universo TRUNCADO — não é lentidão, é
 * número errado. Mesmo bug que `supabasePaginate.ts` documenta no lado das
 * leituras completas.
 *
 * A diferença entre os dois helpers:
 * - `fetchAllPages` (supabasePaginate.ts) — quando a tela precisa do universo
 *   INTEIRO (somatório, export, motor de cálculo). Faz N round-trips.
 * - `fetchPage` (aqui) — quando a tela mostra uma LISTAGEM pro usuário. Traz
 *   uma página e o total, em 1 round-trip.
 *
 * ## A regra do limiar (decisão do dono, 03/08/2026)
 *
 * Página de 50, mas o pager só aparece acima de 75 linhas. Abaixo disso a tela
 * carrega e mostra TUDO de uma vez — cadastro pequeno não ganha pager inútil
 * (nenhuma tabela de cadastro do sistema passa de 300 linhas: clientes 43,
 * fornecedores 13, funcionários 23).
 *
 * ⚠ O limiar (75) é MAIOR que a página (50) de propósito, e isso é a parte
 * delicada: se um total de 60 fosse paginado em 50 **e** o pager ficasse
 * escondido, sumiriam 10 linhas sem aviso — reintroduzindo exatamente o bug
 * que este arquivo existe pra matar. Por isso, quando `total <= PAGER_THRESHOLD`
 * o resultado traz as linhas TODAS, não as 50 primeiras. A janela de leitura da
 * página 1 é de 75 linhas justamente pra cobrir esse caso em 1 ida ao banco.
 */

/** Linhas por página quando a listagem é grande o bastante pra paginar. */
export const PAGE_SIZE = 50;

/**
 * Acima deste total a listagem pagina e o pager aparece. Até ele (inclusive), a
 * tela mostra tudo de uma vez e o pager fica oculto.
 */
export const PAGER_THRESHOLD = 75;

export interface PageParams {
  /** 1-based. Valores < 1 são tratados como 1. */
  page?: number;
  pageSize?: number;
  /** Acima deste total o pager aparece. Default `PAGER_THRESHOLD`. */
  pagerThreshold?: number;
}

export interface PageResult<T> {
  items: T[];
  /** Total de linhas que casam com o filtro NO BANCO — não o tamanho de `items`. */
  total: number;
  page: number;
  totalPages: number;
  /** `true` quando `total` passou do limiar. A UI usa isto pra decidir se renderiza o pager. */
  showPager: boolean;
  /** `true` quando `items` contém o resultado inteiro (listagem pequena). */
  isComplete: boolean;
}

/** Resposta do PostgREST com `count` — o shape que `.select(cols, { count: 'exact' })` devolve. */
type CountedResponse<T> = { data: T[] | null; error: unknown; count: number | null };

/**
 * Executa UMA página de uma listagem e devolve os itens + o total real.
 *
 * O callback recebe o intervalo e devolve a query JÁ com `.range(from, to)` e
 * JÁ com `{ count: 'exact' }` no select — é o `count` que informa o total sem
 * baixar o resto das linhas.
 *
 * ```ts
 * const res = await fetchPage(
 *   (from, to) =>
 *     supabase
 *       .from('audit_logs')
 *       .select('*', { count: 'exact' })
 *       .order('created_at', { ascending: false })
 *       .order('id')            // desempate determinístico
 *       .range(from, to),
 *   { page },
 * );
 * ```
 *
 * ⚠ A query PRECISA de `.order()` por coluna determinística. Sem ordem estável
 * o Postgres pode repetir ou pular linha entre páginas — o mesmo aviso que
 * `fetchAllPages` já carrega. Quando a coluna de ordenação tiver empate
 * (`created_at` repetido, por exemplo), acrescente um segundo `.order()` pela
 * PK pra desempatar.
 */
export async function fetchPage<T = unknown>(
  page: (from: number, to: number) => PromiseLike<CountedResponse<T>>,
  params: PageParams = {},
): Promise<PageResult<T>> {
  const pageSize = Math.max(1, params.pageSize ?? PAGE_SIZE);
  const pagerThreshold = Math.max(pageSize, params.pagerThreshold ?? PAGER_THRESHOLD);
  const current = Math.max(1, Math.floor(params.page ?? 1));

  // Na página 1 lemos até o limiar (75) em vez de só a página (50). Assim uma
  // listagem de 60 linhas volta INTEIRA numa única ida ao banco, e o pager pode
  // ficar escondido sem esconder linha junto. Da página 2 em diante já sabemos
  // que a listagem é grande, então lemos a janela normal.
  const isFirstPage = current === 1;
  const from = isFirstPage ? 0 : (current - 1) * pageSize;
  const to = isFirstPage ? pagerThreshold - 1 : from + pageSize - 1;

  const { data, error, count } = await page(from, to);
  if (error) throw error;

  const rows = data ?? [];
  // `count` nulo = o caller esqueceu `{ count: 'exact' }`. Cair pro tamanho da
  // página mascararia o total e quebraria o pager em silêncio; melhor estourar.
  if (count === null || count === undefined) {
    throw new Error(
      'fetchPage: a query não pediu `{ count: \'exact\' }` no select — sem o total não dá pra paginar sem esconder linha.',
    );
  }

  const total = count;
  const showPager = total > pagerThreshold;

  // Listagem pequena: devolve tudo que veio (já é o universo completo).
  if (!showPager) {
    return { items: rows, total, page: 1, totalPages: 1, showPager: false, isComplete: true };
  }

  // Listagem grande: na página 1 sobraram linhas da janela de leitura (75 lidas,
  // 50 exibidas) — descarta o excedente pra a página ter o tamanho anunciado.
  const items = isFirstPage ? rows.slice(0, pageSize) : rows;

  return {
    items,
    total,
    page: current,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    showPager: true,
    isComplete: false,
  };
}

/**
 * Resultado vazio — pra hook desabilitado (`enabled: false`) ou early-return sem
 * ida ao banco, sem obrigar a UI a tratar `undefined`.
 */
export function emptyPage<T = unknown>(): PageResult<T> {
  return { items: [], total: 0, page: 1, totalPages: 1, showPager: false, isComplete: true };
}

/**
 * Janela de números de página pro pager, com elipse.
 * Ex.: `pageWindow(7, 20)` → `[1, '…', 6, 7, 8, '…', 20]`.
 */
export function pageWindow(current: number, totalPages: number, radius = 1): Array<number | '…'> {
  if (totalPages <= 1) return [1];
  const pages = new Set<number>([1, totalPages]);
  for (let p = current - radius; p <= current + radius; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}
