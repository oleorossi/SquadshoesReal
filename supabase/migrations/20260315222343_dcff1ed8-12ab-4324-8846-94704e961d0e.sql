
-- Fix: Allow product deletion by setting product_id to NULL in audit log
ALTER TABLE public.material_audit_log DROP CONSTRAINT material_audit_log_product_id_fkey;
ALTER TABLE public.material_audit_log ADD CONSTRAINT material_audit_log_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
