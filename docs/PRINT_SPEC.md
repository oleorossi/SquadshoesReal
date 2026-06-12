# Sistema de Impressão Squad Shoes — Especificação Técnica

> **Documento canônico** das regras de impressão A4 do sistema. Última
> atualização: 2026-06-12. Mantenha sincronizado com mudanças em
> `styles-paper.css`, `index.css` e `PrintWorkSheetsPage.tsx`.
>
> ⚠ **Fichas de operador + Relatório Gerencial (rota /print-worksheets)
> usam o modelo v7 — paginação explícita por medição (`PaginatedSheet`),
> seção 3-B.** A quebra natural do browser (seção 3) continua valendo pros
> demais imprimíveis (relatórios A4 avulsos, espelho de ponto, popups).

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
   (margens internas ficam contidas → `offsetHeight` mede a altura real).
   Re-medição via `ResizeObserver` por bloco (cobre imagem chegando
   tarde), `beforeprint` (com `flushSync` pro snapshot do print pegar o
   DOM repaginado), `matchMedia('print')` e `resize`.
3. **Empacotamento** (`packBlocks`, puro/testado): first-fit sequencial,
   sem reordenar. Se o próximo bloco não cabe no espaço restante → fecha
   a página (**resto fica em branco**) e o bloco abre inteiro a próxima.
4. **Páginas explícitas**: divs `210mm × 296mm` (1mm aquém dos 297mm
   físicos pra arredondamento sub-pixel não derramar numa folha em
   branco), `box-sizing: border-box`, padding **6mm topo / 8mm laterais /
   8mm base** (substitui a margem do @page) e `page-break-after` entre
   elas. Em tela aparecem como cartões A4 empilhados (preview fiel).
5. **Faixa de cabeçalho em TODA página, inclusive a 1ª**: 6mm de altura,
   hairline preto inferior, Fira Code mono uppercase — nome do setor à
   esquerda + **"N/TOTAL"** (ex.: 3/8) à direita. A contagem é **dentro
   da ficha** (cada `PaginatedSheet` numera as próprias páginas).
6. **Mudança de setor/ficha = nova página**: cada ficha continua dentro
   de um `.page-break` próprio; a última página explícita da ficha tem
   `break-after: auto` e o `.page-break` pai força a quebra (evita breaks
   duplos virarem folha em branco).

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

### Exceção: bloco maior que 1 página inteira

Ganha página própria com `height: auto; min-height: 296mm` e **flui** — o
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
  .print-area .pagi-page       { height: 296mm !important; break-after: page !important; }
  .print-area .pagi-page--flow { height: auto !important; min-height: 296mm !important; }
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

---

## 11. Decisões abertas / TODOs futuros

- [ ] Aplicar `.keep-together` em `OrdersSummary.tsx` (atualmente sem padrão)
- [ ] Aplicar em `PurchaseOrders.tsx` se virar imprimível regular
- [ ] Documentar/padronizar a função `printHtml()` em uma utility compartilhada (atualmente duplicada em `GroupedReportSummary.tsx`, `EtiquetaProduto.tsx`, etc.)
- [ ] Considerar header repetido em ManagementReport multi-página (se virar requisito)

---

**Contato/responsável**: Squad Shoes — Time de Engenharia
**Última revisão**: 2026-05-24
