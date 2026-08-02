# Sugestão de duplicata no cadastro de item e de cor

> Decidido em 02/08/2026. A lógica boa já existe — o problema é que ela mora
> dentro de um formulário e os outros seis caminhos de cadastro não a enxergam.

---

## O que existe hoje

`ProductFormDialog.checkDuplicateName` faz uma cascata madura, com sete motivos
ordenados por força da evidência: `exact` → `sku` → `fuzzy_color` →
`normalized` → `cross_group` → `fuzzy` → `two_words`. O gate no submit
(`duplicateMatch && !duplicateConfirmed`) impede salvar sem decidir.

**Ela cobre 1 dos 7 caminhos que criam produto ou cor:**

| Caminho | Hoje |
|---|---|
| `ProductFormDialog` — Adicionar material | cascata completa |
| `MasterVariantDialog` — botão `+ Cor` | igualdade exata, só no grupo aberto |
| `MasterVariantDialog` — edição inline de cor | igualdade exata, só no grupo |
| `GroupColorsTab` | `insert` direto, nenhuma |
| `QuickFamilyDialog` | `insert` direto, nenhuma |
| `GroupOrganizationPanel` | nenhuma |
| `SaleOrderItemForm` — tira artesanal do PV | nenhuma |

`levenshtein` já está **copiado** em `ProductFormDialog` e `GroupColorsTab`.
Sem unificar, o terceiro consumidor vira a terceira cópia.

### Furo aberto pela lista colapsada

O `+ Cor` compara contra `variants`, que desde a reforma de 02/08 é a lista **já
filtrada** pelo chip de zeradas. `NUDE` da NAPA SOFT está zerada e escondida, então
cadastrar `NUDE` de novo hoje passa batido. A checagem tem que consultar o estoque
inteiro, nunca a lista renderizada.

---

## Alcance: medido, não estimado

| | |
|---|---|
| Produtos ativos com cor | 173 |
| **Disparariam alerta por cor igual em outro grupo** | **141 (81,5%)** |
| Pares de mesma cor entre grupos diferentes | 525 |
| **Pares de mesmo nome entre grupos diferentes** | **0** |

Os dois eixos se comportam de forma oposta, e é isso que define a regra:

- **Cor** repete entre grupos por natureza (`PRETO`, `CARAMELO`, `OFF WHITE` em
  quase todos). Alerta de cor fora do grupo seria ruído em 4 de cada 5 cadastros
  — e alerta que sempre aparece é alerta sempre confirmado no automático.
- **Nome** hoje não repete entre grupos. Buscar nome no estoque inteiro custa
  zero falso positivo e é o que pega o mesmo material cadastrado duas vezes.

---

## Requisitos

### R1 — Fonte única

**R1.1** — Extrair a cascata para `src/lib/duplicateDetection.ts`, sem React:
entrada `(candidato, todosOsProdutos)`, saída `DuplicateHit | null`.

```ts
export type DuplicateReason =
  | 'exact' | 'sku' | 'fuzzy_color' | 'normalized'
  | 'cross_group' | 'fuzzy' | 'two_words';

export type DuplicateHit = { product: Product; reason: DuplicateReason };

export function findDuplicate(
  candidato: { id?: string; name: string; color?: string | null; sku?: string; group_id?: string | null },
  todos: Product[],
): DuplicateHit | null;
```

**R1.2** — `normalizeForCompare` e `levenshtein` mudam para esse módulo.
`ProductFormDialog` e `GroupColorsTab` passam a importar; as cópias somem.

**R1.3** — A ordem atual dos sete motivos é preservada. Este spec **não** reescreve
a cascata; move e amplia o alcance.

**R1.4** — A função recebe sempre a lista COMPLETA de produtos ativos
(`useProducts()`), nunca a lista filtrada da tela. Fecha o furo do `+ Cor`.

**R1.5** — Inclui produto **inativo** na busca. Item desativado que volta a ser
cadastrado é duplicata — e reativar é melhor que criar de novo.

### R2 — Alcance por eixo

