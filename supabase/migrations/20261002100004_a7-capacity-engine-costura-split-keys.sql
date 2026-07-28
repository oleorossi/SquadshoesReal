-- ============================================================================
-- A7 (auditoria 2026-07-28) — engine de capacidade/produtividade não reconhece
-- os setores do split da Costura.
--
-- capacity_sector_key (viva = 20260719120100) não mapeava o mundo pós-split:
-- as operações do BOM criadas na fase 1 (20260719170000) têm stage='Costura'
-- (key 'costura'), enquanto o roteiro backfillado usa 'Costura Palmilha' /
-- 'Costura Cabedal' (keys 'costura_palmilha'/'costura_cabedal'). Efeitos:
-- as duas costuras apareciam como 'faltando' na Produtividade por Modelo, a
-- operação 'Costura Cabedal' caía no balde de órfãs (warning de MO fora do
-- roteiro no custeio) e set_model_sector_capacity inseria operação nova com
-- rótulo malformado 'Costura_Palmilha' (ELSE initcap do capacity_sector_label)
-- coexistindo com a 'Costura' órfã — duplicando a MO da costura no custo/par.
--
-- Fix:
--   1) backfill de bom_operations.stage: operações do stage legado 'Costura'
--      migram pro setor novo indicado pelo operation_name;
--   2) capacity_sector_key aprende 'costura' → 'costura_palmilha' (espelho de
--      src/lib/sectors.ts; nomes novos já passam cru pelo translate);
--   3) capacity_sector_label ganha os dois labels canônicos;
--   4) tg_disable_costura_palmilha_on_ready_made atualizado pra key nova
--      (comparava capacity_sector_key(stage)='costura', que deixaria de casar).
-- get_model_productivity e set_model_sector_capacity resolvem setor via essas
-- duas funções compartilhadas — não precisam de redefinição.
-- Idempotente (UPDATEs com WHERE que zera após a 1ª aplicação + CREATE OR REPLACE).
-- ============================================================================

-- 1) BACKFILL REMOVIDO (era aqui; aplicado e revertido em 2026-07-28).
--    O critério usava operation_name, mas TODAS as 42 operações vivas se
--    chamam 'Costura Cabedal' — a fase 1 nomeou assim o que existia, então o
--    nome NÃO é evidência de qual perna a operação representa. 25 das 42
--    pertencem a fichas cujo roteiro tem 'Costura Palmilha' e NÃO tem
--    'Costura Cabedal': o backfill as jogava no balde de órfãs e fazia
--    'Costura Palmilha' aparecer como faltando na Produtividade por Modelo —
--    o oposto do que esta migration pretende. E o UPDATE é one-way (o stage
--    'Costura' original se perde).
--    Sem o backfill o objetivo já é atingido: o item 2 abaixo mapeia o legado
--    'costura' → 'costura_palmilha', que casa com o roteiro dessas fichas.
--    Quando um backfill for mesmo necessário, o critério tem que ser o ROTEIRO
--    da ficha (technical_sheets.production_sectors), não o nome da operação,
--    e precisa guardar o stage anterior antes de escrever.

-- 2) Normalização stage/display → key canônica (espelho de src/lib/sectors.ts).
CREATE OR REPLACE FUNCTION public.capacity_sector_key(p_sector text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE k
    WHEN 'corte'      THEN 'corte_palmilha'
    WHEN 'palmilha'   THEN 'corte_palmilha'
    WHEN 'forracao'   THEN 'corte_forracao'
    WHEN 'aviamento'  THEN 'mesa'
    WHEN 'serigrafia' THEN 'silk'
    -- Split da Costura (20261001120000): o legado 'costura' resolve pra
    -- PALMILHA (era ela que a etapa única representava — ver trg_normalize);
    -- 'costura_palmilha'/'costura_cabedal' já saem do translate e passam cru.
    WHEN 'costura'    THEN 'costura_palmilha'
    ELSE k END
  FROM (SELECT lower(translate(replace(trim(coalesce(p_sector, '')), ' ', '_'),
    'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ', 'aaaaeeiooouucAAAAEEIOOOUUC'))) t(k)
$$;

-- 3) key → nome de exibição (= sector_settings.sector).
CREATE OR REPLACE FUNCTION public.capacity_sector_label(p_key text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_key
    WHEN 'corte_palmilha'   THEN 'Corte Palmilha'
    WHEN 'corte_forracao'   THEN 'Corte Forração'
    WHEN 'mesa'             THEN 'Aviamento'
    WHEN 'costura_palmilha' THEN 'Costura Palmilha'
    WHEN 'costura_cabedal'  THEN 'Costura Cabedal'
    WHEN 'costura'          THEN 'Costura'
    WHEN 'silk'             THEN 'Silk'
    WHEN 'colagem'          THEN 'Colagem'
    WHEN 'montagem'         THEN 'Montagem'
    WHEN 'solagem'          THEN 'Solagem'
    WHEN 'acabamento'       THEN 'Acabamento'
    WHEN 'expedicao'        THEN 'Expedição'
    ELSE initcap(coalesce(p_key, ''))
  END
$$;

-- 4) Palmilha pronta desativa a OPERAÇÃO de costura de palmilha no BOM.
--    Pós item 2, capacity_sector_key devolve 'costura_palmilha' tanto pro
--    stage novo quanto pro legado 'Costura' — a comparação antiga ('costura')
--    viraria no-op silencioso.
CREATE OR REPLACE FUNCTION public.tg_disable_costura_palmilha_on_ready_made()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.insole_ready_made IS DISTINCT FROM coalesce(OLD.insole_ready_made, false) THEN
    UPDATE bom_operations
       SET active = NOT NEW.insole_ready_made,
           updated_at = now()
     WHERE sheet_id = NEW.id
       AND public.capacity_sector_key(stage) = 'costura_palmilha'
       AND lower(operation_name) LIKE '%palmilha%';
  END IF;
  RETURN NEW;
END;
$function$;
