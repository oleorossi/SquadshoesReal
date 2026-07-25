-- ============================================================================
-- Integridade da GERAÇÃO DE ORDENS DE COMPRA
--
-- Frente "Geração de Ordens de Compra" da auditoria de 2026-09-25. Não é uma
-- migration de dados: ela fecha os buracos ESTRUTURAIS que produziram os dados
-- que a migration irmã `20260925130000_audit-data-corrections-pv.sql` limpa.
-- Sem isto, aquela limpeza volta a acontecer na próxima onda de OCs.
--
-- ── O QUE FOI MEDIDO (SELECT em produção, 2026-09-25) ───────────────────────
--
--   A1  IDEMPOTÊNCIA INEXISTENTE
--       52 OCs no banco, `idempotency_key` preenchida em apenas 5. A única
--       proteção viva é o trigger `check_purchase_order_idempotency`, que só
--       rejeita a MESMA key nos últimos 30 SEGUNDOS — janela inútil pra
--       duplicação separada por horas/dias. Resultado observado:
--         OC-00176/177/178  10/07/2026 11:03  auto_generated, key NULL
--         OC-00179/180/181  11/07/2026 19:23  auto_generated, key NULL
--       totais idênticos par a par (1482 / 2371,20 / 1482), mesmo PV-00146.
--
--   A2  RASTREABILIDADE ZERADA
--       `source_pv_ids` NULL em 52/52 e `source_type` = 'manual' em 52/52,
--       mesmo com `auto_generated = true` em 49/52. O vínculo real só existe
--       em `linked_sale_order_ids` e em texto livre de `notes`.
--
--   A3  OC ÓRFÃ DE OP DELETADA
--       As 6 OCs de solado acima citam nas notas OP-2026-01152..01157; nenhuma
--       dessas OPs existe mais em `orders`. Não há rotina que cancele a OC
--       quando a OP de origem morre — a compra fica "em pé" pra sempre.
--
--   A4  UNIDADE/PREÇO DO ITEM EM UNIDADE DE ESTOQUE
--       `generateAutoPurchaseOrders` (src/hooks/useSaleOrders.ts) grava
--       `quantity = min_stock - quantity`, `unit = products.unit` e
--       `unit_price = products.unit_price` — TUDO em unidade de ESTOQUE, sem
--       converter pra unidade de COMPRA. Linhas vivas afetadas:
--         OC-00160 / OC-00175  PLACA 1.0 EVA 3.0
--           3,96 com unit 'dm²' e preço 0,11/dm²  →  produto é
--           unit='dm²', purchase_unit='placa', conversion_rate=150.
--           O correto é CEIL(3,96 / 150) = 1 placa a R$ 16,50 (0,11 × 150).
--           Total do item: R$ 0,44 → R$ 16,50.
--       Os outros dois motores (`generate_rop_purchase_suggestions` e
--       `generate_purchase_orders_from_mrp`) JÁ convertiam — a divergência era
--       só neste caminho e no `upsert_open_purchase_order`, que grava o payload
--       do cliente cru.
--
--   A5  QUANTIDADE FRACIONÁRIA EM UNIDADE CONTÁVEL
--         OC-00160  CAIXA COLMEIA 11  6,372 un  (caixa física é inteira).
--       Mesma origem de A4: o déficit `min_stock - quantity` (100 − 93,628)
--       entrou cru, sem CEIL.
--
--   A6  PREÇO ZERO EM SOLADO
--       products 14b96bf7 (INFANTIL / PRETO) com `unit_price = 0`, enquanto a
--       variante irmã 206eced8 (INFANTIL / CARAMELO) — MESMO grupo
--       5902f5eb "SOLADO INFANTIL", MESMO fornecedor 7fedad7c "SOLADOS DO
--       RICARDO", MESMA unidade 'par' — custa R$ 2,60. Duas evidências
--       independentes: as duas linhas convivem na MESMA OC-00094 (2.808 par
--       cada, uma a 0,00 e outra a 2,60) e a OC-00093 já precificou o PRÓPRIO
--       PRETO a R$ 2,60.
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────────
--   B0  helpers `is_countable_purchase_unit` + `po_normalize_line` — a regra
--       de unidade/preço de item de OC passa a existir em UM lugar só.
--   B1  `source_type` ganha 'auto_pv' / 'auto_op' / 'rop' no CHECK.
--   B2  UNIQUE INDEX parcial em `idempotency_key` — idempotência PERMANENTE
--       (não 30s) pras keys determinísticas auto: / auto_pv: / sole: / rop:.
--       Linhas legadas com key NULL e OCs canceladas ficam de fora.
--   B3  `upsert_po_item_atomic` normaliza unidade/preço/CEIL server-side.
--   B4  `upsert_open_purchase_order` preenche source_type + source_pv_ids +
--       idempotency_key e normaliza os itens.
--   B5  `generate_rop_purchase_suggestions` ganha key determinística por
--       (fornecedor, dia) + source_type='rop' + CEIL pela lista canônica.
--   B6  `cancel_orphan_auto_purchase_orders()` — rotina de limpeza. CRIADA,
--       NÃO EXECUTADA.
--   B7  correção das linhas EXISTENTES não-canceladas (A4/A5) e do preço zero
--       (A6), com rastro '[SISTEMA]'.
--
-- Tudo idempotente: o guard de cada bloco é a própria condição de "ainda está
-- errado", então reaplicar é no-op.
-- ============================================================================


-- ============================================================================
-- B0 — HELPERS DE UNIDADE DE COMPRA (fonte única da regra)
-- ============================================================================

