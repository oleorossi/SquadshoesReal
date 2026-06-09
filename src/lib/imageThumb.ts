/**
 * thumbUrl — reescreve uma URL pública do Supabase Storage para a URL de
 * TRANSFORMAÇÃO (resize server-side), gerando uma miniatura leve e nítida.
 *
 * Por quê: os originais de catálogo (bucket `reference-images`) pesam ~1,3 MB.
 * Hoje a miniatura baixa o ORIGINAL inteiro e o browser reduz pra 36–140px —
 * desperdício enorme de banda + decode, e o downscale do browser sobre 1,3 MB
 * sai levemente borrado. Servindo via `/render/image/public/...` num box de
 * ~3× o tamanho de exibição, o mesmo arquivo cai pra ~100 KB (PNG) ou ~5 KB
 * (WebP — negociado automaticamente pelo browser via header `Accept`), com
 * nitidez controlada (resize de alta qualidade no servidor). Ganho de 10–290×.
 *
 * Verificado em 2026-06-09 contra o projeto ssvxfoybzmjlypnipqzn (transform
 * habilitado): orig 1.323.359 B → 420×420 PNG 103.605 B → 420×420 WebP 4.502 B.
 *
 * Regras:
 *  - só reescreve URLs do bucket PÚBLICO deste Supabase (`/storage/v1/object/public/`);
 *  - placeholders locais, URLs externas e URLs já transformadas passam INTACTAS
 *    (idempotente — uma URL `/render/image/` não tem o marcador `/object/public/`);
 *  - SVG é vetorial → não rasteriza (passa intacto).
 */
const PUBLIC_MARKER = '/storage/v1/object/public/';

export interface ThumbOpts {
  /** Multiplicador de resolução sobre o tamanho de exibição. Default 3 — bom
   *  pra nitidez em tela retina E impressão A4 a 300dpi sem inflar o arquivo. */
  dpr?: number;
  /** Qualidade de compressão (1–100). Default 80. */
  quality?: number;
  /** Modo de redimensionamento. `contain` (default) limita os DOIS lados
   *  preservando o aspecto — sem corte, sem letterbox. */
  resize?: 'contain' | 'cover' | 'fill';
}

export function thumbUrl(
  url: string | null | undefined,
  sizePx: number,
  opts: ThumbOpts = {},
): string | null | undefined {
  if (!url || typeof url !== 'string') return url;
  const idx = url.indexOf(PUBLIC_MARKER);
  if (idx === -1) return url; // não é storage público (placeholder/externa/já transformada)
  const origin = url.slice(0, idx);
  const path = url.slice(idx + PUBLIC_MARKER.length);
  // SVG não precisa (e não deve) ser rasterizado.
  if (/\.svg$/i.test(path.split('?')[0])) return url;
  const dpr = opts.dpr ?? 3;
  const dim = Math.max(16, Math.round(sizePx * dpr));
  const params = new URLSearchParams({
    width: String(dim),
    height: String(dim),
    resize: opts.resize ?? 'contain',
    quality: String(opts.quality ?? 80),
  });
  return `${origin}/storage/v1/render/image/public/${path}?${params.toString()}`;
}
