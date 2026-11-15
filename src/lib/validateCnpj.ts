export function validateCnpj(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  // Reject all-same-digit sequences (00000000000000, 11111111111111, etc.)
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calc = (slice: string, weights: number[]) => {
    const sum = slice.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(digits.slice(0, 12), w1);
  if (d1 !== Number(digits[12])) return false;

  const d2 = calc(digits.slice(0, 13), w2);
  return d2 === Number(digits[13]);
}

export function validateCpf(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    const rem = (sum * 10) % 11;
    return rem === 10 ? 0 : rem;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

/**
 * Mesma regra do banco (`public.is_valid_cpf_cnpj`, trigger tg_validate_party_document):
 * vazio é permitido; preenchido precisa ser CPF (11) ou CNPJ (14) com dígitos válidos.
 */
export function validateCpfCnpj(raw: string | null | undefined): boolean {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits === '') return true;
  if (digits.length === 14) return validateCnpj(digits);
  if (digits.length === 11) return validateCpf(digits);
  return false;
}
