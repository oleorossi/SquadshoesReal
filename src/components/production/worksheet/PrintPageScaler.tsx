/**
 * Wrapper de impressão que mede a altura do conteúdo e aplica `transform:scale(X)`
 * quando excede A4 útil (281mm após margin 8mm de @page). Em conjunto com
 * `.page-break` (max-height: 281mm + page-break-after: always), garante que
 * cada ficha de operador caiba em 1 página A4 SEM cortar conteúdo.
 *
 * Estratégia (24/05/2026):
 *   - Mede via ResizeObserver após mount (e re-mede quando children mudam)
 *   - Se naturalHeight > 281mm em px (@96dpi = 1062.5px), aplica scale
 *     proporcional + transform-origin: top left
 *   - Floor de 0.72 (-28%) — abaixo disso é caso de dividir em sub-fichas
 *   - Em tela continua 100% (não distorce), em print snapshot usa o scale
 *
 * Substitui o approach anterior de `height: 281mm + overflow: hidden` que
 * ESCONDIA o conteúdo excedente (user reportou ficha cortada na assinatura).
 */
import { ReactNode, useEffect, useRef, useState } from 'react';

interface Props {
  children: ReactNode;
  /** Altura útil A4 em mm. Default 281 (297 - 2×8 margin @page). */
  maxHeightMm?: number;
  /** Limite mínimo de escala. Default 0.72 (≈ -28%). */
  minScale?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function PrintPageScaler({
  children,
  maxHeightMm = 281,
  minScale = 0.72,
  className,
  style,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!ref.current) return;
    const measure = () => {
      const node = ref.current;
      if (!node) return;
      // Mede altura natural sem o transform aplicado
      const prev = node.style.transform;
      node.style.transform = 'none';
      const natural = node.scrollHeight;
      node.style.transform = prev;

      const maxPx = (maxHeightMm * 96) / 25.4;
      if (natural > maxPx + 4) {
        const next = Math.max(minScale, maxPx / natural);
        setScale(next);
      } else {
        setScale(1);
      }
    };

    const timer = setTimeout(measure, 120);
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current);
    // Re-mede quando imagens carregam
    const imgs = ref.current.querySelectorAll('img');
    const onLoad = () => measure();
    imgs.forEach(img => img.addEventListener('load', onLoad, { once: true }));
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      imgs.forEach(img => img.removeEventListener('load', onLoad));
    };
  }, [maxHeightMm, minScale, children]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        transform: scale < 1 ? `scale(${scale})` : undefined,
        transformOrigin: 'top left',
        // Mantém largura visual original — se escalar 90%, sem isso ficaria
        // 90% da largura também. Forçamos width compensada pra ficar OK.
        width: scale < 1 ? `${100 / scale}%` : undefined,
      }}
    >
      {children}
    </div>
  );
}
