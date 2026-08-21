-- =============================================================================
-- Napa nova herda o rendimento de uma napa de MESMA largura util
-- =============================================================================
-- Sintoma (20/08/2026): montar PV com tira interna em GLOW METALIC parava em
--
--   'Nao existe conversao aprovada para TIRA OVERLOCK 5 mm em GLOW METALIC;
--    cadastre o rendimento (m de tira por m de napa) no Hub de Tiras antes do PV'
--
-- e o pedido inteiro nao salvava. A migration 20270101006300 tinha acabado de
-- resolver o passo anterior (perfil de largura) e registrou que o rendimento
-- "continua sendo dado de engenharia do dono e NAO e inventado aqui".
--
-- Decisao do dono (21/08/2026), depois de ver os numeros: napa nova deve HERDAR
-- de uma napa de mesma largura util, copiando o rendimento CONFIRMADO. Isso
-- atribui a napa nova uma perda que ninguem mediu nela (SUDANI: 61 m/m contra
-- 68 teoricos, 10,3% de perda) — atribuicao aceita explicitamente, e por isso
-- gravada em `review_reason` linha a linha, para engenharia poder revisar.
--
-- ⚠ Herdar NAO e adivinhar. So materializa quando os doadores de mesma largura
-- concordam integralmente. Os proprios dados ja mostram que largura igual NAO
-- implica rendimento igual: TIRA CHATA 8 mm tem dois doadores a 1370 mm com
-- faixa de corte 18 mm (NAPA SOFT) e 20 mm (NAPA SUDANI). Nesse caso a funcao
-- devolve NULL e o bloqueio do PV continua — que e o comportamento correto.
--
-- Alcance medido antes de aplicar: 2 receitas herdadas (GLOW METALIC e NAPA
-- SOFT, ambas TIRA OVERLOCK 5 mm, doador unico NAPA SUDANI), 1 par ambiguo
-- recusado e 15 combinacoes sem doador nenhum, intocadas.

BEGIN;