**R2.1** — `sku`: estoque inteiro. SKU repetido é sempre erro.

**R2.2** — `normalized`, `fuzzy` e `two_words` (eixo NOME): estoque inteiro.

**R2.3** — `exact`: mesmo grupo, como hoje.

**R2.4** — `fuzzy_color`: **só dentro do mesmo grupo**. Typo de cor só significa
algo relativo a um material; fora do grupo é ruído medido em 81,5%.

**R2.5** — Num grupo que varia por cor o nome repete de propósito. Nome igual com
cor diferente no mesmo grupo **não** é duplicata — regra que já existe e não pode
regredir.

### R3 — Comportamento na tela

**R3.1** — Achando candidato, exibir sugestão com: nome, SKU, cor, grupo, saldo
atual e o motivo em português. Nunca só "duplicado encontrado".

**R3.2** — Salvar fica bloqueado até o usuário escolher **"É o mesmo"** ou
**"Não é o mesmo"**. Confirmar é decisão explícita, não clique em X.

**R3.3** — **"É o mesmo"** não salva: leva ao produto existente. No cadastro de
cor, foca a cor encontrada; no de item, abre o item. Cadastrar duplicata deve ser
mais difícil do que achar o original.

**R3.4** — **"Não é o mesmo"** libera o salvamento na sessão do formulário.
Trocar nome, cor ou SKU refaz a checagem e limpa a confirmação.

**R3.5** — Componente único `DuplicateSuggestion`, usado pelos 7 caminhos.

### R4 — Onde ligar

**R4.1** — `ProductFormDialog`: trocar a lógica local pela importada. Comportamento
visível não muda, exceto o alcance do R2.2.

**R4.2** — `MasterVariantDialog` `+ Cor`: chamar `findDuplicate` antes de criar,
com nome herdado, cor digitada e SKU digitado.

**R4.3** — `MasterVariantDialog` edição inline: chamar ao confirmar a cor nova.

**R4.4** — `GroupColorsTab`: checar cada linha antes do `insert` em lote. Linha
suspeita fica marcada e não entra até ser resolvida; as demais seguem.

**R4.5** — `QuickFamilyDialog`: idem, por linha.

**R4.6** — `GroupOrganizationPanel` e `SaleOrderItemForm` (tira artesanal):
mesma checagem antes de criar.

**R4.7** — Nenhum caminho pode criar produto sem passar por `findDuplicate`.

### R5 — Sem mudança de dado

**R5.1** — Nada de migration. Não mexe em produto existente, não funde, não
renomeia, não desativa.

**R5.2** — O `CAPPUCCINO` × `CAPUCCINO` que já existe **continua existindo**.
Este spec impede o próximo; limpar os atuais é a Fase 2 da auditoria.

---

## Fora de escopo

1. Fundir duplicatas existentes (`merge_product_into` já existe e é outro fluxo).
2. Índice único no banco — as duplicatas atuais fariam a migration falhar.
3. Normalizar as cores para um catálogo fechado.
4. Detecção de duplicata em clientes, fornecedores ou referências.

---

## Verificação

- [ ] `bunx tsc -p tsconfig.app.json --noEmit` limpo
- [ ] `bun run test` — incluindo testes novos de `duplicateDetection.ts`
- [ ] `levenshtein` e `normalizeForCompare` existem em **um** arquivo só
- [ ] Cadastrar `CAPUCCINO` no grupo NAPA SOFT sugere o `CAPPUCCINO` de 66 m
- [ ] Cadastrar `NUDE` na NAPA SOFT sugere a `NUDE` zerada, mesmo escondida
- [ ] Cadastrar `PRETO` numa tira **não** sugere o `PRETO` da napa
- [ ] Cadastrar `NAPA SOFT` num grupo diferente sugere o existente
- [ ] SKU `5207` em qualquer grupo sugere o `NAPA SOFT PRETO`
- [ ] "Não é o mesmo" libera; trocar a cor depois volta a pedir confirmação
- [ ] Nenhum dos 7 caminhos cria produto sem passar pela checagem
