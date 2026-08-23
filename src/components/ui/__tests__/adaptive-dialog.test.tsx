import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdaptiveDialog, AdaptiveDialogContent } from "@/components/ui/adaptive-dialog";

function stubViewport(width: number, coarse: boolean) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  window.matchMedia = ((query: string) => {
    const matches = query.includes("pointer: coarse")
      ? coarse
      : query.includes("max-width")
        ? false
        : false;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;
}

describe("AdaptiveDialog", () => {
  it("celular com dedo abre Sheet", () => {
    stubViewport(390, true);
    render(
      <AdaptiveDialog open>
        <AdaptiveDialogContent>
          <p>Conteúdo</p>
        </AdaptiveDialogContent>
      </AdaptiveDialog>,
    );
    expect(screen.getByText("Conteúdo").closest("[data-adaptive]")).toHaveAttribute(
      "data-adaptive",
      "sheet",
    );
  });

  it("notebook com mouse abre Dialog", () => {
    stubViewport(1280, false);
    render(
      <AdaptiveDialog open>
        <AdaptiveDialogContent>
          <p>Conteúdo</p>
        </AdaptiveDialogContent>
      </AdaptiveDialog>,
    );
    expect(screen.getByText("Conteúdo").closest("[data-adaptive]")).toHaveAttribute(
      "data-adaptive",
      "dialog",
    );
  });
});
