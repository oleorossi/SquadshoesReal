# Instruções de implementação · Squad Shoes

## Para o usuário (não-dev)

### 1. Onde está esse zip
Quando você clicar em "Download" no chat, o navegador salva o zip em `~/Downloads` (Mac/Linux) ou `C:\Users\seu-usuario\Downloads` (Windows).

### 2. Mover para o projeto
Abra o terminal **na raiz do projeto Squad Shoes** (a pasta que tem `src/`, `package.json`, etc) e rode:

```bash
# Mac / Linux:
unzip ~/Downloads/squad_shoes_COMPLETO.zip

# Windows (PowerShell):
Expand-Archive -Path "$env:USERPROFILE\Downloads\squad_shoes_COMPLETO.zip" -DestinationPath .
```

Depois confirme:
```bash
ls squad_shoes_COMPLETO/
```
Tem que mostrar `README.md`, `INSTRUCOES.md` e a pasta `_design/`.

### 3. Abrir o Claude Code
Ainda na raiz do projeto:
```bash
claude
```

### 4. Colar este prompt (cópia e cola)

```
Acabei de adicionar a pasta squad_shoes_COMPLETO/ ao meu projeto. Ela tem o redesign visual completo da Squad Shoes em React/HTML como REFERÊNCIA.

Etapas:

PASSO 1 - LER E ENTENDER
- Leia squad_shoes_COMPLETO/README.md (visão geral)
- Leia squad_shoes_COMPLETO/_design/styles-paper.css (tokens de cor, tipografia, classes base)
- Abra squad_shoes_COMPLETO/_design/screen-etiquetas.jsx e localize: MODELOS, RefChip, ColorChips, ShoePhoto, SilkMark, silkBySolado, Barcode, MiniMark. Esses são os componentes-base que vamos portar.

PASSO 2 - AUDITAR MEU CODEBASE
- Identifique a stack (framework, design system, fontes, organização)
- Encontre src/lib/printLabels.ts, src/components/production/, src/components/label-system/
- Veja se já existem componentes como Pill, Card, Table, Sidebar — se sim, vou reutilizar

PASSO 3 - APRESENTAR PLANO ANTES DE CODIFICAR
Antes de gerar QUALQUER código, me mostre:
(a) Quais arquivos do meu projeto serão tocados
(b) Quais componentes novos precisam ser criados (com pasta de destino)
(c) Ordem de fases proposta
Espere meu OK antes de seguir.

PASSO 4 - IMPLEMENTAR EM FASES PEQUENAS

Fase A · Design tokens
- Importar fontes Anton, Inter Tight, JetBrains Mono (via @fontsource ou Google Fonts)
- Adicionar variáveis CSS (--p-bg, --p-paper, --p-soft, --p-line, --p-line-2, --p-ink, --p-ink-2, --p-mute, --p-dim, --p-red, --p-red-soft, --p-ok, --p-warn, --p-info) ao tema global

Fase B · Componentes base (criar em src/components/ui/)
- RefChip.tsx (prop "code" não "ref" pois ref é reservada no React)
- ColorChips.tsx (size xs/sm/md/lg, showLabels, showNames)
- ShoePhoto.tsx (variant soft/photo/photo-yellow, fallback SVG)
- SilkMark.tsx (silk HOST/NOVA/PRIME/ICON + função silkBySolado)
- MiniMark.tsx (logo da marca em quadrado)
- Barcode.tsx (use a lib jsbarcode se ainda não estiver instalada)

Fase C · Etiquetas (atualizar src/lib/printLabels.ts)
- buildBoxIdentificationHtml: usar EtqCxExt como referência. 198×132mm, fundo #FFE94A, header NF em destaque (Anton 34px sobre faixa preta), foto grande 310×240, tabela com MARCA=SilkMark, REFERENCIA, TAMANHO, QUANTIDADE no rodapé, PEDIDO+VOLUME em faixa preta
- buildThermalLabelsHtml: usar EtqCxInd como referência. 100×60mm, foto à esquerda, dados à direita, REF chip, numeração massiva em vermelho, barcode
- buildThermalLabelsZpl: gerar ZPL equivalente ao HTML acima (use ^XA...^XZ, ^FO, ^A0N para fontes)
- buildIndividualLabelsHtml: usar EtqCxIndB ou CartaoOP como referência
- buildHangtagHtml: usar EtqPar como referência. 50×80mm, furo de pendurar, REF chip, numeração

Fase D · Fichas de Operador (atualizar src/components/production/*.tsx)
Mapeamento sugerido no README.md "Mapeamento JSX → projeto"

Fase E · Páginas
- src/components/label-system/LabelProductionTab.tsx ← usar screen-etiquetas-menu como referência
- src/components/production/PrintWorkSheetsPage.tsx ← usar conceito "Imprimir Fichas" do screen-finais-2

PASSO 5 - PARA CADA TELA OU DOCUMENTO PORTADO
- Cite no commit qual arquivo de referência foi usado (ex: "ref: squad_shoes_COMPLETO/_design/screen-clientes.jsx · ComercialClientes")
- Mostre preview do resultado antes de commitar
- Espere meu OK

REGRAS GERAIS
- NUNCA copie o JSX direto. Adapte aos padrões do meu projeto.
- Mantenha tipos TypeScript estritos se for um projeto TS.
- Reaproveite componentes existentes em src/components/ui/ se já existirem equivalentes.
- Comente cada arquivo novo dizendo qual referência foi usada.
- Para CSS de impressão, use @page A4 + page-break-inside: avoid nas etiquetas.
- Cores em variáveis CSS, nunca hardcoded fora do tema.

Comece pelo PASSO 1.
```

