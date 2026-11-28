# Cartão de caixa de transporte

## Goal

Cartão que acompanha o agrupamento físico de corrugados na saída de **Palmilha**, **Costura Cabedal** e **Aviamento** — adicional ao Fardo.

## Scope

### In scope

- Formato **Caixa**; chips: Palmilha · Costura Cabedal · Aviamento.
- Capacidade: Palmilha **15** fichas/caixa; Costura/Aviamento **30**.
- Conteúdo: OP · **PV em destaque** · **cliente** · destino opcional · identidade · **grade** · fichas · pares · contador global `k/N`.
- Origem/Destino só Costura e Aviamento; Palmilha sem O/D.
- Layout: A4 paisagem, **6/folha** (3×2, 96 × 102,5 mm) com **linhas de recorte**.
- Contador do maço via `assignBatchCounters`.

## Requirements

1. Capacidade/destino só de `getCaixaTransporteConfig`.
2. Grade da curva do corrugado no cartão (preenche o corpo — sem espaço morto).
3. Densidade 6/folha sem perder informação.

## Done when

- 23 corrugados Palmilha → 2 caixas (15, 8); grade presente; 6/folha com recorte.
- Typecheck + testes verdes.

## Impressão automática (sem persistência)

Os cartões são montados no cliente a partir da grade da OP (`buildCartaoCaixaCards`) — **não há escrita no banco**.

- Deep link `?format=caixa&sectors=Palmilha&orderIds=…` abre a prévia já no formato Caixa.
- Atalho «Cartões da caixa» no Corte e na barra de OPs.
- Na prévia das fichas A4 com Palmilha: checkbox «Incluir cartões da caixa» (ligado por padrão) e botão «Imprimir cartões da caixa». A emissão é num PDF paisagem à parte (o pipeline atual não mistura orientação).
