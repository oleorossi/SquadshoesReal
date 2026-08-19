-- ============================================================================
-- Cabedal dublado: vínculo tipado, hierarquia técnica e composição sem débito
-- ============================================================================
--
-- Regras desta migration:
--   1. `technical_sheets.upper_material_group_id` aponta somente para grupo-folha.
--      `upper_material` continua existindo para não quebrar fichas legadas/texto
--      livre; quando há FK, o texto é apenas o nome canônico sincronizado.
--   2. `product_group_layers` descreve as camadas físicas de um material composto.
--      Ela NÃO possui produto, quantidade ou integração com reserva/débito. No PV,
--      baixa-se somente o SKU do material dublado acabado, uma única vez.
--   3. DUBLAGEM passa a ser família/container. Os materiais tecnicamente distintos
--      ficam em grupos-folha e as cores continuam sendo os produtos desses grupos.
--   4. Só recebem largura de 1.370 mm os rolos confirmados pelo cadastro/auditoria
--      anterior. Nenhuma dimensão é inventada para os itens ambíguos de DIVERSOS.
--
-- A migration é transacional pelo runner do Supabase e o DML é idempotente.

-- ---------------------------------------------------------------------------
-- 1) Vínculo tipado da ficha de cabedal (texto legado continua compatível)
-- ---------------------------------------------------------------------------
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS upper_material_group_id uuid;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.technical_sheets'::regclass
       AND conname = 'technical_sheets_upper_material_group_id_fkey'
  ) THEN
    ALTER TABLE public.technical_sheets
      ADD CONSTRAINT technical_sheets_upper_material_group_id_fkey
      FOREIGN KEY (upper_material_group_id)
      REFERENCES public.product_groups(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE public.technical_sheets
  VALIDATE CONSTRAINT technical_sheets_upper_material_group_id_fkey;

CREATE INDEX IF NOT EXISTS idx_technical_sheets_upper_material_group_id
  ON public.technical_sheets (upper_material_group_id);

COMMENT ON COLUMN public.technical_sheets.upper_material_group_id IS
  'Grupo-folha do cabedal. upper_material permanece como espelho nominal e fallback legado.';

-- O guard original validava consumos antigos em TODO update da ficha. Isso faria
-- uma simples sincronização de nome falhar em fichas legadas com outro campo já
-- inválido. A função permanece igual; o evento passa a observar somente INSERT ou
-- alteração efetiva de algum campo de consumo que ela protege.
DROP TRIGGER IF EXISTS trg_guard_implausible_consumption ON public.technical_sheets;
CREATE TRIGGER trg_guard_implausible_consumption
  BEFORE INSERT OR UPDATE OF
    upper_consumption,
    lining_consumption,
    insole_consumption,
    insole_lining_consumption,
    fachete_consumption,
    upper_consumption_per_size,
    lining_consumption_per_size,
    insole_consumption_per_size,
    insole_lining_consumption_per_size,
    fachete_consumption_per_size
  ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_implausible_consumption();

-- ---------------------------------------------------------------------------
-- 2) Remodelagem idempotente de DUBLAGEM
-- ---------------------------------------------------------------------------
-- UUIDs estáveis somente para os grupos que esta migration cria:
--   família DUBLAGEM                    aee61236-4a95-4b66-8b03-cecd94ed99c9
--   DUBLAGEM DIVERSOS                   cf9f1990-e5e1-44e8-a3ab-74ca4fd6df7d
--   NAPA SOFT COM CACHARREL/EVA         63b471bb-9fd3-4839-a069-b788d0953e00
--   NAPA SOFT COM PU 600                ad1639ce-c229-4083-be27-51ab5b8a2c47
--   PELO DUBLADO                        80b7fa70-cbeb-401c-8f03-43bfec216b7b
--   PU 600 (constituinte)               aea662a7-c4f6-40cd-90af-31852476cad0
DO $migration$
DECLARE
  v_family_id       uuid;
  v_named_id        uuid;
  v_diversos_id     uuid;
  v_soft_eva_id     uuid;
  v_soft_pu600_id   uuid;
  v_pelo_id         uuid;
  v_pu600_base_id   uuid;
  v_existing_sector text;
  v_leaf             record;
