import { useState, useEffect } from 'react';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { Image as ImageIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface SignedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  /**
   * Quando true (default), aplica object-cover pra imagem preencher TODO o
   * contêiner. Opt-out via `fit="contain"` quando precisar mostrar a imagem
   * inteira (ex: logos, silks com fundo branco que se beneficiam de respiro).
   */
  fit?: 'cover' | 'contain';
}

/**
 * Drop-in replacement for <img> que:
 * - Resolve URLs de storage Supabase privadas pra signed URLs (via useSignedUrl)
 * - Fallback gracioso quando a imagem 404/quebra (mostra placeholder com ícone)
 * - Aplica object-cover por padrão (preenche miniatura) — opt-out via fit="contain"
 * - Loading="lazy" e decoding="async" pra performance
 *
 * Histórico: as imagens originais ficaram no projeto Supabase antigo
 * (qrdvwoijghmgugejponz, descontinuado em mai/2026). DB foi migrado mas
 * storage não — daí o fallback visual ser essencial.
 */
export function SignedImage({ src, className, fit = 'cover', alt, ...props }: SignedImageProps) {
  const resolvedUrl = useSignedUrl(src);
  const [hasError, setHasError] = useState(false);

  // Reset error quando o src muda (nova URL → tentar de novo)
  useEffect(() => { setHasError(false); }, [src, resolvedUrl]);

  // Sem URL ou erro de carregamento → placeholder
  if (!resolvedUrl || hasError) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-muted/40 text-muted-foreground/50',
          className,
        )}
        aria-label={alt ? `Sem imagem: ${alt}` : 'Sem imagem disponível'}
        role="img"
      >
        <ImageIcon className="h-1/3 w-1/3 min-h-3 min-w-3 max-h-10 max-w-10" weight="thin" />
      </div>
    );
  }

  return (
    <img
      // Defaults ANTES do spread: caller pode sobrescrever (fichas de
      // impressão precisam de loading="eager" — lazy off-viewport não
      // carrega no snapshot do print em Firefox/Safari).
      loading="lazy"
      decoding="async"
      {...props}
      src={resolvedUrl}
      alt={alt}
      onError={() => setHasError(true)}
      className={cn(
        fit === 'cover' ? 'object-cover' : 'object-contain',
        className,
      )}
    />
  );
}
