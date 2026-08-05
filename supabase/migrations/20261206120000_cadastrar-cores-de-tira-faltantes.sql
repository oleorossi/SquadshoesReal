-- Cria as 6 cores de tira que os PVs pediam e o cadastro não tinha.
--
-- DECISÃO DO DONO (05/08/2026): DALIA, PICOLE, COBRE, ROSE e NUDE "são cores de
-- verdade". Isso define o LADO do conserto e é o oposto do caso da tira de strass
-- (migration 20261204120000): lá o PV gravava o nome comercial de uma tira COMPRADA
-- PRONTA e o cadastro é que estava com a cor errada, então a correção foi mudar
-- `products.color`. Aqui a tira é CORTADA AQUI (`is_artisanal = true`), a cor é
-- legítima, o PV está certo — e o que falta é o produto existir no grupo.
--
-- ⚠ NÃO confundir os dois casos ao mexer em tira: a pergunta é "o texto no PV é uma
-- COR ou o NOME COMERCIAL de um item comprado?". A resposta decide se se corrige o
-- produto ou se se cria um.
--
-- O QUE ESTAVA QUEBRADO
-- 15 itens de PV resolviam para NENHUM produto em `order_strap_needs` (a resolução é
-- por `group_id` + `products.color`), logo sem reserva, sem débito e fora de compra:
--     TIRA CHATA COSTURADA 11MM → COBRE (4 itens), DALIA (5), NUDE (1), PICOLE (4), ROSE (1)
--     TIRA OVERLOCK 5MM         → PICOLE (4)
-- Os PVs afetados (PV-2026-00049/00052/00084/00089/00090/00091) estão todos FATURADOS,
-- então isto NÃO recalcula nada retroativo — só torna o histórico consistente e faz as
-- próximas consultas resolverem.
--
-- POR QUE SÓ PICOLE É REALMENTE NOVA
-- COBRE, DALIA, NUDE e ROSE JÁ EXISTEM no TIRA OVERLOCK 5MM; faltavam apenas no
-- TIRA CHATA COSTURADA 11MM. PICOLE não existia em grupo nenhum (verificado). Ou seja,
-- o buraco é de cadastro incompleto por grupo, não de cor inventada.
--
-- ATRIBUTOS — copiados do padrão DOMINANTE de cada grupo, não arbitrados:
--   unit_price 0.85 → 8 de 10 produtos do 11MM e 18 de 24 do OVERLOCK
--   min_stock  50   → mesma dominância nos dois grupos
--   unit 'm', is_artisanal true, category 'Componente', quantity 0
-- ⚠ `quantity = 0` é o valor HONESTO: ninguém contou esse estoque. Isso faz os 6
-- aparecerem no card "Estoque Crítico" — correto, e já é o caso de vários irmãos do
-- mesmo grupo (BEGE, OFF WHITE, PRETO... todos zerados).
--
-- SEGURANÇA — verificado antes de aplicar:
--   - `trg_auto_purchase_order` é trigger de UPDATE apenas → INSERT não abre OC. E um
--     UPDATE futuro também não abre, porque a condição exige a TRANSIÇÃO de acima pra
--     abaixo do mínimo (`OLD.quantity > OLD.min_stock`), falsa partindo de 0.
--   - ambos os grupos são FOLHA → `tg_guard_product_group_is_leaf` não barra.
--   - `products_sku_key` é UNIQUE e os 6 SKUs abaixo estão livres.
--   - `tg_products_auto_category` deriva a categoria do setor do grupo; mesmo assim
--     `category` vai explícita porque é NOT NULL sem default.
--
-- O prefixo `TIRACH-PRET-` do 11MM é herança: ele aparece em TODOS os SKUs do grupo,
-- inclusive nos que não são pretos. Mantido pra não criar uma segunda convenção no
-- mesmo grupo — não é erro de digitação aqui.

BEGIN;

INSERT INTO public.products
  (sku, name, color, group_id, category, unit, quantity, unit_price, min_stock, is_artisanal, active)
