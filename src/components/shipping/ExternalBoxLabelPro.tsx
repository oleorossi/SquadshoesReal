import { QRCodeSVG } from 'qrcode.react';
import type { OrderBoxPackingResult } from '@/lib/orderBoxPacking';

interface ExternalBoxLabelProProps {
  orderNumber: string;
  orderId: string;
  refName: string;
  refCode: string;
  colorName: string;
  packing: OrderBoxPackingResult;
  boxIndex?: number;
  category?: string;
  senderName?: string;
  senderCnpj?: string;
  recipientName?: string;
  mainMaterial?: string;
  imageUrl?: string;
  strapsLabel?: string;
}

const SIZES = ['33', '34', '35', '36', '37', '38', '39', '40'];

/**
 * Etiqueta de caixa externa PRO (100×60mm) com QR Code e foto do modelo.
 * Usa tokens semânticos do design system.
 */
export function ExternalBoxLabelPro({
  orderNumber,
  orderId,
  refName,
  refCode,
  colorName,
  packing,
  boxIndex,
  category = 'PRODUÇÃO',
  senderName = 'SQUAD SHOES',
  senderCnpj,
  recipientName,
  mainMaterial,
  imageUrl,
  strapsLabel,
}: ExternalBoxLabelProProps) {
  const currentBox = boxIndex !== undefined ? packing.boxes[boxIndex] : null;
  const grid = currentBox?.grid ?? packing.boxGrid;
  const pairs = currentBox?.pairs ?? packing.totalPairs;
  const boxNum = currentBox?.boxNumber ?? null;

  return (
    <div
      className="w-[100mm] h-[60mm] border-2 border-foreground p-2 flex flex-col justify-between font-sans bg-background text-foreground overflow-hidden print:m-0 mb-4"
      style={{ fontSize: '10px' }}
    >
      {/* CABEÇALHO */}
      <div className="flex justify-between items-start border-b-2 border-foreground pb-1">
        <div className="flex flex-col min-w-0">
          <h1 className="text-xl font-black italic tracking-tighter leading-none">{senderName}</h1>
          <div className="text-[9px] leading-tight mt-0.5">
            <p>
              PEDIDO:{' '}
              <span className="font-bold text-sm">#{orderNumber}</span>
            </p>
            <p>
              DATA:{' '}
              <span className="font-bold">
                {new Date().toLocaleDateString('pt-BR')}
              </span>
            </p>
          </div>
        </div>

        <div className="flex gap-2 items-center shrink-0">
          <div className="text-right text-[8px] leading-tight">
            <p>
              {boxNum
                ? `CX ${boxNum}/${packing.numberOfBoxes}`
                : `VOL.: ${pairs} PRS`}
            </p>
            <p className="mt-0.5 uppercase text-muted-foreground">{category}</p>
          </div>
          <QRCodeSVG value={orderId} size={40} />
        </div>
      </div>

      {/* CORPO: Foto + Dados do Modelo */}
      <div className="flex gap-2 flex-1 py-1 border-b border-foreground min-h-0">
        {imageUrl && (
          <div className="w-[22mm] h-full border border-foreground rounded overflow-hidden shrink-0 flex items-center justify-center bg-muted">
            <img
              src={imageUrl}
              className="max-w-full max-h-full object-contain"
              crossOrigin="anonymous"
              alt="Ref"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        <div className="flex flex-col justify-center min-w-0 flex-1">
          <p className="text-sm font-black uppercase truncate leading-tight">{refName}</p>
          <p className="text-[10px]">
            <span className="font-bold">Ref:</span> {refCode}
          </p>
          <p className="text-[10px]">
            <span className="font-bold">Cor:</span> {colorName}
          </p>
          {strapsLabel && (
            <p className="text-[9px] text-muted-foreground truncate">
              <span className="font-bold text-foreground">Tiras:</span> {strapsLabel.replace(/\|/g, ' — ').replace(/:/g, ': ')}
            </p>
          )}
          {mainMaterial && (
            <p className="text-[9px] text-muted-foreground uppercase truncate mt-0.5">
              {mainMaterial}
            </p>
          )}
        </div>
        <div className="text-right shrink-0 flex flex-col justify-center">
          <span className="text-2xl font-black leading-none">{pairs}</span>
          <span className="text-[8px] font-bold uppercase">pares</span>
        </div>
      </div>

      {/* GRADE */}
      <div className="flex items-center gap-1 py-0.5">
        <div className="grid grid-cols-8 gap-px flex-1">
          {SIZES.map((size) => (
            <div key={size} className="border border-foreground text-center">
              <div className="bg-foreground text-background text-[7px] leading-none py-px font-bold">
                {size}
              </div>
              <div className="text-[11px] font-black leading-none py-px">
                {grid[size] || '-'}
              </div>
            </div>
          ))}
        </div>
        <div className="text-[8px] font-bold border-l border-foreground pl-1 shrink-0 leading-tight">
          {packing.multiplier > 1 ? `${packing.multiplier}x` : 'UN'}
        </div>
      </div>

      {/* RODAPÉ */}
      <div className="flex justify-between items-center text-[7px] border-t border-foreground pt-0.5">
        <span>{senderCnpj ? `CNPJ: ${senderCnpj}` : senderName}</span>
        {recipientName && (
          <span className="font-bold truncate ml-2">→ {recipientName}</span>
        )}
        <span className="font-mono shrink-0">
          * {orderNumber.slice(0, 8).toUpperCase()} *
        </span>
      </div>
    </div>
  );
}
