-- Ficha de Montadores: dificuldade Médio / Difícil com valores/par distintos.
-- Cada montador passa a ter DUAS taxas (R$/par) por setor; o `detalhe` (jsonb)
-- ganha as chaves medio/dificil por tamanho: [{tamanho, medio, dificil}].
-- Compat: `valor_par` vira a taxa MÉDIA (rate base histórica); linhas antigas
-- com detalhe [{tamanho, pares}] são lidas como tudo em MÉDIO no frontend.
alter table public.ficha_montadores
  add column if not exists valor_par_medio   numeric,
  add column if not exists valor_par_dificil numeric;

-- Backfill: médio = valor_par atual (taxa base); difícil começa em 0.
update public.ficha_montadores
   set valor_par_medio   = coalesce(valor_par_medio, valor_par, 0),
       valor_par_dificil = coalesce(valor_par_dificil, 0)
 where valor_par_medio is null or valor_par_dificil is null;

comment on column public.ficha_montadores.valor_par_medio   is 'R$/par da dificuldade MÉDIO (taxa base; migrada de valor_par).';
comment on column public.ficha_montadores.valor_par_dificil is 'R$/par da dificuldade DIFÍCIL.';
