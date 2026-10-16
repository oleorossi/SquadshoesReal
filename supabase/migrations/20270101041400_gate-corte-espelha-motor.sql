-- Gate de material de corte: FONTE ÚNICA de resolução = os resolvedores do motor.
--
-- MOTIVO (PV-00236, 13/10/2026). O gate reimplementava a precedência de material
-- por conta própria e divergia do motor em TRÊS pontos, cada um capaz de barrar
-- um PV inteiro (`promote_sale_order_atomic_internal` transforma a razão do gate
-- em RAISE, e `promotion_atomicity_mode = all_or_nothing`):
--
--   1. FALTAVA O RAMO `variant_main`. `COALESCE(v_var_upper_gid, v_sheet.upper_material_group_id)`
--      não conhecia `reference_material_variants.main_material_group_id` — a coluna
--      preenchida em 81 de 81 variantes ativas, e a ÚNICA preenchida em 72 delas.
--      Medido: a ficha S300 delega o cabedal à variante (`variant_drives_upper`),
--      a variante é GLOW METALIC e o item do PV é CHAMPAGNE. O motor
--      (`resolve_upper_material_for_variant`) resolvia GLOW METALIC/CHAMPAGNE por
--      `matched_by = 'variant_main'`; o gate caía no grupo da ficha (NAPA SOFT),
--      não achava CHAMPAGNE entre as 43 cores dela e devolvia
--      "cadastro incompleto: material de corte (cabedal / cor CHAMPAGNE)".
--      O cadastro estava correto; o gate é que não sabia ler.
--
--   2. PIN DA FICHA NA FRENTE DO GRUPO DA VARIANTE. O gate fazia
--      `COALESCE(v_var_upper_pid, v_sheet.upper_material_product_id)` ANTES de
--      olhar o grupo da variante. No motor o pin da ficha é fallback TARDIO, depois
--      de todos os ramos da variante. Ficha com pin + variante com grupo dava
--      materiais diferentes nos dois lados.
--
--   3. COR COMPARADA SEM `unaccent`. O gate usava `lower(trim(color))`, o motor
--      usa `lower(trim(unaccent(color)))`. Medido: 8 itens de 5 PVs com cor
--      gravada "PICOLE" eram barrados contra o SKU "PICOLÉ" que o motor resolve.
--
-- CONSERTO: o gate NÃO resolve mais material. Ele chama
-- `resolve_upper_material_for_variant` / `resolve_lining_material_for_variant` /
-- `resolve_insole_material_for_variant` — os mesmos que consumo, reserva, débito e
-- custeio usam. Divergência de precedência deixa de ser possível por construção:
-- não há duas cópias para sair de sincronia.
--
-- ⚠ PALMILHA NÃO GANHA RAMO `main`, de propósito.
-- `resolve_insole_material_for_variant` não tem ramo `main` nenhum, e
-- `technical_sheets` não tem coluna `variant_drives_insole`. Acrescentar um ramo
-- "por simetria" com cabedal/forração colocaria o gate à FRENTE do motor — a
-- divergência de volta, só com o sinal trocado.
--
-- ⚠ O PIN DO CONSUMO PADRÃO DO SOLADO (`p_sole_group_id`) NÃO é passado.
-- A sobrecarga de 5 argumentos de `resolve_insole_material_for_variant` honra
-- `sole_group_standard_items.role = 'placa_palmilha'`; aqui é usada a de 4
-- argumentos, que é o equivalente exato do que o gate já fazia (NULL). Resolver
-- o grupo de solado do item aqui seria ADIVINHAR cadastro, e a lacuna é
-- pré-existente — fica registrada, não "consertada" de um lado só.
--
-- SIMULAÇÃO ANTES DE APLICAR (read-only, base inteira, 13/10/2026): 12 vereditos
-- de cadastro mudam, TODOS de "bloqueia" para "libera" (4 do caso GLOW METALIC,
-- 8 do caso PICOLE). ZERO novos bloqueios. Nenhum PV que hoje passa passa a parar.
--
-- ⚠ O contrato antigo (`src/__tests__/productionSequenceCorteMaterialGate.contract.test.ts`)
-- lê o ARQUIVO `20270101031200` e continua verde mesmo que a função viva mude —
-- é a armadilha descrita no CLAUDE.md. O contrato desta mudança é
-- `src/__tests__/corteGateEspelhaMotor.contract.test.ts`, que aponta para ESTE arquivo.