-- Herda a receita de (medida, napa) a partir de uma napa de largura util
-- IDENTICA. Devolve o id da receita vigente (existente ou recem-criada), ou
-- NULL quando nao ha doador ou quando os doadores divergem.
CREATE OR REPLACE FUNCTION public.inherit_strap_recipe_from_peer(
  p_measure_id uuid,
  p_base_group_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_profile public.base_material_width_profiles%ROWTYPE;
  v_donor record;
  v_donor_count integer;
  v_combo_count integer;
  v_donor_names text;
  v_new_id uuid;
BEGIN
  -- Receita vigente ganha de qualquer heranca: nunca sobrescreve cadastro real.
  SELECT r.id INTO v_existing_id
    FROM public.artisanal_strap_recipes r
   WHERE r.measure_id = p_measure_id
     AND r.base_group_id = p_base_group_id
     AND r.status = 'approved'
     AND r.valid_from <= now()
     AND (r.valid_to IS NULL OR r.valid_to > now())
   LIMIT 1;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  SELECT * INTO v_profile
    FROM public.base_material_width_profiles w
   WHERE w.base_group_id = p_base_group_id
     AND w.status = 'approved'
     AND w.valid_to IS NULL
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Doadores: receitas vigentes da MESMA medida, em outra napa cujo perfil
  -- vigente tem exatamente a mesma largura util.
  SELECT count(*),
         -- O teorico e derivado de (largura, faixa) e a largura ja e igual por
         -- construcao, entao comparar a faixa basta — nao entra aqui.
         count(DISTINCT (
           r.cut_band_width_mm, r.confirmed_yield_m_per_m, r.executor_type,
           r.default_contractor_id, r.transformation_cost_per_m
         )),
         string_agg(DISTINCT g.name, ', ' ORDER BY g.name)
    INTO v_donor_count, v_combo_count, v_donor_names
    FROM public.artisanal_strap_recipes r
    JOIN public.base_material_width_profiles w ON w.id = r.base_width_profile_id
    JOIN public.product_groups g ON g.id = r.base_group_id
   WHERE r.measure_id = p_measure_id
     AND r.base_group_id <> p_base_group_id
     AND r.status = 'approved'
     AND r.valid_from <= now()
     AND (r.valid_to IS NULL OR r.valid_to > now())
     AND w.status = 'approved'
     AND w.valid_to IS NULL
     AND abs(w.usable_width_mm - v_profile.usable_width_mm) <= 0.000001;

  -- Zero doador = nada a herdar. Mais de um COMBO distinto = os doadores
  -- discordam; escolher um seria inventar engenharia (ver TIRA CHATA 8 mm).
  IF coalesce(v_donor_count, 0) = 0 OR coalesce(v_combo_count, 0) <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT r.*, g.name AS donor_group_name INTO v_donor
    FROM public.artisanal_strap_recipes r
    JOIN public.base_material_width_profiles w ON w.id = r.base_width_profile_id
    JOIN public.product_groups g ON g.id = r.base_group_id
   WHERE r.measure_id = p_measure_id
     AND r.base_group_id <> p_base_group_id
     AND r.status = 'approved'
     AND r.valid_from <= now()
     AND (r.valid_to IS NULL OR r.valid_to > now())
     AND w.status = 'approved'
     AND w.valid_to IS NULL
     AND abs(w.usable_width_mm - v_profile.usable_width_mm) <= 0.000001
   ORDER BY r.approved_at NULLS LAST, r.created_at
   LIMIT 1;

  -- ⚠ `theoretical_yield_m_per_m` NAO entra no INSERT: e coluna GERADA
  -- (largura util / faixa de corte). O banco ja sabia que o teorico e
  -- aritmetica — o que se herda de verdade e o CONFIRMADO, que e a perda
  -- medida no chao e nao se deduz de nada.
  INSERT INTO public.artisanal_strap_recipes (
    measure_id, base_group_id, base_width_profile_id, version,
    usable_base_width_mm_snapshot, cut_band_width_mm,
    confirmed_yield_m_per_m,
    executor_type, default_contractor_id, transformation_cost_per_m,
    status, valid_from, approved_by, approved_at, review_reason
  ) VALUES (
    p_measure_id, p_base_group_id, v_profile.id,
    coalesce((SELECT max(r2.version) FROM public.artisanal_strap_recipes r2
               WHERE r2.measure_id = p_measure_id
                 AND r2.base_group_id = p_base_group_id), 0) + 1,
    v_profile.usable_width_mm, v_donor.cut_band_width_mm,
    v_donor.confirmed_yield_m_per_m,
    v_donor.executor_type, v_donor.default_contractor_id,
    v_donor.transformation_cost_per_m,
    'approved', now(),
    -- Aprovador: quem disparou a heranca quando ha sessao; no backfill nao ha
    -- auth.uid(), entao cai no aprovador do doador. Em nenhum dos dois casos o
    -- rendimento foi medido NESTA napa — e por isso que review_reason abaixo
    -- diz de onde veio, em vez de deixar a linha parecendo cadastro proprio.
    coalesce(auth.uid(), v_donor.approved_by), now(),
    format(
      'Rendimento HERDADO de %s (mesma largura util: %s mm). Confirmado %s m/m '
      || 'e faixa de corte %s mm copiados; NAO foram medidos nesta napa. '
      || 'Decisao do dono em 21/08/2026 — revise no Hub de Tiras ao medir.',
      v_donor.donor_group_name,
      trim(to_char(v_profile.usable_width_mm, 'FM999999990.######')),
      trim(to_char(v_donor.confirmed_yield_m_per_m, 'FM999999990.######')),
      trim(to_char(v_donor.cut_band_width_mm, 'FM999999990.######'))
    )
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.inherit_strap_recipe_from_peer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inherit_strap_recipe_from_peer(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.inherit_strap_recipe_from_peer(uuid, uuid) IS
  'Materializa a receita de tira de uma napa a partir de outra de largura util identica, apenas quando todos os doadores concordam. Nunca sobrescreve receita vigente e nunca escolhe entre doadores divergentes.';

-- Varre todas as combinacoes possiveis. Idempotente: quem ja tem receita
-- vigente e ignorado, e quem nao tem doador inequivoco continua sem receita.
CREATE OR REPLACE FUNCTION public.ensure_inherited_strap_recipes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_created integer := 0;
BEGIN
  FOR v_row IN
    SELECT w.base_group_id, m.id AS measure_id
      FROM public.base_material_width_profiles w
      CROSS JOIN public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE w.status = 'approved' AND w.valid_to IS NULL
       AND m.active AND t.active
     ORDER BY w.base_group_id, m.id
  LOOP
    -- Conta o que foi CRIADO: pergunta antes, porque a funcao devolve o id da
    -- receita vigente tambem quando ela ja existia (idempotencia).
    IF NOT EXISTS (
      SELECT 1 FROM public.artisanal_strap_recipes r
       WHERE r.measure_id = v_row.measure_id
         AND r.base_group_id = v_row.base_group_id
         AND r.status = 'approved'
         AND r.valid_from <= now()
         AND (r.valid_to IS NULL OR r.valid_to > now())
    ) AND public.inherit_strap_recipe_from_peer(v_row.measure_id, v_row.base_group_id) IS NOT NULL THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_inherited_strap_recipes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_inherited_strap_recipes() TO authenticated, service_role;

-- Napa nova entra pelo perfil de largura (materializado automaticamente pela
-- 20270101006300). Herdar ali fecha o ciclo: cadastrou a napa, ela ja nasce
-- vendavel quando existe doador inequivoco de mesma largura.
CREATE OR REPLACE FUNCTION public.tg_inherit_strap_recipes_on_width_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_measure_id uuid;
BEGIN
  IF NEW.status <> 'approved' OR NEW.valid_to IS NOT NULL THEN
    RETURN NULL;
  END IF;
  FOR v_measure_id IN
    SELECT m.id FROM public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE m.active AND t.active
     ORDER BY m.id
  LOOP
    PERFORM public.inherit_strap_recipe_from_peer(v_measure_id, NEW.base_group_id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_inherit_strap_recipes_on_width_profile
  ON public.base_material_width_profiles;
CREATE TRIGGER trg_inherit_strap_recipes_on_width_profile
  AFTER INSERT OR UPDATE ON public.base_material_width_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_inherit_strap_recipes_on_width_profile();

SELECT public.ensure_inherited_strap_recipes();

DO $assertions$
DECLARE
  v_glow_overlock integer;
  v_glow_chata integer;
  v_confirmado numeric;
BEGIN
  -- O caso do PV travado: GLOW METALIC x TIRA OVERLOCK 5 mm passa a ter receita.
  SELECT count(*), max(r.confirmed_yield_m_per_m)
    INTO v_glow_overlock, v_confirmado
    FROM public.artisanal_strap_recipes r
    JOIN public.artisanal_strap_measures m ON m.id = r.measure_id
    JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
    JOIN public.product_groups g ON g.id = r.base_group_id
   WHERE upper(g.name) = 'GLOW METALIC'
     AND upper(t.name) = 'TIRA OVERLOCK'
     AND m.finished_width_mm = 5
     AND r.status = 'approved'
     AND (r.valid_to IS NULL OR r.valid_to > now());
  IF v_glow_overlock <> 1 THEN
    RAISE EXCEPTION 'GLOW METALIC deveria ter exatamente 1 receita vigente de TIRA OVERLOCK 5 mm, tem %', v_glow_overlock;
  END IF;
  IF v_confirmado IS DISTINCT FROM 61 THEN
    RAISE EXCEPTION 'Rendimento herdado deveria ser o CONFIRMADO do doador (61 m/m), veio %', v_confirmado;
  END IF;

  -- O caso ambiguo continua bloqueado: doadores de 8 mm divergem (18 x 20 mm).
  SELECT count(*) INTO v_glow_chata
    FROM public.artisanal_strap_recipes r
    JOIN public.artisanal_strap_measures m ON m.id = r.measure_id
    JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
    JOIN public.product_groups g ON g.id = r.base_group_id
   WHERE upper(g.name) = 'GLOW METALIC'
     AND upper(t.name) = 'TIRA CHATA'
     AND m.finished_width_mm = 8
     AND r.status = 'approved';
  IF v_glow_chata <> 0 THEN
    RAISE EXCEPTION 'Doadores divergentes nao podem gerar receita; TIRA CHATA 8 mm em GLOW METALIC criou %', v_glow_chata;
  END IF;

  -- Toda linha herdada tem que dizer que foi herdada.
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_recipes r
     WHERE r.review_reason LIKE 'Rendimento HERDADO%'
       AND r.review_reason NOT LIKE '%NAO foram medidos nesta napa%'
  ) THEN
    RAISE EXCEPTION 'Receita herdada sem a ressalva de origem no review_reason';
  END IF;
END;
$assertions$;

COMMIT;
