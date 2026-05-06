-- Cria índice único parcial em accounts_payable para evitar contas a pagar duplicadas
-- com mesmo fornecedor e descrição enquanto estiverem pendentes ou aprovadas.

CREATE UNIQUE INDEX IF NOT EXISTS accounts_payable_supplier_description_unique
  ON public.accounts_payable (supplier_id, description)
  WHERE status IN ('pending', 'approved')
    AND supplier_id IS NOT NULL;