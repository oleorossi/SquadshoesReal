-- Ensaio com rollback: lançamento de ficha com TIRA STRASS 15MM / 6MM.
-- Não deixa dados em produção. Rode no SQL editor com transação.

BEGIN;

CREATE TEMP TABLE ensaio_strass (caso text, ok boolean, err text);

CREATE OR REPLACE FUNCTION pg_temp.classify_strass_err(p_sqlstate text, p_msg text)
RETURNS text
LANGUAGE sql
AS $f$
  SELECT CASE
    WHEN p_msg ILIKE '%kit do solado unicolor%' THEN 'ok-identidade (kit unicolor exigiu sessao)'
    WHEN p_msg ILIKE '%comprada pronta%'
      OR p_msg ILIKE '%catalogo ativo desta medida%'
      OR p_msg ILIKE '%producao interna cadastrada%'
      OR p_msg ILIKE '%STRASS por UUID%'
      THEN p_msg
    ELSE p_msg
  END;
$f$;

DO $$
DECLARE
  v_msg text;
  v_state text;
BEGIN
  -- 15mm com medida + finished: antes falhava por falta de variante Hub.
  BEGIN
    INSERT INTO public.technical_sheets (name, code, status_ficha, has_straps, strap_colors)
    VALUES (
      'ENSAIO-STRASS-15-MEDIDA', 'ENS-STRASS-15M', 'rascunho', true,
      jsonb_build_array(jsonb_build_object(
        'technical_strap_line_id', gen_random_uuid(),
        'label', 'TIRA 1',
        'identity_basis', 'finished_product_group',
        'identity_group_id', '6e43bbda-0f1f-412c-8d4a-ec009114530d',
        'group_id', '6e43bbda-0f1f-412c-8d4a-ec009114530d',
        'group_name', 'TIRA STRASS 15MM',
        'measure_id', 'a487b85e-8e3d-4091-9932-41205836b5c0',
        'strap_type_id', '381eb21d-2170-45f7-ab7c-3601a8857ea9',
        'color_mode', 'select_on_order',
        'material_mode', 'follow_reference',
        'consumption', 20
      ))
    );
    INSERT INTO ensaio_strass VALUES ('15mm com medida + finished', true, null);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    IF v_msg ILIKE '%kit do solado unicolor%' THEN
      INSERT INTO ensaio_strass VALUES ('15mm com medida + finished', true, 'ok-identidade (kit unicolor exigiu sessao)');
    ELSE
      INSERT INTO ensaio_strass VALUES ('15mm com medida + finished', false, v_msg);
    END IF;
  END;

  -- 15mm como artesanal + group_id Strass: deve recusar com mensagem clara.
  BEGIN
    INSERT INTO public.technical_sheets (name, code, status_ficha, has_straps, strap_colors)
    VALUES (
      'ENSAIO-STRASS-15-REF', 'ENS-STRASS-15R', 'rascunho', true,
      jsonb_build_array(jsonb_build_object(
        'technical_strap_line_id', gen_random_uuid(),
        'label', 'TIRA 1',
        'identity_basis', 'reference_base',
        'group_id', '6e43bbda-0f1f-412c-8d4a-ec009114530d',
        'group_name', 'TIRA STRASS 15MM',
        'measure_id', 'a487b85e-8e3d-4091-9932-41205836b5c0',
        'strap_type_id', '381eb21d-2170-45f7-ab7c-3601a8857ea9',
        'color_mode', 'follow_main',
        'material_mode', 'follow_reference',
        'consumption', 20
      ))
    );
    INSERT INTO ensaio_strass VALUES ('15mm artesanal deve recusar', false, 'inseriu e nao deveria');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO ensaio_strass VALUES (
      '15mm artesanal deve recusar',
      v_msg ILIKE '%comprada pronta%' OR v_msg ILIKE '%nao usa material base%',
      v_msg
    );
  END;

  -- 6mm finished com medida: já passava na identidade.
  BEGIN
    INSERT INTO public.technical_sheets (name, code, status_ficha, has_straps, strap_colors)
    VALUES (
      'ENSAIO-STRASS-6-MEDIDA', 'ENS-STRASS-6M', 'rascunho', true,
      jsonb_build_array(jsonb_build_object(
        'technical_strap_line_id', gen_random_uuid(),
        'label', 'TIRA 1',
        'identity_basis', 'finished_product_group',
        'identity_group_id', 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
        'group_id', 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
        'group_name', 'TIRA STRASS 6MM',
        'measure_id', '00f07325-347b-4e65-90e6-fed33f70eacc',
        'strap_type_id', '381eb21d-2170-45f7-ab7c-3601a8857ea9',
        'color_mode', 'select_on_order',
        'material_mode', 'follow_reference',
        'consumption', 20
      ))
    );
    INSERT INTO ensaio_strass VALUES ('6mm com medida + finished', true, null);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg ILIKE '%kit do solado unicolor%' THEN
      INSERT INTO ensaio_strass VALUES ('6mm com medida + finished', true, 'ok-identidade (kit unicolor exigiu sessao)');
    ELSE
      INSERT INTO ensaio_strass VALUES ('6mm com medida + finished', false, v_msg);
    END IF;
  END;
END $$;

SELECT * FROM ensaio_strass;
-- Esperado: 15mm finished ok; 15mm artesanal recusado com mensagem de tira pronta; 6mm ok.

ROLLBACK;