BEGIN
  -- No estado anterior, DUBLAGEM era um grupo-folha misto com produtos diretos.
  -- Renomeá-lo preserva seu UUID e todas as referências; o nome fica livre para
  -- o novo container. Se já for container, esta etapa apenas o reutiliza.
  SELECT g.id, g.sector
    INTO v_named_id, v_existing_sector
    FROM public.product_groups g
   WHERE lower(btrim(g.name)) = 'dublagem'
   FOR UPDATE;

  IF v_named_id IS NOT NULL THEN
    IF v_existing_sector NOT IN ('Componente', 'Cabedal') THEN
      RAISE EXCEPTION
        'DUBLAGEM está no setor inesperado %. Revise o cadastro antes de aplicar.',
        v_existing_sector
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = v_named_id
    ) THEN
      IF EXISTS (SELECT 1 FROM public.products p WHERE p.group_id = v_named_id) THEN
        RAISE EXCEPTION
          'DUBLAGEM já é família, mas ainda possui produtos diretos. Esvazie o container antes de repetir.'
          USING ERRCODE = '23514';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.product_groups g
         WHERE g.id = v_named_id AND g.parent_group_id IS NOT NULL
      ) THEN
        RAISE EXCEPTION
          'DUBLAGEM não pode ser família aninhada.' USING ERRCODE = '23514';
      END IF;
      v_family_id := v_named_id;
    ELSIF EXISTS (SELECT 1 FROM public.products p WHERE p.group_id = v_named_id) THEN
      IF EXISTS (
        SELECT 1 FROM public.product_groups g
         WHERE lower(btrim(g.name)) = 'dublagem diversos'
           AND g.id <> v_named_id
      ) THEN
        RAISE EXCEPTION
          'Estado ambíguo: DUBLAGEM e DUBLAGEM DIVERSOS já existem como folhas. A migration não mescla estoque automaticamente.'
          USING ERRCODE = '23514';
      END IF;

      UPDATE public.product_groups
         SET name = 'DUBLAGEM DIVERSOS',
             description = concat_ws(
               E'\n',
               nullif(btrim(description), ''),
               'Itens legados ainda sem identificação técnica inequívoca da composição.'
             )
       WHERE id = v_named_id;

      v_diversos_id := v_named_id;
      v_family_id := NULL;
    ELSE
      -- Uma folha DUBLAGEM vazia pode virar o container sem perder referências.
      IF EXISTS (
        SELECT 1 FROM public.product_groups g
         WHERE g.id = v_named_id AND g.parent_group_id IS NOT NULL
      ) THEN
        RAISE EXCEPTION
          'DUBLAGEM vazia está aninhada e não pode virar família.' USING ERRCODE = '23514';
      END IF;
      v_family_id := v_named_id;
    END IF;
  END IF;

  IF v_family_id IS NULL THEN
    INSERT INTO public.product_groups (
      id, name, description, sector, parent_group_id
    ) VALUES (
      'aee61236-4a95-4b66-8b03-cecd94ed99c9',
      'DUBLAGEM',
      'Família técnica de materiais dublados. Não recebe produtos diretamente.',
      'Cabedal',
      NULL
    )
    ON CONFLICT DO NOTHING;

    SELECT g.id INTO v_family_id
      FROM public.product_groups g
     WHERE lower(btrim(g.name)) = 'dublagem';
  END IF;

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível criar/localizar a família DUBLAGEM.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.products p WHERE p.group_id = v_family_id) THEN
    RAISE EXCEPTION
      'A família DUBLAGEM não pode possuir produtos diretos.' USING ERRCODE = '23514';
  END IF;

  -- A taxonomia é por aplicação: o material dublado acabado é Cabedal. Quando
  -- o grupo antigo estava em Componente, a cascata existente também corrige a
  -- categoria dos produtos sem alterar estoque, unidade ou identidade.
  UPDATE public.product_groups
     SET sector = 'Cabedal'
   WHERE id = v_family_id
     AND sector IS DISTINCT FROM 'Cabedal';

  -- Folha de quarentena técnica para os nomes genéricos/ambíguos.
  IF v_diversos_id IS NULL THEN
    SELECT g.id INTO v_diversos_id
      FROM public.product_groups g
     WHERE lower(btrim(g.name)) = 'dublagem diversos';
  END IF;

  IF v_diversos_id IS NULL THEN
    INSERT INTO public.product_groups (
      id, name, description, sector, parent_group_id
    ) VALUES (
      'cf9f1990-e5e1-44e8-a3ab-74ca4fd6df7d',
      'DUBLAGEM DIVERSOS',
      'Itens dublados legados cuja composição ainda precisa ser identificada.',
      'Cabedal',
      v_family_id
    )
    ON CONFLICT DO NOTHING;

    SELECT g.id INTO v_diversos_id
      FROM public.product_groups g
     WHERE lower(btrim(g.name)) = 'dublagem diversos';
  END IF;

  IF v_diversos_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível criar/localizar DUBLAGEM DIVERSOS.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = v_diversos_id
  ) THEN
    RAISE EXCEPTION
      'DUBLAGEM DIVERSOS deveria ser grupo-folha, mas possui filhos.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.product_groups
     SET parent_group_id = v_family_id,
         sector = 'Cabedal',
         shared_specs = false,
         is_bom_color_source = false,
         auto_component_sheet = false
   WHERE id = v_diversos_id
     AND (
       parent_group_id IS DISTINCT FROM v_family_id
       OR sector IS DISTINCT FROM 'Cabedal'
       OR shared_specs IS DISTINCT FROM false
       OR is_bom_color_source IS DISTINCT FROM false
       OR auto_component_sheet IS DISTINCT FROM false
     );

  -- Folhas de composição conhecida solicitadas para o cabedal.
  INSERT INTO public.product_groups (
    id, name, description, sector, parent_group_id
  ) VALUES (
    '63b471bb-9fd3-4839-a069-b788d0953e00',
    'NAPA SOFT COM CACHARREL/EVA',
    'Material dublado acabado: Napa Soft combinada com Cacharrel/EVA.',
    'Cabedal',
    v_family_id
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.product_groups (
    id, name, description, sector, parent_group_id
  ) VALUES (
    '80b7fa70-cbeb-401c-8f03-43bfec216b7b',
    'PELO DUBLADO',
    'Material dublado acabado à base de pelo; composição complementar aguarda cadastro técnico.',
    'Cabedal',
    v_family_id
  )
  ON CONFLICT DO NOTHING;

  -- PU 600 é constituinte, não material dublado acabado: permanece como folha
  -- solta de Componente e não recebe parent_group_id = DUBLAGEM.
  INSERT INTO public.product_groups (
    id, name, description, sector, parent_group_id
  ) VALUES (
    'aea662a7-c4f6-40cd-90af-31852476cad0',
    'PU 600',
    'Camada constituinte para materiais dublados com PU 600.',
    'Componente',
    NULL
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.product_groups (
    id, name, description, sector, parent_group_id
  ) VALUES (
    'ad1639ce-c229-4083-be27-51ab5b8a2c47',
    'NAPA SOFT COM PU 600',
    'Material dublado acabado: Napa Soft combinada com PU 600.',
    'Cabedal',
    v_family_id
  )
  ON CONFLICT DO NOTHING;

  SELECT g.id INTO v_soft_eva_id
    FROM public.product_groups g
   WHERE lower(btrim(g.name)) = 'napa soft com cacharrel/eva';

  SELECT g.id INTO v_soft_pu600_id
    FROM public.product_groups g
   WHERE lower(btrim(g.name)) = 'napa soft com pu 600';

  SELECT g.id INTO v_pelo_id
    FROM public.product_groups g
   WHERE lower(btrim(g.name)) = 'pelo dublado';

  SELECT g.id INTO v_pu600_base_id
    FROM public.product_groups g
   WHERE lower(btrim(g.name)) = 'pu 600';

  IF v_soft_eva_id IS NULL OR v_soft_pu600_id IS NULL
     OR v_pelo_id IS NULL OR v_pu600_base_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível criar/localizar as folhas técnicas da DUBLAGEM.';
  END IF;

  FOR v_leaf IN
    SELECT g.id, g.name, g.sector
      FROM public.product_groups g
     WHERE g.id IN (v_soft_eva_id, v_soft_pu600_id, v_pelo_id)
     FOR UPDATE
  LOOP
    IF v_leaf.sector NOT IN ('Componente', 'Cabedal') THEN
      RAISE EXCEPTION 'A folha % está em setor incompatível com Cabedal.', v_leaf.name
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = v_leaf.id
    ) THEN
      RAISE EXCEPTION 'A folha técnica % já possui subgrupos.', v_leaf.name
        USING ERRCODE = '23514';
    END IF;
    UPDATE public.product_groups
       SET parent_group_id = v_family_id,
           sector = 'Cabedal'
     WHERE id = v_leaf.id
       AND (
         parent_group_id IS DISTINCT FROM v_family_id
         OR sector IS DISTINCT FROM 'Cabedal'
       );
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.id = v_pu600_base_id
       AND (
         g.sector IS DISTINCT FROM 'Componente'
         OR g.parent_group_id IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = g.id
         )
       )
  ) THEN
    RAISE EXCEPTION 'PU 600 deve ser grupo-folha raiz do setor Componente.'
      USING ERRCODE = '23514';
  END IF;

  -- Grupos técnicos já existentes no banco: apenas anexar, nunca recriar ou
  -- fundir. Se estiverem ausentes em um ambiente vazio, a migration segue.
  FOR v_leaf IN
    SELECT g.id, g.name, g.sector
      FROM public.product_groups g
     WHERE lower(btrim(g.name)) IN (
       'sudani dublado pu 600',
       'suede eva + cacharrel'
     )
     FOR UPDATE
  LOOP
    IF v_leaf.sector NOT IN ('Componente', 'Cabedal') THEN
      RAISE EXCEPTION 'A folha % está em setor incompatível com Cabedal.', v_leaf.name
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = v_leaf.id
    ) THEN
      RAISE EXCEPTION 'O grupo % não é folha e não pode entrar em DUBLAGEM.', v_leaf.name
        USING ERRCODE = '23514';
    END IF;
    UPDATE public.product_groups
       SET parent_group_id = v_family_id,
           sector = 'Cabedal'
     WHERE id = v_leaf.id
       AND (
         parent_group_id IS DISTINCT FROM v_family_id
         OR sector IS DISTINCT FROM 'Cabedal'
       );
  END LOOP;

  -- Movimentos determinísticos. Nenhum estoque é somado, zerado ou recriado:
  -- preserva produto/SKU/cor/quantidade e muda somente classificação/nome-base.
  UPDATE public.products p
     SET group_id = v_soft_eva_id,
         name = 'NAPA SOFT COM CACHARREL/EVA'
   WHERE p.group_id = v_diversos_id
     AND lower(btrim(p.name)) = 'napa soft com cacharrel/eva';

  -- Pelo Preto tem ficha de rolo 1,37 m e identidade material inequívoca. A
  -- composição além de "pelo" ainda não está comprovada, portanto não é seedada.
  UPDATE public.products p
     SET group_id = v_pelo_id,
         name = 'PELO DUBLADO',
         color = CASE
           WHEN nullif(btrim(p.color), '') IS NULL THEN 'PRETO'
           ELSE p.color
         END
   WHERE p.group_id = v_diversos_id
     AND lower(btrim(p.name)) = 'pelo preto';

  -- Os itens ainda chamados apenas "DUBLAGEM" permanecem em DIVERSOS. O
  -- histórico de fusões contém origens Sudani para parte deles, portanto não é
  -- seguro rebatizá-los automaticamente como NAPA SOFT COM PU 600. A folha
  -- canônica é criada acima, mas só recebe cores após confirmação humana.
