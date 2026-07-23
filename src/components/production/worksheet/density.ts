/**
 * density — constantes de DENSIDADE das fichas de operador ("Opção A", 2026-07-23).
 *
 * Problema medido no maço de Aviamento (`teste aviamento.pdf`, PV-00148 +
 * PV-00147, 8 referências / 19 cores): 19 folhas A4 para 11,7 folhas de tinta.
 * Ocupação média de 61% (mínimo 48%), ou seja **38% do papel saía em branco**.
 * A causa não era o paginador — era a ALTURA do card de cor: 622px contra
 * ~948px úteis por folha, então dois cards nunca cabiam juntos e cada cor
 * levava uma folha inteira.
 *
 * Anatomia do card de 622px (DS20 · OFF WHITE, medido):
 *   cabeçalho 41 · **foto 146** · rótulo da grade 16 · grade 234 ·
 *   consumo 62 · controle de fichas 86 · margens 37
 *
 * O maior desperdício era a FOTO: 140px de altura numa faixa própria usando
 * só 27% da largura — os outros 73% daquela faixa eram papel em branco em
 * toda cor de toda referência. É o único bloco que gastava altura sem
 * entregar informação na largura toda.
 *
 * A "Opção A" (escolhida pelo dono entre duas propostas) corta 231px do card
 * sem tirar NENHUMA informação do papel:
 *   1. foto vira MINIATURA no cabeçalho da cor (a faixa própria deixa de existir);
 *   2. some o rótulo "Grade · Pares por Numeração" (o thead já diz "Nº");
 *   3. consumo de UMA linha vira faixa única (sem barra preta nem thead);
 *   4. controle de fichas em caixa `sm`;
 *   5. checkbox por numeração de 20 → 16px;
 *   6. paddings/respiros um degrau abaixo.
 *
 * ⚠ REGRA WYSIWYG (ver `project_print_wysiwyg_pagination`): estas constantes
 * valem SEMPRE — em tela E no papel. O `PaginatedSheet` mede o layout de TELA
 * pra empacotar as folhas; qualquer redução de altura que viva só dentro de
 * `@media print` faz o pé da caixa derramar numa folha em branco.
 *
 * ⚠ SINGULARIDADES DE SETOR — o que NÃO cai nesta regra:
 *   - **Corte Forração**: as miniaturas por referência (92px, `showCompactImages`)
 *     foram AUMENTADAS a pedido do dono em 2026-07-22 (de 54 pra 92). Não
 *     reduzir — o cortador identifica o modelo por elas.
 *   - **Silk**: a logomarca a estampar (110px) é o objeto de trabalho do setor,
 *     e já renderiza com o texto AO LADO (a largura é usada). Fica como está.
 *   - **Palmilha / Solagem**: o strip de sandálias já usa 55×55 com wrap,
 *     ocupando a largura inteira. Só o tally muda.
 *   - **Operator** (Colagem/Acabamento): a foto de 192px já tem os dados do
 *     produto ao lado — a largura é usada. Só o tally muda.
 *   - **Reduced**: já nasceu no padrão da Opção A (foto ao lado da grade +
 *     tally `sm`). É o precedente que as outras fichas passam a seguir.
 */

/** Tamanho da caixinha do Controle de Fichas em TODA ficha de operador.
 *
 *  `sm` (20px) em vez de `md` (25px). Além dos 5px por caixa, o `TallyBox`
 *  recalcula as colunas pela largura útil (710px): `md` cabe 20 por linha,
 *  `sm` cabe 30 — então 24 fichas caem de 2 linhas para 1, e uma palmilha
 *  consolidada de 213 fichas cai de 11 linhas (319px) para 8 (176px). */
export const TALLY_SIZE = 'sm' as const;

/** Miniatura da foto do produto DENTRO do cabeçalho da cor (era faixa própria
 *  de 140px). 46px casa com a altura que o cabeçalho já tinha (rótulo "Cor" +
 *  nome em Anton 22px ≈ 29px, lado direito com "Pares" em Anton 25px ≈ 31px),
 *  então a miniatura define a altura da linha sem custar quase nada. */
export const HEADER_THUMB_PX = 46;

/** Lado do checkbox por numeração (linhas Frente/Traseira do Aviamento).
 *  20 → 16px: continua confortável de marcar à caneta e devolve ~8px por
 *  linha de etapa. */
export const STEP_CHECKBOX_PX = 16;

/** Nº máximo de linhas de consumo que cabem na faixa única (sem barra preta
 *  nem cabeçalho de tabela). Com 2+ materiais a tabela volta — a comparação
 *  entre linhas é o que o operador lê, e ela precisa das colunas alinhadas. */
export const CONSUMO_SLIM_MAX_ROWS = 1;

/**
 * Decide se um bloco de consumo pode virar faixa única.
 *
 * Só com UMA linha e sem aviso de largura faltando: o aviso "cadastrar largura
 * na ficha de componente" precisa de uma segunda linha embaixo do material, e
 * espremer isso numa faixa esconderia o alerta que evita consumo ~100× errado
 * (ver `project_consumo_materiais_regra`).
 */
export function canUseSlimConsumo(
  rows: ReadonlyArray<{ source?: string | null }>,
): boolean {
  if (rows.length !== CONSUMO_SLIM_MAX_ROWS) return false;
  return !rows.some((r) => r.source === 'width_missing');
}
