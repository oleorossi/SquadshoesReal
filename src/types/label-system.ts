export interface LabelTemplate {
  id: string;
  name: string;
  category: 'individual_box' | 'master_box' | 'hangtag' | 'thermal' | 'shipping';
  type: 'thermal' | 'inkjet' | 'laser';
  dimensions: { width: number; height: number; unit: 'mm' | 'inches' };
  fields: LabelField[];
  print_settings: {
    dpi: number;
    color_mode: 'monochrome' | 'color';
    copies_default: number;
  };
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LabelField {
  id: string;
  name: string;
  type: 'text' | 'barcode' | 'qr_code' | 'image' | 'dynamic_text';
  position: { x: number; y: number; width: number; height: number };
  styling: {
    font_size: number;
    font_weight: 'normal' | 'bold';
    text_align: 'left' | 'center' | 'right';
    text_transform: 'none' | 'uppercase' | 'lowercase';
  };
  data_source: 'product_name' | 'sku' | 'order_number' | 'barcode' | 'color' | 'size' | 'date' | 'counter' | 'custom';
  default_value?: string;
  barcode_format?: 'CODE128' | 'EAN13' | 'QR';
}

export interface PrintJob {
  id: string;
  template_id: string;
  template_name: string;
  status: 'pending' | 'printing' | 'completed' | 'failed' | 'cancelled';
  total_labels: number;
  printed_labels: number;
  order_number?: string;
  reference?: string;
  created_at: string;
  completed_at?: string;
  error_message?: string;
}

export interface PrinterInfo {
  id: string;
  name: string;
  brand: string;
  model: string;
  status: 'online' | 'offline' | 'error' | 'busy';
  paper_level: number;
  jobs_in_queue: number;
  last_heartbeat: string;
}
