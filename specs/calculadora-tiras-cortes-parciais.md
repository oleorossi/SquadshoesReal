# Calculadora de Tiras — Cortes Parciais (rendimento por comprimento)

## Goal
Adicionar à página **Calculadora de Tiras** uma seção "Cortes Parciais": uma tabela
onde o usuário lista **comprimentos parciais de rolo** (em mm por padrão) e vê, para
cada um, **quanto de tira sai** e **quanto custa** aquele trecho — sem ter que
recalcular o rolo inteiro um por um. Serve pra quem corta só um pedaço do rolo
(ex.: "corto só 30 mm, quanto tiro?") e quer a resposta na mesma tela.

## Background / Problem
Hoje a calculadora (`src/pages/StrapCalculator.tsx` + `src/lib/strapYield.ts`) devolve
o rendimento por metro linear e o **total do rolo inteiro** (comprimento do rolo × taxa).
Pra saber quanto sai de um trecho parcial, o usuário precisa apagar o "Comprimento do
rolo", digitar o trecho, clicar Calcular, anotar, e repetir pra cada tamanho — perdendo
a referência do rolo cheio a cada vez. O Leonardo quer ver **vários comprimentos
parciais de uma vez**, numa tabela fixa na página, mantendo o cálculo principal intacto.

> Nota de origem: o exemplo "corto só 30 milímetros" é **literal** — os cortes parciais
> são pensados em **milímetros**, não em metros. Daí a tabela ser em mm por padrão.

## Scope

### In scope
- Nova seção **"Cortes Parciais"** fixa na coluna de resultado da página (não é modal).
- Tabela com linhas de comprimento **editáveis**: presets prontos + adicionar/remover
  linhas + restaurar presets.
- Cada linha mostra: **comprimento** (editável), **tira que sai** (m) e **custo** (R$).
- **Seletor único de unidade** pra tabela toda (`mm` / `cm` / `m`), padrão **`mm`**.
- Reaproveita a **mesma taxa de rendimento e o mesmo custo** do cálculo principal
  (largura do material, largura da tira, perda, custo por metro linear).
- Helper puro de cálculo em `src/lib/strapYield.ts` + teste unitário.
- Polimento visual da seção seguindo o **artifact-design** e a estética Industrial
  Editorial Pro já usada na página (tokens, `tabular-nums`, acento vermelho).

### Out of scope (explicitamente não agora)
- **Linha de total / soma** das linhas — as linhas são cenários independentes (decisão
  do usuário). Nada de rodapé somando tira/custo.
- Modal / janela sobreposta — foi decidido seção fixa na página.
- Cálculo por **largura parcial** do material (retalho estreito) — este spec é só
  comprimento parcial.
- Sentido **inverso** ("preciso de X m de tira → quanto de rolo passar") — não pedido.
- Persistir as linhas entre sessões (localStorage/banco) — a tabela é efêmera.
- Qualquer mudança no motor de corte do PV (`strapRollCut.ts`), débito, ou consumo real.
  Esta é uma ferramenta de **estimativa/orçamento**, igual ao resto da página.

## Requirements
Numerados, testáveis, cada um um "must":

1. A página **Calculadora de Tiras** exibe uma seção **"Cortes Parciais"** dentro da
   coluna de resultado, **abaixo** dos cards existentes (Rendimento → Total no rolo →
   Custo), e **acima** do aviso de estimativa fixo.
2. A seção só renderiza quando há um cálculo válido (mesma condição do bloco de
   resultado atual: `result?.valid === true`). Antes de Calcular, ou com entrada
   inválida, a seção **não aparece** (mantém o empty state / aviso atuais da página).
3. A **taxa** usada pelas linhas vem do **snapshot submetido** (`submitted` /
   `result.metragemPorMetroLiq`), não das entradas ao vivo — assim a tabela é
   consistente com o número-herói. Quando as entradas principais mudam sem recalcular,
   vale a mesma sinalização "Dados alterados — recalcular" já existente.
4. A tabela nasce com **presets** de comprimento (em mm): **30, 50, 100, 300, 500,
   1000**. Cada preset é uma linha.
5. O usuário pode **adicionar** uma linha (campo de comprimento vazio, foco nela) e
   **remover** qualquer linha (inclusive presets).
6. Existe uma ação **"Restaurar presets"** que descarta as linhas atuais e recoloca os
   6 presets padrão.
7. O comprimento de cada linha é **editável** via `NumberInput` (mesmo componente da
   página), respeitando a unidade selecionada.
8. Há **um seletor de unidade** que vale pra **tabela inteira**, com opções `mm`, `cm`,
   `m`, **padrão `mm`**. Trocar a unidade **reinterpreta** os valores digitados na nova
   unidade (não converte o número — ver Edge cases) — decisão registrada abaixo.
9. Para cada linha com comprimento `L > 0`, a coluna **"Tira que sai"** mostra
   `metragemPorMetroLiq × L_em_metros`, em **metros** (`m`), com 2–3 casas pt-BR.
