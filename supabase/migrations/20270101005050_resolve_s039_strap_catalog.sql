-- Resolve o cadastro canonico das tiras da S-039 sem fixar uma cor na ficha.
--
-- A referencia vende OFF WHITE e COGUMELO. Portanto, usar
-- lining_material_product_id como atalho para a napa-base faria o motor de
-- consumo priorizar um SKU/colorido e debitar a cor errada. A identidade da
-- base das tiras passa a ter um FK proprio, sem cor; a variante do item continua
-- vencendo a ficha pela mesma precedencia ja usada pelo motor operacional.

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS strap_base_group_id uuid
  REFERENCES public.product_groups(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.technical_sheets.strap_base_group_id IS
  'Grupo canonico, sem cor, da napa usada nas tiras. Variante do item vence este fallback; nunca substitui pins de cabedal/forracao.';

CREATE INDEX IF NOT EXISTS technical_sheets_strap_base_group_idx
  ON public.technical_sheets (strap_base_group_id)
  WHERE strap_base_group_id IS NOT NULL;

-- technical_sheets ainda possui uma policy ampla para usuarios aprovados. O FK
-- sozinho nao impede que um cliente PostgREST grave SOLADO/TIRA como napa-base;
-- portanto a coluna nova fica fechada pela mesma capability e motivo da RPC.
CREATE OR REPLACE FUNCTION public.tg_guard_technical_sheet_strap_base_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.strap_base_group_id IS NULL)
     OR (TG_OP = 'UPDATE' AND NEW.strap_base_group_id IS NOT DISTINCT FROM OLD.strap_base_group_id) THEN
    RETURN NEW;
  END IF;
  IF auth.role() = 'service_role'
     OR current_setting('app.artisanal_strap_catalog_write', true) = '1' THEN
    RETURN NEW;
  END IF;
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  PERFORM public.require_strap_change_reason(
    current_setting('app.strap_change_reason', true)
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_technical_sheet_strap_base_group() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_technical_sheet_strap_base_group_insert
  ON public.technical_sheets;
CREATE TRIGGER trg_guard_technical_sheet_strap_base_group_insert
BEFORE INSERT ON public.technical_sheets
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_technical_sheet_strap_base_group();

DROP TRIGGER IF EXISTS trg_guard_technical_sheet_strap_base_group_update
  ON public.technical_sheets;
CREATE TRIGGER trg_guard_technical_sheet_strap_base_group_update
BEFORE UPDATE OF strap_base_group_id ON public.technical_sheets
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_technical_sheet_strap_base_group();

-- A base altera consumo, custo e reservas tanto quanto os pins existentes.
-- Recria a definicao final da malha adicionando a nova coluna; omiti-la faria
-- uma troca somente de base manter snapshots abertos como se estivessem atuais.
DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_sheet ON public.technical_sheets;
CREATE TRIGGER trg_mark_so_costs_dirty_from_sheet
AFTER UPDATE OF upper_material, upper_consumption, upper_consumption_per_size,
  lining_material, lining_consumption, insole_material, insole_consumption,
  sole_material, sole_consumption, components_accessories, lining_accessories,
  direct_components, custom_overhead, has_straps, strap_colors, assembly_time_minutes,
  upper_material_product_id, lining_material_product_id, sole_group_id,
  insole_ready_made, sole_drives_consumption, strap_base_group_id
ON public.technical_sheets
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet();

-- O resolvedor estrutural nunca usa nome. O novo FK entra depois de todos os
-- overrides da variante e antes dos pins legados de produto da ficha.
CREATE OR REPLACE FUNCTION public.resolve_strap_base_group_id(
  p_reference_id uuid,
  p_material_variant_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (
    SELECT rmv.upper_material_group_id,
           rmv.upper_material_product_id,
           rmv.lining_material_group_id,
           rmv.lining_material_product_id,
           rmv.main_material_group_id
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_material_variant_id
       AND rmv.reference_id = p_reference_id
       AND coalesce(rmv.active, true)
  ), s AS (
    SELECT ts.strap_base_group_id,
           ts.upper_material_product_id,
           ts.lining_material_product_id
      FROM public.technical_sheets ts
     WHERE ts.id = p_reference_id
  )
  SELECT coalesce(
    (SELECT upper_material_group_id FROM v),
    (SELECT p.group_id FROM v JOIN public.products p ON p.id = v.upper_material_product_id),
    (SELECT lining_material_group_id FROM v),
    (SELECT p.group_id FROM v JOIN public.products p ON p.id = v.lining_material_product_id),
    (SELECT main_material_group_id FROM v),
    (SELECT strap_base_group_id FROM s),
    (SELECT p.group_id FROM s JOIN public.products p ON p.id = s.upper_material_product_id),
    (SELECT p.group_id FROM s JOIN public.products p ON p.id = s.lining_material_product_id)
  );
$$;

COMMENT ON FUNCTION public.resolve_strap_base_group_id(uuid, uuid) IS
  'Resolve a napa-base por UUID. Variante (cabedal/forro/principal) > grupo proprio de tiras da ficha > pins de produto da ficha; texto nunca identifica estoque.';

-- Mantem o motor legado de debito/compra alinhado com o resolvedor canonico.
-- O overload de um argumento ja delega para este e preserva o mesmo OID.
CREATE OR REPLACE FUNCTION public.strap_base_family_for_sheet(
  p_reference_id uuid,
  p_variant_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public, extensions'
AS $function$
  WITH v AS (
    SELECT rmv.upper_material_group_id,
           rmv.upper_material_product_id,
           rmv.lining_material_group_id,
           rmv.lining_material_product_id,
           rmv.main_material_group_id
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_variant_id
       AND coalesce(rmv.active, true)
       AND (p_reference_id IS NULL OR rmv.reference_id = p_reference_id)
     LIMIT 1
  )
  SELECT coalesce(
    (SELECT nullif(btrim(g.name), '')
       FROM v JOIN public.product_groups g ON g.id = v.upper_material_group_id),
    (SELECT nullif(btrim(g.name), '')
       FROM v JOIN public.products p ON p.id = v.upper_material_product_id
              JOIN public.product_groups g ON g.id = p.group_id),
    (SELECT nullif(btrim(g.name), '')
       FROM v JOIN public.product_groups g ON g.id = v.lining_material_group_id),
    (SELECT nullif(btrim(g.name), '')
       FROM v JOIN public.products p ON p.id = v.lining_material_product_id
              JOIN public.product_groups g ON g.id = p.group_id),
    (SELECT nullif(btrim(g.name), '')
       FROM v JOIN public.product_groups g ON g.id = v.main_material_group_id),
    (SELECT nullif(btrim(g.name), '')
       FROM public.technical_sheets ts
       JOIN public.product_groups g ON g.id = ts.strap_base_group_id
      WHERE ts.id = p_reference_id),
    (SELECT nullif(btrim(g.name), '')
       FROM public.technical_sheets ts
       JOIN public.products p ON p.id = ts.upper_material_product_id
       JOIN public.product_groups g ON g.id = p.group_id
      WHERE ts.id = p_reference_id),
    (SELECT nullif(btrim(g.name), '')
       FROM public.technical_sheets ts
       JOIN public.products p ON p.id = ts.lining_material_product_id
       JOIN public.product_groups g ON g.id = p.group_id
      WHERE ts.id = p_reference_id),
    (SELECT nullif(btrim(ts.upper_material), '')
       FROM public.technical_sheets ts WHERE ts.id = p_reference_id),
    (SELECT nullif(btrim(ts.lining_material), '')
       FROM public.technical_sheets ts WHERE ts.id = p_reference_id)
  );
$function$;

COMMENT ON FUNCTION public.strap_base_family_for_sheet(uuid, uuid) IS
  'Familia da napa das tiras: variante > technical_sheets.strap_base_group_id > pins UUID da ficha > textos somente como fallback legado.';

-- Writer pequeno e atomico para o drawer do PV. Ele nao cadastra produto nem
-- tenta inferir medida por nome: um Administrador confirma a base e cada medida.
-- Linhas legadas passam pelo mapa/hash existente, preservando a trilha e
-- propagando somente snapshots abertos que ainda correspondam ao conteudo.
CREATE OR REPLACE FUNCTION public.resolve_technical_strap_context_from_sale_order(
  p_reference_id uuid,
  p_base_group_id uuid,
  p_lines jsonb,
  p_reason text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_lines jsonb;
  v_choice jsonb;
  v_line jsonb;
  v_map_id uuid;
  v_line_id uuid;
  v_measure_id uuid;
  v_strap_type_id uuid;
  v_existing_measure_id uuid;
  v_existing_type_id uuid;
  v_ordinal integer;
  v_reason text := public.require_strap_change_reason(p_reason);
  v_expected_count integer;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');

  IF p_base_group_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.product_groups g
     WHERE g.id = p_base_group_id
       AND EXISTS (
         SELECT 1 FROM public.base_material_width_profiles w
          WHERE w.base_group_id = g.id
            AND w.status = 'approved'
            AND w.valid_to IS NULL
       )
       AND EXISTS (
         SELECT 1
           FROM public.base_material_color_official_products o
           JOIN public.products p ON p.id = o.official_product_id
          WHERE o.base_group_id = g.id
            AND o.status = 'active'
            AND p.active
            AND p.group_id = g.id
       )
  ) THEN
    RAISE EXCEPTION 'Napa-base sem perfil aprovado ou produto oficial ativo';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Informe a medida canonica de cada linha de tira';
  END IF;

  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha tecnica inexistente'; END IF;
  IF p_expected_updated_at IS NULL
     OR v_sheet.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'A ficha mudou desde a abertura do Estoque; recarregue o pedido antes de confirmar'
      USING ERRCODE = '40001';
  END IF;

  v_lines := CASE WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
    THEN v_sheet.strap_colors ELSE '[]'::jsonb END;
  v_expected_count := jsonb_array_length(v_lines);
  IF jsonb_array_length(p_lines) <> v_expected_count THEN
    RAISE EXCEPTION 'Confirme todas as % linhas de tira da ficha', v_expected_count;
  END IF;
  IF (
    SELECT count(DISTINCT (entry ->> 'ordinal')::integer)
      FROM jsonb_array_elements(p_lines) entry
  ) <> v_expected_count THEN
    RAISE EXCEPTION 'Cada linha de tira deve aparecer exatamente uma vez';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);

  FOR v_choice IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_ordinal := (v_choice ->> 'ordinal')::integer;
      v_measure_id := (v_choice ->> 'measure_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Ordinal ou UUID de medida invalido';
    END;
    IF v_ordinal < 0 OR v_ordinal >= v_expected_count THEN
      RAISE EXCEPTION 'Ordinal de linha fora da ficha: %', v_ordinal;
    END IF;
    SELECT m.strap_type_id INTO v_strap_type_id
      FROM public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE m.id = v_measure_id AND m.active AND t.active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Medida/familia canonica inexistente ou inativa';
    END IF;

    SELECT ts.strap_colors -> v_ordinal INTO v_line
      FROM public.technical_sheets ts WHERE ts.id = p_reference_id;
    IF v_line IS NULL THEN RAISE EXCEPTION 'Linha tecnica inexistente'; END IF;

    -- UUID estavel com medida ausente e uma migracao parcial recuperavel, nao
    -- uma identidade completa. Reaproveita o UUID, cria/valida seu mapa e usa
    -- o writer canonico para persistir medida/tipo e propagar snapshots abertos.
    IF nullif(v_line ->> 'technical_strap_line_id', '') IS NOT NULL THEN
      BEGIN
        v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
        v_existing_measure_id := nullif(v_line ->> 'measure_id', '')::uuid;
        v_existing_type_id := nullif(v_line ->> 'strap_type_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Linha tecnica possui UUID, medida ou familia invalida';
      END;
      IF v_existing_measure_id IS NOT NULL AND v_existing_measure_id <> v_measure_id THEN
        RAISE EXCEPTION 'Linha canonica ja possui outra medida; crie uma nova linha para corrigir a identidade';
      END IF;
      IF v_existing_measure_id = v_measure_id
         AND v_existing_type_id = v_strap_type_id THEN
        CONTINUE;
      END IF;

      SELECT m.id INTO v_map_id
        FROM public.technical_strap_line_identity_map m
       WHERE m.technical_strap_line_id = v_line_id
       FOR UPDATE;
      IF FOUND THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.technical_strap_line_identity_map m
           WHERE m.id = v_map_id
             AND m.technical_sheet_id = p_reference_id
             AND m.legacy_path = 'strap_colors'
             AND m.legacy_ordinal = v_ordinal
             AND (m.measure_id IS NULL OR m.measure_id = v_measure_id)
        ) THEN
          RAISE EXCEPTION 'UUID tecnico ja pertence a outro caminho ou medida';
        END IF;
      ELSE
        INSERT INTO public.technical_strap_line_identity_map (
          technical_sheet_id, legacy_path, legacy_ordinal, content_hash,
          technical_strap_line_id, status, resolution_reason
        ) VALUES (
          p_reference_id, 'strap_colors', v_ordinal, md5(v_line::text),
          v_line_id, 'review_required', v_reason
        )
        RETURNING id INTO v_map_id;
      END IF;
      PERFORM public.resolve_technical_strap_line_migration(v_map_id, v_measure_id, v_reason);
      CONTINUE;
    END IF;

    v_line_id := public.ensure_technical_strap_line_identity(
      p_reference_id,
      'strap_colors',
      v_ordinal,
      v_line,
      v_reason
    );
    SELECT m.id INTO v_map_id
      FROM public.technical_strap_line_identity_map m
     WHERE m.technical_sheet_id = p_reference_id
       AND m.legacy_path = 'strap_colors'
       AND m.legacy_ordinal = v_ordinal
       AND m.technical_strap_line_id = v_line_id
     ORDER BY m.created_at DESC
     LIMIT 1;
    IF v_map_id IS NULL THEN RAISE EXCEPTION 'Mapa tecnico da linha nao foi criado'; END IF;
    PERFORM public.resolve_technical_strap_line_migration(v_map_id, v_measure_id, v_reason);
  END LOOP;

  UPDATE public.technical_sheets
     SET strap_base_group_id = p_base_group_id,
         updated_at = now()
   WHERE id = p_reference_id
  RETURNING strap_colors INTO v_lines;

  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, new_data, success, created_at
  ) VALUES (
    auth.uid(),
    'resolve_technical_strap_context_from_sale_order',
    'technical_sheets',
    p_reference_id::text,
    jsonb_build_object(
      'base_group_id', p_base_group_id,
      'lines', p_lines,
      'reason', v_reason
    ),
    true,
    now()
  );

  RETURN jsonb_build_object(
    'reference_id', p_reference_id,
    'base_group_id', p_base_group_id,
    'strap_colors', v_lines
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_technical_strap_context_from_sale_order(uuid, uuid, jsonb, text, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_technical_strap_context_from_sale_order(uuid, uuid, jsonb, text, timestamptz)
  TO authenticated;

COMMENT ON FUNCTION public.resolve_technical_strap_context_from_sale_order(uuid, uuid, jsonb, text, timestamptz) IS
  'Persiste, a partir do drawer do PV, o grupo sem cor da napa-base e a medida escolhida explicitamente para cada linha tecnica.';

-- ---------------------------------------------------------------------------
-- Bootstrap auditado da S-039 / codigo 903928
-- ---------------------------------------------------------------------------

DO $bootstrap$
DECLARE
  v_reference_id constant uuid := 'afe01930-4369-4f62-b233-b8ba914513ad';
  v_actor_id constant uuid := '49371f4d-641f-466d-be26-686ef57743ec';
  v_base_group_id constant uuid := '9128e6f6-8fc2-40ca-92dd-c572000e2c2a';
  v_width_profile_id uuid;
  v_recipe_overlock_id uuid;
  v_recipe_chata_id uuid;
  v_original_lines jsonb;
  v_lines jsonb;
  v_line jsonb;
  v_enriched jsonb;
  v_line_id uuid;
  v_i integer;
  v_version integer;
  v_reason constant text := 'Demanda de 18/08/2026: resolver S-039 sem duplicar produtos e preservar OFF WHITE/COGUMELO';
  v_seed_line_ids uuid[] := ARRAY[
    '953a2a39-e76d-4028-9b90-a33c4b23f870'::uuid,
    'e7d34173-beb1-429e-bc85-e7c3867bf4b6'::uuid,
    '3c3b67db-83b0-4783-8d27-2ceec503cff7'::uuid,
    '5737cb74-2727-4737-b563-57188a503fa4'::uuid,
    '8ddf372d-9cff-41f3-8029-9193f0a314e4'::uuid
  ];
  v_measure_ids uuid[] := ARRAY[
    '06500a23-801d-4627-a927-3ce7e5ee2619'::uuid,
    '06500a23-801d-4627-a927-3ce7e5ee2619'::uuid,
    '06500a23-801d-4627-a927-3ce7e5ee2619'::uuid,
    '0166b326-2023-4427-a165-aada45ee5611'::uuid,
    '0166b326-2023-4427-a165-aada45ee5611'::uuid
  ];
  v_type_ids uuid[] := ARRAY[
    'a69cb531-2d66-4931-9a71-8b06bec56eb0'::uuid,
    'a69cb531-2d66-4931-9a71-8b06bec56eb0'::uuid,
    'a69cb531-2d66-4931-9a71-8b06bec56eb0'::uuid,
    '485a45d9-e532-479f-aed5-cad4be5b33da'::uuid,
    '485a45d9-e532-479f-aed5-cad4be5b33da'::uuid
  ];
BEGIN
  -- Ambientes sem o dado operacional da Squad pulam somente este bootstrap; o
  -- schema e o writer acima continuam instalados e testaveis.
  IF NOT EXISTS (SELECT 1 FROM public.technical_sheets WHERE id = v_reference_id) THEN
    RETURN;
  END IF;

  -- O pedido foi feito pelo proprietario. O ator e explicito e precisa
  -- continuar aprovado e Administrador; nunca escolhemos "o primeiro admin".
  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
     WHERE p.id = v_actor_id
       AND p.approved
       AND ur.role = 'admin'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Ator explicito do bootstrap da S-039 nao e um Administrador aprovado';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  SELECT strap_colors INTO v_original_lines
    FROM public.technical_sheets
   WHERE id = v_reference_id
   FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.technical_sheets
     WHERE id = v_reference_id
       AND strap_base_group_id IS NOT NULL
       AND strap_base_group_id <> v_base_group_id
  ) THEN
    RAISE EXCEPTION 'S-039 mudou: a napa-base ja aponta para outro grupo canonico';
  END IF;
  IF (SELECT lining_material_product_id
        FROM public.technical_sheets
       WHERE id = v_reference_id) IS NOT NULL THEN
    RAISE EXCEPTION 'S-039 mudou: o pin de forracao nao pode ser apagado pelo bootstrap de tiras';
  END IF;
  IF jsonb_typeof(v_original_lines) <> 'array' OR jsonb_array_length(v_original_lines) <> 5 THEN
    RAISE EXCEPTION 'S-039 mudou: esperadas exatamente 5 linhas de tira';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_original_lines) WITH ORDINALITY entry(line, ordinality)
     WHERE (entry.ordinality <= 3 AND nullif(entry.line ->> 'group_id', '')::uuid
              IS DISTINCT FROM 'e0301b34-7963-448d-a12a-33a897439282'::uuid)
        OR (entry.ordinality > 3 AND nullif(entry.line ->> 'group_id', '')::uuid
              IS DISTINCT FROM 'a657390e-1c4f-469b-ac48-8e45b2b8d3c0'::uuid)
  ) THEN
    RAISE EXCEPTION 'S-039 mudou: ordem/grupos nao correspondem a 3 Overlock 5 + 2 Chata 8';
  END IF;

  -- Fecha a janela entre preflight e vinculacao: grupo/cor/unidade dos seis
  -- SKUs nao podem mudar concorrentemente no meio do bootstrap atomico.
  PERFORM product.id
    FROM public.products product
   WHERE product.id = ANY (ARRAY[
     '84ba12fe-117f-42c7-ba20-52b3a2c9df02'::uuid,
     '64be93fe-8bdd-480c-a078-8893fcb870ab'::uuid,
     'b46cd0dc-1a85-4330-ab72-0bb8a4329cfc'::uuid,
     '57123283-6883-4297-981a-08d850a210b2'::uuid,
     '5e09e941-7552-408e-bcf9-de143c389d77'::uuid,
     'd22cc2fc-14de-495d-8d08-70595e91c4aa'::uuid
   ])
   ORDER BY product.id
   FOR UPDATE;

  -- Os UUIDs abaixo sao reaproveitados, nunca recriados. Falha antes de tocar o
  -- catalogo se qualquer SKU tiver mudado de grupo/cor/unidade ou sido inativado.
  -- O piso legado nasce em 50; depois do primeiro sync ele fica em 0 no produto
  -- e passa a morar exclusivamente na variante. Aceitar os dois estados deixa a
  -- migration reexecutavel sem aceitar qualquer outro piso.
  IF (
    SELECT count(*)
      FROM (VALUES
        ('84ba12fe-117f-42c7-ba20-52b3a2c9df02'::uuid,
         '9128e6f6-8fc2-40ca-92dd-c572000e2c2a'::uuid, 'OFF WHITE'::text),
        ('64be93fe-8bdd-480c-a078-8893fcb870ab'::uuid,
         '9128e6f6-8fc2-40ca-92dd-c572000e2c2a'::uuid, 'COGUMELO'::text)
      ) expected(product_id, group_id, color)
      JOIN public.products product ON product.id = expected.product_id
       AND product.group_id = expected.group_id
       AND product.color = expected.color
       AND product.unit = 'm'
       AND product.active
  ) <> 2 THEN
    RAISE EXCEPTION 'Produtos-base NAPA SUDANI mudaram desde a auditoria';
  END IF;

  IF (
    SELECT count(*)
      FROM (VALUES
        ('b46cd0dc-1a85-4330-ab72-0bb8a4329cfc'::uuid,
         'e0301b34-7963-448d-a12a-33a897439282'::uuid, 'OFF WHITE'::text),
        ('57123283-6883-4297-981a-08d850a210b2'::uuid,
         'a657390e-1c4f-469b-ac48-8e45b2b8d3c0'::uuid, 'OFF WHITE'::text),
        ('5e09e941-7552-408e-bcf9-de143c389d77'::uuid,
         'e0301b34-7963-448d-a12a-33a897439282'::uuid, 'COGUMELO'::text),
        ('d22cc2fc-14de-495d-8d08-70595e91c4aa'::uuid,
         'a657390e-1c4f-469b-ac48-8e45b2b8d3c0'::uuid, 'COGUMELO'::text)
      ) expected(product_id, group_id, color)
      JOIN public.products product ON product.id = expected.product_id
       AND product.group_id = expected.group_id
       AND product.color = expected.color
       AND product.unit = 'm'
       AND product.active
       AND product.is_artisanal
       AND product.min_stock IN (0, 50)
  ) <> 4 THEN
    RAISE EXCEPTION 'Produtos acabados da S-039 mudaram desde a auditoria';
  END IF;

  -- Perfil unico de largura, comprovado pelas fichas dos dois SKUs da NAPA
  -- SUDANI (OFF WHITE e COGUMELO), ambos com 1370 mm.
  SELECT wp.id INTO v_width_profile_id
    FROM public.base_material_width_profiles wp
   WHERE wp.base_group_id = v_base_group_id
     AND wp.status = 'approved'
     AND wp.valid_to IS NULL;
  IF v_width_profile_id IS NULL THEN
    SELECT coalesce(max(version), 0) + 1 INTO v_version
      FROM public.base_material_width_profiles
     WHERE base_group_id = v_base_group_id;
    v_width_profile_id := '26699968-772f-4f6a-9362-202e948143ea'::uuid;
    INSERT INTO public.base_material_width_profiles (
      id, base_group_id, version, usable_width_mm, status, valid_from,
      approved_by, approved_at, review_reason
    ) VALUES (
      v_width_profile_id, v_base_group_id, v_version, 1370, 'approved', now(),
      v_actor_id, now(), v_reason
    );
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.base_material_width_profiles
     WHERE id = v_width_profile_id AND usable_width_mm = 1370
  ) THEN
    RAISE EXCEPTION 'Perfil vigente da NAPA SUDANI diverge de 1370 mm';
  END IF;

  -- Produto-base oficial por cor. Nenhum produto fisico e criado.
  IF NOT EXISTS (
    SELECT 1 FROM public.base_material_color_official_products
     WHERE base_group_id = v_base_group_id
       AND color_id = 'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d'::uuid
       AND status = 'active'
  ) THEN
    INSERT INTO public.base_material_color_official_products (
      id, base_group_id, color_id, official_product_id, status,
      approved_by, approved_at, review_reason
    ) VALUES (
      '8fe49875-1e5b-49aa-bd7c-b9aa2eeb0e47', v_base_group_id,
      'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d',
      '84ba12fe-117f-42c7-ba20-52b3a2c9df02',
      'active', v_actor_id, now(), v_reason
    );
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.base_material_color_official_products
     WHERE base_group_id = v_base_group_id
       AND color_id = 'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d'::uuid
       AND official_product_id = '84ba12fe-117f-42c7-ba20-52b3a2c9df02'::uuid
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Produto oficial OFF WHITE da NAPA SUDANI diverge do SKU validado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.base_material_color_official_products
     WHERE base_group_id = v_base_group_id
       AND color_id = '1f5b09b8-974f-448e-8166-ff3f261867fc'::uuid
       AND status = 'active'
  ) THEN
    INSERT INTO public.base_material_color_official_products (
      id, base_group_id, color_id, official_product_id, status,
      approved_by, approved_at, review_reason
    ) VALUES (
      'c0294789-7750-4ab8-841e-040f681817d6', v_base_group_id,
      '1f5b09b8-974f-448e-8166-ff3f261867fc',
      '64be93fe-8bdd-480c-a078-8893fcb870ab',
      'active', v_actor_id, now(), v_reason
    );
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.base_material_color_official_products
     WHERE base_group_id = v_base_group_id
       AND color_id = '1f5b09b8-974f-448e-8166-ff3f261867fc'::uuid
       AND official_product_id = '64be93fe-8bdd-480c-a078-8893fcb870ab'::uuid
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Produto oficial COGUMELO da NAPA SUDANI diverge do SKU validado';
  END IF;

  -- Conversoes color-agnostic copiadas de receitas legadas explicitas.
  SELECT r.id INTO v_recipe_overlock_id
    FROM public.artisanal_strap_recipes r
   WHERE r.measure_id = '06500a23-801d-4627-a927-3ce7e5ee2619'::uuid
     AND r.base_group_id = v_base_group_id
     AND r.status = 'approved'
     AND r.valid_to IS NULL;
  IF v_recipe_overlock_id IS NULL THEN
    SELECT coalesce(max(version), 0) + 1 INTO v_version
      FROM public.artisanal_strap_recipes
     WHERE measure_id = '06500a23-801d-4627-a927-3ce7e5ee2619'::uuid
       AND base_group_id = v_base_group_id;
    v_recipe_overlock_id := 'f691bab9-33ef-400f-a64d-c3d93ae521dc'::uuid;
    INSERT INTO public.artisanal_strap_recipes (
      id, measure_id, base_group_id, base_width_profile_id, version,
      usable_base_width_mm_snapshot, cut_band_width_mm,
      confirmed_yield_m_per_m, executor_type, default_contractor_id,
      transformation_cost_per_m, status, valid_from,
      approved_by, approved_at, review_reason
    ) VALUES (
      v_recipe_overlock_id,
      '06500a23-801d-4627-a927-3ce7e5ee2619', v_base_group_id,
      v_width_profile_id, v_version, 1370, 20, 61, 'contractor',
      '309e0397-8b1b-4191-b350-962adf2f5fb4', 0,
      'approved', now(), v_actor_id, now(),
      v_reason || '; origem legacy=30dbed3f-51b9-4db2-9cd7-925f33237a37'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_recipes
     WHERE id = v_recipe_overlock_id
       AND base_width_profile_id = v_width_profile_id
       AND usable_base_width_mm_snapshot = 1370
       AND cut_band_width_mm = 20
       AND confirmed_yield_m_per_m = 61
       AND executor_type = 'contractor'
       AND default_contractor_id = '309e0397-8b1b-4191-b350-962adf2f5fb4'::uuid
       AND transformation_cost_per_m = 0
       AND status = 'approved'
       AND valid_to IS NULL
  ) THEN
    RAISE EXCEPTION 'Receita canonica OVERLOCK/SUDANI diverge dos dados legados validados';
  END IF;

  SELECT r.id INTO v_recipe_chata_id
    FROM public.artisanal_strap_recipes r
   WHERE r.measure_id = '0166b326-2023-4427-a165-aada45ee5611'::uuid
     AND r.base_group_id = v_base_group_id
     AND r.status = 'approved'
     AND r.valid_to IS NULL;
  IF v_recipe_chata_id IS NULL THEN
    SELECT coalesce(max(version), 0) + 1 INTO v_version
      FROM public.artisanal_strap_recipes
     WHERE measure_id = '0166b326-2023-4427-a165-aada45ee5611'::uuid
       AND base_group_id = v_base_group_id;
    v_recipe_chata_id := '1bd2b2fe-7781-41ef-aa2c-ff86e8b59d0b'::uuid;
    INSERT INTO public.artisanal_strap_recipes (
      id, measure_id, base_group_id, base_width_profile_id, version,
      usable_base_width_mm_snapshot, cut_band_width_mm,
      confirmed_yield_m_per_m, executor_type, default_contractor_id,
      transformation_cost_per_m, status, valid_from,
      approved_by, approved_at, review_reason
    ) VALUES (
      v_recipe_chata_id,
      '0166b326-2023-4427-a165-aada45ee5611', v_base_group_id,
      v_width_profile_id, v_version, 1370, 20, 60, 'contractor',
      '309e0397-8b1b-4191-b350-962adf2f5fb4', 0,
      'approved', now(), v_actor_id, now(),
      v_reason || '; origem legacy=924e41b8-5050-468f-9ce6-b08c1afab81f'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_recipes
     WHERE id = v_recipe_chata_id
       AND base_width_profile_id = v_width_profile_id
       AND usable_base_width_mm_snapshot = 1370
       AND cut_band_width_mm = 20
       AND confirmed_yield_m_per_m = 60
       AND executor_type = 'contractor'
       AND default_contractor_id = '309e0397-8b1b-4191-b350-962adf2f5fb4'::uuid
       AND transformation_cost_per_m = 0
       AND status = 'approved'
       AND valid_to IS NULL
  ) THEN
    RAISE EXCEPTION 'Receita canonica CHATA 8/SUDANI diverge dos dados legados validados';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.legacy_artisanal_recipe_map
     WHERE legacy_recipe_id = '30dbed3f-51b9-4db2-9cd7-925f33237a37'
       AND canonical_recipe_id IS NOT NULL
       AND canonical_recipe_id <> v_recipe_overlock_id
  ) OR EXISTS (
    SELECT 1 FROM public.legacy_artisanal_recipe_map
     WHERE legacy_recipe_id = '924e41b8-5050-468f-9ce6-b08c1afab81f'
       AND canonical_recipe_id IS NOT NULL
       AND canonical_recipe_id <> v_recipe_chata_id
  ) THEN
    RAISE EXCEPTION 'Mapa de receita legada ja aponta para outra receita canonica';
  END IF;

  INSERT INTO public.legacy_artisanal_recipe_map (
    legacy_recipe_id, canonical_recipe_id, status, resolution_reason,
    resolved_by, resolved_at
  ) VALUES
    ('30dbed3f-51b9-4db2-9cd7-925f33237a37', v_recipe_overlock_id,
      'resolved', v_reason, v_actor_id, now()),
    ('924e41b8-5050-468f-9ce6-b08c1afab81f', v_recipe_chata_id,
      'resolved', v_reason, v_actor_id, now())
  ON CONFLICT (legacy_recipe_id) DO UPDATE
     SET canonical_recipe_id = EXCLUDED.canonical_recipe_id,
         status = 'resolved',
         resolution_reason = EXCLUDED.resolution_reason,
         resolved_by = EXCLUDED.resolved_by,
         resolved_at = EXCLUDED.resolved_at;

  -- Quatro identidades (2 medidas x 2 cores), sempre reaproveitando os SKUs.
  IF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants
     WHERE measure_id = '06500a23-801d-4627-a927-3ce7e5ee2619'
       AND base_group_id = v_base_group_id
       AND color_id = 'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d'
  ) THEN
    INSERT INTO public.artisanal_strap_variants (
      id, measure_id, base_group_id, identity_basis,
      internal_production_enabled, color_id, finished_product_id,
      min_stock_m, min_stock_replenishment_mode, purchase_enabled,
      status, review_reason
    ) VALUES (
      '5b428b67-b76d-437b-a4c4-325d853a4608',
      '06500a23-801d-4627-a927-3ce7e5ee2619', v_base_group_id,
      'reference_base', true,
      'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d',
      'b46cd0dc-1a85-4330-ab72-0bb8a4329cfc',
      50, 'internal', false, 'active', NULL
    );
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants
     WHERE measure_id = '06500a23-801d-4627-a927-3ce7e5ee2619'::uuid
       AND base_group_id = v_base_group_id
       AND color_id = 'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d'::uuid
       AND finished_product_id = 'b46cd0dc-1a85-4330-ab72-0bb8a4329cfc'::uuid
       AND identity_basis = 'reference_base'
       AND internal_production_enabled
       AND min_stock_m = 50
       AND min_stock_replenishment_mode = 'internal'
       AND NOT purchase_enabled
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Variante OVERLOCK/OFF WHITE diverge do produto acabado validado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants
     WHERE measure_id = '0166b326-2023-4427-a165-aada45ee5611'
       AND base_group_id = v_base_group_id
       AND color_id = 'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d'
  ) THEN
    INSERT INTO public.artisanal_strap_variants (
      id, measure_id, base_group_id, identity_basis,
      internal_production_enabled, color_id, finished_product_id,
      min_stock_m, min_stock_replenishment_mode, purchase_enabled,
      status, review_reason
    ) VALUES (
      '707ac3d8-0a93-4fac-ba78-4ab6832d7ca6',
      '0166b326-2023-4427-a165-aada45ee5611', v_base_group_id,
      'reference_base', true,
      'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d',
      '57123283-6883-4297-981a-08d850a210b2',
      50, 'internal', false, 'active', NULL
    );
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants
     WHERE measure_id = '0166b326-2023-4427-a165-aada45ee5611'::uuid
       AND base_group_id = v_base_group_id
       AND color_id = 'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d'::uuid
       AND finished_product_id = '57123283-6883-4297-981a-08d850a210b2'::uuid
       AND identity_basis = 'reference_base'
       AND internal_production_enabled
       AND min_stock_m = 50
       AND min_stock_replenishment_mode = 'internal'
       AND NOT purchase_enabled
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Variante CHATA 8/OFF WHITE diverge do produto acabado validado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants
     WHERE measure_id = '06500a23-801d-4627-a927-3ce7e5ee2619'
       AND base_group_id = v_base_group_id
       AND color_id = '1f5b09b8-974f-448e-8166-ff3f261867fc'
  ) THEN
    INSERT INTO public.artisanal_strap_variants (
      id, measure_id, base_group_id, identity_basis,
      internal_production_enabled, color_id, finished_product_id,
      min_stock_m, min_stock_replenishment_mode, purchase_enabled,
      status, review_reason
    ) VALUES (
      '2541f9f1-046a-46df-bac3-9981d513250e',
      '06500a23-801d-4627-a927-3ce7e5ee2619', v_base_group_id,
      'reference_base', true,
      '1f5b09b8-974f-448e-8166-ff3f261867fc',
      '5e09e941-7552-408e-bcf9-de143c389d77',
      50, 'internal', false, 'active', NULL
    );
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants
     WHERE measure_id = '06500a23-801d-4627-a927-3ce7e5ee2619'::uuid
       AND base_group_id = v_base_group_id
       AND color_id = '1f5b09b8-974f-448e-8166-ff3f261867fc'::uuid
       AND finished_product_id = '5e09e941-7552-408e-bcf9-de143c389d77'::uuid
       AND identity_basis = 'reference_base'
       AND internal_production_enabled
       AND min_stock_m = 50
       AND min_stock_replenishment_mode = 'internal'
       AND NOT purchase_enabled
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Variante OVERLOCK/COGUMELO diverge do produto acabado validado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants
     WHERE measure_id = '0166b326-2023-4427-a165-aada45ee5611'
       AND base_group_id = v_base_group_id
       AND color_id = '1f5b09b8-974f-448e-8166-ff3f261867fc'
  ) THEN
    INSERT INTO public.artisanal_strap_variants (
      id, measure_id, base_group_id, identity_basis,
      internal_production_enabled, color_id, finished_product_id,
      min_stock_m, min_stock_replenishment_mode, purchase_enabled,
      status, review_reason
    ) VALUES (
      'd6221250-c647-434a-b60c-9cce495e1d9d',
      '0166b326-2023-4427-a165-aada45ee5611', v_base_group_id,
      'reference_base', true,
      '1f5b09b8-974f-448e-8166-ff3f261867fc',
      'd22cc2fc-14de-495d-8d08-70595e91c4aa',
      50, 'internal', false, 'active', NULL
    );
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants
     WHERE measure_id = '0166b326-2023-4427-a165-aada45ee5611'::uuid
       AND base_group_id = v_base_group_id
       AND color_id = '1f5b09b8-974f-448e-8166-ff3f261867fc'::uuid
       AND finished_product_id = 'd22cc2fc-14de-495d-8d08-70595e91c4aa'::uuid
       AND identity_basis = 'reference_base'
       AND internal_production_enabled
       AND min_stock_m = 50
       AND min_stock_replenishment_mode = 'internal'
       AND NOT purchase_enabled
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Variante CHATA 8/COGUMELO diverge do produto acabado validado';
  END IF;

  -- Persiste UUID/medida nas cinco linhas da ficha e registra o mapa que prova
  -- exatamente qual conteudo legado foi resolvido. A cor nao pertence a linha
  -- generica da ficha: ela continua sendo escolhida e congelada no item do PV.
  -- PVs ja persistidos/em producao nao sao reescritos por este bootstrap: e a
  -- decisao fechada para PV-00147/PV-00148/PV-2026-00097 na spec
  -- tira-artesanal-fonte-unica-e-os-cabedal. O pedido novo que originou esta
  -- demanda recebe o retorno do drawer antes de ser salvo.
  v_lines := v_original_lines;
  FOR v_i IN 0..4 LOOP
    v_line := v_original_lines -> v_i;
    IF nullif(v_line ->> 'technical_strap_line_id', '') IS NULL THEN
      INSERT INTO public.technical_strap_line_identity_map (
        technical_sheet_id, legacy_path, legacy_ordinal, content_hash,
        technical_strap_line_id, measure_id, status, resolution_reason,
        resolved_by, resolved_at
      ) VALUES (
        v_reference_id, 'strap_colors', v_i, md5(v_line::text),
        v_seed_line_ids[v_i + 1], v_measure_ids[v_i + 1], 'resolved',
        v_reason, v_actor_id, now()
      )
      ON CONFLICT (technical_sheet_id, legacy_path, legacy_ordinal, content_hash)
      DO UPDATE SET
        measure_id = EXCLUDED.measure_id,
        status = 'resolved',
        resolution_reason = EXCLUDED.resolution_reason,
        resolved_by = EXCLUDED.resolved_by,
        resolved_at = EXCLUDED.resolved_at
      RETURNING technical_strap_line_id INTO v_line_id;
    ELSE
      v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
    END IF;

    v_enriched := (v_line - 'color_id') || jsonb_build_object(
      'id', v_line_id,
      'technical_strap_line_id', v_line_id,
      'measure_id', v_measure_ids[v_i + 1],
      'strap_type_id', v_type_ids[v_i + 1],
      'identity_basis', 'reference_base',
      'identity_group_id', NULL
    );
    v_lines := jsonb_set(v_lines, ARRAY[v_i::text], v_enriched, false);
  END LOOP;

  UPDATE public.technical_sheets
     SET strap_base_group_id = v_base_group_id,
         strap_colors = v_lines,
         updated_at = now()
   WHERE id = v_reference_id;

  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, new_data, success, created_at
  ) VALUES (
    v_actor_id,
    'strap_catalog_bootstrap_approved_by_request',
    'technical_sheets',
    v_reference_id::text,
    jsonb_build_object(
      'base_group_id', v_base_group_id,
      'colors', jsonb_build_array(
        'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d',
        '1f5b09b8-974f-448e-8166-ff3f261867fc'
      ),
      'measure_ids', to_jsonb(v_measure_ids),
      'reason', v_reason,
      'reused_products', jsonb_build_array(
        'b46cd0dc-1a85-4330-ab72-0bb8a4329cfc',
        '57123283-6883-4297-981a-08d850a210b2',
        '5e09e941-7552-408e-bcf9-de143c389d77',
        'd22cc2fc-14de-495d-8d08-70595e91c4aa'
      )
    ),
    true,
    now()
  );
