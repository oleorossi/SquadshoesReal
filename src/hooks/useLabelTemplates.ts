/**
 * Shared label templates store using localStorage for persistence.
 * Both LabelTemplatesTab and LabelProductionTab use this hook.
 */
import { useState, useCallback, useMemo } from 'react';
import { usePersistedState } from './usePersistedState';
import type { LabelTemplate } from '@/types/label-system';

export const BUILTIN_TEMPLATES: LabelTemplate[] = [
  // --- Squad Shoes defaults (hardcoded builders) ---
  {
    id: 'squad-thermal-default',
    name: 'Squad Shoes — Térmica Padrão',
    category: 'thermal',
    type: 'thermal',
    dimensions: { width: 100, height: 30, unit: 'mm' },
    fields: [
      { id: 'f1', name: 'Referência', type: 'text', position: { x: 26, y: 2, width: 48, height: 8 }, styling: { font_size: 11, font_weight: 'bold', text_align: 'left', text_transform: 'uppercase' }, data_source: 'product_name' },
      { id: 'f2', name: 'Cor', type: 'dynamic_text', position: { x: 26, y: 11, width: 48, height: 6 }, styling: { font_size: 6, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'color' },
      { id: 'f3', name: 'Material', type: 'dynamic_text', position: { x: 26, y: 18, width: 48, height: 5 }, styling: { font_size: 5, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'custom', default_value: 'Material' },
      { id: 'f4', name: 'Imagem', type: 'image', position: { x: 2, y: 2, width: 22, height: 20 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'custom' },
      { id: 'f5', name: 'Tamanho', type: 'dynamic_text', position: { x: 2, y: 22, width: 10, height: 6 }, styling: { font_size: 16, font_weight: 'bold', text_align: 'center', text_transform: 'none' }, data_source: 'size' },
      { id: 'f6', name: 'Código Barras', type: 'barcode', position: { x: 76, y: 2, width: 22, height: 26 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'barcode', barcode_format: 'CODE128' },
    ],
    print_settings: { dpi: 203, color_mode: 'monochrome', copies_default: 1 },
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'squad-box-default',
    name: 'Squad Shoes — Rótulo Caixa Padrão',
    category: 'master_box',
    type: 'thermal',
    dimensions: { width: 190, height: 138, unit: 'mm' },
    fields: [
      { id: 'b1', name: 'Cabeçalho', type: 'text', position: { x: 2, y: 2, width: 120, height: 12 }, styling: { font_size: 15, font_weight: 'bold', text_align: 'left', text_transform: 'uppercase' }, data_source: 'custom', default_value: 'SQUAD SHOES' },
      { id: 'b2', name: 'Código Barras', type: 'barcode', position: { x: 130, y: 2, width: 58, height: 12 }, styling: { font_size: 12, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'barcode', barcode_format: 'CODE128' },
      { id: 'b3', name: 'Imagem', type: 'image', position: { x: 2, y: 40, width: 45, height: 35 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'custom' },
      { id: 'b4', name: 'Modelo', type: 'dynamic_text', position: { x: 50, y: 40, width: 80, height: 10 }, styling: { font_size: 16, font_weight: 'bold', text_align: 'left', text_transform: 'uppercase' }, data_source: 'product_name' },
      { id: 'b5', name: 'Cor', type: 'dynamic_text', position: { x: 50, y: 52, width: 80, height: 8 }, styling: { font_size: 16, font_weight: 'bold', text_align: 'left', text_transform: 'none' }, data_source: 'color' },
      { id: 'b6', name: 'Grade', type: 'dynamic_text', position: { x: 2, y: 80, width: 186, height: 20 }, styling: { font_size: 13, font_weight: 'bold', text_align: 'center', text_transform: 'none' }, data_source: 'custom', default_value: 'Grade de tamanhos' },
      { id: 'b7', name: 'Remetente', type: 'text', position: { x: 2, y: 105, width: 90, height: 30 }, styling: { font_size: 10, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'custom', default_value: 'Remetente' },
      { id: 'b8', name: 'Destinatário', type: 'text', position: { x: 95, y: 105, width: 93, height: 30 }, styling: { font_size: 10, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'custom', default_value: 'Destinatário' },
    ],
    print_settings: { dpi: 203, color_mode: 'monochrome', copies_default: 1 },
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  // --- Other example templates ---
  {
    id: '1', name: 'Etiqueta Térmica 100x30', category: 'thermal', type: 'thermal',
    dimensions: { width: 100, height: 30, unit: 'mm' },
    fields: [
      { id: 'f1', name: 'Produto', type: 'text', position: { x: 20, y: 5, width: 50, height: 10 }, styling: { font_size: 10, font_weight: 'bold', text_align: 'left', text_transform: 'uppercase' }, data_source: 'product_name' },
      { id: 'f2', name: 'Cor/Tam', type: 'dynamic_text', position: { x: 20, y: 15, width: 40, height: 8 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'color' },
      { id: 'f3', name: 'Código', type: 'barcode', position: { x: 65, y: 3, width: 30, height: 24 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'barcode', barcode_format: 'CODE128' },
    ],
    print_settings: { dpi: 203, color_mode: 'monochrome', copies_default: 1 },
    is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: '2', name: 'Etiqueta Caixa Master', category: 'master_box', type: 'thermal',
    dimensions: { width: 100, height: 50, unit: 'mm' },
    fields: [
      { id: 'f1', name: 'Pedido', type: 'text', position: { x: 5, y: 5, width: 60, height: 10 }, styling: { font_size: 12, font_weight: 'bold', text_align: 'left', text_transform: 'uppercase' }, data_source: 'order_number' },
      { id: 'f2', name: 'Referência', type: 'text', position: { x: 5, y: 18, width: 60, height: 8 }, styling: { font_size: 9, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'product_name' },
      { id: 'f3', name: 'QR Code', type: 'qr_code', position: { x: 70, y: 5, width: 25, height: 25 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'barcode', barcode_format: 'QR' },
      { id: 'f4', name: 'Contador', type: 'dynamic_text', position: { x: 5, y: 35, width: 40, height: 8 }, styling: { font_size: 9, font_weight: 'bold', text_align: 'left', text_transform: 'none' }, data_source: 'counter' },
    ],
    print_settings: { dpi: 203, color_mode: 'monochrome', copies_default: 1 },
    is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: '3', name: 'Hangtag Produto', category: 'hangtag', type: 'inkjet',
    dimensions: { width: 50, height: 90, unit: 'mm' },
    fields: [
      { id: 'f1', name: 'Produto', type: 'text', position: { x: 5, y: 10, width: 40, height: 12 }, styling: { font_size: 11, font_weight: 'bold', text_align: 'center', text_transform: 'uppercase' }, data_source: 'product_name' },
      { id: 'f2', name: 'Tamanho', type: 'text', position: { x: 5, y: 30, width: 40, height: 20 }, styling: { font_size: 22, font_weight: 'bold', text_align: 'center', text_transform: 'none' }, data_source: 'size' },
      { id: 'f3', name: 'Código', type: 'barcode', position: { x: 5, y: 60, width: 40, height: 20 }, styling: { font_size: 7, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'barcode', barcode_format: 'EAN13' },
    ],
    print_settings: { dpi: 300, color_mode: 'color', copies_default: 1 },
    is_active: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'flexi_individual', name: 'Etiqueta Caixa Individual FlexiFootwear', category: 'individual_box', type: 'thermal',
    dimensions: { width: 80, height: 120, unit: 'mm' },
    fields: [
      { id: 'fl1', name: 'Logo', type: 'image', position: { x: 5, y: 5, width: 20, height: 15 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'custom', default_value: 'Logo' },
      { id: 'fl2', name: 'SKU', type: 'dynamic_text', position: { x: 50, y: 5, width: 25, height: 15 }, styling: { font_size: 16, font_weight: 'bold', text_align: 'center', text_transform: 'none' }, data_source: 'sku' },
      { id: 'fl3', name: 'Cor', type: 'dynamic_text', position: { x: 5, y: 42, width: 45, height: 8 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'color' },
      { id: 'fl4', name: 'Tamanho', type: 'dynamic_text', position: { x: 5, y: 80, width: 40, height: 20 }, styling: { font_size: 28, font_weight: 'bold', text_align: 'center', text_transform: 'none' }, data_source: 'size' },
      { id: 'fl5', name: 'EAN', type: 'barcode', position: { x: 60, y: 40, width: 15, height: 60 }, styling: { font_size: 6, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'barcode', barcode_format: 'EAN13' },
    ],
    print_settings: { dpi: 300, color_mode: 'monochrome', copies_default: 1 },
    is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'flexi_master', name: 'Etiqueta Caixa Master FlexiFootwear (Envio)', category: 'shipping', type: 'thermal',
    dimensions: { width: 150, height: 200, unit: 'mm' },
    fields: [
      { id: 'fm1', name: 'Logo', type: 'image', position: { x: 5, y: 5, width: 25, height: 15 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'custom', default_value: 'Logo' },
      { id: 'fm2', name: 'QR Rastreio', type: 'qr_code', position: { x: 120, y: 5, width: 25, height: 25 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'barcode', barcode_format: 'QR' },
      { id: 'fm3', name: 'Nº Remessa', type: 'dynamic_text', position: { x: 80, y: 35, width: 65, height: 10 }, styling: { font_size: 11, font_weight: 'bold', text_align: 'right', text_transform: 'none' }, data_source: 'order_number' },
      { id: 'fm4', name: 'SKU', type: 'dynamic_text', position: { x: 5, y: 75, width: 140, height: 12 }, styling: { font_size: 13, font_weight: 'bold', text_align: 'left', text_transform: 'none' }, data_source: 'sku' },
      { id: 'fm5', name: 'Grade', type: 'dynamic_text', position: { x: 5, y: 115, width: 140, height: 30 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'left', text_transform: 'none' }, data_source: 'custom', default_value: 'Grade' },
      { id: 'fm6', name: 'Código Rastreio', type: 'barcode', position: { x: 80, y: 165, width: 65, height: 20 }, styling: { font_size: 8, font_weight: 'normal', text_align: 'center', text_transform: 'none' }, data_source: 'barcode', barcode_format: 'CODE128' },
    ],
    print_settings: { dpi: 203, color_mode: 'monochrome', copies_default: 1 },
    is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
];

/** IDs of built-in Squad Shoes default templates that use the hardcoded HTML builders */
export const SQUAD_THERMAL_DEFAULT_ID = 'squad-thermal-default';
export const SQUAD_BOX_DEFAULT_ID = 'squad-box-default';

export function useLabelTemplates() {
  const [customTemplates, setCustomTemplates] = usePersistedState<LabelTemplate[]>('label-custom-templates', []);

  const allTemplates = useMemo(() => {
    // Merge built-in + custom, custom overrides by ID
    const customIds = new Set(customTemplates.map(t => t.id));
    const builtins = BUILTIN_TEMPLATES.filter(t => !customIds.has(t.id));
    return [...builtins, ...customTemplates];
  }, [customTemplates]);

  const addTemplate = useCallback((t: LabelTemplate) => {
    setCustomTemplates(prev => [...prev, t]);
  }, [setCustomTemplates]);

  const updateTemplate = useCallback((t: LabelTemplate) => {
    setCustomTemplates(prev => {
      const exists = prev.find(x => x.id === t.id);
      if (exists) return prev.map(x => x.id === t.id ? t : x);
      // If updating a built-in, add it as a custom override
      return [...prev, t];
    });
  }, [setCustomTemplates]);

  const deleteTemplate = useCallback((id: string) => {
    // Can't delete built-in templates
    if (BUILTIN_TEMPLATES.some(t => t.id === id)) return;
    setCustomTemplates(prev => prev.filter(t => t.id !== id));
  }, [setCustomTemplates]);

  const duplicateTemplate = useCallback((t: LabelTemplate) => {
    const copy: LabelTemplate = {
      ...t,
      id: crypto.randomUUID(),
      name: `${t.name} (cópia)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setCustomTemplates(prev => [...prev, copy]);
    return copy;
  }, [setCustomTemplates]);

  const getTemplatesByCategory = useCallback((category: string) => {
    return allTemplates.filter(t => t.category === category && t.is_active);
  }, [allTemplates]);

  const isBuiltinDefault = useCallback((id: string) => {
    return id === SQUAD_THERMAL_DEFAULT_ID || id === SQUAD_BOX_DEFAULT_ID;
  }, []);

  return {
    templates: allTemplates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    getTemplatesByCategory,
    isBuiltinDefault,
  };
}
