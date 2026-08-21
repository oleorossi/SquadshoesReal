-- Índice único case-insensitive no NOME da ficha técnica. Pedido do dono em
-- 20/08/2026: "colocar uma trave pra não permitir cadastrar a mesma referência
-- que já tem no sistema".
--
-- Espelha o que `product_groups.name` já tem (migration 20260901140000): a trave
-- da UI (`findSheetNameCollision`, em `useTechnicalSheets.ts`) cobre o cadastro e
-- o rename pela tela; este índice cobre o resto — SQL Editor, importação, e
-- corrida entre duas abas, onde o SELECT da UI passa e os dois INSERTs entram.
--
-- ⚠ A trave é por NOME, NÃO por código. `technical_sheets.code` é rotulado
-- "Código interno / SKU (opcional)" na própria tela e é reusado de propósito
-- entre fichas distintas. Medido em 20/08/2026: BT01/BT02 dividem o code
-- 'BT01', I100/I90/I91 dividem 'I90I', NL01/NL02 dividem 'NL02', CF 07/CF 09
-- dividem 'CONFORTO' e CF 05/ST 10 dividem 'CONFORTO ' (com espaço). São 11
-- fichas legítimas — um índice único em `code` derrubaria todas elas. Não crie.
--
-- ⚠ Índice PARCIAL, ignorando nome vazio. Hoje a base tem 0 ficha sem nome, mas
-- ficha nasce em rascunho e travar o vazio impediria salvar duas antes de
-- nomear. Se um dia "ficha sem nome" precisar ser proibida, isso é um NOT NULL /
-- CHECK, não trabalho deste índice.
--
-- Só foi possível criar agora porque o único par duplicado da base — duas fichas
-- 'SP130' — foi resolvido no mesmo dia: a de código vazio (criada em 20/08, sem
-- nenhum PV ou OP) era cópia acidental e recebeu por engano a foto que a ficha
-- em uso deveria ter. A imagem foi copiada para a ficha em uso (código 'SP130',
-- 2 itens de PV e 2 OPs) e a cópia foi excluída, com decisão explícita do dono.

do $$
declare
  v_dups integer;
  v_amostra text;
begin
  select count(*), coalesce(string_agg(nome, ', '), '')
    into v_dups, v_amostra
  from (
    select lower(trim(name)) as nome
    from technical_sheets
    where coalesce(trim(name), '') <> ''
    group by lower(trim(name))
    having count(*) > 1
    limit 20
  ) d;

  if v_dups > 0 then
    raise exception
      'Nao da pra criar o indice unico: % nome(s) de ficha ainda duplicado(s) — %. Resolva o cadastro antes.',
      v_dups, v_amostra;
  end if;
end $$;

create unique index if not exists technical_sheets_name_unique_idx
  on technical_sheets (lower(trim(name)))
  where coalesce(trim(name), '') <> '';

comment on index technical_sheets_name_unique_idx is
  'Nome da ficha e unico (case-insensitive, sem espaco nas extremidades). Parcial: nome vazio fica de fora, pra nao travar rascunho. NAO criar equivalente em `code` — codigo e opcional e reusado de proposito entre fichas (BT01/BT02, I100/I90/I91, NL01/NL02, CF 07/CF 09).';
