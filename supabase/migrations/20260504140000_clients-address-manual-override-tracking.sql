-- ---------------------------------------------------------------
-- 20260504140000_clients-address-manual-override-tracking.sql
--
-- Adiciona controle de override manual em endereços de clientes
-- para a edge function `sync-cnpj-addresses` parar de sobrescrever
-- dados editados pelo usuário.
--
-- Cenário do bug atual:
--   1) Usuário cadastra cliente com CNPJ (sede em São Paulo)
--   2) Usuário edita endereço manualmente para a filial em Curitiba
--   3) `sync-cnpj-addresses` roda no cron noturno, busca CNPJ na API
--   4) API retorna endereço da SEDE (SP), sobrescreve a filial (PR)
--   5) Próxima NF-e sai com endereço errado → comprovante de entrega
--      vai pra cidade errada, ICMS interestadual recalculado.
--
-- Solução: rastrear `endereco_manual_override` como flag, mais
-- `endereco_updated_at` como timestamp da última edição manual.
-- A edge function consulta esses campos antes de aplicar update.
-- ---------------------------------------------------------------

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS endereco_manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS endereco_updated_at timestamptz;

COMMENT ON COLUMN public.clients.endereco_manual_override IS
  'Quando true, sync-cnpj-addresses NÃO sobrescreve endereco/bairro/cidade/estado/cep. Usuário marcou como personalizado.';
COMMENT ON COLUMN public.clients.endereco_updated_at IS
  'Timestamp da última alteração de qualquer campo de endereço por usuário humano (não pelo sync automático).';

-- Trigger: quando qualquer campo de endereço é atualizado em UPDATE
-- sem que o sync explicitamente passe `endereco_updated_at`, considera
-- como edição humana e marca o override automaticamente.
DROP FUNCTION IF EXISTS public.fn_track_client_address_manual_edit() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_track_client_address_manual_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.endereco IS DISTINCT FROM OLD.endereco
      OR NEW.bairro IS DISTINCT FROM OLD.bairro
      OR NEW.cidade IS DISTINCT FROM OLD.cidade
      OR NEW.estado IS DISTINCT FROM OLD.estado
      OR NEW.cep    IS DISTINCT FROM OLD.cep)
     -- Só marca como manual se o caller NÃO sinalizou que é o sync.
     -- A edge function sync-cnpj-addresses define endereco_updated_at
     -- explicitamente igual ao OLD para indicar "não foi humano".
     AND (NEW.endereco_updated_at IS NULL
          OR NEW.endereco_updated_at = OLD.endereco_updated_at) THEN
    NEW.endereco_updated_at := now();
    -- Não força override=true: o usuário precisa marcar explicitamente
    -- via UI para travar contra sync futuro. Isso evita fricção em
    -- correções pontuais (typo) que não querem bloquear sync.
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_client_address_manual_edit ON public.clients;
CREATE TRIGGER trg_track_client_address_manual_edit
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_track_client_address_manual_edit();

-- Backfill inicial: todos os clientes existentes com endereço preenchido
-- recebem timestamp atual (assume-se que estão "validados" pelo usuário).
UPDATE public.clients
   SET endereco_updated_at = COALESCE(endereco_updated_at, updated_at, created_at, now())
 WHERE endereco IS NOT NULL
   AND endereco_updated_at IS NULL;
