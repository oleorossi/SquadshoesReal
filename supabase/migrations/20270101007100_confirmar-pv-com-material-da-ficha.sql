-- =============================================================================
-- Confirmacao do PV aceita "material da ficha" como identidade valida
-- =============================================================================
-- Quarto e ultimo dono da mesma regra do dono (21/08/2026): cadastrar variante
-- NAO substitui o material da ficha, e mais uma opcao no pedido.
--
-- Ja corrigidos hoje: (1) o seletor da tela, (2) a validacao de salvamento do
-- front, (3) o trigger enforce_sale_order_item_material_variant. Faltava
-- `capture_material_variant_snapshots_on_sale_order_confirmation`, que dispara
-- quando o PV sai de Rascunho/Pendente e recusa item com material_variant_id
-- NULL sempre que a referencia tem variante ativa:
--
--   'O PV não pode ser confirmado: há itens sem variante comercial válida.'
--
-- Sem esta migration o pedido SALVA e morre na APROVACAO — pior que o bloqueio
-- honesto de antes, porque a parede aparece depois, com o pedido montado.
--
-- POR QUE ACEITAR (medicao de 21/08/2026, antes de mexer)
-- O guard existe para garantir SKU comercial para NF/devolucao/etiqueta. Mas o
-- proprio historico ja contradiz a premissa: ha 295 itens com variante nula em
-- PVs confirmados, 215 deles em referencias COM variante ativa, e 63 ja saíram
-- em NF-e AUTORIZADA. O caminho fiscal tem fallback pela propria referencia; o
-- guard (mig 20270101004300) veio para PARAR esse padrao, nao porque quebrasse.
--
-- Decisao do dono, com esses numeros a vista:
--   * estender a excecao aqui tambem;
--   * na venda em "material da ficha", SKU/NCM sao os da PROPRIA REFERENCIA,
--     como ja acontece nos 63 itens faturados;
--   * NAO tocar no historico (295 linhas): PV aprovado, produzido e em 63 casos
--     faturado e fato consumado; variante retroativa mudaria consumo, custo e
--     debito do que ja aconteceu.
--
-- ⚠ ESCOPO MINIMO: so o ramo "NULL + referencia tem variante ativa" ganha a
-- excecao. Os outros motivos de recusa continuam intactos — variante
-- inexistente, de outra referencia, inativa, ou SEM SKU. E a "defesa final" do
-- snapshot so olha itens COM variante, entao nao muda.

BEGIN;

CREATE OR REPLACE FUNCTION public.capture_material_variant_snapshots_on_sale_order_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_previous_refresh_order_id text;
  v_invalid_variants text;
  v_invalid_snapshot_items text;
