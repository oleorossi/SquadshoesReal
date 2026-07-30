-- ============================================================
-- Grupo 25 — Capacidades padrão por categoria (calçados femininos)
--
-- Popula default_lead_times com valores realistas para as
-- principais categorias de calçados femininos.  A lógica de
-- fallback em computeSectorLeadTimeDays() usa esses valores
-- quando a ficha técnica não define capacity_per_day próprio.
--
-- Referências de throughput típico numa fábrica de pequeno-médio
-- porte (50–120 funcionários, turno único):
--   Corte Palmilha (sewing_capacity*)  : 400–600 par/dia
--   Corte Forração (cutting_capacity*) : 350–500 par/dia
--   Mesa (montagem de tiras)           : 200–350 par/dia
--   Silk / Serigrafia                  : 300–500 par/dia
--   Colagem                            : 400–600 par/dia
--   Montagem                           : 250–400 par/dia
--   Solagem                            : 350–500 par/dia
--   Acabamento                         : 400–600 par/dia
--
-- * naming histórico: sewing_capacity ↔ Corte Palmilha,
--                     cutting_capacity ↔ Corte Forração
--   (ver leadTime.ts SECTOR_CONFIG para o mapeamento completo)
-- ============================================================

-- Sanity-guard: a migration 20260511120000 deve ter adicionado as
-- colunas silk/gluing/soling em default_lead_times.  Se não
-- existirem, criamos aqui para não quebrar.
ALTER TABLE public.default_lead_times
  ADD COLUMN IF NOT EXISTS silk_capacity_per_day    integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gluing_capacity_per_day  integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS soling_capacity_per_day  integer DEFAULT NULL;

-- ─── Upsert por categoria ────────────────────────────────────────────────────
-- shoe_category é PK/unique em default_lead_times.
-- ON CONFLICT DO UPDATE só sobrescreve onde o valor já está NULL
-- para não apagar overrides manuais feitos pelo usuário.

INSERT INTO public.default_lead_times (
  shoe_category,
  -- lead time legacy (dias fixos — fallback de último recurso)
  lead_time_corte_dias,
  lead_time_costura_dias,
  lead_time_montagem_dias,
  lead_time_acabamento_dias,
  -- capacity columns (pares/dia — usados como prioridade 2 no fallback)
  cutting_capacity_per_day,   -- Corte Forração
  sewing_capacity_per_day,    -- Corte Palmilha
  assembly_capacity_per_day,  -- Montagem
  finishing_capacity_per_day, -- Acabamento
  silk_capacity_per_day,
  gluing_capacity_per_day,
  soling_capacity_per_day
)
VALUES
  -- Sandália de tiras (modelo mais comum em calçados femininos brasileiros)
  ('sandalia_tiras',   2, 2, 3, 2,  450, 500, 300, 500,  400, 500, 450),
  -- Rasteirinha / chinela plana
  ('rasteirinha',      1, 1, 2, 1,  500, 550, 350, 550,  400, 550, 500),
  -- Scarpin / pump fechado
  ('scarpin',          2, 2, 3, 2,  400, 450, 280, 480,  350, 450, 400),
  -- Anabela / plataforma
  ('anabela',          2, 2, 4, 2,  400, 450, 250, 450,  350, 400, 350),
  -- Mule / tamanco sem tira no calcanhar
  ('mule',             2, 2, 3, 2,  420, 470, 300, 470,  380, 470, 420),
  -- Bota cano curto
  ('bota_curta',       3, 3, 4, 2,  350, 400, 220, 420,  300, 380, 350),
  -- Bota cano longo / over-the-knee
  ('bota_longa',       4, 4, 5, 3,  280, 320, 180, 350,  260, 320, 280),
  -- Sapatilha / bailarina (sem solagem em borracha — solagem simples)
  ('sapatilha',        1, 1, 2, 1,  500, 550, 350, 550,  400, 550, 500),
  -- Tênis feminino
  ('tenis',            2, 2, 3, 2,  380, 420, 260, 460,  320, 420, 380),
  -- Genérico — usado quando shoe_category não bate com nenhum acima
  ('generico',         2, 2, 3, 2,  400, 450, 280, 480,  350, 450, 400)

