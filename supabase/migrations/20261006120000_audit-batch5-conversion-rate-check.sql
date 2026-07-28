-- Batch 5 (auditoria, tema T1): impede conversion_rate inválido no banco.
-- JÁ APLICADA via MCP. 0 linhas inválidas hoje → validou instantâneo.
-- Guarda contra o fallback silencioso 1:1 que gerava pedidos 100×/150× errados.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_conversion_rate_positive'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_conversion_rate_positive
      check (conversion_rate is null or conversion_rate > 0);
  end if;
end $$;
