# Fardo (cartão físico por corrugado)

## Goal

Dar à fábrica um **cartão por corrugado cheio** que acompanha o fardo na saída dos setores emissores, com identidade operacional (OP · PV · cliente · grade · k/N do maço) — separado da ficha A4 e da caixa de transporte.

## Scope

### In scope

- Formato **Fardo** em `/imprimir-fichas` (1º nível: Ficha A4 · Fardo · Caixa).
- Emissores: **Palmilha**, Corte Cabedal, Costura Cabedal, Aviamento.
- **1 cartão = 1 corrugado cheio** (12/15/18) de **1 OP**.
- Conteúdo: OP · **PV em destaque** · **nome do cliente** · destino opcional · identidade · grade · pares · contador global do maço `k/N`.
- **Sem Origem/setor** no papel.
- Destino: Costura Cabedal → Aviamento; Aviamento → Colagem. Palmilha e Corte Cabedal sem destino.
- Layout: A4 paisagem, **15/folha** (3×5), envelope ~96 mm.
- Contador do maço via `assignBatchCounters` (ex.: 42 cartões → `1/42` … `42/42`).

### Out of scope

- QR/barcode, persistência, Montagem/Silk/Colagem/Solagem/Expedição no fardo.

## Requirements

1. Chips do Fardo = `CARTAO_FISICO_EMITTERS` (4).
2. Palmilha elegível se Fibra **OU** Forração no roteiro.
3. Sem bloco Origem no `CartaoFisico`.
4. PV e cliente sempre que existirem nos dados do print.
5. Densidade 15/folha sem perder grade/identidade.

## Done when

- Emissores = 4; Palmilha de volta no seletor.
- Contador global do maço; PV + cliente no cartão.
- 15 cartões/folha; typecheck + testes verdes.
