-- Auditoria somente leitura do domínio de fichas técnicas.
-- Executar pela workflow supabase-db-exec.yml. Não altera dados nem esquema.

-- As RPCs de diagnóstico exigem usuário aprovado. A Management API executa
-- como postgres sem JWT, então simulamos apenas o `sub` de um perfil aprovado
-- durante esta sessão de auditoria. Nenhum dado do perfil é devolvido.
SELECT set_config(
  'request.jwt.claim.sub',
  COALESCE((SELECT id::text FROM public.profiles WHERE approved = true ORDER BY created_at LIMIT 1), ''),
  false
);

WITH
sheet_summary AS (
  SELECT jsonb_build_object(
    'total', count(*),
    'publicadas', count(*) FILTER (WHERE status_ficha = 'publicada'),
    'validadas', count(*) FILTER (WHERE status_ficha = 'validada'),
    'rascunhos', count(*) FILTER (WHERE COALESCE(status_ficha, 'rascunho') = 'rascunho'),
    'em_uso_em_pv', count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.sale_order_items soi WHERE soi.reference_id = ts.id
    )),
    'publicadas_sem_ncm_valido', count(*) FILTER (
      WHERE status_ficha = 'publicada' AND COALESCE(ncm, '') !~ '^[0-9]{8}$'
    ),
    'publicadas_sem_setores', count(*) FILTER (
      WHERE status_ficha = 'publicada'
        AND (production_sectors IS NULL OR jsonb_typeof(production_sectors) <> 'array'
          OR jsonb_array_length(production_sectors) = 0)
    )
  ) AS value
  FROM public.technical_sheets ts
),
legacy_audit_summary AS (
  SELECT to_jsonb(s) AS value
  FROM public.v_technical_sheets_audit_summary s
),
legacy_false_positives AS (
  SELECT jsonb_build_object(
    'modelo_tiras_cobrado_como_cabedal', count(*) FILTER (
      WHERE COALESCE(ts.has_straps, false)
        AND (a.missing_upper_material OR a.missing_upper_consumption)
    ),
    'palmilha_pronta_cobrada_como_placa', count(*) FILTER (
      WHERE COALESCE(ts.insole_ready_made, false)
        AND (a.missing_insole_material OR a.missing_insole_consumption)
    ),
    'regra_global_solado_ignorada_pelo_audit', count(*) FILTER (
      WHERE a.missing_sole_color_mapping
        AND ts.sole_group_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.sole_color_conjugations c
          WHERE c.sole_group_id = ts.sole_group_id AND c.active = true
        )
    )
  ) AS value
  FROM public.v_technical_sheets_audit a
  JOIN public.technical_sheets ts ON ts.id = a.id
),
audit_gap_samples AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.critical_count DESC, x.code), '[]'::jsonb) AS value
  FROM (
    SELECT a.id, a.code, a.name, a.status,
      (a.missing_upper_material::int + a.missing_upper_consumption::int
       + a.missing_lining_material::int + a.missing_lining_consumption::int
       + a.missing_insole_material::int + a.missing_insole_consumption::int
       + a.missing_sole_material::int + a.missing_sole_consumption::int
       + a.sole_driven_but_specs_missing::int + a.missing_production_sectors::int) AS critical_count
    FROM public.v_technical_sheets_audit a
    ORDER BY critical_count DESC, a.code
    LIMIT 15
  ) x
  WHERE x.critical_count > 0
),
unit_summary AS (
  SELECT jsonb_build_object(
    'produtos_unidade_nao_canonica', count(*) FILTER (
      WHERE lower(trim(COALESCE(p.unit, ''))) NOT IN
        ('m','cm','mm','dm²','m²','cm²','un','par','placa','kg','g','l','ml')
    ),
    'compra_diferente_sem_conversao', count(*) FILTER (
      WHERE COALESCE(trim(p.purchase_unit), '') <> ''
        AND lower(trim(p.purchase_unit)) <> lower(trim(COALESCE(p.unit, '')))
        AND COALESCE(p.conversion_rate, 0) <= 0
    ),
    'mesma_unidade_com_taxa_invalida', count(*) FILTER (
      WHERE COALESCE(trim(p.purchase_unit), '') <> ''
        AND lower(trim(p.purchase_unit)) = lower(trim(COALESCE(p.unit, '')))
        AND COALESCE(p.conversion_rate, 1) <> 1
    )
  ) AS value
  FROM public.products p
  WHERE p.active = true
    AND (
      EXISTS (SELECT 1 FROM public.sheet_materials sm WHERE sm.product_id = p.id)
      OR EXISTS (SELECT 1 FROM public.technical_sheet_component_colors cc WHERE cc.product_id = p.id)
      OR EXISTS (SELECT 1 FROM public.technical_sheets ts WHERE ts.primary_sole_id = p.id)
      OR EXISTS (SELECT 1 FROM public.technical_sheets ts WHERE ts.upper_material_product_id = p.id)
      OR EXISTS (SELECT 1 FROM public.technical_sheets ts WHERE ts.lining_material_product_id = p.id)
    )
),
missing_width AS (
  SELECT jsonb_build_object(
    'total', count(*),
    'amostra', COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.used_in_sheets DESC, x.product_name), '[]'::jsonb)
  ) AS value
  FROM (
    SELECT * FROM public.list_materials_missing_width() LIMIT 20
  ) x
),
consistency AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY
    CASE c.severity WHEN 'alto' THEN 1 WHEN 'medio' THEN 2 ELSE 3 END,
    c.check_name
  ), '[]'::jsonb) AS value
  FROM public.consumption_consistency_report() c
),
sole_spec_gaps AS (
  SELECT jsonb_build_object(
    'numeracoes_sem_spec', count(*),
    'pares_vendidos_afetados', COALESCE(sum(g.pares_vendidos), 0),
    'pares_com_forro_palmilha_zero', COALESCE(sum(g.pares_vendidos) FILTER (WHERE g.forro_palmilha_zera), 0),
    'amostra', COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.pares_vendidos DESC), '[]'::jsonb)
  ) AS value
  FROM (SELECT * FROM public.list_sole_spec_gaps() ORDER BY pares_vendidos DESC LIMIT 20) g
),
snapshot_summary AS (
  SELECT jsonb_build_object(
    'total', count(*),
    'marcados_desatualizados', count(*) FILTER (WHERE s.outdated_at IS NOT NULL),
    'ficha_mudou_sem_marcar_snapshot', count(*) FILTER (
      WHERE ts.updated_at > s.frozen_at AND s.outdated_at IS NULL
    ),
    'pvs_com_reserva_desatualizada', (
      SELECT count(*) FROM public.sale_orders so WHERE so.reservations_outdated_at IS NOT NULL
    )
  ) AS value
  FROM public.technical_sheet_snapshots s
  JOIN public.technical_sheets ts ON ts.id = s.sheet_id
),
debit_summary AS (
  SELECT jsonb_build_object(
    'linhas_avaliadas_60d', count(*),
    'furos', count(*) FILTER (WHERE d.classe = 'furo'),
    'divergentes', count(*) FILTER (WHERE d.classe = 'divergente'),
    'extras', count(*) FILTER (WHERE d.classe = 'extra'),
    'ops_com_problema', count(DISTINCT d.order_number) FILTER (WHERE d.classe <> 'ok'),
    'amostra', COALESCE(jsonb_agg(to_jsonb(d) ORDER BY abs(d.delta) DESC)
      FILTER (WHERE d.classe <> 'ok'), '[]'::jsonb)
  ) AS value
  FROM (
    SELECT *
    FROM public.debit_consistency_report(current_date - 60, current_date, true)
    WHERE classe <> 'ok'
    ORDER BY abs(delta) DESC
    LIMIT 30
  ) d
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'technical_sheets', (SELECT value FROM sheet_summary),
  'legacy_audit', (SELECT value FROM legacy_audit_summary),
  'legacy_audit_false_positives', (SELECT value FROM legacy_false_positives),
  'critical_gap_samples', (SELECT value FROM audit_gap_samples),
  'units', (SELECT value FROM unit_summary),
  'area_materials_missing_width', (SELECT value FROM missing_width),
  'consumption_consistency', (SELECT value FROM consistency),
  'sole_spec_coverage', (SELECT value FROM sole_spec_gaps),
  'snapshots', (SELECT value FROM snapshot_summary),
  'debit_60_days', (SELECT value FROM debit_summary)
) AS technical_sheets_audit;
