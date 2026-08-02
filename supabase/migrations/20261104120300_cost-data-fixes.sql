-- ============================================================================
-- Correções de CADASTRO que faziam o custo sair errado (decisões do dono,
-- 03/08/2026). São dados, não regra — por isso cada UPDATE é guardado por uma
-- condição que o torna idempotente e o impede de sobrescrever um valor que já
-- tenha sido revisado depois.
-- ============================================================================

-- 1. Solado INFANTIL / CARAMELO estava com unit_price = 0 e entrava de graça em
--    108 linhas de custo desde 11/07/2026. O irmão de grupo (INFANTIL / PRETO)
--    custa R$ 2,60 — mesmo modelo, outra cor. Decisão do dono: copiar o preço.
--    (O SKU "121321312" é lixo de digitação; fica registrado aqui, mas mexer em
--    SKU é outro assunto — não entra nesta migration.)
UPDATE public.products p
   SET unit_price = 2.60
 WHERE p.name = 'INFANTIL'
   AND p.color = 'CARAMELO'
   AND COALESCE(p.unit_price, 0) = 0
   AND EXISTS (
     SELECT 1 FROM public.products irmao
      WHERE irmao.group_id = p.group_id
        AND irmao.color = 'PRETO'
        AND irmao.unit_price = 2.60);

-- 2. CAIXA COLMEIA 11: o preço de R$ 5,50 estava defasado. Valor real informado
--    pelo dono: R$ 6,90 a caixa, 12 pares por caixa → R$ 0,575/par.
--    A quantidade no BOM já está em 0,083 un/par (≈12,05 pares/caixa) em 14
--    fichas, então só o preço muda — nada de dupla contagem com a política,
--    que segue em packaging_cost_per_pair = 0 de propósito: a embalagem é
--    modelada pelo BOM porque já respeita colmeia × fitilho via
--    filter_caixa_by_packaging_mode().
UPDATE public.products
   SET unit_price = 6.90
 WHERE name = 'CAIXA COLMEIA 11'
   AND unit_price = 5.50;

-- 3. Ficha CF 09: upper_consumption = 20 unidades de Elástico 30mm por par,
--    contra 0,68 na CF 03 — mesmo material, mesma família. É erro de digitação
--    (alguém pôs 20 num campo que recebe consumo por par).
--    ⚠ Consumo de ficha manda em COMPRA, RESERVA e DÉBITO, não só em custo:
--    esta correção muda o planejamento desse modelo, por decisão explícita do
--    dono em 03/08/2026.
UPDATE public.technical_sheets
   SET upper_consumption = 0.68
 WHERE name ILIKE 'CF 09%'
   AND upper_consumption = 20;
