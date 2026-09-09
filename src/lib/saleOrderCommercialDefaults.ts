/**
 * Defaults comerciais do cliente/grupo econômico aplicados ao formulário de PV.
 *
 * Em criação, campos vazios recebem payment_condition e factoring_config_id.
 * Em edição, factoring_config_id vazio é estado INTENCIONAL (sem factoring) —
 * preenchê-lo com o default do cliente gera factoring_patch distinto do DB e
 * o preflight recusa com "factoring_patch só pode mudar antes da aprovação."
 */

export interface CommercialDefaultsForForm {
  payment_condition?: string | null;
  factoring_config_id?: string | null;
}

export interface CommercialFormSlice {
  payment_condition?: string;
  factoring_config_id?: string;
}

export function applyClientCommercialDefaultsToForm<T extends CommercialFormSlice>(
  form: T,
  defaults: CommercialDefaultsForForm,
  opts: { isEdit: boolean },
): T {
  return {
    ...form,
    payment_condition: form.payment_condition || defaults.payment_condition || '',
    factoring_config_id: opts.isEdit
      ? (form.factoring_config_id ?? '')
      : (form.factoring_config_id || defaults.factoring_config_id || ''),
  };
}
