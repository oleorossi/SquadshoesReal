CREATE OR REPLACE VIEW public.v_sector_load AS
 WITH pending_stages AS (
         SELECT pr.shoe_category,
            os.stage_name,
            sum(os.quantity_total - os.quantity_processed) AS pending_quantity
           FROM order_stages os
             JOIN orders o ON os.order_id = o.id
             LEFT JOIN product_references pr ON o.reference_id = pr.id
          WHERE os.status <> 'concluido'::text
          GROUP BY pr.shoe_category, os.stage_name
        )
 SELECT COALESCE(shoe_category, 'Geral'::text) AS shoe_category,
    sum(
        CASE
            WHEN stage_name IN ('Forração', 'Corte Forração') THEN pending_quantity
            ELSE 0::bigint
        END) AS load_corte_forracao,
    sum(
        CASE
            WHEN stage_name IN ('Corte', 'Corte Palmilha') THEN pending_quantity
            ELSE 0::bigint
        END) AS load_corte_palmilha,
    sum(
        CASE
            WHEN stage_name = 'Mesa'::text THEN pending_quantity
            ELSE 0::bigint
        END) AS load_mesa,
    sum(
        CASE
            WHEN stage_name = 'Silk'::text THEN pending_quantity
            ELSE 0::bigint
        END) AS load_silk,
    sum(
        CASE
            WHEN stage_name = 'Colagem'::text THEN pending_quantity
            ELSE 0::bigint
        END) AS load_colagem,
    sum(
        CASE
            WHEN stage_name = 'Montagem'::text THEN pending_quantity
            ELSE 0::bigint
        END) AS load_montagem,
    sum(
        CASE
            WHEN stage_name = 'Solagem'::text THEN pending_quantity
            ELSE 0::bigint
        END) AS load_solagem,
    sum(
        CASE
            WHEN stage_name = 'Acabamento'::text THEN pending_quantity
            ELSE 0::bigint
        END) AS load_acabamento
   FROM pending_stages
  GROUP BY shoe_category;