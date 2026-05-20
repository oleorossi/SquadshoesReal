import { useMemo } from 'react';
import type { OrderBoxPackingResult } from '@/lib/orderBoxPacking';

interface ExternalBoxLabelProps {
  orderNumber: string;
  refName: string;
  colorName: string;
  packing: OrderBoxPackingResult;
  boxIndex?: number;
  imageUrl?: string;
  strapsLabel?: string;
}

const SIZES = ['33', '34', '35', '36', '37', '38', '39', '40'];

/**
 * Etiqueta térmica de caixa externa (100×30mm).
 * Integrada à arquitetura de impressão via iframe/srcdoc.
 */
export function ExternalBoxLabel({
  orderNumber,
  refName,
  colorName,
  packing,
  boxIndex,
  imageUrl,
  strapsLabel,
}: ExternalBoxLabelProps) {
  const currentBox = boxIndex !== undefined ? packing.boxes[boxIndex] : null;
  const grid = currentBox?.grid ?? packing.boxGrid;
  const pairs = currentBox?.pairs ?? packing.totalPairs;
  const boxNum = currentBox?.boxNumber ?? null;

  return (
    <div
      className="w-[100mm] h-[30mm] border border-foreground p-1 flex flex-col justify-between font-sans bg-background text-foreground overflow-hidden print:m-0 mb-4"
      style={{ fontSize: '10px' }}
    >
      {/* Linha 1: Identificação */}
      <div className="flex justify-between items-start border-b border-foreground pb-0.5">
        {imageUrl && (
          <div className="w-[12mm] h-[10mm] border border-foreground rounded overflow-hidden shrink-0 mr-1 flex items-center justify-center bg-muted">
            <img
              src={imageUrl}
              className="max-w-full max-h-full object-contain"
              crossOrigin="anonymous"
              alt="Ref"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        )}
        <div className="leading-tight min-w-0 flex-1">
          <span className="text-xs font-black uppercase">Caixa Externa</span>
          <h2 className="text-xs font-bold truncate">
            {refName} - {colorName}
          </h2>
          {strapsLabel && (
            <p className="text-[8px] text-muted-foreground truncate">Tiras: {strapsLabel.replace(/\|/g, ' — ').replace(/:/g, ': ')}</p>
          )}
        </div>
        <div className="text-right shrink-0 ml-1">
          <span className="text-[8px] block">PED: #{orderNumber}</span>
          <span className="text-xs font-black">
            {boxNum ? `CX ${boxNum}/${packing.numberOfBoxes}` : `${pairs} PARES`}
          </span>
        </div>
      </div>

      {/* Linha 2: Grade da Caixa */}
      <div className="flex items-center justify-between py-0.5">
        <div className="grid grid-cols-8 gap-0.5 flex-1 mr-2">
          {SIZES.map((size) => (
            <div key={size} className="border border-foreground text-center">
              <div className="bg-foreground text-background text-[7px] leading-none py-0.5">
                {size}
              </div>
              <div className="text-xs font-bold leading-none py-0.5">
                {grid[size] || 0}
              </div>
            </div>
          ))}
        </div>
        <div className="text-[8px] leading-tight font-bold border-l border-foreground pl-1 shrink-0">
          GRADE: {pairs}
          <br />
          {packing.multiplier > 1 ? `PACK: ${packing.multiplier}x` : 'PACK: UN'}
        </div>
      </div>

      {/* Linha 3: Rodapé */}
      <div className="flex justify-between items-center text-[7px]">
        <span>DATA: {new Date().toLocaleDateString('pt-BR')} | RJ-BR</span>
        <span className="font-mono bg-foreground text-background px-1 py-0.5 text-[8px]">
          * {orderNumber.slice(0, 8).toUpperCase()} *
        </span>
      </div>
    </div>
  );
}

/**
 * Gera HTML estático para impressão via iframe (compatível com a arquitetura existente).
 */
export function buildExternalBoxLabelHtml(
  orderNumber: string,
  refName: string,
  colorName: string,
  packing: OrderBoxPackingResult,
  imageUrl?: string,
  strapsLabel?: string
): string {
  const labels = packing.boxes.map((box) => {
    const gradeHtml = SIZES.map(
      (s) =>
        `<div style="border:1px solid #000;text-align:center;flex:1;">
          <div style="background:#000;color:#fff;font-size:7px;padding:1px 0;">${s}</div>
          <div style="font-size:10px;font-weight:bold;padding:1px 0;">${box.grid[s] || 0}</div>
        </div>`
    ).join('');

    const imgHtml = imageUrl
      ? `<div style="width:12mm;height:10mm;border:1px solid #000;border-radius:2px;overflow:hidden;flex-shrink:0;margin-right:3px;display:flex;align-items:center;justify-content:center;background:#f5f5f5;">
          <img src="${imageUrl}" style="max-width:100%;max-height:100%;object-fit:contain;" crossorigin="anonymous" onerror="this.style.display='none'" />
        </div>`
      : '';

    return `
      <div style="width:100mm;height:30mm;border:1px solid #000;padding:2px;display:flex;flex-direction:column;justify-content:space-between;font-family:sans-serif;font-size:10px;page-break-inside:avoid;margin-bottom:4px;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #000;padding-bottom:2px;">
          ${imgHtml}
          <div style="overflow:hidden;flex:1;">
            <div style="font-size:10px;font-weight:900;text-transform:uppercase;">Caixa Externa</div>
            <div style="font-size:11px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${refName} - ${colorName}</div>
            ${strapsLabel ? `<div style="font-size:8px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Tiras: ${strapsLabel.replace(/\|/g, ' — ').replace(/:/g, ': ')}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:4px;">
            <div style="font-size:8px;">PED: #${orderNumber}</div>
            <div style="font-size:11px;font-weight:900;">CX ${box.boxNumber}/${packing.numberOfBoxes}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:2px 0;">
          <div style="display:flex;flex:1;gap:2px;margin-right:4px;">${gradeHtml}</div>
          <div style="font-size:8px;font-weight:bold;border-left:1px solid #000;padding-left:4px;flex-shrink:0;line-height:1.3;">
            GRADE: ${box.pairs}<br/>${packing.multiplier > 1 ? `PACK: ${packing.multiplier}x` : 'PACK: UN'}
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:7px;">
          <span>DATA: ${new Date().toLocaleDateString('pt-BR')} | RJ-BR</span>
          <span style="font-family:monospace;background:#000;color:#fff;padding:1px 3px;font-size:8px;">* ${orderNumber.slice(0, 8).toUpperCase()} *</span>
        </div>
      </div>`;
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas Caixa Externa</title>
<style>@media print{@page{margin:2mm;}body{margin:0;}}</style>
</head><body>${labels.join('')}</body></html>`;
}
