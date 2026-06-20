-- ════════════════════════════════════════════════════════════════════════
-- reference_sector_pricing — migra as linhas de min/par → pares/hora.
--
-- A aba "MOD por Setor" passou a usar PRODUTIVIDADE (pares por hora) em vez de
-- TEMPO (minutos por par). A fórmula virou `custo/par = custo_hora / pares_hora`.
--
-- As linhas ficam em `lines` (jsonb): cada elemento tinha `time_per_pair_min`,
-- agora deve ter `pairs_per_hour`. A conversão `pares_hora = 60 / min` PRESERVA
-- o custo exatamente: custo_hora / (60/min) = (min/60) × custo_hora — o mesmo
-- número da fórmula antiga. Logo `cost` e `total_cost` não mudam.
--
-- Idempotente: só toca linhas que ainda têm `time_per_pair_min`; depois de
-- convertidas a chave some e re-rodar é no-op. O lado TS (useReferenceSectorPricing)
-- também converte na leitura, então dados não migrados aqui ainda funcionam.
-- ════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.reference_sector_pricing') is null then
    return;
  end if;

  update public.reference_sector_pricing rsp
  set lines = sub.new_lines
  from (
    select rp.id,
      coalesce(
        jsonb_agg(
          case
            -- já tem pares/hora válido: só remove a chave legada
            when coalesce((elem->>'pairs_per_hour')::numeric, 0) > 0
              then elem - 'time_per_pair_min'
            -- legado com minutos > 0: deriva pares/hora = 60/min (preserva custo)
            when coalesce((elem->>'time_per_pair_min')::numeric, 0) > 0
              then (elem - 'time_per_pair_min')
                   || jsonb_build_object(
                        'pairs_per_hour',
                        round(60.0 / (elem->>'time_per_pair_min')::numeric, 4)
                      )
            -- sem produtividade de nenhum lado: mantém como está (custo 0)
            else elem - 'time_per_pair_min'
          end
          order by ord
        ),
        '[]'::jsonb
      ) as new_lines
    from public.reference_sector_pricing rp,
         lateral jsonb_array_elements(rp.lines) with ordinality as t(elem, ord)
    where jsonb_typeof(rp.lines) = 'array'
    group by rp.id
  ) sub
  where rsp.id = sub.id
    and exists (
      select 1 from jsonb_array_elements(rsp.lines) e
      where e ? 'time_per_pair_min'
    );
end $$;
