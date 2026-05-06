-- Re-creating missing views for price history
DROP VIEW IF EXISTS public.v_supplier_price_history CASCADE;
CREATE OR REPLACE VIEW public.v_supplier_price_history WITH (security_invoker = true) AS
SELECT
  ii.product_id,
  ii.product_code,
  ii.product_name,
  ii.unit_price,
  ii.quantity,
  ii.unit          AS unit,
  i.supplier_id,
  s.name           AS supplier_name,
  i.invoice_number,
  i.issue_date,
  i.id             AS invoice_id
FROM public.invoice_items ii
JOIN public.invoices      i  ON i.id  = ii.invoice_id
LEFT JOIN public.suppliers s ON s.id  = i.supplier_id
WHERE ii.product_id IS NOT NULL
  AND i.issue_date  IS NOT NULL
ORDER BY i.issue_date DESC;

DROP VIEW IF EXISTS public.v_product_price_summary CASCADE;
CREATE OR REPLACE VIEW public.v_product_price_summary WITH (security_invoker = true) AS
SELECT
  product_id,
  product_name,
  supplier_id,
  supplier_name,
  COUNT(*)                                               AS purchase_count,
  MIN(unit_price)                                        AS min_price,
  MAX(unit_price)                                        AS max_price,
  AVG(unit_price)                                        AS avg_price,
  (ARRAY_AGG(unit_price ORDER BY issue_date DESC))[1]   AS latest_price,
  (ARRAY_AGG(unit_price ORDER BY issue_date DESC))[2]   AS previous_price,
  MAX(issue_date)                                        AS last_purchased
FROM public.v_supplier_price_history
GROUP BY product_id, product_name, supplier_id, supplier_name;