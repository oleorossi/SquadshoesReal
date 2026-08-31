/**
 * Padrão DANFE NF 000.293 — emitida no painel ClickNotas em 22/08/2026
 * (PV-001621, VIA Z COMERCIO DE CALCADOS LTDA).
 *
 * Não emite nota. Serve pra conferir se o payload da API / o preview
 * carregam os mesmos campos que o quadro TRANSPORTADOR/VOLUMES dessa folha.
 */
export const NFE_DANFE_GOLD_293 = {
  numero: 293,
  serie: 1,
  pedido: "PV-001621",
  destinatario: "VIA Z COMERCIO DE CALCADOS LTDA",
  cnpj: "27414388000123",
  pares: 696,
  volumes: 58,
  pairs_per_box: 12,
  peso_liquido_kg: 262.32,
  peso_bruto_kg: 292.32,
  tara_kg: 30,
  unidade: "PAR",
  cfop: "5101",
  csosn: "0102",
  ncm: "64029990",
  valor_unitario: 21,
  valor_total: 14616,
  modalidade_frete: 3,
  especie: "VOLUMES",
  frete_label: "3-Próprio por conta do Rem",
} as const;

const SIMPLES_I = "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL";

export type NfeGoldPayloadSlice = {
  modalidade_frete?: number;
  especie_volumes?: string;
  quantidade_volumes?: number | string;
  qtd_volumes?: number | string;
  peso_bruto?: string;
  peso_liquido?: string;
  informacoes_complementares?: string;
  produtos?: Array<{ unidade?: string; cfop?: string; NCM?: string }>;
};

export function countSimplesAviso(text: string | null | undefined): number {
  if (!text) return 0;
  const matches = text.toUpperCase().match(new RegExp(SIMPLES_I, "g"));
  return matches?.length ?? 0;
}

/** Campos que a folha 293 preenche e o emit-nfe precisa mandar. */
export function checklistPayloadVs293(payload: NfeGoldPayloadSlice): string[] {
  const gaps: string[] = [];
  if (payload.modalidade_frete !== NFE_DANFE_GOLD_293.modalidade_frete) {
    gaps.push(`modalidade_frete=${payload.modalidade_frete} (esperado ${NFE_DANFE_GOLD_293.modalidade_frete})`);
  }
  const especie = String(payload.especie_volumes || "").toUpperCase();
  if (especie !== NFE_DANFE_GOLD_293.especie) {
    gaps.push(`especie_volumes=${payload.especie_volumes} (esperado ${NFE_DANFE_GOLD_293.especie})`);
  }
  const qtd = Number(payload.quantidade_volumes ?? payload.qtd_volumes);
  if (!Number.isFinite(qtd) || qtd < 1) {
    gaps.push("quantidade_volumes ausente");
  }
  if (!payload.peso_bruto) gaps.push("peso_bruto ausente");
  if (!payload.peso_liquido) gaps.push("peso_liquido ausente");
  const units = (payload.produtos || []).map((p) => String(p.unidade || "").toUpperCase());
  if (units.length > 0 && units.some((u) => u !== "PAR")) {
    gaps.push(`unidade item=${units.join(",")} (esperado PAR)`);
  }
  if (countSimplesAviso(payload.informacoes_complementares) > 1) {
    gaps.push("aviso do Simples Nacional duplicado nas complementares");
  }
  return gaps;
}