END
$migration$;

-- ---------------------------------------------------------------------------
-- 3) Unidade-base, largura dos rolos e sincronização das fichas de componente
-- ---------------------------------------------------------------------------
-- Confirmados por 20260605140000 e/ou por fichas existentes consistentes:
--   NAPA SOFT COM CACHARREL/EVA, NAPA SOFT COM PU 600,
--   SUDANI DUBLADO PU 600 e SUEDE EVA + CACHARREL.
-- DUBLAGEM DIVERSOS fica sem dimensão de grupo intencionalmente.
UPDATE public.product_groups g
   SET dimensions_width = 1370,
       dimensions_length = 0,
       dimensions_unit = 'mm',
       consumption_unit = 'm',
       shared_specs = true,
       is_bom_color_source = true,
       auto_component_sheet = true
 WHERE lower(btrim(g.name)) IN (
   'napa soft com cacharrel/eva',
   'napa soft com pu 600',
   'sudani dublado pu 600',
   'suede eva + cacharrel',
   'pelo dublado'
 )
   AND (
     g.dimensions_width IS DISTINCT FROM 1370
     OR g.dimensions_length IS DISTINCT FROM 0
     OR g.dimensions_unit IS DISTINCT FROM 'mm'
     OR g.consumption_unit IS DISTINCT FROM 'm'
     OR g.shared_specs IS DISTINCT FROM true
     OR g.is_bom_color_source IS DISTINCT FROM true
     OR g.auto_component_sheet IS DISTINCT FROM true
   );

-- dm²/par pertence ao consumo geométrico da ficha do modelo. O SKU físico do
-- rolo é estocado, comprado, produzido e debitado em metro linear; a largura
-- de 1.370 mm faz a conversão dm² -> m nos motores canônicos.
UPDATE public.products p
   SET unit = 'm',
       purchase_unit = 'm',
       production_unit = 'm',
       purchase_order_unit = 'm',
       consumption_unit = 'm',
       conversion_rate = 1
  FROM public.product_groups g
 WHERE g.id = p.group_id
   AND lower(btrim(g.name)) IN (
     'napa soft com cacharrel/eva',
     'napa soft com pu 600',
     'sudani dublado pu 600',
     'suede eva + cacharrel',
     'pelo dublado'
   )
   AND (
     p.unit IS DISTINCT FROM 'm'
     OR p.purchase_unit IS DISTINCT FROM 'm'
     OR p.production_unit IS DISTINCT FROM 'm'
     OR p.purchase_order_unit IS DISTINCT FROM 'm'
     OR p.consumption_unit IS DISTINCT FROM 'm'
     OR p.conversion_rate IS DISTINCT FROM 1
   );

-- A dimensão canônica do GRUPO vence sempre que estiver preenchida. Uma ficha
-- irmã é apenas fallback para grupo antigo sem largura. Rendimento/default/notas
-- só atravessam cores quando shared_specs=true. Sem waste_pct: a coluna e o
-- conceito foram removidos do sistema.
CREATE OR REPLACE FUNCTION public.tg_inherit_component_sheet_on_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_model public.component_sheets%ROWTYPE;
  v_group public.product_groups%ROWTYPE;
BEGIN
  IF NEW.group_id IS NULL
     OR EXISTS (
       SELECT 1 FROM public.component_sheets cs WHERE cs.product_id = NEW.id
     ) THEN
    RETURN NEW;
  END IF;

  SELECT g.* INTO v_group
    FROM public.product_groups g
   WHERE g.id = NEW.group_id;

  IF v_group.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- O modelo nunca governa dimensões quando a largura do grupo existe. Ele é
  -- consultado aqui apenas para specs compartilhadas ou fallback dimensional.
  SELECT cs.* INTO v_model
    FROM public.component_sheets cs
    JOIN public.products sibling ON sibling.id = cs.product_id
   WHERE sibling.group_id = NEW.group_id
     AND cs.product_id <> NEW.id
     AND cs.dimensions_width > 0
   ORDER BY cs.updated_at DESC NULLS LAST, cs.id
   LIMIT 1;

  IF coalesce(v_group.dimensions_width, 0) > 0 THEN
    INSERT INTO public.component_sheets (
      product_id,
      group_id,
      dimensions_length,
      dimensions_width,
      dimensions_thickness,
      dimensions_unit,
      yield_per_size,
      yield_per_sole,
      default_sole_group_id,
      notes
    ) VALUES (
      NEW.id,
      NEW.group_id,
      coalesce(v_group.dimensions_length, 0),
      v_group.dimensions_width,
      coalesce(v_group.dimensions_thickness, 0),
      coalesce(nullif(v_group.dimensions_unit, ''), 'mm'),
      CASE
        WHEN v_group.shared_specs IS TRUE THEN coalesce(v_model.yield_per_size, '{}'::jsonb)
        ELSE '{}'::jsonb
      END,
      CASE WHEN v_group.shared_specs IS TRUE THEN v_model.yield_per_sole ELSE NULL END,
      CASE WHEN v_group.shared_specs IS TRUE THEN v_model.default_sole_group_id ELSE NULL END,
      CASE WHEN v_group.shared_specs IS TRUE THEN coalesce(v_model.notes, '') ELSE '' END
    )
    ON CONFLICT (product_id) DO NOTHING;
    RETURN NEW;
  END IF;

  IF v_model.id IS NOT NULL THEN
    INSERT INTO public.component_sheets (
      product_id,
      group_id,
      dimensions_length,
      dimensions_width,
      dimensions_thickness,
      dimensions_unit,
      yield_per_size,
      yield_per_sole,
      default_sole_group_id,
      notes
    ) VALUES (
      NEW.id,
      NEW.group_id,
      v_model.dimensions_length,
      v_model.dimensions_width,
      v_model.dimensions_thickness,
      v_model.dimensions_unit,
      CASE
        WHEN v_group.shared_specs IS TRUE THEN coalesce(v_model.yield_per_size, '{}'::jsonb)
        ELSE '{}'::jsonb
      END,
      CASE WHEN v_group.shared_specs IS TRUE THEN v_model.yield_per_sole ELSE NULL END,
      CASE WHEN v_group.shared_specs IS TRUE THEN v_model.default_sole_group_id ELSE NULL END,
      CASE WHEN v_group.shared_specs IS TRUE THEN coalesce(v_model.notes, '') ELSE '' END
    )
    ON CONFLICT (product_id) DO NOTHING;
  END IF;

  RETURN NEW;
