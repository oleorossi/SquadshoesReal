import React, { useEffect, useRef, useState } from 'react';

interface Props {
  /** Rótulo do setor (ex: "Corte Forração"). Aparece no marker como
   *  "Corte Forração · 1 / 2". Identifica visualmente o setor da ficha. */
  sectorLabel: string;
  children: React.ReactNode;
}

/**
 * Wrapper de região de setor que injeta markers "N / Total" em CADA
 * página A4 que a ficha ocupar. Mede altura do conteúdo após render +
 * em `onbeforeprint` (browser reflow pra dimensões de impressão).
 *
 * Como funciona:
 *   1. Mede `scrollHeight` do wrapper (não muda em screen vs print porque
 *      o worksheet já usa `w-[210mm]` em ambos).
 *   2. Calcula `numPages = ceil(altura / 281mm)`. 281mm = A4 (297mm) menos
 *      a margin @page (8mm × 2 = 16mm).
 *   3. Renderiza N divs absolutas no canto inferior direito de cada página.
 *
 * Edge cases tratados:
 *   - Setor com 1 página → marker "1 / 1" no rodapé.
 *   - Conteúdo cresce/encolhe (re-render React) → re-mede via useEffect.
 *   - Browser re-paginar antes do print → re-mede via beforeprint listener.
 *
 * Limitação: markers usam DPI 96 px/inch como aproximação. Impressoras
 * com configurações exóticas (escalonamento personalizado) podem ter
 * markers em pixels off-by-1 mas o erro é cosmético.
 */
export const SectorRegion = ({ sectorLabel, children }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(1);

  useEffect(() => {
    const PAGE_HEIGHT_PX = 281 * 96 / 25.4; // 281mm @ 96dpi ≈ 1062.05 px

    const measure = () => {
      if (!ref.current) return;
      const height = ref.current.scrollHeight;
      const pages = Math.max(1, Math.ceil(height / PAGE_HEIGHT_PX));
      setPageCount(prev => (prev === pages ? prev : pages));
    };

    measure();
    // Re-mede antes de imprimir (Chrome aplica @page e reflow pra
    // dimensões de impressão; alguns layouts mudam de altura).
    const onBeforePrint = () => measure();
    window.addEventListener('beforeprint', onBeforePrint);
    // matchMedia('print') também dispara em alguns navegadores
    const mql = window.matchMedia('print');
    const onChange = () => measure();
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener?.(onChange);

    // Resize do viewport (preview window resize) — re-mede também.
    const onResize = () => measure();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('resize', onResize);
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener?.(onChange);
    };
  }, [children]);

  return (
    <div ref={ref} className="sector-region" style={{ position: 'relative' }}>
      {children}
      {/* RODAPÉ — 1 marker por página A4 no canto inferior direito.
          Posicionado em `top: i*281mm + 273mm` (8mm acima da borda
          inferior). Identifica setor + numeração "Pg N/Total". */}
      {Array.from({ length: pageCount }).map((_, i) => (
        <div
          key={`page-marker-bottom-${i}`}
          className="sector-page-marker"
          style={{
            position: 'absolute',
            right: '6mm',
            top: `${i * 281 + 273}mm`,
          }}
        >
          <span className="sector-page-marker-label">{sectorLabel}</span>
          <span className="sector-page-marker-sep"> · </span>
          <span className="sector-page-marker-page">
            Pg {i + 1} / {pageCount}
          </span>
        </div>
      ))}
      {/* TOPO — só páginas 2+ (página 1 já tem o WorksheetHeader gigante
          no topo). Garante que o operador identifique de imediato a
          qual setor pertence a folha sem precisar revirar pra ver o
          header da página anterior. Padrão de manufacturing traveler. */}
      {Array.from({ length: Math.max(0, pageCount - 1) }).map((_, idx) => {
        const i = idx + 1; // pageIndex (0-based, mas começa em 1 aqui)
        return (
          <div
            key={`page-marker-top-${i}`}
            className="sector-page-marker sector-page-marker-top"
            style={{
              position: 'absolute',
              left: '6mm',
              right: '6mm',
              top: `${i * 281 + 3}mm`,
            }}
          >
            <span className="sector-page-marker-label">{sectorLabel}</span>
            <span className="sector-page-marker-sep"> · cont. </span>
            <span className="sector-page-marker-page">
              Pg {i + 1} / {pageCount}
            </span>
          </div>
        );
      })}
    </div>
  );
};
