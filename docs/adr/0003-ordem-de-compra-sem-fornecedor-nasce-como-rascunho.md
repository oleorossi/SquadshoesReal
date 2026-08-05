# 0003. Ordem de compra sem fornecedor nasce como rascunho

- **Data:** 05/08/2026
- **Status:** aceita

## Contexto

Ordem de compra sem fornecedor resolvido é, na prática, ordem morta. Nos dados de
produção:

| Fornecedor gravado | Ordens | Canceladas | % |
|---|---|---|---|
| "Sem Fornecedor" | 14 | 13 | 93% |
| "A definir" | 12 | 6 | 50% (as outras 6 presas em `suggested`) |
| Fornecedores reais (SOARES, Celina, LC, SANSIN) | 11 | 0 | 0% |

Metade das ordens já criadas (26 de 54) nasceu sem fornecedor, e 19 dessas
morreram. Ordem com fornecedor de verdade quase não é cancelada.

A causa é rastreável: existe `resolveGroupSupplier`, que encontra o fornecedor
pelo grupo do material (por CNPJ, com fallback por nome), mas **nenhum** dos cinco
geradores de ordem o chama. Todos leem `products.supplier_id` cru, que é nulo na
esmagadora maioria dos materiais criados a partir do PV — em `TIRA OVERLOCK 5MM`,
17 das 18 cores não têm fornecedor próprio.

O sistema também já tinha uma resposta improvisada pro problema: o estado
`suggested`, que não consta do `STATUS_MAP` nem do filtro da tela. Doze ordens
estão nele, somando cerca de R$ 26 mil, incluindo uma de R$ 20.495 com 58 itens.
Elas renderizam com o rótulo "Pendente" e somem ao se filtrar por Pendente.

## Decisão

Ordem de compra sem fornecedor resolvido **pode ser criada**, e nasce no estado
`draft`. Nesse estado ela tem número e é consultável, mas **não é compra**: não
gera contas a pagar, não entra no saldo projetado, não pode ser aprovada, enviada
nem impressa. Ganhar fornecedor é a única transição que a tira de `draft`.

`draft` é estado novo. O `suggested` existente não é reaproveitado nem migrado
nesta rodada: as 12 ordens presas nele ficam como estão, para uma limpeza
separada.

Todos os caminhos de criação passam a resolver fornecedor na mesma ordem —
material, grupo (via `resolveGroupSupplier`), última compra — antes de concluir
que não há um.

## Alternativas consideradas

- **Bloquear a criação sem fornecedor.** Era a recomendação inicial, e mataria os
  93% na raiz: o que não tem fornecedor simplesmente ficaria no carrinho. Recusada
  porque apaga o registro da intenção de compra — o comprador perde o rastro de
  que aquilo precisava ser comprado, e o carrinho compartilhado passa a acumular
  pendência indefinidamente sem número pra citar.
- **Reaproveitar `suggested` exibindo-o como "Rascunho".** Zero migration, e faria
  as 12 órfãs aparecerem na hora. Recusada por preferir vocabulário limpo: um
  estado novo não carrega a história do antigo, e a decisão sobre as 12 fica
  explícita em vez de resolvida por efeito colateral.
- **Manter "A definir" como fornecedor válido.** É o comportamento atual. É o que
  produziu 19 ordens mortas em 26.

## Consequências

A intenção de compra é preservada com número e rastro, sem contaminar o
financeiro: `draft` é invisível pra contas a pagar e pro saldo, então uma ordem
sem fornecedor não distorce mais nenhum número a jusante.

Em troca, `purchase_orders` passa a abrigar linhas que não são compras, e **todo
consumidor da tabela precisa saber disso**. Qualquer soma, relatório ou projeção
que não filtre `status <> 'draft'` vai contar dinheiro que não existe. Este é o
custo real da decisão e o ponto a vigiar em revisão de código.

Convivem temporariamente dois estados de significado próximo, `draft` e o legado
`suggested`. Enquanto as 12 órfãs não forem tratadas, elas continuam fora do
filtro da tela — a dívida fica registrada aqui em vez de esquecida.
