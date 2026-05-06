import { z } from 'zod';

export const productFormSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(255),
  technical_name: z.string().max(255).optional(),
  sku: z.string().max(50).optional(),
  category: z.string().min(1, 'Categoria é obrigatória'),
  color: z.string().max(100),
  quantity: z.number().min(0, 'Quantidade não pode ser negativa'),
  min_stock: z.number().min(0),
  max_stock: z.number().min(0),
  unit: z.string().min(1, 'Unidade é obrigatória'),
  unit_price: z.number().min(0, 'Preço não pode ser negativo'),
  location: z.string().max(100),
  group_id: z.string().uuid().nullable(),
  active: z.boolean(),
  image_url: z.string().max(500).optional(),
  yield_per_meter: z.number().nullable().optional(),
  yield_unit: z.string().optional(),
  dimensions_length: z.number().min(0).optional(),
  dimensions_width: z.number().min(0).optional(),
  dimensions_thickness: z.number().min(0).optional(),
  dimensions_unit: z.string().optional(),
});

export const orderFormSchema = z.object({
  reference_id: z.string().uuid('Referência é obrigatória'),
  quantity: z.number().positive('Quantidade deve ser maior que zero'),
  notes: z.string().max(1000).optional(),
  color: z.string().optional(),
  planned_start: z.string().optional(),
  planned_delivery: z.string().optional(),
  production_line: z.string().optional(),
  responsible: z.string().optional(),
});

export type ProductFormSchema = z.infer<typeof productFormSchema>;
export type OrderFormSchema = z.infer<typeof orderFormSchema>;
