-- Auditoria 2026-06-09 (suspeita confirmada): 93 produtos com
-- purchase_order_unit divergente de purchase_unit (legado pré-sync do
-- ProductFormDialog) — o gerador de OC do MRP usa purchase_order_unit e o
-- recebimento usa purchase_unit → OC emitida em unidade errada ('un' pra
-- material comprado em metros; grafias proibidas 'metro'/'chapa').
-- Fonte única = purchase_unit (sincronizado pelo form atual).
UPDATE public.products
   SET purchase_order_unit = purchase_unit
 WHERE COALESCE(purchase_unit,'') <> ''
   AND COALESCE(purchase_order_unit,'') <> COALESCE(purchase_unit,'');
