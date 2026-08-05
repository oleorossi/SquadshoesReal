-- Revoga SELECT do role `anon` nas 13 views SECURITY DEFINER ainda expostas.
--
-- POR QUE
-- View sem `security_invoker=true` roda com os privilegios do DONO (postgres), nao
-- os de quem consulta. Isso e o comportamento padrao do Postgres e nao e, por si so,
-- um defeito -- e o que permite a view agregar tabelas que o usuario nao le direto.
-- O defeito e o GRANT: com SELECT concedido a `anon`, qualquer requisicao com a
-- chave publishable (que vai no bundle do navegador, VITE_SUPABASE_PUBLISHABLE_KEY)
-- le o conteudo SEM LOGIN -- e a view, rodando como dono, entrega dados de orders,
-- clients, contractors e custo por minuto de setor furando a RLS dessas tabelas.
--
-- Confirmado ao vivo antes desta migration:
--   has_table_privilege('anon', <view>, 'SELECT') = true nas 13 abaixo.
--
-- POR QUE `REVOKE ... FROM anon` BASTA AQUI (e nao bastaria nas funcoes)
-- O ACL das 13 e `postgres=arwdDxtm/postgres | anon=arwdDxtm/postgres | ...`:
-- o `anon` tem grant PROPRIO, nao herdado de PUBLIC. Nas funcoes SECURITY DEFINER
-- o caso e outro (`=X/postgres` = grant a PUBLIC), e la um REVOKE FROM anon seria
-- NO-OP -- por isso aquele item continua em laudo, nao foi aplicado junto.
--
-- POR QUE E SEGURO
-- As 13 sao lidas apenas por hooks/dialogs/paginas atras de ProtectedRoute; nenhuma
-- e consultada pela tela de autenticacao. Duas (v_fichas_sem_solado_embalagem,
-- v_service_order_refs) nao tem nenhum uso no src/. O role `authenticated` mantem
-- SELECT em todas -- nenhuma tela logada perde acesso.
--
-- PADRAO SEGUIDO
-- Espelha o que ja foi feito em sale_order_min_billing, v_mrp_needs,
-- v_products_below_rop, v_sector_load_by_reference e v_time_pendings, cujo ACL de
-- anon hoje e `awdDxtm` (sem o `r` de SELECT).

do $$
declare
  v text;
  alvos text[] := array[
    'purchase_projection_timeline',
    'v_bom_audit_issues',
    'v_contractor_metrics',
    'v_fichas_sem_solado_embalagem',
    'v_fixed_assets',
    'v_materials_config_issues',
    'v_ncm_coverage',
    'v_product_abc',
    'v_production_queue_detail',
    'v_sector_cost_per_minute',
    'v_service_order_contractor_balance',
    'v_service_order_refs',
    'v_solados_sem_embalagem'
  ];
begin
  foreach v in array alvos loop
    if to_regclass('public.' || v) is null then
      raise notice 'view %.% nao existe -- pulando', 'public', v;
      continue;
    end if;
    execute format('revoke select on public.%I from anon', v);
    -- reafirma o acesso de quem DEVE ler, para o revoke nunca derrubar tela logada
    execute format('grant select on public.%I to authenticated, service_role', v);
  end loop;
end $$;

-- Trava anti-regressao: se alguem reconceder SELECT a anon numa dessas, a proxima
-- execucao desta migration (ou uma rodada manual deste bloco) falha alto.
do $$
declare
  expostas text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into expostas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and c.relname = any (array[
      'purchase_projection_timeline','v_bom_audit_issues','v_contractor_metrics',
      'v_fichas_sem_solado_embalagem','v_fixed_assets','v_materials_config_issues',
      'v_ncm_coverage','v_product_abc','v_production_queue_detail',
      'v_sector_cost_per_minute','v_service_order_contractor_balance',
      'v_service_order_refs','v_solados_sem_embalagem'
    ])
    and has_table_privilege('anon', c.oid, 'SELECT');

  if expostas is not null then
    raise exception 'anon ainda le view(s) SECURITY DEFINER: %', expostas;
  end if;
end $$;
