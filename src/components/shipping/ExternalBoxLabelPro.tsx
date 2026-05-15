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
  /** Legado: nome curto do destinatário. Use recipientRazaoSocial para o bloco completo. */
  recipientName?: string;
  recipientRazaoSocial?: string;
  recipientCnpj?: string;
  recipientEndereco?: string;
  recipientBairro?: string;
  recipientCidade?: string;
  recipientEstado?: string;
  recipientCep?: string;
  recipientBranchCode?: string;
  recipientBranchName?: string;
  mainMaterial?: string;
  imageUrl?: string;
  strapsLabel?: string;
}

const SIZES = ['33', '34', '35', '36', '37', '38', '39', '40'];

function formatCep(cep?: string) {
  if (!cep) return '';
  const c = cep.replace(/\D/g, '');
  if (c.length !== 8) return cep;
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

/**
 * Etiqueta de caixa externa PRO (100×60mm) com QR Code, foto do modelo
 * e bloco DESTINATÁRIO completo (razão social, filial, endereço, CNPJ).
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
  recipientRazaoSocial,
  recipientCnpj,
  recipientEndereco,
  recipientBairro,
  recipientCidade,
  recipientEstado,
  recipientCep,
  recipientBranchCode,
  recipientBranchName,
  mainMaterial,
  imageUrl,
  strapsLabel,
}: ExternalBoxLabelProProps) {
  const currentBox = boxIndex !== undefined ? packing.boxes[boxIndex] : null;
  const grid = currentBox?.grid ?? packing.boxGrid;
  const pairs = currentBox?.pairs ?? packing.totalPairs;
  const boxNum = currentBox?.boxNumber ?? null;

  const razaoSocial = recipientRazaoSocial || recipientName;
  const hasAddress =
    !!recipientEndereco || !!recipientCidade || !!recipientBairro || !!recipientCep;
  const cityLine = [recipientCidade, recipientEstado].filter(Boolean).join('/');
  const branchLabel = [recipientBranchCode, recipientBranchName].filter(Boolean).join(' — ');

  return (
    <div
      className="w-[100mm] h-[60mm] border-2 border-foreground p-1.5 flex flex-col font-sans bg-background text-foreground overflow-hidden print:m-0 mb-4 keep-together"
      style={{ fontSize: '10px' }}
    >
      {/* CABEÇALHO */}
      <div className="flex justify-between items-start border-b border-foreground pb-0.5">
        <div className="flex flex-col min-w-0">
          <h1 className="text-base font-black italic tracking-tighter leading-none">{senderName}</h1>
          <div className="text-[8px] leading-tight mt-0.5">
            <span>PED: <span className="font-bold">#{orderNumber}</span></span>
            <span className="ml-2">{new Date().toLocaleDateString('pt-BR')}</span>
          </div>
        </div>

        <div className="flex gap-1.5 items-center shrink-0">
          <div className="text-right text-[8px] leading-tight">
            <p className="font-bold">
              {boxNum ? `CX ${boxNum}/${packing.numberOfBoxes}` : `${pairs} PRS`}
            </p>
            <p className="uppercase text-muted-foreground">{category}</p>
          </div>
          <QRCodeSVG value={orderId} size={32} />
        </div>
      </div>

      {/* DESTINATÁRIO — bloco principal */}
      {(razaoSocial || hasAddress) && (
        <div className="border-b border-foreground py-0.5 px-0.5">
          <div className="flex items-baseline gap-1">
            <span className="text-[7px] font-bold uppercase text-muted-foreground tracking-wider">Para:</span>
            <span className="text-[10px] font-black uppercase truncate flex-1 leading-tight">
              {razaoSocial || '—'}
            </span>
            {branchLabel && (
              <span className="text-[8px] font-bold border border-foreground rounded px-1 leading-tight shrink-0">
                {branchLabel}
              </span>
            )}
          </div>
          {recipientEndereco && (
            <p className="text-[8px] leading-tight truncate">
              {recipientEndereco}
              {recipientBairro ? ` — ${recipientBairro}` : ''}
            </p>
          )}
          {(cityLine || recipientCep) && (
            <p className="text-[8px] leading-tight truncate">
              {cityLine}
              {recipientCep ? `  CEP ${formatCep(recipientCep)}` : ''}
              {recipientCnpj ? `  CNPJ ${recipientCnpj}` : ''}
            </p>
          )}
        </div>
      )}

      {/* CORPO: Foto + Dados do Modelo */}
      <div className="flex gap-1.5 flex-1 py-0.5 border-b border-foreground min-h-0">
        {imageUrl && (
          <div className="w-[18mm] h-full border border-foreground rounded overflow-hidden shrink-0 flex items-center justify-center bg-muted">
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
          {/* Referência = nome do modelo. SKU/refCode removido em 2026-05. */}
          <p className="text-[11px] font-black uppercase truncate leading-tight">{refName || refCode || '—'}</p>
          <p className="text-[9px] leading-tight">
            <span className="font-bold">Cor:</span> {colorName}
          </p>
          {strapsLabel && (
            <p className="text-[8px] text-muted-foreground truncate leading-tight">
              <span className="font-bold text-foreground">Tiras:</span> {strapsLabel.replace(/\|/g, ' — ').replace(/:/g, ': ')}
            </p>
          )}
          {mainMaterial && (
            <p className="text-[8px] text-muted-foreground uppercase truncate leading-tight">
              {mainMaterial}
            </p>
          )}
        </div>
        <div className="text-right shrink-0 flex flex-col justify-center">
          <span className="text-xl font-black leading-none">{pairs}</span>
          <span className="text-[7px] font-bold uppercase">pares</span>
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
              <div className="text-[10px] font-black leading-none py-px">
                {grid[size] || '-'}
              </div>
            </div>
          ))}
        </div>
        <div className="text-[7px] font-bold border-l border-foreground pl-1 shrink-0 leading-tight">
          {packing.multiplier > 1 ? `${packing.multiplier}x` : 'UN'}
        </div>
      </div>

      {/* RODAPÉ */}
      <div className="flex justify-between items-center text-[7px] border-t border-foreground pt-0.5">
        <span className="truncate">{senderCnpj ? `Remetente CNPJ: ${senderCnpj}` : senderName}</span>
        <span className="font-mono shrink-0">* {orderNumber.slice(0, 8).toUpperCase()} *</span>
      </div>
    </div>
  );
}
