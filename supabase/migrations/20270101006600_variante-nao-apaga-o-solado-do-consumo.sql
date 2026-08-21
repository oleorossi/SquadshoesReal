-- =============================================================================
-- Variante de material: parar de APAGAR o solado do consumo + tornar visível a
-- variante que não dirige componente nenhum
-- =============================================================================
-- Origem: 20/08/2026. O dono cadastrou a variante GLOW METALIC na ficha SR02 e,
-- no PV, o seletor de Cor Principal veio VAZIO ("Nenhuma cor encontrada") e o
-- corte continuou saindo da napa da ficha. Ao investigar apareceram DOIS
-- problemas distintos, um de cadastro e um de motor.
--
-- ── 1. Cadastro: variante que não dirige componente nenhum ───────────────────
-- `main_material_group_id` só entra na resolução depois que a ficha libera o
-- slot em `technical_sheets.variant_drives_*` (mig 20261027120000). A variante
-- salva só com material principal e com as travas desligadas é um NO-OP
-- silencioso: o PV mostra nome/SKU da variante, a lista de cores vem vazia
-- (`resolveMaterialVariantColorGroup` devolve null) e produção/débito seguem no
-- material da ficha. A caixa de seleção existia, mas escondida na aba Materiais
-- da ficha — o diálogo da variante só APONTAVA pra ela.
--
-- O conserto principal é de UI (a decisão passou pro próprio diálogo da
-- variante, e salvar um no-op agora é recusado). Aqui fica a rede: o backfill
-- determinístico e um check no relatório de consistência.
--
-- ── 2. Motor: escolher variante APAGAVA o solado ─────────────────────────────
-- `calculate_order_consumption_by_grade` fazia, incondicionalmente:
--
--     SELECT product_id INTO v_variant_sole_pid FROM resolve_sole_for_variant_color(...);
--     v_sole_product_id := v_variant_sole_pid;   -- ← clobber
--
-- `resolve_sole_for_variant_color` é resolver de OVERRIDE: `IF v_pinned_id IS
-- NULL THEN RETURN; END IF` — devolve ZERO linhas quando a variante não tem
-- `sole_material_product_id`. Em plpgsql, `SELECT INTO` sem linhas grava NULL,
-- então a atribuição jogava fora o solado que `resolve_sole_color` já havia
-- resolvido corretamente.
--
-- Medido em 20/08/2026: as **68 variantes ativas** estão sem pin de solado, ou
-- seja, o clobber valia para TODAS. SR02 + GLOW METALIC, 36 pares:
--
--   sem variante → Solado '01', source primary_sole, required 36, debit hard
--   com variante → source unresolved, required 0
--
-- Três consequências, todas dentro da mesma função:
--   a) o solado sai do consumo, do custeio e do MRP (a reserva/baixa física
--      escapa porque `try_reserve_materials` também chama
--      `debit_sole_stock_by_grade`, que faz o fallback CERTO — é essa função
--      que prova a semântica pretendida: pin da variante VENCE, mas não APAGA);
--   b) `v_suppress_cabedal_lining` depende do solado pra saber se o solado
--      dirige o forro da palmilha. Com o solado NULL a supressão vira no-op e
--      a linha fantasma "Forração" do cabedal volta — a MESMA napa contada 2×
--      (bug PV-00146, ver CLAUDE.md);
--   c) `v_is_fachetado` e `v_is_palmilha_pronta` também leem do solado, então
--      fachete nunca era emitido em item com variante.
--
-- ⚠ Isto era divergência TS × SQL, não erro dos dois lados: `orderConsumption.ts`
-- já fazia `variant?.sole_material_product_id ? variantSolePid : resolveSole...`
-- — a TELA mostrava o solado que o snapshot do servidor descartava.

BEGIN;

