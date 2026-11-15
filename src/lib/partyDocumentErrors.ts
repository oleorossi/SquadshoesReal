/**
 * Mensagens amigáveis para os erros de documento (CNPJ/CPF) de clientes e fornecedores.
 *
 * O banco valida o documento no trigger `tg_validate_party_document`
 * (migration 20270101046600_valida_cnpj_cpf_clientes_fornecedores):
 *   • 23514 (check_violation)  → dígitos verificadores/tamanho inválidos;
 *   • 23505 (unique_violation) → mesmo documento já cadastrado em outro registro.
 * Só age quando o documento é gravado ou alterado — editar outros campos de um
 * cadastro antigo nunca dispara o erro.
 */

type MaybePgError = { code?: string | null; message?: string | null } | null | undefined;

export type PartyKind = 'cliente' | 'fornecedor';

export function partyDocumentErrorMessage(err: unknown, kind: PartyKind): string | null {
  const e = (err ?? {}) as MaybePgError;
  const code = e?.code ?? '';
  const message = e?.message ?? (err instanceof Error ? err.message : '');
  if (!message.includes('CNPJ/CPF')) return null;

  if (code === '23514' || /inv[aá]lido/i.test(message)) {
    return 'CNPJ/CPF inválido — confira os números (os dígitos verificadores não batem ou falta/sobra dígito).';
  }
  if (code === '23505' || /j[aá] est[aá] cadastrado/i.test(message)) {
    const owner = message.match(/outro registro \((.*)\)\s*$/)?.[1]?.trim();
    const where = kind === 'cliente' ? 'outro cliente' : 'outro fornecedor';
    return owner
      ? `Este CNPJ/CPF já está cadastrado em ${where}: ${owner}. Abra o cadastro existente em vez de duplicar.`
      : `Este CNPJ/CPF já está cadastrado em ${where}. Abra o cadastro existente em vez de duplicar.`;
  }
  return null;
}

/** Texto final do toast de erro de gravação de cliente/fornecedor. */
export function partySaveErrorText(err: unknown, kind: PartyKind): string {
  const friendly = partyDocumentErrorMessage(err, kind);
  if (friendly) return friendly;
  const message = (err as MaybePgError)?.message ?? (err instanceof Error ? err.message : String(err));
  return `Erro: ${message}`;
}
