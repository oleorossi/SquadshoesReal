# Handoff — Caixa Externa redimensionada para 198×132mm

## O que mudou

Etiquetas **Caixa Externa A** (`buildBoxIdentificationHtml`) e **Caixa Externa B** redimensionadas de **150×100mm** (567×378px) → **198×132mm** (748×499px) para caber 2 por folha A4 com mais espaço útil.

### Tipografia e bordas escaladas proporcionalmente

| Elemento | Antes | Agora |
|---|---|---|
| Wrapper externo | 567×378 / pad 16 | **748×499 / pad 18** |
| Wrapper interno | 535×346 | **712×463** |
| NF (Anton, destaque preto) | 26px | **34px** |
| NF label "NF:" | 11px | 13px |
| PROG label / valor | 10 / 13px | 11.5 / 14px |
| Destinatário labels (CLIENTE, CNPJ, etc) | 8.5px / col 64px | **10px / col 76px** |
| Destinatário valores | 10px | **12px** |
| Foto produto (ShoePhoto) | 220×170px | **310×240px** |
| Padding bloco destinatário | 6px 10px | 8px 14px |
| Tabela grade · labels esquerda | 8.5px / col 88px | **10px / col 110px** |
| Tabela grade · TAMANHO header | 11px | 13px |
| Tabela grade · QUANTIDADE células | 12px | **16px** |
| Tabela grade · TT total | 13px | **18px** |
| REF row (H27250) | 10px | **14px** |
| SilkMark altura | 18px | 22px |
| SILK legend (ao lado SilkMark) | 8px | 10px |
| PEDIDO/VOLUME labels | 11px | 13px |
| PEDIDO/VOLUME valores (Anton) | 22px | **28px** |
| VOLUME separador "/" | 12px | 16px |

### Mantido
- Cor de fundo `#FFE94A` (amarelo fluorescente)
- Borda externa 1.5px preta
- Header NF com fundo preto / amarelo
- Rodapé PEDIDO/VOLUME com fundo preto / amarelo
- Estrutura de 2 colunas (destinatário | foto)
- Tabela MARCA / REFERENCIA / TAMANHO / QUANTIDADE no rodapé
- SilkMark definido pelo solado (regra de negócio)

## Arquivo neste pacote

- `screen-etiquetas.jsx` — contém `EtqCxExt`, `EtqCxExtB` e helpers (`ShoePhoto`, `SilkMark`, `silkBySolado`, `ColorChips`, `RefChip`, `Barcode`).

## Como aplicar no codebase real

No seu `src/lib/printLabels.ts`, atualize `buildBoxIdentificationHtml`:

```ts
const LABEL_W_MM = 198;
const LABEL_H_MM = 132;
const PAGE_MARGIN_MM = 9;  // 9mm margem lateral A4

// 1 folha A4 portrait (210×297mm) = 2 etiquetas empilhadas verticalmente
// Cada etiqueta: 198mm × 132mm com margem ~6mm entre elas
```

CSS print:
```css
@page { size: A4; margin: 9mm; }
.label-cx-ext {
  width: 198mm; height: 132mm;
  background: #FFE94A;
  border: 1.5px solid #000;
  page-break-inside: avoid;
  display: flex; flex-direction: column;
}
.label-cx-ext + .label-cx-ext { margin-top: 6mm; }
.label-cx-ext .nf-headline { font-family: 'Anton'; font-size: 34px; }
.label-cx-ext .pedido-vol  { font-family: 'Anton'; font-size: 28px; }
.label-cx-ext .qtd-cell    { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 16px; }
```

## Prompt para Claude Code

> Tenho `cxext_198x132_handoff/` com o redimensionamento das etiquetas Caixa Externa A e B (`buildBoxIdentificationHtml` em `src/lib/printLabels.ts`) de 150×100mm para **198×132mm**, com fontes e bordas escaladas proporcionalmente. Leia o `README.md`, abra `screen-etiquetas.jsx` para ver o JSX de referência e atualize meu builder HTML com as novas dimensões e tamanhos de fonte. Mantenha 2 etiquetas por folha A4 portrait com margem de corte entre elas. Não copie o JSX direto — use as estruturas/classes que já tenho no projeto.
