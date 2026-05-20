import { toast } from 'sonner';

/**
 * Toast Messages — centralized pt-BR messaging utilities.
 *
 * Patterns observados em 2026-05:
 *   - `toast.error(\`Erro: ${err.message}\`)` aparece 166× no codebase
 *   - `toast.error(e.message)` aparece 124×
 *   - Mensagens hardcoded inconsistentes ("Material adicionado!" vs
 *     "Conta atualizada!" sem padrão)
 *
 * Use os helpers abaixo (toastError, toastSaved, toastDeleted, etc.)
 * pra garantir mensagens consistentes. Pra casos específicos, use as
 * constants em MESSAGES.
 *
 * Adopção é orgânica — migre quando tocar no arquivo.
 */

/** Extrai mensagem de qualquer error-like value de forma segura. */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Erro desconhecido';
}

/**
 * Toast de erro padronizado.
 *
 * @example
 *   toastError(err);                    // "Erro: <message>"
 *   toastError(err, 'Salvar pedido');   // "Erro ao Salvar pedido: <message>"
 *   toastError(err, 'Salvar', { duration: 12000 });
 */
export function toastError(err: unknown, context?: string, options?: Parameters<typeof toast.error>[1]) {
  const msg = getErrorMessage(err);
  const text = context ? `Erro ao ${context}: ${msg}` : `Erro: ${msg}`;
  return toast.error(text, options);
}

/**
 * Toast de sucesso pra criação/atualização.
 *
 * @example
 *   toastSaved('Pedido');               // "Pedido salvo com sucesso"
 *   toastSaved('Material', 'criado');   // "Material criado com sucesso"
 */
export function toastSaved(entity: string, verb: 'salvo' | 'criado' | 'atualizado' | 'cadastrado' = 'salvo') {
  // Concordância simples — sufixo "a" pra feminino. Detecta heurística:
  // termina em "a" e não em "ema/oma/dia" → feminino
  const isFem = /[aã]$/i.test(entity) && !/(ema|oma|dia|coma|tema|trema|sistema|programa|drama)$/i.test(entity);
  const verbForm = isFem ? verb.replace(/o$/, 'a') : verb;
  return toast.success(`${entity} ${verbForm} com sucesso`);
}

/**
 * Toast de sucesso pra exclusão.
 *
 * @example
 *   toastDeleted('Pedido');             // "Pedido excluído com sucesso"
 *   toastDeleted('Conta');              // "Conta excluída com sucesso"
 */
export function toastDeleted(entity: string) {
  const isFem = /[aã]$/i.test(entity);
  const verb = isFem ? 'excluída' : 'excluído';
  return toast.success(`${entity} ${verb} com sucesso`);
}

/** Toast pra validações de formulário. */
export function toastValidation(message: string) {
  return toast.warning(message);
}

/** Toast informativo (ações que requerem seleção, etc.). */
export function toastInfo(message: string) {
  return toast.info(message);
}

/**
 * Mensagens canônicas reutilizáveis. Use quando o helper genérico
 * não capturar a intenção.
 */
export const MESSAGES = {
  validation: {
    requiredName: 'Nome é obrigatório',
    requiredField: (field: string) => `${field} é obrigatório`,
    invalidImage: 'Selecione um arquivo de imagem.',
    invalidFormat: (format: string) => `Formato inválido. Use ${format}`,
    selectAtLeastOne: (entity: string) => `Selecione pelo menos ${entity}.`,
    selectColor: 'Selecione uma cor para todos os itens.',
  },
  empty: {
    noOPsForFilter: 'Nenhuma OP para exportar com o filtro atual',
  },
  network: {
    uploadError: 'Falha no upload. Tente novamente.',
    connectionError: 'Sem conexão com o servidor.',
  },
} as const;
