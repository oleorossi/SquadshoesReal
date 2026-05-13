import { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type Product = Tables<'products'>;
export type ProductInsert = TablesInsert<'products'>;
export type ProductUpdate = TablesUpdate<'products'>;

export type ProductFormData = {
  name: string;
  technical_name?: string;
  sku: string;
  category: string;
  color: string;
  quantity: number;
  min_stock: number;
  max_stock: number;
  unit: string;
  unit_price: number;
  price_wholesale?: number;
  price_retail?: number;
  location: string;
  group_id: string | null;
  active: boolean;
  image_url: string;
  min_stock_grade?: Record<string, number>;
  stock_grade?: Record<string, number>;
  yield_per_meter?: number | null;
  yield_unit?: string;
  dimensions_length?: number;
  dimensions_width?: number;
  dimensions_height?: number;
  dimensions_thickness?: number;
  dimensions_unit?: string;
  // Industrial conversion
  purchase_unit?: string;
  production_unit?: string;
  conversion_rate?: number;
  // Purchase order config
  purchase_order_unit?: string;
  min_order_quantity?: number;
  // Stock management
  reserved_stock?: number;
  safety_stock?: number;
  lead_time_days?: number;
  supplier_lead_time_days?: number;
  calculation_method?: 'weight' | 'meter' | 'unit';
  supplier_id?: string | null;
  // Lot tracking & chemical
  lot_number?: string | null;
  expiration_date?: string | null;
  is_chemical?: boolean;
  linked_last_id?: string | null;
  sole_material?: string | null;
  heel_height?: number | null;
   box_type_id?: string | null;
   consumption_unit?: string | null;
   is_standard_sole_item?: boolean;
 };

export const CATEGORIES = [
  'Cabedal',
  'Solado',
  'Palmilha',
  'Forração da Palmilha',
  'Componente',
  'Cola / Químico',
  'Ferramentas',
  'Fôrma',
] as const;

export const UNITS = ['g', 'kg', 'ml', 'L', 'mm', 'cm', 'm', 'dm²', 'm²', 'un', 'par', 'pc', 'cx', 'rolo', 'chapa', 'placa'] as const;

export const UNIT_LABELS: Record<string, string> = {
  g: 'Grama (g)',
  kg: 'Quilograma (kg)',
  ml: 'Mililitro (ml)',
  L: 'Litro (L)',
  mm: 'Milímetro (mm)',
  cm: 'Centímetro (cm)',
  m: 'Metro linear (m)',
  'dm²': 'Decímetro² (dm²)',
  'm²': 'Metro² (m²)',
  un: 'Unidade (un)',
  par: 'Par',
  pc: 'Pacote (pc)',
  cx: 'Caixa (cx)',
  rolo: 'Rolo',
  chapa: 'Chapa / Folha',
  placa: 'Placa',
};

export const LOCATIONS = ['Almoxarifado A', 'Almoxarifado B', 'Almoxarifado C', 'Prateleira', 'Linha de Produção', 'Expedição'] as const;

export interface ColorVariant {
  id: string;
  materialId: string;
  colorCode: string;
  colorName: string;
  hexCode: string;
  pantoneCode?: string;
  stock: number;
  price: number;
}

export interface SizeGrid {
  sizes: Record<string, number>;
  totalPairs: number;
}

export interface ProductMaster {
  id: string;
  name: string;
  category: string;
  main_image_url: string;
  technical_notes: string;
  dimensions_length: number;
  dimensions_width: number;
  yield_per_meter: number;
}

export interface ProductVariant {
  id: string;
  master_id: string;
  sku: string;
  color_name: string;
  color_hex: string;
  variant_image_url?: string;
  unit_price: number;
  quantity: number;
}

export interface ProductionOrder {
  id: string;
  op_number: string;
  variant: ProductVariant;
  master: ProductMaster;
  total_pairs: number;
  grid: Record<string, number>;
  due_date: string;
  status: 'FILA_CORTE' | 'CORTE' | 'AVIAMENTO' | 'MONTAGEM' | 'FINALIZADO';
  materials_reserved: boolean;
}