### 5. Acompanhe a conversa
O Claude Code vai ler tudo, te apresentar um plano e esperar seu OK. Você responde "ok, pode seguir" para cada fase. Ele commit a cada fase, então você pode reverter qualquer parte que não gostar.

---

## Para o desenvolvedor

### Stack alvo identificada no contexto
Projeto React/TypeScript com:
- `src/lib/printLabels.ts` (builders HTML para impressão)
- `src/components/production/*.tsx` (fichas/relatórios)
- `src/components/label-system/LabelProductionTab.tsx` (rota /etiquetas)
- `src/lib/print*.ts` (helpers de impressão A4 + window.print)

### Tokens essenciais (variáveis CSS)
```css
:root {
  --p-bg: #F4F2EE; --p-paper: #FFFFFF; --p-soft: #FAF8F5;
  --p-line: #E4E0D9; --p-line-2: #CFC9BF;
  --p-ink: #14110E; --p-ink-2: #3A3631; --p-mute: #76706A; --p-dim: #A39C92;
  --p-red: #B7141F; --p-red-soft: #FBE9EB;
  --p-ok: #1F7A4D; --p-warn: #8A5A00; --p-info: #0D4F8A;
}
```

### Fontes
- **Anton** — display (KPIs grandes, números massivos, títulos de seção)
- **Inter Tight** — body / labels
- **JetBrains Mono** — códigos (REF, OP, SKU), tabular numbers, eyebrows

### Etiquetas — dimensões finais

| Builder | Dimensões mm | Pixels @96dpi |
|---|---|---|
| buildBoxIdentificationHtml (Caixa Externa) | **198 × 132** landscape, 2 por A4 portrait | 748 × 499 |
| buildThermalLabelsHtml (Caixa Individual A) | 100 × 60 | 378 × 227 |
| buildThermalLabelsHtml (variante B com tiras) | 100 × 100 | 378 × 378 |
| buildIndividualLabelsHtml | 100 × 100 ou A5 (148 × 210) | 378 × 378 / 559 × 794 |
| buildHangtagHtml | 50 × 80 | 189 × 302 |

### Regra de negócio importante: SILK ↔ SOLADO
Na etiqueta de Caixa Externa, o campo "MARCA" é o **SILK** (logo estampado no calçado). O silk é determinado pelo **solado** do produto:

```typescript
const SOLADO_TO_SILK: Record<string, string> = {
  'TR-04': 'HOST', 'TR-PR': 'HOST', 'TR-09': 'HOST', 'TR-14': 'HOST',
  'TR-12': 'NOVA', 'EVA-22': 'NOVA', 'TR-21': 'NOVA',
  'PU-08': 'PRIME', 'COURO-A': 'PRIME',
};
export const silkBySolado = (solado: string) => SOLADO_TO_SILK[solado] ?? 'HOST';
```

Crie as tabelas `silks` e `solado_silks` no banco se ainda não existirem.

### Hierarquia no header da Caixa Externa
**NF em destaque** (Anton 34px, faixa preta com texto amarelo) — é o que o conferente da loja procura primeiro. **PROG** e **FICHA** ficam como metadata secundária à direita.