10. A coluna **"Custo"** só aparece **quando o custo do material foi informado**
    (mesma condição do card de custo atual: `result.custoMaterialRolo != null`). Quando
    aparece, cada linha mostra `custoMetroLinear × L_em_metros`, em `formatCurrency`.
    Quando não há custo, a coluna some (ou fica oculta) — sem placeholder de R$ 0,00.
11. Linhas com comprimento vazio ou `≤ 0` mostram **"—"** nas colunas de resultado (não
    erro, não some a linha).
12. O cálculo fica num **helper puro** em `src/lib/strapYield.ts` (ex.:
    `partialCutYield`), coberto por teste unitário, e a UI só formata.
13. A seção segue o **design system** da página: `Card`/tokens (sem cor hardcoded),
    números em `font-mono tabular-nums`, acento vermelho como os outros cards; passa
    no `npm run check:tokens`. Layout funciona em **360px** de largura.

## Data model / Domain
**Sem migração de banco. Sem tabela nova. Sem alteração de schema.** É UI + lib pura.

Estado local novo em `StrapCalculator.tsx`:
- `unidadeParcial: 'mm' | 'cm' | 'm'` — padrão `'mm'`.
- `linhasParciais: { id: string; comprimento: number }[]` — inicial = 6 presets em mm.

Helper novo (assinatura sugerida, ajustável no build):
```ts
// src/lib/strapYield.ts
export interface PartialCutRow {
  /** metros de tira que saem do trecho (metragemPorMetroLiq × L_m). */
  tiraM: number;
  /** custo do trecho (custoMetroLinear × L_m), ou null se sem custo. */
  custo: number | null;
}
/** L em metros já convertido; degrada p/ zeros se L<=0. */
export function partialCutYield(
  metragemPorMetroLiq: number,
  comprimentoM: number,
  custoMetroLinear?: number | null,
): PartialCutRow;
```
Conversão de unidade → metros: `mm ÷ 1000`, `cm ÷ 100`, `m × 1`.

Fórmula (idêntica em espírito à taxa já validada em `strapYield.ts`):
- `tira_m = metragemPorMetroLiq × comprimento_em_metros`
- `custo = custoMetroLinear × comprimento_em_metros` (quando custo informado)

Exemplo de sanidade (rolo 1370 mm, tira 18 mm, perda 15% → taxa 64,694 m/m; custo
R$ 19,90/m): 30 mm = 0,03 m → tira ≈ **1,94 m**, custo ≈ **R$ 0,60**.

## User flows

### Happy path
1. Usuário abre **Calculadora de Tiras**, preenche largura do material, largura da
   tira, perda, comprimento do rolo (e opcionalmente o custo) e clica **Calcular**.
2. Aparece o resultado principal (rendimento, total no rolo, custo) **e** a nova seção
   **"Cortes Parciais"**, já preenchida com os presets (30…1000 mm) e, ao lado de cada
   um, a tira que sai e (se houver custo) o custo.
3. Usuário edita um preset (ex.: troca 30 por 45), adiciona uma linha nova (ex.: 250),
   remove as que não interessam — a tira e o custo de cada linha recalculam na hora.
4. Usuário troca o seletor de unidade pra `cm` — a tabela passa a interpretar os
   números em cm (rótulos e presets se ajustam; ver Edge cases).
5. Usuário clica **Restaurar presets** pra voltar aos 6 padrões em mm.

### Alternate / edge flows
- **Sem custo informado:** a coluna Custo não aparece; a tabela mostra só comprimento e
  tira. Bate com o card de custo, que também some.
- **Entrada principal alterada sem recalcular:** aparece o aviso "Dados alterados —
  recalcular"; a tabela continua mostrando a taxa do último cálculo até recalcular.
- **Restaurar padrão (botão existente da página):** zera o formulário e o resultado;
  a seção some junto (não há `result`). Ao recalcular, presets voltam.

## Edge cases & failure modes
- **Comprimento vazio / 0 / negativo** → linha permanece; colunas de resultado mostram
  "—". Não bloqueia nem some a linha.
- **Comprimento maior que o rolo** (ex.: 60000 mm com rolo de 40 m): **permite e
  calcula** (o modelo é razão idealizada, igual ao resto da página), mas mostra uma
  **dica âmbar sutil** na linha ("maior que o rolo") — não bloqueante.
- **Troca de unidade (`mm`↔`cm`↔`m`):** decisão = **reinterpretar**, não converter o
  número digitado. Ou seja, "30" em mm, ao mudar pra cm, continua "30" (agora 30 cm).
  Os **presets** também são reinterpretados/reaplicados na unidade escolhida ao usar
  "Restaurar presets". (Racional: evita números quebrados como 3,0 e mantém a tabela
  simples. Se no build isso incomodar, alternativa é converter preservando o valor
  físico — anotar e decidir com o usuário; **default = reinterpretar**.)
