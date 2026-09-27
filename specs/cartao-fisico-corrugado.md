# Fardo (cartão físico por corrugado)

## Goal

Dar à fábrica um **cartão por corrugado cheio** que acompanha a peça/palmilha/fardo na saída dos setores emissores, com identidade operacional legível na bancada — separado da ficha A4 do posto.

## Background / Problem

Na indústria calçadista, o papel que **viaja grudado no material** sai com o fardo físico. Sem ele, palmilha/peça cortada e semi-acabado se perdem ou se misturam entre OPs.

Fibra e Forração passam a emitir **um** fardo unificado (**Palmilha**), contagem 1× — alinhado à caixa de transporte.

## Scope

### In scope

- Formato **Fardo** em `/imprimir-fichas` (1º nível: Ficha A4 · Fardo · Caixa).
- Emissão de **1 cartão por corrugado cheio (12 / 15 / 18 pares)** por **OP**.
- Setores **emissores**: **Palmilha** (unifica Fibra+Forração), Corte Cabedal, Costura Cabedal, Aviamento, Montagem.
- Conteúdo: setor de **origem** · OP · PV · identidade · grade do corrugado · total de pares · `k/N`.
- **Destino opcional**: Costura Cabedal → Aviamento; Aviamento → Colagem. Palmilha / Cabedal / Montagem **sem** destino.
- Formato físico ~95,5 mm, A4 paisagem, 12/folha — sem QR/barcode.
- Com Fardo ativo, chips listam **só** os 5 emissores.

### Out of scope

- QR, barcode ou apontamento por scan.
- Impressão disparada pelo apontamento do setor.
- Setores não emissores no fardo: Acabamento Palmilha, Silk, Colagem, Solagem, Acabamento, Expedição, Relatório.
- Persistência de “cartão emitido” no banco.

## Requirements

1. Toggle de formato chama-se **Fardo** (atalho legado “Cartão físico” ainda abre neste modo).
2. Com Fardo ativo, a UI lista: Palmilha, Corte Cabedal, Costura Cabedal, Aviamento, Montagem.
3. Corrugado via `resolveFicha` / 12·15·18; só corrugados cheios.
4. **1 cartão = 1 corrugado de 1 OP.**
5. Palmilha: elegível se Fibra **OU** Forração no roteiro; **1×** contagem (não dois maços).
6. Destino só quando `destinoForCartaoFisico(sector)` retorna label.
7. Modo Ficha A4 permanece independente.

## Data model / Domain

Sem migration. Builder em `src/lib/cartaoFisico.ts`.

| Conceito | Fonte |
|---|---|
| Corrugados cheios | `countFullCorrugados` + `resolveFicha` |
| Destino | `CARTAO_FISICO_DESTINO` / `destinoForCartaoFisico` |
| Identidade | cascata por setor (forração preferida em Palmilha) |

## Done when

- Emissores = 5 (Palmilha unificada).
- Costura imprime destino Aviamento; Aviamento imprime Colagem.
- Palmilha sem destino; contagem 1×.
- Typecheck limpo; testes do builder verdes.
