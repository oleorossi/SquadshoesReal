# Teste do motor: cabedal complexo + simples no mesmo PV (25/11/2026)

Script: [`scripts/teste-motor-complexo-simples.sql`](../scripts/teste-motor-complexo-simples.sql).
Roda tudo num bloco `DO` que termina em `RAISE EXCEPTION 'ENSAIO_ROLLBACK …'`:
nada fica gravado. O resultado volta no texto do erro. As sequências de
numeração (OP, OC, PV, LOTE) são devolvidas ao valor de antes no fim, porque o
rollback não desfaz `nextval`.

Seções (`c_secao`): `resumo`, `fila`, `cronograma`, `motor`, `fase2`.

## Cenário

| PV | Tipo | Semana de faturamento (âncora) | Itens (grade de 12/ficha) |
|---|---|---|---|
| PV-ENSAIO-A | programado | 2026-12-S4 (21/12) | SP143 complexo NATURAL 360, OFF WHITE 240, ROCHA 144 + INL01 simples OFF WHITE 480, ROSADO 300 |
| PV-ENSAIO-B | programado | 2026-12-S3 (14/12) | INL01 ROSADO 240, OFF WHITE 120 |
| PV-ENSAIO-C | urgente | 2026-12-S5 (28/12) | SP143 OFF WHITE 120 + INL01 ROSADO 120 |
| PV-ENSAIO-D | programado | 2026-12-S5 (28/12) | INL01 OFF WHITE 240 |

Junto com a carga real (PV-00252, PV-00255, PV-00250 só leitura).
Fluxo oficial: `create_sale_order_command` → `execute_sale_order_command('confirm')`
→ `promote` → `list_production_sequence()` (motor desligado e ligado na transação)
→ `recompute_production_schedule()` → `list_cabedal_motor_purchase_snapshot()`
→ `list_atelier_cut_queue()` → `v_production_queue_detail`. A fase 2 simula o
retorno do prestador (jobs `received_at_factory`) e promove de novo.

## O que o motor fez

- Aprovar: OP só nasce para o simples (INL01). O SP143 vira 2 jobs de Ateliê por
  cor (costura de cabedal + aviamento), `pronto` = âncora − 7 dias corridos
  (A: 14/12; C: 21/12), janela do prestador 07/12→14/12 (A) e 14/12→21/12 (C).
  Corte travado: "Kit ainda aberto" (material zerado).
- Promover A e C para Em Produção: recusado ("aviamento ainda sem recebimento").
  B e D (só simples) vão para Em Produção. ✔ portão do complexo funciona.
- Agenda (capacidade finita 600 pares/dia/setor): simples de A em Palmilha
  04–08/12, Montagem 11–15/12, Expedição 16–18/12; B Montagem 10/12, Exp. 15/12;
  D Montagem 10/12, Exp. 15/12; C (urgente) Montagem 14/12, Exp. 17/12.
  Semana de 30/11 com Palmilha, Aviamento, Silk e Colagem a 3.000/3.000.
- Fase 2 (cabedal recebido): nascem 4 OPs do SP143; Costura de cabedal não é
  agendada em casa (etapas nascem feitas). Montagem do SP143 de A 10–14/12.

## Veredito

| Critério | Resultado |
|---|---|
| (a) complexo vai ao prestador com tempo antes da montagem | **OK com ressalva** — janela de 5 dias úteis e portão funcionam, mas `prep_business_days` está vazio em todas as refs: complexo e simples usam o mesmo relógio fixo de 7 dias, e a capacidade do prestador só gera aviso. |
| (b) mescla simples + complexo na capacidade | **Falha** — a fila real não intercala. A intercalação existe só em `proposeSequence` (TS), que não é chamada por nenhuma tela nem RPC. O complexo nem tem OP antes do retorno, então a agenda não reserva Montagem para ele. |
| (c) prioridade de caixa | **Falha parcial** — `production_sequence_close_score` mede "% de pares com OP". PV misto fica com 0,51 e cai atrás: D (fatura 28/12) passou na frente de A (fatura 21/12). O urgente sobe na lista com o motor ligado, mas a agenda de capacidade ignora o urgente. |
| (d) realismo (capacidade, material, OC) | **Falha** — capacidade por setor/dia é respeitada, mas a agenda começa tudo no dia seguinte sem olhar material (estoque zero, OC "comprar até" 02/12 com lead de 7–10 dias). O PV-00255 real tem Costura de cabedal agendada em casa enquanto o cabedal está no Ateliê. O snapshot de compra do motor repete os materiais do PV inteiro em cada item (A: 5×, ex. INFANTIL 3.900 em vez de 780 pares). Teto semanal de compra não configurado. |
| (e) datas batem com a semana de entrega | **OK com ressalva** — tudo termina antes da âncora, mas porque a agenda é "o quanto antes", não ancorada: D termina 13 dias antes, ocupando capacidade que A precisa. |

## Gaps no código

1. `src/lib/cabedalPlanningMotor.ts` 230–321 (`proposeSequence`, `levelWithinWeeks`,
   `interleave`): única lógica de mescla; só usada em `src/lib/__tests__/cabedalPlanningMotor.test.ts`.
   A intercalação é 1:1 por item, não por pares nem capacidade.
2. `list_production_sequence` (mig. 20270101050200, l. 376–390) e a fila de
   `recompute_production_schedule_impl_249` (mig. 20270101030900, l. ~64):
   `ORDER BY pin → congelado → [urgente só na lista] → close_score DESC → due_date → cor → ref`.
   Sem classe complexo/simples, sem âncora de faturamento, sem urgente na agenda.
3. `production_sequence_close_score` (mig. 20270101030900): fração de pares com
   OP — penaliza o PV misto enquanto o cabedal está fora.
4. `recompute_production_schedule_impl_249`: agenda para frente a partir de hoje;
   sem data mínima por material/OC nem por retorno do Ateliê; agenda setores de
   rua (Costura Cabedal/Aviamento) de OPs antigas do complexo.
5. `list_cabedal_motor_purchase_snapshot` (mig. 20270101050000, l. ~170–180): o
   filtro `mr.sale_order_id = so.id OR o.sale_order_item_id = soi.id` puxa as
   reservas do PV inteiro para cada item.
6. Cadastro: `atelier_complex_references.prep_business_days` nulo em todas as
   refs; `atelier_settings.weekly_purchase_cap_brl` nulo.
7. Chamar `recompute_production_schedule` 2× na mesma transação colide na chave
   idempotente da fila de tiras (`Replay idempotente com payload divergente`).

## Proposta (não implementada)

1. Ordem oficial única (lista e agenda): pin → congelado → urgente → âncora de
   faturamento (`cabedal_prep_billing_start`) → dentro da semana, intercalar
   complexo/simples por pares acumulados → cor → ref. Trocar o `close_score`
   por "fração de pares já apontados/prontos" ou removê-lo.
2. Reservar capacidade do complexo antes do retorno: OP (ou linha de previsão)
   do item complexo com data mínima = `ready_date` do job, para a agenda guardar
   a Montagem da semana certa e encaixar simples nos buracos.
3. Data mínima por material: item com falta só entra na agenda a partir da
   chegada prevista da OC (comprar até + lead).
4. Não agendar em casa setores de rua de referência do catálogo do Ateliê.
5. Corrigir o snapshot: materiais só do item (`o.sale_order_item_id = soi.id`)
   ou rateio do nível PV por pares.
6. Preencher `prep_business_days` das refs complexas e o teto semanal de compra;
   capacidade do prestador por semana deslocar a data, não só avisar.
