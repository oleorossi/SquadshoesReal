-- =============================================================================
-- Tipo de pagamento do funcionário: mensalista (padrão) ou diarista.
-- =============================================================================
-- Diarista é pago por dia trabalhado (daily_rate) e NÃO entra no cálculo de
-- hora extra / falta / banco de horas. Caso real: Catia Silva, R$100/dia,
-- trabalha dia sim/dia não. Aplicado em produção via MCP.
-- =============================================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'mensalista'
    CHECK (payment_type IN ('mensalista','diarista')),
  ADD COLUMN IF NOT EXISTS daily_rate numeric;

COMMENT ON COLUMN public.employees.payment_type IS
  'mensalista = salário mensal + apuração de HE/banco; diarista = pago por dia trabalhado (daily_rate), sem HE/falta/banco.';
COMMENT ON COLUMN public.employees.daily_rate IS
  'Valor da diária (R$/dia) quando payment_type=diarista.';

-- Catia Silva: diarista, R$ 100/dia.
UPDATE public.employees
SET payment_type = 'diarista', daily_rate = 100
WHERE name = 'Catia Silva';
