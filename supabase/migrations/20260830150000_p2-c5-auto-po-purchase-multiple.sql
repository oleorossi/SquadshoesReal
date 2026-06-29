-- C5 (auditoria de sistema 2026-06-29) — aplicada via MCP; registro no repo.
--
-- auto_create_purchase_order (OC automática por estoque mínimo) inseria a qty
-- sugerida CRUA, ignorando purchase_multiple — enquanto wizard, MRP e per-PV
-- arredondam pro múltiplo de embalagem. Patch idempotente via pg_get_functiondef
-- + replace (mesmo idioma do patch F2 já existente no repo), pra não retranscrever
-- a função inteira.
do $patch$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc
   where proname='auto_create_purchase_order' and pronamespace='public'::regnamespace;
  if v_src is null then raise warning 'auto_create_purchase_order não encontrada'; return; end if;
  if v_src like '%v_multiple%' then return; end if;

  if position('  v_new_promised date;' in v_src) = 0 then
    raise warning 'C5: âncora do DECLARE não encontrada — NÃO aplicado'; return;
  end if;
  v_src := replace(v_src, '  v_new_promised date;',
                          '  v_new_promised date;'||E'\n  v_multiple numeric;');

  if position('        INSERT INTO purchase_order_items (purchase_order_id, product_id' in v_src) = 0 then
    raise warning 'C5: âncora do INSERT não encontrada — NÃO aplicado'; return;
  end if;
  v_src := replace(v_src,
    '        INSERT INTO purchase_order_items (purchase_order_id, product_id',
    '        v_multiple := COALESCE(NULLIF(NEW.purchase_multiple,0), (SELECT NULLIF(pg.purchase_multiple,0) FROM product_groups pg WHERE pg.id = NEW.group_id), 1);'
    ||E'\n        IF v_multiple > 1 THEN v_suggested_qty := ceil(v_suggested_qty / v_multiple) * v_multiple; END IF;'
    ||E'\n        INSERT INTO purchase_order_items (purchase_order_id, product_id');

  execute v_src;
end
$patch$;
