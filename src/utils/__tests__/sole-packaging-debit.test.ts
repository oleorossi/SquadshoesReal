import { describe, it, expect } from "vitest";
import {
  boxesNeeded,
  planPackagingDebit,
  resolveTypesForMode,
  type BoxTypeRow,
  type SoleGroupPackaging,
} from "../sole-packaging-debit";

const sole: SoleGroupPackaging = {
  box_type_id: "box-ind",
  box_type_master_id: "box-mas",
  box_type_colmeia_id: "box-col",
  box_type_fitilho_id: "box-fit",
  pairs_per_box_individual: 1,
  pairs_per_box_master: 12,
  pairs_per_box_colmeia: 24,
  pairs_per_box_fitilho: 6,
};

const fullStock = (qty = 1000): Record<string, BoxTypeRow> => ({
  "box-ind": { id: "box-ind", nome: "Caixa Individual", quantity: qty },
  "box-mas": { id: "box-mas", nome: "Caixa Master 12",  quantity: qty },
  "box-col": { id: "box-col", nome: "Colmeia 24",       quantity: qty },
  "box-fit": { id: "box-fit", nome: "Fitilho",          quantity: qty },
});

describe("resolveTypesForMode", () => {
  it("modo individual → só caixa individual", () => {
    expect(resolveTypesForMode("individual")).toEqual(["individual"]);
    expect(resolveTypesForMode("individual_amarrado")).toEqual(["individual"]);
  });
  it("modo individual_master → individual + master", () => {
    expect(resolveTypesForMode("individual_master")).toEqual(["individual", "master"]);
  });
  it("modo individual_fitilho → individual + fitilho", () => {
    expect(resolveTypesForMode("individual_fitilho")).toEqual(["individual", "fitilho"]);
  });
  it("modo colmeia → só colmeia (não debita individual)", () => {
    expect(resolveTypesForMode("colmeia")).toEqual(["colmeia"]);
  });
});

describe("boxesNeeded (CEIL com fallback de pairs)", () => {
  it("arredonda para cima qualquer fração", () => {
    expect(boxesNeeded(13, 12)).toBe(2);
    expect(boxesNeeded(24, 12)).toBe(2);
    expect(boxesNeeded(25, 12)).toBe(3);
  });
  it("pairs = 1 → 1 caixa por par", () => {
    expect(boxesNeeded(36, 1)).toBe(36);
  });
  it("pairs nulo/zero → fallback para 1 (1 caixa por par)", () => {
    expect(boxesNeeded(10, null)).toBe(10);
    expect(boxesNeeded(10, 0)).toBe(10);
  });
});

describe("planPackagingDebit — débitos por modo", () => {
  it("modo individual: debita 1 caixa individual por par", () => {
    const r = planPackagingDebit({ sole, boxes: fullStock(), orderQuantity: 36, mode: "individual" });
    expect(Array.isArray(r)).toBe(true);
    expect(r).toEqual([
      expect.objectContaining({
        packaging_type: "individual",
        status: "debited_box_types",
        box_type_id: "box-ind",
        boxes_needed: 36,
      }),
    ]);
  });

  it("modo individual_master: debita individual (36) + master (3 caixas de 12)", () => {
    const r = planPackagingDebit({ sole, boxes: fullStock(), orderQuantity: 36, mode: "individual_master" });
    expect(r).toEqual([
      expect.objectContaining({ packaging_type: "individual", boxes_needed: 36 }),
      expect.objectContaining({ packaging_type: "master",     boxes_needed: 3 }),
    ]);
  });

  it("modo individual_master com qty não múltipla: arredonda para cima", () => {
    const r = planPackagingDebit({ sole, boxes: fullStock(), orderQuantity: 25, mode: "individual_master" });
    expect(r).toEqual([
      expect.objectContaining({ packaging_type: "individual", boxes_needed: 25 }),
      expect.objectContaining({ packaging_type: "master",     boxes_needed: 3 }), // CEIL(25/12)
    ]);
  });

  it("modo individual_fitilho: debita individual + fitilho (6 pares por amarrado)", () => {
    const r = planPackagingDebit({ sole, boxes: fullStock(), orderQuantity: 18, mode: "individual_fitilho" });
    expect(r).toEqual([
      expect.objectContaining({ packaging_type: "individual", boxes_needed: 18 }),
      expect.objectContaining({ packaging_type: "fitilho",    boxes_needed: 3 }),
    ]);
  });

  it("modo colmeia: só debita colmeia (NÃO debita individual)", () => {
    const r = planPackagingDebit({ sole, boxes: fullStock(), orderQuantity: 48, mode: "colmeia" });
    expect(r).toEqual([
      expect.objectContaining({ packaging_type: "colmeia", boxes_needed: 2 }), // 48/24
    ]);
    // garante que não há débito de individual no modo colmeia
    expect((r as any[]).some((e) => e.packaging_type === "individual")).toBe(false);
  });
});

describe("planPackagingDebit — skips e erros", () => {
  it("skip se solado da ficha não está configurado", () => {
    const r = planPackagingDebit({ sole: null, boxes: fullStock(), orderQuantity: 10, mode: "individual" });
    expect(r).toEqual({ status: "skipped", reason: "sole_group_not_set" });
  });

  it("skip por tipo se o solado não define aquela box (ex: master não cadastrado)", () => {
    const partialSole: SoleGroupPackaging = { ...sole, box_type_master_id: null };
    const r = planPackagingDebit({ sole: partialSole, boxes: fullStock(), orderQuantity: 12, mode: "individual_master" });
    expect(r).toEqual([
      expect.objectContaining({ packaging_type: "individual", status: "debited_box_types" }),
      expect.objectContaining({ packaging_type: "master",     status: "skipped", reason: "no_box_for_sole" }),
    ]);
  });

  it("lança erro de estoque insuficiente (espelha RAISE EXCEPTION da RPC)", () => {
    const lowStock = { ...fullStock(1000), "box-mas": { id: "box-mas", nome: "Caixa Master 12", quantity: 2 } };
    expect(() =>
      planPackagingDebit({ sole, boxes: lowStock, orderQuantity: 60, mode: "individual_master" })
    ).toThrow(/Estoque insuficiente para embalagem "Caixa Master 12"/);
  });

  it("pairs=0 no solado → fallback para 1 (1 caixa por par)", () => {
    const zeroPairs: SoleGroupPackaging = { ...sole, pairs_per_box_master: 0 };
    const r = planPackagingDebit({ sole: zeroPairs, boxes: fullStock(), orderQuantity: 5, mode: "individual_master" });
    expect(r).toEqual([
      expect.objectContaining({ packaging_type: "individual", boxes_needed: 5 }),
      expect.objectContaining({ packaging_type: "master",     boxes_needed: 5 }),
    ]);
  });
});