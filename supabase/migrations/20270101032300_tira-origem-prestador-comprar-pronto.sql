-- =============================================================================
-- Tiras — Fatia 1 (specs/tiras-redesenho.md, Revisão 2: R1, R2, R14)
-- Origem = Prestador | Comprar pronto. Sai o "Fazer na fábrica".
-- =============================================================================
-- A fábrica nunca corta tira. O caminho "interno" que já existia (napa-base,
-- receita, rendimento, napa necessária) passa a SIGNIFICAR Prestador: a napa
-- vai ao prestador, que devolve a tira. Os valores gravados NÃO mudam:
--   sale_order_items.strap_colors[].pv_origem  'fabrica' | 'prestador' → Prestador
--                                              'sku_acabado'           → Comprar pronto
--   strap_sourcing.source_mode                 'internal' → Prestador, 'buy_ready' → Comprar pronto
--   artisanal_strap_measures.origem_padrao     'sempre_fabrica' | 'escolhe_no_pv' → padrão Prestador
--                                              'sempre_sku_acabado'               → padrão Comprar pronto
-- Por isso os PVs abertos NÃO precisam de conversão de dado: internal == Prestador.
--
-- R2: o catálogo dá o PADRÃO; o PV troca na exceção, em QUALQUER medida.
-- O writer (prepare_sale_order_item_internal_straps) já honrava `pv_origem`
-- explícito da linha e NUNCA leu `origem_padrao` — a regra "Hub fixo ganha"
-- vivia só no cliente. O que faltava no servidor era o PADRÃO: linha
-- reference_base sem `pv_origem` caía sempre em internal, mesmo com o catálogo
-- mandando Comprar pronto. Este patch preenche `pv_origem` ausente com o
-- padrão da medida, ANTES da coerção da 28600 (Comprar pronto sem group_id na
-- ficha → Prestador) e do ramo Comprar pronto da 31900 (cria/acha o SKU
-- acabado da Cor Principal). Escolha explícita do PV nunca é tocada.
--
-- Linha `finished_product_group` (Strass da ficha) continua buy_ready por
-- identidade: não há napa para mandar ao prestador.
--
-- Os 8 `escolhe_no_pv` NÃO são convertidos: significam o mesmo que
-- `sempre_fabrica` (padrão Prestador) e o CHECK continua aceitando os três.
--
-- Patch por substituição de texto do corpo vivo (padrão 24000/28500/28600/
-- 31900/32200); falha alto se o trecho esperado não existir.
-- Marcador: strap_pv_origem_padrao_catalogo_20270101032300
-- =============================================================================

DO $patch_prepare$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old_gate text := $old_gate$    -- strap_pv_sku_acabado_fornecedor_20270101024000
    -- strap_pv_sku_sem_group_id_vira_fabrica_20270101028600
    IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado'
       AND nullif(v_line ->> 'group_id', '') IS NULL
       AND nullif(v_line ->> 'identity_group_id', '') IS NULL THEN$old_gate$;
  v_new_gate text := $new_gate$    -- strap_pv_origem_padrao_catalogo_20270101032300
    -- R2: sem escolha explicita do PV vale o PADRAO do catalogo (medida).
    -- sempre_sku_acabado -> Comprar pronto; sempre_fabrica/escolhe_no_pv ->
    -- Prestador (valor gravado 'fabrica'). Escolha explicita nunca e tocada.
    IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') IS NULL THEN
      v_line := v_line || jsonb_build_object(
        'pv_origem',
        CASE
          WHEN EXISTS (
            SELECT 1
              FROM public.artisanal_strap_measures measure
             WHERE measure.id = v_measure_id
               AND measure.origem_padrao = 'sempre_sku_acabado'
          ) THEN 'sku_acabado'
          ELSE 'fabrica'
        END
      );
    END IF;
    -- strap_pv_sku_acabado_fornecedor_20270101024000
    -- strap_pv_sku_sem_group_id_vira_fabrica_20270101028600
    IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado'
       AND nullif(v_line ->> 'group_id', '') IS NULL
       AND nullif(v_line ->> 'identity_group_id', '') IS NULL THEN$new_gate$;
  v_old_msg text := $old_msg$tira pronta exige o grupo acabado (group_id) na ficha — use Fazer (fábrica) ou cadastre o grupo acabado na ficha técnica$old_msg$;
  v_new_msg text := $new_msg$tira pronta exige o grupo acabado (group_id) na ficha — use Prestador ou cadastre o grupo acabado na ficha técnica$new_msg$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_origem_padrao_catalogo_20270101032300' IN v_def) > 0 THEN
    RETURN; -- já aplicado
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old_gate, ''))
  ) / nullif(length(v_old_gate), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Gate 24000/28600 do prepare nao encontrado (hits=%); corpo mudou, revise 32300',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old_gate, v_new_gate);

  v_hits := (
    length(v_def) - length(replace(v_def, v_old_msg, ''))
  ) / nullif(length(v_old_msg), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Mensagem de tira pronta sem group_id (28500) nao encontrada (hits=%); revise 32300',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old_msg, v_new_msg);
END;
$patch_prepare$;

COMMENT ON COLUMN public.artisanal_strap_measures.origem_padrao IS
  'PADRAO de origem da tira no PV (R2, tiras-redesenho Revisao 2): sempre_sku_acabado = Comprar pronto; sempre_fabrica e escolhe_no_pv (legado) = Prestador (a napa vai ao prestador; a fabrica nao corta tira). O PV pode trocar na excecao via strap_colors[].pv_origem.';
COMMENT ON COLUMN public.artisanal_strap_measures.preco_artesanal_per_m IS
  'Mao de obra R$/m do prestador para a tira de origem Prestador (Hub). Propaga transformation_cost_per_m nas receitas.';
