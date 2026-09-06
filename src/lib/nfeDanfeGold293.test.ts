import { describe, expect, it } from "vitest";
import {
  NFE_DANFE_GOLD_293,
  checklistPayloadVs293,
  countSimplesAviso,
} from "./nfeDanfeGold293";

describe("DANFE 293 — padrão ClickNotas painel", () => {
  it("fecha a conta de volumes da colmeia 12", () => {
    expect(NFE_DANFE_GOLD_293.pares / NFE_DANFE_GOLD_293.pairs_per_box).toBe(
      NFE_DANFE_GOLD_293.volumes,
    );
    expect(NFE_DANFE_GOLD_293.peso_bruto_kg - NFE_DANFE_GOLD_293.peso_liquido_kg)
      .toBeCloseTo(NFE_DANFE_GOLD_293.tara_kg, 2);
    expect(NFE_DANFE_GOLD_293.pares * NFE_DANFE_GOLD_293.valor_unitario)
      .toBe(NFE_DANFE_GOLD_293.valor_total);
  });

  it("payload no padrão 293 não deixa gap de transporte/unidade", () => {
    const gaps = checklistPayloadVs293({
      modalidade_frete: 3,
      especie_volumes: "VOLUMES",
      quantidade_volumes: 58,
      peso_bruto: "292.320",
      peso_liquido: "262.320",
      informacoes_complementares:
        "I - DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL.\r\n"
        + "II - NAO GERA DIREITO A CREDITO FISCAL DE IPI.\r\n"
        + "Pedido de Venda: PV-001621",
      produtos: [{ unidade: "PAR", cfop: "5101", NCM: "64029990" }],
    });
    expect(gaps).toEqual([]);
  });

  it("marca UN e Simples duplicado como gap", () => {
    const gaps = checklistPayloadVs293({
      modalidade_frete: 0,
      especie_volumes: "Volumes",
      produtos: [{ unidade: "UN" }],
      informacoes_complementares:
        "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. "
        + "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL.",
    });
    expect(gaps.some((g) => g.includes("modalidade_frete"))).toBe(true);
    expect(gaps.some((g) => g.includes("unidade"))).toBe(true);
    expect(gaps.some((g) => g.includes("duplicado"))).toBe(true);
    expect(countSimplesAviso(
      "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. "
      + "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL.",
    )).toBe(2);
  });
});
