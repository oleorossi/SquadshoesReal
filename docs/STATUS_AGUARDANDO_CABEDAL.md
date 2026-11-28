# Aguardando Cabedal — fase entre Aprovado e Em Produção (ANÁLISE + PRÉVIA)

Pedido do Leonardo (28/11/2026), motivado pelo PV-00250: pedido com cabedal
complexo precisa gerar ordens e fichas do operador (palmilha, fibra…) sem estar
"Em Produção", porque o cabedal ainda está com o prestador.

Estado: **somente prévia local**. Nada em produção, nada gravado no banco.
O SQL de `previa/migration-rascunho.sql` é rascunho e não está em `supabase/migrations/`.

Ver o relatório completo na resposta ao Leonardo; este arquivo guarda o desenho.

## Por que derivada (e não texto novo em `sale_orders.status`)
- `sale_orders.status` é texto livre, sem CHECK; as transições valem na tela
  (`saleOrderStateMachine.ts`) e em `execute_sale_order_command`.
- 95 funções citam 'Aprovado' ou 'Em Produção' (64 citam 'Aprovado'): compras/MRP,
  reservas, ondas, cancelamento, reverter faturamento, motor do Ateliê
  (`materialize_cabedal_prep_demands` só roda com 'Aprovado'), cron do outbox.
  Trocar o texto exigiria revisar todas, num sábado, com PVs sensíveis abertos.
- A fase derivada reaproveita `list_sale_order_atelier_production_blocks`, que já
  decide quando Em Produção é recusado. Mesma fonte = tela e banco não divergem.
