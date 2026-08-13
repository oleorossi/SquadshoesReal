import { describe, expect, it } from 'vitest';
import { buildTemplateLabelsHtml, validateLabelTemplate } from '../templateLabels';
import type { LabelTemplate } from '@/types/label-system';

const template: LabelTemplate = {
  id: 'custom', name: 'Custom', category: 'thermal', type: 'thermal',
  dimensions: { width: 100, height: 30, unit: 'mm' },
  fields: [
    { id: 'name', name: 'Nome', type: 'dynamic_text', position: { x: 2, y: 2, width: 50, height: 8 }, styling: { font_size: 10, font_weight: 'bold', text_align: 'left', text_transform: 'uppercase' }, data_source: 'product_name' },
    { id: 'barcode', name: 'Código', type: 'barcode', position: { x: 55, y: 2, width: 43, height: 26 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'barcode', barcode_format: 'CODE128' },
  ],
  print_settings: { dpi: 203, color_mode: 'monochrome', copies_default: 1 },
  is_active: true, created_at: '', updated_at: '',
};

describe('templateLabels', () => {
  it('renderiza dimensões/campos do designer e inicializa o barcode', () => {
    const html = buildTemplateLabelsHtml(template, [{ refCode: 'I100', refName: 'Sandália', color: 'Preto', size: '36', barcode: 'I100-36' }]);
    expect(html).toContain('@page{size:100mm 30mm');
    expect(html).toContain('Sandália');
    expect(html).toContain('JsBarcode');
    expect(html).toContain('I100-36');
  });

  it('rejeita campo fora da área e template vazio', () => {
    expect(validateLabelTemplate({ ...template, fields: [] })[0]).toMatch(/campo/i);
    const invalid = { ...template, fields: [{ ...template.fields[0], position: { x: 90, y: 2, width: 20, height: 8 } }] };
    expect(validateLabelTemplate(invalid)).toEqual(expect.arrayContaining([expect.stringMatching(/fora/i)]));
  });
});
