-- =============================================================================
-- Rendimento em lote: um numero para TODAS as napas da mesma medida
-- =============================================================================
-- Pedido do dono (14/10/2026): "eu preciso, em um clique, mudar o rendimento
-- para todos os materiais, ja que a maioria dos materiais tem as mesmas
-- dimensoes". Na TIRA OVERLOCK 5 mm sao 6 napas, todas com ficha 1.370 mm e
-- banda 18 mm -- corrigir o rendimento abrindo a gaveta 6 vezes e trabalho
-- repetido que convida a deixar napa para tras com o numero velho.
--
-- O lote que ja existia (`save_artisanal_strap_material_conversions`, mig
-- 20270101014550) NAO serve aqui: ele fixa `new_material_only = true` e recusa
-- material que ja tenha receita vigente ("Material-base ja possui receita
-- vigente ou em elaboracao para esta medida"). Ele cadastra material NOVO.
-- Esta funcao e o irmao dele para as receitas que JA EXISTEM.
--
-- Como o lote singular, cada material continua passando pelo writer canonico
-- `confirm_artisanal_strap_material_conversion`, entao versionamento,
-- supersede, largura fisica do estoque, aprovacao e auditoria sao os mesmos do
-- caminho de uma napa so. Nada aqui reimplementa regra de receita.
--
-- ⚠ VALIDA O LOTE INTEIRO ANTES DA PRIMEIRA ESCRITA. O teto do rendimento e
-- por napa (`floor(largura_util / banda)`, CHECK artisanal_strap_recipes_yield_ck)
-- e a largura vem da Ficha de Componente de CADA napa. Aplicar na ordem e
-- deixar estourar no meio deixaria a medida com metade das napas no numero
-- novo e metade no velho -- divergencia silenciosa justamente na tabela que
-- divide a tira para dar a napa a enviar ao prestador.
--
-- ⚠ PRESERVA executor_type, default_contractor_id e transformation_cost_per_m
-- de CADA receita. `save_artisanal_strap_recipe` grava esses tres campos
-- direto do que recebe (nao faz coalesce com a versao anterior quando p_id e
-- NULL, que e o caso de versao nova), e ainda exige custo NOT NULL. Omitir
-- qualquer um deles viraria napa de prestador em napa de fabrica, ou zeraria
-- a mao de obra, sem ninguem pedir.

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_artisanal_strap_measure_yield_for_all(
  p_measure_id uuid,
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_measure public.artisanal_strap_measures%ROWTYPE;
  v_yield numeric;
  v_band numeric;
  v_has_band boolean := false;
  v_scope uuid[];
  v_row record;
  v_target jsonb;
  v_targets jsonb := '[]'::jsonb;
  v_effective_band numeric;
  v_width numeric;
  v_ceiling numeric;
  v_conversion jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_reason text := public.require_strap_change_reason(
    p_reason,
    'Rendimento aplicado a todos os materiais da medida'
  );
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  PERFORM public.assert_artisanal_strap_capability('approve_strap_recipe');

  IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Payload do rendimento em lote deve ser um objeto';
  END IF;

  -- Mesma guarda recursiva do lote de materiais: conversao tecnica nao tem
  -- dimensao de cor e nao cria identidade de estoque.
  IF jsonb_path_exists(v_payload, '$.**.variant')
     OR jsonb_path_exists(v_payload, '$.**.variant_id')
     OR jsonb_path_exists(v_payload, '$.**.product')
     OR jsonb_path_exists(v_payload, '$.**.product_id')
     OR jsonb_path_exists(v_payload, '$.**.color')
     OR jsonb_path_exists(v_payload, '$.**.color_id')
     OR jsonb_path_exists(v_payload, '$.**.canonical_color_id') THEN
    RAISE EXCEPTION 'Rendimento em lote nao aceita cor, produto ou variante de estoque';
  END IF;

  -- Este writer so mexe em rendimento e banda. Receita individual continua
  -- sendo editada pela gaveta de conversao, que tem a tela toda.
  IF v_payload ? 'recipe' OR v_payload ? 'recipe_id' OR v_payload ? 'id' THEN
    RAISE EXCEPTION
      'Rendimento em lote nao aceita recipe.id; abra a conversao do material para editar uma versao';
  END IF;

  SELECT * INTO v_measure
    FROM public.artisanal_strap_measures
   WHERE id = p_measure_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medida de tira inexistente';
  END IF;

  IF NOT (v_payload ? 'confirmed_yield_m_per_m') THEN
    RAISE EXCEPTION 'Informe o rendimento a aplicar';
  END IF;
  BEGIN
    v_yield := (v_payload ->> 'confirmed_yield_m_per_m')::numeric;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Rendimento invalido';
  END;
  IF v_yield IS NULL OR v_yield <= 0 THEN
    RAISE EXCEPTION 'Rendimento deve ser maior que zero';
  END IF;

  -- Banda ausente = cada napa mantem a sua. So quem digita a banda troca a
  -- geometria -- e ai ela troca para todas, que e o ponto do lote.
  IF v_payload ? 'cut_band_width_mm'
     AND jsonb_typeof(v_payload -> 'cut_band_width_mm') IS DISTINCT FROM 'null' THEN
    BEGIN
      v_band := (v_payload ->> 'cut_band_width_mm')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Banda de corte invalida';
    END;
    IF v_band IS NULL OR v_band <= 0 THEN
      RAISE EXCEPTION 'Banda de corte deve ser maior que zero';
    END IF;
    v_has_band := true;
  END IF;

  -- Escopo opcional: sem ele o lote pega TODAS as napas vigentes da medida.
  -- Com ele, so as escolhidas -- o caso do dono em que "a MAIORIA" tem as
  -- mesmas dimensoes e uma napa fica de fora.
  IF v_payload ? 'base_group_ids'
     AND jsonb_typeof(v_payload -> 'base_group_ids') IS DISTINCT FROM 'null' THEN
    IF jsonb_typeof(v_payload -> 'base_group_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'base_group_ids deve ser um array';
    END IF;
    BEGIN
      SELECT array_agg((entry.value #>> '{}')::uuid)
        INTO v_scope
        FROM jsonb_array_elements(v_payload -> 'base_group_ids') AS entry(value);
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'base_group_ids contem UUID invalido';
    END;
    IF v_scope IS NULL OR array_length(v_scope, 1) IS NULL THEN
      RAISE EXCEPTION 'Selecione ao menos um material para aplicar o rendimento';
    END IF;
  END IF;

  -- ── Passada 1: materializa e valida o lote inteiro ────────────────────────
  FOR v_row IN
    SELECT recipe.id,
           recipe.base_group_id,
           recipe.cut_band_width_mm,
           recipe.confirmed_yield_m_per_m,
           recipe.executor_type,
           recipe.default_contractor_id,
           recipe.transformation_cost_per_m,
           grp.name AS base_group_name
      FROM public.artisanal_strap_recipes recipe
      JOIN public.product_groups grp ON grp.id = recipe.base_group_id
     WHERE recipe.measure_id = p_measure_id
       AND recipe.status = 'approved'
       AND recipe.valid_to IS NULL
       AND (v_scope IS NULL OR recipe.base_group_id = ANY (v_scope))
     ORDER BY grp.name
  LOOP
    v_effective_band := CASE WHEN v_has_band THEN v_band ELSE v_row.cut_band_width_mm END;

    -- A largura e a MESMA que `confirm_artisanal_strap_material_conversion`
    -- vai resolver na hora de gravar. Validar contra o snapshot antigo
    -- deixaria passar um lote que estoura no CHECK da nova versao.
    v_width := public.resolve_base_group_usable_width_mm(v_row.base_group_id);
    IF v_width IS NULL OR v_width <= 0 THEN
      RAISE EXCEPTION
        'O material % nao possui largura fisica unica no estoque; corrija as Dimensoes da Ficha de Componente antes de aplicar o rendimento. Nada foi alterado.',
        v_row.base_group_name;
    END IF;

    v_ceiling := floor(v_width / v_effective_band);
    IF v_yield > v_ceiling THEN
      RAISE EXCEPTION
        'Rendimento de % m/m passa do teto de % m/m em % (largura util % mm / banda % mm). Nada foi alterado.',
        v_yield, v_ceiling, v_row.base_group_name, v_width, v_effective_band;
    END IF;

    v_targets := v_targets || jsonb_build_object(
      'base_group_id', v_row.base_group_id,
      'base_group_name', v_row.base_group_name,
      'previous_recipe_id', v_row.id,
      'previous_yield_m_per_m', v_row.confirmed_yield_m_per_m,
      'cut_band_width_mm', v_effective_band,
      'executor_type', v_row.executor_type,
      'default_contractor_id', v_row.default_contractor_id,
      'transformation_cost_per_m', v_row.transformation_cost_per_m
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nenhum material vigente nesta medida para aplicar o rendimento';
  END IF;

  -- ── Passada 2: aplica, ja sabendo que o lote inteiro cabe ─────────────────
  FOR v_target IN SELECT entry.value FROM jsonb_array_elements(v_targets) AS entry(value)
  LOOP
    v_conversion := public.confirm_artisanal_strap_material_conversion(
      jsonb_build_object(
        'type', jsonb_build_object('id', v_measure.strap_type_id),
        'measure', jsonb_build_object('id', p_measure_id),
        'base_group_id', v_target ->> 'base_group_id',
        'recipe', jsonb_build_object(
          'cut_band_width_mm', (v_target ->> 'cut_band_width_mm')::numeric,
          'confirmed_yield_m_per_m', v_yield,
          'executor_type', v_target ->> 'executor_type',
          'default_contractor_id', v_target ->> 'default_contractor_id',
          'transformation_cost_per_m', (v_target ->> 'transformation_cost_per_m')::numeric
        )
      ),
      v_reason
    );

    v_applied := v_applied || jsonb_build_object(
      'base_group_id', v_target ->> 'base_group_id',
      'base_group_name', v_target ->> 'base_group_name',
      'previous_recipe_id', v_target ->> 'previous_recipe_id',
      'previous_yield_m_per_m', (v_target ->> 'previous_yield_m_per_m')::numeric,
      'recipe_id', v_conversion ->> 'recipe_id',
      'cut_band_width_mm', (v_target ->> 'cut_band_width_mm')::numeric,
      'usable_width_mm', (v_conversion ->> 'usable_width_mm')::numeric
    );
  END LOOP;

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'confirmed_yield_m_per_m', v_yield,
    'cut_band_width_mm', CASE WHEN v_has_band THEN v_band ELSE NULL END,
    'applied_count', v_count,
    'applied', v_applied,
    'color_scope', 'all'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_artisanal_strap_measure_yield_for_all(uuid, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_artisanal_strap_measure_yield_for_all(uuid, jsonb, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.confirm_artisanal_strap_measure_yield_for_all(uuid, jsonb, text) IS
  'Aplica um rendimento (e opcionalmente uma banda) a todas as receitas vigentes de uma medida de tira, criando versao nova por napa pelo writer canonico. Valida o lote inteiro antes da primeira escrita e preserva executor, prestador e mao de obra de cada receita.';

COMMIT;
