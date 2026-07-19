// Testes das validações client-side da capacityService (R12/R15 do spec
// produtividade-por-modelo): entradas inválidas falham ANTES de tocar o banco.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import {
  getModelProductivity,
  updateCapacityParameters,
  updateSectorHeadcount,
  saveProductivitySnapshot,
} from "../capacityService";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

function mockUpdateChain() {
  const eqMock = vi.fn().mockResolvedValue({ error: null });
  fromMock.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: eqMock }) });
  return eqMock;
}

describe("capacityService — validações client-side", () => {
  it("rejeita sheetIds vazio sem chamar o banco", async () => {
    await expect(getModelProductivity([])).rejects.toThrow(/ao menos uma ficha/i);
    await expect(getModelProductivity(undefined as unknown as string[])).rejects.toThrow(/ao menos uma ficha/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejeita headcount negativo e NaN sem chamar o banco", async () => {
    await expect(updateSectorHeadcount("Montagem", -1)).rejects.toThrow(/equipe inválida/i);
    await expect(updateSectorHeadcount("Montagem", Number.NaN)).rejects.toThrow(/equipe inválida/i);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("aceita headcount fracionado (0,5) e null (limpar)", async () => {
    mockUpdateChain();
    await updateSectorHeadcount("Montagem", 0.5);
    await updateSectorHeadcount("Montagem", null);
    expect(fromMock).toHaveBeenCalledWith("sector_settings");
  });

  it("rejeita eficiência 0 e 101", async () => {
    await expect(updateCapacityParameters({ efficiency_pct: 0 })).rejects.toThrow(/eficiência/i);
    await expect(updateCapacityParameters({ efficiency_pct: 101 })).rejects.toThrow(/eficiência/i);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejeita jornada fora de [60, 720] e dias úteis fora de [1, 31]", async () => {
    await expect(updateCapacityParameters({ journey_minutes: 30 })).rejects.toThrow(/jornada/i);
    await expect(updateCapacityParameters({ journey_minutes: 900 })).rejects.toThrow(/jornada/i);
    await expect(updateCapacityParameters({ working_days_per_month: 0 })).rejects.toThrow(/dias úteis/i);
    await expect(updateCapacityParameters({ working_days_per_month: 32 })).rejects.toThrow(/dias úteis/i);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("chama o RPC com p_sheet_ids quando a entrada é válida", async () => {
    rpcMock.mockResolvedValue({
      data: { params: {}, models: [], missing_sheet_ids: [] },
      error: null,
    });
    const result = await getModelProductivity(["abc-123"]);
    expect(rpcMock).toHaveBeenCalledWith("get_model_productivity", { p_sheet_ids: ["abc-123"] });
    expect(result.models).toEqual([]);
  });

  it("snapshot exige ficha e repassa erro do servidor (ex.: ficha incompleta)", async () => {
    await expect(saveProductivitySnapshot("")).rejects.toThrow(/ficha obrigatória/i);
    rpcMock.mockResolvedValue({ data: null, error: new Error("Ficha X está incompleta") });
    await expect(saveProductivitySnapshot("abc")).rejects.toThrow(/incompleta/);
  });
});
