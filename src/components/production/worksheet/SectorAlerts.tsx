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
 * Banner âmbar/azul com alertas específicos do setor (palmilha pronta na cor,
 * solado conjugado, modelo fachetado, etc). Posicionado abaixo do header.
 */
export const SectorAlerts = ({ alerts }: Props) => {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="keep-together mb-2 space-y-1">
      {alerts.map((a, i) => {
        const variant = a.variant || 'warning';
        const Icon = variant === 'warning' ? AlertTriangle : Info;
        return (
          <div
            key={i}
            className={cn(
              'flex items-start gap-2 px-3 py-1.5 rounded border-2 text-xs leading-tight',
              variant === 'warning'
                ? 'border-amber-500/60 bg-amber-50 text-amber-900'
                : 'border-blue-500/60 bg-blue-50 text-blue-900',
            )}
          >
            <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', variant === 'warning' ? 'text-amber-600' : 'text-blue-600')} />
            <span className="font-bold">{a.text}</span>
          </div>
        );
      })}
    </div>
  );
};
