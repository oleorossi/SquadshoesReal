-- ============================================================================
-- Correções de DADOS em produção — auditoria dos 10 PVs (D1..D4)
--
-- Esta migration NÃO muda esquema nem lógica: ela corrige LINHAS já gravadas
-- que ficaram erradas por bugs já consertados no código. Toda alteração deixa
-- rastro textual com prefixo '[SISTEMA]' e é IDEMPOTENTE (o guard de cada
-- bloco é a própria condição de "ainda está errado", então reaplicar é no-op).
--
-- Escopo (aprovado explicitamente pelo usuário):
--   D1  cancelar 6 OCs duplicadas de solado (OC-00176..OC-00181)
--   D2  corrigir OC-00030 (QUIMICOLLA) — resíduo do bug de auto-OC de 15/05
--   D3  limpar linhas de solado sem lastro em OC-00091 / OC-00094 / OC-00095
--       (+ D3.4: aviso de recompra na OC-00095, único item cuja remoção deixa
--        demanda viva descoberta — 72 par de 180 SALTO BLOCO PRETO)
--   D4  reconciliar material_reservations.quantity_consumed com o débito real
--
-- Nada além disso. Nenhuma outra OC, OP, reserva ou produto é tocado.
--
-- ── Convenção de rastro ─────────────────────────────────────────────────────
-- purchase_orders.notes ganha uma linha nova com prefixo '[SISTEMA]' + data +
-- motivo (mesmo padrão de OC-00029/OC-00031, canceladas em 29/05/2026).
-- material_reservations.notes ganha o antes→depois da reconciliação.
-- purchase_order_items NÃO tem coluna de notas — por isso o que sai de uma OC
-- é registrado na nota da OC-mãe, item a item.
--
-- ── Como aplicar ────────────────────────────────────────────────────────────
-- Rodar o arquivo INTEIRO de uma vez, dentro de UMA transação — o bloco DO do
-- fim levanta EXCEPTION se qualquer pós-condição falhar e aborta tudo. Não há
-- BEGIN/COMMIT explícito aqui de propósito: `supabase db push` (e o MCP) já
-- envolvem a migration em transação, e um COMMIT no meio encerraria a
-- transação externa cedo demais. Não quebrar o arquivo em pedaços.
--
-- ── Sobre a data '2026-09-25' nas notas ─────────────────────────────────────
-- A data é literal e casada com o timestamp do arquivo (e com a migration irmã
-- 20260925120000). Ela também é o GUARD de idempotência dos blocos D2.3, D3.2 e
-- D3.4 (LIKE '%[SISTEMA] 2026-09-25: …%'). Se for trocada, trocar em TODAS as
-- ocorrências — trocar só no texto faria a nota duplicar em cada reaplicação.
-- ============================================================================


-- ============================================================================
-- D1 — CANCELAR AS 6 OCs DUPLICADAS DE SOLADO '01' CARAMELO
--
-- CONTEXTO
--   OC-00176..OC-00181 (criadas 10/07 e 11/07/2026, todas `pending`) compram
--   780 + 1.248 + 780 + 780 + 1.248 + 780 = 5.616 pares do produto
--   07d82225-5f2e-48a9-afcc-9a61f6e1c10f (SOLADO 01, cor CARAMELO), todas
--   vinculadas ao PV-00146 (6f59fd75-…).
--
-- CAUSA
--   O gatilho "Solado insuficiente para OP" gerou uma OC por OP, em DOIS lotes
--   (10/07 → OP-2026-01152/01153/01154; 11/07 → OP-2026-01155/01156/01157),
--   sem idempotência. As OPs citadas nas notas NÃO existem mais em `orders`
--   (SELECT count(*) = 0) — foram substituídas pelas OPs reais do PV-00146:
--     OP-2026-01167 (1.248 par) + OP-2026-01168 (780) + OP-2026-01169 (780)
--     = 2.808 pares  →  exatamente METADE dos 5.616 comprados.
--   O PV-00146 está `Faturado` e essas 3 OPs estão `Finalizado`; as outras 3
--   (01164/01165/01166) estão `Cancelada`. Ou seja: a demanda já foi atendida
--   e as 6 OCs viraram compra em dobro de material que não é mais necessário.
--
-- ✔ CHECAGEM DE COBERTURA (revisão adversarial, SELECT em 2026-09-25)
--   Cancelar as 6 NÃO desabastece o produto 07d82225 (SOLADO 01 CARAMELO), que
--   hoje está com `quantity = 0`:
--     demanda VIVA (material_reservations 'reserved', kind sole_grade) .. 2.796 par
--       PV-00147 (OP-2026-01190..01196, Em Produção) ................... 2.304 par
--       PV-00148 (OP-2026-01197..01208, Reservado) .....................   492 par
--     compra que SOBRA depois desta migration ......................... 2.808 par
--       OC-00094, linha '01 CARAMELO' — preservada de propósito no bloco D3.
--   2.808 ≥ 2.796 → a carteira viva continua coberta. (É também a razão de o
--   bloco D3 NÃO mexer na quantidade dessa linha, ver lá.)
--
-- O QUE MUDA
--   status → 'cancelled', cancelled_at → now(), nota '[SISTEMA]' anexada.
--   `approval_status` NÃO é tocado — o precedente (OC-00029/OC-00031) manteve
--   'pendente_aprovacao', e mudar isso mexeria na trilha de alçada.
--   Os itens NÃO são apagados: a OC cancelada preserva o que se tentou comprar.
--
-- GUARD
--   Só toca OCs que ainda não estão canceladas (status <> 'cancelled').
-- ============================================================================
UPDATE public.purchase_orders po
   SET status       = 'cancelled',
       cancelled_at = COALESCE(po.cancelled_at, now()),
       notes        = COALESCE(po.notes || E'\n', '') ||
                      '[SISTEMA] 2026-09-25: OC cancelada por duplicidade — auto-OC de solado sem '
                      'idempotência gerou 5.616 par de SOLADO 01 CARAMELO para o PV-00146, que precisa '
                      'de 2.808 par (OP-2026-01167/01168/01169, já finalizadas; PV Faturado). As OPs '
                      'citadas na nota original (OP-2026-01152..01157) não existem mais em orders. '
                      'Recriar manualmente se necessário.'
 WHERE po.order_number IN ('OC-00176','OC-00177','OC-00178','OC-00179','OC-00180','OC-00181')
   AND po.status <> 'cancelled';