CREATE OR REPLACE FUNCTION public.sale_order_item_corte_material_gate_block_reason(p_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_sheet public.technical_sheets%ROWTYPE;
  v_sector text;
  v_aliases text[];
  v_group_name text;
  v_req numeric;
  v_other numeric;
  v_free numeric;
  v_has_sector boolean;
  -- Escalares, NÃO `record`: atribuir NULL a uma variável `record` em PL/pgSQL é
  -- terreno de "record is not assigned yet", e o corpo de função plpgsql não é
  -- checado na criação — o erro só apareceria com o gate rodando, barrando
  -- aprovação em produção.
  v_res_pid uuid;
  v_res_matched text;
  v_prod_id uuid;
  v_prod_name text;
  v_prod_qty numeric;
  v_prod_unit text;
  v_prod_group uuid;
  v_target_group_name text;
  v_has_any_material boolean;
  v_conv record;
  v_w numeric;
  v_l numeric;
  v_du text;
  v_area numeric;
BEGIN
  IF p_item_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_item FROM public.sale_order_items WHERE id = p_item_id;
  IF NOT FOUND OR v_item.reference_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_sheet FROM public.technical_sheets WHERE id = v_item.reference_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  FOREACH v_sector IN ARRAY ARRAY['cabedal', 'forracao', 'palmilha']
  LOOP
    IF v_sector = 'cabedal' THEN
      v_aliases := ARRAY['corte cabedal'];
      v_group_name := v_sheet.upper_material;
      v_req := COALESCE(v_sheet.upper_consumption, 0) * GREATEST(COALESCE(v_item.quantity, 0), 0);
    ELSIF v_sector = 'forracao' THEN
      v_aliases := ARRAY[
        'corte forração', 'corte forracao',
        'palmilha · forração', 'palmilha · forracao',
        'palmilha - forração'
      ];
      v_group_name := v_sheet.lining_material;
      v_req := COALESCE(v_sheet.lining_consumption, 0) * GREATEST(COALESCE(v_item.quantity, 0), 0);
    ELSE
      v_aliases := ARRAY['corte palmilha'];
      v_group_name := v_sheet.insole_material;
      v_req := COALESCE(v_sheet.insole_consumption, 0) * GREATEST(COALESCE(v_item.quantity, 0), 0);
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(COALESCE(v_sheet.production_sectors, '[]'::jsonb)) = 'array'
                    THEN v_sheet.production_sectors ELSE '[]'::jsonb END
             ) s
       WHERE lower(trim(s)) = ANY (
         SELECT lower(trim(a)) FROM unnest(v_aliases) a
       )
    ) INTO v_has_sector;

    IF NOT v_has_sector THEN
      CONTINUE;
    END IF;

    -- FONTE ÚNICA: a resolução é a do MOTOR. Nenhuma precedência de material é
    -- reimplementada aqui — é exatamente por reimplementá-la que este gate
    -- divergiu em três pontos (ver cabeçalho). Ao mexer em precedência de
    -- material, mexa nos resolvedores; este gate acompanha de graça.
    v_res_pid := NULL;
    v_res_matched := NULL;
    v_prod_id := NULL;
    v_prod_name := NULL;
    v_prod_qty := 0;
    v_prod_unit := NULL;
    v_prod_group := NULL;
    v_target_group_name := NULL;

    IF v_sector = 'cabedal' THEN
      SELECT r.product_id, r.matched_by
        INTO v_res_pid, v_res_matched
        FROM public.resolve_upper_material_for_variant(
               v_item.material_variant_id,
               v_group_name,
               COALESCE(v_item.color, ''),
               0,
               v_sheet.upper_material_product_id
             ) r
       LIMIT 1;
    ELSIF v_sector = 'forracao' THEN
      SELECT r.product_id, r.matched_by
        INTO v_res_pid, v_res_matched
        FROM public.resolve_lining_material_for_variant(
               v_item.material_variant_id,
               v_group_name,
               COALESCE(v_item.color, ''),
               0,
               v_sheet.lining_material_product_id
             ) r
       LIMIT 1;
    ELSE
      SELECT r.product_id, r.matched_by
        INTO v_res_pid, v_res_matched
        FROM public.resolve_insole_material_for_variant(
               v_item.material_variant_id,
               v_group_name,
               COALESCE(v_item.color, ''),
               0
             ) r
       LIMIT 1;
    END IF;

    -- `color_mismatch` é cadastro incompleto, não material resolvido: o grupo é
    -- gerido por cor e a cor do PV não existe nele. Os motores o preservam de
    -- propósito para EXIBIR pendência e RECUSAR reserva/débito — então aqui ele
    -- barra, igual ao que o gate já fazia quando não achava a cor no grupo.
    IF v_res_pid IS NOT NULL
       AND COALESCE(v_res_matched, '') <> 'color_mismatch' THEN
      SELECT p.id, p.name, COALESCE(p.quantity, 0), p.unit, p.group_id
        INTO v_prod_id, v_prod_name, v_prod_qty, v_prod_unit, v_prod_group
        FROM public.products p
       WHERE p.id = v_res_pid
         AND COALESCE(p.active, true)
       LIMIT 1;
    END IF;

    IF v_prod_id IS NULL THEN
      -- Mensagem acionável (decisão do dono, 13/10/2026): dizer ONDE cadastrar.
      -- Em `color_mismatch` o resolvedor devolve um SKU da cor errada, e o grupo
      -- DELE é o grupo em que a cor precisa ser cadastrada.
      IF v_res_pid IS NOT NULL THEN
        SELECT g.name
          INTO v_target_group_name
          FROM public.products p
          JOIN public.product_groups g ON g.id = p.group_id
         WHERE p.id = v_res_pid;
      END IF;

      IF v_target_group_name IS NOT NULL THEN
        RETURN format(
          'cadastro incompleto: material de corte (%s / cor %s não cadastrada no grupo %s)',
          v_sector,
          COALESCE(NULLIF(v_item.color, ''), '—'),
          v_target_group_name
        );
      END IF;

      -- Sem NADA a resolver (nem material na ficha, nem componente na variante)
      -- a falta é de material, não de cor — preserva a mensagem curta original.
      SELECT (
        nullif(trim(COALESCE(v_group_name, '')), '') IS NOT NULL
        OR EXISTS (
          SELECT 1
            FROM public.reference_material_variants v
           WHERE v.id = v_item.material_variant_id
             AND COALESCE(
                   v.upper_material_product_id, v.upper_material_group_id,
                   v.lining_material_product_id, v.lining_material_group_id,
                   v.insole_material_product_id, v.insole_material_group_id,
                   v.main_material_group_id
                 ) IS NOT NULL
        )
      ) INTO v_has_any_material;

      IF NOT v_has_any_material THEN
        RETURN format('cadastro incompleto: material de corte (%s)', v_sector);
      END IF;

      RETURN format(
        'cadastro incompleto: material de corte (%s / cor %s)',
        v_sector,
        COALESCE(NULLIF(v_item.color, ''), '—')
      );
    END IF;

    IF v_req <= 0 THEN
      v_req := 0.01;
    ELSE
      SELECT * INTO v_conv FROM public.get_material_conversion_info(v_prod_id);
      IF v_conv.conversion_warning IS NOT NULL THEN
        RETURN format('cadastro incompleto: largura da bobina (%s)', v_sector);
      END IF;
      IF COALESCE(v_conv.dm2_per_unit, 0) > 0 AND v_conv.dm2_per_unit <> 1 THEN
        v_req := v_req / v_conv.dm2_per_unit;
      ELSIF lower(trim(COALESCE(v_prod_unit, v_conv.target_unit, ''))) IN ('placa', 'placas', 'chapa') THEN
        SELECT COALESCE(NULLIF(cs.dimensions_width, 0), 0),
               COALESCE(NULLIF(cs.dimensions_length, 0), 0),
               COALESCE(cs.dimensions_unit, 'mm')
          INTO v_w, v_l, v_du
          FROM public.component_sheets cs
         WHERE cs.product_id = v_prod_id
            OR (v_prod_group IS NOT NULL AND cs.group_id = v_prod_group
                AND COALESCE(NULLIF(cs.dimensions_width, 0), 0) > 0
                AND COALESCE(NULLIF(cs.dimensions_length, 0), 0) > 0)
         ORDER BY (cs.product_id = v_prod_id) DESC NULLS LAST, cs.updated_at DESC NULLS LAST
         LIMIT 1;
        v_du := lower(trim(COALESCE(v_du, 'mm')));
        IF v_du = 'cm' THEN
          v_w := v_w * 10; v_l := v_l * 10;
        ELSIF v_du = 'dm' THEN
          v_w := v_w * 100; v_l := v_l * 100;
        ELSIF v_du IN ('m', 'metro', 'mt') THEN
          v_w := v_w * 1000; v_l := v_l * 1000;
        END IF;
        v_area := (COALESCE(v_w, 0) * COALESCE(v_l, 0)) / 10000.0;
        IF COALESCE(v_area, 0) > 0 THEN
          v_req := v_req / v_area;
        END IF;
      END IF;
    END IF;

    SELECT COALESCE(SUM(GREATEST(0,
             COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0)
           )), 0)
      INTO v_other
      FROM public.material_reservations mr
      LEFT JOIN public.orders o ON o.id = mr.order_id
     WHERE mr.product_id = v_prod_id
       AND mr.status IN ('reserved', 'pending_reconciliation')
       AND COALESCE(mr.sale_order_id, o.sale_order_id) IS DISTINCT FROM v_item.sale_order_id;

    v_free := GREATEST(0, COALESCE(v_prod_qty, 0) - v_other);

    IF v_req > v_free + 0.000000001 THEN
      RETURN format(
        'falta %s no corte %s (precisa %s, livre %s)',
        COALESCE(v_prod_name, 'material'),
        v_sector,
        trim(to_char(v_req, 'FM999999990.999')),
        trim(to_char(v_free, 'FM999999990.999'))
      );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;

