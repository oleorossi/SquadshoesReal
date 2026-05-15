-- ============================================================================
-- Trigger: sincroniza nfe_emitidas.numero → sale_orders.nfe
-- ============================================================================
-- Quando uma NF-e é autorizada (ou tem o número populado), copia o número
-- pro campo sale_orders.nfe — usado pelas etiquetas de caixa externa
-- (LabelProductionTab → buildBoxIdentificationHtml). Antes a sincronização
-- dependia do código JS escrever em ambos os campos manualmente; agora é
-- garantida no banco mesmo quando a NF chega por sync de provedor ou retry.
--
-- Regras:
--   - dispara em INSERT/UPDATE quando status='autorizada' E numero IS NOT NULL
--   - se sale_order_id é null (NF avulsa), não faz nada
--   - cancelamento NÃO limpa o campo — operador às vezes precisa ver a NF
--     que foi cancelada na etiqueta histórica
--   - se já houver outro número na sale_orders.nfe, sobrescreve só quando a
--     NF nova é mais recente (evita NF de devolução sobrepor venda)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_nfe_numero_to_sale_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_nfe TEXT;
BEGIN
  -- Só processa NF autorizada com número
  IF NEW.status <> 'autorizada' OR NEW.numero IS NULL OR TRIM(NEW.numero) = '' THEN
    RETURN NEW;
  END IF;

  -- NF avulsa (sem PV vinculado) não tem onde sincronizar
  IF NEW.sale_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pega o que já tá em sale_orders.nfe pra decidir se sobrescreve
  SELECT nfe INTO v_existing_nfe FROM sale_orders WHERE id = NEW.sale_order_id;

  -- Sobrescreve quando: campo vazio OU número diferente do que tá lá
  -- (caso de re-emissão após rejeição/cancelamento, ou correção manual)
  IF v_existing_nfe IS NULL OR TRIM(v_existing_nfe) = '' OR v_existing_nfe <> NEW.numero THEN
    UPDATE sale_orders
    SET nfe = NEW.numero,
        updated_at = NOW()
    WHERE id = NEW.sale_order_id
      AND (nfe IS NULL OR TRIM(nfe) = '' OR nfe <> NEW.numero);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_sync_nfe_numero_to_sale_order ON public.nfe_emitidas;
CREATE TRIGGER tg_sync_nfe_numero_to_sale_order
AFTER INSERT OR UPDATE OF status, numero ON public.nfe_emitidas
FOR EACH ROW
EXECUTE FUNCTION public.sync_nfe_numero_to_sale_order();

-- ============================================================================
-- Backfill: garante que toda NF autorizada hoje tem o número refletido em
-- sale_orders.nfe (caso o histórico tenha desincronizado em algum momento).
-- Pega a NF autorizada MAIS RECENTE por sale_order_id pra evitar que NF de
-- devolução (sale_order_id da venda original mas outra finalidade) sobreponha.
-- ============================================================================

WITH latest_authorized_nfe AS (
  SELECT DISTINCT ON (sale_order_id)
    sale_order_id, numero
  FROM nfe_emitidas
  WHERE status = 'autorizada'
    AND numero IS NOT NULL
    AND TRIM(numero) <> ''
    AND sale_order_id IS NOT NULL
  ORDER BY sale_order_id, created_at DESC
)
UPDATE sale_orders so
SET nfe = lan.numero,
    updated_at = NOW()
FROM latest_authorized_nfe lan
WHERE so.id = lan.sale_order_id
  AND (so.nfe IS NULL OR TRIM(so.nfe) = '' OR so.nfe <> lan.numero);

-- ============================================================================
-- Comentário pra documentar a fonte de verdade
-- ============================================================================
COMMENT ON COLUMN public.sale_orders.nfe IS
  'Número da NF-e vinculada. Sincronizado automaticamente de nfe_emitidas.numero ' ||
  'quando status=autorizada via trigger tg_sync_nfe_numero_to_sale_order. Este ' ||
  'campo é lido pelas etiquetas de caixa externa (LabelProductionTab).';
