import { useEffect, useRef, useState, ReactNode } from 'react';

/**
 * Hook que mede a altura do conteúdo de uma ficha de operador e aplica
 * `transform: scale(X)` automaticamente quando excede a página A4 (281mm
 * úteis após margin 8mm de @page).
 *
 * Por quê: o CSS de print tenta forçar 1 ficha por página com height fixo
 * 281mm + overflow:hidden. Mas quando o CONTEÚDO real excede esse limite
 * (ficha com muitas cores, muitas fichas de tally, muitas numerações),
 * `overflow:hidden` SUPRIMIA visualmente as últimas seções. Resultado:
 * usuário via página com "corte" no meio da assinatura/tally.
 *
 * Solução: medir altura via ref + useLayoutEffect, calcular fator de escala
 * pra encaixar em 281mm, aplicar `transform: scale(X)` com origin top-left.
 * Em tela continua 100% (não distorce); em print o snapshot já é renderizado
 * com a escala aplicada.
 *
 * Trade-off aceitável: fichas muito densas ficam com tipografia 80–90% do
 * tamanho original, mas TUDO cabe em 1 página A4. RH/operador prefere
 * "ler tudo um pouco menor" do que "perder metade da ficha em outra folha".
 */
export function useAutoFitPrint(maxHeightMm: number = 281) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!ref.current) return;

    const measure = () => {
      if (!ref.current) return;
      // Reseta scale pra medir altura natural
      ref.current.style.transform = '';
      const naturalHeight = ref.current.scrollHeight;
      const maxHeightPx = (maxHeightMm * 96) / 25.4; // mm → px @ 96dpi
      if (naturalHeight > maxHeightPx) {
        const factor = maxHeightPx / naturalHeight;
        // Limita 0.72 (-28%) — abaixo disso a leitura sofre demais.
        // Se a ficha excede mesmo assim, é caso pra dividir em sub-fichas
        // (responsabilidade do componente que monta o grupo).
        setScale(Math.max(0.72, factor));
      } else {
        setScale(1);
      }
    };

    // Mede após mount + a cada resize/imagens carregadas
    const timer = setTimeout(measure, 100);
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [maxHeightMm]);

  return { ref, scale };
}
