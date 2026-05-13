import React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** URL da variante específica (cor exata). Prioridade 1. */
  variantImageUrl?: string | null;
  /** URLs alternativas: variantes de outras cores da mesma ref (pra fallback preto). */
  alternateVariants?: Array<{ color?: string; image_url?: string | null }>;
  /** URL da imagem mestra da ficha técnica. Prioridade 3. */
  technicalSheetImageUrl?: string | null;
  /** Cor do pedido (pra detectar quando precisa fallback). */
  orderColor?: string;
  /** Tamanho em px. Default 100. */
  size?: number;
  /** Nome do produto pra alt + tooltip. */
  alt?: string;
  /** Renderiza badge "REF." quando a imagem não é da cor exata. */
  showRefBadge?: boolean;
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
  size = 100,
  alt = 'Produto',
  showRefBadge = true,
  className,
}: Props) => {
  const { url, isExactMatch } = resolveImage(variantImageUrl, alternateVariants, technicalSheetImageUrl);
  const showBadge = showRefBadge && !isExactMatch && url !== '/placeholder.svg';

  return (
    <div
      className={cn('relative bg-white overflow-hidden shrink-0', className)}
      style={{ width: size, height: size, border: '1.5px solid #000' }}
    >
      <img
        src={url}
        alt={alt}
        className="w-full h-full object-contain mix-blend-multiply"
        loading="eager"
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