END
$function$;

INSERT INTO public.component_sheets (
  product_id,
  group_id,
  dimensions_width,
  dimensions_unit,
  notes
)
SELECT
  p.id,
  p.group_id,
  1370,
  'mm',
  'Largura confirmada do rolo dublado (1,37 m).'
FROM public.products p
JOIN public.product_groups g ON g.id = p.group_id
WHERE p.active IS TRUE
  AND lower(btrim(coalesce(p.unit, ''))) IN (
    'm', 'metro', 'metros', 'mt', 'mts', 'meters', 'm linear', 'cm'
  )
  AND lower(btrim(g.name)) IN (
    'napa soft com cacharrel/eva',
    'napa soft com pu 600',
    'sudani dublado pu 600',
    'suede eva + cacharrel',
    'pelo dublado'
  )
ON CONFLICT (product_id) DO UPDATE
   SET group_id = EXCLUDED.group_id,
       dimensions_width = 1370,
       dimensions_unit = 'mm'
 WHERE public.component_sheets.group_id IS DISTINCT FROM EXCLUDED.group_id
    OR public.component_sheets.dimensions_width IS DISTINCT FROM 1370
    OR public.component_sheets.dimensions_unit IS DISTINCT FROM 'mm';

-- Se um produto mudou de folha, mantém alinhada qualquer ficha já existente,
-- inclusive histórica/inativa, sem recriar fichas apagadas durante fusões. As
-- fichas ativas acima já servem de modelo de largura para o trigger de herança.
UPDATE public.component_sheets cs
   SET group_id = p.group_id
  FROM public.products p
  JOIN public.product_groups g ON g.id = p.group_id
 WHERE cs.product_id = p.id
   AND lower(btrim(g.name)) IN (
     'napa soft com cacharrel/eva',
     'napa soft com pu 600',
     'sudani dublado pu 600',
     'suede eva + cacharrel',
     'pelo dublado'
   )
   AND cs.group_id IS DISTINCT FROM p.group_id;

-- ---------------------------------------------------------------------------
-- 4) Composição técnica do grupo-folha (metadado; sem efeito de estoque)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_group_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  composite_group_id uuid NOT NULL
    REFERENCES public.product_groups(id) ON DELETE CASCADE,
  component_group_id uuid
    REFERENCES public.product_groups(id) ON DELETE SET NULL,
  component_label text NOT NULL,
  role text NOT NULL DEFAULT 'Camada',
  display_order integer NOT NULL DEFAULT 0,
  is_color_source boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_group_layers_not_self
    CHECK (composite_group_id <> component_group_id),
  CONSTRAINT product_group_layers_component_identity
    CHECK (
      component_group_id IS NOT NULL
      OR length(btrim(component_label)) > 0
    ),
  CONSTRAINT product_group_layers_display_order_nonnegative
    CHECK (display_order >= 0),
  CONSTRAINT product_group_layers_role_not_blank
    CHECK (length(btrim(role)) > 0),
  CONSTRAINT product_group_layers_order_unique
    UNIQUE (composite_group_id, display_order)
);

COMMENT ON TABLE public.product_group_layers IS
  'Camadas cadastrais de um grupo composto. Não participa de consumo, reserva, custo ou débito de estoque.';
COMMENT ON COLUMN public.product_group_layers.composite_group_id IS
  'Grupo-folha do material acabado que possui produtos/cores e é debitado no PV.';
COMMENT ON COLUMN public.product_group_layers.component_group_id IS
  'Grupo-folha constituinte opcional; NULL permite material livre ainda sem grupo no estoque.';
COMMENT ON COLUMN public.product_group_layers.component_label IS
  'Nome obrigatório da camada, canônico quando há grupo e livre quando component_group_id é NULL.';
COMMENT ON COLUMN public.product_group_layers.is_color_source IS
  'No máximo uma camada por composto orienta visualmente a combinação; não altera a resolução do SKU acabado.';

CREATE INDEX IF NOT EXISTS idx_product_group_layers_component_group
  ON public.product_group_layers (component_group_id);

CREATE UNIQUE INDEX IF NOT EXISTS product_group_layers_one_color_source
  ON public.product_group_layers (composite_group_id)
  WHERE is_color_source IS TRUE;

DROP TRIGGER IF EXISTS update_product_group_layers_updated_at
  ON public.product_group_layers;
CREATE TRIGGER update_product_group_layers_updated_at
  BEFORE UPDATE ON public.product_group_layers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.fn_validate_product_group_layer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_name text;
  v_lock_group_id uuid;
