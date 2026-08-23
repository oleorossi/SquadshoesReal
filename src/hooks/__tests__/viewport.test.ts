import { describe, expect, it } from "vitest";
import {
  classifyFormFactor,
  desktopAsidePx,
  shouldPresentAsSheet,
} from "@/hooks/use-mobile";

describe("classifyFormFactor", () => {
  it("iPhone 390×844 é phone", () => {
    expect(classifyFormFactor(390)).toBe("phone");
  });

  it("767 ainda é phone; 768 (iPad retrato) já é tablet", () => {
    expect(classifyFormFactor(767)).toBe("phone");
    expect(classifyFormFactor(768)).toBe("tablet");
  });

  it("iPad retrato 768×1024 e 1023 continuam tablet", () => {
    expect(classifyFormFactor(768)).toBe("tablet");
    expect(classifyFormFactor(1023)).toBe("tablet");
  });

  it("1024 (iPad paisagem / notebook) é desktop", () => {
    expect(classifyFormFactor(1024)).toBe("desktop");
    expect(classifyFormFactor(1366)).toBe("desktop");
  });
});

describe("desktopAsidePx", () => {
  it("tablet ignora a preferência e fica no rail 68px", () => {
    expect(desktopAsidePx("tablet", false)).toBe(68);
    expect(desktopAsidePx("tablet", true)).toBe(68);
  });

  it("desktop honra a preferência do usuário", () => {
    expect(desktopAsidePx("desktop", false)).toBe(232);
    expect(desktopAsidePx("desktop", true)).toBe(68);
  });
});

describe("shouldPresentAsSheet", () => {
  it("ponteiro grosso abaixo de lg vira Sheet", () => {
    expect(shouldPresentAsSheet(true, 390)).toBe(true);
    expect(shouldPresentAsSheet(true, 768)).toBe(true);
    expect(shouldPresentAsSheet(true, 1023)).toBe(true);
  });

  it("desktop (lg+) fica Dialog mesmo com dedo", () => {
    expect(shouldPresentAsSheet(true, 1024)).toBe(false);
    expect(shouldPresentAsSheet(true, 1366)).toBe(false);
  });

  it("ponteiro fino nunca vira Sheet", () => {
    expect(shouldPresentAsSheet(false, 390)).toBe(false);
    expect(shouldPresentAsSheet(false, 768)).toBe(false);
    expect(shouldPresentAsSheet(false, 1280)).toBe(false);
  });
});