-- ── 1. Backfill determinístico da cascata ───────────────────────────────────
-- Liga a trava SOMENTE quando não há o que decidir: a ficha tem variante em
-- no-op, nenhuma trava ligada e UM único componente de material cadastrado.
-- Ficha com cabedal E forração fica de fora de propósito — ali a escolha é do
-- dono, e é ela que protege material de IDENTIDADE (a PALHA do cabedal do
-- DS21/DS19 não vira napa porque o PV vendeu GLOW METALIC). Idempotente: a
-- segunda execução não acha mais linha em no-op.
WITH noop_sheets AS (
  SELECT DISTINCT ts.id,
         NULLIF(btrim(ts.upper_material), '')  AS upper_material,
         NULLIF(btrim(ts.lining_material), '') AS lining_material
    FROM public.technical_sheets ts
    JOIN public.reference_material_variants v ON v.reference_id = ts.id
   WHERE COALESCE(v.active, true)
     AND v.main_material_group_id IS NOT NULL
     AND v.upper_material_product_id  IS NULL AND v.upper_material_group_id  IS NULL
     AND v.lining_material_product_id IS NULL AND v.lining_material_group_id IS NULL
     AND v.insole_material_product_id IS NULL AND v.insole_material_group_id IS NULL
     AND NOT COALESCE(ts.variant_drives_upper, false)
     AND NOT COALESCE(ts.variant_drives_lining, false)
     AND NOT COALESCE(ts.variant_drives_fachete, false)
)
UPDATE public.technical_sheets ts
   SET variant_drives_upper  = (n.upper_material IS NOT NULL),
       variant_drives_lining = (n.lining_material IS NOT NULL),
       updated_at = now()
  FROM noop_sheets n
 WHERE ts.id = n.id
   -- exatamente UM componente cadastrado (XOR)
   AND ((n.upper_material IS NOT NULL) <> (n.lining_material IS NOT NULL));

-- ── 2. O clobber do solado ──────────────────────────────────────────────────
-- Patch por substituição de âncora, como a mig 20261027120000 fez no fachete:
-- transcrever os ~47k caracteres da função seria a via mais provável de
-- introduzir erro. Falha ALTO se a âncora sumir — nunca silenciosamente.
DO $patch$
DECLARE v_src text; v_new text; v_target text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_order_consumption_by_grade'
     AND pg_get_function_identity_arguments(p.oid) = 'p_reference_id uuid, p_grade jsonb, p_color text, p_material_variant_id uuid';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'calculate_order_consumption_by_grade(uuid,jsonb,text,uuid) nao encontrada';
  END IF;

  v_target := 'v_sole_product_id := v_variant_sole_pid;';
  IF position(v_target IN v_src) = 0 THEN
    RAISE EXCEPTION 'Atribuicao do solado da variante nao encontrada - a funcao mudou; revisar o patch antes de aplicar.';
  END IF;

  -- COALESCE: o pin da variante VENCE o solado da ficha, mas a AUSÊNCIA de pin
  -- não é uma decisão de "sem solado". Mesma semântica de
  -- debit_sole_stock_by_grade e de orderConsumption.ts. `v_variant_sole_pid`
  -- continua NULL sem pin, então o campo `source` segue dizendo 'primary_sole'.
  v_new := replace(v_src, v_target, 'v_sole_product_id := COALESCE(v_variant_sole_pid, v_sole_product_id);');

  IF v_new = v_src THEN
    RAISE EXCEPTION 'Patch do solado da variante nao alterou nada';
  END IF;

  EXECUTE v_new;
END
$patch$;

-- Prova sobre dado real: SR02 + GLOW METALIC (variante sem pin de solado) tem
-- que devolver a MESMA linha de solado que o item sem variante devolve.
DO $verify$
DECLARE
  v_sheet uuid;
  v_variant uuid;
  v_grade jsonb := '{"34":3,"35":3,"36":6,"37":9,"38":9,"39":3,"40":3}'::jsonb;
  v_sem jsonb; v_com jsonb;
