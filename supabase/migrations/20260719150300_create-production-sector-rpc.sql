-- =============================================================================
-- R9 (specs/equipe-e-capacidade-fonte-unica.md): criar setor de PRODUÇÃO pela UI.
--
-- ⚠ Esta função foi aplicada via MCP durante o build e ficou SEM arquivo de
-- migration até esta correção — o frontend (src/components/hr/SectorSelectField.tsx)
-- já a chama, então um ambiente recriado a partir do repo quebraria com 42883.
--
-- sector_settings era fechada para INSERT (decisão anterior de lista fixa); o spec
-- revê essa política, mas a criação continua guiada: exige posição no fluxo,
-- paralelismo e custo-hora, e só usuário aprovado cria. Área de apoio
-- (Administrativo/Comercial/Terceirizado e afins) NÃO passa por aqui — fica só
-- como rótulo de RH, sem efeito em capacidade.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_production_sector(
  p_sector       text,
  p_after_sector text DEFAULT NULL,
  p_parallel     boolean DEFAULT false,
  p_hourly_rate  numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nome  text;
  v_key   text;
  v_after record;
  v_order integer;
  v_group text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'não autorizado';
  END IF;

  v_nome := trim(coalesce(p_sector, ''));
  IF v_nome = '' THEN
    RAISE EXCEPTION 'Informe o nome do setor';
  END IF;
  IF p_hourly_rate IS NULL OR p_hourly_rate < 0 THEN
    RAISE EXCEPTION 'Custo-hora inválido';
  END IF;

  v_key := public.capacity_sector_key(v_nome);

  IF EXISTS (SELECT 1 FROM sector_settings ss
              WHERE public.capacity_sector_key(ss.sector) = v_key) THEN
    RAISE EXCEPTION 'Já existe um setor de produção com esse nome';
  END IF;

  IF p_after_sector IS NOT NULL AND trim(p_after_sector) <> '' THEN
    SELECT flow_order, parallel_group INTO v_after
      FROM sector_settings
     WHERE public.capacity_sector_key(sector) = public.capacity_sector_key(p_after_sector);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Setor de referência % não encontrado', p_after_sector;
    END IF;
    -- Paralelo herda o grupo do anterior; sequencial entra logo depois dele.
    v_order := v_after.flow_order + CASE WHEN p_parallel THEN 0 ELSE 5 END;
    v_group := CASE WHEN p_parallel THEN coalesce(v_after.parallel_group, 'preparacao') ELSE NULL END;
  ELSE
    SELECT coalesce(max(flow_order), 0) + 10 INTO v_order FROM sector_settings;
    v_group := NULL;
  END IF;

  INSERT INTO sector_settings (sector, flow_order, parallel_group, enabled, daily_capacity_pairs)
  VALUES (v_nome, v_order, v_group, true, 600);

  IF p_hourly_rate > 0 THEN
    INSERT INTO sector_labor_rates (sector_key, hourly_rate, monthly_salary)
    VALUES (v_key, p_hourly_rate, round(p_hourly_rate * 220, 2))
    ON CONFLICT (sector_key) DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate;
  END IF;

  RETURN jsonb_build_object(
    'sector', v_nome, 'flow_order', v_order,
    'parallel_group', v_group, 'hourly_rate', p_hourly_rate);
END;
$$;

REVOKE ALL ON FUNCTION public.create_production_sector(text, text, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_production_sector(text, text, boolean, numeric) TO authenticated, service_role;
