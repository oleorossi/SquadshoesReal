-- ============================================================================
-- Consumo de solado: UMA tela só (Solados → Consumo Padrão)
--
-- Contexto: desde 02/08/2026 a fonte da verdade do consumo por par é
-- `sole_group_standard_items` (linhas PAPEL, por MODELO/grupo de solado), e
-- `sole_technical_specs` é ESPELHO derivado, mantido por `tg_sgsi_mirror_papel`.
--
-- Só que nada no banco impedia escrita direta no espelho. Em 03/08/2026 a
-- auditoria achou SEIS caminhos que gravavam nessas colunas por fora:
--   1. inputs da aba Forração/Palmilha        (tinham readOnly)
--   2. botão "Replicar 1º valor em todos"     (NÃO tinha)
--   3. "Puxar de Família"                      (NÃO tinha)
--   4. "Copiar de Qualquer Solado"             (NÃO tinha)
--   5. grid de fachete dm²/par da aba Cadastro (gravava direto)
--   6. a RPC copy_sole_specs_from              (copiava tudo, server-side)
-- Todo valor gravado por eles era apagado sem aviso no salvamento seguinte da
-- tela Consumo Padrão — a deriva silenciosa que a consolidação queria acabar.
--
-- A UI dos 6 caminhos saiu no mesmo commit. Esta migration é a trava que
-- sobrevive à próxima reescrita de tela: a guarda não pode viver só no front
-- (foi exatamente assim que a guarda de `profiles.approved` se perdeu numa
-- reescrita de RLS — ver CLAUDE.md, P0 de 30/07/2026).
--
-- Três partes:
--   A. copy_sole_specs_from passa a copiar SÓ a régua de numerações
--   B. INSERT de numeração nova deriva o consumo do cadastro do modelo
--   C. UPDATE que altere as 8 colunas de consumo é REJEITADO
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. copy_sole_specs_from: copia a RÉGUA, não o consumo.
--    O botão que a chama virou "Copiar Numerações de Outro Solado".
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.copy_sole_specs_from(
  p_source_sole_id uuid,
  p_target_sole_id uuid,
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_count int;
  v_target_count int;
  v_copied_specs int := 0;
  v_copied_structs int := 0;
BEGIN
  IF p_source_sole_id IS NULL OR p_target_sole_id IS NULL THEN
    RAISE EXCEPTION 'IDs origem e destino são obrigatórios';
  END IF;
  IF p_source_sole_id = p_target_sole_id THEN
    RAISE EXCEPTION 'IDs origem e destino são iguais';
  END IF;

  SELECT COUNT(*) INTO v_source_count FROM sole_technical_specs WHERE sole_id = p_source_sole_id;
  IF v_source_count = 0 THEN
    RAISE EXCEPTION 'Solado origem (%) não tem numerações cadastradas', p_source_sole_id;
  END IF;

  SELECT COUNT(*) INTO v_target_count FROM sole_technical_specs WHERE sole_id = p_target_sole_id;
  IF v_target_count > 0 AND NOT p_overwrite THEN
    RAISE EXCEPTION 'Solado destino já tem % numerações cadastradas. Use p_overwrite=true pra substituir.', v_target_count;
  END IF;

  IF p_overwrite THEN
    DELETE FROM sole_technical_specs WHERE sole_id = p_target_sole_id;
    DELETE FROM sole_structures WHERE sole_id = p_target_sole_id;
  END IF;

  -- Só sole_id + size + procedência. As colunas de consumo ficam de fora: o
  -- trigger de INSERT abaixo as deriva do cadastro do MODELO do destino, que
  -- pode ser outro solado com outro consumo. Copiá-las da origem era o que
  -- espalhava consumo alheio (mesmo bug de régua de 01/08/2026, só que no valor).
  INSERT INTO sole_technical_specs (sole_id, size, reference_sole_id, reference_date)
  SELECT p_target_sole_id, size, p_source_sole_id, now()
    FROM sole_technical_specs
   WHERE sole_id = p_source_sole_id;
  GET DIAGNOSTICS v_copied_specs = ROW_COUNT;

  INSERT INTO sole_structures (
    sole_id, component_type, default_group_id, lining_material_id, insole_material_id
  )
  SELECT p_target_sole_id, component_type, default_group_id, lining_material_id, insole_material_id
    FROM sole_structures
   WHERE sole_id = p_source_sole_id;
  GET DIAGNOSTICS v_copied_structs = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'copied_specs', v_copied_specs,
    'copied_structures', v_copied_structs,
    'source_sole_id', p_source_sole_id,
    'target_sole_id', p_target_sole_id,
    'overwrite', p_overwrite
  );
