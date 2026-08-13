import type { LabelField, LabelTemplate } from '@/types/label-system';
import { escapeHtml, safeUrlAttr } from '@/lib/htmlUtils';

export interface TemplateLabelData {
  refCode: string;
  refName: string;
  color: string;
  size: string;
  barcode: string;
  clientOrderNumber?: string;
  imageUrl?: string;
}

function jsLiteral(value: unknown): string {
  return JSON.stringify(String(value ?? '')).replace(/<\//g, '<\\/');
}

function fieldValue(field: LabelField, label: TemplateLabelData, index: number): string {
  if (field.data_source === 'custom') return field.default_value || '';
  if (field.data_source === 'product_name') return label.refName;
  if (field.data_source === 'sku') return label.refCode;
  if (field.data_source === 'order_number') return label.clientOrderNumber || '';
  if (field.data_source === 'barcode') return label.barcode;
  if (field.data_source === 'color') return label.color;
  if (field.data_source === 'size') return label.size;
  if (field.data_source === 'date') return new Date().toLocaleDateString('pt-BR');
  if (field.data_source === 'counter') return String(index + 1);
  return '';
}

export function validateLabelTemplate(template: LabelTemplate): string[] {
  const errors: string[] = [];
  if (!(template.dimensions.width > 0) || !(template.dimensions.height > 0)) {
    errors.push('As dimensões da etiqueta precisam ser maiores que zero.');
  }
  if (template.fields.length === 0) errors.push('Adicione ao menos um campo antes de ativar ou imprimir o template.');
  for (const field of template.fields) {
    const { x, y, width, height } = field.position;
    if (width <= 0 || height <= 0) errors.push(`${field.name}: largura e altura precisam ser positivas.`);
    if (x < 0 || y < 0 || x + width > template.dimensions.width || y + height > template.dimensions.height) {
      errors.push(`${field.name}: campo fora da área imprimível.`);
    }
  }
  return errors;
}

/** Renderiza fielmente os campos do designer. Usado apenas em templates customizados. */
export function buildTemplateLabelsHtml(template: LabelTemplate, labels: TemplateLabelData[]): string {
  const errors = validateLabelTemplate(template);
  if (errors.length > 0) throw new Error(errors[0]);

  const barcodeInit: string[] = [];
  const qrInit: string[] = [];
  const pages = labels.map((label, labelIndex) => {
    const fields = template.fields.map(field => {
      const value = fieldValue(field, label, labelIndex);
      const id = `${labelIndex}-${field.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
      const style = [
        `left:${field.position.x}mm`, `top:${field.position.y}mm`,
        `width:${field.position.width}mm`, `height:${field.position.height}mm`,
        `font-size:${Math.max(5, field.styling.font_size)}pt`,
        `font-weight:${field.styling.font_weight === 'bold' ? '700' : '400'}`,
        `text-align:${field.styling.text_align}`,
        `text-transform:${field.styling.text_transform}`,
      ].join(';');
      if (field.type === 'image') {
        const src = safeUrlAttr(label.imageUrl);
        return `<div class="field image" style="${style}">${src ? `<img src="${src}" alt="">` : ''}</div>`;
      }
      if (field.type === 'barcode') {
        const format = field.barcode_format === 'EAN13' && /^\d{12,13}$/.test(value) ? 'EAN13' : 'CODE128';
        barcodeInit.push(`JsBarcode("#bc-${id}",${jsLiteral(value || 'SEM-CODIGO')},{format:"${format}",displayValue:true,margin:0,height:40,fontSize:10});`);
        return `<div class="field code" style="${style}"><svg id="bc-${id}"></svg></div>`;
      }
      if (field.type === 'qr_code') {
        qrInit.push(`new QRCode(document.getElementById("qr-ht-${id}"),{text:${jsLiteral(value)},width:100,height:100,correctLevel:QRCode.CorrectLevel.H});`);
        return `<div class="field qr" id="qr-ht-${id}" style="${style}"></div>`;
      }
      return `<div class="field text" style="${style}">${escapeHtml(value)}</div>`;
    }).join('');
    return `<section class="label-page">${fields}</section>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(template.name)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}html,body{background:#fff;color:#000;font-family:Arial,sans-serif}
@page{size:${template.dimensions.width}mm ${template.dimensions.height}mm;margin:0}
.label-page{position:relative;width:${template.dimensions.width}mm;height:${template.dimensions.height}mm;page-break-after:always;overflow:hidden;background:#fff}
.label-page:last-child{page-break-after:auto}.field{position:absolute;overflow:hidden;display:flex;align-items:center}.field.text{white-space:pre-wrap;line-height:1.05}.field.image img{width:100%;height:100%;object-fit:contain}.field.code svg{width:100%;height:100%}.field.qr img,.field.qr canvas{width:100%!important;height:100%!important}
@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.label-page{margin:0}}
</style></head><body>${pages}
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>var tries=0;function init(){if(typeof JsBarcode==='undefined'||typeof QRCode==='undefined'){if(tries++<40)setTimeout(init,150);return}try{${barcodeInit.join('\n')}${qrInit.join('\n')}}catch(e){console.error(e)}}init();</script>
</body></html>`;
}
