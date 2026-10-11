-- tira_material_modelo_20270101035800
--
-- Fase 1 (ADITIVA) de specs/tira-material-de-estoque.md — decisão do dono em
-- 11/10/2026: a tira vira material de estoque como o solado. Esta migration só
-- ACRESCENTA estrutura e preenche valores que o motor antigo de tira (Hub) não lê;
-- nada do que roda hoje muda de comportamento. A virada (writer novo, motor de
-- empenho com tira, separação dos grupos mistos, fichas) vem numa migration
-- própria, aplicada junto com a migração dos PVs abertos (R23/R24).
--
-- O que entra:
--   1. product_groups: origem, mão de obra do prestador (R$/m), prestador padrão e
--      "usa napa" — o grupo de estoque passa a ser o cadastro da tira (R3).
--   2. strap_group_napa_yields: rendimento (m de tira por m de napa) por napa-base,
--      editado só pela janela do grupo / Ateliê (R3, R18).
--   3. products.strap_base_group_id: a napa-base do SKU de tira — parte da chave
--      (grupo + napa + cor), R2. NULL = SKU sem napa (strass, ou SKU antigo de antes
--      do Hub, que vira RESERVA da cor — R7a).
--   4. Os dois grupos que faltam para "um grupo = um tipo de tira" (R1): ELÁSTICO
--      FORRADO 7MM e OVERLOCK REDONDA 6MM — criados VAZIOS aqui; a virada move SKUs
--      e linhas de ficha para eles.
--   5. Backfill de origem, R$/m, prestador e rendimento a partir do catálogo antigo
--      (R22), e da napa de cada SKU a partir das variantes (R2).
--   6. Dados pontuais R31 (SKU legado STRASS OFF WHITE inativo) e R32 (ficha
--      dee92bd6 passa ao código NL01).

-- O guard do motor antigo (tg_guard_legacy_artisanal_product_writer e irmãos)
-- só deixa escrever em produto/grupo de tira com este token transacional.
SELECT set_config('app.artisanal_strap_catalog_write', '1', true);

