-- ============================================================================
-- Fase 1 do épico "Consumo padrão por modelo de solado".
--
-- PROBLEMA: `products.is_standard_sole_item` existe pra marcar itens que sempre
-- entram no BOM (cola, linha, EVA). Estava marcada em 7 produtos e os 7 eram
-- SOLADOS. O auto-fill de `TechnicalSheets.tsx` (autoFillStandardItemsFromSole,
-- bloco "globalStandardItems") despeja todo produto com a flag no BOM da ficha
-- nova a 1 par/par ⇒ 56 linhas de solado no BOM de 8 fichas técnicas
-- (DS21, DS22, NL01..NL04, S-039, SP201 — 7 solados cada).
--
-- Custeio e MRP leem `sheet_materials`, então o custo dessas 8 referências
-- carrega 7 solados fantasma além do solado real da própria referência.
--
-- Esta migration NÃO toca no auto-fill (o código passa a filtrar categoria
-- Solado no mesmo commit) — ela limpa o dado já gravado e desarma a flag.
--
-- Reversível: as linhas removidas ficam em `_backup_bom_sole_rows_20261102`.
-- ============================================================================

-- 1) Backup ------------------------------------------------------------------
create table if not exists public._backup_bom_sole_rows_20261102 as
select sm.*, now() as backed_up_at
from public.sheet_materials sm
join public.products p on p.id = sm.product_id
where p.category ilike '%solado%' or lower(p.category) = 'sola';

create table if not exists public._backup_standard_sole_flag_20261102 as
select id as product_id, name, category, now() as backed_up_at
from public.products
where is_standard_sole_item = true;

-- 2) Remove as linhas de SOLADO do BOM das fichas ----------------------------
-- Um solado nunca é "material padrão" de uma ficha: o solado da referência é
-- resolvido por `technical_sheets.sole_group_id`, não por linha de BOM.
delete from public.sheet_materials sm
using public.products p
where p.id = sm.product_id
  and (p.category ilike '%solado%' or lower(p.category) = 'sola');

-- 3) Desarma a flag nos solados ----------------------------------------------
update public.products
set is_standard_sole_item = false
where is_standard_sole_item = true
  and (category ilike '%solado%' or lower(category) = 'sola');

-- 4) Guarda contra regressão --------------------------------------------------
-- A flag deixa de aceitar solado. Se alguém marcar de novo pela tela de
-- produto, o banco recusa em vez de contaminar o BOM silenciosamente.
alter table public.products
  drop constraint if exists chk_standard_sole_item_not_a_sole;

alter table public.products
  add constraint chk_standard_sole_item_not_a_sole
  check (
    is_standard_sole_item is not true
    or not (category ilike '%solado%' or lower(category) = 'sola')
  )
  not valid;

alter table public.products validate constraint chk_standard_sole_item_not_a_sole;

comment on constraint chk_standard_sole_item_not_a_sole on public.products is
  'Solado não pode ser item padrão global — a flag despejaria o solado no BOM de toda ficha nova (bug corrigido em 02/08/2026, 56 linhas em 8 fichas).';
