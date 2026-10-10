/**
 * Palavra única de confirmação de exclusão (decisão do dono, 10/10/2026).
 *
 * Antes cada tela pedia uma coisa: o nº do PV, o nome da ficha, `EXCLUIR <N>`
 * num window.prompt. Agora toda exclusão que exige digitação pede só "excluir".
 * A proteção contra o OK acidental (incidente dos 7 PVs, mai/2026) continua: o
 * que barra o clique sem ler é ter que digitar, não o texto exato.
 * Maiúscula/minúscula e espaço sobrando não importam.
 */
export const DELETE_CONFIRM_WORD = 'excluir';

export function isDeleteConfirmWord(text: string | null | undefined): boolean {
  return (text ?? '').trim().toLowerCase() === DELETE_CONFIRM_WORD;
}
