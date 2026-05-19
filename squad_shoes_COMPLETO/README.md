# Squad Shoes — Handoff de Design COMPLETO

**Para o desenvolvedor (Claude Code):**
Esta pasta contém o redesign visual completo do sistema Squad Shoes. Os arquivos `.jsx` e `.css` em `_design/` são **referências de design** criadas em React/HTML — não são código de produção. Sua tarefa é **recriar estes designs na stack atual** do projeto (React/TS, Next, Vue, etc) reaproveitando os componentes e tokens já existentes lá.

---

## Como o usuário deve aplicar isso

### Passo 1 — Mover esta pasta para dentro do projeto real
```bash
cd ~/caminho/para/seu-projeto/squad-shoes
unzip ~/Downloads/squad_shoes_COMPLETO.zip
ls squad_shoes_COMPLETO/   # deve mostrar README.md, _design/, INSTRUCOES.md
```

### Passo 2 — Abrir o Claude Code
```bash
claude
```

### Passo 3 — Colar este prompt

```
Tenho a pasta squad_shoes_COMPLETO/ no projeto com o redesign completo do sistema Squad Shoes.

1. Comece lendo squad_shoes_COMPLETO/README.md e squad_shoes_COMPLETO/INSTRUCOES.md em ordem.
2. Faça uma varredura no meu codebase para identificar a stack (framework, design system, padrões de componente, organização de pastas).
3. Antes de gerar qualquer código, me mostre um plano: (a) quais arquivos do meu projeto serão tocados, (b) quais componentes novos precisam ser criados, (c) ordem de implementação proposta.
4. Implementação em fases pequenas: design tokens → componentes base (RefChip, ColorChips, ShoePhoto, SilkMark) → uma tela web → uma etiqueta → ficha A4 → resto. Commit após cada fase.
5. Para CADA tela ou documento que portar, abra o JSX de referência em squad_shoes_COMPLETO/_design/ e cite o nome do arquivo no commit.
6. NUNCA copie JSX direto. Adapte para meus padrões.
```

---

## O que tem dentro de `_design/`

### Arquivo principal de visualização
- `Squad Shoes · Pedidos & Documentos.html` — abre num navegador e mostra todas as 32 seções num canvas

### Estilos / tokens
- `styles-paper.css` — **PRINCIPAL** · cores, tipografia, .a4-head, .light-card, .p-tbl, .p-kpi, etc
- `styles.css` — base do app dark (referência secundária)

### Componentes compartilhados (CRÍTICOS)
- `screen-etiquetas.jsx` — `MODELOS`, `RefChip`, `ColorChips`, `ShoePhoto`, `SilkMark`, `Barcode`, `MiniMark`, `silkBySolado`, + 5 etiquetas térmicas + Cartão de OP A5
- `icons.jsx` — set de ícones SVG
- `paper-icons.jsx` — Logo, QR
- `components.jsx` — helpers diversos
- `design-canvas.jsx` — wrapper do canvas (não precisa portar)

### Telas web (33 telas em 32 arquivos)

**Comercial:** screen-pedido, screen-pronta-entrega, screen-clientes, screen-tabela-precos, screen-extras-2 (CRM, SAC, Forecast)

**Produção:** screen-pcp, screen-ordens, screen-prod-live, screen-prod-timeline, screen-capacidade, screen-cc-qual, screen-picking, screen-finais-2 (Imprimir, Fluxo, Terceirizados, Automações, Sessões)

**Engenharia:** screen-ficha-tecnica, screen-solados, screen-silks, screen-receitas

**Estoque:** screen-estoque-ajustes (Materiais, Acabados, LightShell, SIDEBAR_NAV, Ajustes, Templates), screen-estoque-extra (Histórico, MRP)

**Compras:** screen-compras-oc, screen-fornecedores, screen-finais-1 (Custos, Planejamento, Painel Fin, CNAB)

**Logística:** screen-logistica-1 (Expedição, Conferência), screen-logistica-2 (Romaneios, Transportadoras, Entregas), screen-etiquetas-menu

**Financeiro:** screen-financeiro (NF-e, CT-e, MDF-e, Contas), screen-finais-1 (Painel, CNAB, Markup), screen-extras-3 (Markup, Conciliação, Segurança)

**RH:** screen-rh-auditoria (Painel RH, Banco Horas, Auditoria), screen-finais-2 (Terceirizados)

**Sistema:** screen-estoque-ajustes (Ajustes, Templates), screen-rh-auditoria (Auditoria), screen-extras-3 (Segurança), screen-finais-2 (Automações)

**Documentos A4:** screen-relatorios (Diário, OP, OEE, Qualidade, Refugo, Paradas, Consumo, Semanal), screen-fichas-operador (Perfil, Apontamento, Roteiro, Instrução, Produtividade)

**Painel:** screen-painel

---

## Mapeamento — JSX de referência → arquivo do projeto real

| JSX referência | Arquivo destino no projeto |
|---|---|
| `screen-etiquetas.jsx · EtqCxExt`, `EtqCxExtB` | `src/lib/printLabels.ts · buildBoxIdentificationHtml` |
| `screen-etiquetas.jsx · EtqCxInd`, `EtqCxIndB`, `EtqCxIndMini` | `src/lib/printLabels.ts · buildThermalLabelsHtml` + `buildThermalLabelsZpl` |
| `screen-etiquetas.jsx · EtqPar` | `src/lib/printLabels.ts · buildHangtagHtml` |
| `screen-etiquetas.jsx · CartaoOP` | `src/lib/printLabels.ts · buildIndividualLabelsHtml` |
| `screen-fichas-operador.jsx · FichaApontamento` | `src/components/production/OperatorWorkSheet.tsx` |
| `screen-fichas-operador.jsx · FichaRoteiro` | `src/components/production/ExpedicaoWorkSheet.tsx` |
| `screen-fichas-operador.jsx · FichaInstrucao` (Costura) | `src/components/production/SilkMontageWorkSheet.tsx` |
| `screen-fichas-operador.jsx · FichaPerfilOp`, `FichaProdutividade` | `src/components/production/ManagementReport.tsx` |
| `screen-fichas-operador.jsx` (variações) | `src/components/production/PalmilhaWorkSheet.tsx`, `SolagemWorkSheet.tsx` |
| Componente `RefChip` (em screen-etiquetas.jsx) | `src/components/ui/RefChip.tsx` (criar) |
| Componente `ColorChips` | `src/components/ui/ColorChips.tsx` (criar) |
| Componente `SilkMark` + `silkBySolado` | `src/components/ui/SilkMark.tsx` (criar) |
| Componente `ShoePhoto` | `src/components/ui/ShoePhoto.tsx` (criar) |
| `SIDEBAR_NAV` (em screen-estoque-ajustes.jsx) | `src/components/layout/SidebarNav.tsx` |
| `LightShell` | `src/components/layout/AppShell.tsx` |
| Pages tipo `LabelProductionTab.tsx` | conferir as 5 versões em screen-etiquetas-menu |

---

Veja `INSTRUCOES.md` para o passo-a-passo detalhado.
