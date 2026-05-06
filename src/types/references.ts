export type ProductReference = {
  id: string;
  name: string;
  description: string;
  code: string;
  collection: string;
  shoe_category: string;
  sizes: string;
  colors: string;
  cost_price: number;
  sale_price: number;
  status: string;
  image_url: string;
  created_at: string;
  updated_at: string;
};

export type ReferenceMaterial = {
  id: string;
  reference_id: string;
  product_id: string;
  quantity_per_unit: number;
  color: string;
  width: string;
  weight: string;
  supplier: string;
  notes: string;
  created_at: string;
  products?: {
    name: string;
    unit: string;
    sku: string;
    category: string;
    unit_price: number;
    quantity: number;
  };
};

export type Order = {
  id: string;
  reference_id: string;
  quantity: number;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
  technical_sheets?: {
    name: string;
  };
};

export type StockMovement = {
  id: string;
  product_id: string;
  order_id: string | null;
  movement_type: string;
  quantity: number;
  previous_stock: number;
  new_stock: number;
  description: string;
  created_at: string;
  products?: {
    name: string;
    sku: string;
    unit: string;
  };
};

export type StrapColor = {
  id: string;
  label: string;
  color: string;
};

export type ReferenceFormData = {
  name: string;
  description: string;
  code: string;
  collection: string;
  shoe_category: string;
  sizes: string;
  colors: string;
  cost_price: number;
  sale_price: number;
  status: string;
  image_url: string;
  technical_sheet_id: string;
  has_straps: boolean;
  strap_colors: StrapColor[];
};

export type MaterialFormData = {
  product_id: string;
  quantity_per_unit: number;
  color: string;
  width: string;
  weight: string;
  supplier: string;
  notes: string;
  sizes: string;
};

export type OrderFormData = {
  reference_id: string;
  quantity: number;
  notes: string;
};
