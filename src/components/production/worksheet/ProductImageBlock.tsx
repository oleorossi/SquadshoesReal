import React from 'react';
import { cn } from '@/lib/utils';
import { thumbUrl } from '@/lib/imageThumb';

interface Props {
  /** URL da variante específica (cor exata). Prioridade 1. */
  variantImageUrl?: string | null;
  /** URLs alternativas: variantes de outras cores da mesma ref (pra fallback preto). */
  alternateVariants?: Array<{ color?: string; image_url?: string | null }>;
  /** URL da imagem mestra da ficha técnica. Prioridade 3. */
  technicalSheetImageUrl?: string | null;
  /** Cor do pedido (pra detectar quando precisa fallback). */
  orderColor?: string;
  /** Tamanho em px. Default 140 (antes 100 ficava pequeno e ofuscado). */
  size?: number;
  /** Nome do produto pra alt + tooltip. */
  alt?: string;
  /** Renderiza badge "REF." quando a imagem não é da cor exata. */
  showRefBadge?: boolean;
  /** Aplica filtro mix-blend-multiply (remove fundo branco). Default true.
   *  Desligar quando a imagem original já tem fundo transparente — o filtro
   *  às vezes degrada o contraste de cores escuras. */
  multiplyBlend?: boolean;
  /** Classe extra no container. */
  className?: string;
}

/**
 * Resolve a melhor imagem do produto pra exibir na ficha de operador.
 *
 * Cascata:
 *   1. variantImageUrl — variante da cor exata pedida
 *   2. variante "Preto" (sempre cadastrada na ficha técnica, conforme convenção)
 *   3. variante "Natural" / "Branco" (próximos fallbacks comuns)
 *   4. primeira variante disponível
 *   5. imagem mestra da ficha técnica
 *   6. placeholder
 *
 * Retorna { url, isExactMatch } pra UI saber se mostra badge "REF.".
 */
function resolveImage(
  variantImageUrl?: string | null,
  alternates?: Array<{ color?: string; image_url?: string | null }>,
  technicalSheetImageUrl?: string | null,
): { url: string; isExactMatch: boolean } {
  if (variantImageUrl) return { url: variantImageUrl, isExactMatch: true };

  if (alternates && alternates.length > 0) {
    // 2) Preto sempre cadastrado, fallback canônico
    const preto = alternates.find(v => v.image_url && /^preto$/i.test((v.color || '').trim()));
    if (preto?.image_url) return { url: preto.image_url, isExactMatch: false };

    // 3) Natural / Branco
    const natural = alternates.find(v => v.image_url && /^(natural|branco)$/i.test((v.color || '').trim()));
    if (natural?.image_url) return { url: natural.image_url, isExactMatch: false };

    // 4) Qualquer variante com imagem
    const any = alternates.find(v => v.image_url);
    if (any?.image_url) return { url: any.image_url, isExactMatch: false };
  }

  if (technicalSheetImageUrl) return { url: technicalSheetImageUrl, isExactMatch: false };
  return { url: '/placeholder.svg', isExactMatch: false };
}

/**
 * Bloco de imagem do produto pra fichas de operador. Resolve a melhor
 * imagem disponível com fallback pra variante "Preto" (sempre cadastrada
 * por convenção da casa) — evita ficha sem foto e reduz erro do operador.
 */
export const ProductImageBlock = ({
  variantImageUrl,
  alternateVariants,
  technicalSheetImageUrl,
  orderColor,
  size = 140,
  alt = 'Produto',
  showRefBadge = true,
  multiplyBlend = true,
  className,
}: Props) => {
  const { url, isExactMatch } = resolveImage(variantImageUrl, alternateVariants, technicalSheetImageUrl);
  const showBadge = showRefBadge && !isExactMatch && url !== '/placeholder.svg';
  // Otimização (2026-06-09): serve a miniatura redimensionada no servidor em vez
  // de baixar o original de ~1,3 MB e reduzir no browser. ~3× o tamanho de
  // exibição garante nitidez em tela e impressão. Placeholder/externas passam
  // intactas (thumbUrl é no-op fora do bucket público).
  const displaySrc = thumbUrl(url, size) || url;

  return (
    <div
      className={cn('relative bg-white overflow-hidden shrink-0', className)}
      style={{ width: size, height: size, border: '1.5px solid #000' }}
    >
      <img
        src={displaySrc}
        alt={alt}
        width={size}
        height={size}
        className={cn('w-full h-full object-contain', multiplyBlend && 'mix-blend-multiply')}
        loading="eager"
        decoding="sync"
        // CSS hint pro browser preferir nitidez sobre suavização em downscale —
        // imagens de catálogo de calçado geralmente vêm em alta res e ficam
        // borradas com bilinear default. Tipograhpic hint não afeta upscale.
        style={{
          imageRendering: 'auto',
          // print-color-adjust pra impressão sair fiel
          printColorAdjust: 'exact',
          WebkitPrintColorAdjust: 'exact',
        } as React.CSSProperties}
      />
      {showBadge && (
        <div
          className="absolute top-0 left-0 bg-white text-black text-[8px] font-mono px-1.5 py-0.5 uppercase tracking-[0.18em] leading-none font-bold"
          style={{ borderRight: '1.5px solid #000', borderBottom: '1.5px solid #000' }}
          title={orderColor ? `Imagem genérica — cor ${orderColor} sem foto específica` : 'Imagem genérica'}
        >
          Ref.
        </div>
      )}
    </div>
  );
};

export { resolveImage };
