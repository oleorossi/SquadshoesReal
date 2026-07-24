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
 * pelo browser em ordem de leitura — as páginas INTERNAS desse bloco não
 * invertem (edge case aceito, mesmo status do cabeçalho ausente nessas
 * páginas). O layout reduzido (.reduced-card) fica FORA da inversão: as
 * fichas são recortadas na tesoura, ordem de folha não importa.
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
