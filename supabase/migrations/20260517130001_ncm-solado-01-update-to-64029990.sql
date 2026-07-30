-- Atualiza NCM das fichas técnicas que usam o "solado 01" pra 64029990.
--
-- Contexto: o NCM correto pra calçado feminino com sola exterior e parte
-- superior de borracha/plástico (sem couro especificado) é 64029990 —
-- "Outros calçados, com sola exterior e parte superior de borracha ou
-- plásticos, outros, outros". As 10 fichas que usam solado 01 hoje estão
-- com NCMs misturados (64041900 = calçado de matéria têxtil + 64022000 =
-- com tira/correia) — solicitação Squad Shoes em 16/05/2026 pra padronizar.
--
-- Solado 01 = group_id 69c86aa8-57af-45e8-813f-19a1b50340d8.
-- Identificado via 3 critérios (qualquer um basta): sole_group_id,
-- primary_sole_id apontando pros 2 produtos do grupo (PRETO + CARAMELO),
-- ou linkagem em technical_sheet_sole_colors.
--
-- Aplicado via MCP também — esta migration registra a mudança no histórico
-- e permite reaplicar em ambientes novos.

UPDATE public.technical_sheets ts
   SET ncm = '64029990',
       updated_at = now()
 WHERE (ts.sole_group_id = '69c86aa8-57af-45e8-813f-19a1b50340d8'
        OR ts.primary_sole_id IN (
          '7056af4c-fa67-40d6-9394-0f29c7b37c0a',
          '07d82225-5f2e-48a9-afcc-9a61f6e1c10f'
        )
        OR ts.id IN (
          SELECT sheet_id FROM public.technical_sheet_sole_colors
           WHERE sole_product_id IN (
             '7056af4c-fa67-40d6-9394-0f29c7b37c0a',
             '07d82225-5f2e-48a9-afcc-9a61f6e1c10f'
           )
        ))
   AND COALESCE(ts.ncm, '') <> '64029990';
