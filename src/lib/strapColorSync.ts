/**
 * Regra do auto-sync de cor das tiras com a COR PRINCIPAL do item do PV.
 *
 * Regra de negócio (user, 2026-05): "cor da sandália = cor da forração; em
 * modelos com tiras, cada cor de forração tem uma tira correspondente". Em vez de
 * o operador clicar "Igualar à principal" toda vez, o form acompanha a principal
 * automaticamente — mas só quando isso NÃO apaga uma escolha deliberada.
 *
 * Dois gatilhos independentes:
 *  1) `allBlank` — nenhuma tira tem cor: preencher com a principal é sempre
 *     seguro (não há dado do usuário a perder). Cobre item novo e tiras recém-
 *     adicionadas na ficha.
 *  2) `followedOldMain` — "seguir a principal" apenas quando ela REALMENTE mudou
 *     de um valor anterior não-vazio (`prevMain`) E todas as tiras estavam iguais
 *     a esse valor antigo (estavam de fato acompanhando a principal).
 *
 * `prevMain === null` significa "principal ainda não observada" — 1ª renderização
 * ou reabertura de um PV salvo. Nesse caso o follow NUNCA dispara, preservando a
 * cor de tira escolhida de propósito.
 *
 * BUG CORRIGIDO 2026-07-22 ("a seleção de tiras some ao reabrir o PV"): a regra
 * antiga sobrescrevia a cor da tira sempre que TODAS as tiras tivessem a mesma cor
 * ≠ da principal — condição trivialmente verdadeira para modelo de tira única.
 * Ao reabrir, a principal hidratava e a tira era reescrita para a cor do calçado,
 * gerando cor inexistente no grupo da tira (aviso "sem produto" + guard barrando o
 * save).
 */
export function shouldSyncStrapColorsToMain(
  prevMain: string | null,
  mainColor: string,
  straps: ReadonlyArray<{ color?: string | null }>,
): boolean {
  if (!mainColor || straps.length === 0) return false;
  const allBlank = straps.every((s) => !s?.color);
  const followedOldMain =
    prevMain != null &&
    prevMain !== '' &&
    mainColor !== prevMain &&
    straps.every((s) => s?.color === prevMain);
  return allBlank || followedOldMain;
}
