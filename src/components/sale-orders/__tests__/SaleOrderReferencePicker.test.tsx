import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReferenceSearch } from '@/components/sale-orders/SaleOrderItemForm';

const ORIGINAL_IMAGE = 'https://projeto.supabase.co/storage/v1/object/public/reference-images/sp10.webp';
const THUMBNAIL_IMAGE = 'https://projeto.supabase.co/storage/v1/render/image/public/reference-images/sp10.webp?width=168&height=168&resize=cover&quality=80';

describe('ReferenceSearch', () => {
  it('exibe images[0] como miniatura otimizada e trata falha de carregamento', () => {
    render(
      <ReferenceSearch
        references={[{
          id: 'ref-sp10',
          code: 'SP10',
          name: 'Modelo SP 10',
          images: [ORIGINAL_IMAGE],
          image_url: null,
          status_ficha: 'publicada',
        }]}
        onSelect={vi.fn()}
        variantsByRef={new Map()}
        onRefresh={vi.fn()}
        refreshing={false}
        onCreate={vi.fn()}
      />,
    );

    const image = screen.getByRole('img', { name: 'Modelo SP 10' });
    expect(image).toHaveAttribute('src', THUMBNAIL_IMAGE);
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');

    fireEvent.error(image);

    expect(screen.getByRole('img', { name: 'Sem imagem: Modelo SP 10' })).toBeInTheDocument();
  });
});
