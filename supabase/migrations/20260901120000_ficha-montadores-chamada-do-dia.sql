-- Ficha de Montadores → CHAMADA DO DIA
-- Repropósito da página: passa a registrar a PRODUÇÃO DIÁRIA dos montadores
-- (quantas fichas cada um fechou por dia) em vez da grade de numerações.
--
-- Modelo novo ('chamada'): 1 linha por (dia, montador_id) com:
--   · fichas_dia = contagem de fichas do montador naquele dia
--   · detalhe    = quebra OPCIONAL por referência/cor (a soma = fichas_dia)
-- Compat: grava total = fichas_dia e copias = 1, então a aba Produtividade
-- (pares × valor/par) e o histórico continuam funcionando sem reescrever fórmula.
--
-- As fichas antigas (grade de numerações) viram origem='legacy' e seguem intactas.

alter table public.ficha_montadores
  add column if not exists fichas_dia integer not null default 0,
  add column if not exists detalhe    jsonb,
  add column if not exists origem     text not null default 'chamada';

-- Tudo que já existe é do modelo antigo (esta é a 1ª entrada do modelo 'chamada').
update public.ficha_montadores set origem = 'legacy' where origem <> 'legacy';

-- 1 lançamento por (dia, montador) APENAS no modelo novo; legado fica livre
-- (um montador podia ter várias fichas de grade no mesmo dia).
create unique index if not exists ficha_montadores_chamada_dia_montador_uniq
  on public.ficha_montadores (dia, montador_id)
  where origem = 'chamada' and montador_id is not null;

comment on column public.ficha_montadores.fichas_dia is
  'Modelo "chamada": nº de fichas que o montador fechou no dia. Grava-se total=fichas_dia, copias=1.';
comment on column public.ficha_montadores.detalhe is
  'Modelo "chamada": quebra opcional [{reference_id, referencia, cor, qtd}] cuja soma = fichas_dia.';
comment on column public.ficha_montadores.origem is
  'chamada = produção diária (modelo novo) | legacy = ficha de grade antiga.';
