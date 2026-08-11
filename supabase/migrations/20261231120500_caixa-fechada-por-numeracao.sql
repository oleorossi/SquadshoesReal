-- ============================================================================
-- Caixa fechada por numeração — modo de empacotamento no Pedido de Venda
-- ============================================================================
--
-- No pedido tradicional cada caixa leva a grade completa do cliente (34–40).
-- Alguns clientes pedem o contrário: cada caixa com a capacidade da colmeia em
-- pares da MESMA numeração. Isso muda como o rótulo de caixa externa é gerado.
--
-- Decisão do dono (11/08/2026): a escolha mora no PEDIDO, e o modo só é
-- permitido quando FECHA REDONDO — cada numeração dando múltiplo exato da
-- capacidade. É isso que garante que o número de volumes NÃO muda
-- (`Σ(pares_da_numeração / capacidade)` = `total / capacidade`), e por isso
-- NADA aqui toca `compute_sale_order_box_breakdown`, volumes da NF-e ou débito
-- de embalagem. A validação vive no cliente (`singleSizeMisfits`, boxPacking.ts).
--
-- Sem essa condição o modo criaria uma caixa parcial POR NUMERAÇÃO: medido no
-- PV-00144 (DS20 OFF WHITE, 780 pares, 65 fichas), sete caixas pela metade e o
-- pedido saltando de 65 para 68 volumes.
-- ============================================================================

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS box_grouping text NOT NULL DEFAULT 'grade';

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sale_orders_box_grouping_check'
  ) THEN
    ALTER TABLE public.sale_orders
      ADD CONSTRAINT sale_orders_box_grouping_check
      CHECK (box_grouping IN ('grade', 'numeracao_unica'));
  END IF;
END $mig$;

COMMENT ON COLUMN public.sale_orders.box_grouping IS
  'Como as caixas do pedido são montadas: grade = curva completa do cliente por caixa (padrão); numeracao_unica = cada caixa fechada com uma numeração só. Não altera a contagem de volumes — o modo só é oferecido quando cada numeração fecha caixa cheia.';

-- ---------------------------------------------------------------------------
-- As RPCs atômicas listam as colunas do cabeçalho EXPLICITAMENTE
-- ---------------------------------------------------------------------------
-- Sem incluir a coluna nova nelas, o botão salva na tela e o valor SOME ao
-- gravar — a mesma falha silenciosa que já mordeu `company_id` e `nfe_external`
-- neste formulário.
--
-- Em vez de recopiar 6–8KB de corpo de função à mão (onde um erro de
-- transcrição passaria despercebido), o patch é ancorado no texto atual e
-- CONFERE o resultado: se o fonte tiver mudado e a âncora não casar, a migration
-- FALHA em vez de aplicar pela metade.
DO $mig$
DECLARE
  src_create text;
  src_update text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src_create
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_sale_order_atomic';

  SELECT pg_get_functiondef(p.oid) INTO src_update
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_sale_order_atomic';

  IF src_create IS NULL OR src_update IS NULL THEN
    RAISE EXCEPTION 'RPC atômica de PV não encontrada — abortando.';
  END IF;

  -- CREATE: lista de colunas e VALUES.
  -- `v_header` nasce de jsonb_populate_record(NULL::sale_orders, p_header), então
  -- chave ausente vem NULL — o COALESCE é o que respeita o default da coluna.
  src_create := replace(
    src_create,
    'packaging_mode,' || chr(10) || '    delivery_week',
    'packaging_mode, box_grouping,' || chr(10) || '    delivery_week');
  src_create := replace(
    src_create,
    'v_header.packaging_mode, v_header.delivery_week',
    'v_header.packaging_mode, COALESCE(v_header.box_grouping, ''grade''), v_header.delivery_week');

  -- UPDATE: `v_merged := jsonb_populate_record(v_so, p_header)` usa a LINHA ATUAL
  -- como base, então chave ausente PRESERVA o valor gravado. Sem COALESCE aqui de
  -- propósito: forçar 'grade' apagaria a escolha de quem não mandou o campo.
  src_update := replace(
    src_update,
    'packaging_mode     = v_merged.packaging_mode,',
    'packaging_mode     = v_merged.packaging_mode,' || chr(10) ||
    '    box_grouping       = v_merged.box_grouping,');

  IF position('box_grouping' in src_create) = 0 THEN
    RAISE EXCEPTION 'Âncora não encontrada em create_sale_order_atomic — o fonte mudou.';
  END IF;
  IF position('COALESCE(v_header.box_grouping' in src_create) = 0 THEN
    RAISE EXCEPTION 'Âncora do VALUES não encontrada em create_sale_order_atomic.';
  END IF;
  IF position('box_grouping' in src_update) = 0 THEN
    RAISE EXCEPTION 'Âncora não encontrada em update_sale_order_atomic — o fonte mudou.';
  END IF;

  EXECUTE src_create;
  EXECUTE src_update;
END $mig$;

-- Prova de que o cabeçalho realmente persiste (o teste que teria pego o bug do
-- company_id). Roda dentro da própria migration e desfaz o que criou.
DO $mig$
DECLARE
  v_id  uuid;
  v_val text;
BEGIN
  INSERT INTO public.sale_orders (client_name, status, total, box_grouping)
  VALUES ('SMOKE box_grouping', 'Rascunho', 0, 'numeracao_unica')
  RETURNING id INTO v_id;

  SELECT box_grouping INTO v_val FROM public.sale_orders WHERE id = v_id;
  DELETE FROM public.sale_orders WHERE id = v_id;

  IF v_val IS DISTINCT FROM 'numeracao_unica' THEN
    RAISE EXCEPTION 'box_grouping não persistiu (veio %)', v_val;
  END IF;
END $mig$;
