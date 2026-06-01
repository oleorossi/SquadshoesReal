import React from 'react';
import { Warning as AlertTriangle, Info } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export type AlertVariant = 'warning' | 'info';

export interface SectorAlert {
  text: string;
  variant?: AlertVariant;
}

interface Props {
  alerts: SectorAlert[];
}

/**
 * Alertas específicos do setor (palmilha pronta na cor, solado conjugado,
 * modelo fachetado, etc). Design Industrial Editorial Minimalist:
 *   - border-black 1.5px à esquerda, fundo branco
 *   - section-label "AVISO" / "INFO" no início
 *   - texto preto em peso editorial bold
 */
export const SectorAlerts = ({ alerts }: Props) => {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="keep-together mb-2 space-y-1.5">
      {alerts.map((a, i) => {
        const variant = a.variant || 'warning';
        const Icon = variant === 'warning' ? AlertTriangle : Info;
        const label = variant === 'warning' ? 'Aviso' : 'Info';
        return (
          <div
            key={i}
            className="flex items-stretch gap-0 bg-white"
            style={{ border: '1px solid #000' }}
          >
            <div
              className="flex items-center justify-center px-2 py-2 shrink-0"
              style={{ borderRight: '1.5px solid #000', minWidth: '90px' }}
            >
              <div className="flex flex-col items-center gap-1">
                <Icon className="h-4 w-4 text-black" weight="bold" />
                <span
                  className="section-label"
                  style={{ color: '#000', fontFamily: "'Fira Sans', sans-serif" }}
                >
                  {label}
                </span>
              </div>
            </div>
            <div className="flex items-center px-3 py-2 flex-1">
              <span
                className="text-[13px] text-black leading-tight"
                style={{ fontWeight: 600, fontFamily: "'Fira Sans', sans-serif" }}
              >
                {a.text}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