VALUES
  -- TIRA CHATA COSTURADA 11MM (87b706a8-40ba-4019-9aee-b2f80ef81212)
  ('TIRACH-PRET-COBR', 'Tira chata Costurada 11mm', 'COBRE',
   '87b706a8-40ba-4019-9aee-b2f80ef81212', 'Componente', 'm', 0, 0.85, 50, true, true),
  ('TIRACH-PRET-DALI', 'Tira chata Costurada 11mm', 'DALIA',
   '87b706a8-40ba-4019-9aee-b2f80ef81212', 'Componente', 'm', 0, 0.85, 50, true, true),
  ('TIRACH-PRET-NUDE', 'Tira chata Costurada 11mm', 'NUDE',
   '87b706a8-40ba-4019-9aee-b2f80ef81212', 'Componente', 'm', 0, 0.85, 50, true, true),
  ('TIRACH-PRET-PICO', 'Tira chata Costurada 11mm', 'PICOLE',
   '87b706a8-40ba-4019-9aee-b2f80ef81212', 'Componente', 'm', 0, 0.85, 50, true, true),
  ('TIRACH-PRET-ROSE', 'Tira chata Costurada 11mm', 'ROSE',
   '87b706a8-40ba-4019-9aee-b2f80ef81212', 'Componente', 'm', 0, 0.85, 50, true, true),
  -- TIRA OVERLOCK 5MM (e0301b34-7963-448d-a12a-33a897439282) — só PICOLE faltava
  ('TIRAOVL-PICO', 'Tira Overlock 5mm', 'PICOLE',
   'e0301b34-7963-448d-a12a-33a897439282', 'Componente', 'm', 0, 0.85, 50, true, true);

-- ── Verificação: falha a migration se não zerou os órfãos ────────────────────
DO $$
DECLARE
  v_orfaos_grupos int;
  v_orfaos_total  int;
  v_criados       int;
BEGIN
  SELECT count(*) INTO v_criados FROM public.products
   WHERE sku IN ('TIRACH-PRET-COBR','TIRACH-PRET-DALI','TIRACH-PRET-NUDE',
                 'TIRACH-PRET-PICO','TIRACH-PRET-ROSE','TIRAOVL-PICO');
  IF v_criados <> 6 THEN
    RAISE EXCEPTION 'Esperava 6 produtos criados, encontrei %', v_criados;
  END IF;

  -- nenhuma cor pedida NESTES dois grupos pode continuar órfã
  SELECT count(*) INTO v_orfaos_grupos FROM (
    SELECT DISTINCT (s->>'group_id')::uuid AS gid, upper(trim(s->>'color')) AS cor
      FROM public.sale_order_items soi
      CROSS JOIN LATERAL jsonb_array_elements(soi.strap_colors) s
     WHERE soi.strap_colors IS NOT NULL
       AND jsonb_typeof(soi.strap_colors) = 'array'
       AND coalesce(s->>'color','') <> ''
       AND (s->>'group_id')::uuid IN ('87b706a8-40ba-4019-9aee-b2f80ef81212',
                                      'e0301b34-7963-448d-a12a-33a897439282')
  ) pedidas
  WHERE NOT EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.group_id = pedidas.gid
       AND p.active IS NOT FALSE
       AND upper(trim(coalesce(p.color,''))) = pedidas.cor);
  IF v_orfaos_grupos > 0 THEN
    RAISE EXCEPTION 'Restaram % cor(es) órfã(s) nos grupos de tira chata/overlock', v_orfaos_grupos;
  END IF;

  -- e o total geral do sistema tem que estar zerado (era 62 em 05/08/2026)
  SELECT count(*) INTO v_orfaos_total FROM (
    SELECT soi.id FROM public.sale_order_items soi
      CROSS JOIN LATERAL jsonb_array_elements(soi.strap_colors) s
     WHERE soi.strap_colors IS NOT NULL
       AND jsonb_typeof(soi.strap_colors) = 'array'
       AND coalesce(s->>'color','') <> ''
       AND coalesce(s->>'group_id','') <> ''
       AND NOT EXISTS (
         SELECT 1 FROM public.products p
          WHERE p.group_id = (s->>'group_id')::uuid
            AND p.active IS NOT FALSE
            AND upper(trim(coalesce(p.color,''))) = upper(trim(s->>'color')))
     GROUP BY soi.id) t;
  IF v_orfaos_total > 0 THEN
    RAISE EXCEPTION 'Ainda há % item(ns) de PV com tira órfã no sistema', v_orfaos_total;
  END IF;
END $$;

COMMIT;
