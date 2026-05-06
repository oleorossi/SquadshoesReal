
-- Fix FK constraints on products to allow deletion (SET NULL for nullable, CASCADE for required)
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_product_id_fkey;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_product_id_fkey;
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE component_sheets DROP CONSTRAINT IF EXISTS component_sheets_product_id_fkey;
ALTER TABLE component_sheets ADD CONSTRAINT component_sheets_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE reference_materials DROP CONSTRAINT IF EXISTS reference_materials_product_id_fkey;
ALTER TABLE reference_materials ADD CONSTRAINT reference_materials_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE production_consumptions DROP CONSTRAINT IF EXISTS production_consumptions_product_id_fkey;
ALTER TABLE production_consumptions ADD CONSTRAINT production_consumptions_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_product_id_fkey;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE material_audit_log DROP CONSTRAINT IF EXISTS material_audit_log_product_id_fkey;
ALTER TABLE material_audit_log ADD CONSTRAINT material_audit_log_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_packaging_product_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_packaging_product_id_fkey 
  FOREIGN KEY (packaging_product_id) REFERENCES products(id) ON DELETE SET NULL;
