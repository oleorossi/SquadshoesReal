-- Adiciona colunas pra identificar o destinatário direto na NF-e
-- Sem precisar de JOIN com sale_orders, que pode estar NULL pra NFs antigas
-- sincronizadas do GestaoClick (emitidas fora do nosso sistema).

alter table public.nfe_emitidas
  add column if not exists nome_destinatario text,
  add column if not exists cnpj_destinatario text;

comment on column public.nfe_emitidas.nome_destinatario is
  'Nome/razão social do destinatário, gravado no momento da emissão ou da sincronização. Permite identificar a NF mesmo quando sale_order_id é NULL.';
comment on column public.nfe_emitidas.cnpj_destinatario is
  'CNPJ ou CPF do destinatário (apenas dígitos). Usado pra UI e busca quando não há sale_order vinculado.';

-- Index leve pra busca por destinatário (usado pela busca livre da listagem)
create index if not exists idx_nfe_emitidas_cnpj_destinatario
  on public.nfe_emitidas (cnpj_destinatario)
  where cnpj_destinatario is not null;
