import * as React from "react";

/** Celular: BottomNav + drawer. iPad retrato (768) já não entra aqui. */
export const PHONE_MAX_PX = 767;
/** iPad retrato / tablet Android. Paisagem de iPad Pro (≥1024) cai no desktop. */
export const TABLET_MAX_PX = 1023;

export type FormFactor = "phone" | "tablet" | "desktop";

export function classifyFormFactor(width: number): FormFactor {
  if (width <= PHONE_MAX_PX) return "phone";
  if (width <= TABLET_MAX_PX) return "tablet";
  return "desktop";
}

/** Dialog vira Sheet em ponteiro grosso abaixo de lg (1024). Desktop fino fica Dialog. */
export function shouldPresentAsSheet(isCoarse: boolean, width: number): boolean {
  return isCoarse && width < 1024;
}

/** Aside md+: no tablet o rail é sempre 68px. No desktop, a preferência do usuário. */
export function desktopAsidePx(formFactor: FormFactor, userCollapsed: boolean): 68 | 232 {
  if (formFactor === "tablet") return 68;
  return userCollapsed ? 68 : 232;
}

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * Pointer primário é "grosso" (dedo) — celular E iPad, independente da largura
 * (o iPad passa do breakpoint de 768px e escaparia do useIsMobile). Use pra
 * decisões de INTERAÇÃO (autofocus que abre teclado, alvo de toque, drag),
 * não de layout — layout responsivo continua por breakpoint.
 */
export function useIsCoarsePointer() {
  const [coarse, setCoarse] = React.useState(() =>
    typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
  );

  React.useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener("change", onChange);
    setCoarse(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return coarse;
}

export function useViewport() {
  const [width, setWidth] = React.useState<number>(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const isCoarse = useIsCoarsePointer();

  React.useEffect(() => {
    const onChange = () => setWidth(window.innerWidth);
    const mqlPhone = window.matchMedia(`(max-width: ${PHONE_MAX_PX}px)`);
    const mqlTablet = window.matchMedia(`(max-width: ${TABLET_MAX_PX}px)`);
    mqlPhone.addEventListener("change", onChange);
    mqlTablet.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    onChange();
    return () => {
      mqlPhone.removeEventListener("change", onChange);
      mqlTablet.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, []);

  const formFactor = classifyFormFactor(width);
  return {
    width,
    formFactor,
    isPhone: formFactor === "phone",
    isTablet: formFactor === "tablet",
    isDesktop: formFactor === "desktop",
    isCoarse,
  };
}