-- Listagem para o selo por item na tela do PV (Q4b). Uma chamada por PV em vez de
-- N chamadas de `sale_order_item_factory_gate_block_reason`.
--
-- Espelha a MESMA condição de "item que o motor vai promover" que
-- `promote_sale_order_atomic_internal` usa: `production_excluded_at IS NULL` e
-- SEM OP ativa. Item que já tem OP ativa não passa pelo gate no motor, então
-- marcá-lo na tela seria avisar de um bloqueio que não existe.
CREATE OR REPLACE FUNCTION public.list_sale_order_factory_gate_blocks(p_sale_order_id uuid)
 RETURNS TABLE(item_id uuid, reference_code text, color text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_sale_order_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT soi.id,
         COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), '?'),
         COALESCE(NULLIF(btrim(soi.color), ''), '—'),
         r.reason
    FROM public.sale_order_items soi
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
    CROSS JOIN LATERAL (
      SELECT public.sale_order_item_factory_gate_block_reason(soi.id) AS reason
    ) r
   WHERE soi.sale_order_id = p_sale_order_id
     AND soi.reference_id IS NOT NULL
     AND soi.production_excluded_at IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.orders o
        WHERE o.sale_order_item_id = soi.id
          AND o.deleted_at IS NULL
          AND o.status NOT IN (
            'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
            'Concluído', 'Concluido', 'Concluída'
          )
     )
     AND NULLIF(btrim(COALESCE(r.reason, '')), '') IS NOT NULL
   ORDER BY ts.code, soi.color;
END;
$function$;

-- Tabela/função nova nasce aberta neste projeto (DEFAULT PRIVILEGES): revogar
-- PRIMEIRO de PUBLIC/anon, conceder depois. Revogar só de `anon` deixaria PUBLIC.
REVOKE ALL ON FUNCTION public.list_sale_order_factory_gate_blocks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sale_order_factory_gate_blocks(uuid) TO authenticated, service_role;
