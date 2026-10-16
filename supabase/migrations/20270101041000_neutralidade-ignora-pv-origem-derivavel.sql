-- =============================================================================
-- Neutralidade de PV: pv_origem DERIVÁVEL não é mudança de demanda
-- =============================================================================
-- Sintoma (PV-00195, 13/10/2026): o dono mudou só a NF-e e o CNPJ emitente e o
-- save foi recusado com
--   "O pedido NÃO foi salvo. Pedido ainda não está pronto:
--    Existem OPs avançadas fora de cancel_op_ids.."
--
-- A escapatória documental da 20270101024100 está VIVA e correta (marcador
-- presente em execute_sale_order_command e em preflight_sale_order_command, as
-- duas decisões de cancel_op_ids guardadas por NOT
-- sale_order_update_is_production_neutral). Ela só nunca era ALCANÇADA.
--
-- Causa: o payload de update NÃO é round-trip do banco. No topo de TODO
-- handleSubmit, `recoverEmptyStrapSnapshotsForSubmit`
-- (src/lib/strapSnapshotGuard.ts) injeta `pv_origem` em toda linha de tira que
-- não tem a chave mas tem `source_mode` gravado em `strap_sourcing`. Como a
-- neutralidade compara `strap_colors` por igualdade jsonb PROFUNDA, uma chave a
-- mais em UMA linha reprova o payload inteiro como edição fabril.
--
-- Medido em 13/10/2026 na função viva, com os dados do PV-00195:
--   payload verbatim do banco ............................. TRUE
--   mesmo payload + hidratação de pv_origem do cliente .... FALSE
-- As 2 linhas culpadas: COBRE/122d67e3 e OFF WHITE/8b9d11fb, ambas buy_ready.
-- As 3 OPs do PV estão "Em Produção" com ZERO apontamentos.
--
-- Correção: a comparação passa a ser cega à chave DERIVÁVEL. `pv_origem` é
-- derivável de `strap_sourcing.source_mode` — que a própria função já compara
-- em separado —, logo contá-la dentro de `strap_colors` conta o mesmo dado duas
-- vezes. O normalizador preenche a chave AUSENTE nos DOIS lados, com a MESMA
-- regra do cliente, antes de comparar.
--
-- O que continua reprovando (de propósito):
--   * pv_origem EXPLÍCITO diferente entre payload e banco (fabrica x prestador)
--   * mudança de source_mode (pega aqui E na comparação de strap_sourcing)
--   * qualquer outro campo da linha de tira (cor, identidade, material)
--
-- NÃO conserta o cliente de propósito: suprimir a hidratação em PV comprometido
-- mudaria o ramo que `prepare_sale_order_item_internal_straps` toma numa edição
-- REAL (ramo v_sheet_basis='reference_base' AND pv_origem='sku_acabado', migs
-- 20270101031900 / 20270101040200). Cegar a COMPARAÇÃO preserva o payload para
-- o writer e resolve a classe inteira no servidor.
--
-- Marcador: neutralidade_ignora_pv_origem_derivavel_20270101041000
-- =============================================================================

