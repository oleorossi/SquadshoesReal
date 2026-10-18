import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageLightbox, ZoomableImage } from '@/components/ui/image-lightbox';

vi.mock('@/components/ui/signed-image', () => ({
  SignedImage: ({ src, alt, className }: { src: string; alt: string; className?: string }) => (
    <img src={src} alt={alt} className={className} />
  ),
}));

describe('ImageLightbox', () => {
  it('mostra a imagem ampliada quando aberto', () => {
    render(
      <ImageLightbox
        src="https://cdn.example.com/i100.jpg"
        alt="I100"
        open
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByAltText('I100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar ampliação' })).toBeInTheDocument();
  });

  it('fecha pelo botão X', () => {
    const onOpenChange = vi.fn();
    render(
      <ImageLightbox
        src="https://cdn.example.com/i100.jpg"
        alt="I100"
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fechar ampliação' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ZoomableImage', () => {
  it('abre o lightbox no clique e não propaga pro pai', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <ZoomableImage
          src="https://cdn.example.com/i100.jpg"
          alt="Foto da referência I100"
          className="aspect-video w-full"
        />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ampliar foto/ }));
    expect(parentClick).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByAltText('Foto da referência I100').length).toBeGreaterThanOrEqual(1);
  });

  it('abre com Enter na miniatura', () => {
    render(
      <ZoomableImage src="https://cdn.example.com/i100.jpg" alt="I91" />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: /Ampliar foto/ }), { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('usa div role=button pra poder viver dentro de um botão pai', () => {
    render(
      <button type="button" aria-label="Abrir item">
        <ZoomableImage src="https://cdn.example.com/i100.jpg" alt="I100" />
      </button>,
    );

    const zoom = screen.getByRole('button', { name: /Ampliar foto/ });
    expect(zoom.tagName).toBe('DIV');
    fireEvent.click(zoom);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
