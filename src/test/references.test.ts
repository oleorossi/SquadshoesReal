import { describe, it, expect } from "vitest";
import { ReferenceFormData, MaterialFormData, ProductReference, ReferenceMaterial } from "@/types/references";

// ===== Type & validation tests =====

const validRefForm: ReferenceFormData = {
  name: "Scarpin Classic",
  description: "Modelo clássico",
  code: "REF-001",
  collection: "Verão 2026",
  shoe_category: "Scarpin",
  sizes: "33-41",
  colors: "Preto, Nude",
  cost_price: 45.5,
  sale_price: 129.9,
  status: "Ativo",
  image_url: "",
  technical_sheet_id: "",
  has_straps: false,
  strap_colors: [],
};

const validMaterialForm: MaterialFormData = {
  product_id: "uuid-product-1",
  quantity_per_unit: 2.5,
  color: "Preto",
  width: "1.40m",
  weight: "350g",
  supplier: "Fornecedor A",
  notes: "Material principal",
  sizes: "34-40",
};

describe("ReferenceFormData", () => {
  it("should have all required fields", () => {
    expect(validRefForm).toHaveProperty("name");
    expect(validRefForm).toHaveProperty("code");
    expect(validRefForm).toHaveProperty("shoe_category");
    expect(validRefForm).toHaveProperty("sizes");
    expect(validRefForm).toHaveProperty("cost_price");
    expect(validRefForm).toHaveProperty("sale_price");
    expect(validRefForm).toHaveProperty("status");
  });

  it("should have numeric prices", () => {
    expect(typeof validRefForm.cost_price).toBe("number");
    expect(typeof validRefForm.sale_price).toBe("number");
    expect(validRefForm.cost_price).toBeGreaterThanOrEqual(0);
    expect(validRefForm.sale_price).toBeGreaterThanOrEqual(0);
  });

  it("should have valid status values", () => {
    const validStatuses = ["Ativo", "Em desenvolvimento", "Descontinuado"];
    expect(validStatuses).toContain(validRefForm.status);
  });

  it("should calculate margin correctly", () => {
    const margin = validRefForm.sale_price - validRefForm.cost_price;
    expect(margin).toBeCloseTo(84.4, 1);
    const marginPercent = (margin / validRefForm.sale_price) * 100;
    expect(marginPercent).toBeGreaterThan(0);
  });
});

describe("MaterialFormData", () => {
  it("should have all required fields", () => {
    expect(validMaterialForm).toHaveProperty("product_id");
    expect(validMaterialForm).toHaveProperty("quantity_per_unit");
    expect(validMaterialForm).toHaveProperty("color");
    expect(validMaterialForm).toHaveProperty("width");
    expect(validMaterialForm).toHaveProperty("weight");
    expect(validMaterialForm).toHaveProperty("supplier");
    expect(validMaterialForm).toHaveProperty("notes");
  });

  it("should have positive quantity_per_unit", () => {
    expect(validMaterialForm.quantity_per_unit).toBeGreaterThan(0);
  });

  it("should have a valid product_id", () => {
    expect(validMaterialForm.product_id).toBeTruthy();
    expect(typeof validMaterialForm.product_id).toBe("string");
  });
});