END;
$$;

COMMENT ON FUNCTION public.copy_sole_specs_from(uuid, uuid, boolean) IS
  'Copia a GRADE de numerações de um solado pra outro. NÃO copia consumo — '
  'consumo é do MODELO (sole_group_standard_items) e o INSERT deriva sozinho.';

-- ────────────────────────────────────────────────────────────────────────────
-- B+C. Trava de escrita no espelho.
-- ────────────────────────────────────────────────────────────────────────────

-- O espelho precisa de uma porta. `set_config(..., true)` é local à transação,
-- então a permissão não vaza pra outra sessão nem pra outra transação.
CREATE OR REPLACE FUNCTION public.tg_mirror_sole_papel_to_specs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_role text;
  v_group uuid;
  v_scalar_col text;
  v_persize_col text;
  v_sole record;
  v_size integer;
  v_value numeric;
  v_per_pair numeric;
  v_per_size jsonb;
begin
  if TG_OP = 'DELETE' then
    v_role := OLD.role; v_group := OLD.sole_group_id;
    v_per_pair := 0; v_per_size := '{}'::jsonb;
  else
    v_role := NEW.role; v_group := NEW.sole_group_id;
    v_per_pair := NEW.consumption_per_pair; v_per_size := NEW.consumption_per_size;
  end if;

  if v_role is null then
    return coalesce(NEW, OLD);
  end if;

  case v_role
    when 'forro_cabedal'     then v_scalar_col := 'lining_consumption_dm2';
                                  v_persize_col := 'lining_consumption_per_size';
    when 'placa_palmilha'    then v_scalar_col := 'insole_consumption_dm2';
                                  v_persize_col := 'insole_consumption_per_size';
    when 'forracao_palmilha' then v_scalar_col := 'insole_lining_consumption_dm2';
                                  v_persize_col := 'insole_lining_consumption_per_size';
    when 'fachete'           then v_scalar_col := 'fachete_lining_consumption_dm2';
                                  v_persize_col := 'fachete_lining_consumption_per_size';
  end case;

  -- Abre a porta da trava só pelo tempo desta função.
  perform set_config('app.sole_mirror', 'on', true);

  for v_sole in
    select id from public.products
     where group_id = v_group
       and (category ilike '%solado%' or lower(category) = 'sola')
  loop
    for v_size in
      select distinct size from public.sole_technical_specs where sole_id = v_sole.id
    loop
      v_value := coalesce((v_per_size ->> v_size::text)::numeric, v_per_pair);
      execute format(
        'update public.sole_technical_specs set %I = $1, %I = $2, updated_at = now() where sole_id = $3 and size = $4',
        v_scalar_col, v_persize_col
      ) using v_value, v_per_size, v_sole.id, v_size;
    end loop;
  end loop;

  perform set_config('app.sole_mirror', 'off', true);

  return coalesce(NEW, OLD);
end;
$$;

