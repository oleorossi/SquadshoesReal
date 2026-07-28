/**
 * Fonte em runtime: public.silk_shoe_category (via useShoeCategories).
 *
 * Esta constante é mantida como fallback, seed e tipo enquanto o catálogo
 * remoto ainda não foi carregado.
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
