# Sistema de Impressão Squad Shoes — Especificação Técnica

> **Documento canônico** das regras de impressão A4 do sistema. Última
> atualização: 2026-06-19. Mantenha sincronizado com mudanças em
> `styles-paper.css`, `index.css`, `PrintWorkSheetsPage.tsx` e
> `worksheet/PaginatedSheet.tsx`.
>
> ⚠ **PADRÃO CANÔNICO (2026-06-19): o `PaginatedSheet` — paginação explícita
> por medição (§3-B) — é o mecanismo DEFAULT de toda impressão A4 in-app com
> conteúdo variável/multi-página. As "Regras anti-folha-branca" (§0.2) são
> OBRIGATÓRIAS para TODA impressão A4, inclusive as geradas via `window.open`.
> Comece pela §0.** A quebra natural do browser (§3) é tier-2 (legado +
> relatórios com tabelão grande, §2.3); os prints via `window.open` são
> contexto HTML à parte (§0.4) — mas todos seguem as regras anti-folha-branca.

---

## 0. PADRÃO CANÔNICO A4 (2026-06-19)

> **Regra:** toda impressão A4 do sistema segue ESTE padrão. O `PaginatedSheet`
> (§3-B) é o mecanismo CANÔNICO para qualquer impressão **in-app (React) com
> conteúdo variável / multi-página**. As regras anti-folha-branca (§0.2) são
> OBRIGATÓRIAS para TODAS as A4 — inclusive as geradas via `window.open`.

### 0.1 Qual mecanismo usar

| Tipo de impressão | Mecanismo | Por quê |
|---|---|---|
| In-app React, conteúdo variável/multi-página (fichas, romaneios, relatórios por PV) | **`PaginatedSheet`** (§3-B) | medição + páginas explícitas = zero folha em branco |
| In-app React, doc de página única simples | `PaginatedSheet` (1 bloco) ou `PaperShell` + `keep-together` | ambos servem; o `PaginatedSheet` é mais à prova |
| HTML standalone via `window.open` | regras CSS anti-folha-branca embutidas na string (§0.2) | não há React/medição na janela popup — usa fragmentação do browser |
| Etiqueta de tamanho fixo (térmica) | NÃO é A4 — fora deste padrão (§5.4) | formato próprio |

### 0.2 Regras anti-folha-branca (OBRIGATÓRIAS em toda A4)

1. **WYSIWYG** — nenhuma regra que mude ALTURA (font/line-height/padding/margin/
   height/`table-layout`) pode viver SÓ em `@media print`: tela e papel têm que
   medir igual. Crítico no `PaginatedSheet` (mede a tela); nos demais evita derrame.
2. **Sem altura fixa que derrama** — caixa de página = `height:auto` em print;
   nada de `height: NNNmm` fixo sem `overflow` controlado. Imagens SEMPRE em caixa
   de tamanho FIXO (medição estável — ver `ProductImageBlock`).
3. **Prever a altura de IMPRESSÃO** — o papel rende ~3-4% mais alto que a tela →
   empacotar pela altura medida × **`PRINT_INFLATE` (1.06)**. Sem isso a página
   CHEIA derrama o pé numa folha 100% branca (bug do PDF de 2026-06-19, ACABAMENTO).
4. **`@page { size: A4 portrait; margin: 0 }`** + padding interno POR página (mata
   o header/footer do navegador; a área não-imprimível fica garantida pelo padding).
5. **Blocos atômicos** — cabeçalho/rodapé/card/linha NUNCA cortados: `keepWithPrev`
   (rodapés) e `keepWithNext` (sub-headers) no `PaginatedSheet`; `.keep-together`/
   `.keep-with-next`/`.keep-with-previous` no fluxo do browser.
6. **Print-safety** — inline styles + cores hardcoded `#000` (NUNCA primitives
   shadcn Card/Badge/Button/Table; NUNCA token com alpha tipo `border-foreground/15`
   = invisível no papel); fontes `'Fira Sans'/'Fira Code'/'Anton'` (in-app).
   `'Inter Tight'/'JetBrains Mono'` valem SÓ na etiqueta térmica (`window.open`).
7. **NÃO usar `flex`/`grid` no ROOT de um doc que pagina** — o fragmentador do
   Chrome CLIPA conteúdo de flex-col que passa de 1 página (bug ReducedWorkSheet,
   2026-06-19). Root = `display:block`; flex só em sub-blocos atômicos.

### 0.3 Checklist — TODA impressão A4 nova

- [ ] É React in-app com conteúdo variável? → `<PaginatedSheet blocks={...}>`.
- [ ] Rodapés/assinaturas com `keepWithPrev`; sub-headers de grupo com `keepWithNext`.
- [ ] Nenhuma regra de ALTURA só em `@media print` (WYSIWYG).
- [ ] Imagens em caixa de tamanho FIXO; root sem `flex`/`grid`.
- [ ] `@page A4 margin 0` + padding por página.
- [ ] Inline + `#000`; sem shadcn/alpha; fontes Fira.
- [ ] Testado IMPRESSO: zero folha em branco, zero header órfão, zero bloco
      cortado, e nº físico de folhas == "N/TOTAL" da faixa de cabeçalho.

### 0.4 Classificação das impressões A4 hoje