ON CONFLICT (shoe_category) DO UPDATE SET
  -- Atualiza apenas colunas ainda NULL (respeita overrides manuais)
  lead_time_corte_dias       = COALESCE(default_lead_times.lead_time_corte_dias,       EXCLUDED.lead_time_corte_dias),
  lead_time_costura_dias     = COALESCE(default_lead_times.lead_time_costura_dias,     EXCLUDED.lead_time_costura_dias),
  lead_time_montagem_dias    = COALESCE(default_lead_times.lead_time_montagem_dias,    EXCLUDED.lead_time_montagem_dias),
  lead_time_acabamento_dias  = COALESCE(default_lead_times.lead_time_acabamento_dias,  EXCLUDED.lead_time_acabamento_dias),
  cutting_capacity_per_day   = COALESCE(default_lead_times.cutting_capacity_per_day,   EXCLUDED.cutting_capacity_per_day),
  sewing_capacity_per_day    = COALESCE(default_lead_times.sewing_capacity_per_day,    EXCLUDED.sewing_capacity_per_day),
  assembly_capacity_per_day  = COALESCE(default_lead_times.assembly_capacity_per_day,  EXCLUDED.assembly_capacity_per_day),
  finishing_capacity_per_day = COALESCE(default_lead_times.finishing_capacity_per_day, EXCLUDED.finishing_capacity_per_day),
  silk_capacity_per_day      = COALESCE(default_lead_times.silk_capacity_per_day,      EXCLUDED.silk_capacity_per_day),
  gluing_capacity_per_day    = COALESCE(default_lead_times.gluing_capacity_per_day,    EXCLUDED.gluing_capacity_per_day),
  soling_capacity_per_day    = COALESCE(default_lead_times.soling_capacity_per_day,    EXCLUDED.soling_capacity_per_day);

-- ─── Normaliza categorias existentes ─────────────────────────────────────────
-- Fichas com shoe_category em português livre (ex: 'Sandália', 'Bota') devem
-- apontar para uma das linhas acima.  Fazemos UPDATE defensivo apenas onde
-- a linha alvo existir.

-- Normaliza shoe_category para slugs canônicos usando padrões mutuamente
-- exclusivos — cada linha só pode bater em UM branch do CASE.
-- Ordem: mais específico → mais genérico para evitar ambiguidade.
UPDATE public.technical_sheets ts
SET shoe_category = CASE
  -- Tênis / sneaker — verificar antes de "tiras" para evitar falso match
  WHEN ts.shoe_category ~* 'teni[sc]|sneaker|sport'          THEN 'tenis'
  -- Rasteirinha / chinela — antes de sandalia_tiras
  WHEN ts.shoe_category ~* 'rastei|chinela|flipflop|flip.flop' THEN 'rasteirinha'
  -- Anabela / plataforma — verificar antes de scarpin (plataforma de salto)
  WHEN ts.shoe_category ~* 'anabela|plataforma|wedge'         THEN 'anabela'
  -- Mule / tamanco
  WHEN ts.shoe_category ~* 'mule|tamanco|clog'                THEN 'mule'
  -- Sapatilha / bailarina / flat
  WHEN ts.shoe_category ~* 'sapatilha|bailarina|\bflat\b'     THEN 'sapatilha'
  -- Scarpin — salto somente quando NÃO for plataforma nem anabela (já tratados acima)
  WHEN ts.shoe_category ~* 'scarpin|pump|salto alto'          THEN 'scarpin'
  -- Sandália de tiras — substring 'tiras' explícito
  WHEN ts.shoe_category ~* 'sandal.*tira|tira.*sandal|\btiras\b' THEN 'sandalia_tiras'
  -- Bota cano longo — "longa", "over", "cano longo", "knee" mas NÃO "curta"
  WHEN ts.shoe_category ~* 'bota'
   AND ts.shoe_category ~* 'long|over.knee|cano longo|cano alto'
   AND ts.shoe_category !~* 'curta|ankle|short'               THEN 'bota_longa'
  -- Bota cano curto — "curta", "ankle", "short", "cano curto"
  WHEN ts.shoe_category ~* 'bota'
   AND ts.shoe_category ~* 'curta|ankle|short|cano curto'     THEN 'bota_curta'
  -- Bota genérica (sem distinção de cano)
  WHEN ts.shoe_category ~* '\bbota\b'                         THEN 'bota_curta'
  ELSE NULL
