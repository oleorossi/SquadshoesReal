// Formatação das respostas do Zap (§9) e helpers de data/dinheiro.

import type { PayableExtract } from "../extract/anthropic.ts";

export function brl(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

// "YYYY-MM-DD" -> "DD/MM".
export function ddmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return d && m ? `${d}/${m}` : iso;
}

// Resumo de confirmação de conta a pagar (§9).
export function payableSummary(
  e: PayableExtract,
  supplierName: string,
): string {
  const lines = [
    "📌 CONTA A PAGAR",
    `Fornecedor: ${supplierName}`,
    `Valor: ${brl(e.amount)}`,
    `Vence: ${ddmm(e.due_date)}${e.due_in_days != null ? ` (${e.due_in_days} dias)` : ""}`,
  ];
  if (e.boleto_number) lines.push(`Boleto: ${e.boleto_number}`);
  if (e.installment_number && e.total_installments && e.total_installments > 1) {
    lines.push(`Parcela: ${e.installment_number}/${e.total_installments}`);
  }
  if (e.category) lines.push(`Categoria: ${e.category}`);
  lines.push("", "Confirma? responde *SIM*");
  return lines.join("\n");
}

// Lista de fornecedores ambíguos (§6.3). A seleção por número é da Fase 4;
// por ora pedimos pra reenviar com o nome exato.
export function ambiguousSuppliers(
  names: string[],
  extractedName: string | null,
): string {
  const list = names.map((n, i) => `${i + 1}) ${n}`).join("\n");
  return [
    `🤔 Achei mais de um fornecedor pra "${extractedName ?? "?"}":`,
    list,
    "",
    "Reenvia com o nome exato. Ex.: PAGAR <nome exato> 1250 vence 21 dias",
  ].join("\n");
}