-- ============================================================================
-- D2 — CORRIGIR OC-00030 (QUIMICOLLA, pending)
--
-- CONTEXTO
--   OC-00030 nasceu em 15/05/2026 07:53 no mesmo lote de OC-00029 e OC-00031,
--   que foram canceladas em 29/05/2026 com a nota
--   '[SISTEMA] OC cancelada por qty inflada por bug de auto-OC sem idempotência'.
--   A OC-00030 escapou da limpeza. Hoje ela está vinculada a
--   linked_sale_order_ids = { PV-00141 (49d84386…), PV-00148 (8c472591…) }.
--
-- ── ITEM 1: COLA PVC (66b39bc6-fa22-4b10-bc82-19cb49ed44d2) ─────────────────
--   Quantidade gravada: 1.205,0144 — inflada pelo bug.
--
--   NECESSIDADE REAL = compromisso ainda ABERTO que o estoque não cobre
--   (números apurados por SELECT em 2026-09-25):
--
--   (a) Compromisso aberto = material_reservations ativas ('reserved' /
--       'partially_consumed') do produto, que é exatamente o que o ERP mantém
--       espelhado em products.reserved_stock (drift = 0, conferido linha a linha):
--         PV-00147 (OP-2026-01190..01196, Em Produção) .....  53,75232 kg
--         PV-00148 (OP-2026-01197..01208, Reservado) .......  12,31824 kg
--         ---------------------------------------------------------------
--         TOTAL ABERTO .....................................  66,07056 kg
--
--   (b) Estoque físico: products.quantity = 0,00000 kg
--       (única OC viva desse produto é esta; a outra, OC-00018, está cancelada
--        — ou seja, não há compra em trânsito cobrindo nada.)
--
--   (c) Necessidade = 66,07056 − 0 = 66,07056 kg
--       min_stock (12 kg) é PISO, não parcela: 66,07 > 12, não altera nada.
--
--   QUANTIDADE FINAL GRAVADA: 66,07056 kg  (era 1.205,0144 → −94,5%)
--
--   ⚠ POR QUE **NÃO** 138,5802 (correção da revisão adversarial)
--     A primeira versão deste bloco usava "consumo das OPs vivas − disponível
--     líquido" = 72,50964 − (0 − 66,07056) = 138,58020 kg. Esse número conta o
--     mesmo material DUAS vezes e por isso foi descartado:
--       • PV-00148 entra no consumo (12,31824) E já está dentro do
--         reserved_stock (66,07056) → contado 2×;
--       • PV-00141 (60,19140) entra no consumo mas as 7 OPs estão Finalizado e
--         o PV Faturado: esse consumo JÁ ACONTECEU e já está refletido no
--         estoque zerado → comprar de novo é compra fantasma.
--     O próprio código do projeto reconhece esse duplo-cômputo: tanto o SQL
--     (`compute_materials_per_pv` / `get_wave_material_needs_core`, CTE
--     own_reserved) quanto o front (`PurchasePlanningWizard.tsx`, mapa
--     `ownReservedByProduct`) DEVOLVEM as reservas das próprias OPs antes de
--     netar contra o estoque, "senão contava o material 2× (demanda + reserva)".
--     Aplicando essa mesma regra aqui sobra exatamente 66,07056 kg.
--     Recorte alternativo, se o usuário quiser comprar só para os PVs
--     vinculados a ESTA OC (PV-00141 já rodou, então sobra só o PV-00148):
--     12,31824 kg — mas aí o PV-00147 (53,75 kg reservados contra estoque 0)
--     fica descoberto e sem nenhuma outra OC aberta para cobri-lo.
--
-- ── ITEM 2: COLA FORTE (fbbe0f31-90f9-4685-9f7c-fae261617db0) ───────────────
--   Necessidade  0,77700 kg
--   Estoque      30,88040 kg  (reserved_stock 0,70800 → disponível 30,17240)
--   min_stock    1 kg
--   → sobra 39× a necessidade; comprar 17 un é puro resíduo do bug.
--   → LINHA REMOVIDA (não zerada: item com quantity 0 polui a OC e o
--     recebimento). Nada foi recebido nela (received_quantity = 0).
--
-- ── total_value ────────────────────────────────────────────────────────────
--   Recalculado de SUM(quantity × unit_price) dos itens restantes
--   (fórmula confirmada por conferência nas 4 OCs desta migration).
--   21.993,37 → ~1.188,92  (66,07056 × 17,994642857142857).
--
-- ⚠ FORA DE ESCOPO (não corrigido aqui, de propósito): o item COLA PVC está
--   gravado com `unit = 'un'` embora products.unit seja 'kg'. A migration irmã
--   20260925132000 (B7.1) documenta por que não entrou no sweep de unidades.
--   Se esta OC for recebida por importação de NF, `convertNfToStockUnit` pode
--   se confundir — vale uma migration própria.
--
-- GUARD
--   Cada statement só atua se o valor ainda estiver errado.
-- ============================================================================

