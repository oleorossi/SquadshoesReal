import { toast } from 'sonner';

type DebitEntry = { status?: string; packaging_type?: string; box_name?: string };

/**
 * Inspeciona o retorno JSON de `debit_packaging_for_order` e avisa o usuário
 * (toast âmbar, não-bloqueante) quando a embalagem NÃO foi debitada por falta de
 * cadastro — nenhuma caixa configurada no grupo do solado, ou um tipo de caixa
 * do modo sem caixa vinculada. O débito em si já rodou; isto só torna visível o
 * "silêncio" que antes passava batido.
 */
export function warnPackagingDebit(data: unknown, contextLabel?: string): void {
  if (!Array.isArray(data)) return;
  const prefix = contextLabel ? `${contextLabel}: ` : '';
  const noConfig = data.some((e: DebitEntry) => e?.status === 'no_packaging_configured');
  const skipped = data
    .filter((e: DebitEntry) => e?.status === 'skipped_no_box_linked')
    .map((e: DebitEntry) => e.packaging_type)
    .filter(Boolean);

  if (noConfig) {
    toast.warning(`${prefix}Embalagem não debitada — nenhuma caixa configurada no grupo do solado.`, {
      description: 'Cadastre em Estoque → Grupos → editar o solado → aba Embalagem.',
    });
  } else if (skipped.length > 0) {
    toast.warning(`${prefix}Sem caixa vinculada para: ${skipped.join(', ')}.`, {
      description: 'Vincule em Estoque → Grupos → editar o solado → aba Embalagem.',
    });
  }
}
