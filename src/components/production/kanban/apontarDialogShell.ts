/**
 * Shell do diálogo de apontamento na Central de Produção.
 * Preenche a tela (ultrawide incluído), com cabeçalho e rodapé fixos e
 * corpo rolável — a grade de numeração e os botões ficam visíveis sem
 * corte horizontal nem rodapé escondido atrás do scroll.
 */
export const APONTAR_DIALOG_SHELL =
  'flex h-[92dvh] max-h-[92dvh] w-[96vw] max-w-[96vw] sm:max-w-[96vw] flex-col gap-0 sm:gap-0 overflow-hidden p-0 sm:p-0';

export const APONTAR_DIALOG_HEADER =
  'shrink-0 space-y-3 px-4 pb-3 pr-12 pt-4 text-left sm:text-left';

export const APONTAR_DIALOG_BODY =
  'min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-1';

export const APONTAR_DIALOG_FOOTER =
  'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3';

export const APONTAR_DIALOG_WARNING =
  'min-w-0 whitespace-normal break-words rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300';