-- Deriva o consumo de UMA numeração a partir do cadastro do modelo.
-- Usada no INSERT: numeração nova nasce com o consumo do modelo em vez de zero.
CREATE OR REPLACE FUNCTION public.sole_papel_value_for_size(
  p_sole_id uuid,
  p_role text,
  p_size integer
)
RETURNS TABLE (scalar_value numeric, per_size_map jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce((i.consumption_per_size ->> p_size::text)::numeric, i.consumption_per_pair),
    coalesce(i.consumption_per_size, '{}'::jsonb)
    FROM public.products p
    JOIN public.sole_group_standard_items i ON i.sole_group_id = p.group_id
   WHERE p.id = p_sole_id
     AND i.role = p_role
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.tg_sole_specs_freeze_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_mirror boolean := coalesce(current_setting('app.sole_mirror', true), 'off') = 'on';
  v_scalar numeric;
  v_map jsonb;
begin
  -- Escrita vinda do próprio espelho passa direto.
  if v_mirror then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    -- Numeração nova: o consumo NÃO vem de quem inseriu, vem do cadastro do
    -- MODELO. Sem isto, adicionar o 41 na grade criava uma linha zerada e o
    -- motor caía no escalar — furo silencioso que só aparecia na OP.
    SELECT scalar_value, per_size_map INTO v_scalar, v_map
      FROM public.sole_papel_value_for_size(NEW.sole_id, 'forro_cabedal', NEW.size);
    NEW.lining_consumption_dm2 := v_scalar;
    NEW.lining_consumption_per_size := coalesce(v_map, '{}'::jsonb);

    SELECT scalar_value, per_size_map INTO v_scalar, v_map
      FROM public.sole_papel_value_for_size(NEW.sole_id, 'placa_palmilha', NEW.size);
    NEW.insole_consumption_dm2 := v_scalar;
    NEW.insole_consumption_per_size := coalesce(v_map, '{}'::jsonb);

    SELECT scalar_value, per_size_map INTO v_scalar, v_map
      FROM public.sole_papel_value_for_size(NEW.sole_id, 'forracao_palmilha', NEW.size);
    NEW.insole_lining_consumption_dm2 := v_scalar;
    NEW.insole_lining_consumption_per_size := coalesce(v_map, '{}'::jsonb);

    SELECT scalar_value, per_size_map INTO v_scalar, v_map
      FROM public.sole_papel_value_for_size(NEW.sole_id, 'fachete', NEW.size);
    NEW.fachete_lining_consumption_dm2 := v_scalar;
    NEW.fachete_lining_consumption_per_size := coalesce(v_map, '{}'::jsonb);

    return NEW;
  end if;

  -- UPDATE: as 8 colunas são congeladas. `IS DISTINCT FROM` deixa passar o
  -- upsert da tela de grade, que reenvia a linha inteira sem alterar consumo.
  if NEW.lining_consumption_dm2              IS DISTINCT FROM OLD.lining_consumption_dm2
  or NEW.insole_consumption_dm2              IS DISTINCT FROM OLD.insole_consumption_dm2
  or NEW.insole_lining_consumption_dm2       IS DISTINCT FROM OLD.insole_lining_consumption_dm2
  or NEW.fachete_lining_consumption_dm2      IS DISTINCT FROM OLD.fachete_lining_consumption_dm2
  or NEW.lining_consumption_per_size         IS DISTINCT FROM OLD.lining_consumption_per_size
  or NEW.insole_consumption_per_size         IS DISTINCT FROM OLD.insole_consumption_per_size
  or NEW.insole_lining_consumption_per_size  IS DISTINCT FROM OLD.insole_lining_consumption_per_size
  or NEW.fachete_lining_consumption_per_size IS DISTINCT FROM OLD.fachete_lining_consumption_per_size
  then
    raise exception
      'sole_technical_specs é ESPELHO: o consumo por par é cadastrado por MODELO em Solados → Consumo Padrão (sole_group_standard_items). Numeração % do solado %.',
      NEW.size, NEW.sole_id
      using hint = 'Edite a linha PAPEL do grupo em sole_group_standard_items; o trigger tg_sgsi_mirror_papel replica pra todas as cores.',
            errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS tg_sole_specs_freeze_consumption ON public.sole_technical_specs;

-- Nome com prefixo `tg_` roda antes de `trg_*` (ordem alfabética entre triggers
-- do mesmo evento) e depois de `set_updated_at`. Ver CLAUDE.md / memória
-- "Ordem alfabética dos triggers".
CREATE TRIGGER tg_sole_specs_freeze_consumption
  BEFORE INSERT OR UPDATE ON public.sole_technical_specs
  FOR EACH ROW EXECUTE FUNCTION public.tg_sole_specs_freeze_consumption();

COMMENT ON TRIGGER tg_sole_specs_freeze_consumption ON public.sole_technical_specs IS
  'Congela as 8 colunas de consumo: INSERT deriva do modelo, UPDATE de fora do '
  'espelho é rejeitado. A grade (linhas de numeração) continua livre.';
