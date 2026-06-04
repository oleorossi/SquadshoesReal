-- Drop NOT NULL constraint on products.max_stock / min_stock.
--
-- Os campos "Estoque máximo" e "Estoque mínimo" foram removidos da UI de
-- edição completa de variante (MasterVariantDialog → VariantDetailSheet) em
-- mai/2026 — ver comentário em src/components/inventory/MasterVariantDialog.tsx:231
-- ("nunca usado em business logic"). O schema continuava exigindo NOT NULL,
-- então quando o form local não tinha o campo no useState (caminho que abre
-- o sheet sem passar pelo useEffect ou produto sem o campo no objeto carregado)
-- o spread `{ ...form }` mandava null/undefined no UPDATE e o DB rejeitava com:
--
--   null value in column "max_stock" of relation "products" violates not-null constraint
--
-- DEFAULT 0 fica preservado pra fluxos que ainda inserem com valor (planejamento
-- de compras, batch create de cor, criar produto via PV, etc). Campo continua
-- existindo — só perde o NOT NULL.

ALTER TABLE public.products
  ALTER COLUMN max_stock DROP NOT NULL;

ALTER TABLE public.products
  ALTER COLUMN min_stock DROP NOT NULL;
