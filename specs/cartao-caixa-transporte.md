# Cartão de caixa de transporte

## Goal

Dar à fábrica um **cartão de caixa** que acompanha o agrupamento físico de corrugados na saída de **Palmilha** (Fibra+Forração), **Costura Cabedal** (→ Aviamento) e **Aviamento** (→ Colagem) — **adicional** ao Fardo (cartão por corrugado), não substituto.

## Background / Problem

O Fardo (1 por corrugado cheio) identifica o fardo unitário. No chão, vários corrugados viajam juntos numa **caixa de transporte**. Sem papel na caixa, o operador perde o destino e a contagem do lote agregado.

Fibra e Forração viajam na **mesma** caixa física — contagem 1× por OP.

## Scope

### In scope

- Formato **Caixa** em `/imprimir-fichas` (1º nível do seletor: Ficha A4 · Fardo · Caixa), com chips de setor no 2º nível.
- Setores de caixa: **Palmilha**, **Costura Cabedal**, **Aviamento** (seleção única).
- Unidade: **corrugado cheio** (`countFullCorrugados` / `resolveFicha` 12·15·18) — a mesma do Fardo.
- **1 OP por caixa** — OPs distintas nunca compartilham cartão.
- Caixa parcial **gera cartão** (`fichasNaCaixa` / capacidade).
- Conteúdo base: OP · PV · identidade (ref/cor/material) · nº de fichas · total de pares · `caixa k de N`. **Sem grade**.
- Origem/Destino: **somente** Costura Cabedal e Aviamento. Caixa Palmilha **não** imprime Origem/Destino.
- Layout: **2 cartões por A4 paisagem**.
- Capacidade: Palmilha **8**; Costura Cabedal **30**; Aviamento **30**. Ponto único (`getCaixaTransporteConfig`).
- Destinos: Costura Cabedal → **Aviamento**; Aviamento → **Colagem**. Palmilha: destino vazio.

### Out of scope

- Tela de cadastro da capacidade.
- QR/barcode, persistência de emissão.
- Misturar OPs na mesma caixa.
- Grade no cartão de caixa.

## Requirements

1. Seletor em dois níveis: Formato (`Ficha A4` | `Fardo` | `Caixa`) → chips de setor.
2. Capacidade e destino lidos **só** de `getCaixaTransporteConfig(sector)`.
3. Para cada OP elegível: `N = countFullCorrugados(pares, corrugado)`; se `N === 0` → zero caixas.
4. `ceil(N / capacidade)` caixas; a última pode ser parcial.
5. Elegibilidade:
   - Palmilha: roteiro com Fibra **OU** Forração.
   - Costura Cabedal: roteiro + `requiresUpperSewing`.
   - Aviamento: roteiro contém Aviamento.
6. Parcial impresso de forma óbvia (ex.: `3/8`).
7. Contagem de páginas / De–Até / PDF incluem `.caixa-page`.

## Data model / Domain

Sem migration. Config em `src/lib/caixaTransporteConfig.ts`; builder em `src/lib/cartaoCaixaTransporte.ts`.

| Conceito | Fonte |
|---|---|
| Corrugados cheios | `countFullCorrugados` + `resolveFicha` |
| Capacidade / destino | `getCaixaTransporteConfig` |
| Identidade | mesma cascata do Fardo no setor |

## Done when

- 23 corrugados Palmilha → 3 caixas (8, 8, 7) com labels `1/3`…`3/3`.
- OP com 5 corrugados → 1 parcial.
- OPs distintas → caixas separadas.
- Costura Cabedal usa capacidade 30 → Aviamento.
- Aviamento usa capacidade 30 → Colagem.
- Typecheck limpo; testes do builder verdes.
