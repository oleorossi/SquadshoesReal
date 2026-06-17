// Remetente/fabricante padrão das etiquetas e fichas. Centraliza o CNPJ
// historicamente hardcoded em vários callers (LabelProductionTab, LabelManualTab,
// SaleOrders) para conformidade INMETRO 576/2014 — o rodapé "FABRICADO NO BRASIL"
// precisa carregar o CNPJ do fabricante. Quando o PV/empresa tem company_id, a
// resolução usa o CNPJ da empresa escolhida; senão cai na primária / no padrão.

export const DEFAULT_MANUFACTURER_NAME = 'SQUAD SHOES IND. E COM. DE CALÇADOS LTDA';
export const DEFAULT_MANUFACTURER_CNPJ = '62.406.033/0001-93';

interface CompanyLike {
  id: string;
  cnpj?: string | null;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  is_primary?: boolean | null;
}

/** Formata um CNPJ só-dígitos no padrão XX.XXX.XXX/XXXX-XX; devolve o original se não tiver 14 dígitos. */
export function formatCnpj(raw?: string | null): string {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length !== 14) return raw || '';
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

/**
 * Resolve o CNPJ do remetente/fabricante a partir da lista de empresas e de um
 * company_id opcional (vindo do PV). Ordem: empresa do id → primária → primeira →
 * fallback DEFAULT_MANUFACTURER_CNPJ.
 */
export function resolveSenderCnpj(
  companies: CompanyLike[] | undefined | null,
  companyId?: string | null,
): string {
  const list = companies || [];
  const co =
    (companyId && list.find((c) => c.id === companyId)) ||
    list.find((c) => c.is_primary) ||
    list[0];
  if (!co) return DEFAULT_MANUFACTURER_CNPJ;
  // Só aceita CNPJ com 14 dígitos; cadastro malformado/vazio cai no DEFAULT em
  // vez de estampar "CNPJ 123" ou rodapé sem CNPJ no rótulo (INMETRO 576/2014).
  const digits = (co.cnpj || '').replace(/\D/g, '');
  return digits.length === 14 ? formatCnpj(digits) : DEFAULT_MANUFACTURER_CNPJ;
}
