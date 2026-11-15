import { describe, expect, it } from 'vitest';
import { partyDocumentErrorMessage, partySaveErrorText } from '@/lib/partyDocumentErrors';

describe('mensagens de CNPJ/CPF (trigger tg_validate_party_document)', () => {
  it('documento inválido (23514)', () => {
    const err = { code: '23514', message: 'CNPJ/CPF inválido: 11.111.111/1111-11 (dígitos verificadores não conferem ou tamanho incorreto)' };
    expect(partyDocumentErrorMessage(err, 'cliente')).toMatch(/CNPJ\/CPF inválido/);
  });

  it('documento duplicado (23505) cita o cadastro existente', () => {
    const err = { code: '23505', message: 'CNPJ/CPF 32.168.100/0001-18 já está cadastrado em outro registro (PONTO MIX LTDA)' };
    expect(partyDocumentErrorMessage(err, 'fornecedor')).toBe(
      'Este CNPJ/CPF já está cadastrado em outro fornecedor: PONTO MIX LTDA. Abra o cadastro existente em vez de duplicar.',
    );
  });

  it('outros erros seguem a mensagem original', () => {
    const err = { code: '42501', message: 'permission denied for table clients' };
    expect(partyDocumentErrorMessage(err, 'cliente')).toBeNull();
    expect(partySaveErrorText(err, 'cliente')).toBe('Erro: permission denied for table clients');
  });
});

describe('validateCpfCnpj (espelha public.is_valid_cpf_cnpj)', async () => {
  const { validateCpfCnpj } = await import('@/lib/validateCnpj');
  it('aceita vazio, CNPJ e CPF válidos', () => {
    expect(validateCpfCnpj('')).toBe(true);
    expect(validateCpfCnpj(null)).toBe(true);
    expect(validateCpfCnpj('11.222.333/0001-81')).toBe(true);
    expect(validateCpfCnpj('529.982.247-25')).toBe(true);
  });
  it('recusa dígito errado, sequência repetida e tamanho errado', () => {
    expect(validateCpfCnpj('11.222.333/0001-82')).toBe(false);
    expect(validateCpfCnpj('111.111.111-11')).toBe(false);
    expect(validateCpfCnpj('123456')).toBe(false);
  });
});
