/**
 * Hex aproximado das cores comerciais da fábrica — leitura visual rápida em
 * listas, kanban e cartões de OS. Não é cadastro oficial de pigmento: se a
 * cor não estiver no mapa, cai no cinza neutro.
 */

const COLOR_HEX_MAP: Record<string, string> = {
  preto: '#1a1a1a',
  black: '#1a1a1a',
  branco: '#ffffff',
  white: '#ffffff',
  'off white': '#f5f0e8',
  bege: '#d8c8a4',
  beige: '#d8c8a4',
  caramelo: '#b8773a',
  caramel: '#b8773a',
  whisky: '#a05d2c',
  'new whisky': '#a05d2c',
  tan: '#c69a6e',
  'new tan': '#c69a6e',
  cogumelo: '#9b8068',
  champagne: '#e8d5b0',
  champanhe: '#e8d5b0',
  rosado: '#e8b8b0',
  rosa: '#e8b8b0',
  'rosa claro': '#fadbe2',
  'baby pink': '#fadbe2',
  azul: '#3b6ea8',
  'baby blue': '#a8c8e0',
  verde: '#3a7d4a',
  amarelo: '#e8c828',
  limoncello: '#f5e555',
  cinza: '#888888',
  grafite: '#4a4a4a',
  marrom: '#6b3a1f',
  malbec: '#5e1a26',
  carmim: '#9c1a30',
  carmin: '#9c1a30',
  cafe: '#3d2418',
  café: '#3d2418',
  porcelana: '#f0e6dc',
  grape: '#5e3a6e',
  eban: '#1a1410',
  ébano: '#1a1410',
  adocicado: '#c8a88f',
  prata: '#c0c0c0',
  silver: '#c0c0c0',
  ouro: '#e0b850',
  dourado: '#e0b850',
  gold: '#e0b850',
  cristal: '#f0f0f5',
};

const FALLBACK_HEX = '#9aa3ae';

function stripDiacritics(value: string): string {
  return value
    .replace(/[áàãâ]/g, 'a')
    .replace(/[éê]/g, 'e')
    .replace(/[íî]/g, 'i')
    .replace(/[óôõ]/g, 'o')
    .replace(/[úû]/g, 'u')
    .replace(/ç/g, 'c');
}

/** Hex da cor comercial; desconhecido → cinza neutro. */
export function resolveColorHex(name?: string | null): string {
  if (!name?.trim()) return FALLBACK_HEX;
  const norm = name.toLowerCase().trim();
  return COLOR_HEX_MAP[norm] || COLOR_HEX_MAP[stripDiacritics(norm)] || FALLBACK_HEX;
}
