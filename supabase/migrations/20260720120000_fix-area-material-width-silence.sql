-- Auditoria consumo × OC × débito (specs/auditoria-consumo-oc-debito.md)
--
-- CAUSA RAIZ
-- ----------
-- get_material_conversion_info decidia o aviso de largura faltante assim:
--
--   material linear sem largura:
--     tem ficha de componente (produto OU grupo)? -> AVISA (cadastro incompleto)
--     não tem ficha nenhuma?                      -> CALA (é tira/elástico)
--
-- O segundo ramo existe porque tira/elástico são itens lineares DIRETOS: o
-- consumo já está na unidade nativa e não deve ser convertido (regra canônica
-- do CLAUDE.md). Só que a heurística "sem ficha => é tira" classifica errado
-- toda napa que não tem ficha de componente — justamente o caso em que a
-- conversão dm²->m mais importa.
--
-- Efeito: dm2_per_unit = 1 e conversion_warning = NULL. Como os agregadores de
-- compra só excluem linhas com "conversion_warning IS NOT NULL"
-- (compute_materials_per_pv, get_wave_material_needs, fn_projected_demand), a
-- linha entrava inteira na OC, e o débito (que não checa a flag) baixaria o
-- valor cru.
--
-- SINTOMA CONFIRMADO (PV-00146, OP-2026-01158, PORCELANA):
--   Cabedal · PALHA · 1.248,000 m para 1.248 pares = 1,000 m/par, sem aviso.
--   products.PALHA: quantity = 1 m, reserved_stock = 1.248 m.
--   Nenhum débito efetivado (quantity_consumed = 0) — a correção entra ANTES.
--
-- ESCOPO: 8 produtos de área sem ficha de componente, em 3 grupos —
--   NAPA TITANIUM (3 produtos, 240 m em estoque, sector='Cabedal')
--   NAPA MADRID   (4 produtos, 0 em estoque,    sector='Cabedal')
--   NAPA PALHA    (1 produto,  1 m em estoque,  usado como upper_material)
-- Nenhuma tira/elástico é atingida (nenhuma tem sector de área nem é
-- referenciada como material de área em ficha técnica) — verificado no banco.
--
-- QUAL MOTOR ESTAVA CERTO (spec R4): o TS. isLinearWidthMissing()
-- (src/lib/materialConsumption.ts) marca QUALQUER material linear sem largura,
-- sem a escapatória "sem ficha => é tira". O modal do PV já avisava sobre o
-- PALHA enquanto o SQL comprava e reservava calado. Esta migration converge o
-- SQL para o comportamento do TS, não o contrário.
--
-- OPERAÇÕES DE DADOS FEITAS FORA DESTA MIGRATION (pontuais, já aplicadas):
--   * freeze_technical_sheet() re-executado no item PORCELANA do PV-00146
--     (sale_order_item e79b6318) — o snapshot congelado guardava 1.248 m e o
--     débito lê o snapshot ANTES do motor. Agora guarda 9,838 m.
--   * sale_orders.reservations_outdated_at = now() no PV-00146, para o app
--     reprocessar a reserva (1.248 m) com usuário aprovado. Não dá pra fazer
--     via MCP: release_order_reservations() exige usuário aprovado.
--
-- PENDÊNCIA CONHECIDA (não tratada aqui): snapshot órfão de2 17de9 aponta para
-- um sale_order_item que não existe mais e segue com 1.248 m. É dado morto
-- (o débito resolve por sale_order_item_id), mas deve ser limpo.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Backfill das larguras (1370 mm — largura dominante: 42 de 50 fichas de
--    napa já cadastradas, incluindo SANTORINE e SUDANI inteiras).
--    component_sheets tem UNIQUE(product_id), então ON CONFLICT é seguro e
--    NÃO sobrescreve largura já preenchida.
-- ---------------------------------------------------------------------------
INSERT INTO public.component_sheets (product_id, group_id, dimensions_width, dimensions_unit)
SELECT p.id, p.group_id, 1370, 'mm'
  FROM public.products p
  JOIN public.product_groups pg ON pg.id = p.group_id
 WHERE pg.name IN ('NAPA TITANIUM', 'NAPA MADRID', 'NAPA PALHA')
   AND LOWER(p.unit) IN ('m', 'cm', 'metros', 'mt')
