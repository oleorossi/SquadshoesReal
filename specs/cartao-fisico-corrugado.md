# Fardo (cartão físico por corrugado)

## Goal

Dar à fábrica um **cartão por corrugado cheio** que acompanha o fardo na saída dos setores de cabedal (corte → costura → aviamento), com identidade operacional legível na bancada — separado da ficha A4 do posto e da caixa de transporte.

## Background / Problem

Na indústria calçadista, o papel que **viaja grudado no material** sai com o fardo físico. Sem ele, peça cortada e semi-acabado se perdem ou se misturam entre OPs.

Decisão do dono: **Fardo só nos setores de fluxo do cabedal** — Corte Cabedal, Costura Cabedal e Aviamento. Palmilha e Montagem ficam fora do fardo (Palmilha usa **Caixa**; Montagem não emite cartão físico neste modo).

## Scope

### In scope

- Formato **Fardo** em `/imprimir-fichas` (1º nível: Ficha A4 · Fardo · Caixa).
- Emissão de **1 cartão por corrugado cheio (12 / 15 / 18 pares)** por **OP**.
- Setores **emissores**: Corte Cabedal, Costura Cabedal, Aviamento.
- Conteúdo: setor de **origem** · OP · PV · identidade · grade do corrugado · total de pares · `k/N`.
- **Destino opcional**: Costura Cabedal → Aviamento; Aviamento → Colagem. Corte Cabedal **sem** destino.
- Formato físico ~95,5 mm, A4 paisagem, 12/folha — sem QR/barcode.
- Com Fardo ativo, chips listam **só** os 3 emissores.

### Out of scope

- QR, barcode ou apontamento por scan.
- Impressão disparada pelo apontamento do setor.
- Setores **não** emissores no fardo: Palmilha, Montagem, Acabamento Palmilha, Silk, Colagem, Solagem, Acabamento, Expedição, Relatório.
- Persistência de “cartão emitido” no banco.

## Requirements

1. Toggle de formato chama-se **Fardo** (atalho legado “Cartão físico” ainda abre neste modo).
2. Com Fardo ativo, a UI lista: Corte Cabedal, Costura Cabedal, Aviamento.
3. Corrugado via `resolveFicha` / 12·15·18; só corrugados cheios.
4. **1 cartão = 1 corrugado de 1 OP.**
5. Destino só quando `destinoForCartaoFisico(sector)` retorna label.
6. Modo Ficha A4 e modo Caixa permanecem independentes (Caixa Palmilha continua no formato Caixa).

## Data model / Domain

Sem migration. Builder em `src/lib/cartaoFisico.ts`.

| Conceito | Fonte |
|---|---|
| Corrugados cheios | `countFullCorrugados` + `resolveFicha` |
| Destino | `CARTAO_FISICO_DESTINO` / `destinoForCartaoFisico` |
| Emissores | `CARTAO_FISICO_EMITTERS` (3) |

## Done when

- Emissores = 3 (Corte Cabedal · Costura Cabedal · Aviamento).
- Costura imprime destino Aviamento; Aviamento imprime Colagem; Corte sem destino.
- Typecheck limpo; testes do builder verdes.
