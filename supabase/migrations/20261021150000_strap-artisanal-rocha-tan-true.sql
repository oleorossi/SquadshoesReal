-- "Tira chata 8mm": ROCHA e TAN estavam is_artisanal = false enquanto as outras
-- 6 cores do MESMO grupo (BEGE, CAPUCCINO, COBRE, COGUMELO, OFF WHITE, OURO
-- LIGHT) estavam true. Mesmo produto físico, modelo diferente por cor — era por
-- isso que ROCHA e TAN batiam entre compras e reserva e as demais divergiam.
-- Dono confirmou em 31/07/2026: a família inteira é artesanal.
UPDATE public.products p
   SET is_artisanal = true, updated_at = now()
  FROM public.product_groups g
 WHERE g.id = p.group_id
   AND g.name = 'Tira chata 8mm'
   AND coalesce(p.is_artisanal, false) = false;
