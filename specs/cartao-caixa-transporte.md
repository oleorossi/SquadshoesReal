# Cartão de caixa de transporte

## Goal

Cartão que acompanha o agrupamento físico de corrugados na saída de **Palmilha**, **Costura Cabedal** e **Aviamento** — adicional ao Fardo.

## Scope

### In scope

- Formato **Caixa**; chips: Palmilha · Costura Cabedal · Aviamento.
- Capacidade: Palmilha **8**; Costura/Aviamento **30**.
- Conteúdo: OP · **PV em destaque** · **cliente** · destino opcional · identidade · **grade** · fichas · pares · contador global `k/N`.
- Origem/Destino só Costura e Aviamento; Palmilha sem O/D.
- Layout: A4 paisagem, **6/folha** (3×2, ~96 mm).
- Contador do maço via `assignBatchCounters`.

## Requirements

1. Capacidade/destino só de `getCaixaTransporteConfig`.
2. Grade da curva do corrugado no cartão (preenche o corpo — sem espaço morto).
3. Densidade 6/folha sem perder informação.

## Done when

- 23 corrugados Palmilha → 3 caixas (8,8,7); grade presente; 6/folha.
- Typecheck + testes verdes.
