-- Fila do Ateliê some o job quando o número do PV não é o da URL.
--
-- O quadro filtra por job.order_number. A lista montava esse número só com
-- INNER JOIN sale_orders no sale_order_id do JOB. Dois efeitos:
--   1. Job cujo sale_order_id não resolve saía do JSON. O lote continuava
--      (EXISTS de qualquer job, ou o job do outro PV) e a tela dizia
--      "0 jobs / Nenhum job com esses filtros".
--   2. Lote aberto é compartilhado por referência × cor × variante. O
--      dropdown e o ?pedido= leem a DEMANDA. O cartão lia o sale_order_id
--      gravado no job, que o sync não atualiza no conflito. Os dois PVs
--      divergiam e o filtro do PV novo zerava a fila.
--
-- O número exibido passa a ser o da demanda. O do job só entra quando a
-- demanda não tem pedido. Modo nulo e setor costura_cabedal já passavam
-- nos filtros padrão; isto não mexe neles.
--
-- Não corta, não envia, não recebe e não dá UPDATE nas linhas existentes.
-- O sync, na próxima materialização de job ainda não enviado, passa a
-- copiar o pedido da demanda. Modo e prestador continuam intocados.

DO $patch_list$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.list_atelier_lots()'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'list_atelier_lots() não encontrada';
  END IF;
  IF strpos(v_def, 'so_dem.order_number') > 0 THEN
    RETURN;
  END IF;

  v_def := regexp_replace(
    v_def,
    'JOIN[[:space:]]+public\.sale_orders[[:space:]]+so[[:space:]]+ON[[:space:]]+so\.id[[:space:]]*=[[:space:]]*j\.sale_order_id',
    $j$LEFT JOIN public.sale_orders so ON so.id = j.sale_order_id
                   LEFT JOIN public.cabedal_prep_demands dem ON dem.id = j.demand_id
                   LEFT JOIN public.sale_orders so_dem ON so_dem.id = dem.sale_order_id$j$
  );
  v_def := regexp_replace(
    v_def,
    '''sale_order_item_id'',[[:space:]]*j\.sale_order_item_id,[[:space:]]*''order_number'',[[:space:]]*so\.order_number',
    $n$'sale_order_item_id', j.sale_order_item_id, 'sale_order_id', COALESCE(dem.sale_order_id, j.sale_order_id), 'order_number', COALESCE(NULLIF(btrim(so_dem.order_number), ''), NULLIF(btrim(so.order_number), ''))$n$
  );
  v_def := regexp_replace(
    v_def,
    'JOIN[[:space:]]+public\.sale_order_items[[:space:]]+soi[[:space:]]+ON[[:space:]]+soi\.id[[:space:]]*=[[:space:]]*d\.sale_order_item_id',
    'LEFT JOIN public.sale_order_items soi ON soi.id = d.sale_order_item_id'
  );

  IF strpos(v_def, 'so_dem.order_number') = 0
     OR strpos(v_def, 'LEFT JOIN public.cabedal_prep_demands dem') = 0
     OR strpos(v_def, 'LEFT JOIN public.sale_order_items soi') = 0
  THEN
    RAISE EXCEPTION 'list_atelier_lots: não achei o join do pedido do job para trocar pela demanda';
  END IF;
  EXECUTE v_def;
END
$patch_list$;

DO $patch_sync$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.atelier_sync_jobs_for_demand(uuid)'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'atelier_sync_jobs_for_demand(uuid) não encontrada';
  END IF;
  IF strpos(v_def, 'sale_order_id = EXCLUDED.sale_order_id') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, 'execution_mode = EXCLUDED') > 0 THEN
    RAISE EXCEPTION 'sync de jobs passaria a reescrever o modo';
  END IF;

  v_def := regexp_replace(
    v_def,
    'lot_id[[:space:]]*=[[:space:]]*EXCLUDED\.lot_id,[[:space:]]*pipeline_status[[:space:]]*=[[:space:]]*EXCLUDED\.pipeline_status',
    $n$lot_id = EXCLUDED.lot_id,
      sale_order_id = EXCLUDED.sale_order_id,
      sale_order_item_id = EXCLUDED.sale_order_item_id,
      pipeline_status = EXCLUDED.pipeline_status$n$
  );
  IF strpos(v_def, 'sale_order_id = EXCLUDED.sale_order_id') = 0 THEN
    RAISE EXCEPTION 'sync de jobs sem a âncora de lote/status';
  END IF;
  EXECUTE v_def;
END
$patch_sync$;