ON CONFLICT (product_id) DO UPDATE
   SET dimensions_width = COALESCE(public.component_sheets.dimensions_width, EXCLUDED.dimensions_width),
       dimensions_unit  = COALESCE(public.component_sheets.dimensions_unit,  EXCLUDED.dimensions_unit);

-- ---------------------------------------------------------------------------
-- 2) get_material_conversion_info: material de ÁREA sem largura passa a AVISAR
--    em vez de se disfarçar de item linear direto.
--
--    "É material de área" = o grupo tem sector de área OU o grupo é
--    referenciado como upper/lining/insole_material em alguma ficha técnica
--    (o vínculo ficha->grupo é por TEXTO, não FK).
--
--    A MATEMÁTICA NÃO MUDA: dm2_per_unit continua 1 quando não há largura.
--    Só a visibilidade muda — e, por consequência, os agregadores de compra
--    passam a excluir a linha em vez de comprar um número inválido.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_material_conversion_info(p_product_id uuid)
RETURNS TABLE(dm2_per_unit numeric, waste_pct numeric, target_unit text, conversion_warning text)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_width numeric; v_length numeric; v_dim numeric; v_dim_unit text;
  v_prod_unit text; v_waste numeric; v_group_id uuid; v_is_linear boolean;
  v_has_cs boolean; v_is_area boolean;
BEGIN
  SELECT unit, group_id INTO v_prod_unit, v_group_id FROM public.products WHERE id = p_product_id;
  SELECT dimensions_width, dimensions_length, dimensions_unit, cs.waste_pct
    INTO v_width, v_length, v_dim_unit, v_waste
    FROM public.component_sheets cs WHERE cs.product_id = p_product_id;
  v_dim := GREATEST(COALESCE(v_width, 0), COALESCE(v_length, 0));
  IF v_dim <= 0 THEN
    SELECT GREATEST(COALESCE(cs.dimensions_width,0), COALESCE(cs.dimensions_length,0)),
           cs.dimensions_unit, COALESCE(v_waste, cs.waste_pct)
      INTO v_dim, v_dim_unit, v_waste
      FROM public.component_sheets cs
      WHERE cs.group_id = v_group_id
        AND GREATEST(COALESCE(cs.dimensions_width,0), COALESCE(cs.dimensions_length,0)) > 0
      -- (d2) fallback determinístico: largura preenchida primeiro, ficha mais
      -- recente depois, id como desempate (antes: LIMIT 1 sem ORDER BY).
      ORDER BY (COALESCE(cs.dimensions_width, 0) > 0) DESC,
               cs.updated_at DESC NULLS LAST,
               cs.id
      LIMIT 1;
  END IF;
  -- (d1) sem NENHUMA ficha de componente não há base pra assumir perda: o
  -- motor TS canônico (materialConsumption.ts) usa 0 — era 8 e inflava a
  -- demanda de itens lineares diretos (tiras/elásticos) em 8%.
  v_waste := COALESCE(v_waste, 0);
  v_prod_unit := LOWER(v_prod_unit);
  v_is_linear := v_prod_unit IN ('m','meters','metros','mt','cm','m linear');
  IF v_is_linear THEN
    IF v_dim IS NOT NULL AND v_dim > 0 THEN
      IF LOWER(v_dim_unit) = 'cm' THEN v_dim := v_dim * 10;
      ELSIF LOWER(v_dim_unit) = 'm' THEN v_dim := v_dim * 1000; END IF;
      dm2_per_unit := v_dim / 10;
      IF v_prod_unit = 'cm' THEN dm2_per_unit := dm2_per_unit / 100; END IF;
      conversion_warning := NULL;
    ELSE
      dm2_per_unit := 1;
      SELECT EXISTS (SELECT 1 FROM public.component_sheets cs
                     WHERE cs.product_id = p_product_id OR cs.group_id = v_group_id)
        INTO v_has_cs;

      -- NOVO: material de ÁREA identificado por setor do grupo OU por uso como
      -- material de área em ficha técnica. Sem isto, uma napa sem ficha era
      -- silenciosamente tratada como tira (bug PV-00146 / PALHA).
      SELECT EXISTS (
        SELECT 1 FROM public.product_groups pg
         WHERE pg.id = v_group_id
           AND (
             pg.sector IN ('Cabedal', 'Palmilha', 'Forração da Palmilha')
             OR EXISTS (
               SELECT 1 FROM public.technical_sheets ts
                WHERE UPPER(TRIM(ts.upper_material))  = UPPER(TRIM(pg.name))
                   OR UPPER(TRIM(ts.lining_material)) = UPPER(TRIM(pg.name))
                   OR UPPER(TRIM(ts.insole_material)) = UPPER(TRIM(pg.name))
             )
           )
      ) INTO v_is_area;

      IF v_has_cs OR v_is_area THEN
        conversion_warning := 'Material em "' || v_prod_unit || '" sem dimensions_width em component_sheets. '
          'Resultado pode estar 100x errado. Configurar largura em Materiais > Ficha de Componente.';
      ELSE
        conversion_warning := NULL;  -- item linear direto (tira/elástico), não converte
      END IF;
    END IF;
  ELSE
    dm2_per_unit := 1;
    conversion_warning := NULL;
  END IF;
  waste_pct := v_waste;
  target_unit := v_prod_unit;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Guard de cadastro: ficha de componente de material de ÁREA não pode ser
