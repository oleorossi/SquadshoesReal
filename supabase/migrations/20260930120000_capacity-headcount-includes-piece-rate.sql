-- =============================================================================
-- CAPACIDADE ≠ CUSTO — headcount do RH volta a contar quem é pago por par
--
-- CONTEXTO. `sector_rh_headcount` excluía `payment_type = 'producao'` com a
-- justificativa R3 da spec de equipe/capacidade: "eles produzem, mas o custo sai
-- por par na folha — contá-los na equipe duplicaria a MO".
--
-- O RACIOCÍNIO VALE PRA CUSTO, MAS A FUNÇÃO NÃO SERVE CUSTO. Rastreando os
-- consumidores no banco, `sector_rh_headcount` só é lido por
-- `sector_effective_team`, que por sua vez alimenta APENAS motores de
-- CAPACIDADE: capacity_planning_comparison, get_model_productivity,
-- set_model_sector_capacity e capacity_consistency_report. Nenhuma view a
-- referencia. O custo de MO vem de outro caminho — `time_studies`
-- (v_sector_cost_per_minute) e `sector_labor_rates` — que não tocam esta função.
-- Logo, não há MO alguma pra duplicar aqui: o filtro só apagava gente real do
-- cálculo de capacidade.
--
-- SINTOMA QUE ISSO CAUSA. Montador pago por par é o operário que MAIS ocupa
-- posto no setor; excluí-lo faz `sector_effective_team` devolver
-- 'nao_informado' e o setor cai fora do planejamento — exatamente o sintoma que
-- a spec descreve como "fez a Costura parecer não cadastrada". Na virada dos
-- montadores da Squad pro regime por par, a Montagem (hoje o ÚNICO setor com
-- cobertura de medição total, 667,98 pares/dia sobre a Chamada do Dia) viraria
-- setor sem equipe.
--
-- ALINHAMENTO. Aproveita pra casar a regra de pertencimento com a que
-- `sector_measured_capacity` já usa desde a 20260719160000: vale o
-- `department` OU uma linha explícita em `employee_sector_allocation`. Antes as
-- duas funções discordavam sobre quem é do setor — a medida enxergava o
-- alocado, a contagem não. Como `employee_sector_allocation` está vazia hoje,
-- essa parte não muda nenhum número agora; passa a valer quando a alocação for
-- usada.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sector_rh_headcount(p_sector text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT count(*)::integer
    FROM employees e
   WHERE e.active
     AND (public.capacity_sector_key(e.department) = public.capacity_sector_key(p_sector)
          OR EXISTS (SELECT 1
                       FROM employee_sector_allocation a
                      WHERE a.employee_id = e.id
                        AND public.capacity_sector_key(a.sector) = public.capacity_sector_key(p_sector)))
$$;

COMMENT ON FUNCTION public.sector_rh_headcount(text) IS
  'Contagem viva de funcionários ativos do setor (department OU employee_sector_allocation). '
  'Mede CAPACIDADE, não custo: inclui regime por par (payment_type=''producao''), que ocupa '
  'posto no setor. O custo de MO desse pessoal sai por par na folha, por caminho separado '
  '(time_studies / sector_labor_rates), então não há duplicação de MO aqui.';
