-- =============================================================================
-- box_types.supplier_id ganha FOREIGN KEY → suppliers.id
-- =============================================================================
--
-- 🔴 Sintoma reportado pelo usuário (18/05/2026):
--    "Falha ao carregar 'box_types_stock': Could not find a relationship
--    between 'box_types' and 'supplier_id' in the schema cache"
--
-- 🕵️ Causa raiz: a coluna box_types.supplier_id existia (uuid nullable)
--    mas NUNCA teve FOREIGN KEY declarada apontando pra suppliers(id).
--    O hook usePackaging.ts e PackagingStockPanel fazem
--      select('*, suppliers:supplier_id(id, name)')
--    e o PostgREST exige FK formal no schema cache pra resolver o embed.
--    Sem a FK, o cache vê os 2 nomes e levanta o erro acima.
--
-- ✅ Fix: declara a FK com ON DELETE SET NULL (apaga supplier não cancela
--    a box_type, só desvincula) + cria index parcial pra performance do
--    JOIN + NOTIFY pgrst pra forçar reload do schema cache.
--
-- Validação prévia (18/05/2026): 0 box_types.supplier_id órfãos,
-- então a ADD CONSTRAINT é seguro.
-- =============================================================================

ALTER TABLE public.box_types
  ADD CONSTRAINT box_types_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_box_types_supplier_id
  ON public.box_types(supplier_id) WHERE supplier_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
