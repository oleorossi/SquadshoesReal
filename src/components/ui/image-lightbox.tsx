import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { X } from '@phosphor-icons/react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SignedImage } from '@/components/ui/signed-image';
import { cn } from '@/lib/utils';

interface ImageLightboxProps {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Stage fullscreen pra foto de sandália/referência.
 * Fundo escuro edge-to-edge; imagem em contain; fecha com Esc, X ou clique no fundo.
 */
export function ImageLightbox({ src, alt, open, onOpenChange }: ImageLightboxProps) {
  if (!src) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className={cn(
          'fixed inset-0 left-0 top-0 z-modal flex h-[100dvh] w-screen max-h-[100dvh] max-w-none',
          'translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-transparent p-0',
          'overflow-hidden shadow-none duration-150',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
        )}
        onClick={() => onOpenChange(false)}
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <DialogDescription className="sr-only">
          Foto ampliada em tela cheia. Pressione Escape ou clique no fundo para fechar.
        </DialogDescription>
        <div
          className="absolute inset-0 cursor-zoom-out bg-foreground/92"
          aria-hidden="true"
        />
        <button
          type="button"
          className="absolute right-3 top-3 z-10 rounded-full bg-background/15 p-2 text-background transition-colors hover:bg-background/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background"
          onClick={(e) => {
            e.stopPropagation();
            onOpenChange(false);
          }}
          aria-label="Fechar ampliação"
        >
          <X className="h-5 w-5" weight="bold" aria-hidden="true" />
        </button>
        <div
          className="relative z-[1] flex h-full w-full items-center justify-center p-4 sm:p-8"
          onClick={(e) => e.stopPropagation()}
        >
          <SignedImage
            src={src}
            alt={alt}
            fit="contain"
            className="max-h-full max-w-full bg-transparent"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ZoomableImageProps {
  src: string;
  alt: string;
  className?: string;
  fit?: 'cover' | 'contain';
  /** Classe do botão que envolve a miniatura (ex.: aspect-video w-full). */
  buttonClassName?: string;
  /** Prefixo do aria-label; default "Ampliar foto". */
  enlargeLabel?: string;
  width?: number;
  height?: number;
  loading?: 'lazy' | 'eager';
  /** URL em resolução plena pro lightbox (quando `src` é thumb redimensionada). */
  lightboxSrc?: string;
}

/**
 * Miniatura clicável + lightbox fullscreen.
 * Sempre stopPropagation pra não acionar card/linha pai.
 */
export function ZoomableImage({
  src,
  alt,
  className,
  fit = 'cover',
  buttonClassName,
  enlargeLabel = 'Ampliar foto',
  width,
  height,
  loading,
  lightboxSrc,
}: ZoomableImageProps) {
  const [open, setOpen] = useState(false);
  const fullSrc = lightboxSrc || src;

  if (!src) return null;

  const openZoom = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      {/*
        `div role="button"` (não <button>): a miniatura mora dentro de cards/
        linhas que já são <button> (ficha, picker de ref, Kanban). Botão
        aninhado é HTML inválido e o React avisa validateDOMNesting.
      */}
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'group/zoom relative block cursor-zoom-in overflow-hidden p-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          buttonClassName,
        )}
        onClick={openZoom}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openZoom(e);
        }}
        aria-label={`${enlargeLabel}: ${alt}`}
      >
        <SignedImage
          src={src}
          alt={alt}
          fit={fit}
          width={width}
          height={height}
          // Não passar `loading={undefined}` — sobrescreve o default lazy do SignedImage.
          {...(loading ? { loading } : {})}
          className={cn('h-full w-full', className)}
        />
      </div>
      <ImageLightbox src={fullSrc} alt={alt} open={open} onOpenChange={setOpen} />
    </>
  );
}
