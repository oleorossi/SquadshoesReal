import { toast } from 'sonner';

/**
 * Helper compartilhado pra bulk delete com confirmação digitada anti-acidente.
 *
 * Padrão estabelecido em 19/05/2026 depois de 7 PVs sumirem por delete acidental
 * via window.confirm (clique no OK sem ler). Agora user precisa digitar exato
 * `EXCLUIR <N>` num window.prompt — clique acidental não passa mais.
 *
 * Uso:
 * ```ts
 * await confirmAndBulkDelete({
 *   ids: Array.from(selectedIds),
 *   entityLabel: 'cliente',
 *   sampleLines: orders.filter(o => selectedIds.has(o.id))
 *     .slice(0, 5).map(o => `• ${o.razao_social}`),
 *   deleteOne: (id) => deleteClient.mutateAsync(id),
 *   onAfter: () => setSelectedIds(new Set()),
 * });
 * ```
 */
export interface ConfirmBulkDeleteOpts {
  ids: string[];
  /** Singular do tipo (ex: "cliente", "ficha", "componente") */
  entityLabel: string;
  /** Primeiras 5 linhas pra preview (ex: "• PV-00121 (Cliente X)") */
  sampleLines: string[];
  /** Função que deleta UM item (await pra cada). Retorna Promise. */
  deleteOne: (id: string) => Promise<unknown>;
  /** Callback após sucesso/falha (limpar seleção, etc.) */
  onAfter?: () => void;
  /** Texto extra antes do "Confirmar:" (ex: aviso de NF-e ativa). */
  extraWarning?: string;
}

export async function confirmAndBulkDelete(opts: ConfirmBulkDeleteOpts): Promise<{
  succeeded: number;
  failed: number;
  cancelled: boolean;
}> {
  const { ids, entityLabel, sampleLines, deleteOne, onAfter, extraWarning } = opts;
  if (ids.length === 0) return { succeeded: 0, failed: 0, cancelled: true };

  const sample = sampleLines.slice(0, 5).join('\n');
  const more = ids.length > 5 ? `\n... e mais ${ids.length - 5}` : '';
  const plural = ids.length === 1 ? entityLabel : `${entityLabel}s`;
  const expectedText = `EXCLUIR ${ids.length}`;

  const msg =
    `Você está EXCLUINDO ${ids.length} ${plural}:\n\n${sample}${more}\n\n` +
    (extraWarning ? `${extraWarning}\n\n` : '') +
    `Para confirmar, digite exatamente: ${expectedText}`;

  const typed = window.prompt(msg, '');
  if (typed !== expectedText) {
    if (typed !== null) toast.error('Texto digitado não confere. Exclusão cancelada.');
    return { succeeded: 0, failed: 0, cancelled: true };
  }

  const results = await Promise.allSettled(ids.map(id => deleteOne(id)));
  const failed = results.filter(r => r.status === 'rejected').length;
  const succeeded = ids.length - failed;
  onAfter?.();

  if (failed === 0) {
    toast.success(`${succeeded} ${succeeded === 1 ? plural : plural} excluído${succeeded === 1 ? '' : 's'}`);
  } else if (succeeded === 0) {
    toast.error(`Falha ao excluir todos os ${ids.length} ${plural}.`);
  } else {
    toast.warning(`${succeeded} excluído${succeeded === 1 ? '' : 's'}, ${failed} falha${failed === 1 ? '' : 's'}.`);
  }

  return { succeeded, failed, cancelled: false };
}