describe("ProductReference type", () => {
  it("should conform to expected shape", () => {
    const ref: ProductReference = {
      id: "uuid-1",
      name: "Scarpin Classic",
      description: "Desc",
      code: "REF-001",
      collection: "Verão 2026",
      shoe_category: "Scarpin",
      sizes: "33-41",
      colors: "Preto",
      cost_price: 45.5,
      sale_price: 129.9,
      status: "Ativo",
      image_url: "",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(ref.id).toBeTruthy();
    expect(ref.created_at).toBeTruthy();
    expect(ref.updated_at).toBeTruthy();
  });
});

describe("ReferenceMaterial type", () => {
  it("should conform to expected shape with optional products join", () => {
    const mat: ReferenceMaterial = {
      id: "uuid-mat-1",
      reference_id: "uuid-ref-1",
      product_id: "uuid-prod-1",
      quantity_per_unit: 2.5,
      color: "Preto",
      width: "1.40m",
      weight: "350g",
      supplier: "Fornecedor A",
      notes: "",
      created_at: "2026-01-01T00:00:00Z",
      products: {
        name: "Napa Soft",
        unit: "dm²",
        sku: "NAP-001",
        category: "Cabedal",
        unit_price: 3.5,
        quantity: 500,
      },
    };
    expect(mat.products?.name).toBe("Napa Soft");
    expect(mat.products?.unit).toBe("dm²");
  });

  it("should work without products join", () => {
    const mat: ReferenceMaterial = {
      id: "uuid-mat-2",
      reference_id: "uuid-ref-1",
      product_id: "uuid-prod-2",
      quantity_per_unit: 1,
      color: "",
      width: "",
      weight: "",
      supplier: "",
      notes: "",
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(mat.products).toBeUndefined();
  });
});

describe("Material cost calculation", () => {
  it("should calculate total material cost for a reference", () => {
    const materials: Array<{ quantity_per_unit: number; unit_price: number }> = [
      { quantity_per_unit: 2.5, unit_price: 3.5 },   // Cabedal: 8.75
      { quantity_per_unit: 1, unit_price: 15.0 },     // Solado: 15.00
      { quantity_per_unit: 1.2, unit_price: 2.0 },    // Forro: 2.40
      { quantity_per_unit: 0.5, unit_price: 8.0 },    // Palmilha: 4.00
    ];

    const totalCost = materials.reduce(
      (sum, m) => sum + m.quantity_per_unit * m.unit_price,
      0
    );
    expect(totalCost).toBeCloseTo(30.15, 2);
  });

  it("should calculate cost for an order with grade", () => {
    const materialCostPerPair = 30.15;
    const grade = { "33": 2, "34": 3, "35": 4, "36": 5, "37": 4, "38": 3, "39": 2 };
    const totalPairs = Object.values(grade).reduce((a, b) => a + b, 0);
    expect(totalPairs).toBe(23);
    const totalMaterialCost = materialCostPerPair * totalPairs;
    expect(totalMaterialCost).toBeCloseTo(693.45, 2);
  });
});

describe("Bulk materials operations", () => {
  it("should deduplicate materials by product_id", () => {
    const existing = [
      { product_id: "p1", quantity_per_unit: 2 },
      { product_id: "p2", quantity_per_unit: 1 },
    ];
    const toAdd = [
      { product_id: "p2", quantity_per_unit: 3 },
      { product_id: "p3", quantity_per_unit: 1.5 },
    ];

    const existingIds = new Set(existing.map((m) => m.product_id));
    const filtered = toAdd.filter((m) => !existingIds.has(m.product_id));

    expect(filtered).toHaveLength(1);
    expect(filtered[0].product_id).toBe("p3");
  });

  it("should handle empty existing materials", () => {
    const existing: Array<{ product_id: string }> = [];
    const toAdd = [
      { product_id: "p1" },
      { product_id: "p2" },
    ];

    const existingIds = new Set(existing.map((m) => m.product_id));
    const filtered = toAdd.filter((m) => !existingIds.has(m.product_id));
    expect(filtered).toHaveLength(2);
  });
});

describe("Recent materials deduplication", () => {
  it("should keep only first occurrence per product_id", () => {
    const data = [
      { product_id: "p1", created_at: "2026-03-06" },
      { product_id: "p2", created_at: "2026-03-05" },
      { product_id: "p1", created_at: "2026-03-04" },
      { product_id: "p3", created_at: "2026-03-03" },
      { product_id: "p2", created_at: "2026-03-02" },
    ];

    const seen = new Set<string>();
    const deduped = data.filter((m) => {
      if (seen.has(m.product_id)) return false;
      seen.add(m.product_id);
      return true;
    });

    expect(deduped).toHaveLength(3);
    expect(deduped[0].product_id).toBe("p1");
    expect(deduped[0].created_at).toBe("2026-03-06"); // most recent
  });

  it("should limit to 10 items", () => {
    const data = Array.from({ length: 20 }, (_, i) => ({
      product_id: `p${i}`,
    }));
    const seen = new Set<string>();
    const result = data
      .filter((m) => {
        if (seen.has(m.product_id)) return false;
        seen.add(m.product_id);
        return true;
      })
      .slice(0, 10);

    expect(result).toHaveLength(10);
  });
});

describe("Reference form defaults", () => {
  const emptyRefForm: ReferenceFormData = {
    name: "",
    description: "",
    code: "",
    collection: "",
    shoe_category: "",
    sizes: "33-41",
    colors: "",
    cost_price: 0,
    sale_price: 0,
    status: "Ativo",
    image_url: "",
    technical_sheet_id: "",
    has_straps: false,
    strap_colors: [],
  };

  it("should have default sizes 33-41", () => {
    expect(emptyRefForm.sizes).toBe("33-41");
  });

  it("should have default status Ativo", () => {
    expect(emptyRefForm.status).toBe("Ativo");
  });

  it("should have zero prices by default", () => {
    expect(emptyRefForm.cost_price).toBe(0);
    expect(emptyRefForm.sale_price).toBe(0);
  });
});
