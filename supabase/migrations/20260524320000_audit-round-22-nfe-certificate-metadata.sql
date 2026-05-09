-- =============================================================================
-- AUDIT ROUND 22 — Metadados de certificado digital A1 na empresa
-- =============================================================================
-- User: "Quero configurar certificado digital pra emitir nota fiscal"
--
-- Sistema usa Focus NFe como provedor — eles armazenam o .pfx + senha
-- e assinam as NF-e em nome do cliente. Pra sistema NÃO armazena a
-- senha (security best practice — só Focus tem). Sistema guarda apenas
-- metadados retornados pela Focus pra mostrar status na UI.
--
-- Colunas novas:
--   - cert_status: 'pendente' | 'ativo' | 'expirado' | 'erro' | NULL
--   - cert_valid_until: data de validade do certificado A1
--   - cert_subject_name: nome no CN do certificado (ex: "EMPRESA XYZ:01234567000189")
--   - cert_uploaded_at: quando foi feito o upload
--   - cert_focus_synced_at: quando foi sincronizado com Focus NFe pela última vez
-- =============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS cert_status text
    CHECK (cert_status IN ('pendente', 'ativo', 'expirado', 'erro') OR cert_status IS NULL),
  ADD COLUMN IF NOT EXISTS cert_valid_until date,
  ADD COLUMN IF NOT EXISTS cert_subject_name text,
  ADD COLUMN IF NOT EXISTS cert_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS cert_focus_synced_at timestamptz;

COMMENT ON COLUMN public.companies.cert_status IS
  'Status do certificado digital A1 na Focus NFe: pendente (upload feito mas não sincronizado), ativo, expirado, erro. NULL = sem certificado.';

COMMENT ON COLUMN public.companies.cert_valid_until IS
  'Data de validade do certificado A1 (retornada pela Focus NFe). UI alerta quando faltam <30 dias.';

CREATE INDEX IF NOT EXISTS idx_companies_cert_status
  ON public.companies (cert_status, cert_valid_until)
  WHERE cert_status IS NOT NULL;

-- View pra UI listar empresas com status do certificado
CREATE OR REPLACE VIEW public.v_companies_cert_status AS
SELECT
  c.id,
  c.cnpj,
  c.razao_social,
  c.nome_fantasia,
  c.ambiente,
  c.is_primary,
  c.active,
  c.cert_status,
  c.cert_valid_until,
  c.cert_subject_name,
  c.cert_uploaded_at,
  c.cert_focus_synced_at,
  -- Dias até expirar (negativo = já expirou)
  CASE WHEN c.cert_valid_until IS NULL THEN NULL
       ELSE (c.cert_valid_until - CURRENT_DATE)::int
  END AS cert_days_until_expiry,
  -- Severidade pra UI: critical (sem cert/expirado/<7d), warning (<30d), ok (>=30d)
  CASE
    WHEN c.cert_status IS NULL OR c.cert_status = 'erro' THEN 'critical'
    WHEN c.cert_status = 'expirado' THEN 'critical'
    WHEN c.cert_status = 'pendente' THEN 'warning'
    WHEN c.cert_valid_until IS NULL THEN 'warning'
    WHEN (c.cert_valid_until - CURRENT_DATE)::int < 7 THEN 'critical'
    WHEN (c.cert_valid_until - CURRENT_DATE)::int < 30 THEN 'warning'
    ELSE 'ok'
  END AS cert_severity
FROM public.companies c
WHERE c.active = true;

GRANT SELECT ON public.v_companies_cert_status TO authenticated;