--    salva sem largura.
--
--    NOTA sobre "bloquear a criação": não é possível exigir a ficha no INSERT
--    do produto — component_sheets.product_id é NOT NULL com FK pro produto,
--    então o produto precisa existir ANTES da ficha. O bloqueio real mora
--    aqui (salvar ficha de área sem largura) somado ao aviso do item (2), que
--    torna o material visível e o exclui da OC enquanto estiver sem largura.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_require_width_for_area_material()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_group_id uuid; v_unit text; v_is_area boolean;
BEGIN
  SELECT p.group_id, LOWER(p.unit) INTO v_group_id, v_unit
    FROM public.products p WHERE p.id = NEW.product_id;

  IF v_unit NOT IN ('m','meters','metros','mt','cm','m linear') THEN
    RETURN NEW;  -- só materiais lineares convertem a partir de dm²
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.product_groups pg
     WHERE pg.id = v_group_id
       AND (
         pg.sector IN ('Cabedal', 'Palmilha', 'Forração da Palmilha')
         OR EXISTS (
           SELECT 1 FROM public.technical_sheets ts
            WHERE UPPER(TRIM(ts.upper_material))  = UPPER(TRIM(pg.name))
               OR UPPER(TRIM(ts.lining_material)) = UPPER(TRIM(pg.name))
               OR UPPER(TRIM(ts.insole_material)) = UPPER(TRIM(pg.name))
         )
       )
  ) INTO v_is_area;

  IF v_is_area
     AND GREATEST(COALESCE(NEW.dimensions_width, 0), COALESCE(NEW.dimensions_length, 0)) <= 0 THEN
    RAISE EXCEPTION
      'Material de área exige largura na ficha de componente. Preencha Dimensões > Largura (mm) antes de salvar.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_require_width_for_area_material ON public.component_sheets;
CREATE TRIGGER tg_require_width_for_area_material
  BEFORE INSERT OR UPDATE ON public.component_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_require_width_for_area_material();

COMMIT;
