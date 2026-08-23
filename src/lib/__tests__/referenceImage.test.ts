import { describe, expect, it } from 'vitest';
import {
  resolveReferenceImageUrl,
  resolveReferenceThumbnailUrl,
} from '@/lib/referenceImage';

describe('resolveReferenceImageUrl', () => {
  it('prioriza a foto atual salva em images[0]', () => {
    expect(resolveReferenceImageUrl({
      images: ['https://cdn.example.com/foto-atual.webp'],
      image_url: 'https://cdn.example.com/foto-legada.webp',
    })).toBe('https://cdn.example.com/foto-atual.webp');
  });

  it('aceita o formato legado de objeto com url dentro de images', () => {
    expect(resolveReferenceImageUrl({
      images: [{ url: 'https://cdn.example.com/foto-objeto.webp' }],
      image_url: null,
    })).toBe('https://cdn.example.com/foto-objeto.webp');
  });

  it('usa image_url quando images está vazio ou inválido', () => {
    expect(resolveReferenceImageUrl({
      images: [{ color: 'PRETO' }],
      image_url: 'https://cdn.example.com/fallback.webp',
    })).toBe('https://cdn.example.com/fallback.webp');
  });

  it('retorna vazio quando a ficha não tem foto', () => {
    expect(resolveReferenceImageUrl({ images: [], image_url: null })).toBe('');
    expect(resolveReferenceImageUrl(undefined)).toBe('');
  });

  it('gera uma miniatura leve do bucket público para o tamanho exibido', () => {
    const original = 'https://projeto.supabase.co/storage/v1/object/public/reference-images/ref.webp';

    expect(resolveReferenceThumbnailUrl({ images: [original] }, 56)).toBe(
      'https://projeto.supabase.co/storage/v1/render/image/public/reference-images/ref.webp?width=168&height=168&resize=cover&quality=80',
    );
  });
});
