# Sistema de Impressão Squad Shoes — Especificação Técnica

> **Documento canônico** das regras de impressão A4 do sistema. Última
> atualização: 2026-05-24. Mantenha sincronizado com mudanças em
> `styles-paper.css`, `index.css` e `PrintWorkSheetsPage.tsx`.

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
  margin: 8mm; /* 4-7mm não-imprimíveis + folga */
}
```

Área útil resultante: **194mm × 281mm** (de 210×297).

---

## 4. Classes utility do sistema

| Classe | Quando aplicar | Efeito |
|---|---|---|
| `.print-natural` | Container raiz de doc multi-página (espelho de ponto, relatórios novos) | Permite altura natural, herda regras de quebra |
| `.print-area` | Wrapper de fichas de operador (em PrintWorkSheetsPage) | Mesmo que `print-natural` + isola do app chrome |
| `.keep-together` | Qualquer bloco que NÃO PODE quebrar (header, footer, card, KPI grid, tabela completa) | `break-inside: avoid` |
| `.keep-with-next` | Heading ou elemento que deve ficar com o próximo bloco (evita título órfão) | `break-after: avoid` |
| `.page-break` | Container de uma ficha individual (entre fichas distintas) | `page-break-after: always` |

### Primitives compartilhados (já trazem as classes)

| Componente | Localização | Classes embutidas |
|---|---|---|
| `<WorksheetHeader>` | `src/components/production/worksheet/` | `keep-together keep-with-next` |
| `<SignatureFooter>` | `src/components/production/worksheet/` | `keep-together` |
| `<A4Head>` | `src/components/reports/A4Layout.tsx` | `keep-together keep-with-next` |
| `<A4Foot>` | `src/components/reports/A4Layout.tsx` | `keep-together` |
| `<Sigs>` | `src/components/reports/A4Layout.tsx` | `keep-together` |
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

  {/* Footer/Assinatura — não quebra */}
  <div className="keep-together mt-8">
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
        WorksheetHeader.tsx   ← Header de ficha de operador
        SignatureFooter.tsx   ← Rodapé com assinaturas
        ProductImageBlock.tsx
        SectorAlerts.tsx
        TallyBox.tsx
      [Sector]WorkSheet.tsx   ← 6 worksheets: SilkMontage, Palmilha, etc.
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
| `97dc393` | 2026-05-24 | v3: quebra natural multi-página (filosofia atual) |
| `de4d6ca` | 2026-05-24 | v3.1: keep-together em WorksheetHeader + SignatureFooter |
| `b8bbbdf` | 2026-05-24 | v3.2: padrão universal — A4Layout primitives + EspelhoPonto + GroupedReportSummary |

---

## 11. Decisões abertas / TODOs futuros

- [ ] Aplicar `.keep-together` em `OrdersSummary.tsx` (atualmente sem padrão)
- [ ] Aplicar em `PurchaseOrders.tsx` se virar imprimível regular
- [ ] Documentar/padronizar a função `printHtml()` em uma utility compartilhada (atualmente duplicada em `GroupedReportSummary.tsx`, `EtiquetaProduto.tsx`, etc.)
- [ ] Considerar header repetido em ManagementReport multi-página (se virar requisito)

---

**Contato/responsável**: Squad Shoes — Time de Engenharia
**Última revisão**: 2026-05-24
