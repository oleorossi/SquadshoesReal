-- Auditoria NF-e 2026-05-15 — hardening de banco
-- Cobre achados A2, A10, A11, A15 do relatório de auditoria interna.
-- Aplicada via MCP, arquivada aqui pra rastreabilidade.

-- =====================================================================
-- A2: idempotency_key em nfe_devolucoes
-- =====================================================================
-- Causa raiz: retry no frontend (ou clique duplo) na emissão de devolução
-- criava 2 registros em nfe_devolucoes e reduzia AR 2× sem deduplicação.
-- Solução: idempotency_key UUID gerado pelo frontend, unique partial pra
-- impedir duplicata da mesma tentativa.
ALTER TABLE public.nfe_devolucoes
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

COMMENT ON COLUMN public.nfe_devolucoes.idempotency_key IS
  'Chave única gerada no frontend antes do submit. Bloqueia duplicação de devolução em retries — emit-nfe-devolucao consulta antes de inserir.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_nfe_devolucoes_idempotency_key
  ON public.nfe_devolucoes (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =====================================================================
-- A11: UNIQUE em chave_acesso (nfe_emitidas)
-- =====================================================================
-- Defesa secundária além de uq_nfe_emitidas_provider_nfe_id: se GestaoClick
-- mudar o ID interno em re-sincronização, evita 2 registros pra mesma NF
-- fiscal (chave_acesso é única por definição na SEFAZ).
-- Partial: só pra NFs autorizadas/canceladas (chave só existe pós-autorização).
CREATE UNIQUE INDEX IF NOT EXISTS uq_nfe_emitidas_chave_acesso
  ON public.nfe_emitidas (chave_acesso)
  WHERE chave_acesso IS NOT NULL AND length(chave_acesso) = 44;

-- =====================================================================
-- A15: FK nfe_id em financial_entries pra rastreabilidade de estornos
-- =====================================================================
-- Hoje financial_entries.reference_id armazena o sale_order_id ou
-- devolucao_id sem FK formal pra nfe_emitidas. Estornos de cancelamento
-- não têm como ser ligados de volta à NF original via JOIN.
-- Nova coluna opcional permite rastreio sem quebrar entries existentes.
ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS nfe_id uuid REFERENCES public.nfe_emitidas(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.financial_entries.nfe_id IS
  'Vinculação opcional à NF-e que originou esse lançamento (faturamento ou estorno). Permite JOIN auditoria sem depender de reference_id text.';

CREATE INDEX IF NOT EXISTS idx_financial_entries_nfe_id
  ON public.financial_entries (nfe_id)
  WHERE nfe_id IS NOT NULL;

-- =====================================================================
-- A10: View pra detectar gaps na sequência de NFs por (company_id, serie)
-- =====================================================================
-- Não detecta NFs INUTILIZADAS pela SEFAZ — só mostra "buracos" entre
-- numero N e N+2 onde N+1 não existe no banco local. Operador deve
-- confirmar no painel GestaoClick se o número pulado foi inutilizado
-- legitimamente ou se está perdido.
CREATE OR REPLACE VIEW public.v_nfe_sequence_gaps AS
WITH series AS (
  SELECT DISTINCT
    n.company_id,
    n.cnpj_emitente,
    n.serie,
    MIN(n.numero::integer) FILTER (WHERE n.numero ~ '^\d+$') AS min_n,
    MAX(n.numero::integer) FILTER (WHERE n.numero ~ '^\d+$') AS max_n
  FROM public.nfe_emitidas n
  WHERE n.status IN ('autorizada','cancelada','rejeitada')
    AND n.numero IS NOT NULL AND n.numero <> ''
  GROUP BY n.company_id, n.cnpj_emitente, n.serie
), expected AS (
  SELECT
    s.company_id, s.cnpj_emitente, s.serie,
    generate_series(s.min_n, s.max_n) AS expected_numero
  FROM series s
), present AS (
  SELECT
    n.company_id, n.cnpj_emitente, n.serie,
    n.numero::integer AS numero_int
  FROM public.nfe_emitidas n
  WHERE n.numero ~ '^\d+$'
)
SELECT
  e.company_id,
  e.cnpj_emitente,
  e.serie,
  e.expected_numero AS missing_numero
FROM expected e
LEFT JOIN present p
  ON p.company_id IS NOT DISTINCT FROM e.company_id
 AND p.cnpj_emitente = e.cnpj_emitente
 AND p.serie = e.serie
 AND p.numero_int = e.expected_numero
WHERE p.numero_int IS NULL
ORDER BY e.cnpj_emitente, e.serie, e.expected_numero;

COMMENT ON VIEW public.v_nfe_sequence_gaps IS
  'Buracos na sequência de NFs autorizadas/canceladas/rejeitadas por CNPJ+série. Cada linha = um número faltando. Cruzar com painel GestaoClick pra ver se é inutilização legítima ou NF perdida.';

GRANT SELECT ON public.v_nfe_sequence_gaps TO authenticated;