- **Muitas linhas:** sem limite rígido; a tabela rola/quebra bem em 360px. Sem
  paginação (uso esperado é dezenas, não centenas).
- **Precisão:** cálculo em precisão total no helper; UI arredonda (tira 2–3 casas,
  custo via `formatCurrency`). Não comparar valores exatos (dízimas).
- **`id` das linhas:** gerar de forma estável **sem `Math.random`/`Date.now`** (proibidos
  no ambiente de workflow, e boa prática aqui) — usar contador incremental em `useState`.

## Constraints & assumptions
- **Stack/estilo:** React + TS loose; reutilizar `Card`, `Label`, `NumberInput`,
  `Button` de `@/components/ui/*`; ícones **`@phosphor-icons/react`** (não lucide);
  `sonner` se precisar de toast (provavelmente não precisa). Sem `react-hook-form` —
  seguir o padrão `useState` controlado da própria página.
- **Design tokens obrigatórios** (nada de `bg-white`/`text-gray-*`): rodar
  `npm run check:tokens` após os edits. Mobile-first 360px.
- **Typecheck canônico:** `bunx tsc -p tsconfig.app.json --noEmit` antes de commitar
  (a raiz não checa nada). Símbolo indefinido só estoura em runtime.
- **artifact-design:** usado como **guia de design** pra deixar a tabela elegante
  (hierarquia, densidade, alinhamento numérico, contraste claro/escuro). O entregável
  é um **componente React in-app**, não uma página HTML/Artifact. Opcional no build:
  gerar um **mockup HTML como Artifact** só pra pré-visualizar o visual antes de
  codar — decisão do momento do build, não obrigatório.
- **Assunção (taxa via snapshot):** a tabela usa `result`/`submitted` (pós-Calcular),
  não entradas ao vivo, pra ficar consistente com o número-herói. Se o usuário preferir
  a tabela reativa ao digitar (sem clicar Calcular), é uma troca simples — **default =
  snapshot**.
- **Assunção (custo por metro de tira):** é constante entre as linhas (não depende do
  comprimento), então **não** vira coluna por linha; continua no card de custo
  existente. A tabela mostra só o **custo do trecho**.
- **Não tocar:** `strapRollCut.ts` (motor do PV), débito/reserva/consumo, schema do
  banco. Sem migração.

## Open questions
- Troca de unidade **reinterpreta** (default escolhido) vs **converte** o valor físico —
  confirmar no build se o comportamento default incomodar na prática.
- Se algum dia quiser somar as linhas (planejar um lote), abrir como incremento — hoje
  está **fora de escopo** por decisão do usuário.

## Definition of Done
Checklist verificável item a item:

- [ ] **R1/R2:** Na Calculadora de Tiras, após clicar **Calcular** com entradas
  válidas, a seção **"Cortes Parciais"** aparece na coluna de resultado, abaixo dos
  cards e acima do aviso de estimativa. Antes de calcular, a seção **não** aparece.
- [ ] **R3:** Alterar uma entrada principal sem recalcular mantém a tabela com a taxa
  anterior e mostra o aviso "Dados alterados — recalcular"; após Calcular, a tabela
  reflete a nova taxa. Verificável mudando a largura da tira e conferindo os números.
- [ ] **R4/R6:** A tabela nasce com as linhas **30, 50, 100, 300, 500, 1000 mm**;
  "Restaurar presets" recompõe exatamente essas 6 linhas.
- [ ] **R5/R7:** Dá pra adicionar linha, remover qualquer linha, e editar o comprimento
  de cada uma; a tira/custo recalculam ao editar.
- [ ] **R8:** O seletor de unidade `mm`/`cm`/`m` inicia em **`mm`** e vale pra tabela
  toda; trocar a unidade reinterpreta os valores conforme decidido.
- [ ] **R9:** Com rolo 1370 mm, tira 18 mm, perda 15%, a linha **30 mm** mostra
  **≈ 1,94 m** de tira (bate com taxa 64,694 m/m).
- [ ] **R10:** Com custo R$ 19,90/m informado, a linha **30 mm** mostra **≈ R$ 0,60**;
  **sem** custo informado, a coluna Custo **não** aparece.
- [ ] **R11:** Linha com comprimento vazio/0 mostra "—" nas colunas de resultado, sem
  erro e sem sumir.
- [ ] **R12:** Existe `partialCutYield` (ou equivalente) puro em `strapYield.ts` com
  teste unitário passando (`bun run test` cobrindo o novo helper).
- [ ] **R13:** `npm run check:tokens` passa (sem cor hardcoded na seção); o layout não
  quebra em 360px; `bunx tsc -p tsconfig.app.json --noEmit` limpo.
- [ ] **Regressão:** o cálculo principal (rendimento, total no rolo, custo, aviso de
  dados alterados, restaurar padrão) continua funcionando igual.
