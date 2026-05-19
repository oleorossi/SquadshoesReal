-- Dados obrigatórios pra Espelho de Ponto Eletrônico (Portaria MTE 671/2021)
-- e AEJ (Arquivo Eletrônico de Jornada).
--
-- 1. employees.cpf — obrigatório no espelho/AEJ (art. 84, II + layout AEJ).
--    Nullable porque histórico de funcionários antigos pode não ter — UI
--    valida na criação nova; backfill manual por gestor depois.
--
-- 2. company_settings — tabela singleton com identificação do empregador
--    (CNPJ/CPF/CEI/CAEPF/CNO) + razão social. Necessária no cabeçalho do
--    espelho e nos registros tipo "1" e "2" do AEJ. RLS aberto pra
--    authenticated (qualquer logado vê + admin edita).

-- ── 1. CPF no employees ────────────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS cpf text NULL;

COMMENT ON COLUMN public.employees.cpf IS
  'CPF do funcionario (11 digitos sem mascara). Obrigatorio no Espelho de Ponto e AEJ (Portaria 671/2021). Nullable pra retro-compat — backfill manual.';

-- Sem unique constraint global: mesmo CPF pode aparecer em rows historicos
-- (funcionario demitido e recontratado = 2 rows). Validacao de duplicata
-- ativa fica no frontend / UPSERT.
CREATE INDEX IF NOT EXISTS idx_employees_cpf ON public.employees(cpf) WHERE cpf IS NOT NULL;

-- ── 2. company_settings (singleton) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social    text NOT NULL,
  nome_fantasia   text,
  cnpj            text,
  cpf             text,                            -- pra MEI
  cei             text,                            -- Cadastro Especifico do INSS
  caepf           text,                            -- Cadastro de Atividade Economica de PF
  cno             text,                            -- Cadastro Nacional de Obra
  endereco        text,
  cep             text,
  cidade          text,
  uf              text,
  telefone        text,
  email           text,
  is_default      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_identifier CHECK (cnpj IS NOT NULL OR cpf IS NOT NULL OR cei IS NOT NULL OR caepf IS NOT NULL OR cno IS NOT NULL)
);

-- Garante singleton: só pode existir 1 row is_default=true (modelo
-- multi-empresa fica pra futuro — por ora um empregador por instalacao).
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_settings_default
  ON public.company_settings(is_default)
  WHERE is_default = true;

CREATE OR REPLACE FUNCTION public.tg_company_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS company_settings_updated_at ON public.company_settings;
CREATE TRIGGER company_settings_updated_at BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_company_settings_updated_at();

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_settings_select ON public.company_settings;
CREATE POLICY company_settings_select ON public.company_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS company_settings_insert ON public.company_settings;
CREATE POLICY company_settings_insert ON public.company_settings
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS company_settings_update ON public.company_settings;
CREATE POLICY company_settings_update ON public.company_settings
  FOR UPDATE TO authenticated USING (true);

-- Seed inicial — CNPJ placeholder (gestor edita em /settings → Empresa)
INSERT INTO public.company_settings (razao_social, nome_fantasia, cnpj, is_default)
SELECT 'Squad Shoes', 'Squad Shoes', '00000000000000', true
WHERE NOT EXISTS (SELECT 1 FROM public.company_settings WHERE is_default = true);