-- D2.1 — COLA PVC: 1.205,0144 → 66,07056
UPDATE public.purchase_order_items poi
   SET quantity           = 66.07056,
       suggested_quantity = 66.07056
  FROM public.purchase_orders po
 WHERE po.id = poi.purchase_order_id
   AND po.order_number = 'OC-00030'
   AND poi.product_id  = '66b39bc6-fa22-4b10-bc82-19cb49ed44d2'::uuid
   AND poi.quantity IS DISTINCT FROM 66.07056;

-- D2.2 — COLA FORTE: linha removida
DELETE FROM public.purchase_order_items poi
 USING public.purchase_orders po
 WHERE po.id = poi.purchase_order_id
   AND po.order_number = 'OC-00030'
   AND poi.product_id  = 'fbbe0f31-90f9-4685-9f7c-fae261617db0'::uuid;

-- D2.3 — nota de rastro na OC
UPDATE public.purchase_orders po
   SET notes = COALESCE(po.notes || E'\n', '') ||
               '[SISTEMA] 2026-09-25: OC corrigida (resíduo do bug de auto-OC sem idempotência de '
               '15/05/2026, mesmo lote de OC-00029/OC-00031). COLA PVC 1.205,0144 -> 66,07056 kg '
               '= reserva ATIVA descoberta (PV-00147 53,75232 + PV-00148 12,31824) contra estoque '
               'zero. O consumo do PV-00141 (60,19 kg) NAO entra: as 7 OPs estao Finalizado e o PV '
               'Faturado, esse consumo ja ocorreu. Item COLA FORTE removido: necessidade 0,777 kg '
               'contra 30,8804 kg em estoque. total_value recalculado a partir dos itens restantes.'
 WHERE po.order_number = 'OC-00030'
   AND COALESCE(po.notes, '') NOT LIKE '%[SISTEMA] 2026-09-25: OC corrigida%';


