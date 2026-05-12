import React from 'react';
import { QrCode } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** Nome do setor pra título principal. */
  sector: string;
  /** Ícone do setor (Lucide). */
  icon: React.ComponentType<{ className?: string }>;
  /** Cor de fundo do header (Tailwind). Ex: 'bg-blue-600'. */
  bgColor: string;
  /** Cor da borda. Ex: 'border-blue-700'. */
  borderColor: string;
  /** Slot pra imagem do produto à esquerda. */
  imageSlot?: React.ReactNode;
  /** Slot principal com identificação (ref/cor/PV/etc). */
  identification: React.ReactNode;
  /** Tag opcional pro canto direito (QR code label). */
  qrLabel?: string;
  /** Slot extra abaixo do header (alertas). */
  alerts?: React.ReactNode;
  date?: string;
}

/**
 * Header padronizado pra todas as fichas de operador.
 *
 * Layout:
 *   [FOTO] [IDENTIFICAÇÃO]      [QR + LABEL]
 *   [ALERTAS opcionais]
 *
 * Foto + identificação ocupam mesma altura. Header sempre compacto pra
 * não desperdiçar espaço vertical em A4.
 */
export const WorksheetHeader = ({
  sector, icon: Icon, bgColor, borderColor,
  imageSlot, identification, qrLabel, alerts, date,
}: Props) => {
  return (
    <div>
      <div className={cn('flex items-stretch gap-0 rounded-lg overflow-hidden border-2 mb-1.5', borderColor)}>
        {/* Sector strip */}
        <div className={cn('text-white flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 shrink-0', bgColor)}>
          <Icon className="h-4 w-4" />
          <span className="text-[9px] font-black uppercase tracking-tight text-center leading-tight">{sector}</span>
        </div>

        {/* Image */}
        {imageSlot && (
          <div className="flex items-center justify-center px-1.5 bg-white border-l border-r border-slate-200 shrink-0">
            {imageSlot}
          </div>
        )}

        {/* Identification */}
        <div className="flex-1 flex flex-col justify-center gap-0 px-2.5 py-1.5 bg-slate-50 min-w-0">
          {identification}
        </div>

        {/* QR */}
        <div className="flex flex-col items-center justify-center px-1.5 bg-white border-l border-slate-200 shrink-0">
          <QrCode className="h-7 w-7 text-slate-700" />
          {qrLabel && <span className="text-[7px] font-mono text-slate-400 mt-0.5">{qrLabel}</span>}
          {date && <span className="text-[7px] text-slate-500 mt-0.5">{date}</span>}
        </div>
      </div>
      {alerts}
    </div>
  );
};
