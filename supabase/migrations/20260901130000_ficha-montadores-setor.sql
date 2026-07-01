-- Ficha de Montadores → setores INDEPENDENTES na mesma tela (2026-06-30).
-- Adiciona `setor` à chamada do dia pra suportar abas independentes
-- (Montadores = montagem, Soladores = solagem, …) com a MESMA dinâmica mas
-- dados e relatórios separados. Cada aba lê/grava só o seu setor
-- (FichaMontadoresPage filtra `.eq('setor', setor)`).
--
-- Aditivo e idempotente. Todos os lançamentos existentes são de montagem, então
-- o default 'montagem' já classifica o histórico corretamente (33 linhas hoje).
alter table public.ficha_montadores
  add column if not exists setor text not null default 'montagem';

comment on column public.ficha_montadores.setor is
  'Setor da chamada do dia: montagem (montadores) | solagem (soladores) | etc. '
  'Permite abas independentes na mesma tela, com relatórios independentes. '
  'Default montagem (todo dado existente é de montagem).';