-- ============================================================================
-- D3 — LIMPAR LINHAS DE SOLADO SEM LASTRO EM OC-00091 / OC-00094 / OC-00095
--
-- CONTEXTO
--   Em 05/07/2026 11:40 (mesmo minuto da criação do PV-00146, 11:40:52) a
--   cascata legada de resolução de solado carimbou a MESMA grade de demanda do
--   PV-00146 — 2.808 par {34:234, 35:468, 36:468, 37:702, 38:468, 39:234,
--   40:234} — dentro de OCs antigas e de OUTROS PVs, replicada em 5 modelos de
--   solado diferentes. As três OCs têm updated_at exatamente nesse minuto.
--
-- VALIDAÇÃO (SELECT, 2026-09-25) — quem realmente consome solado:
--   PV-00142 (5f7da4bb…) → OP-2026-00968 (ref BT02) e OP-2026-00969 (ref BT01).
--     calculate_order_consumption_by_grade dessas 2 OPs NÃO retorna nenhuma
--     linha de componente 'Solado'. Só devolve:
--       Cabedal "Suede EVA + Cacharrel - Preto", Componente Direto
--       "Ilhós 51 - Ouro" e o acessório "NAPA ONÇA".
--     → NENHUM solado tem lastro em PVs cujo único vínculo é o PV-00142.
--   PV-00141 (49d84386…) → 7 OPs, todas consomem componente 'Solado' do
--     grupo SOLADO 01:
--       07d82225 (01 / CARAMELO) em 01125+01126+01127+01128+01130+01131
--                                  = 360+444+396+420+180+420 = 2.220 par
--       7056af4c (01 / PRETO)    em 01129 = 360 par
--
-- REGRA APLICADA
--   Remove a linha cujo MODELO de solado nenhuma OP dos PVs vinculados àquela
--   OC consome. Mantém a linha legítima. OC que fica sem item é cancelada com
--   o mesmo padrão de D1.
--
-- ITEM A ITEM
--   OC-00091 (suggested; vinculada só ao PV-00142) — total 33.907,00
--     ✗ 204 CARAMELO (3825976c) 2.208 par × R$ 3,50 = 7.728,00 — sem lastro
--     ✗ 204 PRETO    (8737389e)   362 par × R$ 3,50 = 1.267,00 — sem lastro
--     ✗ 238 PRETO    (23a1cfb8)   360 un  × R$ 9,00 = 3.240,00 — sem lastro
--     ✗ 238 CARAMELO (ed44dd78) 2.408 par × R$ 9,00 = 21.672,00 — sem lastro
--     → OC fica VAZIA → cancelada. total_value 33.907,00 → 0,00.
--
--   OC-00094 (pending; vinculada ao PV-00141 e ao PV-00142) — total 15.356,80
--     ✓ 01 PRETO    (7056af4c) 1.432 un × R$ 1,90 = 2.720,80 — MANTIDA
--         (PV-00141 / OP-2026-01129 consome esse produto)
--     ✓ 01 CARAMELO (07d82225) 2.808 par × R$ 1,90 = 5.335,20 — MANTIDA
--         (a QUANTIDADE 2.808 é a grade do PV-00146 e nasceu do mesmo carimbo,
--          mas a regra desta migration é por MODELO, não por qty — e a revisão
--          adversarial confirmou que NÃO se deve reduzi-la: o produto está com
--          quantity = 0 e tem 2.796 par de reserva VIVA (PV-00147 2.304 +
--          PV-00148 492). Depois do bloco D1 esta é a ÚNICA compra aberta do
--          item; 2.808 ≥ 2.796 cobre a carteira na medida.)
--     ✗ INFANTIL CARAMELO (206eced8) 2.808 par × R$ 2,60 = 7.300,80 — sem lastro
--     ✗ INFANTIL PRETO    (14b96bf7) 2.808 par × R$ 0,00 =     0,00 — sem lastro
--         (nenhuma OP de PV-00141/PV-00142 consome SOLADO INFANTIL)
--     → OC continua com 2 itens. total_value 15.356,80 → 8.056,00.
--
--   OC-00095 (pending; vinculada só ao PV-00142) — total 11.088,00
--     ✗ 180 SALTO BLOCO PRETO (5e6717d5) 3.168 un × R$ 3,50 = 11.088,00
--         — sem lastro (nenhuma OP consome SALTINHO BLOCO)
--     → OC fica VAZIA → cancelada. total_value 11.088,00 → 0,00.
--
-- ⚠ PENDÊNCIA GERADA (revisão adversarial) — só neste item
--   O 5e6717d5 (180 SALTO BLOCO / PRETO) está com quantity = 0 e tem 72 par de
--   reserva VIVA, de PVs ANTIGOS que nada têm a ver com o PV-00142:
--     PV-2026-00083 (OP-00818, OP-00823)   ....... 24 par
--     PV-2026-00092 (OP-2026-00751, 00755) ....... 24 par
--     PV-2026-00093 (OP-2026-00742, 00746) ....... 24 par
--   Ou seja: os 3.168 par eram carimbo do bug, mas apagá-los deixa 72 par de
--   demanda real sem nenhuma compra aberta. A migration NÃO cria OC (fora do
--   escopo aprovado) — ela grava o aviso na nota da OC (D3.4) para que Compras
--   recompre 72 par manualmente. Os demais produtos removidos (204 e 238, nas
--   duas cores, e SOLADO INFANTIL) têm reserva viva = 0, então saem sem deixar
--   pendência.
--
-- SEGURANÇA
--   Nenhum dos itens removidos foi recebido (received_quantity = 0,
--   received_at IS NULL) e nenhuma tabela referencia purchase_order_items
--   (conferido em pg_constraint: não existe FK apontando para ela), então o
--   DELETE não deixa órfão.
--
-- ⚠ EFEITO COLATERAL ACEITO: todo UPDATE em purchase_orders dispara
--   `trg_purchase_orders_updated`, que reescreve `updated_at`. O carimbo de
--   05/07/2026 11:40 citado acima — a evidência forense do bug — se perde nas
--   3 OCs depois desta migration. Ele está preservado por escrito aqui.
-- ============================================================================

-- D3.1 — remover as linhas sem lastro (product_id explícito por OC)
DELETE FROM public.purchase_order_items poi
 USING public.purchase_orders po
 WHERE po.id = poi.purchase_order_id
   AND (
        (po.order_number = 'OC-00091' AND poi.product_id IN (
           '3825976c-e6bb-4f37-997d-be91accbe061'::uuid,  -- 204 CARAMELO
           '8737389e-0e90-43f9-9bba-f87ca8ec545c'::uuid,  -- 204 PRETO
           '23a1cfb8-0f21-4ba0-afd3-81181e84c672'::uuid,  -- 238 PRETO
           'ed44dd78-46b0-4a68-9d80-03d75f4b4ba7'::uuid   -- 238 CARAMELO
        ))
     OR (po.order_number = 'OC-00094' AND poi.product_id IN (
           '206eced8-8eb0-44bc-b376-148670f32419'::uuid,  -- INFANTIL CARAMELO
           '14b96bf7-a96b-4b4f-8b37-217eb4d7cfd3'::uuid   -- INFANTIL PRETO
        ))
     OR (po.order_number = 'OC-00095' AND poi.product_id IN (
           '5e6717d5-c658-4c73-9eee-3492ddb25f1e'::uuid   -- 180 SALTO BLOCO PRETO
        ))
   );

