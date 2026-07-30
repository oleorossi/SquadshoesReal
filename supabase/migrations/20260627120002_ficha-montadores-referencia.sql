-- Ficha de Montadores: seleção de REFERÊNCIA (ficha técnica) no lugar de solado.
-- Pedido do dono (2026-06-27): o montador monta uma REFERÊNCIA, não um solado.
-- solado_id tem FK pra products, então a referência não cabe lá. Colunas novas:
--   referencia    (text)  — rótulo exibido/impresso (nome/código da ref)
--   reference_id  (uuid)  — FK technical_sheets (repopula o select na edição)
-- solado/solado_id ficam como LEGADO (fichas antigas continuam exibindo). Idempotente.
alter table public.ficha_montadores
  add column if not exists referencia text,
  add column if not exists reference_id uuid references public.technical_sheets(id) on delete set null;
