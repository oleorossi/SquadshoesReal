-- REGRA DE NEGÓCIO (decisão do dono, 03/08/2026): o sistema NÃO acrescenta perda
-- de corte a nada. Os valores de consumo digitados na ficha (dm²/par) JÁ levam a
-- perda em conta. Aplicar um percentual por cima conta a mesma perda DUAS vezes e
-- infla consumo, reserva, débito, custeio e compra.
--
-- Contexto: a auditoria do PV-00150 encontrou a mesma napa com perdas diferentes
-- por COR (0 no PRETO, 8 no NEW WHISKY/OFF WHITE), o que fazia três itens de
-- grade e quantidade idênticas saírem com consumos diferentes na ficha de Corte
-- Forração. A migration anterior (20261112120700) uniformizou em 8% por ser o
-- padrão declarado do sistema; ao revisar, o dono esclareceu que a perda já está
-- embutida no valor cadastrado. Esta migration reverte aquele trecho e vai além:
-- zera a perda em TODO o sistema, não só nos grupos divergentes.
--
-- Por que zerar o DADO em vez de arrancar o cálculo: a perda é aplicada em 6
-- pontos do TS (materialConsumption, bomConsumption, orderConsumption,
-- weeklyPurchasingPlan, purchaseRequisition) e em 7 funções SQL
-- (get_material_conversion_info, calculate_order_consumption_by_grade,
-- check_stock_availability, os 3 triggers de component_sheets, run_consumption_
-- integration_tests), sempre na forma `× (1 + waste/100)`. Com o valor em 0 o
-- fator vira × 1 em todos de uma vez, sem tocar em nenhuma linha de cálculo e sem
-- risco de dessincronizar TS e SQL — que é exatamente o drift de 8% registrado em
-- docs/AUDITORIA_MOTORES_2026-07-21.md quando os dois lados discordam.

-- ── 1. Perda por MATERIAL (component_sheets.waste_pct) ───────────────────────
-- O DEFAULT 8 vem da criação da tabela (mig 20260307160122, fase Lovable) e era
-- o que reinjetava perda em toda ficha nova. Passa a 0 para que o padrão do
-- sistema seja "sem perda", em vez de depender de cada tela lembrar de zerar.
alter table public.component_sheets alter column waste_pct set default 0;

update public.component_sheets
set waste_pct = 0,
    updated_at = now()
where coalesce(waste_pct, 0) <> 0;

-- ── 2. Perda por FICHA (technical_sheets.consumption_loss_pct) ───────────────
-- Segunda encarnação da mesma perda. Hoje só a tela de Saldo Final a consumia
-- (o PurchasePlanningWizard já migrou para a RPC canônica). O código dela lia
-- `Number(consumption_loss_pct) || 5`, então zerar o dado SEM corrigir o código
-- faria a tela aplicar 5% — o `|| 5` foi removido no mesmo commit.
update public.technical_sheets
set consumption_loss_pct = 0,
    updated_at = now()
where coalesce(consumption_loss_pct, 0) <> 0;

-- NÃO tocar em `technical_sheets.safety_margin_pct`: apesar do nome, não é
-- margem de material — é o piso de margem de LUCRO (%) usado para avisar quando
-- o preço do PV fica abaixo do mínimo da ficha (SaleOrderForm.tsx:607-624).
-- Nada a ver com perda de corte.