BEGIN
  -- A mesma trava é usada ao transformar uma folha em família. Assim, uma
  -- referência técnica e o primeiro filho nunca passam simultaneamente pelos
  -- respectivos checks em snapshots diferentes. Ordenação evita deadlock
  -- quando composto e constituinte aparecem invertidos em outra transação.
  IF TG_OP = 'INSERT'
     OR (
       TG_OP = 'UPDATE'
       AND (
         NEW.composite_group_id IS DISTINCT FROM OLD.composite_group_id
         OR NEW.component_group_id IS DISTINCT FROM OLD.component_group_id
       )
     ) THEN
    FOR v_lock_group_id IN
      SELECT DISTINCT u.group_id
        FROM unnest(ARRAY[NEW.composite_group_id, NEW.component_group_id]::uuid[]) AS u(group_id)
       WHERE u.group_id IS NOT NULL
       ORDER BY u.group_id
    LOOP
      PERFORM pg_advisory_xact_lock(
        hashtextextended('group-leaf-reference:' || v_lock_group_id::text, 0)
      );
    END LOOP;
  END IF;

  SELECT g.name INTO v_name
    FROM public.product_groups g
   WHERE g.id = NEW.composite_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grupo composto % não encontrado.', NEW.composite_group_id
      USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_groups c
     WHERE c.parent_group_id = NEW.composite_group_id
  ) THEN
    RAISE EXCEPTION 'O grupo composto % deve ser grupo-folha.', v_name
      USING ERRCODE = '23514';
  END IF;

  IF NEW.component_group_id IS NOT NULL THEN
    SELECT g.name INTO v_name
      FROM public.product_groups g
     WHERE g.id = NEW.component_group_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Grupo constituinte % não encontrado.', NEW.component_group_id
        USING ERRCODE = '23503';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.product_groups c
       WHERE c.parent_group_id = NEW.component_group_id
    ) THEN
      RAISE EXCEPTION 'O grupo constituinte % deve ser grupo-folha.', v_name
        USING ERRCODE = '23514';
    END IF;
    NEW.component_label := v_name;
  ELSIF nullif(btrim(NEW.component_label), '') IS NULL THEN
    RAISE EXCEPTION 'Informe component_group_id ou component_label para a camada.'
      USING ERRCODE = '23514';
  ELSE
    NEW.component_label := btrim(NEW.component_label);
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_validate_product_group_layer
  ON public.product_group_layers;
CREATE TRIGGER trg_validate_product_group_layer
  BEFORE INSERT OR UPDATE OF composite_group_id, component_group_id, component_label
  ON public.product_group_layers
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_product_group_layer();

-- Impede que um grupo já usado como material/constituinte deixe de ser folha.
-- O trigger existente protege produtos diretos; este completa o invariante para
-- referências técnicas, inclusive folhas vazias.
CREATE OR REPLACE FUNCTION public.fn_guard_referenced_group_stays_leaf()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.parent_group_id IS NULL
     OR (
       TG_OP = 'UPDATE'
       AND NEW.parent_group_id IS NOT DISTINCT FROM OLD.parent_group_id
     ) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('group-leaf-reference:' || NEW.parent_group_id::text, 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.technical_sheets ts
     WHERE ts.upper_material_group_id = NEW.parent_group_id
  ) OR EXISTS (
    SELECT 1 FROM public.product_group_layers l
     WHERE l.composite_group_id = NEW.parent_group_id
        OR l.component_group_id = NEW.parent_group_id
  ) THEN
    RAISE EXCEPTION
      'A família de destino está referenciada como grupo-folha técnico e não pode receber subgrupos.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_referenced_group_stays_leaf
  ON public.product_groups;
CREATE TRIGGER trg_guard_referenced_group_stays_leaf
  BEFORE INSERT OR UPDATE OF parent_group_id ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_referenced_group_stays_leaf();

-- ---------------------------------------------------------------------------
-- 5) Sincronia segura do FK do cabedal com o texto legado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_technical_sheet_upper_material_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_group public.product_groups%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.upper_material_group_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(
        hashtextextended('group-leaf-reference:' || NEW.upper_material_group_id::text, 0)
      );
      SELECT g.* INTO v_group
        FROM public.product_groups g
       WHERE g.id = NEW.upper_material_group_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Grupo de cabedal % não encontrado.', NEW.upper_material_group_id
          USING ERRCODE = '23503';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = v_group.id
      ) THEN
        RAISE EXCEPTION 'Selecione um grupo-folha de cabedal; % é uma família.', v_group.name
          USING ERRCODE = '23514';
      END IF;
      NEW.upper_material := v_group.name;
    ELSIF nullif(btrim(NEW.upper_material), '') IS NOT NULL THEN
      SELECT g.* INTO v_group
        FROM public.product_groups g
       WHERE lower(btrim(g.name)) = lower(btrim(NEW.upper_material))
         AND NOT EXISTS (
           SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = g.id
         );
      IF FOUND THEN
        PERFORM pg_advisory_xact_lock(
          hashtextextended('group-leaf-reference:' || v_group.id::text, 0)
        );
        IF NOT EXISTS (
          SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = v_group.id
        ) THEN
          NEW.upper_material_group_id := v_group.id;
          NEW.upper_material := v_group.name;
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Cliente novo: alterou explicitamente o FK.
  IF NEW.upper_material_group_id IS DISTINCT FROM OLD.upper_material_group_id THEN
    IF NEW.upper_material_group_id IS NULL THEN
      -- Desvincular é permitido: preserva o texto que o cliente enviou.
      RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended('group-leaf-reference:' || NEW.upper_material_group_id::text, 0)
    );

    SELECT g.* INTO v_group
      FROM public.product_groups g
     WHERE g.id = NEW.upper_material_group_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Grupo de cabedal % não encontrado.', NEW.upper_material_group_id
        USING ERRCODE = '23503';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = v_group.id
    ) THEN
      RAISE EXCEPTION 'Selecione um grupo-folha de cabedal; % é uma família.', v_group.name
        USING ERRCODE = '23514';
    END IF;
    NEW.upper_material := v_group.name;
    RETURN NEW;
  END IF;

  -- Cliente legado: alterou apenas o texto. Resolve por igualdade exata; texto
  -- desconhecido/família continua válido, mas sem FK (não há chute por prefixo).
  IF NEW.upper_material IS DISTINCT FROM OLD.upper_material THEN
    -- Renomear um grupo sincroniza apenas o texto espelho de uma referência que
    -- já existia. Não toma advisory novamente: o UPDATE do grupo já possui row
    -- lock e inverter row→advisory contra o save da composição causaria deadlock.
    IF OLD.upper_material_group_id IS NOT NULL
       AND NEW.upper_material_group_id IS NOT DISTINCT FROM OLD.upper_material_group_id THEN
      SELECT g.* INTO v_group
        FROM public.product_groups g
       WHERE g.id = OLD.upper_material_group_id;
      IF FOUND THEN
        NEW.upper_material := v_group.name;
      END IF;
      RETURN NEW;
    END IF;

    SELECT g.* INTO v_group
      FROM public.product_groups g
     WHERE lower(btrim(g.name)) = lower(btrim(NEW.upper_material))
       AND NOT EXISTS (
         SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = g.id
       );
    IF FOUND THEN
      PERFORM pg_advisory_xact_lock(
        hashtextextended('group-leaf-reference:' || v_group.id::text, 0)
      );
      IF EXISTS (
        SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = v_group.id
      ) THEN
        NEW.upper_material_group_id := NULL;
      ELSE
        NEW.upper_material_group_id := v_group.id;
        NEW.upper_material := v_group.name;
      END IF;
    ELSE
      NEW.upper_material_group_id := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Update alheio: se já há FK, mantém o espelho nominal canônico.
  IF NEW.upper_material_group_id IS NOT NULL THEN
    SELECT g.* INTO v_group
      FROM public.product_groups g
     WHERE g.id = NEW.upper_material_group_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Grupo de cabedal % não encontrado.', NEW.upper_material_group_id
        USING ERRCODE = '23503';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = v_group.id
    ) THEN
      RAISE EXCEPTION 'O grupo de cabedal % deixou de ser folha.', v_group.name
        USING ERRCODE = '23514';
    END IF;
    NEW.upper_material := v_group.name;
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_sync_technical_sheet_upper_material_group
  ON public.technical_sheets;