-- ── 1. Cadastro da tira no grupo de estoque ────────────────────────────────
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS strap_origin text,
  ADD COLUMN IF NOT EXISTS strap_labor_cost_per_m numeric,
  ADD COLUMN IF NOT EXISTS strap_default_contractor_id uuid
    REFERENCES public.contractors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS strap_uses_napa boolean NOT NULL DEFAULT true;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_groups_strap_origin_check') THEN
    ALTER TABLE public.product_groups
      ADD CONSTRAINT product_groups_strap_origin_check
      CHECK (strap_origin IS NULL OR strap_origin IN ('comprar_pronto', 'fabrica', 'prestador'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_groups_strap_labor_cost_check') THEN
    ALTER TABLE public.product_groups
      ADD CONSTRAINT product_groups_strap_labor_cost_check
      CHECK (strap_labor_cost_per_m IS NULL OR strap_labor_cost_per_m >= 0);
  END IF;
END
$chk$;

COMMENT ON COLUMN public.product_groups.strap_origin IS
  'Tira (is_artisanal_strap): destino da FALTA do PV. comprar_pronto = compra; fabrica = Ateliê "Produzido"; prestador = Ateliê OC da napa + OS. NULL = trata como comprar_pronto com aviso.';
COMMENT ON COLUMN public.product_groups.strap_labor_cost_per_m IS
  'Tira de prestador: mão de obra em R$ por metro de tira (preço da OS).';
COMMENT ON COLUMN public.product_groups.strap_default_contractor_id IS
  'Tira de prestador: prestador padrão da OS gerada pelo Ateliê (trocável na OS em rascunho).';
COMMENT ON COLUMN public.product_groups.strap_uses_napa IS
  'Tira feita de napa-base (chave do SKU = grupo + napa + cor). false = sem napa (strass): chave = grupo + cor.';

-- ── 2. Rendimento por napa-base ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.strap_group_napa_yields (
  strap_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  napa_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  yield_m_per_m numeric NOT NULL CHECK (yield_m_per_m > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (strap_group_id, napa_group_id)
);

COMMENT ON TABLE public.strap_group_napa_yields IS
  'Rendimento da tira: metros de tira por metro de napa-base. Digitado à mão na janela do grupo (ou no Ateliê). Sem linha = "informe o rendimento" (R18).';

ALTER TABLE public.strap_group_napa_yields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strap_group_napa_yields_select ON public.strap_group_napa_yields;
CREATE POLICY strap_group_napa_yields_select ON public.strap_group_napa_yields
  FOR SELECT TO authenticated USING (public.is_approved_user());

DROP POLICY IF EXISTS strap_group_napa_yields_write ON public.strap_group_napa_yields;
CREATE POLICY strap_group_napa_yields_write ON public.strap_group_napa_yields
  FOR ALL TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (public.user_has_any_role(ARRAY['admin', 'gerente']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strap_group_napa_yields TO authenticated;

-- O Ateliê (produção) também digita o rendimento quando falta (R18) — pela RPC.
CREATE OR REPLACE FUNCTION public.set_strap_group_napa_yield(
  p_strap_group_id uuid,
  p_napa_group_id uuid,
  p_yield_m_per_m numeric
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao']) THEN
    RAISE EXCEPTION 'Somente Gerência/Produção pode informar o rendimento da tira'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.id = p_strap_group_id AND coalesce(g.is_artisanal_strap, false)
  ) THEN
    RAISE EXCEPTION 'Grupo informado não é um grupo de tira';
  END IF;
  IF p_napa_group_id IS NULL THEN
    RAISE EXCEPTION 'Informe a napa-base do rendimento';
  END IF;
  IF p_yield_m_per_m IS NULL THEN
    DELETE FROM public.strap_group_napa_yields
     WHERE strap_group_id = p_strap_group_id AND napa_group_id = p_napa_group_id;
    RETURN;
  END IF;
  IF p_yield_m_per_m <= 0 THEN
    RAISE EXCEPTION 'Rendimento deve ser maior que zero (metros de tira por metro de napa)';
  END IF;
  INSERT INTO public.strap_group_napa_yields (strap_group_id, napa_group_id, yield_m_per_m, updated_at, updated_by)
  VALUES (p_strap_group_id, p_napa_group_id, p_yield_m_per_m, now(), auth.uid())
  ON CONFLICT (strap_group_id, napa_group_id)
  DO UPDATE SET yield_m_per_m = EXCLUDED.yield_m_per_m, updated_at = now(), updated_by = auth.uid();
END;
$function$;

REVOKE ALL ON FUNCTION public.set_strap_group_napa_yield(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_strap_group_napa_yield(uuid, uuid, numeric) TO authenticated;

-- ── 3. Napa-base do SKU de tira ─────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS strap_base_group_id uuid
    REFERENCES public.product_groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.products.strap_base_group_id IS
  'SKU de tira: napa-base de que a tira é feita (chave grupo + napa + cor, R2). NULL = sem napa (strass, ou SKU antigo — reserva da cor, R7a).';

CREATE INDEX IF NOT EXISTS idx_products_strap_key
  ON public.products (group_id, strap_base_group_id)
  WHERE active;

-- ── 4. Grupos que faltam (um grupo = um tipo de tira) ───────────────────────
INSERT INTO public.product_groups (name, sector, is_artisanal_strap, consumption_unit, description)
SELECT v.name, 'Material Base', true, 'm', v.description
  FROM (VALUES
    ('ELÁSTICO FORRADO 7MM', 'Tira de 7 mm, separada de "Tira chata 8mm" (grupo misto) — spec tira-material-de-estoque R21.'),
    ('OVERLOCK REDONDA 6MM', 'Tira overlock redonda de 6 mm — antes só existia como medida do Hub, sem grupo de estoque.')
  ) AS v(name, description)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.product_groups g WHERE lower(trim(g.name)) = lower(trim(v.name))
 );

-- ── 5. Backfill a partir do catálogo antigo (R22) ───────────────────────────
-- Mapa medida do Hub → grupo de estoque. Explícito (sem adivinhar por nome).
CREATE TEMP TABLE _strap_measure_group ON COMMIT DROP AS
SELECT m.measure_id::uuid, g.id AS group_id
  FROM (VALUES
    ('69c30596-c428-459b-ad93-128814c8b277', '4d3943d7-adbb-4523-a1ec-f8ae003bea8b'), -- MEIA CANA 10 → Meia Cana 10mm
    ('2c84a703-851c-4c56-8a72-4615d3d1fa05', 'c759eb08-00f1-448a-aeba-4693a967be4f'), -- TIRA CHATA 25 → Tira chata 25mm
    ('0166b326-2023-4427-a165-aada45ee5611', 'a657390e-1c4f-469b-ac48-8e45b2b8d3c0'), -- TIRA CHATA 8 → Tira chata 8mm
    ('65628af5-8cb3-419a-8c54-3e2ac474ee5e', '87b706a8-40ba-4019-9aee-b2f80ef81212'), -- COSTURADA 11 → COSTURADA 11MM
    ('06500a23-801d-4627-a927-3ce7e5ee2619', 'e0301b34-7963-448d-a12a-33a897439282'), -- OVERLOCK 5 → OVERLOCK 5MM
    ('a487b85e-8e3d-4091-9932-41205836b5c0', '6e43bbda-0f1f-412c-8d4a-ec009114530d'), -- STRASS 15 → STRASS 15MM
    ('00f07325-347b-4e65-90e6-fed33f70eacc', 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d'), -- STRASS 6 → STRASS 6MM
    ('ea0c68b9-2911-4477-bf1b-206661e6c745', '2fbed979-a191-46e2-908c-5e02a0df4f3c')  -- TRANÇA 3 → TRANÇA
  ) AS m(measure_id, group_id)
  JOIN public.product_groups g ON g.id = m.group_id::uuid
UNION ALL
SELECT '9292a467-992e-4097-8dd5-5fb2f94abb15'::uuid, g.id
  FROM public.product_groups g WHERE g.name = 'ELÁSTICO FORRADO 7MM'
UNION ALL
SELECT '60242fca-662a-4c24-9ff6-407c9fc3bab0'::uuid, g.id
  FROM public.product_groups g WHERE g.name = 'OVERLOCK REDONDA 6MM';

-- Origem e mão de obra: medida → grupo. Nunca sobrescreve o que já foi cadastrado.
UPDATE public.product_groups g
   SET strap_origin = coalesce(g.strap_origin, CASE m.origem_padrao
         WHEN 'sempre_sku_acabado' THEN 'comprar_pronto'
         WHEN 'sempre_fabrica' THEN 'fabrica'
         ELSE 'prestador'
       END),
       strap_labor_cost_per_m = coalesce(
         g.strap_labor_cost_per_m,
         m.preco_prestador_per_m,
         (SELECT max(r.transformation_cost_per_m)
            FROM public.artisanal_strap_recipes r
           WHERE r.measure_id = m.id AND r.status = 'approved'
             AND r.transformation_cost_per_m > 0),
         m.preco_artesanal_per_m
       ),
       strap_default_contractor_id = coalesce(
         g.strap_default_contractor_id,
         (SELECT CASE WHEN count(DISTINCT r.default_contractor_id) = 1
                      THEN (array_agg(r.default_contractor_id))[1] END
            FROM public.artisanal_strap_recipes r
           WHERE r.measure_id = m.id AND r.status = 'approved'
             AND r.default_contractor_id IS NOT NULL)
       )
  FROM _strap_measure_group map
  JOIN public.artisanal_strap_measures m ON m.id = map.measure_id
 WHERE g.id = map.group_id;

-- Strass não é feito de napa.
UPDATE public.product_groups
   SET strap_uses_napa = false
 WHERE id IN ('c45ff936-5ac5-49b5-98c4-4aed5e10e82d', '6e43bbda-0f1f-412c-8d4a-ec009114530d');

-- Rendimento confirmado das receitas aprovadas vigentes (R22). Ausente fica vazio (R18).
INSERT INTO public.strap_group_napa_yields (strap_group_id, napa_group_id, yield_m_per_m)
SELECT DISTINCT ON (map.group_id, r.base_group_id)
       map.group_id, r.base_group_id, r.confirmed_yield_m_per_m
  FROM public.artisanal_strap_recipes r
  JOIN _strap_measure_group map ON map.measure_id = r.measure_id
  JOIN public.product_groups g ON g.id = map.group_id AND g.strap_uses_napa
 WHERE r.status = 'approved'
   AND r.valid_from <= now()
   AND (r.valid_to IS NULL OR r.valid_to > now())
   AND r.confirmed_yield_m_per_m > 0
   AND r.base_group_id IS NOT NULL
 ORDER BY map.group_id, r.base_group_id, r.valid_from DESC
ON CONFLICT (strap_group_id, napa_group_id) DO NOTHING;

-- Napa-base de cada SKU de tira, pela variante do Hub (reference_base).
UPDATE public.products p
   SET strap_base_group_id = v.base_group_id
  FROM public.artisanal_strap_variants v
 WHERE v.finished_product_id = p.id
   AND v.identity_basis = 'reference_base'
   AND v.base_group_id IS NOT NULL
   AND p.strap_base_group_id IS NULL;

-- ── 6. Dados pontuais ───────────────────────────────────────────────────────
-- R31: o strass "OFF WHITE" É o CRISTAL COM FUNDO BRANCO (decisão do dono). SKU
-- legado sem estoque, movimento ou reserva aberta — histórico intacto.
UPDATE public.products
   SET active = false, updated_at = now()
 WHERE id = '4a60b9c5-eacd-4cd8-82de-b8176ee217b2'
   AND active;

-- R32: a ficha de nome NL01 estava com o código NL02 (duas fichas "NL02").
UPDATE public.technical_sheets
   SET code = 'NL01'
 WHERE id = 'dee92bd6-643d-4651-818e-f2a75cfabf13'
   AND code = 'NL02';
