-- Capacidade: nomes canônicos de setor + lacuna de Expedição da categoria Bota
--
-- `Costura` continua sendo o padrão compartilhado pela Costura Palmilha. O
-- roteiro também consulta `Costura Cabedal`, que não tinha padrão equivalente:
-- 17 fichas caíam em "tempo faltando" apesar do valor-base já existir. O
-- legado é preservado e um segundo padrão é criado para o cabedal.
--
-- Expedição é a mesma operação de embalagem/conferência usada pelas demais
-- categorias. Bota era a única categoria sem o padrão-base de 1,125 min/par.

DO $migration$
DECLARE
  v_renamed integer;
BEGIN
  INSERT INTO public.sector_minutes_default (shoe_category, sector, minutes_per_pair)
  SELECT shoe_category, 'Costura Cabedal', minutes_per_pair
    FROM public.sector_minutes_default
   WHERE sector = 'Costura'
  ON CONFLICT (shoe_category, sector) DO UPDATE
    SET minutes_per_pair = EXCLUDED.minutes_per_pair;
  GET DIAGNOSTICS v_renamed = ROW_COUNT;

  IF v_renamed = 0 THEN
    RAISE EXCEPTION 'Nenhum padrão de Costura foi encontrado para cobrir Costura Cabedal; revise a migration antes de aplicar.';
  END IF;

  INSERT INTO public.sector_minutes_default (shoe_category, sector, minutes_per_pair)
  VALUES ('Bota', 'Expedição', 1.125)
  ON CONFLICT (shoe_category, sector) DO UPDATE
    SET minutes_per_pair = EXCLUDED.minutes_per_pair;
END;
$migration$;
