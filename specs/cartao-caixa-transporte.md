# Cartão de caixa de transporte

## Goal

Dar à fábrica um **cartão de caixa** que acompanha o agrupamento físico de corrugados na saída de Corte Forração (→ Palmilha) e Costura Cabedal (→ Aviamento) — **adicional** ao Cartão físico por corrugado, não substituto.

## Background / Problem

O Cartão físico (1 por corrugado cheio) identifica o fardo unitário. No chão, vários corrugados viajam juntos numa **caixa de transporte**. Sem papel na caixa, o operador perde o destino e a contagem do lote agregado.

## Scope

### In scope

- Modos de impressão **“Caixa Forração”** e **“Caixa Costura Cabedal”** em `/imprimir-fichas` (toggles separados, mutuamente exclusivos entre si e vs A4 / Cartão físico).
- Unidade: **corrugado cheio** (`countFullCorrugados` / `resolveFicha` 12·15·18) — a mesma do Cartão físico.
- **1 OP por caixa** — OPs distintas nunca compartilham cartão.
- Caixa parcial **gera cartão** (`fichasNaCaixa` / capacidade).
- Conteúdo: origem · destino · OP · PV · identidade (ref/cor/material) · nº de fichas · total de pares · `caixa k de N`. **Sem grade**.
- Layout: **2 cartões por A4 paisagem**.
- Capacidade default: Forração **10**; Costura Cabedal **30**. Ponto único de config (`getCaixaTransporteConfig`) — sem UI de cadastro nesta entrega.
- Destinos fixos: Forração → **Palmilha**; Costura Cabedal → **Aviamento**.

### Out of scope

- Tela de cadastro da capacidade.
- QR/barcode, persistência de emissão.
- Misturar OPs na mesma caixa.
- Grade no cartão de caixa.
- Outros setores além de Forração e Costura Cabedal.

## Requirements

1. Toggles **Caixa Forração** e **Caixa Costura Cabedal** ao lado de “Cartão físico”; ativar um ⇒ preview/impressão só daquele setor.
2. Capacidade e destino lidos **só** de `getCaixaTransporteConfig(sector)`.
3. Para cada OP elegível: `N = countFullCorrugados(pares, corrugado)`; se `N === 0` → zero caixas.
4. `ceil(N / capacidade)` caixas; a última pode ser parcial.
5. Elegibilidade espelha o Cartão físico (Forração: lining + roteiro; Costura Cabedal: sewing + roteiro).
6. Parcial impresso de forma óbvia (ex.: `3/10`).
7. Contagem de páginas / De–Até / PDF incluem `.caixa-page`.

## Data model / Domain

Sem migration. Config em `src/lib/caixaTransporteConfig.ts`; builder em `src/lib/cartaoCaixaTransporte.ts`.

| Conceito | Fonte |
|---|---|
| Corrugados cheios | `countFullCorrugados` + `resolveFicha` |
| Capacidade / destino | `getCaixaTransporteConfig` |
| Identidade | mesma cascata do Cartão físico no setor |

## Done when

- 23 corrugados Forração → 3 caixas (10, 10, 3) com labels `1/3`…`3/3`.
- OP com 5 corrugados → 1 parcial.
- OPs distintas → caixas separadas.
- Costura Cabedal usa capacidade 30.
- Typecheck limpo; testes do builder verdes.