-- Normalização mínima de grafia, espelhando `normalizeUnit` de
-- src/lib/unitConversion.ts. Só o suficiente pra COMPARAR duas unidades.
CREATE OR REPLACE FUNCTION public.po_norm_unit(p_unit text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE lower(btrim(COALESCE(p_unit, '')))
    WHEN ''            THEN 'un'
    WHEN 'metro'       THEN 'm'
    WHEN 'metros'      THEN 'm'
    WHEN 'mt'          THEN 'm'
    WHEN 'mts'         THEN 'm'
    WHEN 'und'         THEN 'un'
    WHEN 'unid'        THEN 'un'
    WHEN 'unidade'     THEN 'un'
    WHEN 'pares'       THEN 'par'
    WHEN 'dm2'         THEN 'dm²'
    WHEN 'm2'          THEN 'm²'
    WHEN 'cm2'         THEN 'cm²'
    WHEN 'litro'       THEN 'l'
    WHEN 'litros'      THEN 'l'
    WHEN 'gr'          THEN 'g'
    WHEN 'grama'       THEN 'g'
    WHEN 'gramas'      THEN 'g'
    ELSE lower(btrim(COALESCE(p_unit, 'un')))
  END;
$function$;

-- Unidade de compra DISCRETA (não dá pra comprar fração). Lista canônica —
-- espelha DISCRETE_PURCHASE_UNITS de src/lib/unitConversion.ts. Unidades
-- CONTÍNUAS (m, cm, mm, kg, g, dm², m², L, ml) retornam false e NUNCA sofrem
-- CEIL — arredondar metro linear pra cima infla compra de napa.
CREATE OR REPLACE FUNCTION public.is_countable_purchase_unit(p_unit text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT lower(btrim(COALESCE(p_unit, ''))) IN (
    'un', 'und', 'unid', 'unidade', 'par', 'pares',
    'cx', 'caixa', 'pc', 'pct', 'pacote', 'pç', 'peca', 'peça',
    'rolo', 'rl', 'chapa', 'placa', 'placas',
    'folha', 'fh', 'jogo', 'jg', 'saco', 'sc'
  );
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- Normaliza uma linha de OC pra UNIDADE DE COMPRA do produto.
--
-- Contrato (idempotente por construção — chamar de novo no resultado é no-op):
--   * quantidade vem em unidade de ESTOQUE  (p_unit = products.unit, e o
--     produto tem unidade de compra diferente com conversion_rate ≠ 1)
--       → divide por conversion_rate, multiplica o preço por conversion_rate,
--         troca a unidade pra unidade de compra. `total = qty × preço` fica
--         INVARIANTE (é a mesma matemática de generate_purchase_orders_from_mrp).
--   * quantidade já vem em unidade de COMPRA
--       → passa direto, só aplica CEIL se a unidade for contável.
--
-- ⚠ A conversão dm²→metro de material de ÁREA (napa) NÃO passa por aqui: ela
--   mora na largura da ficha de componente, não em conversion_rate (ver
--   CLAUDE.md § Unidades de medida).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.po_normalize_line(
  p_product_id uuid,
  p_qty        numeric,
  p_unit       text,
  p_unit_price numeric
)
 RETURNS TABLE(out_qty numeric, out_unit text, out_unit_price numeric, converted boolean)
 LANGUAGE plpgsql
 STABLE
 -- DEFINER porque é chamada de dentro de upsert_po_item_atomic /
 -- upsert_open_purchase_order (também DEFINER) e precisa enxergar `products`
 -- com o mesmo privilégio, independentemente da RLS do chamador.
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock_unit text;
  v_canon_pu   text;
  v_label_pu   text;
  v_rate       numeric;
  v_qty        numeric := COALESCE(p_qty, 0);
  v_unit       text;
  v_price      numeric := COALESCE(p_unit_price, 0);
  v_converted  boolean := false;
BEGIN
  -- DUAS unidades de compra, de propósito (não é redundância):
  --   v_canon_pu  decide o CEIL  → `purchase_order_unit` PRIMEIRO. É a coluna
  --               que os geradores (materialAvailability, ROP, MRP) usam. Usar
  --               `purchase_unit` aqui seria desastroso: 41 produtos ativos têm
  --               unit='m' com o lixo legado purchase_unit='un' — CEIL por 'un'
  --               arredondaria metro linear de napa pra cima.
  --   v_label_pu  é o RÓTULO gravado na linha quando há conversão →
  --               `purchase_unit` PRIMEIRO. É a coluna contra a qual
  --               `receiptConversionFactor` (src/lib/purchaseConversion.ts)
  --               valida a unidade da linha no recebimento; rótulo que não casa
  --               nem com `unit` nem com `purchase_unit` BLOQUEIA o recebimento
  --               ("não casa nem com a unidade de compra nem com a de estoque").
  -- Nos 4 produtos com conversion_rate ≠ 1 hoje as duas colunas são iguais, então
  -- isto é blindagem contra cadastro futuro divergente, não mudança de resultado.
  SELECT COALESCE(NULLIF(btrim(p.unit), ''), 'un'),
         COALESCE(NULLIF(btrim(p.purchase_order_unit), ''),
                  NULLIF(btrim(p.purchase_unit), ''),
                  NULLIF(btrim(p.unit), ''), 'un'),
         COALESCE(NULLIF(btrim(p.purchase_unit), ''),
                  NULLIF(btrim(p.purchase_order_unit), ''),
                  NULLIF(btrim(p.unit), ''), 'un'),
         COALESCE(NULLIF(p.conversion_rate, 0), 1)
    INTO v_stock_unit, v_canon_pu, v_label_pu, v_rate
    FROM public.products p
   WHERE p.id = p_product_id;

  -- Produto inexistente: devolve o input intacto (não inventa conversão).
  IF v_stock_unit IS NULL THEN
    RETURN QUERY SELECT v_qty, COALESCE(NULLIF(btrim(p_unit), ''), 'un'), v_price, false;
    RETURN;
  END IF;

  v_unit := COALESCE(NULLIF(btrim(p_unit), ''), v_stock_unit);

  -- A quantidade está em unidade de ESTOQUE e o produto compra em outra?
  IF public.po_norm_unit(v_unit) = public.po_norm_unit(v_stock_unit)
     AND public.po_norm_unit(v_canon_pu) <> public.po_norm_unit(v_stock_unit)
     AND v_rate <> 1
  THEN
    v_qty       := round(v_qty / v_rate, 6);
    v_price     := round(v_price * v_rate, 6);
    v_unit      := v_label_pu;   -- rótulo que o recebimento sabe validar
    v_converted := true;
  END IF;

  -- ⚠ A decisão de CEIL usa a unidade de compra CANÔNICA DO PRODUTO, nunca o
  -- rótulo que o caller mandou. Motivo real: OC-00030 tem COLA PVC gravada com
  -- unit='un' (default legado) sendo que o produto é kg — arredondar por causa
  -- do rótulo errado destruiria a quantidade em kg (1.205,0144 → 1.206) e
  -- passaria por cima da correção da migration 20260925130000 (D2), que fixa
  -- essa linha em 66,07056 kg. Unidade contínua (m/kg/dm²/L) nunca sofre CEIL.
  IF public.is_countable_purchase_unit(v_canon_pu) THEN
    v_qty := CEIL(v_qty);
  END IF;

  -- Fora da conversão, quantidade e preço saem EXATAMENTE como entraram —
  -- nada de arredondar preço unitário (há itens com 20,495076923076923/m e
  -- reescrevê-los seria ruído sem ganho).
  RETURN QUERY SELECT v_qty, v_unit, v_price, v_converted;
END;
$function$;

COMMENT ON FUNCTION public.po_normalize_line(uuid, numeric, text, numeric) IS
  'Normaliza (qty, unit, unit_price) de item de OC pra unidade de COMPRA do produto: '
  'converte estoque→compra por conversion_rate e aplica CEIL em unidade contável. '
  'Idempotente. Auditoria 2026-09-25 (OC-00160/OC-00175 PLACA EVA, CAIXA COLMEIA).';

-- É SECURITY DEFINER só pra enxergar `products` de dentro das funções de upsert
-- (também DEFINER). Não é API: ninguém a chama por RPC. Fechar o EXECUTE evita
-- que anon/authenticated leiam unidade/taxa de conversão de qualquer produto
-- passando por cima da RLS.
REVOKE ALL ON FUNCTION public.po_normalize_line(uuid, numeric, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.po_normalize_line(uuid, numeric, text, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.po_normalize_line(uuid, numeric, text, numeric) FROM authenticated;


-- ============================================================================
-- B1 — source_type: valores para as três origens automáticas
--
--   auto_pv  OC automática disparada por PV (reposição de mínimo / shortage)
--   auto_op  OC automática de solado disparada por OP
--   rop      sugestão automática do ponto de pedido (cron diário)
--
-- 'manual', 'mrp', 'per_pv' e 'manual_avulsa' continuam válidos. O frontend
-- só testa igualdade com 'per_pv' e 'manual_avulsa' (isPerPvPurchaseOrder,
-- PurchaseOrders.tsx), então acrescentar valores não quebra tela.
-- ============================================================================
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS chk_purchase_orders_source_type;

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_source_type
  CHECK (source_type = ANY (ARRAY[
    'manual'::text, 'mrp'::text, 'per_pv'::text, 'manual_avulsa'::text,
    'auto_pv'::text, 'auto_op'::text, 'rop'::text
  ]));


-- ============================================================================
-- B2 — IDEMPOTÊNCIA REAL (UNIQUE INDEX parcial)
--
-- O trigger `check_purchase_order_idempotency` só cobre 30s; as ondas
-- duplicadas de 10/07 e 11/07 nasceram com 32h de distância. O índice abaixo
-- torna a key determinística ÚNICA de forma permanente.
--
-- Escopo deliberadamente restrito aos PREFIXOS que o sistema gera sozinho:
--   auto:      OC automática de reposição por PV (useSaleOrders)
--   auto_pv:   OC automática agregada por fornecedor+PV (upsert_open_purchase_order)
--   sole:      OC automática de solado por OP (soleAutoPO)
--   rop:       sugestão do ponto de pedido, uma por fornecedor por dia
--
-- Ficam DE FORA (de propósito):
--   * key NULL — todas as 47 OCs legadas continuam válidas;
--   * OC cancelada — cancelar e refazer a mesma compra tem que ser possível;
--   * OC 'received' / 'receiving' — ⚠ ESSENCIAL. A key é determinística por
--     (PV, fornecedor) / (OP, solado), ou seja PERMANENTE. Se o índice cobrisse
--     também a OC já recebida, a MESMA demanda nunca mais poderia virar OC: a
--     segunda compra do mesmo material pro mesmo PV (a primeira chegou e não
--     bastou, ou o PV cresceu) estouraria 23505 pra sempre e o frontend
--     devolveria a OC RECEBIDA como se tivesse acumulado — compra perdida em
--     silêncio. O conjunto coberto é exatamente o conjunto "em aberto" que os
--     geradores reusam (`status NOT IN ('received','receiving','cancelled')`),
--     então: existe OC aberta → reusa; não existe → a key está livre → cria.
--   * 'perpv::' (canal Compras por Pedido) e as keys por hash de itens do
--     useCreatePurchaseOrder — ali o operador PODE legitimamente repetir a
--     mesma compra; a proteção correta continua sendo a janela de 30s.
--
-- Verificado antes de criar: 0 duplicatas entre as 5 keys não-nulas existentes.
-- ============================================================================
DO $$
DECLARE
  v_dups text;
BEGIN
  IF to_regclass('public.ux_purchase_orders_idem_auto') IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(k, ', ')
    INTO v_dups
    FROM (
      SELECT idempotency_key AS k
        FROM public.purchase_orders
       WHERE idempotency_key IS NOT NULL
         AND status NOT IN ('cancelled', 'received', 'receiving')
         AND (idempotency_key LIKE 'auto:%' OR idempotency_key LIKE 'auto\_pv:%'
              OR idempotency_key LIKE 'sole:%' OR idempotency_key LIKE 'rop:%')
       GROUP BY idempotency_key
      HAVING count(*) > 1
    ) d;

  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION
      'Não é possível criar ux_purchase_orders_idem_auto: já existem OCs vivas com key repetida (%). Cancele/normalize antes de aplicar.', v_dups;
  END IF;

  CREATE UNIQUE INDEX ux_purchase_orders_idem_auto
    ON public.purchase_orders (idempotency_key)
    WHERE idempotency_key IS NOT NULL
      AND status NOT IN ('cancelled', 'received', 'receiving')
      AND (idempotency_key LIKE 'auto:%' OR idempotency_key LIKE 'auto\_pv:%'
           OR idempotency_key LIKE 'sole:%' OR idempotency_key LIKE 'rop:%');
END $$;

COMMENT ON INDEX public.ux_purchase_orders_idem_auto IS
  'Idempotência PERMANENTE da geração automática de OC (prefixos auto:/auto_pv:/sole:/rop:). '
  'Complementa — não substitui — o trigger de 30s, que segue cobrindo as OCs manuais.';


-- ============================================================================
-- B3 — upsert_po_item_atomic: unidade/preço/CEIL corretos
--
-- Mesma assinatura (10 args) — nenhum caller precisa mudar. O que muda:
--   * (qty, unit, unit_price) passam por po_normalize_line antes de gravar;
--   * ao ACUMULAR numa linha legada gravada em unidade de estoque, a
--     quantidade ANTIGA também é renormalizada antes da soma (senão somaria
--     3,96 dm² com 1 placa); só quando a linha ainda não teve recebimento;
--   * `unit` passa a ser atualizado no UPDATE (antes ficava congelado na
--     unidade errada da primeira gravação).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_po_item_atomic(
  p_po_id uuid,
  p_product_id uuid,
  p_qty_delta numeric,
  p_unit_price numeric,
  p_unit text DEFAULT 'un'::text,
  p_current_stock numeric DEFAULT 0,
  p_min_stock numeric DEFAULT 0,
  p_max_stock numeric DEFAULT 0,
  p_grade_delta jsonb DEFAULT NULL::jsonb,
  p_color text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item_id      uuid;
  v_old_qty      numeric;
  v_old_unit     text;
  v_old_received numeric;
  v_old_grade    jsonb;
  v_new_grade    jsonb;
  v_new_qty      numeric;
  v_inserted     boolean := false;
  v_size         text;
  v_size_qty     numeric;
  v_qty          numeric;
  v_unit         text;
  v_price        numeric;
  v_conv         boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Normalização canônica do delta (estoque→compra + CEIL contável).
  SELECT n.out_qty, n.out_unit, n.out_unit_price, n.converted
    INTO v_qty, v_unit, v_price, v_conv
    FROM public.po_normalize_line(p_product_id, p_qty_delta, p_unit, p_unit_price) n;

  SELECT id, quantity, COALESCE(unit, ''), COALESCE(received_quantity, 0), COALESCE(grade, '{}'::jsonb)
    INTO v_item_id, v_old_qty, v_old_unit, v_old_received, v_old_grade
    FROM public.purchase_order_items
   WHERE purchase_order_id = p_po_id
     AND product_id        = p_product_id
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;

  IF v_item_id IS NULL THEN
    v_new_qty   := v_qty;
    v_new_grade := COALESCE(p_grade_delta, '{}'::jsonb);
    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, quantity, unit_price,
      unit, current_stock, min_stock, max_stock, grade, color
    ) VALUES (
      p_po_id, p_product_id, v_new_qty, v_price,
      v_unit, p_current_stock, p_min_stock, p_max_stock, v_new_grade, p_color
    )
    RETURNING id INTO v_item_id;
    v_inserted := true;
  ELSE
    -- Linha legada em unidade de ESTOQUE + nada recebido → renormaliza antes
    -- de somar, senão a acumulação mistura dm² com placa.
    IF public.po_norm_unit(v_old_unit) <> public.po_norm_unit(v_unit) THEN
      IF v_old_received = 0 THEN
        SELECT n.out_qty INTO v_old_qty
          FROM public.po_normalize_line(p_product_id, v_old_qty, v_old_unit, 0) n;
      ELSE
        -- Linha JÁ RECEBIDA (parcial) numa unidade diferente da normalizada: não
        -- dá pra renormalizar (received_quantity está na unidade antiga) nem pra
        -- somar (misturaria dm² com placa). Aborta explícito em vez de gravar
        -- quantidade sem sentido numa compra em andamento. Hoje inalcançável
        -- (0/304 itens com received_quantity > 0), é rede de proteção.
        RAISE EXCEPTION
          'Item da OC já tem recebimento parcial em "%" e a nova demanda é em "%" — corrija a unidade da linha antes de acumular.',
          v_old_unit, v_unit;
      END IF;
    END IF;

    -- Re-passa a SOMA pela mesma regra (po_normalize_line é idempotente:
    -- v_unit já é unidade de compra, então não reconverte — só aplica o CEIL
    -- canônico do produto).
    SELECT n.out_qty INTO v_new_qty
      FROM public.po_normalize_line(p_product_id, v_old_qty + v_qty, v_unit, v_price) n;

    v_new_grade := v_old_grade;
    IF p_grade_delta IS NOT NULL THEN
      FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each(p_grade_delta) LOOP
        v_new_grade := jsonb_set(
          v_new_grade,
          ARRAY[v_size],
          to_jsonb(COALESCE((v_new_grade->>v_size)::numeric, 0) + v_size_qty)
        );
      END LOOP;
    END IF;

    UPDATE public.purchase_order_items SET
      quantity    = v_new_qty,
      -- Preço 0 NÃO sobrescreve preço existente (mesma semântica do irmão
      -- upsert_open_purchase_order). A versão viva fazia `unit_price = p_unit_price`
      -- cru: `waveTimelineService.ts` acumula itens de onda com unit_price = 0
      -- literal, então cada onda que caía numa OC pendente ZERAVA o preço das
      -- linhas já precificadas — a mesma classe do achado A6 (preço zero em OC).
      unit_price  = COALESCE(NULLIF(v_price, 0), unit_price),
      -- só troca a unidade enquanto nada foi recebido nessa linha
      unit        = CASE WHEN v_old_received = 0 THEN v_unit ELSE unit END,
      grade       = v_new_grade
    WHERE id = v_item_id;
  END IF;

  UPDATE public.purchase_orders
     SET total_value = (
           SELECT COALESCE(SUM(quantity * unit_price), 0)
             FROM public.purchase_order_items
            WHERE purchase_order_id = p_po_id
         ),
         updated_at = now()
   WHERE id = p_po_id;

  RETURN jsonb_build_object(
    'item_id',   v_item_id,
    'new_qty',   v_new_qty,
    'unit',      v_unit,
    'converted', v_conv,
    'inserted',  v_inserted
  );
END;
$function$;


-- ============================================================================
-- B4 — upsert_open_purchase_order: rastreabilidade + idempotência + unidade
--
-- Mesma assinatura (5 args) — `useUpsertOpenPurchaseOrder` não muda.
-- O que muda:
--   * OC nova nasce com source_type='auto_pv', source_pv_ids=[PV] e
--     idempotency_key='auto_pv:<supplier_id>:<sale_order_id>';
--   * OC reusada tem o PV appendado TAMBÉM em source_pv_ids (linked_sale_order_ids
--     segue como está, por compatibilidade com PurchaseOrdersForPvCard);
--   * itens passam por po_normalize_line (fecha o buraco A4/A5 nesse caminho).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_open_purchase_order(
  p_supplier_id uuid,
  p_supplier_name text,
  p_sale_order_id uuid,
  p_notes text,
  p_items jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_po_id uuid;
  v_linked uuid[];
  v_item jsonb;
  v_existing_id uuid;
  v_existing_qty numeric;
  v_existing_unit text;
  v_existing_received numeric;
  v_existing_grade jsonb;
  v_new_grade jsonb;
  v_merged_grade jsonb;
  v_idem text;
  v_qty numeric;
  v_unit text;
  v_price numeric;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_id é obrigatório pra agrupar OC';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items vazio — nada pra inserir/atualizar';
  END IF;

  -- Busca OC ABERTA existente do fornecedor + também o array de PVs linkados.
  -- F3-9: OC do canal per_pv fica FORA da consolidação — pertence a um PV
  -- específico (aba "Compras deste PV" exibe a OC inteira).
  SELECT id, COALESCE(linked_sale_order_ids, ARRAY[]::uuid[])
  INTO v_po_id, v_linked
  FROM public.purchase_orders
  WHERE supplier_id = p_supplier_id
    AND status NOT IN ('received','receiving','cancelled')
    AND COALESCE(source_type, 'manual') <> 'per_pv'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- ── IDEMPOTÊNCIA POR PV ──
  -- Se a OC aberta já tem esse PV vinculado, considera disparo duplicado e
  -- retorna sem alterar nada. Antes desse guard, cada save/edit do PV somava
  -- quantity de novo (incidente OC-00031: 9232 vs 1240 esperados).
  IF v_po_id IS NOT NULL
     AND p_sale_order_id IS NOT NULL
     AND p_sale_order_id = ANY(v_linked) THEN
    RETURN v_po_id;
  END IF;

  IF v_po_id IS NULL THEN
    -- Key determinística: uma OC auto por (fornecedor, PV). O UNIQUE INDEX
    -- parcial de B2 impede a segunda pra sempre (não só por 30s).
    v_idem := CASE WHEN p_sale_order_id IS NOT NULL
                   THEN 'auto_pv:' || p_supplier_id::text || ':' || p_sale_order_id::text
                   ELSE NULL END;

    -- Corrida entre duas abas: se a key já existe numa OC ABERTA, reusa em vez
    -- de estourar 23505 na cara do usuário.
    -- ⚠ O filtro tem que ser o MESMO conjunto "em aberto" da busca por
    -- fornecedor acima (e do índice de B2). Com `status <> 'cancelled'` esta
    -- consulta acharia uma OC já RECEBIDA da mesma (fornecedor, PV) e o laço de
    -- itens abaixo despejaria itens novos dentro de uma compra fechada —
    -- inflando total_value de uma OC recebida e sumindo com a demanda nova.
    IF v_idem IS NOT NULL THEN
      SELECT id INTO v_po_id
        FROM public.purchase_orders
       WHERE idempotency_key = v_idem
         AND status NOT IN ('received', 'receiving', 'cancelled')
       LIMIT 1;
    END IF;

    IF v_po_id IS NULL THEN
      INSERT INTO public.purchase_orders (
        supplier_id, supplier_name, notes, auto_generated,
        linked_sale_order_ids, source_type, source_pv_ids, idempotency_key
      ) VALUES (
        p_supplier_id, p_supplier_name,
        COALESCE(p_notes, ''), true,
        CASE WHEN p_sale_order_id IS NOT NULL THEN ARRAY[p_sale_order_id] ELSE ARRAY[]::uuid[] END,
        'auto_pv',
        CASE WHEN p_sale_order_id IS NOT NULL THEN ARRAY[p_sale_order_id] ELSE NULL END,
        v_idem
      )
      RETURNING id INTO v_po_id;
    END IF;
  ELSE
    IF p_sale_order_id IS NOT NULL THEN
      UPDATE public.purchase_orders
      SET linked_sale_order_ids = (
        SELECT array_agg(DISTINCT x ORDER BY x)
        FROM unnest(linked_sale_order_ids || p_sale_order_id) x
      ),
      -- Rastreabilidade: o PV entra TAMBÉM em source_pv_ids (era NULL em 52/52).
      source_pv_ids = (
        SELECT array_agg(DISTINCT x ORDER BY x)
        FROM unnest(COALESCE(source_pv_ids, ARRAY[]::uuid[]) || p_sale_order_id) x
      ),
      -- Só reclassifica OC que o SISTEMA gerou. Uma OC digitada por pessoa
      -- (auto_generated=false) em que o PV apenas acumulou continua 'manual' —
      -- ela não virou automática por receber um item.
      source_type = CASE WHEN auto_generated = true
                          AND COALESCE(source_type, 'manual') IN ('manual', 'auto_pv')
                         THEN 'auto_pv' ELSE source_type END,
      notes = CASE WHEN p_notes IS NOT NULL AND p_notes <> ''
                   THEN COALESCE(notes || E'\n', '') || p_notes
                   ELSE notes END,
      updated_at = now()
      WHERE id = v_po_id;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Unidade/preço/CEIL canônicos ANTES de qualquer merge.
    SELECT n.out_qty, n.out_unit, n.out_unit_price
      INTO v_qty, v_unit, v_price
      FROM public.po_normalize_line(
             (v_item->>'product_id')::uuid,
             COALESCE((v_item->>'quantity')::numeric, 0),
             v_item->>'unit',
             COALESCE((v_item->>'unit_price')::numeric, 0)
           ) n;

    SELECT id, quantity, COALESCE(unit, ''), COALESCE(received_quantity, 0), grade
      INTO v_existing_id, v_existing_qty, v_existing_unit, v_existing_received, v_existing_grade
    FROM public.purchase_order_items
    WHERE purchase_order_id = v_po_id
      AND product_id = (v_item->>'product_id')::uuid
      AND COALESCE(color, '') = COALESCE(v_item->>'color', '')
    LIMIT 1;

    v_new_grade := v_item->'grade';

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_grade IS NOT NULL AND v_new_grade IS NOT NULL AND jsonb_typeof(v_new_grade) = 'object' THEN
        SELECT jsonb_object_agg(k, (COALESCE((v_existing_grade->>k)::numeric, 0)
                                  + COALESCE((v_new_grade->>k)::numeric, 0)))
        INTO v_merged_grade
        FROM (
          SELECT jsonb_object_keys(v_existing_grade) AS k
          UNION
          SELECT jsonb_object_keys(v_new_grade) AS k
        ) keys;
      ELSIF v_new_grade IS NOT NULL AND jsonb_typeof(v_new_grade) = 'object' THEN
        v_merged_grade := v_new_grade;
      ELSE
        v_merged_grade := v_existing_grade;
      END IF;

      -- Linha legada em unidade de estoque e nada recebido → renormaliza.
      -- Com recebimento parcial em outra unidade, aborta (mesma razão de B3:
      -- somar dm² com placa numa compra em andamento é corrupção silenciosa).
      IF public.po_norm_unit(v_existing_unit) <> public.po_norm_unit(v_unit) THEN
        IF v_existing_received = 0 THEN
          SELECT n.out_qty INTO v_existing_qty
            FROM public.po_normalize_line((v_item->>'product_id')::uuid, v_existing_qty, v_existing_unit, 0) n;
        ELSE
          RAISE EXCEPTION
            'Item da OC já tem recebimento parcial em "%" e a nova demanda é em "%" — corrija a unidade da linha antes de acumular.',
            v_existing_unit, v_unit;
        END IF;
      END IF;

      UPDATE public.purchase_order_items
      SET quantity = (SELECT n.out_qty
                        FROM public.po_normalize_line(
                               (v_item->>'product_id')::uuid,
                               v_existing_qty + v_qty, v_unit, v_price) n),
          suggested_quantity = COALESCE(suggested_quantity, 0) + v_qty,
          unit_price = COALESCE(NULLIF(v_price, 0), unit_price),
          unit = CASE WHEN v_existing_received = 0 THEN v_unit ELSE unit END,
          grade = v_merged_grade
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO public.purchase_order_items (
        purchase_order_id, product_id, quantity, suggested_quantity,
        unit_price, unit, current_stock, min_stock, max_stock, grade, color
      ) VALUES (
        v_po_id,
        (v_item->>'product_id')::uuid,
        v_qty,
        v_qty,
        v_price,
        v_unit,
        COALESCE((v_item->>'current_stock')::numeric, 0),
        COALESCE((v_item->>'min_stock')::numeric, 0),
        COALESCE((v_item->>'max_stock')::numeric, 0),
        v_item->'grade',
        v_item->>'color'
      );
    END IF;
  END LOOP;

  UPDATE public.purchase_orders po
  SET total_value = COALESCE((
    SELECT SUM(quantity * unit_price)
    FROM public.purchase_order_items
    WHERE purchase_order_id = po.id
  ), 0),
  updated_at = now()
  WHERE id = v_po_id;

  RETURN v_po_id;
END;
$function$;


-- ============================================================================
-- B5 — generate_rop_purchase_suggestions: key determinística + source_type
--
-- A função JÁ convertia estoque→compra e já aplicava CEIL (F3-1) — isso fica.
-- O que muda:
--   * `idempotency_key = 'rop:<supplier|none>:<YYYY-MM-DD>'` — no máximo uma
--     sugestão ROP por fornecedor por dia, garantido pelo índice de B2 (antes
--     o único freio era a janela de 7 dias, que não impedia duas rodadas do
--     cron no mesmo dia gerarem duas OCs);
--   * `source_type = 'rop'` (era 'manual' em 52/52);
--   * CEIL passa a usar `is_countable_purchase_unit` (a lista literal antiga
--     não cobria 'placas', 'caixa', 'pacote', 'saco', 'folha').
--   * `source_pv_ids` fica NULL de propósito: ROP é reposição de estoque, não
--     tem PV de origem.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_rop_purchase_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_supplier RECORD; v_prod RECORD; v_po_id uuid; v_total numeric; v_qty numeric;
  v_sup_id uuid; v_sup_name text;
  v_unit_po text; v_price_po numeric; v_rate numeric;
  v_created int := 0; v_appended int := 0; v_items_added int := 0;
  v_idem text; v_po_status text;
BEGIN
  FOR v_supplier IN
    SELECT suggested_supplier_id, COALESCE(suggested_supplier, 'A definir') AS supplier_name
      FROM public.v_products_below_rop
     WHERE NOT has_active_po
       AND NOT COALESCE(is_artisanal, false)   -- F3-2: artesanal = OS (trigger de min_stock), não OC
     GROUP BY suggested_supplier_id, suggested_supplier
  LOOP
    -- Guarda defensiva: fornecedor inexistente vira NULL (PO "A definir").
    v_sup_id := v_supplier.suggested_supplier_id;
    IF v_sup_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_sup_id) THEN
      v_sup_id := NULL;
    END IF;
    v_sup_name := v_supplier.supplier_name;
    v_idem := 'rop:' || COALESCE(v_sup_id::text, 'none') || ':' || to_char(now(), 'YYYY-MM-DD');

    -- Reuso: primeiro pela key do DIA (idempotência forte), depois pela janela
    -- de 7 dias (comportamento legado — consolida a sugestão da semana).
    -- Mesmo conjunto "em aberto" do índice de B2: OC do dia já recebida não
    -- pode bloquear a sugestão de hoje (e a key volta a ficar livre).
    SELECT id, status INTO v_po_id, v_po_status FROM public.purchase_orders
     WHERE idempotency_key = v_idem
       AND status NOT IN ('cancelled', 'received', 'receiving')
     LIMIT 1;

    -- Já existe OC do dia pra esse fornecedor E ela saiu de 'suggested'
    -- (comprador aprovou/pediu): NÃO despeja item novo dentro dela nem tenta
    -- criar outra — a key é única, o INSERT estouraria e derrubaria o cron
    -- inteiro. Passa pro próximo fornecedor; amanhã a key muda.
    IF v_po_id IS NOT NULL AND v_po_status IS DISTINCT FROM 'suggested' THEN
      CONTINUE;
    END IF;

    IF v_po_id IS NULL THEN
      SELECT id INTO v_po_id FROM public.purchase_orders
       WHERE COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(v_sup_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND status = 'suggested' AND auto_generated = true
         AND created_at > now() - interval '7 days'
       ORDER BY created_at DESC LIMIT 1;
    END IF;

    IF v_po_id IS NULL THEN
      INSERT INTO public.purchase_orders (status, supplier_id, supplier_name, total_value,
                                          auto_generated, notes, source_type, idempotency_key)
      VALUES ('suggested', v_sup_id, v_sup_name, 0, true,
        'Sugestao automatica ROP em ' || to_char(now(), 'DD/MM/YYYY HH24:MI'),
        'rop', v_idem)
      RETURNING id INTO v_po_id;
      v_created := v_created + 1;
    ELSE
      v_appended := v_appended + 1;
    END IF;
    v_total := COALESCE((SELECT total_value FROM public.purchase_orders WHERE id = v_po_id), 0);
    FOR v_prod IN
      SELECT * FROM public.v_products_below_rop
       WHERE NOT has_active_po
         AND NOT COALESCE(is_artisanal, false)   -- F3-2
         AND COALESCE(suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(v_supplier.suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LOOP
      IF EXISTS (SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id = v_po_id AND product_id = v_prod.product_id) THEN CONTINUE; END IF;
      -- F3-1: item de OC em unidade de COMPRA — mesma matemática do MRP.
      -- suggested_qty está em unidade de ESTOQUE; o recebimento credita
      -- quantity × fator(purchase_unit→unit), então quantity TEM que sair
      -- em unidade de compra (senão PLACA EVA credita 150× a mais).
      v_rate := COALESCE(NULLIF(v_prod.conversion_rate, 0), 1);
      v_qty := v_prod.suggested_qty / v_rate;
      v_price_po := COALESCE(v_prod.unit_price, 0) * v_rate;
      v_unit_po := COALESCE(v_prod.purchase_order_unit, v_prod.unit);
      v_qty := GREATEST(v_qty, COALESCE(v_prod.supplier_moq, 1));
      -- Lista canônica de unidade contável (antes era literal e incompleta).
      IF public.is_countable_purchase_unit(v_unit_po) THEN
        v_qty := CEIL(v_qty);
      END IF;
      IF COALESCE(v_prod.purchase_multiple, 0) > 1 THEN
        v_qty := CEIL(v_qty / v_prod.purchase_multiple) * v_prod.purchase_multiple;
      END IF;
      INSERT INTO public.purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
      VALUES (v_po_id, v_prod.product_id, v_prod.stock_qty, v_prod.min_stock, v_prod.max_stock, v_prod.suggested_qty, v_qty, v_price_po, v_unit_po);
      v_total := v_total + v_qty * v_price_po;
      v_items_added := v_items_added + 1;
    END LOOP;
    UPDATE public.purchase_orders SET total_value = v_total WHERE id = v_po_id;
  END LOOP;
  RETURN jsonb_build_object('pos_created', v_created, 'pos_appended', v_appended, 'items_added', v_items_added, 'run_at', now());
END;
$function$;


-- ============================================================================
-- B6 — cancel_orphan_auto_purchase_orders()
--
-- Cancela OC auto_generated ainda `pending` cuja OP de ORIGEM não existe mais.
-- Origem reconhecida por duas vias:
--   1. `reference_order_id` apontando pra uma linha inexistente em `orders`;
--   2. os números de OP citados na nota ("... para OP OP-2026-01152 ...") —
--      é o único vínculo que `soleAutoPO.ts` deixa hoje (reference_order_id
--      é NULL em 52/52).
-- OP soft-deletada (`orders.deleted_at IS NOT NULL`) conta como inexistente.
--
-- SEGURANÇA
--   * só toca `status = 'pending'` — sugestão/aprovada/recebida ficam intactas;
--   * pula qualquer OC com item já recebido (received_quantity > 0);
--   * pula OC sem OP identificável (não cancela por falta de evidência);
--   * ⚠ TODAS as OPs citadas na nota têm que estar mortas. A nota de uma OC
--     acumulada lista uma OP por disparo ("Solado insuficiente para OP X" +
--     "... OP Y" + ...) e isso vira a regra depois que o balde 'A definir'
--     passou a acumular. Cancelar olhando só a PRIMEIRA OP citada mataria uma
--     compra ainda necessária pelas outras OPs;
--   * itens NÃO são apagados — a OC cancelada preserva o que se tentou comprar;
--   * `approval_status` não é tocado (mesmo precedente de OC-00029/OC-00031).
--
-- IDEMPOTENTE: a segunda chamada não encontra mais nada em 'pending'.
--
-- ⚠ ESTA MIGRATION NÃO EXECUTA A FUNÇÃO. As 6 OCs órfãs conhecidas
--   (OC-00176..OC-00181) já são canceladas por 20260925130000 (bloco D1).
--   Rodar sob demanda em /diagnostics ou via SQL Editor:
--       SELECT * FROM public.cancel_orphan_auto_purchase_orders();
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_orphan_auto_purchase_orders()
-- OUT params renomeados de propósito: `order_number` / `total_value` /
-- `supplier_name` / `op_ref` sem prefixo colidiriam com colunas e aliases
-- usados no corpo (plpgsql.variable_conflict = error por padrão).
 RETURNS TABLE(oc_number text, origem_op text, oc_total numeric, oc_supplier text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_note text;
BEGIN
  v_note := '[SISTEMA] ' || to_char(now(), 'YYYY-MM-DD') ||
            ': OC cancelada automaticamente — a OP de origem não existe mais em `orders` '
            '(deletada ou substituída). Geração automática sem idempotência deixou a compra em pé. '
            'Ver cancel_orphan_auto_purchase_orders().';

  RETURN QUERY
  WITH candidatas AS (
    SELECT po.id,
           po.order_number,
           po.total_value,
           po.supplier_name,
           po.reference_order_id,
           -- TODOS os números de OP citados na nota (não só o primeiro).
           COALESCE(
             (SELECT array_agg(DISTINCT m[1])
                FROM regexp_matches(COALESCE(po.notes, ''), 'OP\s+(OP-[0-9]{4}-[0-9]+)', 'g') AS m),
             ARRAY[]::text[]
           ) AS ops_citadas
      FROM public.purchase_orders po
     WHERE po.auto_generated = true
       AND po.status = 'pending'
       AND NOT EXISTS (
             SELECT 1 FROM public.purchase_order_items poi
              WHERE poi.purchase_order_id = po.id
                AND COALESCE(poi.received_quantity, 0) > 0
           )
  ),
  rotuladas AS (
    SELECT c.*,
           COALESCE(
             (SELECT o.order_number FROM public.orders o WHERE o.id = c.reference_order_id),
             NULLIF(array_to_string(c.ops_citadas, ', '), '')
           ) AS op_ref
      FROM candidatas c
  ),
  orfas AS (
    SELECT r.*
      FROM rotuladas r
     WHERE
           -- Guard comum às duas vias: nenhuma OP citada na nota pode estar
           -- viva. `soleAutoPO` grava reference_order_id só da PRIMEIRA OP; as
           -- OPs seguintes ACUMULAM na mesma OC e só acrescentam nota. Sem
           -- este guard, apagar aquela primeira OP cancelaria uma compra que
           -- as demais OPs ainda precisam.
           NOT EXISTS (SELECT 1 FROM public.orders o
                        WHERE o.order_number = ANY (r.ops_citadas)
                          AND o.deleted_at IS NULL)
       AND (
             -- via 1: FK apontando pra OP inexistente
             (r.reference_order_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.orders o
                               WHERE o.id = r.reference_order_id
                                 AND o.deleted_at IS NULL))
             OR
             -- via 2: nºs de OP citados na nota e NENHUM deles com OP viva.
             -- Basta UMA OP viva pra a compra continuar tendo lastro.
             (r.reference_order_id IS NULL
              AND cardinality(r.ops_citadas) > 0
              AND NOT EXISTS (SELECT 1 FROM public.orders o
                               WHERE o.order_number = ANY (r.ops_citadas)
                                 AND o.deleted_at IS NULL))
           )
  ),
  upd AS (
    UPDATE public.purchase_orders po
       SET status       = 'cancelled',
           cancelled_at = COALESCE(po.cancelled_at, now()),
           -- position() e não LIKE: v_note tem '_' (nome da função), que em LIKE
           -- é curinga e afrouxaria o guard de reexecução.
           notes        = CASE WHEN position(v_note in COALESCE(po.notes, '')) > 0
                               THEN po.notes
                               ELSE COALESCE(po.notes || E'\n', '') || v_note ||
                                    ' OP de origem: ' || COALESCE(o.op_ref, '(sem referência)') || '.'
                          END,
           updated_at   = now()
      FROM orfas o
     WHERE po.id = o.id
    RETURNING po.order_number, o.op_ref, po.total_value, po.supplier_name
  )
  SELECT u.order_number, u.op_ref, u.total_value, u.supplier_name FROM upd u;
END;
$function$;

COMMENT ON FUNCTION public.cancel_orphan_auto_purchase_orders() IS
  'Cancela OC auto_generated pending cuja OP de origem (reference_order_id ou nº citado em notes) '
  'não existe mais. Idempotente, nota [SISTEMA], não apaga itens. Auditoria 2026-09-25.';


-- ============================================================================
-- B7 — CORREÇÃO DAS LINHAS EXISTENTES
-- ============================================================================

-- ── B7.1 — itens vivos gravados em unidade de ESTOQUE / com fração em unidade
--            contável
--
-- ESCOPO EXPLÍCITO (as 3 linhas que o SELECT de auditoria devolveu; nenhuma
-- outra linha do banco é tocada — sweep genérico foi descartado de propósito,
-- ver "por que não genérico" abaixo):
--
--   OC-00175  PLACA 1.0 EVA 3.0 (caa8afb2)  3,96 dm² @ R$ 0,11  → 1 placa @ R$ 16,50
--   OC-00160  PLACA 1.0 EVA 3.0 (caa8afb2)  3,96 dm² @ R$ 0,11  → 1 placa @ R$ 16,50
--   OC-00160  CAIXA COLMEIA 11  (428012a1)  6,372 un @ R$ 5,50  → 7 un   @ R$ 5,50
--
--   Conta da PLACA EVA: produto é unit='dm²', purchase_unit='placa',
--   conversion_rate=150, unit_price=0,11/dm². Logo CEIL(3,96 / 150) = 1 placa
--   e 0,11 × 150 = R$ 16,50/placa. total do item R$ 0,44 → R$ 16,50.
--   Conta da CAIXA COLMEIA: déficit min_stock(100) − quantity(93,628) = 6,372;
--   caixa física é inteira → 7 un, R$ 35,05 → R$ 38,50.
--
-- POR QUE NÃO GENÉRICO (verificado por SELECT antes de escrever):
--   * OC-00030 / COLA PVC — item gravado com unit='un' embora o produto seja
--     kg. Um sweep que arredondasse pelo rótulo do item transformaria os
--     66,07056 kg que a migration 20260925130000 (D2) acabou de calcular em
--     67 kg. Fora de escopo aqui.
--   * OC-00090 / Tira Overlock 5mm — só tem ruído de casas decimais no preço
--     (20,495076923076923/m). Reescrever não corrige nada.
--   * OC-00012 / PLACA EVA — `auto_generated = false`, quantidade e unidade
--     ('par') digitadas por uma pessoa. Vai pra pendência do usuário, não pra
--     correção automática.
--   * OC-00169 — total_value 700,00 sem nenhum item. Um recálculo genérico de
--     total zeraria essa OC de lambuja. Fora de escopo.
--
-- GUARD: cada statement só age enquanto o valor ainda estiver errado, e só em
-- OC não-cancelada/não-recebida com o item sem recebimento → reaplicar é no-op.

-- B7.1.a — PLACA 1.0 EVA 3.0 em OC-00160 e OC-00175: dm² → placa
UPDATE public.purchase_order_items poi
   SET quantity           = 1,
       suggested_quantity = 1,
       unit               = 'placa',
       unit_price         = 16.50
  FROM public.purchase_orders po
 WHERE po.id = poi.purchase_order_id
   AND po.order_number IN ('OC-00160', 'OC-00175')
   AND poi.product_id = 'caa8afb2-edd9-49b3-ae08-cc43c74f20a3'::uuid
   AND po.status NOT IN ('cancelled', 'received')
   AND COALESCE(poi.received_quantity, 0) = 0
   AND poi.unit = 'dm²';

-- B7.1.b — CAIXA COLMEIA 11 em OC-00160: 6,372 un → 7 un (CEIL)
UPDATE public.purchase_order_items poi
   SET quantity           = CEIL(poi.quantity),
       suggested_quantity = CEIL(GREATEST(COALESCE(poi.suggested_quantity, 0), poi.quantity))
  FROM public.purchase_orders po
 WHERE po.id = poi.purchase_order_id
   AND po.order_number = 'OC-00160'
   AND poi.product_id = '428012a1-c0fa-4149-bc5e-7426b6c0462f'::uuid
   AND po.status NOT IN ('cancelled', 'received')
   AND COALESCE(poi.received_quantity, 0) = 0
   AND poi.quantity <> CEIL(poi.quantity);

-- B7.1.c — total_value recalculado SÓ nessas duas OCs
UPDATE public.purchase_orders po
   SET total_value = COALESCE((
         SELECT SUM(poi.quantity * poi.unit_price)
           FROM public.purchase_order_items poi
          WHERE poi.purchase_order_id = po.id
       ), 0),
       updated_at = now()
 WHERE po.order_number IN ('OC-00160', 'OC-00175')
   AND po.status NOT IN ('cancelled', 'received')
   AND po.total_value IS DISTINCT FROM COALESCE((
         SELECT SUM(poi.quantity * poi.unit_price)
           FROM public.purchase_order_items poi
          WHERE poi.purchase_order_id = po.id
       ), 0);

-- Rastro nas duas OCs afetadas (nota idempotente).
UPDATE public.purchase_orders po
   SET notes = COALESCE(po.notes || E'\n', '') ||
               '[SISTEMA] 2026-09-25: itens renormalizados pra UNIDADE DE COMPRA do produto. '
               'A geração automática por PV gravava quantidade/unidade/preço em unidade de ESTOQUE '
               '(PLACA 1.0 EVA 3.0: 3,96 dm² a R$ 0,11/dm² — o produto compra em ''placa'' com '
               'conversion_rate 150, logo 1 placa a R$ 16,50) e sem CEIL em unidade contável '
               '(CAIXA COLMEIA 11: 6,372 un → 7 un). total_value recalculado.'
 WHERE po.order_number IN ('OC-00160', 'OC-00175')
   -- Mesmo guard de status dos UPDATEs acima: se a OC tiver sido cancelada ou
   -- recebida antes desta migration rodar, os itens NÃO foram tocados — anotar
   -- que "foram renormalizados" seria registro falso no histórico da compra.
   AND po.status NOT IN ('cancelled', 'received')
   AND COALESCE(po.notes, '') NOT LIKE '%[SISTEMA] 2026-09-25: itens renormalizados pra UNIDADE DE COMPRA%';


-- ── B7.2 — INFANTIL / PRETO com unit_price = 0
--
-- VALIDAÇÃO (SELECT, 2026-09-25) — a equivalência foi confirmada nos 4 eixos:
--   product 14b96bf7 INFANTIL PRETO     group 5902f5eb  supplier 7fedad7c  unit 'par'  preço 0,00
--   product 206eced8 INFANTIL CARAMELO  group 5902f5eb  supplier 7fedad7c  unit 'par'  preço 2,60
--   grupo 5902f5eb = 'SOLADO INFANTIL' (sector 'Solado'); fornecedor 7fedad7c =
--   'SOLADOS DO RICARDO'. As duas linhas convivem na MESMA OC-00094, com a
--   MESMA quantidade (2.808 par) — uma a R$ 0,00, outra a R$ 2,60.
--   Segunda evidência independente: OC-00093 (06/06/2026) precificou o PRÓPRIO
--   INFANTIL PRETO a R$ 2,60.
--
-- O guard abaixo re-valida tudo em tempo de execução: se a irmã sumir, mudar de
-- grupo, de fornecedor, de unidade ou zerar o preço, o UPDATE não roda.
-- Também só age enquanto o preço estiver exatamente 0 → reaplicar é no-op.
--
-- ⚠ Escopo: SÓ o cadastro do produto. As linhas de OC do INFANTIL em OC-00094
--   são REMOVIDAS pelo bloco D3 da migration 20260925130000 (sem lastro de
--   consumo), então não há item de OC a reprecificar aqui.
WITH irma AS (
  SELECT s.unit_price
    FROM public.products s
    JOIN public.products alvo ON alvo.id = '14b96bf7-a96b-4b4f-8b37-217eb4d7cfd3'::uuid
   WHERE s.id = '206eced8-8eb0-44bc-b376-148670f32419'::uuid
     AND s.active
     AND s.unit_price > 0
     AND s.group_id     IS NOT DISTINCT FROM alvo.group_id
     AND s.supplier_id  IS NOT DISTINCT FROM alvo.supplier_id
     AND public.po_norm_unit(s.unit) = public.po_norm_unit(alvo.unit)
     AND upper(btrim(s.name)) = upper(btrim(alvo.name))
)
UPDATE public.products p
   SET unit_price = irma.unit_price,
       updated_at = now()
  FROM irma
 WHERE p.id = '14b96bf7-a96b-4b4f-8b37-217eb4d7cfd3'::uuid
   AND COALESCE(p.unit_price, 0) = 0;

-- Rastro em material_audit_log (products não tem coluna de notas).
INSERT INTO public.material_audit_log (product_id, product_name, action, changes)
SELECT p.id,
       p.name || ' / ' || COALESCE(p.color, ''),
       'system_price_alignment',
       jsonb_build_object(
         'campo', 'unit_price',
         'de', 0,
         'para', p.unit_price,
         'motivo', '[SISTEMA] 2026-09-25: preço zerado alinhado à variante irmã INFANTIL/CARAMELO '
                   '(206eced8) — mesmo grupo SOLADO INFANTIL, mesmo fornecedor SOLADOS DO RICARDO, '
                   'mesma unidade par. OC-00094 comprou 2.808 par das duas cores, uma a R$ 0,00 e '
                   'outra a R$ 2,60; OC-00093 já precificara o próprio PRETO a R$ 2,60.',
         'migration', '20260925132000_purchase-order-integrity'
       )
  FROM public.products p
 WHERE p.id = '14b96bf7-a96b-4b4f-8b37-217eb4d7cfd3'::uuid
   AND COALESCE(p.unit_price, 0) > 0
   AND NOT EXISTS (
         SELECT 1 FROM public.material_audit_log l
          WHERE l.product_id = p.id
            AND l.action = 'system_price_alignment'
            AND l.changes->>'migration' = '20260925132000_purchase-order-integrity'
       );