CREATE TRIGGER trg_sync_technical_sheet_upper_material_group
  BEFORE INSERT OR UPDATE OF upper_material, upper_material_group_id
  ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_technical_sheet_upper_material_group();

-- Backfill deliberadamente restrito a igualdade exata e grupo-folha. CF07 usa
-- "DUBLAGEM", que agora é família, portanto continua sem FK para revisão humana.
UPDATE public.technical_sheets ts
   SET upper_material_group_id = g.id,
       upper_material = g.name
  FROM public.product_groups g
 WHERE ts.upper_material_group_id IS NULL
   AND nullif(btrim(ts.upper_material), '') IS NOT NULL
   AND lower(btrim(ts.upper_material)) = lower(btrim(g.name))
   AND NOT EXISTS (
     SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = g.id
   );

CREATE OR REPLACE FUNCTION public.fn_sync_upper_material_name_on_group_rename()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.technical_sheets ts
       SET upper_material = NEW.name
     WHERE ts.upper_material_group_id = NEW.id
       AND ts.upper_material IS DISTINCT FROM NEW.name;

    UPDATE public.product_group_layers l
       SET component_label = NEW.name
     WHERE l.component_group_id = NEW.id
       AND l.component_label IS DISTINCT FROM NEW.name;
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS trg_sync_upper_material_name_on_group_rename
  ON public.product_groups;
CREATE TRIGGER trg_sync_upper_material_name_on_group_rename
  AFTER UPDATE OF name ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_upper_material_name_on_group_rename();

-- ---------------------------------------------------------------------------
-- 6) RLS, grants e RPCs atômicas da composição
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_group_layers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_group_layers_select ON public.product_group_layers;
CREATE POLICY product_group_layers_select
  ON public.product_group_layers
  FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS product_group_layers_insert ON public.product_group_layers;
CREATE POLICY product_group_layers_insert
  ON public.product_group_layers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS product_group_layers_update ON public.product_group_layers;
CREATE POLICY product_group_layers_update
  ON public.product_group_layers
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_approved_user()))
  WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS product_group_layers_delete ON public.product_group_layers;
CREATE POLICY product_group_layers_delete
  ON public.product_group_layers
  FOR DELETE TO authenticated
  USING ((SELECT public.is_approved_user()));

REVOKE ALL ON TABLE public.product_group_layers FROM anon;
REVOKE ALL ON TABLE public.product_group_layers FROM authenticated;
GRANT SELECT ON TABLE public.product_group_layers TO authenticated;

CREATE OR REPLACE FUNCTION public.get_product_group_layers(
  p_composite_group_id uuid
)
RETURNS TABLE (
  id uuid,
  composite_group_id uuid,
  component_group_id uuid,
  component_label text,
  component_group_name text,
  component_group_sector text,
  role text,
  display_order integer,
  is_color_source boolean,
  notes text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.composite_group_id,
    l.component_group_id,
    l.component_label,
    g.name,
    g.sector,
    l.role,
    l.display_order,
    l.is_color_source,
    l.notes
  FROM public.product_group_layers l
  LEFT JOIN public.product_groups g ON g.id = l.component_group_id
  WHERE l.composite_group_id = p_composite_group_id
  ORDER BY l.display_order, l.id;
END
$function$;

CREATE OR REPLACE FUNCTION public.save_product_group_layers(
  p_composite_group_id uuid,
  p_layers jsonb
)
RETURNS TABLE (
  id uuid,
  composite_group_id uuid,
  component_group_id uuid,
  component_label text,
  component_group_name text,
  component_group_sector text,
  role text,
  display_order integer,
  is_color_source boolean,
  notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_group_name text;
  v_layer jsonb;
  v_ordinality bigint;
  v_component_group_id uuid;
  v_component_label text;
  v_lock_group_id uuid;
  v_layer_count integer;
  v_color_source_count integer;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado'
      USING ERRCODE = '42501';
  END IF;

  IF p_layers IS NULL OR jsonb_typeof(p_layers) <> 'array' THEN
    RAISE EXCEPTION 'p_layers deve ser um array JSON.'
      USING ERRCODE = '22023';
  END IF;

  v_layer_count := jsonb_array_length(p_layers);

  IF v_layer_count = 1 THEN
    RAISE EXCEPTION 'Uma composição deve ficar vazia ou possuir pelo menos duas camadas.'
      USING ERRCODE = '23514';
  END IF;

  IF v_layer_count > 30 THEN
    RAISE EXCEPTION 'Uma composição aceita no máximo 30 camadas.'
      USING ERRCODE = '22023';
  END IF;

  -- Trava, em ordem estável, o composto e todos os grupos constituintes antes
  -- de qualquer DELETE/INSERT ou row lock. Os triggers reutilizam as mesmas
  -- chaves; isso fecha a corrida referência-folha × criação do primeiro filho.
  FOR v_lock_group_id IN
    SELECT DISTINCT candidates.group_id
      FROM (
        SELECT p_composite_group_id AS group_id
        UNION ALL
        SELECT CASE
          WHEN nullif(btrim(item->>'component_group_id'), '') IS NULL THEN NULL
          ELSE (item->>'component_group_id')::uuid
        END
        FROM jsonb_array_elements(p_layers) AS items(item)
      ) AS candidates
     WHERE candidates.group_id IS NOT NULL
     ORDER BY candidates.group_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('group-leaf-reference:' || v_lock_group_id::text, 0)
    );
  END LOOP;

  SELECT count(*)::integer INTO v_color_source_count
    FROM jsonb_array_elements(p_layers) AS x(layer)
   WHERE coalesce((x.layer->>'is_color_source')::boolean, false);

  IF v_color_source_count > 1 THEN
    RAISE EXCEPTION 'Escolha no máximo uma camada como referência visual de cor.'
      USING ERRCODE = '23514';
  END IF;

  SELECT g.name INTO v_group_name
    FROM public.product_groups g
   WHERE g.id = p_composite_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grupo composto % não encontrado.', p_composite_group_id
      USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_groups c
     WHERE c.parent_group_id = p_composite_group_id
  ) THEN
    RAISE EXCEPTION 'O grupo composto % deve ser grupo-folha.', v_group_name
      USING ERRCODE = '23514';
  END IF;

  -- Replace-all dentro da mesma transação da RPC: qualquer camada inválida
  -- desfaz também o DELETE, nunca deixando composição parcialmente salva.
  DELETE FROM public.product_group_layers l
   WHERE l.composite_group_id = p_composite_group_id;

  FOR v_layer, v_ordinality IN
    SELECT x.item, x.ord
      FROM jsonb_array_elements(p_layers) WITH ORDINALITY AS x(item, ord)
  LOOP
    IF jsonb_typeof(v_layer) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Cada camada deve ser um objeto JSON.'
        USING ERRCODE = '22023';
    END IF;

    v_component_group_id := CASE
      WHEN nullif(btrim(v_layer->>'component_group_id'), '') IS NULL THEN NULL
      ELSE (v_layer->>'component_group_id')::uuid
    END;
    v_component_label := nullif(btrim(v_layer->>'component_label'), '');

    IF v_component_group_id IS NULL AND v_component_label IS NULL THEN
      RAISE EXCEPTION 'Cada camada deve informar component_group_id ou component_label.'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.product_group_layers (
      composite_group_id,
      component_group_id,
      component_label,
      role,
      display_order,
      is_color_source,
      notes,
      created_by
    ) VALUES (
      p_composite_group_id,
      v_component_group_id,
      coalesce(v_component_label, ''),
      coalesce(nullif(btrim(v_layer->>'role'), ''), 'Camada'),
      coalesce(
        nullif(btrim(v_layer->>'display_order'), '')::integer,
        (v_ordinality - 1)::integer
      ),
      coalesce((v_layer->>'is_color_source')::boolean, false),
      nullif(btrim(v_layer->>'notes'), ''),
      auth.uid()
    );
  END LOOP;

  RETURN QUERY
  SELECT *
    FROM public.get_product_group_layers(p_composite_group_id);
