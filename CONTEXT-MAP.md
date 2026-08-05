# Mapa de contextos

Este repositório tem mais de um contexto de negócio. Cada um tem seu próprio
glossário — a mesma palavra pode significar coisas diferentes em contextos
diferentes, e isso é esperado. Antes de nomear qualquer coisa, leia o glossário
do contexto em que você está.

| Contexto | Glossário | Do que trata |
|---|---|---|
| Produção por par e Folha | [`CONTEXT.md`](CONTEXT.md) | O vínculo entre a Ficha de Montadores (chão de fábrica) e a Folha (RH): par, ficha, dificuldade, regime por par. |
| Compras | [`src/components/purchase/CONTEXT.md`](src/components/purchase/CONTEXT.md) | Como uma falta de material vira uma compra: necessidade, carrinho, rascunho, ordem de compra, alçada. |

Decisões de arquitetura que valem para o sistema inteiro ficam em
[`docs/adr/`](docs/adr/).

## Colisões conhecidas entre contextos

- **Grade** — em *Produção* é o conjunto de numerações de um pedido; em *Compras*
  é a distribuição por numeração de uma linha de solado. É a mesma ideia aplicada
  a objetos diferentes; não unifique o nome sem unificar o conceito.
- **Ficha** — em *Produção* é um lote de 12/15/18 pares. Em *Compras* a palavra
  não deve ser usada: o que se aproxima é a ficha de componente (cadastro de
  dimensões), e essa chama-se sempre "ficha de componente", nunca "ficha".