-- D3.2 — nota de rastro nas 3 OCs
UPDATE public.purchase_orders po
   SET notes = COALESCE(po.notes || E'\n', '') ||
               '[SISTEMA] 2026-09-25: linhas de solado sem lastro removidas — a cascata legada de '
               'resolução de solado (05/07/2026 11:40) replicou a grade de 2.808 par do PV-00146 '
               '(grupo SOLADO 01) em 5 modelos. Nenhuma OP dos PVs vinculados a esta OC consome os '
               'modelos removidos (PV-00142 / OP-2026-00968 e 00969, refs BT01/BT02, não consomem '
               'solado algum). total_value recalculado a partir dos itens restantes.'
 WHERE po.order_number IN ('OC-00091','OC-00094','OC-00095')
   AND COALESCE(po.notes, '') NOT LIKE '%[SISTEMA] 2026-09-25: linhas de solado sem lastro removidas%';

-- D3.3 — cancelar as OCs que ficaram sem item (OC-00091 e OC-00095)
UPDATE public.purchase_orders po
   SET status       = 'cancelled',
       cancelled_at = COALESCE(po.cancelled_at, now()),
       notes        = COALESCE(po.notes || E'\n', '') ||
                      '[SISTEMA] 2026-09-25: OC cancelada por ficar sem itens após a limpeza acima. '
                      'Recriar manualmente se necessário.'
 WHERE po.order_number IN ('OC-00091','OC-00094','OC-00095')
   AND po.status <> 'cancelled'
   AND NOT EXISTS (SELECT 1 FROM public.purchase_order_items i WHERE i.purchase_order_id = po.id);

-- D3.4 — aviso de RECOMPRA na OC-00095 (a única remoção que deixa demanda viva
--        descoberta: 72 par de 180 SALTO BLOCO PRETO, ver comentário acima).
UPDATE public.purchase_orders po
   SET notes = COALESCE(po.notes || E'\n', '') ||
               '[SISTEMA] 2026-09-25: ATENCAO COMPRAS — os 3.168 par removidos eram carimbo do bug, '
               'mas o produto 180 SALTO BLOCO / PRETO esta com estoque 0 e 72 par de reserva VIVA '
               '(PV-2026-00083 24 + PV-2026-00092 24 + PV-2026-00093 24). Recomprar 72 par em OC nova.'
 WHERE po.order_number = 'OC-00095'
   AND COALESCE(po.notes, '') NOT LIKE '%[SISTEMA] 2026-09-25: ATENCAO COMPRAS%';


-- ============================================================================
-- D2/D3 — RECÁLCULO DE total_value DAS 4 OCs TOCADAS
--   total_value = SUM(quantity × unit_price) dos itens restantes (0 se vazia).
--   Fórmula conferida contra os valores gravados antes desta migration:
--     OC-00030 21.993,37 | OC-00091 33.907,00 | OC-00094 15.356,80
--     OC-00095 11.088,00 — todos batem exatamente.
-- ============================================================================
UPDATE public.purchase_orders po
   SET total_value = calc.v
  FROM (
        SELECT p.id,
               COALESCE((SELECT SUM(i.quantity * i.unit_price)
                           FROM public.purchase_order_items i
                          WHERE i.purchase_order_id = p.id), 0) AS v
          FROM public.purchase_orders p
         WHERE p.order_number IN ('OC-00030','OC-00091','OC-00094','OC-00095')
       ) calc
 WHERE po.id = calc.id
   AND po.total_value IS DISTINCT FROM calc.v;


