# Aguardando Cabedal — fase entre Aprovado e Em Produção

Pedido do Leonardo (28/11/2026), motivado pelo PV-00250: pedido com cabedal
complexo precisa gerar ordens e fichas do operador sem estar "Em Produção",
porque o cabedal ainda está com o prestador.

## Decisões (Leonardo, 28/11/2026)
1. Ordens só no clique **Gerar ordens e fichas** (nada automático na aprovação).
2. Saída para Em Produção continua **manual**, pelo botão de hoje.
3. Só **Costura Cabedal** e **Aviamento** esperam o prestador. **Corte Cabedal anda.**
4. Fase **derivada, só na tela**: `sale_orders.status` continua `Aprovado`.

## Como funciona
- Tela: PV `Aprovado` com item de cabedal complexo ainda fora → "Aguardando Cabedal"
  (lista, cartão mobile, filtro, cabeçalho do detalhe, barra de passos, painel).
  Fonte: `list_sale_order_atelier_production_blocks` (mig 47200) — a mesma que
  já recusa Em Produção. `src/lib/saleOrderCabedalHold.ts`.
- Botão **Gerar ordens e fichas** → RPC `release_preproduction_for_sale_order`
  (mig 20270101067200): reaproveita `promote_sale_order_atomic_internal(pv,'Aprovado')`,
  o mesmo caminho da aprovação. Cria OP `Reservado`, reserva soft, snapshot e etapas;
  marca `orders.cabedal_preproduction_at`. Não muda o status do PV, não gera OC.
  **Atenção:** como na aprovação normal, a embalagem do pedido (ex.: fitilho) é
  debitada do estoque na criação da OP.
- Segue travado: Em Produção (gatilho `tg_zz_block_em_producao_sem_retorno_atelie`),
  Costura Cabedal e Aviamento (trava do Kanban), Colagem em diante limitado ao
  saldo conferido.
- Apontar na OP de pré-produção não pede `porta_sequencia`; o primeiro apontamento
  não tenta promover o PV (`skipped: aguardando_cabedal`).

## Por que derivada e não texto novo
95 funções citam 'Aprovado'/'Em Produção' (64 citam 'Aprovado'): compras/MRP, reservas,
ondas, cancelamento, motor do Ateliê. Trocar o texto exigiria revisar todas.

## Teste
`scripts/teste-aguardando-cabedal.tpl.sql`: aplica a migration e simula a RPC dentro
de um único bloco DO que termina em RAISE EXCEPTION (nada persiste). Trocar
`__MIGRATION__` pelo conteúdo da migration antes de rodar.
