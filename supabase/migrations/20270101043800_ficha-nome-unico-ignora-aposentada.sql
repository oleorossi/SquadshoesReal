-- Alinha technical_sheets_name_unique_idx com findSheetNameCollision
-- (src/hooks/useTechnicalSheets.ts) e com a decisão documentada no próprio
-- hook: "Ficha aposentada também não reserva o nome operacional".
--
-- Sintoma (19/10/2026): depois da aposentadoria em massa de 18/10, recriar
-- ou renomear uma ficha para um nome que ainda existe só em linha aposentada
-- (SP130, BT01, I50, …) passava na trave da UI e estourava no banco:
--   duplicate key value violates unique constraint "technical_sheets_name_unique_idx"
-- Toast: "Falha ao salvar: …" (useUpdateSheet) / "Erro: …" (useAddSheet).
--
-- O índice original (20270101006500) era parcial só quanto a nome vazio.
-- Passa a excluir também retired_at IS NOT NULL — o histórico continua no
-- UUID; o nome volta a ser livre para a ficha operacional nova/corrigida.
--
-- Pré-condição (medida na aplicação): 0 pares de fichas ATIVAS com o mesmo
-- lower(trim(name)). Sem isso o CREATE UNIQUE INDEX falharia.

do $$
declare
  v_dups integer;
  v_amostra text;
begin
  select count(*), coalesce(string_agg(nome, ', '), '')
    into v_dups, v_amostra
  from (
    select lower(trim(name)) as nome
    from public.technical_sheets
    where retired_at is null
      and coalesce(trim(name), '') <> ''
    group by lower(trim(name))
    having count(*) > 1
    limit 20
  ) d;

  if v_dups > 0 then
    raise exception
      'Nao da pra recriar o indice unico (so ativas): % nome(s) duplicado(s) entre fichas ativas — %. Resolva o cadastro antes.',
      v_dups, v_amostra;
  end if;
end $$;

drop index if exists public.technical_sheets_name_unique_idx;

create unique index technical_sheets_name_unique_idx
  on public.technical_sheets (lower(trim(name)))
  where retired_at is null
    and coalesce(trim(name), '') <> '';

comment on index public.technical_sheets_name_unique_idx is
  'Nome da ficha e unico entre fichas ATIVAS (case-insensitive, trim). Parcial: ignora nome vazio (rascunho) e retired_at IS NOT NULL (aposentada nao reserva o nome — espelha findSheetNameCollision). NAO criar equivalente em `code`.';
