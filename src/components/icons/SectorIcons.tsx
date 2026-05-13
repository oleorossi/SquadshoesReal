/**
 * Ícones customizados de setor — Squad Shoes Novidade design system.
 * Bespoke 24×24, stroke 1.5, currentColor — visual editorial.
 *
 * Uso:
 *   <Corte className="h-5 w-5" />
 *   <Costura size={20} className="text-primary" />
 *
 * Substituem ícones genéricos do lucide-react em contextos de produção.
 */
import React from 'react';

type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

const Svg = ({ size = 24, className = '', strokeWidth = 1.5, children }: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

// ── Setores ───────────────────────────
export const Corte = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="17" r="2.2" />
    <circle cx="18" cy="17" r="2.2" />
    <path d="M7.5 15.6 L18 5" />
    <path d="M16.5 15.6 L6 5" />
    <path d="M11 11.5 L13 13.5" />
  </Svg>
);

export const Costura = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12 L21 12" />
    <path
      d="M3 12 L5 9 M5 9 L7 12 M7 12 L9 9 M9 9 L11 12 M11 12 L13 9 M13 9 L15 12 M15 12 L17 9 M17 9 L19 12 M19 12 L21 9"
      strokeWidth={1.2}
    />
    <circle cx="4" cy="6" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="20" cy="6" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const Montagem = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 18 C 4 14, 7 11, 11 11 L 17 11 C 19 11, 20 12.5, 20 14 L 20 16 C 20 17.5, 18.5 18, 17 18 Z" />
    <path d="M11 11 L 11 8 C 11 6.5, 12 5.5, 13.5 5.5 L 16 5.5" />
    <line x1="6.5" y1="18" x2="6.5" y2="20.5" />
    <line x1="17.5" y1="18" x2="17.5" y2="20.5" />
  </Svg>
);

export const Acabamento = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 17 L9 6 L 15 6 L 20 17 Z" />
    <path d="M7 14 L17 14" />
    <path d="M11 6 L11 14" />
    <path d="M9 17 L9 20 M15 17 L15 20" />
  </Svg>
);

export const Embalagem = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8 L12 4 L20 8 L20 17 L12 21 L4 17 Z" />
    <path d="M4 8 L12 12 L20 8" />
    <path d="M12 12 L12 21" />
    <path d="M8 6 L16 10" strokeOpacity={0.5} />
  </Svg>
);

export const Qualidade = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 L20 7 L20 13 C 20 17, 16 20, 12 21 C 8 20, 4 17, 4 13 L 4 7 Z" />
    <path d="M9 12 L11.5 14.5 L16 9.5" />
  </Svg>
);

export const Expedicao = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="8" width="12" height="9" rx="1" />
    <path d="M14 11 L18 11 L21 14 L21 17 L14 17" />
    <circle cx="7" cy="18.5" r="1.8" />
    <circle cx="17" cy="18.5" r="1.8" />
  </Svg>
);

export const Materiais = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="9" width="8" height="6" rx="0.5" />
    <rect x="13" y="5" width="8" height="6" rx="0.5" />
    <rect x="13" y="13" width="8" height="6" rx="0.5" />
    <line x1="3" y1="20" x2="21" y2="20" />
  </Svg>
);

export const PCP = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="8" y1="9" x2="8" y2="20" />
    <rect x="9.5" y="11" width="4" height="3" fill="currentColor" stroke="none" opacity={0.4} />
    <rect x="14.5" y="14" width="5" height="3" fill="currentColor" stroke="none" opacity={0.4} />
  </Svg>
);

export const DashboardIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 13 C 3 7, 7 3, 12 3 C 17 3, 21 7, 21 13" />
    <line x1="3" y1="13" x2="6" y2="13" />
    <line x1="18" y1="13" x2="21" y2="13" />
    <line x1="12" y1="3" x2="12" y2="6" />
    <path d="M12 13 L16 8" strokeWidth={2} />
    <circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const Equipe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 19 C 3 15, 5.5 13, 9 13 C 12.5 13, 15 15, 15 19" />
    <circle cx="17" cy="9.5" r="2.2" />
    <path d="M15 19 C 15 16.5, 17 15, 19 15 C 20 15, 21 15.4, 21 16" />
  </Svg>
);

export const Relatorios = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21 L5 9 L9 9 L9 21" />
    <path d="M11 21 L11 5 L15 5 L15 21" />
    <path d="M17 21 L17 13 L21 13 L21 21" />
    <line x1="3" y1="21" x2="22" y2="21" />
  </Svg>
);

export const Brand = (p: IconProps) => (
  <Svg {...p} strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" />
    <path d="M3 3 L21 21 M21 3 L3 21" strokeOpacity={0.18} strokeWidth={1} />
    <rect x="14" y="3" width="7" height="7" fill="currentColor" stroke="none" />
  </Svg>
);

/** Mapa nome→ícone pro caso de seleção dinâmica (ex: badge de setor por nome). */
export const SECTOR_ICON_MAP: Record<string, React.FC<IconProps>> = {
  corte: Corte,
  costura: Costura,
  montagem: Montagem,
  acabamento: Acabamento,
  embalagem: Embalagem,
  qualidade: Qualidade,
  expedicao: Expedicao,
  expedição: Expedicao,
  materiais: Materiais,
  pcp: PCP,
  dashboard: DashboardIcon,
  equipe: Equipe,
  relatorios: Relatorios,
  relatórios: Relatorios,
  brand: Brand,
};

/** Helper: pega o ícone por nome (case-insensitive, ignora acento). */
export function getSectorIcon(name: string | undefined | null): React.FC<IconProps> | null {
  if (!name) return null;
  const key = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return SECTOR_ICON_MAP[key] || SECTOR_ICON_MAP[name.toLowerCase()] || null;
}