END
$function$;

REVOKE ALL ON FUNCTION public.get_product_group_layers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_product_group_layers(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_product_group_layers(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.save_product_group_layers(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_product_group_layers(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_product_group_layers(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.get_product_group_layers(uuid) IS
  'Lê a composição cadastral de um grupo-folha; não calcula nem debita estoque.';
COMMENT ON FUNCTION public.save_product_group_layers(uuid, jsonb) IS
  'Substitui atomicamente as camadas cadastrais. Não cria consumo, reserva ou movimento de estoque.';

-- ---------------------------------------------------------------------------
-- 7) Seeds conservadores: apenas relações comprovadas pelo nome técnico
-- ---------------------------------------------------------------------------
-- Grupos canônicos são usados quando existem; CACHARREL/EVA/SUEDE permanecem
-- labels livres, exatamente como a UI permite. Cada bloco insere o conjunto
-- completo ou zero linhas — nunca deixa uma composição de uma camada só.
WITH seed AS (
  SELECT composite.id AS composite_id, base.id AS base_id, base.name AS base_name
    FROM public.product_groups composite
    JOIN public.product_groups base ON lower(btrim(base.name)) = 'napa soft'
   WHERE lower(btrim(composite.name)) = 'napa soft com cacharrel/eva'
     AND NOT EXISTS (
       SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = composite.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = base.id
     )
)
INSERT INTO public.product_group_layers (
  composite_group_id, component_group_id, component_label, role,
  display_order, is_color_source, notes
)
SELECT seed.composite_id, seed.base_id, seed.base_name, 'Material externo', 0, true,
       'Camada externa que orienta visualmente as cores do material acabado.'
  FROM seed
UNION ALL
SELECT seed.composite_id, NULL::uuid, 'CACHARREL / EVA', 'Base da dublagem', 1, false,
       'Camada livre confirmada pelo nome técnico; aguarda grupo canônico opcional.'
  FROM seed
ON CONFLICT (composite_group_id, display_order) DO NOTHING;

WITH seed AS (
  SELECT composite.id AS composite_id,
         napa.id AS napa_id, napa.name AS napa_name,
         pu.id AS pu_id, pu.name AS pu_name
    FROM public.product_groups composite
    JOIN public.product_groups napa ON lower(btrim(napa.name)) = 'napa soft'
    JOIN public.product_groups pu ON lower(btrim(pu.name)) = 'pu 600'
   WHERE lower(btrim(composite.name)) = 'napa soft com pu 600'
     AND NOT EXISTS (
       SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = composite.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.product_groups c WHERE c.parent_group_id IN (napa.id, pu.id)
     )
)
INSERT INTO public.product_group_layers (
  composite_group_id, component_group_id, component_label, role,
  display_order, is_color_source, notes
)
SELECT seed.composite_id, seed.napa_id, seed.napa_name, 'Material externo', 0, true,
       'Napa base que orienta visualmente as cores do material acabado.'
  FROM seed
UNION ALL
SELECT seed.composite_id, seed.pu_id, seed.pu_name, 'Base da dublagem', 1, false,
       'PU 600 confirmado como segunda camada do material composto.'
  FROM seed
ON CONFLICT (composite_group_id, display_order) DO NOTHING;

WITH seed AS (
  SELECT composite.id AS composite_id,
         napa.id AS napa_id, napa.name AS napa_name,
         pu.id AS pu_id, pu.name AS pu_name
    FROM public.product_groups composite
    JOIN public.product_groups napa ON lower(btrim(napa.name)) = 'napa sudani'
    JOIN public.product_groups pu ON lower(btrim(pu.name)) = 'pu 600'
   WHERE lower(btrim(composite.name)) = 'sudani dublado pu 600'
     AND NOT EXISTS (
       SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = composite.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.product_groups c WHERE c.parent_group_id IN (napa.id, pu.id)
     )
)
INSERT INTO public.product_group_layers (
  composite_group_id, component_group_id, component_label, role,
  display_order, is_color_source, notes
)
SELECT seed.composite_id, seed.napa_id, seed.napa_name, 'Material externo', 0, true,
       'Napa base que orienta visualmente as cores do material acabado.'
  FROM seed
UNION ALL
SELECT seed.composite_id, seed.pu_id, seed.pu_name, 'Base da dublagem', 1, false,
       'PU 600 confirmado como segunda camada do material composto.'
  FROM seed
ON CONFLICT (composite_group_id, display_order) DO NOTHING;

WITH seed AS (
  SELECT composite.id AS composite_id
    FROM public.product_groups composite
   WHERE lower(btrim(composite.name)) = 'suede eva + cacharrel'
     AND NOT EXISTS (
       SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = composite.id
     )
)
INSERT INTO public.product_group_layers (
  composite_group_id, component_group_id, component_label, role,
  display_order, is_color_source, notes
)
SELECT seed.composite_id, NULL::uuid, 'SUEDE', 'Material externo', 0, true,
       'Camada externa confirmada pelo nome técnico.'
  FROM seed
UNION ALL
SELECT seed.composite_id, NULL::uuid, 'EVA', 'Estrutura', 1, false,
       'Camada intermediária confirmada pelo nome técnico.'
  FROM seed
UNION ALL
SELECT seed.composite_id, NULL::uuid, 'CACHARREL', 'Base da dublagem', 2, false,
       'Camada de base confirmada pelo nome técnico.'
  FROM seed
ON CONFLICT (composite_group_id, display_order) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8) Teste contratual da própria migration (falha alto sem fabricar cadastro)
-- ---------------------------------------------------------------------------
DO $contract$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT g.id INTO v_family_id
    FROM public.product_groups g
   WHERE lower(btrim(g.name)) = 'dublagem';

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Contrato DUBLAGEM: família não encontrada.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.id = v_family_id
       AND g.sector IS DISTINCT FROM 'Cabedal'
  ) OR EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.parent_group_id = v_family_id
       AND g.sector IS DISTINCT FROM 'Cabedal'
  ) THEN
    RAISE EXCEPTION 'Contrato DUBLAGEM: família e folhas devem pertencer ao setor Cabedal.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.products p WHERE p.group_id = v_family_id) THEN
    RAISE EXCEPTION 'Contrato DUBLAGEM: a família possui produtos diretos.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.parent_group_id = v_family_id
       AND lower(btrim(g.name)) = 'dublagem diversos'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.parent_group_id = v_family_id
       AND lower(btrim(g.name)) = 'napa soft com cacharrel/eva'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.parent_group_id = v_family_id
       AND lower(btrim(g.name)) = 'napa soft com pu 600'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.parent_group_id = v_family_id
       AND lower(btrim(g.name)) = 'pelo dublado'
  ) THEN
    RAISE EXCEPTION 'Contrato DUBLAGEM: faltam grupos-folha obrigatórios.';
  END IF;

  -- Não auto-mapear CF07 (nem qualquer ficha com o texto da família).
  IF EXISTS (
    SELECT 1 FROM public.technical_sheets ts
     WHERE lower(btrim(ts.upper_material)) = 'dublagem'
       AND ts.upper_material_group_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Contrato DUBLAGEM: uma ficha da família foi mapeada como folha.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.technical_sheets ts
      JOIN public.product_groups g ON g.id = ts.upper_material_group_id
     WHERE EXISTS (
       SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = g.id
     )
        OR ts.upper_material IS DISTINCT FROM g.name
  ) THEN
    RAISE EXCEPTION 'Contrato cabedal: FK aponta para família ou nome está dessincronizado.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.product_group_layers l
     WHERE EXISTS (
       SELECT 1 FROM public.product_groups c
        WHERE c.parent_group_id IN (l.composite_group_id, l.component_group_id)
     )
  ) THEN
    RAISE EXCEPTION 'Contrato composição: toda camada deve ligar dois grupos-folha.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.product_group_layers l
     WHERE nullif(btrim(l.component_label), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Contrato composição: toda camada exige component_label.';
  END IF;

  IF EXISTS (
    SELECT l.composite_group_id
      FROM public.product_group_layers l
     GROUP BY l.composite_group_id
    HAVING count(*) = 1
  ) THEN
    RAISE EXCEPTION 'Contrato composição: deve ficar vazia ou possuir pelo menos duas camadas.';
  END IF;

  IF EXISTS (
    SELECT l.composite_group_id
      FROM public.product_group_layers l
     WHERE l.is_color_source IS TRUE
     GROUP BY l.composite_group_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Contrato composição: no máximo uma camada pode orientar a cor.';
  END IF;

  IF (
    SELECT count(*)
      FROM public.product_group_layers l
      JOIN public.product_groups composite ON composite.id = l.composite_group_id
      JOIN public.product_groups component ON component.id = l.component_group_id
     WHERE lower(btrim(composite.name)) = 'napa soft com pu 600'
       AND lower(btrim(component.name)) IN ('napa soft', 'pu 600')
  ) <> 2 THEN
    RAISE EXCEPTION 'Contrato composição: NAPA SOFT COM PU 600 exige NAPA SOFT + PU 600.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.product_groups g
     WHERE lower(btrim(g.name)) IN (
       'napa soft com cacharrel/eva',
       'napa soft com pu 600',
       'sudani dublado pu 600',
       'suede eva + cacharrel',
       'pelo dublado'
     )
       AND (
         g.dimensions_width IS DISTINCT FROM 1370
         OR g.dimensions_length IS DISTINCT FROM 0
         OR g.consumption_unit IS DISTINCT FROM 'm'
         OR g.shared_specs IS DISTINCT FROM true
         OR g.is_bom_color_source IS DISTINCT FROM true
         OR g.auto_component_sheet IS DISTINCT FROM true
       )
  ) THEN
    RAISE EXCEPTION 'Contrato DUBLAGEM: folha confirmada sem dimensões/flags compartilhadas.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.products p
      JOIN public.product_groups g ON g.id = p.group_id
     WHERE lower(btrim(g.name)) IN (
       'napa soft com cacharrel/eva',
       'napa soft com pu 600',
       'sudani dublado pu 600',
       'suede eva + cacharrel',
       'pelo dublado'
     )
       AND (
         p.unit IS DISTINCT FROM 'm'
         OR p.purchase_unit IS DISTINCT FROM 'm'
         OR p.production_unit IS DISTINCT FROM 'm'
         OR p.purchase_order_unit IS DISTINCT FROM 'm'
         OR p.consumption_unit IS DISTINCT FROM 'm'
         OR p.conversion_rate IS DISTINCT FROM 1
       )
  ) THEN
    RAISE EXCEPTION 'Contrato DUBLAGEM: produto de rolo fora da unidade-base m / conversão 1.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.products p
      JOIN public.product_groups g ON g.id = p.group_id
     WHERE g.parent_group_id = v_family_id
       AND p.category IS DISTINCT FROM 'Cabedal'
  ) THEN
    RAISE EXCEPTION 'Contrato DUBLAGEM: produto não acompanhou a categoria Cabedal da folha.';
  END IF;

  -- Somente os grupos confirmados são exigidos em 1.370 mm. DIVERSOS não entra.
  IF EXISTS (
    SELECT 1
      FROM public.products p
      JOIN public.product_groups g ON g.id = p.group_id
      LEFT JOIN public.component_sheets cs ON cs.product_id = p.id
     WHERE p.active IS TRUE
       AND lower(btrim(coalesce(p.unit, ''))) IN (
         'm', 'metro', 'metros', 'mt', 'mts', 'meters', 'm linear', 'cm'
       )
       AND lower(btrim(g.name)) IN (
         'napa soft com cacharrel/eva',
         'napa soft com pu 600',
         'sudani dublado pu 600',
         'suede eva + cacharrel',
         'pelo dublado'
       )
       AND (
         cs.product_id IS NULL
         OR cs.group_id IS DISTINCT FROM p.group_id
         OR cs.dimensions_width IS DISTINCT FROM 1370
         OR cs.dimensions_unit IS DISTINCT FROM 'mm'
       )
  ) THEN
    RAISE EXCEPTION 'Contrato DUBLAGEM: rolo confirmado sem ficha/largura de 1.370 mm.';
  END IF;
END
$contract$;
