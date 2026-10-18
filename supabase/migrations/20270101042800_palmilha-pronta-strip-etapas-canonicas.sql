-- ─────────────────────────────────────────────────────────────────────────────
-- Palmilha Pronta: strip das etapas canônicas de palmilha + cascade + backfill
--
-- Decisão do dono (2026-10): com sole_classification='palmilha_pronta' /
-- insole_ready_made, a ficha não passa por postos de palmilha — vem pronta
-- para a montagem. Etapas removidas:
--   Palmilha · Fibra, Palmilha · Forração, Acabamento Palmilha
--   (+ aliases legados: Corte Fibra/Palmilha/Forração, Forração, Costura,
--    Costura Palmilha).
--
-- O trigger vivo ainda só conhecia nomes pré-rename e, ao desligar a flag,
-- RESTAURAVA Corte Palmilha/Forração/Acabamento Palmilha — contradiz a
-- decisão de não reinventar rota ao sair de pronta (Q5=A).
--
-- Semântica nova:
--   • insole_ready_made=true → strip silencioso (nomes canônicos + aliases)
--   • true→false → NÃO restaura etapas
--   • products.sole_classification → palmilha_pronta cascateia nas fichas
--   • backfill: fichas + order_stages pendentes sem apontamento (Q7=B)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS private;

-- Lista canônica + aliases, lower(trim). 'costura cabedal' NÃO entra.
CREATE OR REPLACE FUNCTION private.ready_made_stripped_sector_names()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'palmilha · fibra',
    'palmilha · forração',
    'palmilha · forracao',
    'acabamento palmilha',
    'corte fibra',
    'corte palmilha',
    'corte forração',
    'corte forracao',
    'forração',
    'forracao',
    'costura palmilha',
    'costura'
  ];
$$;

CREATE OR REPLACE FUNCTION private.strip_ready_made_production_sectors(p_sectors jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(t.value ORDER BY t.ord)
        FROM jsonb_array_elements_text(COALESCE(p_sectors, '[]'::jsonb))
             WITH ORDINALITY AS t(value, ord)
       WHERE lower(trim(t.value)) <> ALL (private.ready_made_stripped_sector_names())
    ),
    '[]'::jsonb
  );
$$;

-- ─── A) Strip no save da ficha (sem restore) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_strip_cut_sectors_when_ready_made()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
BEGIN
  IF NEW.production_sectors IS NULL THEN
    NEW.production_sectors := '[]'::jsonb;
  END IF;

  IF COALESCE(NEW.insole_ready_made, false) = true THEN
    NEW.production_sectors := private.strip_ready_made_production_sectors(NEW.production_sectors);
  END IF;
  -- Sair de pronta (true→false) NÃO recoloca etapas — o dono escolhe a rota.

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_strip_cut_sectors_when_ready_made() IS
  'Quando insole_ready_made=true, remove etapas de palmilha (nomes canônicos '
  'Palmilha · Fibra / Forração / Acabamento Palmilha + aliases). Não restaura '
  'setores ao desligar a flag.';

-- Garante o gatilho no evento certo (já existia; recria por segurança).
DROP TRIGGER IF EXISTS trg_strip_cut_sectors_when_ready_made ON public.technical_sheets;
CREATE TRIGGER trg_strip_cut_sectors_when_ready_made
  BEFORE INSERT OR UPDATE OF insole_ready_made, production_sectors
  ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_strip_cut_sectors_when_ready_made();

