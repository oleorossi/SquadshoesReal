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
- Layout: A4 paisagem, **18/folha** (3×6), envelope ~96 mm, **linhas de recorte** (tracejado + crop marks) entre os cartões.
- Contador do maço via `assignBatchCounters` (ex.: 42 cartões → `1/42` … `42/42`).

### Out of scope

- QR/barcode, persistência, Montagem/Silk/Colagem/Solagem/Expedição no fardo.

## Requirements

1. Chips do Fardo = `CARTAO_FISICO_EMITTERS` (4).
2. Palmilha elegível se Fibra **OU** Forração no roteiro.
3. Sem bloco Origem no `CartaoFisico`.
4. PV e cliente sempre que existirem nos dados do print.
5. Densidade 18/folha sem perder grade/identidade.

## Done when

- Emissores = 4; Palmilha de volta no seletor.
- Contador global do maço; PV + cliente no cartão.
- 18 cartões/folha com linhas de recorte; typecheck + testes verdes.
- Caminho automático sem escrita no banco: `?format=fardo` abre a prévia já com os cartões da Palmilha; atalho «Cartões do fardo» no Corte/kanban e nas fichas A4.

## Impressão automática (sem persistência)

Os cartões são montados no cliente a partir da grade da OP (`buildCartaoFisicoCards`) — **não há escrita no banco**, nem migration/trigger nesta etapa.

### Fluxo atual (antes)

1. Controlador abre `/imprimir-fichas`.
2. Seleciona as OPs (ou chega com `?orderIds=` pré-selecionadas, ainda na tela de escolha).
3. Clica em **Fardo** (ou entra, revisa e troca o formato na prévia).
4. Ajusta os chips de emissor se necessário e imprime.

O atalho «Fichas Operador» do Corte só abria fichas A4 (`sectors=Corte Palmilha,Corte Forração,Corte Cabedal`), sem `format`.

### Fluxo proposto (esta etapa)

1. No Corte (ou na barra de OPs): **Cartões do fardo** — navega para `/imprimir-fichas?orderIds=…&sectors=Palmilha&format=fardo` e **abre a prévia direto**, com todos os cartões da OP prontos (18/folha, linhas de recorte). O controlador só imprime, recorta e coloca com a palmilha física.
2. Ao imprimir fichas A4 com Palmilha na rota: checkbox **Incluir cartões do fardo** (ligado por padrão) mostra a prévia dos cartões no rodapé. A emissão dos cartões é pelo botão **Imprimir cartões do fardo** (PDF paisagem à parte). Não misturamos no mesmo PDF das fichas A4 porque o pipeline atual (`Gerar PDF`) força uma orientação só por documento.

Uma automação que unisse fichas A4 (retrato) e cartões (paisagem) no mesmo job exigiria mudança no renderer PDF (preferir `@page` / `preferCSSPageSize`) — não é migration/trigger, mas também não entra nesta etapa sem deploy da função de print.