- **✅ Conforme (`PaginatedSheet`):** `OperatorWorkSheet`, `SilkMontageWorkSheet`,
  `SolagemWorkSheet`, `PalmilhaWorkSheet`, `ExpedicaoWorkSheet`, `ManagementReport`
  (rota `/imprimir-fichas`). Auditados OK em 2026-06-19.
- **🟡 In-app React + `window.print` (ÚNICO candidato real ao `PaginatedSheet`):**
  `EspelhoPontoPage` (espelho de ponto — multi-funcionário, multi-página). É doc
  LEGAL e hoje funciona no fluxo do browser com `keep-together` — migrar SÓ se
  aparecer folha em branco/órfão na prática (não está quebrado; migração
  preventiva = risco num doc legal). `ReducedWorkSheet` = caso especial (empacota
  VÁRIAS fichas por folha → fica no fluxo, root SEM flex, §0.2-7).
  Relatórios **A4Layout** (`RelOpA4`/`RelSemanalA4`/`RelDiarioA4`/`RelRefugoA4`/
  `RelOeeA4`/`RelQualidadeA4`) = **tier-2 ACEITO** (tabelão não cabe em "blocos
  atômicos", decisão §2.3) — NÃO migrar; só seguir §0.2.
- **🔵 `window.open` / `printHtml` (janela HTML separada — NÃO roda `PaginatedSheet`,
  contexto sem React/medição):** `printOrder`, `printPurchaseOrder`,
  `printStockPurchaseOrder`, `printServiceOrderReceipt`, `printPerPvMaterials`,
  `printDanfe`, **`OrdersSummary`, `GroupedReportSummary`, `PickingListPage`,
  `FichaMontadoresPage`** (estes 4 usam `printHtml`/`window.open`, não in-app).
  Cada um embute o próprio `@page` + CSS; devem seguir as regras §0.2 dentro da
  string HTML. Consolidar num preâmbulo CSS compartilhado = trabalho futuro.
- **⛔ FORA do padrão A4 — ETIQUETAS (decisão do dono 2026-06-19, totalmente à
  parte):** `printLabels`, `label-system/*`, `EtiquetaProduto`, `ExternalBoxLabel`,
  `ExternalBoxLabelPro`. Formato térmico/fixo, sistema PRÓPRIO (`'Inter Tight'`/
  `'JetBrains Mono'`, `window.open` próprio) — **nada deste padrão A4 se aplica a
  elas, em nenhuma circunstância.**

---

## 1. Problema original

Fichas de operador renderizavam corretamente em tela, mas no print:

- **Texto cortado pelas bordas físicas da A4** (impressoras têm 4-7mm não-imprimíveis)
- **Conteúdo desaparecia** em fichas grandes (overflow: hidden escondia tudo após 281mm)
- **Cabeçalho ficava órfão** no fim de uma página, com o conteúdo na seguinte
- **Assinaturas cortadas** no meio (linha de assinatura sem o label embaixo)
- **Cards de cor/grade quebravam no meio** durante a paginação automática do browser

Reportado pelo user em 2026-05-21 com screenshot mostrando GRADE + CONTROLE DE FICHAS em página separada das assinaturas (que deveriam estar juntas).

---

## 2. Estratégias tentadas (e por que falharam)

### 2.1 Forçar 1 ficha = 1 A4 com `overflow: hidden`

```css
.page-break {
  height: 281mm;
  overflow: hidden;
}
```

**Falha:** quando o conteúdo excedia 281mm, o `overflow: hidden` **escondia visualmente** as últimas seções. Usuário via "ficha cortada" sem saber por quê.

### 2.2 Scaling dinâmico via `transform: scale(X)`

Criou-se `PrintPageScaler` que media `scrollHeight` via `ResizeObserver` e aplicava `transform: scale(maxA4 / natural)` quando excedesse 281mm. Floor 0.55.

**Falha:** em fichas extremamente grandes (5+ cores de Corte Forração, ManagementReport com 19 OPs), o scale ficava em 0.55 mas o conteúdo ainda estourava. Pior: **texto ficava com 4.7pt — ilegível** na prática de fábrica.

### 2.3 Chunking automático de conteúdo

Tentou-se dividir grupos grandes em chunks no `PrintWorkSheetsPage.tsx`:
- Palmilha: 2 solados por página
- SilkMontage: 2 cores por página
- ManagementReport: 5 OPs por página

**Falha parcial:** funcionava pras fichas de operador, mas pro Relatório Gerencial era matematicamente impossível (cada OP gera ~683px em 3 tabelas + header de 600px = mínimo 1283px > 1062px de A4 útil).

User decidiu (2026-05-24): **abandonar a ideia de "1 doc = 1 A4"**. Prefere relatório em 2-3 páginas a texto comprimido.

---

## 3. Solução adotada — quebra natural + blocos atômicos

### Filosofia

> Documento grande **PODE ocupar quantas A4 forem necessárias.** O que NÃO pode acontecer é um **bloco atômico** (cabeçalho, assinatura, card de cor, linha de tabela) ser cortado no meio.

### Regras CSS centrais

```css
@media print {
  /* 1. Doc pode crescer livremente — não impõe altura */
  .sheet, .print-natural, .print-area {
    min-height: 0;
    height: auto;
    max-height: none;
    overflow: visible;
  }

  /* 2. Entre documentos distintos: nova página */
  .sheet, .page-break {
    page-break-after: always;
    break-after: page;
  }
  .sheet:last-child, .page-break:last-child {
    page-break-after: auto;
  }

  /* 3. Bloco atômico — NUNCA quebra no meio */
  .keep-together,
  .a4-head, .a4-foot, .sig-row, .sig {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }

  /* 4. Headings ficam com conteúdo seguinte (sem título órfão) */
  .keep-with-next,
  h1, h2, h3,
  .p-display, .p-eyebrow {
    break-after: avoid !important;
    page-break-after: avoid !important;
  }

  /* 4b. Elemento se ancora ao bloco anterior (evita órfão na pg seguinte).
        Usado pelo SignatureFooter / A4Foot / Sigs — quando o footer não
        cabe na mesma pg que o último bloco, leva esse bloco junto pra
        próxima pg em vez de aparecer sozinho. */
  .keep-with-previous,
  .a4-foot, .sig-row {
    break-before: avoid !important;
    page-break-before: avoid !important;
  }

  /* 5. Tabelas: thead repete em cada página, tr não quebra */
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
}
```

### Configuração @page

```css
@page {
  size: A4 portrait;
  margin: 0; /* v7 (2026-06-12) — ver justificativa abaixo */
}
```

**Por que margin 0:** o navegador só imprime o header/footer dele (URL +
data + "Página 1 de 83") quando há **margem vertical reservada** no @page.
O dono reportou (foto real, 2026-06) essa linha saindo no rodapé de toda
folha — a única forma programática de suprimir é zerar a margem. A área
segura (impressoras têm ~4-7mm não-imprimíveis) passa a ser garantida
**dentro do conteúdo**: nas fichas de operador, pelo padding interno das
páginas explícitas do `PaginatedSheet` (seção 3-B); no fluxo reduzido,
por margens/padding no `.reduced-card`.

> Histórico: margin já foi 0 → 8mm (era um fluxo único sem padding por
> página; conteúdo colava na borda) → 0 de novo com a paginação explícita.

---

## 3-B. Paginação explícita por medição — v7 (2026-06-12) — MODELO ATUAL DAS FICHAS

> **Atualização v7.2 (2026-06-19) — números atuais (substituem os de 2026-06-12 abaixo):**
> - `PAGE_HEIGHT_MM` **294 → 288** (folga ~9mm vs os 296.9mm que o Chrome usa pra A4).
> - **`PRINT_INFLATE = 1.06`**: empacota pela altura PREVISTA de impressão
>   (`heights × 1.06`, na base E na busca do auto-fit), porque o papel rende ~3-4%
>   mais alto que a tela. Sem isso a página CHEIA derramava o pé numa folha 100%
>   branca mesmo com a folga fixa (PDFs 2026-06-18/19: CORTE FORRAÇÃO, ACABAMENTO).
>   A folga passou a ser PROPORCIONAL ao conteúdo (não corte fixo da caixa).
> - **Auto-fit agressivo:** reduz fonte+tabela até **−20%** (`AUTO_FIT_FLOOR 0.85→0.80`)
>   e SEM o antigo gate de "<15% da última página" — tenta encolher SEMPRE que isso
>   remova uma folha (só encolhe quando de fato remove; piso é o único limite).
> - **Medição só na baseline (fix React #185):** `measure` só roda quando
>   `scaleRef===1`; medir o DOM já com `zoom` do auto-fit reflui texto e entrava em
>   loop infinito de setState ("Maximum update depth"). Reset de `scaleRef=1` ao
>   mudar o conjunto de blocos. **Regra: nunca realimentar o auto-fit com medida do
>   DOM escalado.**
> - Travado por testes em `worksheet/__tests__/paginatedSheet.test.ts` (incl.
>   `PRINT_INFLATE`). Ver §0 pro padrão geral.

A fragmentação automática do browser não dá **padding por página**
(necessário com `@page margin: 0`) nem **"card inteiro ou nada"**
confiável (foto real mostrou card de solado partido entre pág. 1 e 2:
header no fim de uma, grade no topo da outra). O modelo v7 substitui a
fragmentação por um paginador determinístico.

### Componente

`src/components/production/worksheet/PaginatedSheet.tsx`

```tsx
<PaginatedSheet
  sectorLabel="Corte Forração · Solado 01"   // faixa de cabeçalho
  blocks={[headerBlock, ...cardBlocks, footerBlock]}  // blocos ATÔMICOS
  pageStyle={{ fontSize: '10pt' }}            // opcional (ManagementReport)
/>
```

### Como funciona

1. **Cada ficha emite uma lista de BLOCOS** (header da ficha, 1 card por
   cor/solado/banda, total geral, rodapé de conclusão) em vez de um fluxo
   único. Todas as worksheets foram refatoradas assim: PalmilhaWorkSheet,
   SilkMontageWorkSheet (compacto + completo), SolagemWorkSheet,
   OperatorWorkSheet, ExpedicaoWorkSheet e ManagementReport.
2. **Medição real**: cada bloco é envolto num wrapper `display: flow-root`
   (margens internas ficam contidas; `Math.ceil(getBoundingClientRect().height)`
   mede a altura real sub-pixel — `offsetHeight` arredondava pra baixo e o
   erro acumulado derramava no print). Re-medição via `ResizeObserver` por
   bloco (cobre imagem chegando tarde), `beforeprint` (com `flushSync` pro
   snapshot do print pegar o DOM repaginado), `matchMedia('print')` e
   `resize`.
   ⚠ **REGRA WYSIWYG (2026-06-12)**: a medição acontece no layout de TELA.
   Logo, NENHUMA regra que altere ALTURA de conteúdo pode viver só dentro
   de `@media print` — tipografia 8pt/1.12, compressão de spacing
   utilities e `table-layout: fixed` + `word-break` de células valem
   SEMPRE dentro da `.print-area` (bloco no topo do `printStyles`).
   Quando eram print-only, o papel renderizava diferente da medição e
   cada página lógica derramava numa folha em branco (PDF "mesmo erro",
   2026-06-12: 20 páginas lógicas → 40 físicas).
3. **Empacotamento** (`packBlocks`, puro/testado): first-fit sequencial,
   sem reordenar. Se o próximo bloco não cabe no espaço restante → fecha
   a página (**resto fica em branco**) e o bloco abre inteiro a próxima.
   Flags por bloco: `keepWithPrev` (rodapés — nunca ABREM página sozinhos,
   puxam o bloco anterior) e `keepWithNext` (sub-headers de grupo — nunca
   FECHAM página, viajam junto com o bloco seguinte).
4. **Páginas explícitas**: divs `210mm × 294mm` em TELA (o Chrome trata A4
   como 296.9mm; com 296mm a folga real era < 1mm e qualquer sub-pixel
   derramava — 294 dá ~3mm de folga ao empacotador). Em PRINT a caixa vira
   `height: auto` (termina no conteúdo, nunca cruza o limite físico) +
   `break-after: page`. `box-sizing: border-box`, padding **6mm topo /
   8mm laterais / 8mm base** (substitui a margem do @page). Em tela
   aparecem como cartões A4 empilhados (preview fiel).
5. **Faixa de cabeçalho em TODA página, inclusive a 1ª**: 6mm de altura,
   hairline preto inferior, Fira Code mono uppercase — nome do setor à
   esquerda + **"N/TOTAL"** (ex.: 3/8) à direita. A contagem é **dentro
   da ficha** (cada `PaginatedSheet` numera as próprias páginas).
6. **Mudança de setor/ficha = nova página**: cada ficha continua dentro
   de um `.page-break` próprio; a última página explícita da ficha tem
   `break-after: auto` e o `.page-break` pai força a quebra (evita breaks
   duplos virarem folha em branco).
7. **Saída invertida (2026-07-24, `worksheet/printOrder.tsx`)**: a impressora
   da fábrica empilha face pra cima (1ª página emitida fica no fundo → maço
   sai de trás pra frente). Com o toggle **"Saída invertida"** da toolbar
   LIGADO (default, persistido em `localStorage['print_reverse_output']`),
   o print emite o documento da última página física pra primeira: o
   `ReversibleStack` inverte a ordem dos maços de setor na print-area e o
   `ReversePrintContext` faz cada `PaginatedSheet` emitir as próprias páginas
   ao contrário (numeração "N/TOTAL" é lógica — não muda). O flip é
   TRANSITÓRIO: liga em `beforeprint` (flushSync, snapshot pega o DOM
   invertido — cobre botão Imprimir E Ctrl+P) e desliga em `afterprint` —
   a pré-visualização em tela NUNCA inverte. Vale TAMBÉM no layout reduzido
   (fix da revisão 2026-07-24): Expedição/Relatório Gerencial não têm
   variante reduzida e imprimem a ficha completa lá — precisam da
   compensação; os cards recortáveis reordenados não fazem diferença (vão
   pra tesoura). Limite conhecido: as páginas INTERNAS de bloco `--flow`
   maior que 1 página são fragmentadas pelo browser em ordem de leitura
   dentro da emissão invertida — na PILHA final elas saem em ordem reversa
   (igual ao baseline sem compensação, e são as folhas sem faixa N/TOTAL).
   Mitigação real quando incomodar: fatiar o bloco em chunks < 1 página
   (como a tabela de itens da Expedição já faz), não aceitar o flow. Os
   avisos de reconciliação têm `.page-break` próprio pra permanecerem
   página-alinhados sob inversão (sem folha própria, colavam na última
   folha do maço ANTERIOR na emissão invertida).

### Fluxo contínuo por setor (2026-06-12, 4º passe)

Dentro de um MESMO setor, os grupos (solado/referência/OP) fluem CONTÍNUOS
num único `PaginatedSheet` — não existe mais 1 ficha (`.page-break` + header
completo) por grupo, que desperdiçava papel (página 70% em branco + header
gigante repetido na seguinte). Estrutura do maço:

1. **WorksheetHeader agregado do setor** (1×, primeiro bloco): PVs envolvidos
   (Anton **adaptativo**, lista completa), **razão social dos clientes em
   VERMELHO `#C00000`** logo abaixo do PV, total de pares, nº de grupos.
   O strip "Batch · XXX-YYMMDD-HASH + data" foi **removido** (pedido do dono;
   `generateBatchId` foi deletado junto com o popup legado no 6º passe).
2. **`GroupSubHeader`** por grupo (`worksheet/GroupSubHeader.tsx`): faixa fina
   com hairline — eyebrow ("SOLADO 02/05"), título em Anton menor adaptativo,
   selo INFANTIL/ADULTO, lote, OPs e pares do grupo.
3. Cards do grupo + `CompletionFooter` POR GRUPO.

Grupo que não cabe no resto da página vai inteiro pra próxima (paginador),
sem header gigante — a identificação das páginas 2+ é a faixa do
`PaginatedSheet`, cujo `sectorLabel` agora é SÓ o nome do setor e o
"N/TOTAL" conta o maço inteiro. Setores unificados: Corte Forração, Corte
Cabedal, Costura Palmilha, Costura Cabedal, Silk, Aviamento (sub-header por
referência), Montagem (sub-header por ref+cor) e Acabamento (sub-header por
OP). Corte Palmilha, Solagem e Colagem já eram maços únicos. **NÃO
unificados**: Expedição (1 ficha POR CLIENTE — romaneio loja-a-loja) e
Relatório Gerencial (1 por PV). `SilkMontageWorkSheet` recebe `groups[]` e
`OperatorWorkSheet` recebe `items[]` (cada um emite um único PaginatedSheet).

**Agrupamento por solado = por MODELO (5º passe, 2026-06-12):** a chave dos
grupos por solado é `products.group_id` do solado resolvido (helper
`worksheet/soleGroupKey.ts`, testado). Antes era o `sole_product_id` — SKU
por COR — e um PV com N cores de cabedal imprimia N grupos consecutivos
todos com o MESMO título (o nome base sem cor), parecendo o setor duplicado
(bug reportado pelo dono: "Corte de forração tá duplicado / vários setores
repetindo"). Fallback textual (sole_material) continua POR FICHA (fichas
distintas com label "01" não se fundem — decisão 2026-05-19).

**Outros ajustes do 5º passe:** Corte Cabedal ganhou o bloco "Facas de
Corte" (qtd de facas + código da faca em Anton + numerações cobertas, por
referência quando o maço tem várias — fonte: `technical_sheets.
knife_size_ranges[].code`, campo novo opcional no JSONB, sem migration);
Relatório Gerencial perdeu a seção "Custos & Margem" (KPIs apenas
operacionais) e a seção de Silks agora lista as referências que levam cada
silk abaixo da imagem.

### 6º passe (2026-06-12) — caminho legado removido + tally universal

1. **`src/lib/printSectorWorkSheet.ts` foi DELETADO** (junto com
   `worksheet/batchId.ts` + teste, que só ele usava). Era o popup
   `window.open` legado dos botões "Fichas Operador" das páginas de setor
   (`Silk.tsx`, `Montagem.tsx`, `Corte.tsx`, `Solagem.tsx`) — sem TallyBox
   e fora do modelo v7; era por ele que o dono imprimia setores sem ver o
   Controle de Fichas. Os botões agora NAVEGAM pra rota central:
   `/imprimir-fichas?orderIds=<ids>&sectors=<Nome,Nome>`. O novo param
   `sectors` (validado contra `SECTORS`, exportado do
   `PrintWorkSheetsPage.tsx`) pré-seleciona só esses chips via
   `initialSectors`. Mapeamento: Silk→Silk, Montagem→Montagem,
   Solagem→Solagem, Corte→Corte Palmilha + Corte Forração + Corte Cabedal
   (a ficha legada de "Corte" englobava as 3 sub-etapas).
2. **TallyBox (Controle de Fichas) é UNIVERSAL**: `ReducedWorkSheet` ganhou
   o tally compacto (props `fichas`/`pairsPerFicha`; fallback
   `ceil(totalPairs/12)`); `PalmilhaWorkSheet` renderiza o tally SEMPRE
   (antes suprimia quando `readyMade` — o alerta "Palmilha PRONTA"
   permanece); `OperatorWorkSheet` renderiza pra qualquer setor (antes só
   Silk/Colagem/Montagem/Solagem; Acabamento mantém o tally de caixas).
   SilkMontage (compacto+completo), Solagem/Colagem e Expedição já eram
   incondicionais.

### 7º passe (2026-06-12) — corrugado 12/15/18 derivado + densidade do compacto

1. **Conceito de "ficha" corrigido**: uma ficha é um CORRUGADO físico que só
   existe em **12, 15 ou 18 pares** (regra do dono). O corrugado é **derivado**
   do pedido (total + grade) pelo helper puro
   `worksheet/fichaSize.ts → resolveFicha(totalPairs, grid)` (testado) — NÃO
   há campo no banco. Motivo: `order.grid` ora chega como curva-base (soma 12),
   ora como **grade total** do pedido (soma 120/360/444 — ex. real TAMARA), e o
   cálculo antigo (`fichas = round(total/Σgrid)`) imprimia "POR FICHA (120P) ·
   1 ficha". Resolução: (1) grid já é curva (Σ∈{12,15,18}) → preserva;
   (2) grid é grade total → tenta corrugado 12 > 15 > 18 com divisão exata
   célula-a-célula; (3) curva multiplicada (Σ=24…) → reduz; (4) fallback
   corrugado 12 + `exact=false` (última ficha parcial → grade exibe "≈ N
   fichas", sem linha "Por Ficha"). Todos os builders de grupos
   (`PrintWorkSheetsPage` — ref+cor, palmilha, silkMontage/aviamento, solagem
   via `foldFichaIntoGroup`) e o `OperatorWorkSheet` usam o helper. Na
   Solagem, o resolve roda na grade ORIGINAL e a curva é bucketizada depois
   (conjugadas). Semântica nova dos campos: `baseGradeSum` = corrugado,
   `baseGrid/baseGrade` = curva de 1 ficha, `fichas` = nº de corrugados.
   **Tally**: 1 caixinha = 1 corrugado SEMPRE (mesmo `mixedGrades`); quando
   OPs do grupo resolvem corrugados DIFERENTES (`corrugadosMistos`), o título
   do tally vira "Controle de Fichas · corrugados mistos". Expedição não muda
   (caixas de embarque = `pairs_per_box`, outro conceito).
2. **Densidade do layout COMPACTO** (Corte Forração / Costura Palmilha /
   Silk — pedido do dono, foto real com 2ª cor empurrada inteira pra página
   seguinte): nome da cor 26→20px, total "N pares" 22→17px, margens
   reduzidas, grade 1 bucket menor (`gradeTableFont(sizes, dense)`) e
   `TallyBox size="sm"` (caixinha 16px, gap 2px, fontes 8/6.5/5.5px).
   Objetivo: bloco de cor típico (grade 5-7 numerações + tally de 40 fichas)
   ≤ ~470px → DUAS cores por página A4 (capacidade ~1035px do PaginatedSheet).

### Exceção: bloco maior que 1 página inteira

Ganha página própria com `height: auto; min-height: 294mm` (tela) e **flui** — o
browser fragmenta por dentro (`.keep-together`/`tr` continuam protegendo
as sub-seções; `.flow-card` fecha a borda em cada fragmento via
`box-decoration-break: clone`). As páginas extras entram no TOTAL via
`ceil(altura/capacidade)`, mas **não têm a faixa de cabeçalho** e o
conteúdo de continuação não tem padding vertical próprio — edge case
aceito (raro: card de cor com 200+ caixinhas de tally).

> Com o paginador, `.flow-card` perdeu a função no caso comum (cada card
> já é um bloco atômico empacotado inteiro); a classe foi MANTIDA nos
> cards exatamente por causa deste edge case de overflow.

### Tabelas longas (Expedição · "Itens · Conferência")

Não dá pra empacotar uma tabela de 40 linhas como bloco único sem cair no
edge case acima. Estratégia: a tabela é quebrada em **chunks de 14 linhas**
(`ITEM_ROWS_PER_CHUNK`), cada chunk vira um bloco com `<thead>` repetido
manualmente; o heading "03 / Itens" vive no MESMO bloco do 1º chunk (nunca
órfão) e o `<tfoot>` com o total só no último. Garantia inegociável:
nenhuma linha cortada ao meio + faixa de setor em toda página. As tabelas
do ManagementReport (status/timeline/custos) são blocos únicos — se
excederem 1 página caem no fluxo do browser (linhas atômicas + thead
repetindo), contadas por estimativa.

### Ficha REDUZIDA (`ReducedWorkSheet`)

Continua no fluxo antigo do browser (várias fichas por A4 com traço de
corte — empacotar várias por página é o objetivo dela). Compatibilidade
com `@page margin: 0`: cada `.reduced-card` ganha em print
`margin-left/right: 8mm` + `padding-top: 5mm` — o card que abre cada
página fica fora da zona não-imprimível.

### CSS de suporte (em `PrintWorkSheetsPage.tsx`)

```css
@media print {
  /* height AUTO em print (2026-06-12): a caixa termina no conteúdo e nunca
     cruza o limite físico da folha (296.9mm no Chrome). A altura fixa de
     294mm existe só no preview em tela. */
  .print-area .pagi-page            { height: auto !important; min-height: 0 !important; break-after: page !important; }
  .print-area .pagi-page:last-child { break-after: auto !important; }
}
```

(Os antigos markers absolutos do `SectorRegion` — rodapé "Setor · Pg
N/Total" a 281mm×i + topo só nas páginas 2+ — foram **removidos**: as
posições ficariam erradas com margin 0/297mm e o requisito agora é
cabeçalho no topo de TODAS as páginas.)

---

## 4. Classes utility do sistema

| Classe | Quando aplicar | Efeito |
|---|---|---|
| `.print-natural` | Container raiz de doc multi-página (espelho de ponto, relatórios novos) | Permite altura natural, herda regras de quebra |
| `.print-area` | Wrapper de fichas de operador (em PrintWorkSheetsPage) | Mesmo que `print-natural` + isola do app chrome |
| `.keep-together` | Qualquer bloco que NÃO PODE quebrar (header, footer, card, KPI grid, tabela completa) | `break-inside: avoid` |
| `.keep-with-next` | Heading ou elemento que deve ficar com o próximo bloco (evita título órfão) | `break-after: avoid` |
| `.keep-with-previous` | Footer ou bloco terminal que deve se ancorar ao anterior (evita footer órfão) | `break-before: avoid` |
| `.page-break` | Container de uma ficha individual (entre fichas distintas) | `page-break-after: always` |
| `.pagi-page` / `.pagi-page--flow` | Gerados pelo `PaginatedSheet` (v7) — NÃO aplicar manualmente | Página A4 explícita / variante de overflow |
| `.flow-card` | Cards de cor/banda/grupo nas fichas v7 | Só atua no edge case de bloco > 1 página: permite fragmentar entre sub-seções, borda fechada por fragmento |

### Primitives compartilhados (já trazem as classes)

| Componente | Localização | Classes embutidas |
|---|---|---|
| `<WorksheetHeader>` | `src/components/production/worksheet/` | `keep-together keep-with-next` |
| `<SignatureFooter>` | `src/components/production/worksheet/` | `keep-together keep-with-previous` |
| `<A4Head>` | `src/components/reports/A4Layout.tsx` | `keep-together keep-with-next` |
| `<A4Foot>` | `src/components/reports/A4Layout.tsx` | `keep-together keep-with-previous` |
| `<Sigs>` | `src/components/reports/A4Layout.tsx` | `keep-together keep-with-previous` |
| `<PaperShell>` | `src/components/reports/A4Layout.tsx` | Wrapper `.paper > .sheet` (herda regras `@media print`) |

---

## 5. Como aplicar em novos componentes imprimíveis

### 5.1 Página A4 simples (1 documento)

```tsx
export function MeuRelatorio() {
  return (
    <PaperShell>
      <A4Head title="Meu Relatório" num="RM-2026-001" />
      <h2 className="p-eyebrow">Resumo Executivo</h2>
      {/* conteúdo */}
      <table>...</table>
      <Sigs labels={['Operador', 'Supervisor']} />
      <A4Foot doc="RM-2026-001" />
    </PaperShell>
  );
}
```

✅ Já vem com tudo correto via primitives.

### 5.2 Multi-documento (múltiplos PVs/fichas em uma só rota de impressão)

```tsx
{documents.map(doc => (
  <div key={doc.id} className="page-break">
    <MeuComponente data={doc} />
  </div>
))}
```

`.page-break` força nova A4 entre documentos distintos.

### 5.3 Página customizada sem A4Layout

```tsx
<div className="print-natural w-[210mm] mx-auto bg-white p-[8mm]">
  {/* Header — não quebra, fica com conteúdo seguinte */}
  <div className="keep-together keep-with-next">
    <h1>Título</h1>
    <p>Subtítulo</p>
  </div>

  {/* Conteúdo principal */}
  <div className="my-4">
    {items.map(item => (
      // Cada item é atômico
      <div key={item.id} className="keep-together border p-3 mb-2">
        ...
      </div>
    ))}
  </div>

  {/* Footer/Assinatura — não quebra E se ancora ao bloco anterior
      (evita virar órfão em pg separada quando o conteúdo é longo). */}
  <div className="keep-together keep-with-previous mt-8">
    Assinaturas...
  </div>
</div>
```

### 5.4 Etiquetas de tamanho fixo

NÃO use `.print-natural`. Use `page-break-inside: avoid` com `@page` específico:

```tsx
<div className="etiqueta-100x30mm" style={{ width: '100mm', height: '30mm' }}>
  ...
</div>
```

```css
@media print {
  @page { size: 100mm 30mm; margin: 0; }
  .etiqueta-100x30mm {
    page-break-inside: avoid;
    page-break-after: always;
  }
}
```

---

## 6. Print via popup vs print direto

O sistema tem 2 mecanismos de print:

### 6.1 Print direto (`window.print()`)

Usado pelas páginas full-screen:
- `EspelhoPontoPage.tsx`
- `OrdersSummary.tsx`
- `PrintWorkSheets.tsx`

CSS de print herda do `index.css` global + `styles-paper.css`.

### 6.2 Print via iframe popup

Usado quando o doc é gerado dinamicamente como HTML standalone:
- `GroupedReportSummary.tsx` → `printHtml(title, html)`
- `EtiquetaProduto.tsx` → `buildThermalLabelsHtml(...)`
- `SaleOrders.tsx Gerar PDF` → `buildSaleOrderPrintHtml(...)`

**Importante:** o iframe popup é um `<html>` standalone — NÃO herda o CSS do app principal. Cada caller precisa embutir as regras CSS de quebra na string HTML gerada (ver `GroupedReportSummary.tsx` linhas 143-160 como referência).

---

## 7. Estrutura de pastas

```
src/
  components/
    reports/
      A4Layout.tsx         ← <A4Head>, <A4Foot>, <Sigs>, <PaperShell>, <PrintBar>
    production/
      worksheet/
        PaginatedSheet.tsx    ← Paginador explícito v7 (+ packBlocks testado)
        WorksheetHeader.tsx   ← Header de ficha de operador
        SignatureFooter.tsx   ← Rodapé com assinaturas
        CompletionFooter.tsx  ← Rodapé de conclusão (Executado/Data/Visto)
        ProductImageBlock.tsx
        SectorAlerts.tsx
        TallyBox.tsx
      [Sector]WorkSheet.tsx   ← 6 worksheets: SilkMontage, Palmilha, etc.
                                (emitem BLOCOS pro PaginatedSheet)
      PrintWorkSheetsPage.tsx ← Orquestrador + CSS @media print local

  index.css              ← .keep-together, .print-natural universais
  styles-paper.css       ← .sheet, .paper, .a4-head, .a4-foot e @page A4

docs/
  PRINT_SPEC.md          ← Este documento
```

---

## 8. Como testar/validar

### 8.1 Visual

```
1. Acesse a página/rota imprimível
2. Cmd+P (Mac) / Ctrl+P (Windows)
3. No preview do browser, role TODAS as páginas
4. Critérios de aceitação:
   ✓ Cabeçalho completo no topo de uma página (nunca dividido)
   ✓ Assinaturas/footer completo no rodapé (nunca dividido)
   ✓ Tabelas: header (thead) repete em cada nova página
   ✓ Cards/KPIs: inteiros em uma única A4
   ✓ Quebras acontecem ENTRE blocos atômicos, não no meio deles
```

### 8.2 DOM inspection (no preview/dev server)

```javascript
// No Console do browser:
document.querySelectorAll('.keep-together').forEach(el => {
  console.log({
    tag: el.tagName,
    classes: el.className.slice(0, 50),
    height: el.scrollHeight,
  });
});
```

### 8.3 Auditoria automatizada

```javascript
// Conta blocos que NÃO têm keep-together e podem quebrar:
const print = document.querySelector('.print-area, .print-natural');
const risky = print.querySelectorAll(
  ':scope > *:not(.keep-together):not([class*="keep"])'
);
console.log(`${risky.length} blocos risco de quebra`);
```

---

## 9. Limitações conhecidas

### 9.1 Relatório Gerencial muito grande

PVs com 15+ OPs ocupam 3-4 páginas A4 (esperado). Header do PV (cliente, KPIs) só aparece na 1ª página — não repete em cada uma. **Aceito** pelo user (24/05/2026): é doc gerencial, leitura sequencial.

Se virar problema futuro, opções:
- Repetir header em cada chunk (mas requer refator do componente)
- Imprimir em A3 (mudar `@page size`)
- Exportar PDF interativo em vez de imprimir

### 9.2 Imagens muito grandes

Imagens (silks, produtos) com altura > 281mm causam overflow não-mitigável. Hoje as silks são limitadas a `w-20 h-20` (80×80px) e produtos `h-12 w-12` (48×48px) — bem dentro do limite.

### 9.3 Browsers antigos

`break-inside: avoid` foi padronizado em 2018. Suportado em Chrome 50+, Firefox 64+, Safari 10+. Sistema só suporta browsers modernos (auth requer Supabase JS SDK).

---

## 10. Histórico de mudanças (commits relevantes)

| Commit | Data | Mudança |
|---|---|---|
| `7362bdf` | 2026-05-21 | v1: força 1 ficha = 1 A4 via tipografia comprimida |
| `c3ac374` | 2026-05-21 | v1.1: empurra assinatura pro pé da página (mt-auto) |
| `8416e84` | 2026-05-24 | v2: PrintPageScaler com scaling dinâmico (DEPRECATED) |
| `613f3ae` | 2026-05-24 | v2.1: chunking de cores/OPs + re-medição robusta |
| `97dc393` | 2026-05-24 | v3: quebra natural multi-página (filosofia geral) |
| `de4d6ca` | 2026-05-24 | v3.1: keep-together em WorksheetHeader + SignatureFooter |
| `b8bbbdf` | 2026-05-24 | v3.2: padrão universal — A4Layout primitives + EspelhoPonto + GroupedReportSummary |
| — | 2026-06-11 | v6: `.flow-card` (fragmenta só entre sub-seções, box-decoration-break: clone) |
| — | 2026-06-12 | **v7: paginação explícita** — `PaginatedSheet` (blocos medidos → páginas 296mm), `@page margin: 0` (mata header/footer do navegador), faixa de cabeçalho "Setor + N/TOTAL" em TODA página, card inteiro ou nada; `SectorRegion` removido |
| — | 2026-06-12 | **v7.1: WYSIWYG + caixa auto em print** — fix do PDF "mesmo erro" (toda página lógica virava 2 físicas): regras de altura (8pt, spacing, table-layout fixed) saíram do `@media print` e valem sempre na `.print-area`; caixa 294mm em tela / `height:auto` em print; `print:p-0 print:space-y-0` no root (fantasma de ~13mm acima da 1ª folha); medição `ceil(getBoundingClientRect)`; `keepWithNext` pro sub-header de grupo não fechar página órfão |
| `4368261` | 2026-06-19 | **v7.2a:** caixa 294→288mm (folga) + auto-fit agressivo −20% sem gate de 15% |
| `b11d08a` | 2026-06-19 | **v7.2b:** fix React #185 (loop) — `measure` só na baseline `scale=1`, nunca o DOM zoomado |
| `816f583` | 2026-06-19 | **v7.2c:** `PRINT_INFLATE` (1.06) — empacota prevendo a altura de IMPRESSÃO; mata a folha branca da página CHEIA (proporcional, não corte fixo) |
| `bad4dbb` | 2026-06-19 | **v7.3:** auditoria multiagente de TODAS as fichas (motor+CSS+6 fichas OK); fix `opacity-60`→`#666` (ManagementReport) + tira `flex` do root da `ReducedWorkSheet` (clip do Chrome) |
| — | 2026-06-19 | **§0: PADRÃO CANÔNICO** — `PaginatedSheet` default p/ A4 in-app variável; regras anti-folha-branca obrigatórias p/ todas; checklist + classificação |

---

## 11. Decisões abertas / TODOs futuros

- [ ] Aplicar `.keep-together` em `OrdersSummary.tsx` (atualmente sem padrão)
- [ ] Aplicar em `PurchaseOrders.tsx` se virar imprimível regular
- [ ] Documentar/padronizar a função `printHtml()` em uma utility compartilhada (atualmente duplicada em `GroupedReportSummary.tsx`, `EtiquetaProduto.tsx`, etc.)
- [ ] Considerar header repetido em ManagementReport multi-página (se virar requisito)

---

**Contato/responsável**: Squad Shoes — Time de Engenharia
**Última revisão**: 2026-06-19 (§0 padrão canônico + v7.2/v7.3)
