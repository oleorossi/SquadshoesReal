import React, { createContext } from 'react';

/**
 * Inversão da ordem de SAÍDA na impressão (2026-07-24).
 *
 * Problema relatado pelo dono: a impressora da fábrica empilha as folhas com a
 * face pra CIMA — a 1ª página emitida fica no fundo da pilha e o maço sai "de
 * trás pra frente" na mão de quem pega. Compensação: no momento do print,
 * emitir TODAS as páginas físicas da última pra primeira, pra pilha final ler
 * na ordem certa (Corte → … → Expedição).
 *
 * Como funciona (duas camadas, ambas ativadas SÓ durante o print — a
 * pré-visualização em tela nunca muda):
 *  1. `ReversibleStack` inverte a ordem dos filhos top-level da print-area
 *     (os maços de setor e as fichas individuais de Expedição/Relatório).
 *  2. `ReversePrintContext` chega ao `PaginatedSheet`, que emite as páginas A4
 *     de cada maço da última pra primeira (a numeração "N/TOTAL" da faixa de
 *     cabeçalho é a LÓGICA — não muda com a inversão).
 * Combinadas, a emissão é a reversão completa do documento página a página.
 *
 * Limite conhecido: bloco maior que 1 página (pagi-page--flow) é fragmentado
 * pelo browser em ordem de LEITURA (fragmentação CSS não inverte) dentro de
 * uma emissão globalmente invertida — na PILHA final, as folhas internas
 * desse bloco saem em ordem reversa de leitura (igual ao baseline sem
 * compensação; são as mesmas folhas sem faixa N/TOTAL). Edge case aceito
 * porque quase todo conteúdo longo já é fatiado em chunks < 1 página;
 * mitigação real é fatiar o bloco que estourar (ex.: Resumo embalagem da
 * Expedição), não aceitar o flow.
 *
 * O layout reduzido (.reduced-card) TAMBÉM inverte (fix da revisão
 * 2026-07-24): Expedição e Relatório Gerencial não têm variante reduzida —
 * no "Relatório simplificado" imprimem a ficha completa e precisam da
 * compensação. Os cards recortáveis reordenados são inofensivos (vão pra
 * tesoura; o empacotamento por A4 é do browser de qualquer forma).
 */
export const ReversePrintContext = createContext(false);

interface ReversibleStackProps {
  reverse: boolean;
  children: React.ReactNode;
}

/** Inverte a ordem dos filhos quando `reverse` — senão render transparente.
 *  `Children.toArray` achata arrays de `.map()` (cada ficha de Expedição/
 *  Relatório vira um filho próprio, invertido individualmente) e descarta
 *  `false`/`null` de condicionais `{cond && ...}`. */
export const ReversibleStack = ({ reverse, children }: ReversibleStackProps) => {
  const arr = React.Children.toArray(children);
  return <>{reverse ? [...arr].reverse() : arr}</>;
};
