import { stripColorFromName } from '@/lib/utils';

/**
 * Identidade do MATERIAL dentro de um grupo de estoque — o nome sem a cor.
 *
 * Um grupo pode guardar mais de um material (`COMPONENTES DIVERSOS` tem 8:
 * Binóculo, Fivela, Ilhós, ABS…). Quem precisa saber se o grupo é homogêneo
 * (1 material, N cores) ou heterogêneo (N materiais) compara ESTA chave, nunca
 * o `getBaseName` de corte de palavra — que devolvia `NAPA` para as 10 cores da
 * `NAPA SANTORINE` (spec `estoque-cores-e-editores.md` R1.1a).
 */
export function materialIdentity(product: { name: string; color?: string | null }): string {
  // `stripColorFromName` só corta o sufixo se ele bater com a cor ATUAL. Como
  // trocar a cor deixou de renomear o produto (R0.1), um nome antigo tipo
  // "NAPA SOFT - PRETO" com cor AZUL manteria o sufixo velho e viraria uma
  // segunda identidade do mesmo material — jogando o grupo pra heterogêneo e
  // fazendo toda linha exibir o nome com a cor errada. Cortar qualquer sufixo
  // " - X" é inócuo hoje (nenhum produto ativo usa esse padrão no nome) e
  // fecha o caso.
  const semCor = stripColorFromName(product.name, product.color ?? undefined).trim();
  return semCor.replace(/\s+-\s+.*$/, '').trim().toUpperCase() || semCor.toUpperCase();
}

/** Grupo com mais de um material — a lista mostra o nome em cada linha e o
 *  cadastro rápido de cor não serve (herdaria os dados de um irmão arbitrário). */
export function isHeterogeneousGroup(products: Array<{ name: string; color?: string | null }>): boolean {
  const materiais = new Set(products.map(materialIdentity));
  return materiais.size > 1;
}
