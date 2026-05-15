-- Estende transporters com os campos fiscais (NF-e grupo X) e adiciona
-- modalidade de frete + transportador + veículo no PV.
-- A tabela transporters já existia pra logística (RouteOptimizer) — só
-- adicionamos os campos que faltavam pra alimentar o bloco transp da NF-e.

ALTER TABLE public.transporters
  ADD COLUMN IF NOT EXISTS nome_fantasia text,
  ADD COLUMN IF NOT EXISTS ie_isento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS endereco text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS bairro text,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS codigo_municipio text,
  ADD COLUMN IF NOT EXISTS rntrc text,
  ADD COLUMN IF NOT EXISTS gestaoclick_id text;

COMMENT ON COLUMN public.transporters.ie_isento IS 'Transportador isento de Inscrição Estadual.';
COMMENT ON COLUMN public.transporters.endereco IS 'Logradouro completo (NF-e xEnder).';
COMMENT ON COLUMN public.transporters.codigo_municipio IS 'Código IBGE do município (NF-e cMun).';
COMMENT ON COLUMN public.transporters.rntrc IS 'Reg. Nac. Trans. Carga (ANTT) — NF-e tag RNTC.';

CREATE INDEX IF NOT EXISTS idx_transporters_active_lower_name
  ON public.transporters(active, lower(name)) WHERE active = true;

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS modalidade_frete smallint NOT NULL DEFAULT 9
    CHECK (modalidade_frete IN (0, 1, 2, 3, 4, 9));
COMMENT ON COLUMN public.sale_orders.modalidade_frete IS
  'NF-e tag modFrete: 0=Emitente(CIF), 1=Destinatario(FOB), 2=Terceiros, 3=Proprio por conta do remetente, 4=Proprio por conta do destinatario, 9=Sem transporte. Default 9.';

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS transporter_id uuid REFERENCES public.transporters(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.sale_orders.transporter_id IS
  'Transportador da NF-e quando modalidade_frete in (0,1,2). Pra 3/4 o transportador e o emitente/destinatario (preenchido inline pelo emit-nfe).';

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS vehicle_plate text;
COMMENT ON COLUMN public.sale_orders.vehicle_plate IS
  'Placa do veiculo (NF-e tag veicTransp/placa) — opcional.';

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS vehicle_uf text;
COMMENT ON COLUMN public.sale_orders.vehicle_uf IS
  'UF do veiculo (NF-e tag veicTransp/UF) — opcional.';

CREATE INDEX IF NOT EXISTS idx_sale_orders_transporter ON public.sale_orders(transporter_id) WHERE transporter_id IS NOT NULL;
