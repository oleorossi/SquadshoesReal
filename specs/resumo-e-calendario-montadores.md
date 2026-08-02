# Resumo do período + calendário de pares por dia (Ficha de Montadores)

> Decidido em 02/08/2026 com protótipo sobre os 17 lançamentos reais do período
> 15/07–02/08. Aba **Relatórios** de `/fichas-montadores`.

---

## O que existe hoje

A aba Relatórios lista os lançamentos **agrupados por dia**, cada bloco com sua
tabela (montador, tamanhos, Méd, Dif, fichas, pares, valor, pagamento). O
cabeçalho de cada dia mostra `N fichas · N pares`.

**Não existe total do período.** Quem fecha a folha soma os dias na calculadora.

O **calendário também já existe** — mas só em PDF: `gerarCalendario`
([FichaMontadoresPage.tsx:837](../src/pages/FichaMontadoresPage.tsx#L837)) monta
a estrutura `CalRow` (montador × dia, pares por célula, fim de semana sombreado,
dia não pago marcado) e manda pra `imprimirCalendario`. Nada disso aparece na tela.

O cálculo por dificuldade **já é fonte única**: `sumProducaoRows`
([montadorProduction.ts:124](../src/lib/montadorProduction.ts#L124)) devolve
`paresMedio`, `paresDificil`, `brutoMedio`, `brutoDificil`, `taxaMedio`,
`taxaDificil`, `taxaVariou`, `dias` e `fichas`. É o motor que a folha usa.

**Este spec exibe o que já é calculado. Não introduz cálculo novo.**

---

## Dados que orientaram o desenho

| | |
|---|---|
| Lançamentos no período 15/07–02/08 | 17, em 3 montadores |
| Pares | 3.024 — **todos médio** |
| R$/par | médio 0,80 · difícil 1,00 (cadastrada, nunca usada) |
| Lançamentos na tabela inteira | 50 |
| **Sem `detalhe` (quebra por tamanho)** | **33** — o total deles entra como médio pelo fallback |
| Lançamentos já pagos no período | 0 |

Par difícil é usado, mas **pouco** — daí a regra R1.4.

---

## Requisitos

### R1 — Bloco de resumo do período

**R1.1** — Um bloco acima da lista de dias, dentro da aba Relatórios, com a conta
à vista: por dificuldade, `pares × R$/par = subtotal`, e o total do período em
destaque.

**R1.2** — Os números vêm de `sumProducaoRows`. Não recalcular no componente: se
o resumo divergir da folha, o operador perde a confiança nos dois.

**R1.3** — Layout: as linhas de cálculo à esquerda, o total à direita em corpo
grande e mono tabular. Abaixo, uma faixa com `fichas`, `dias produtivos` e
`pares/dia`.

**R1.4** — **A linha de DIFÍCIL só aparece quando há par difícil no período**
(`paresDificil > 0`). Sem isso, todo relatório de montagem comum carregaria uma
linha de zeros. Mesma regra vale para o split nas células do calendário: sem
difícil no período, a célula mostra só o número de pares.

**R1.5** — O bloco respeita os filtros ativos: período, montador e situação de
pagamento. Com **A pagar** marcado, o total é o que ainda se deve — é esse número
que vai pra folha, não o bruto.

**R1.6** — Dois avisos, ambos já deriváveis do motor:
- `taxaVariou` → "o R$/par mudou dentro do período; a taxa exibida é média ponderada"
- lançamentos sem `detalhe` → "N lançamento(s) sem quebra por tamanho; o total entra como médio"

**R1.7** — Nunca exibir taxa média entre dificuldades. `bruto ÷ pares` devolve um
valor que não é a taxa de nenhuma das duas quando há mistura.

### R2 — Calendário em grade de mês

**R2.1** — Abaixo do resumo e acima da lista de dias, uma grade de calendário: 7
colunas, uma célula por dia do mês, cobrindo os meses que o período toca.

**R2.2** — **Semana começa na SEGUNDA**, seguindo `dowIdx` (0=Seg … 6=Dom) e
`WD_SHORT7`, que é a convenção já usada no PDF. Não introduzir semana em domingo.

**R2.3** — Cada célula com produção mostra: número do dia (discreto) e **total de
pares do dia** em corpo grande. Quando há difícil no período (R1.4), a quebra
`médio · difícil` entra abaixo, em corpo menor.

**R2.4** — Dia dentro do período **sem lançamento** aparece com borda tracejada e
só o número. Dia vazio no meio da semana é informação — sumir com ele esconde a
falta.

**R2.5** — Dia fora do período fica invisível, mas **ocupa a célula**, pra que as
colunas de dia da semana não desalinhem.

**R2.6** — Fim de semana com fundo próprio; dia com lançamento **ainda não pago**
com fundo âmbar. Mesmas duas marcas do PDF.

**R2.7** — A grade soma **todos os montadores do filtro atual**. Com o filtro numa
pessoa, é a produção dela; com todos, é o total do dia.

**R2.8** — Legenda visível: dia não pago, fim de semana, sem lançamento. Cor não
pode ser o único sinal.

### R3 — O que não muda

**R3.1** — O botão **Calendário em PDF** e o `imprimirCalendario` continuam como
estão, em matriz montador × dia. A matriz é melhor em A4 paisagem e pra comparar
pessoas; a grade de mês é melhor na tela pra ler o ritmo. São usos diferentes.

**R3.2** — A lista de lançamentos por dia continua como está, abaixo do calendário.

**R3.3** — Nenhuma migration. Nenhuma escrita. É tela.

---

## Fora de escopo

1. Trocar o layout do PDF pela grade de mês.
2. Clicar no dia do calendário pra abrir o lançamento.
3. Comparar períodos (mês anterior, meta).
4. Corrigir os 33 lançamentos sem `detalhe` — o aviso da R1.6 os sinaliza; o
   conserto é decisão à parte.

---

## Verificação

- [ ] `bunx tsc -p tsconfig.app.json --noEmit` limpo
- [ ] `bun run lint` sem erro novo nos arquivos tocados
- [ ] `bun run check:tokens` sem violação nova
- [ ] `bun run test`
- [ ] Período 15/07–02/08, todos: total **R$ 2.419,20** e **3.024 pares**
- [ ] Nesse período **não** aparece linha de difícil
- [ ] Filtrando Rogerio: **768 pares** e **R$ 614,40**
- [ ] Calendário mostra 21/07 com 1.188 pares e 24/07 com 612 pares (todos)
- [ ] Semana começa na segunda; 15/07/2026 cai numa quarta
- [ ] Dia sem lançamento dentro do período aparece tracejado
- [ ] O aviso de "sem quebra por tamanho" aparece quando o período pega
      lançamento sem `detalhe`
- [ ] 360 px: grade legível, sem scroll horizontal na página
- [ ] Tema escuro: âmbar de não-pago e fim de semana distinguíveis
