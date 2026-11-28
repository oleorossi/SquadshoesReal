# Pacote da OP — um PDF só (Palmilha → Fardo → Caixa)

Botão **Imprimir pacote da OP** na ficha de operador (`/imprimir-fichas`, modo A4 com Palmilha).

- **Ordem fixa do PDF:** Palmilha (A4 retrato) → Fardo (A4 paisagem, 18/folha) → Caixa (A4 paisagem, 6/folha, 15 fichas por caixa).
- **Orientação mista:** `@page` nomeado (`pacote-retrato` / `pacote-paisagem`) em `PacoteOpDocument`. O renderer (`api/render-pdf.ts`) usa `preferCSSPageSize` e **não** passa `landscape:false`.
- **Tela de seleção** (`PacoteOpPrintPanel`): tudo vem marcado. Reimpressão parcial por **tipo** (checkbox), por **folha** (chips) ou por **texto** (`1,5,15`, `1:15`, `1,5,10:15`) em Folhas / Cartões / Fichas.
  - `Fichas` vale para Fardo (1 cartão por ficha) **e** Caixa (as caixas que contêm essas fichas). A ficha Palmilha A4 só se escolhe por folha.
  - Parser com validação (`src/lib/pacoteOpSelecao.ts`): erro em fora da faixa, 0, intervalo invertido/incompleto, lixo e vírgula sobrando.
- **2ª via:** qualquer seleção parcial sai com o selo `2ª VIA · dd/mm/aaaa` (data em America/Sao_Paulo) em todas as folhas. Fardo/Caixa escolhidos são reempacotados em folhas cheias e mantêm o contador original (`5/100`).
- **Sem log de reimpressão e sem migration.** Nada é gravado: o selo é só CSS no papel.
- Lógica pura em `src/lib/pacoteOp.ts`; recorte das folhas Palmilha já paginadas em `src/lib/pacoteOpDom.ts`.