-- Espelha `technicalStrapLineId` (src/lib/technicalStrapLines.ts):
-- technical_strap_line_id tem precedência sobre id, e ambos só valem como
-- identidade se forem UUID textual. Sem isso, um rótulo qualquer na chave `id`
-- viraria chave de lookup no strap_sourcing e a derivação divergiria do cliente.
CREATE OR REPLACE FUNCTION private.strap_line_sourcing_key(p_line jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  -- neutralidade_ignora_pv_origem_derivavel_20270101041000
  SELECT CASE
    WHEN (p_line ->> 'technical_strap_line_id') ~*
         '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      THEN p_line ->> 'technical_strap_line_id'
    WHEN (p_line ->> 'id') ~*
         '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      THEN p_line ->> 'id'
    ELSE NULL
  END;
$fn$;

-- O normalizador espelha `recoverEmptyStrapSnapshotsForSubmit` + o
-- `technicalStrapLineId` do TS (technical_strap_line_id tem precedência sobre
-- id, e ambos precisam ser UUID textual).
--
-- ⚠ internal -> 'fabrica' é o que o CLIENTE faz, e é um CHUTE: medido em
-- 13/10/2026, source_mode='internal' aparece com pv_origem='fabrica' em 504
-- linhas e 'prestador' em 228 (31%). Aqui isso é INÓCUO porque a mesma regra é
-- aplicada aos DOIS lados — o objetivo é neutralizar a derivação do cliente,
-- não afirmar qual é a origem certa. Por isso esta função NUNCA deve ser usada
-- para GRAVAR pv_origem; o backfill (20270101041100) só materializa buy_ready,
-- que é inequívoco (77/77).
CREATE OR REPLACE FUNCTION private.strap_colors_neutrality_shape(
  p_strap_colors jsonb,
  p_strap_sourcing jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  -- neutralidade_ignora_pv_origem_derivavel_20270101041000
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN line.value ->> 'pv_origem'
             IN ('fabrica', 'prestador', 'sku_acabado')
          THEN line.value
        WHEN COALESCE(p_strap_sourcing, '{}'::jsonb)
             -> private.strap_line_sourcing_key(line.value)
             ->> 'source_mode' = 'buy_ready'
          THEN line.value || jsonb_build_object('pv_origem', 'sku_acabado')
        WHEN COALESCE(p_strap_sourcing, '{}'::jsonb)
             -> private.strap_line_sourcing_key(line.value)
             ->> 'source_mode' = 'internal'
          THEN line.value || jsonb_build_object('pv_origem', 'fabrica')
        ELSE line.value
      END
      ORDER BY line.ordinality
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(p_strap_colors) = 'array' THEN p_strap_colors
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS line(value, ordinality);
$fn$;

REVOKE ALL ON FUNCTION private.strap_line_sourcing_key(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.strap_colors_neutrality_shape(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.strap_line_sourcing_key(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.strap_colors_neutrality_shape(jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION private.strap_colors_neutrality_shape(jsonb, jsonb) IS
  'Preenche pv_origem AUSENTE a partir de strap_sourcing.source_mode, igual ao cliente. Só para COMPARAR — nunca para gravar.';

-- Patch do corpo VIVO (idioma da 20270101024100): não recopiamos a função.
-- Recopiar é como a classe "guarda perdida em CREATE OR REPLACE" nasce — e foi
-- exatamente a hipótese que tivemos de refutar neste incidente. Aqui lemos
-- pg_get_functiondef, trocamos UMA âncora e reexecutamos. Idempotente pelo
-- marcador.
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'sale_order_update_is_production_neutral'
     AND pg_get_function_identity_arguments(p.oid) = 'p_sale_order_id uuid, p_header jsonb, p_items jsonb';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'sale_order_update_is_production_neutral(uuid,jsonb,jsonb) não existe no banco';
  END IF;

  IF position('neutralidade_ignora_pv_origem_derivavel_20270101041000' IN v_def) > 0 THEN
    RETURN;
  END IF;

  IF position('pv_header_save_skips_op_rewrite_20270101024100' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Corpo vivo sem o marcador da 20270101024100 — a escapatória documental regrediu; pare e investigue antes de patchar';
  END IF;

  v_old := $old$         OR CASE
              WHEN jsonb_typeof(proposed.value -> 'strap_colors') = 'array'
                THEN proposed.value -> 'strap_colors'
              ELSE '[]'::jsonb
            END IS DISTINCT FROM COALESCE(soi.strap_colors, '[]'::jsonb)$old$;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora de strap_colors de sale_order_update_is_production_neutral não encontrada';
  END IF;

  -- O lado PROPOSTO deriva do strap_sourcing que o próprio payload traz (é dele
  -- que o cliente deriva); sem a chave no payload, cai no gravado. O lado
  -- GRAVADO sempre deriva do gravado.
  v_new := $new$         -- neutralidade_ignora_pv_origem_derivavel_20270101041000
         -- pv_origem AUSENTE e preenchido nos DOIS lados antes de comparar:
         -- e derivavel de strap_sourcing.source_mode, que ja e comparado em
         -- separado logo abaixo. Conta-lo aqui contava o mesmo dado 2x e fazia
         -- a hidratacao do cliente (recoverEmptyStrapSnapshotsForSubmit) virar
         -- "mudanca de demanda" num save que so mexeu em NF/CNPJ emitente.
         OR private.strap_colors_neutrality_shape(
              CASE
                WHEN jsonb_typeof(proposed.value -> 'strap_colors') = 'array'
                  THEN proposed.value -> 'strap_colors'
                ELSE '[]'::jsonb
              END,
              CASE
                WHEN jsonb_typeof(proposed.value -> 'strap_sourcing') = 'object'
                  THEN proposed.value -> 'strap_sourcing'
                ELSE COALESCE(soi.strap_sourcing, '{}'::jsonb)
              END
            ) IS DISTINCT FROM private.strap_colors_neutrality_shape(
              COALESCE(soi.strap_colors, '[]'::jsonb),
              COALESCE(soi.strap_sourcing, '{}'::jsonb)
            )$new$;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$patch$;

COMMENT ON FUNCTION public.sale_order_update_is_production_neutral(uuid, jsonb, jsonb) IS
  'True quando o payload de update não altera demanda/embalagem/terceirização — NF/OC/notas e pv_origem derivável não entram.';
