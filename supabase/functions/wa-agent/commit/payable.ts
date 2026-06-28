// ════════════════════════════════════════════════════════════════════════
// Commit em accounts_payable (§5.2). Só roda após confirmação humana ("SIM").
//
// Mapeamento extraído→coluna validado contra o schema real de
// `accounts_payable` (ssvxfoybzmjlypnipqzn):
//   amount NOT NULL (>0 garantido antes), due_date NOT NULL, description
//   NOT NULL, category default 'material', status 'pending', amount_paid 0.
//   reference_type='whatsapp_agent', reference_id=id da wa_pending_actions.
//   cost_center_id / account_id ficam nulos (preenchidos depois no ERP).
// ════════════════════════════════════════════════════════════════════════

import type { PayableExtract } from "../extract/anthropic.ts";

export interface PendingAction {
  id: string;
  supplier_id: string | null;
  extracted: PayableExtract;
}

export async function commitPayable(
  supabase: any,
  pending: PendingAction,
  supplierName: string | null,
): Promise<{ id: string }> {
  const e = pending.extracted;

  const description = (e.description && e.description.trim()) ||
    [supplierName, e.boleto_number ? `boleto ${e.boleto_number}` : null]
      .filter(Boolean).join(" — ") ||
    "Conta a pagar (WhatsApp)";

  const row = {
    supplier_id: pending.supplier_id,
    amount: e.amount, // já validado > 0 no handler
    due_date: e.due_date, // já validado presente/plausível no handler
    description,
    category: (e.category && e.category.trim()) || "material",
    barcode: e.barcode ?? "",
    boleto_number: e.boleto_number ?? "",
    installment_number: e.installment_number ?? 1,
    total_installments: e.total_installments ?? 1,
    notes: e.notes ?? "",
    status: "pending",
    amount_paid: 0,
    reference_type: "whatsapp_agent",
    reference_id: pending.id, // rastreio de volta pra wa_pending_actions
  };

  const { data, error } = await supabase
    .from("accounts_payable")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`accounts_payable insert: ${error.message}`);
  return data;
}
