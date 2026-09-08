import { Footprints, Shield, Scissors, Drop as Droplets, Stack as Layers, Cube as Box } from '@phosphor-icons/react';
import type { SheetMaterialFormData } from '@/hooks/useTechnicalSheets';
import { normalizeForSearch } from '@/lib/searchUtils';

export const COMPONENT_CATEGORIES = [
  // === Base do Solado (padrão, independente de cor) ===
  { key: 'Solado', label: 'Solado', icon: Footprints, color: 'text-muted-foreground', aliases: ['solado'], section: 'base' },
  { key: 'Palmilha', label: 'Palmilha', icon: Shield, color: 'text-blue-600', aliases: ['palmilha', 'placa de palmilha'], section: 'base' },
  { key: 'Forração', label: 'Forração', icon: Scissors, color: 'text-purple-600', aliases: ['forro', 'forração', 'forração da palmilha'], section: 'base' },
  { key: 'Químico', label: 'Químicos', icon: Droplets, color: 'text-red-600', aliases: ['químico', 'quimico', 'cola', 'adesivo', 'hotmel', 'primer'], section: 'base' },
  // === Depende do Modelo ===
  { key: 'Cabedal', label: 'Cabedal', icon: Layers, color: 'text-amber-600', aliases: ['cabedal', 'napa', 'napa soft', 'couro', 'sintético', 'tecido', 'glow', 'metalic', 'velvet', 'tira', 'trança'], section: 'modelo' },
  { key: 'Componente', label: 'Componentes', icon: Box, color: 'text-pink-600', aliases: ['componente', 'componentes', 'acessório', 'acessorios', 'aviamento'], section: 'modelo' },
] as const;

export function matchCategory(productCategory: string): string {
  const lower = productCategory.toLowerCase().trim();
  for (const cat of COMPONENT_CATEGORIES) {
    if (cat.key.toLowerCase() === lower) return cat.key;
    if (cat.aliases.some(a => lower.includes(a) || a.includes(lower))) return cat.key;
  }
  return 'Outros';
}

export const emptyMaterialForm: SheetMaterialFormData = {
  product_id: '', group_id: null, quantity_per_unit: 0, consumption_per_size: {}, color: '', width: '', weight: '', supplier: '', notes: '', sizes: '', consumption_sector: '',
};

/** Sugestão inicial; a ficha sempre exige confirmação explícita do usuário. */
export function suggestedConsumptionSector(category?: string | null): string {
  const normalized = normalizeForSearch(category || '');
  if (/solado|sola/.test(normalized)) return 'Solagem';
  if (/embal|caixa|etiqueta|papel/.test(normalized)) return 'Acabamento';
  if (/cola|adesivo|primer|quimic/.test(normalized)) return 'Colagem';
  if (/linha|fio/.test(normalized)) return 'Costura Palmilha';
  if (/aviamento|acessorio|elast|ilh[oó]|fivela|rebite|fachete|contraforte|coura[cç]a|refor[cç]/.test(normalized)) return 'Aviamento';
  return '';
}
