/**
 * MODELO DE INFORMAÇÃO DA FICHA DE OPERADOR (CANÔNICO, 20/08/2026)
 *
 * Decisão do dono na rodada 1 do redesenho (canvas "Fichas de Operador",
 * arquivos-fonte em `design/fichas-operador/`). A pergunta da rodada era
 * **o que entra em cada ficha** — a estética ficou para depois, então os
 * modelos abaixo mexem só em CONTEÚDO, não em tipografia nem em cor.
 *
 *   'lote'   — "O lote": a ficha é a identidade do lote físico que anda pela
 *              fábrica. Rastreio (OP · PV · cliente · entrega) numa faixa
 *              legível, e a referência e a cor param de aparecer duas vezes.
 *              Saem o trilho dos 11 setores e o índice editorial ("OP 08 /").
 *
 *   'mao'    — "A mão": só o que a mão executa. Além do que sai no 'lote',
 *              saem também o QR e o rastreio inteiro. Escolhido no Silk, onde
 *              o operador age sobre a ARTE, não sobre o pedido.
 *
 *   'legacy' — o header como sempre foi. É o default: setor que não aparece
 *              no mapa abaixo não muda em nada.
 *
 * ⚠ A Expedição continua em 'legacy' DE PROPÓSITO — a escolha dela (E1/E2/E3,
 * pedido replicado em várias lojas) não foi fechada. Não promova a Expedição
 * para 'lote' por analogia; é decisão de produto, não de coerência.
 *
 * ⚠ A chave é o nome do SETOR como o app o identifica (`activeSectors` /
 * `includesSector` no `PrintWorkSheetsPage`), NÃO o rótulo impresso e NÃO o
 * passo do trilho. Os três divergem no corte de palmilha: o rótulo é
 * "Corte de Placa de Fibra", o setor é 'Corte Palmilha' e o passo em
 * `SECTOR_FLOW` é 'Corte Fibra'. Usar a grafia errada aqui não quebra nada —
 * cai em 'legacy' e o setor silenciosamente não muda.
 */
export type FichaModel = 'legacy' | 'lote' | 'mao';

/** Setores cujo modelo foi decidido. Ausente = 'legacy' (não muda). */
export const FICHA_MODEL_BY_SECTOR: Readonly<Record<string, FichaModel>> = {
  Montagem: 'lote',
  'Corte Palmilha': 'lote',
  Solagem: 'lote',
  Silk: 'mao',
};

/** Modelo do setor. Setor desconhecido cai em 'legacy' — nunca quebra. */
export function fichaModelFor(sector: string | null | undefined): FichaModel {
  if (!sector) return 'legacy';
  return FICHA_MODEL_BY_SECTOR[sector] ?? 'legacy';
}

/** Trilho dos 11 setores + índice editorial ("OP 08 / MONTAGEM"). */
export const showsFlowRail = (m: FichaModel): boolean => m === 'legacy';

/** QR do canto do header. Sai só no modelo 'mao'. */
export const showsQr = (m: FichaModel): boolean => m !== 'mao';

/** Rastreio (OP · PV · cliente · entrega). Sai só no modelo 'mao'. */
export const showsTrace = (m: FichaModel): boolean => m !== 'mao';