-- ─── B) Cascade solado → ficha ao entrar em palmilha_pronta ──────────────────
CREATE OR REPLACE FUNCTION public.tg_cascade_palmilha_pronta_to_sheets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
DECLARE
  v_prev_role text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.sole_classification::text = 'palmilha_pronta'
     AND COALESCE(OLD.sole_classification::text, '') IS DISTINCT FROM 'palmilha_pronta'
  THEN
    -- Evita tg_ficha_recompute → enqueue de tiras (Permission denied sem JWT
    -- de usuário aprovado). O strip já vem aplicado no SET.
    v_prev_role := current_setting('session_replication_role', true);
    PERFORM set_config('session_replication_role', 'replica', true);

    UPDATE public.technical_sheets ts
       SET insole_ready_made = true,
           production_sectors = private.strip_ready_made_production_sectors(
             COALESCE(ts.production_sectors, '[]'::jsonb)
           ),
           updated_at = now()
     WHERE (
             NEW.group_id IS NOT NULL
             AND ts.sole_group_id = NEW.group_id
           )
        OR ts.primary_sole_id = NEW.id;

    PERFORM set_config(
      'session_replication_role',
      COALESCE(NULLIF(v_prev_role, ''), 'origin'),
      true
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cascade_palmilha_pronta_to_sheets ON public.products;
CREATE TRIGGER trg_cascade_palmilha_pronta_to_sheets
  AFTER UPDATE OF sole_classification
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_cascade_palmilha_pronta_to_sheets();

COMMENT ON FUNCTION public.tg_cascade_palmilha_pronta_to_sheets() IS
  'Ao marcar um solado como palmilha_pronta, força insole_ready_made e strip '
  'das etapas de palmilha nas fichas ligadas (sole_group_id / primary_sole_id). '
  'Sair de pronta não cascateia rota de volta.';

-- ─── C+D) Backfill fichas + OPs abertas ──────────────────────────────────────
-- order_stages: command boundary. technical_sheets: tg_ficha_recompute enfileira
-- tiras e estoura Permission denied sem JWT. Padrão 20270101029000.
SELECT set_config('app.order_stage_command_internal', '1', true);
SET LOCAL session_replication_role = replica;

UPDATE public.technical_sheets ts
   SET insole_ready_made = true,
       production_sectors = private.strip_ready_made_production_sectors(
         COALESCE(ts.production_sectors, '[]'::jsonb)
       ),
       updated_at = now()
 WHERE COALESCE(ts.insole_ready_made, false) = true
    OR EXISTS (
         SELECT 1
           FROM public.products p
          WHERE p.category = 'Solado'
            AND p.group_id IS NOT NULL
            AND p.group_id = ts.sole_group_id
            AND p.sole_classification::text = 'palmilha_pronta'
       )
    OR EXISTS (
         SELECT 1
           FROM public.products p
          WHERE p.id = ts.primary_sole_id
            AND p.sole_classification::text = 'palmilha_pronta'
       );

-- Q7=B: só pendente E sem apontamento. Finalizado/Cancelado intactos.
DELETE FROM public.order_stages os
 USING public.orders o
 WHERE os.order_id = o.id
   AND o.status NOT IN ('Finalizado', 'Cancelado', 'Cancelada')
   AND lower(trim(os.stage_name)) = ANY (private.ready_made_stripped_sector_names())
   AND lower(trim(COALESCE(os.status, ''))) = 'pendente'
   AND NOT EXISTS (
         SELECT 1
           FROM public.production_pointings pp
          WHERE pp.order_id = os.order_id
            AND lower(trim(pp.stage_name)) = lower(trim(os.stage_name))
       )
   AND EXISTS (
         SELECT 1
           FROM public.technical_sheets ts
          WHERE ts.id = o.reference_id
            AND (
              COALESCE(ts.insole_ready_made, false) = true
              OR EXISTS (
                   SELECT 1 FROM public.products p
                    WHERE p.category = 'Solado'
                      AND p.group_id IS NOT NULL
                      AND p.group_id = ts.sole_group_id
                      AND p.sole_classification::text = 'palmilha_pronta'
                 )
              OR EXISTS (
                   SELECT 1 FROM public.products p
                    WHERE p.id = ts.primary_sole_id
                      AND p.sole_classification::text = 'palmilha_pronta'
                 )
            )
       );

RESET session_replication_role;

NOTIFY pgrst, 'reload schema';