BEGIN
  SELECT ts.id, v.id INTO v_sheet, v_variant
    FROM public.technical_sheets ts
    JOIN public.reference_material_variants v ON v.reference_id = ts.id
   WHERE upper(btrim(ts.name)) = 'SR02' AND COALESCE(v.active, true)
     AND v.sole_material_product_id IS NULL
   LIMIT 1;

  IF v_sheet IS NULL THEN
    RAISE NOTICE 'SR02 sem variante ativa - verificacao pulada';
    RETURN;
  END IF;

  SELECT e INTO v_sem FROM jsonb_array_elements(
    public.calculate_order_consumption_by_grade(v_sheet, v_grade, 'PRATA', NULL)) e
   WHERE e->>'component' = 'Solado';
  SELECT e INTO v_com FROM jsonb_array_elements(
    public.calculate_order_consumption_by_grade(v_sheet, v_grade, 'PRATA', v_variant)) e
   WHERE e->>'component' = 'Solado';

  IF v_sem IS NULL OR v_sem->>'product_id' IS NULL THEN
    RAISE NOTICE 'SR02 nao resolve solado nem sem variante - fora do escopo deste patch';
    RETURN;
  END IF;

  IF v_com IS NULL OR (v_com->>'product_id') IS DISTINCT FROM (v_sem->>'product_id') THEN
    RAISE EXCEPTION 'Variante ainda apaga o solado: sem=% com=%',
      v_sem->>'product_id', COALESCE(v_com->>'product_id', 'NULL');
  END IF;
END
$verify$;

-- ── 3. Check novo no relatório de consistência ──────────────────────────────
-- Mesmo com a UI recusando o no-op, dado antigo (ou escrito por SQL Editor /
-- import) precisa de alarme: sem ele a variante "existe" e o cadastro parece
-- feito. Injetado por substituição pelo mesmo motivo do patch acima.
DO $patch$
DECLARE v_src text; v_new text; v_target text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'consumption_consistency_report'
     AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'consumption_consistency_report() nao encontrada';
  END IF;

  IF position('variante_nao_dirige_componente' IN v_src) > 0 THEN
    RAISE NOTICE 'check ja presente - nada a fazer';
    RETURN;
  END IF;

  v_target := E'\nEND;\n$function$';
  IF position(v_target IN v_src) = 0 THEN
    RAISE EXCEPTION 'Fim do corpo de consumption_consistency_report() nao encontrado - revisar o patch.';
  END IF;

  v_new := replace(v_src, v_target, E'\n'
    || E'  RETURN QUERY\n'
    || E'  SELECT ''variante_nao_dirige_componente''::text, ''alto''::text, count(*)::int,\n'
    || E'    COALESCE(string_agg(DISTINCT ts.name || '' / '' || v.material_name, '' - ''), ''-'')\n'
    || E'    FROM public.reference_material_variants v\n'
    || E'    JOIN public.technical_sheets ts ON ts.id = v.reference_id\n'
    || E'   WHERE COALESCE(v.active, true)\n'
    || E'     AND v.main_material_group_id IS NOT NULL\n'
    || E'     AND v.upper_material_product_id  IS NULL AND v.upper_material_group_id  IS NULL\n'
    || E'     AND v.lining_material_product_id IS NULL AND v.lining_material_group_id IS NULL\n'
    || E'     AND v.insole_material_product_id IS NULL AND v.insole_material_group_id IS NULL\n'
    || E'     AND NOT COALESCE(ts.variant_drives_upper, false)\n'
    || E'     AND NOT COALESCE(ts.variant_drives_lining, false)\n'
    || E'     AND NOT COALESCE(ts.variant_drives_fachete, false);\n'
    || v_target);

  IF v_new = v_src THEN
    RAISE EXCEPTION 'Patch do check de variante nao alterou nada';
  END IF;

  EXECUTE v_new;
END
$patch$;

COMMIT;
