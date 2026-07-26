import * as React from "react";

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
  const [coarse, setCoarse] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener("change", onChange);
    setCoarse(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return coarse;
}
