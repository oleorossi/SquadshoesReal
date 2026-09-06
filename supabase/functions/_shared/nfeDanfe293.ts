/** Padrão DANFE #293 — unidade, espécie e aviso do Simples sem duplicar. */

export const NFE_ESPECIE_VOLUMES = "VOLUMES";
export const NFE_UNIDADE_PAR = "PAR";

export function resolveNfeItemUnidade(opts: {
  isStandalone: boolean;
  hasMaterialVariant: boolean;
  hasTechnicalSheet: boolean;
  productUnit?: string | null;
}): string {
  if (!opts.isStandalone || opts.hasMaterialVariant || opts.hasTechnicalSheet) {
    return NFE_UNIDADE_PAR;
  }
  return String(opts.productUnit || "UN").trim().toUpperCase().slice(0, 6) || "UN";
}

export function stripAvisoSimples(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/I\s*[-–]\s*DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL\.?/gi, "")
    .replace(/II\s*[-–]\s*N[AÃ]O GERA DIREITO A CR[EÉ]DITO FISCAL DE IPI\.?/gi, "")
    .replace(/DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL\.?/gi, "")
    .replace(/[ \t]*\r?\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/^[ ·\n\r]+|[ ·\n\r]+$/g, "")
    .trim();
  return cleaned || null;
}

export function avisoSimplesNacionalText(): string {
  return "I - DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL.\r\n"
    + "II - NAO GERA DIREITO A CREDITO FISCAL DE IPI.";
}
