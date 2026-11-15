-- Já aplicada no cknb (15/11/2026) via MCP com o carimbo de calendário 20261115130126 (valida_cnpj_cpf_clientes_fornecedores).
-- Idempotente: pode ser reexecutada pelo workflow de migrations sem efeito adicional
-- (CREATE OR REPLACE, DROP TRIGGER IF EXISTS, GRANT/REVOKE determinísticos).
-- Validação de CNPJ/CPF (dígitos verificadores) e bloqueio de duplicidade em clients/suppliers.
-- Só age quando o documento é gravado ou alterado: registros antigos (inclusive a duplicata
-- existente PONTO MIX 32168100000118) continuam editáveis enquanto o documento não mudar.
CREATE OR REPLACE FUNCTION public.is_valid_cnpj(p_doc text)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $f$
DECLARE d text := regexp_replace(coalesce(p_doc,''), '\D', '', 'g');
  w1 int[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2]; w2 int[] := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; i int;
BEGIN
  IF length(d) <> 14 OR d ~ '^(\d)\1{13}$' THEN RETURN false; END IF;
  s := 0; FOR i IN 1..12 LOOP s := s + substr(d,i,1)::int * w1[i]; END LOOP;
  r := s % 11; r := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
  IF r <> substr(d,13,1)::int THEN RETURN false; END IF;
  s := 0; FOR i IN 1..13 LOOP s := s + substr(d,i,1)::int * w2[i]; END LOOP;
  r := s % 11; r := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
  RETURN r = substr(d,14,1)::int;
END $f$;

CREATE OR REPLACE FUNCTION public.is_valid_cpf(p_doc text)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $f$
DECLARE d text := regexp_replace(coalesce(p_doc,''), '\D', '', 'g'); s int; r int; i int;
BEGIN
  IF length(d) <> 11 OR d ~ '^(\d)\1{10}$' THEN RETURN false; END IF;
  s := 0; FOR i IN 1..9 LOOP s := s + substr(d,i,1)::int * (11 - i); END LOOP;
  r := (s * 10) % 11; IF r = 10 THEN r := 0; END IF;
  IF r <> substr(d,10,1)::int THEN RETURN false; END IF;
  s := 0; FOR i IN 1..10 LOOP s := s + substr(d,i,1)::int * (12 - i); END LOOP;
  r := (s * 10) % 11; IF r = 10 THEN r := 0; END IF;
  RETURN r = substr(d,11,1)::int;
END $f$;

CREATE OR REPLACE FUNCTION public.is_valid_cpf_cnpj(p_doc text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $f$
  SELECT CASE length(regexp_replace(coalesce(p_doc,''), '\D', '', 'g'))
           WHEN 14 THEN public.is_valid_cnpj(p_doc)
           WHEN 11 THEN public.is_valid_cpf(p_doc)
           ELSE false END
$f$;

CREATE OR REPLACE FUNCTION public.tg_validate_party_document()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE
  v_new text := regexp_replace(coalesce(NEW.cnpj,''), '\D', '', 'g');
  v_old text;
  v_dup_id uuid;
  v_dup_label text;
BEGIN
  IF v_new = '' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    v_old := regexp_replace(coalesce(OLD.cnpj,''), '\D', '', 'g');
    IF v_old = v_new THEN RETURN NEW; END IF;  -- documento não mudou: não bloqueia legado
  END IF;

  IF NOT public.is_valid_cpf_cnpj(v_new) THEN
    RAISE EXCEPTION 'CNPJ/CPF inválido: % (dígitos verificadores não conferem ou tamanho incorreto)', NEW.cnpj
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_TABLE_NAME = 'clients' THEN
    SELECT c.id, coalesce(c.razao_social, '') INTO v_dup_id, v_dup_label
      FROM public.clients c
     WHERE c.id <> NEW.id AND regexp_replace(coalesce(c.cnpj,''), '\D', '', 'g') = v_new
     LIMIT 1;
  ELSE
    SELECT s.id, coalesce(s.name, '') INTO v_dup_id, v_dup_label
      FROM public.suppliers s
     WHERE s.id <> NEW.id AND regexp_replace(coalesce(s.cnpj,''), '\D', '', 'g') = v_new
     LIMIT 1;
  END IF;

  IF v_dup_id IS NOT NULL THEN
    RAISE EXCEPTION 'CNPJ/CPF % já está cadastrado em outro registro (%)', NEW.cnpj, v_dup_label
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS trg_validate_client_document ON public.clients;
CREATE TRIGGER trg_validate_client_document BEFORE INSERT OR UPDATE OF cnpj ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_party_document();
DROP TRIGGER IF EXISTS trg_validate_supplier_document ON public.suppliers;
CREATE TRIGGER trg_validate_supplier_document BEFORE INSERT OR UPDATE OF cnpj ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_party_document();

REVOKE ALL ON FUNCTION public.tg_validate_party_document() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_valid_cnpj(text), public.is_valid_cpf(text), public.is_valid_cpf_cnpj(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_cnpj(text), public.is_valid_cpf(text), public.is_valid_cpf_cnpj(text) TO authenticated, service_role;
