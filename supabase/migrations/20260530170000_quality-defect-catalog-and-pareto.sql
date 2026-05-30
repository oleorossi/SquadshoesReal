-- Quick win 2 do roadmap (auditoria 30/05).
-- Catálogo padrão de defeitos típicos calçado + Pareto por setor (RCA).
-- quality_records (0 registros hoje) ganha FK opcional pra catálogo —
-- mantém compat com record_type/cause text livre, padroniza quando usuário
-- escolhe do dropdown.

CREATE TABLE IF NOT EXISTS public.quality_defect_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  default_severity text NOT NULL,
  default_sector text,
  can_rework boolean NOT NULL DEFAULT true,
  description text,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quality_defect_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quality_defect_catalog_select ON public.quality_defect_catalog;
CREATE POLICY quality_defect_catalog_select ON public.quality_defect_catalog
  FOR SELECT TO authenticated USING (is_approved_user());

DROP POLICY IF EXISTS quality_defect_catalog_write ON public.quality_defect_catalog;
CREATE POLICY quality_defect_catalog_write ON public.quality_defect_catalog
  FOR ALL TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente']));

INSERT INTO public.quality_defect_catalog (code, name, category, default_severity, default_sector, can_rework, description, sort_order) VALUES
  ('CORTE-001', 'Corte fora do molde', 'processo', 'major', 'Corte Forração', false, 'Peça cortada não bate com gabarito; refugo provável', 10),
  ('CORTE-002', 'Numeração trocada no corte', 'processo', 'major', 'Corte Forração', false, 'Lote saiu com numeração misturada da grade', 11),
  ('CORTE-003', 'Mancha no couro/material', 'material', 'minor', 'Corte Forração', true, 'Mancha detectada antes ou após corte', 12),
  ('COST-001', 'Pesponto torto', 'processo', 'major', 'Costura', true, 'Linha de costura fora de alinhamento', 20),
  ('COST-002', 'Linha solta', 'processo', 'minor', 'Costura', true, 'Pontas de linha mal arrematadas', 21),
  ('COST-003', 'Costura aberta', 'processo', 'major', 'Costura', true, 'Pesponto pulado ou solto deixando aberta', 22),
  ('COST-004', 'Pesponto fora do gabarito', 'processo', 'major', 'Costura', true, 'Costura fora da marcação técnica', 23),
  ('SILK-001', 'Estampa borrada', 'processo', 'major', 'Silk', false, 'Tinta correu na cura/estampagem', 30),
  ('SILK-002', 'Estampa fora de posição', 'processo', 'major', 'Silk', false, 'Arte deslocada do ponto correto', 31),
  ('SILK-003', 'Cor de estampa errada', 'processo', 'critical', 'Silk', false, 'Cor da tinta não bate com ficha', 32),
  ('COLA-001', 'Descolagem cabedal/forro', 'processo', 'major', 'Colagem', true, 'Cola não pegou entre camadas', 40),
  ('COLA-002', 'Cola visível externa', 'acabamento', 'minor', 'Colagem', true, 'Mancha de cola transbordando', 41),
  ('MONT-001', 'Descolagem sola-cabedal', 'processo', 'critical', 'Montagem', true, 'Sola se solta após montagem (falha grave)', 50),
  ('MONT-002', 'Cabedal mal centralizado', 'processo', 'major', 'Montagem', true, 'Cabedal montado torto na forma', 51),
  ('MONT-003', 'Forma inadequada', 'processo', 'major', 'Montagem', false, 'Numeração de forma errada usada', 52),
  ('SOL-001', 'Solado errado', 'processo', 'critical', 'Solagem', false, 'Solado de modelo ou cor errada aplicado', 60),
  ('SOL-002', 'Solado com defeito de fábrica', 'material', 'major', 'Solagem', false, 'Bolha/rebarba no solado recebido', 61),
  ('ACAB-001', 'Sujeira no acabamento', 'acabamento', 'minor', 'Acabamento', true, 'Marca de manuseio sem limpeza final', 70),
  ('ACAB-002', 'Pintura desigual', 'acabamento', 'major', 'Acabamento', true, 'Tinta de retoque fora do tom', 71),
  ('ACAB-003', 'Risco no cabedal', 'acabamento', 'major', 'Acabamento', false, 'Arranhão de ferramenta durante acabamento', 72),
  ('EXP-001', 'Par solto na caixa', 'embalagem', 'major', 'Expedição', false, 'Pé direito e esquerdo de pares diferentes', 80),
  ('EXP-002', 'Numeração errada na caixa', 'embalagem', 'major', 'Expedição', true, 'Etiqueta da caixa não bate com par interno', 81),
  ('EXP-003', 'Caixa danificada', 'embalagem', 'minor', 'Expedição', true, 'Caixa amassada ou rasgada', 82),
  ('MAT-001', 'Couro com mancha de cromo', 'material', 'major', 'Corte Forração', false, 'Defeito de curtume não detectado na entrada', 90),
  ('MAT-002', 'Material com diferença de tom', 'material', 'major', 'Corte Forração', false, 'Lote de couro/sintético com tons divergentes', 91),
  ('MAT-003', 'Material fora do dm² declarado', 'material', 'minor', 'Corte Forração', true, 'Rendimento real abaixo do informado pelo fornecedor', 92)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.quality_records
  ADD COLUMN IF NOT EXISTS defect_catalog_id uuid REFERENCES public.quality_defect_catalog(id);

