/**
 * Canonical list of shoe categories shared between the Technical Sheet form
 * and the Lead Time defaults page. Keep this list as the single source of
 * truth — adding a new value here automatically makes it selectable in both
 * the Ficha Técnica and the Lead Time padrão por categoria.
 */
export const SHOE_CATEGORIES = [
  'Scarpin',
  'Sandália',
  'Sandália Tiras',
  'Mule',
  'Ankle Boot',
  'Oxford',
  'Plataforma',
  'Anabela',
  'Rasteira',
  'Rasteirinha',
  'Tênis',
  'Sapatilha',
  'Bota',
  'Bota Curta',
  'Bota Longa',
  'Cinto',
  'Infantil',
  'Genérico',
] as const;

export type ShoeCategory = (typeof SHOE_CATEGORIES)[number];
