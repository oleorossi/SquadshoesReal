-- =============================================================================
-- v_employee_sector — VÍNCULO FUNCIONÁRIO ↔ SETOR, fonte única legível do TS
--
-- PROBLEMA. O mesmo fato ("de que setor é esta pessoa") vivia em quatro lugares
-- que não conversavam: `employees.department` (texto livre),
-- `employee_sector_allocation` (N:N com fração, desenhada pra isso e VAZIA),
-- `sector_settings` (a taxonomia oficial) e — o pior — uma regex privada dentro
-- de `src/pages/FichaMontadoresPage.tsx`, que casava `role + department` contra
-- padrões próprios (/montagem|montador/i etc).
--
-- A regex privada não é só duplicação: ela DIVERGE. Levantamento no banco:
-- 11 de 20 funcionários ativos não casavam com padrão nenhum e ficavam
-- invisíveis na tela — não dava pra lançar produção deles, em silêncio, sem
-- aviso. E a taxonomia era outra (a tela tinha 'costura'; o sistema tem
-- Costura Palmilha e Costura Cabedal separadas).
--
-- SOLUÇÃO. Uma view canônica que resolve o vínculo com a MESMA normalização que
-- o resto do sistema (`capacity_sector_key`, que já trata Mesa = Aviamento) e a
-- MESMA regra de pertencimento de `sector_measured_capacity`/`sector_rh_headcount`:
--   department  → vínculo padrão, fração 1,0
--   allocation  → vínculo explícito, VENCE o department (override e multi-setor)
-- Uma linha por (funcionário, setor): quem divide o dia entre dois setores
-- aparece duas vezes, com a fração de cada.
--
-- Por que view e não coluna `employees.sector`: coluna nova seria um QUINTO
-- lugar guardando o mesmo fato. Aqui não há dado novo — há uma leitura só.
--
-- `security_invoker = on`: a view herda a RLS de `employees`
-- (SELECT exige is_approved_user()), em vez de furá-la com direitos do dono.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_employee_sector
WITH (security_invoker = on) AS
WITH vinculo AS (
  -- Vínculo pelo cadastro. `capacity_sector_key` normaliza o texto livre
  -- (acento, caixa, sinônimo) — é a mesma função que o PCP usa pra contar
  -- equipe, então roster de tela e headcount de motor não podem divergir.
  SELECT e.id                                     AS employee_id,
         public.capacity_sector_key(e.department) AS sector_key,
         1::numeric                               AS allocation_fraction,
         'department'::text                       AS origem
    FROM public.employees e
   WHERE coalesce(btrim(e.department), '') <> ''

  UNION ALL

  -- Vínculo explícito: exceção de cadastro e quem trabalha em mais de um setor.
  SELECT a.employee_id,
         public.capacity_sector_key(a.sector),
         a.allocation_fraction,
         'allocation'::text
    FROM public.employee_sector_allocation a
),
dedup AS (
  -- Alocação explícita vence o department pro MESMO setor (é o override).
  SELECT DISTINCT ON (employee_id, sector_key)
         employee_id, sector_key, allocation_fraction, origem
    FROM vinculo
   WHERE coalesce(btrim(sector_key), '') <> ''
   ORDER BY employee_id, sector_key, (origem = 'allocation') DESC
)
SELECT e.id                                          AS employee_id,
       e.name,
       e.role,
       e.department,
       e.external_id,
       e.active,
       e.payment_type,
       e.valor_par_medio,
       e.valor_par_dificil,
       d.sector_key,
       public.capacity_sector_label(d.sector_key)    AS sector_label,
       d.allocation_fraction,
       d.origem,
       -- Setor de produção de verdade (está em sector_settings) x lotação
       -- administrativa: 'administrativo', 'comercial' e 'producao' resolvem
       -- pra chave válida mas NÃO são etapa do fluxo — a Ficha não deve
       -- oferecer aba pra eles nem acusá-los como pendência.
       EXISTS (SELECT 1
                 FROM public.sector_settings ss
                WHERE public.capacity_sector_key(ss.sector) = d.sector_key) AS setor_produtivo
  FROM dedup d
  JOIN public.employees e ON e.id = d.employee_id;

COMMENT ON VIEW public.v_employee_sector IS
  'Fonte única do vínculo funcionário↔setor: department (fração 1,0) + '
  'employee_sector_allocation (override/multi-setor, vence o department), '
  'normalizados por capacity_sector_key. Uma linha por (funcionário, setor). '
  'Consumida pela Ficha de Montadores e disponível pros motores de capacidade — '
  'substitui a regex privada que deixava 11 de 20 ativos invisíveis.';

REVOKE ALL ON public.v_employee_sector FROM anon;
GRANT SELECT ON public.v_employee_sector TO authenticated;