CREATE INDEX IF NOT EXISTS quality_records_catalog_idx
  ON public.quality_records(defect_catalog_id) WHERE defect_catalog_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quality_records_stage_idx
  ON public.quality_records(stage_name);

CREATE OR REPLACE VIEW public.v_quality_pareto_by_sector AS
WITH base AS (
  SELECT
    qr.stage_name AS sector,
    COALESCE(dc.code, qr.record_type, 'UNCATEGORIZED') AS defect_code,
    COALESCE(dc.name, qr.record_type, 'Sem categoria') AS defect_name,
    COALESCE(dc.category, 'desconhecida') AS category,
    COALESCE(dc.default_severity, qr.severity, 'minor') AS severity,
    qr.quantity,
    qr.cost,
    qr.resolved,
    qr.created_at
  FROM public.quality_records qr
  LEFT JOIN public.quality_defect_catalog dc ON dc.id = qr.defect_catalog_id
  WHERE qr.created_at >= CURRENT_DATE - INTERVAL '90 days'
),
agg AS (
  SELECT
    sector, defect_code, defect_name, category, severity,
    COUNT(*) AS occurrences,
    SUM(quantity)::int AS total_pairs_affected,
    SUM(COALESCE(cost, 0))::numeric AS total_cost_impact,
    COUNT(*) FILTER (WHERE NOT COALESCE(resolved, false)) AS open_count
  FROM base
  GROUP BY sector, defect_code, defect_name, category, severity
),
ranked AS (
  SELECT
    a.*,
    SUM(a.total_pairs_affected) OVER (PARTITION BY a.sector ORDER BY a.total_pairs_affected DESC) AS cumulative_pairs,
    SUM(a.total_pairs_affected) OVER (PARTITION BY a.sector) AS sector_total_pairs
  FROM agg a
)
SELECT
  sector, defect_code, defect_name, category, severity,
  occurrences, total_pairs_affected, total_cost_impact, open_count,
  cumulative_pairs, sector_total_pairs,
  CASE WHEN sector_total_pairs > 0
       THEN ROUND(100.0 * cumulative_pairs / sector_total_pairs, 1)
       ELSE 0 END AS cumulative_pct
FROM ranked
ORDER BY sector, total_pairs_affected DESC;

ALTER VIEW public.v_quality_pareto_by_sector SET (security_invoker = on);
GRANT SELECT ON public.v_quality_pareto_by_sector TO authenticated;
GRANT SELECT ON public.quality_defect_catalog TO authenticated;
