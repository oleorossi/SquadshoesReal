-- =============================================================================
-- v_production_sectors — a lista oficial de setores, legível do TS
--
-- `capacity_sector_key` é função SQL. Sem esta view, o frontend teria que
-- reimplementar a normalização em TypeScript — recriando exatamente a
-- duplicação que a v_employee_sector acabou de encerrar (a regex privada da
-- Ficha de Montadores). Aqui o banco entrega chave e rótulo já resolvidos.
--
-- A ordem é `flow_order`, a mesma sequência do fluxo de produção usada pelo PCP,
-- então as abas da Ficha saem na ordem em que o sapato anda pela fábrica.
--
-- Repare que Aviamento tem chave 'mesa' (herança do nome antigo do setor,
-- normalizada por capacity_sector_key). É por isso que a chave NÃO pode ser
-- derivada do rótulo no TS por conta própria.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_production_sectors
WITH (security_invoker = on) AS
SELECT public.capacity_sector_key(ss.sector) AS sector_key,
       ss.sector                             AS sector_label,
       ss.flow_order,
       ss.headcount
  FROM public.sector_settings ss;

COMMENT ON VIEW public.v_production_sectors IS
  'Setores de produção oficiais (sector_settings) com a chave canônica já '
  'resolvida por capacity_sector_key. Fonte das abas da Ficha de Montadores — '
  'evita reimplementar a normalização em TypeScript.';

REVOKE ALL ON public.v_production_sectors FROM anon;
GRANT SELECT ON public.v_production_sectors TO authenticated;