BEGIN
  IF COALESCE(OLD.status, '') IN ('Rascunho', 'Pendente')
     AND NULLIF(btrim(COALESCE(NEW.status, '')), '') IS NOT NULL
     AND NEW.status NOT IN ('Rascunho', 'Pendente', 'Cancelado', 'Cancelada') THEN
    SELECT string_agg(
             format(
               'item=%s referencia=%s variante=%s motivo=%s',
               q.sale_order_item_id,
               COALESCE(q.reference_id::text, '<NULL>'),
               COALESCE(q.material_variant_id::text, '<NULL>'),
               q.reason
             ),
             E'\n'
           )
      INTO v_invalid_variants
    FROM (
      SELECT soi.id AS sale_order_item_id,
             soi.reference_id,
             soi.material_variant_id,
             CASE
               WHEN soi.material_variant_id IS NULL
                 THEN 'referência possui variante ativa, mas o item não selecionou uma'
               WHEN rmv.id IS NULL
                 THEN 'variante inexistente'
               WHEN rmv.reference_id IS DISTINCT FROM soi.reference_id
                 THEN 'variante pertence a outra referência'
               WHEN NOT COALESCE(rmv.active, false)
                 THEN 'variante inativa'
               WHEN NULLIF(btrim(COALESCE(rmv.sku, '')), '') IS NULL
                 THEN 'variante sem SKU comercial'
             END AS reason
      FROM public.sale_order_items soi
      LEFT JOIN public.reference_material_variants rmv
        ON rmv.id = soi.material_variant_id
      WHERE soi.sale_order_id = NEW.id
        AND (
          (
            soi.material_variant_id IS NULL
            -- Excecao: quando o material da PROPRIA ficha e oferecido no
            -- seletor, NULL e a escolha "material da ficha" — nao ausencia de
            -- escolha. SKU/NCM saem da referencia, como nos 63 itens sem
            -- variante que ja foram emitidos em NF-e autorizada.
            AND NOT public.sheet_material_is_selectable(soi.reference_id)
            AND EXISTS (
              SELECT 1
              FROM public.reference_material_variants candidate
              WHERE candidate.reference_id = soi.reference_id
                AND candidate.active
            )
          )
          OR (
            soi.material_variant_id IS NOT NULL
            AND (
              rmv.id IS NULL
              OR rmv.reference_id IS DISTINCT FROM soi.reference_id
              OR NOT COALESCE(rmv.active, false)
              OR NULLIF(btrim(COALESCE(rmv.sku, '')), '') IS NULL
            )
          )
        )
      ORDER BY soi.id
      LIMIT 100
    ) q;

    IF v_invalid_variants IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'O PV não pode ser confirmado: há itens sem variante comercial válida.',
        DETAIL = v_invalid_variants,
        HINT = 'Em Rascunho/Pendente, selecione uma variante ativa da própria referência com SKU cadastrado.';
    END IF;

    -- O marcador é local à transação e combinado com trigger depth. O UPDATE
    -- nomeia exclusivamente a coluna de snapshot; o BEFORE trigger do item a
    -- reconstrói pelo builder canônico e os cinco AFTER triggers genéricos
    -- vivos abaixo ignoram somente esta escrita interna estreita.
    v_previous_refresh_order_id := current_setting(
      'app.material_variant_snapshot_confirmation_order_id',
      true
    );
    PERFORM set_config(
      'app.material_variant_snapshot_confirmation_order_id',
      NEW.id::text,
      true
    );

    UPDATE public.sale_order_items soi
       SET material_variant_commercial_snapshot = soi.material_variant_commercial_snapshot
     WHERE soi.sale_order_id = NEW.id
       AND soi.material_variant_id IS NOT NULL;

    -- Defesa final: a confirmação só termina quando todo snapshot de variante
    -- possui o SKU que será usado por NF/devolução/etiqueta. Continua olhando
    -- somente itens COM variante — item em "material da ficha" nao tem snapshot
    -- de variante a validar, por definicao.
    SELECT string_agg(soi.id::text, ', ' ORDER BY soi.id)
      INTO v_invalid_snapshot_items
    FROM public.sale_order_items soi
    WHERE soi.sale_order_id = NEW.id
      AND soi.material_variant_id IS NOT NULL
      AND NULLIF(btrim(COALESCE(
            soi.material_variant_commercial_snapshot ->> 'sku',
            ''
          )), '') IS NULL;

    IF v_invalid_snapshot_items IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'O PV não pode ser confirmado: o snapshot comercial final ficou sem SKU.',
        DETAIL = format('Itens: %s', v_invalid_snapshot_items);
    END IF;

    PERFORM set_config(
      'app.material_variant_snapshot_confirmation_order_id',
      COALESCE(v_previous_refresh_order_id, ''),
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $assertions$
DECLARE
  v_def text;
  v_motivo text;
  v_sr02 uuid;
  v_ainda_exigem integer;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc WHERE oid = 'public.capture_material_variant_snapshots_on_sale_order_confirmation'::regproc;

  -- A excecao tem que estar no ramo do NULL, e os outros motivos intactos.
  IF v_def NOT LIKE '%NOT public.sheet_material_is_selectable(soi.reference_id)%' THEN
    RAISE EXCEPTION 'A excecao do material da ficha nao ficou no guard de confirmacao';
  END IF;
  FOREACH v_motivo IN ARRAY ARRAY[
    'variante inexistente',
    'variante pertence a outra referência',
    'variante inativa',
    'variante sem SKU comercial',
    'o snapshot comercial final ficou sem SKU'
  ] LOOP
    IF v_def NOT LIKE '%' || v_motivo || '%' THEN
      RAISE EXCEPTION 'Motivo de recusa perdido na reescrita: %', v_motivo;
    END IF;
  END LOOP;

  SELECT id INTO v_sr02 FROM public.technical_sheets WHERE upper(name) = 'SR02' LIMIT 1;
  IF v_sr02 IS NULL OR NOT public.sheet_material_is_selectable(v_sr02) THEN
    RAISE EXCEPTION 'SR02 deveria aceitar o material da ficha na confirmacao';
  END IF;

  -- A guarda continua valendo onde a base ja e coberta por variante.
  SELECT count(*) INTO v_ainda_exigem
    FROM (SELECT DISTINCT rmv.reference_id FROM public.reference_material_variants rmv
           WHERE rmv.active) r
   WHERE NOT public.sheet_material_is_selectable(r.reference_id);
  IF v_ainda_exigem = 0 THEN
    RAISE EXCEPTION 'Nenhuma referencia continua exigindo variante — a guarda foi anulada';
  END IF;
END;
$assertions$;

COMMIT;