END
WHERE
  -- Só roda onde o CASE acima produziu um slug válido
  CASE
    WHEN ts.shoe_category ~* 'teni[sc]|sneaker|sport'           THEN 'tenis'
    WHEN ts.shoe_category ~* 'rastei|chinela|flipflop|flip.flop' THEN 'rasteirinha'
    WHEN ts.shoe_category ~* 'anabela|plataforma|wedge'          THEN 'anabela'
    WHEN ts.shoe_category ~* 'mule|tamanco|clog'                 THEN 'mule'
    WHEN ts.shoe_category ~* 'sapatilha|bailarina|\bflat\b'      THEN 'sapatilha'
    WHEN ts.shoe_category ~* 'scarpin|pump|salto alto'           THEN 'scarpin'
    WHEN ts.shoe_category ~* 'sandal.*tira|tira.*sandal|\btiras\b' THEN 'sandalia_tiras'
    WHEN ts.shoe_category ~* 'bota' AND ts.shoe_category ~* 'long|over.knee|cano longo|cano alto'
     AND ts.shoe_category !~* 'curta|ankle|short'               THEN 'bota_longa'
    WHEN ts.shoe_category ~* 'bota' AND ts.shoe_category ~* 'curta|ankle|short|cano curto' THEN 'bota_curta'
    WHEN ts.shoe_category ~* '\bbota\b'                          THEN 'bota_curta'
    ELSE NULL
  END IS NOT NULL
  -- Não sobrescreve categorias já normalizadas
  AND NOT EXISTS (
    SELECT 1 FROM public.default_lead_times dlt2
    WHERE dlt2.shoe_category = ts.shoe_category
  )
  -- O slug alvo deve existir em default_lead_times (FK safety)
  AND EXISTS (
    SELECT 1 FROM public.default_lead_times dlt3
    WHERE dlt3.shoe_category = CASE
      WHEN ts.shoe_category ~* 'teni[sc]|sneaker|sport'           THEN 'tenis'
      WHEN ts.shoe_category ~* 'rastei|chinela|flipflop|flip.flop' THEN 'rasteirinha'
      WHEN ts.shoe_category ~* 'anabela|plataforma|wedge'          THEN 'anabela'
      WHEN ts.shoe_category ~* 'mule|tamanco|clog'                 THEN 'mule'
      WHEN ts.shoe_category ~* 'sapatilha|bailarina|\bflat\b'      THEN 'sapatilha'
      WHEN ts.shoe_category ~* 'scarpin|pump|salto alto'           THEN 'scarpin'
      WHEN ts.shoe_category ~* 'sandal.*tira|tira.*sandal|\btiras\b' THEN 'sandalia_tiras'
      WHEN ts.shoe_category ~* 'bota' AND ts.shoe_category ~* 'long|over.knee|cano longo|cano alto'
       AND ts.shoe_category !~* 'curta|ankle|short'               THEN 'bota_longa'
      WHEN ts.shoe_category ~* 'bota' AND ts.shoe_category ~* 'curta|ankle|short|cano curto' THEN 'bota_curta'
      WHEN ts.shoe_category ~* '\bbota\b'                          THEN 'bota_curta'
      ELSE NULL
    END
  );

-- ─── Comentário de manutenção ─────────────────────────────────────────────────
COMMENT ON TABLE public.default_lead_times IS
'Capacidades e lead times padrão por categoria de calçado.  Usado como fallback
 pelo computeSectorLeadTimeDays() quando a ficha técnica não define o campo
 <setor>_capacity_per_day próprio.  Prioridade: ficha > default_lead_times >
 constante hard-coded em leadTime.ts.';