-- ============================================================================
-- D4 — RECONCILIAR O LEDGER DE RESERVAS (bug DEB-1/RES-2)
--
-- CONTEXTO
--   A versão ANTIGA de convert_reservation_to_out gravava
--   material_reservations.quantity_consumed com a necessidade CHEIA, mesmo
--   quando o débito físico em stock_movements era capado pelo estoque
--   disponível (ou era zero). A função VIVA já está correta (debita
--   LEAST(reserva, estoque), grava consumed = débito real e abre linha
--   shortfall 'reserved' com metadata partial_pending) — o fix foi
--   prospectivo e o backfill dos dados históricos nunca foi feito.
--
-- SUPERFÍCIE (apurada por SELECT em 2026-09-25, escopo = OPs dos 10 PVs
-- auditados; agregando por par OP × produto):
--   20 pares divergentes, 40 linhas de material_reservations, todos com
--   consumed > debitado. Amostra:
--     OP-2026-00999 Tira Overlock 5mm: NUDE .. 1.152,000 → 1,000 m
--     OP-2026-01128 PLACA 1.0 EVA 3.0 ....... 1.965,600 → 76,040 dm²
--     OP-2026-01131 PLACA 1.0 EVA 3.0 ....... 1.965,600 → 0,000 dm²
--     OP-2026-01131 Tira Overlock 5mm: NUDE . 1.344,000 → 0,000 m (6 linhas)
--     OP-2026-01077 CAIXA INDIVIDUAL 11 ..... 1.104,000 → 178,000 un
--   Distribuição por PV: PV-00140 (7), PV-00141 (10), PV-00144 (3).
--   Efeito agregado nas 40 linhas (39 mudam de valor, 1 já estava certa):
--     SUM(quantity_consumed)  15.982,1870  →  362,9880  (= soma dos débitos reais)
--
-- COMO A ALOCAÇÃO É FEITA
--   O débito em stock_movements é por (order_id, product_id) — não há como
--   amarrá-lo a UMA linha de reserva quando o par tem várias. Por isso a
--   comparação é feita no agregado do par, e o total realmente debitado é
--   distribuído entre as linhas de forma GULOSA e determinística
--   (ORDER BY created_at, id): a linha mais antiga absorve primeiro.
--   Propriedades: a soma alocada é EXATAMENTE o total debitado (sem resíduo de
--   arredondamento) e nenhuma linha passa a ter consumed > o consumed anterior
--   (logo nunca > quantity_reserved). Verificado por SELECT nos 20 pares.
--
-- ⚠ reserved_stock — POR QUE ISTO NÃO O DISTORCE
--   material_reservations tem UM trigger: tg_sync_reserved_stock
--   (AFTER INSERT OR UPDATE OR DELETE) → tg_material_reservations_sync_reserved
--   → sync_product_reserved_stock(product_id), cujo corpo é:
--       SUM(quantity_reserved - quantity_consumed)
--         WHERE product_id = $1 AND status IN ('reserved','partially_consumed')
--   Ou seja: linhas com status = 'converted' — as ÚNICAS que este bloco altera —
--   estão FORA do somatório. O trigger vai disparar e recalcular, mas chegará
--   ao mesmo total de antes. Não há duplo-decremento e não é preciso (nem
--   permitido, conforme CLAUDE.md) mexer em products.reserved_stock à mão.
--   Conferido antes de escrever: para os 20 produtos envolvidos o drift atual
--   entre products.reserved_stock e a soma das reservas ativas é ZERO — logo o
--   trigger não vai "corrigir" nada de lambuja ao ser disparado.
--
-- ✔ CONSUMIDORES DE quantity_consumed (revisão adversarial — todos conferidos)
--   Nenhum lê linha 'converted'; todos filtram status IN ('reserved',
--   'partially_consumed'): sync_product_reserved_stock, compute_materials_per_pv
--   (CTE own_reserved), get_wave_material_needs_core (idem),
--   list_orphan_reservations, PurchasePlanningWizard.tsx,
--   ProductReservationDetailsDialog.tsx. `calculate_order_cost` NÃO referencia a
--   coluna (custo real vem de stock_movements / production_consumptions), então
--   custo de OP já calculado NÃO muda. OrderFlowAudit.tsx só conta linhas.
--
-- ✔ CONTAMINAÇÃO DO "debitado" (risco levantado e descartado)
--   O somatório pega TODO movimento 'out' com aquele order_id. Conferido: as 88
--   saídas das OPs dos 10 PVs são todas do caminho de conversão de reserva
--   ('Conversão …' / 'Debito Solado por grade …'), nenhuma baixa manual avulsa.
--   Filtrar por movement_reason NÃO ajudaria: classify_movement_reason carimba
--   'consumo_op' em QUALQUER 'out' que tenha order_id.
--
-- ✔ POR QUE quantity_reserved NÃO É REBAIXADO JUNTO
--   A função VIVA convert_reservation_to_out grava
--   `quantity_reserved = quantity_consumed = débito real`, ou seja, ela APAGA o
--   tamanho original da reserva. Aqui o `quantity_reserved` é deixado intacto de
--   propósito: é a única evidência de QUANTO a OP tinha reservado e nunca saiu
--   do estoque — a medida do furo que a frente de regularização (padrão
--   sql-scripts/fix-furo-baixa-pv-00145.sql) vai precisar. O resíduo
--   (reserved − consumed) em linha 'converted' é invisível para todos os
--   consumidores listados acima, então não distorce disponibilidade nem MRP.
--
-- GUARD DE IDEMPOTÊNCIA
--   O bloco só age em pares onde |SUM(consumed) − SUM(débito)| > 0,01, e cada
--   linha só é escrita se o valor mudar. Depois de aplicado, a condição do CTE
--   `alvo` não casa com nada → reaplicar é no-op.
-- ============================================================================
WITH pvs_auditados AS (
  SELECT id FROM public.sale_orders
   WHERE order_number IN ('PV-00139','PV-00140','PV-00141','PV-00142','PV-00144',
                          'PV-00145','PV-00146','PV-00147','PV-00148','PV-00149')
),
ops AS (
  SELECT o.id FROM public.orders o
   WHERE o.sale_order_id IN (SELECT id FROM pvs_auditados)
),
debitado AS (
  SELECT sm.order_id, sm.product_id, SUM(sm.quantity) AS qty_out
    FROM public.stock_movements sm
   WHERE sm.movement_type = 'out'
     AND sm.order_id IN (SELECT id FROM ops)
   GROUP BY sm.order_id, sm.product_id
),
consumido AS (
  SELECT mr.order_id, mr.product_id, SUM(mr.quantity_consumed) AS consumed_tot
    FROM public.material_reservations mr
   WHERE mr.status = 'converted'
     AND mr.order_id IN (SELECT id FROM ops)
   GROUP BY mr.order_id, mr.product_id
),
alvo AS (
  SELECT c.order_id, c.product_id, COALESCE(d.qty_out, 0) AS deb_tot
    FROM consumido c
    LEFT JOIN debitado d ON d.order_id = c.order_id AND d.product_id = c.product_id
   WHERE ABS(c.consumed_tot - COALESCE(d.qty_out, 0)) > 0.01
),
alocacao AS (
  SELECT mr.id,
         mr.quantity_consumed AS antes,
         LEAST(
           mr.quantity_consumed,
           GREATEST(
             0,
             t.deb_tot - COALESCE(
               SUM(mr.quantity_consumed) OVER (
                 PARTITION BY mr.order_id, mr.product_id
                 ORDER BY mr.created_at, mr.id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)
           )
         ) AS depois
    FROM public.material_reservations mr
    JOIN alvo t ON t.order_id = mr.order_id AND t.product_id = mr.product_id
   WHERE mr.status = 'converted'
)
UPDATE public.material_reservations mr
   SET quantity_consumed = a.depois,
       updated_at        = now(),
       notes             = COALESCE(mr.notes || E'\n', '') ||
                           '[SISTEMA] reconciliacao DEB-1/RES-2 2026-09-25: quantity_consumed ' ||
                           trim(to_char(a.antes,  'FM999999990.000000')) || ' -> ' ||
                           trim(to_char(a.depois, 'FM999999990.000000')) ||
                           ' (ajustado ao debito real em stock_movements movement_type=out).'
  FROM alocacao a
 WHERE mr.id = a.id
   AND mr.quantity_consumed IS DISTINCT FROM a.depois;


-- ============================================================================
-- VERIFICAÇÃO — falha alto e cedo se alguma correção não pegou.
-- Todas as asserções continuam verdadeiras em reaplicação (são pós-condições).
-- ============================================================================
DO $verificacao$
DECLARE
  v_d1_canceladas   int;
  v_d2_qty          numeric;
  v_d2_cola_forte   int;
  v_d3_espurias     int;
  v_d3_oc91_status  text;
  v_d3_oc95_status  text;
  v_d3_oc94_itens   int;
  v_d4_divergentes  int;
BEGIN
  -- D1: as 6 OCs duplicadas estão canceladas
  SELECT count(*) INTO v_d1_canceladas
    FROM public.purchase_orders
   WHERE order_number IN ('OC-00176','OC-00177','OC-00178','OC-00179','OC-00180','OC-00181')
     AND status = 'cancelled' AND cancelled_at IS NOT NULL;
  IF v_d1_canceladas <> 6 THEN
    RAISE EXCEPTION 'D1 falhou: esperado 6 OCs canceladas, encontrado %', v_d1_canceladas;
  END IF;

  -- D2: COLA PVC com a quantidade nova e COLA FORTE fora da OC
  SELECT poi.quantity INTO v_d2_qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
   WHERE po.order_number = 'OC-00030'
     AND poi.product_id = '66b39bc6-fa22-4b10-bc82-19cb49ed44d2'::uuid;
  IF v_d2_qty IS DISTINCT FROM 66.07056 THEN
    RAISE EXCEPTION 'D2 falhou: COLA PVC em OC-00030 = % (esperado 66.07056)', v_d2_qty;
  END IF;

  SELECT count(*) INTO v_d2_cola_forte
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
   WHERE po.order_number = 'OC-00030'
     AND poi.product_id = 'fbbe0f31-90f9-4685-9f7c-fae261617db0'::uuid;
  IF v_d2_cola_forte <> 0 THEN
    RAISE EXCEPTION 'D2 falhou: COLA FORTE ainda presente em OC-00030 (% linha(s))', v_d2_cola_forte;
  END IF;

  -- D3: nenhuma linha espúria sobrou
  SELECT count(*) INTO v_d3_espurias
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
   WHERE (po.order_number = 'OC-00091' AND poi.product_id IN (
            '3825976c-e6bb-4f37-997d-be91accbe061'::uuid,'8737389e-0e90-43f9-9bba-f87ca8ec545c'::uuid,
            '23a1cfb8-0f21-4ba0-afd3-81181e84c672'::uuid,'ed44dd78-46b0-4a68-9d80-03d75f4b4ba7'::uuid))
      OR (po.order_number = 'OC-00094' AND poi.product_id IN (
            '206eced8-8eb0-44bc-b376-148670f32419'::uuid,'14b96bf7-a96b-4b4f-8b37-217eb4d7cfd3'::uuid))
      OR (po.order_number = 'OC-00095' AND poi.product_id IN (
            '5e6717d5-c658-4c73-9eee-3492ddb25f1e'::uuid));
  IF v_d3_espurias <> 0 THEN
    RAISE EXCEPTION 'D3 falhou: % linha(s) de solado sem lastro ainda presentes', v_d3_espurias;
  END IF;

  SELECT status INTO v_d3_oc91_status FROM public.purchase_orders WHERE order_number = 'OC-00091';
  SELECT status INTO v_d3_oc95_status FROM public.purchase_orders WHERE order_number = 'OC-00095';
  IF v_d3_oc91_status <> 'cancelled' OR v_d3_oc95_status <> 'cancelled' THEN
    RAISE EXCEPTION 'D3 falhou: OC-00091=% / OC-00095=% (esperado cancelled nas duas)',
      v_d3_oc91_status, v_d3_oc95_status;
  END IF;

  SELECT count(*) INTO v_d3_oc94_itens
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
   WHERE po.order_number = 'OC-00094';
  IF v_d3_oc94_itens <> 2 THEN
    RAISE EXCEPTION 'D3 falhou: OC-00094 deveria ficar com 2 itens (solado 01 PRETO e CARAMELO), tem %',
      v_d3_oc94_itens;
  END IF;

  -- D4: nenhum par OP × produto divergente restante nos 10 PVs auditados
  WITH pvs AS (
    SELECT id FROM public.sale_orders
     WHERE order_number IN ('PV-00139','PV-00140','PV-00141','PV-00142','PV-00144',
                            'PV-00145','PV-00146','PV-00147','PV-00148','PV-00149')
  ), ops AS (
    SELECT o.id FROM public.orders o WHERE o.sale_order_id IN (SELECT id FROM pvs)
  ), deb AS (
    SELECT sm.order_id, sm.product_id, SUM(sm.quantity) qty_out
      FROM public.stock_movements sm
     WHERE sm.movement_type = 'out' AND sm.order_id IN (SELECT id FROM ops)
     GROUP BY 1, 2
  ), con AS (
    SELECT mr.order_id, mr.product_id, SUM(mr.quantity_consumed) consumed_tot
      FROM public.material_reservations mr
     WHERE mr.status = 'converted' AND mr.order_id IN (SELECT id FROM ops)
     GROUP BY 1, 2
  )
  SELECT count(*) INTO v_d4_divergentes
    FROM con c LEFT JOIN deb d ON d.order_id = c.order_id AND d.product_id = c.product_id
   WHERE ABS(c.consumed_tot - COALESCE(d.qty_out, 0)) > 0.01;
  IF v_d4_divergentes <> 0 THEN
    RAISE EXCEPTION 'D4 falhou: % par(es) OP x produto ainda divergentes', v_d4_divergentes;
  END IF;

  RAISE NOTICE 'OK - D1: 6 OCs canceladas | D2: COLA PVC = 66,07056 kg e COLA FORTE removida | D3: 0 linhas espurias, OC-00091/OC-00095 canceladas, OC-00094 com 2 itens | D4: 0 divergencias de ledger';
END
$verificacao$;


-- ============================================================================
-- SELECTs de conferência (rodar à mão depois de aplicar, se quiser ver os
-- números; ficam comentados para a migration não emitir resultado):
--
-- -- D1 + D3: estado final das OCs tocadas
-- SELECT order_number, status, cancelled_at, approval_status, total_value
--   FROM public.purchase_orders
--  WHERE order_number IN ('OC-00030','OC-00091','OC-00094','OC-00095',
--                         'OC-00176','OC-00177','OC-00178','OC-00179','OC-00180','OC-00181')
--  ORDER BY order_number;
--
-- -- D2 + D3: itens que sobraram
-- SELECT po.order_number, p.name, poi.color, poi.quantity, poi.unit, poi.unit_price
--   FROM public.purchase_order_items poi
--   JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
--   LEFT JOIN public.products p ON p.id = poi.product_id
--  WHERE po.order_number IN ('OC-00030','OC-00091','OC-00094','OC-00095')
--  ORDER BY po.order_number, p.name;
--
-- -- D4: linhas reconciliadas, com o antes/depois na nota
-- SELECT o.order_number AS op, p.name AS produto, mr.quantity_reserved,
--        mr.quantity_consumed, mr.notes
--   FROM public.material_reservations mr
--   JOIN public.orders o ON o.id = mr.order_id
--   JOIN public.products p ON p.id = mr.product_id
--  WHERE mr.notes LIKE '%reconciliacao DEB-1/RES-2%'
--  ORDER BY o.order_number, p.name;
-- ============================================================================