END;
$bootstrap$;

-- Falha cedo se o bootstrap deixou qualquer vinculo incompleto. Em ambientes
-- sem a S-039, o bloco e naturalmente vazio.
DO $verify$
DECLARE
  v_reference_id constant uuid := 'afe01930-4369-4f62-b233-b8ba914513ad';
  v_sheet public.technical_sheets%ROWTYPE;
BEGIN
  SELECT * INTO v_sheet FROM public.technical_sheets WHERE id = v_reference_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_sheet.strap_base_group_id IS DISTINCT FROM '9128e6f6-8fc2-40ca-92dd-c572000e2c2a'::uuid
     OR v_sheet.lining_material_product_id IS NOT NULL
     OR jsonb_array_length(coalesce(v_sheet.strap_colors, '[]'::jsonb)) <> 5
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_sheet.strap_colors) line
        WHERE nullif(line ->> 'technical_strap_line_id', '') IS NULL
           OR nullif(line ->> 'measure_id', '') IS NULL
           OR nullif(line ->> 'strap_type_id', '') IS NULL
           OR line ? 'color_id'
     ) THEN
    RAISE EXCEPTION 'Bootstrap da S-039 deixou a ficha sem identidade canonica completa';
  END IF;

  IF (
    SELECT count(*)
      FROM (VALUES
        ('06500a23-801d-4627-a927-3ce7e5ee2619'::uuid,
         'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d'::uuid,
         'b46cd0dc-1a85-4330-ab72-0bb8a4329cfc'::uuid),
        ('0166b326-2023-4427-a165-aada45ee5611'::uuid,
         'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d'::uuid,
         '57123283-6883-4297-981a-08d850a210b2'::uuid),
        ('06500a23-801d-4627-a927-3ce7e5ee2619'::uuid,
         '1f5b09b8-974f-448e-8166-ff3f261867fc'::uuid,
         '5e09e941-7552-408e-bcf9-de143c389d77'::uuid),
        ('0166b326-2023-4427-a165-aada45ee5611'::uuid,
         '1f5b09b8-974f-448e-8166-ff3f261867fc'::uuid,
         'd22cc2fc-14de-495d-8d08-70595e91c4aa'::uuid)
      ) expected(measure_id, color_id, finished_product_id)
      JOIN public.artisanal_strap_variants variant
        ON variant.measure_id = expected.measure_id
       AND variant.base_group_id = '9128e6f6-8fc2-40ca-92dd-c572000e2c2a'::uuid
       AND variant.color_id = expected.color_id
       AND variant.finished_product_id = expected.finished_product_id
       AND variant.identity_basis = 'reference_base'
       AND variant.internal_production_enabled
       AND variant.min_stock_m = 50
       AND variant.min_stock_replenishment_mode = 'internal'
       AND NOT variant.purchase_enabled
       AND variant.status = 'active'
  ) <> 4 THEN
    RAISE EXCEPTION 'Bootstrap da S-039 esperava quatro variantes ativas nos produtos validados';
  END IF;

  IF (
    SELECT count(*) FROM public.products
     WHERE id IN (
       'b46cd0dc-1a85-4330-ab72-0bb8a4329cfc'::uuid,
       '57123283-6883-4297-981a-08d850a210b2'::uuid,
       '5e09e941-7552-408e-bcf9-de143c389d77'::uuid,
       'd22cc2fc-14de-495d-8d08-70595e91c4aa'::uuid
     )
       AND active
       AND is_artisanal
       AND unit = 'm'
       AND min_stock = 0
  ) <> 4 THEN
    RAISE EXCEPTION 'Piso legado dos produtos acabados nao foi transferido para as variantes';
  END IF;
END;
$verify$;
