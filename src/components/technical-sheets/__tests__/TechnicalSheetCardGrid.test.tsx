import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TechnicalSheetCardGrid, type TechnicalSheetGridItem } from '../TechnicalSheetCardGrid';

vi.mock('@/components/ui/signed-image', () => ({
  SignedImage: ({ src, alt, className, fit }: { src: string; alt: string; className?: string; fit?: string }) => (
    <img src={src} alt={alt} className={className} data-fit={fit} />
  ),
}));

const sheet: TechnicalSheetGridItem = {
  id: 'sheet-1',
  name: 'NL04',
  code: 'NL04-INT',
  collection: 'Verão 2027',
  shoe_category: 'Feminino',
  status_ficha: 'publicada',
  sole_material: 'Solado 01',
  upper_material: 'Napa Whisky',
  images: ['https://cdn.example.com/nl04.jpg'],
};

function renderGrid({
  item = sheet,
  canDelete = true,
}: {
  item?: TechnicalSheetGridItem;
  canDelete?: boolean;
} = {}) {
  const callbacks = {
    onOpenSheet: vi.fn(),
    onEditImage: vi.fn(),
    onDeleteSheet: vi.fn(),
  };
  const result = render(
    <TechnicalSheetCardGrid
      sheets={[item]}
      canDelete={canDelete}
      {...callbacks}
    />,
  );

  return { ...result, ...callbacks };
}

describe('TechnicalSheetCardGrid', () => {
  it('usa miniatura compacta 16:9 sem recortar a foto', () => {
    const { container } = renderGrid();
    const image = screen.getByAltText('Foto da referência NL04');

    expect(image).toHaveClass('aspect-video');
    expect(image).toHaveAttribute('data-fit', 'contain');
    expect(container.firstElementChild?.className).toContain('min-[1800px]:grid-cols-6');
  });

  it('abre a ficha pelo card', () => {
    const { onOpenSheet } = renderGrid();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir ficha técnica NL04' }));
    expect(onOpenSheet).toHaveBeenCalledWith('sheet-1');
  });

  it('identifica e aciona a edição de foto da referência correta', () => {
    const { onEditImage } = renderGrid();

    fireEvent.click(screen.getByRole('button', { name: 'Alterar foto de NL04' }));
    expect(onEditImage).toHaveBeenCalledWith(sheet);
  });

  it('exibe exclusão somente para quem tem permissão', () => {
    const allowed = renderGrid();
    const deleteButton = screen.getByRole('button', { name: 'Excluir ficha NL04' });
    expect(deleteButton).toHaveClass('h-11', 'w-11', 'sm:h-8', 'sm:w-8');
    fireEvent.click(deleteButton);
    expect(allowed.onDeleteSheet).toHaveBeenCalledWith(sheet);

    allowed.unmount();
    renderGrid({ canDelete: false });
    expect(screen.queryByRole('button', { name: 'Excluir ficha NL04' })).not.toBeInTheDocument();
  });

  it('mantém a mesma proporção compacta quando não há imagem', () => {
    renderGrid({ item: { ...sheet, images: [] } });

    expect(screen.getByRole('img', { name: 'Sem imagem para NL04' })).toHaveClass('aspect-video');
  });
});
