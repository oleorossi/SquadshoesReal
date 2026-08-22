import { describe, it, expect } from 'vitest';
import {
  collectOrderPhotos,
  groupOrderPhotos,
  resolveOrderItemPhoto,
  buildOrderPhotosPrintHtml,
} from '@/lib/printOrderPhotos';

describe('printOrderPhotos', () => {
  const items = [
    {
      id: 'i1', color: 'LIMONCELLO', quantity: 72,
      variant_image_url: 'https://cdn.example/ds20-limoncello.jpg',
      technical_sheets: { code: 'DS20', name: 'DS20', image_url: 'https://cdn.example/ds20.jpg', images: ['https://cdn.example/ds20.jpg'] },
    },
    {
      id: 'i2', color: 'OFF WHITE', quantity: 108,
      variant_image_url: '',
      technical_sheets: { code: 'DS20', name: 'DS20', image_url: 'https://cdn.example/ds20.jpg', images: ['https://cdn.example/ds20-offwhite.jpg'] },
    },
    {
      id: 'i3', color: 'PRETO', quantity: 96,
      variant_image_url: 'https://cdn.example/ds18-preto.jpg',
      technical_sheets: { code: 'DS18', name: 'Derby', image_url: 'https://cdn.example/ds18.jpg', images: [] },
    },
  ];

  it('prioriza foto da variante, depois images[0] da ficha, depois image_url', () => {
    expect(resolveOrderItemPhoto(items[0])).toBe('https://cdn.example/ds20-limoncello.jpg');
    expect(resolveOrderItemPhoto(items[1])).toBe('https://cdn.example/ds20-offwhite.jpg');
    expect(resolveOrderItemPhoto({
      id: 'x',
      technical_sheets: { image_url: 'https://cdn.example/master.jpg', images: [] },
    })).toBe('https://cdn.example/master.jpg');
  });

  it('agrupa cores da mesma referência', () => {
    const photos = collectOrderPhotos(items);
    const groups = groupOrderPhotos(photos);
    expect(groups).toHaveLength(2);
    expect(groups[0].refCode).toBe('DS20');
    expect(groups[0].items.map((i) => i.color)).toEqual(['LIMONCELLO', 'OFF WHITE']);
    expect(groups[1].refCode).toBe('DS18');
  });

  it('monta o HTML do catálogo com PV, cliente e fotos', () => {
    const html = buildOrderPhotosPrintHtml({
      orderNumber: 'PV-00162',
      clientName: 'ELIANE',
      photos: collectOrderPhotos(items),
    });
    expect(html).toContain('PV-00162');
    expect(html).toContain('ELIANE');
    expect(html).toContain('Fotos do pedido');
    expect(html).toContain('DS20');
    expect(html).toContain('LIMONCELLO');
    expect(html).toContain('https://cdn.example/ds20-limoncello.jpg');
    expect(html).toContain('72 pares');
    expect(html).not.toContain('javascript:');
  });
});
