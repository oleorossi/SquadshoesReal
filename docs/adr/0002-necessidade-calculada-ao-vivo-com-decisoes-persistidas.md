# 0002. Persistir decisões de compra, não necessidades

- **Data:** 05/08/2026
- **Status:** aceita

## Contexto

A fila de necessidades de compra reúne o que quatro motores independentes
apontam como falta: `v_mrp_needs`, os materiais dos PVs ativos, as faltas de
solado e o ponto de reposição. São 122 necessidades hoje, 83 delas acionáveis.

Duas propriedades dessa informação puxam em direções opostas:

- A **falta** é derivada e volátil. Ela muda quando o PV muda de quantidade,
  quando entra estoque, quando um pedido é cancelado. Qualquer cópia materializada
  fica errada entre uma sincronização e a seguinte, e a janela em que ela mente é
  justamente a janela em que alguém está decidindo uma compra.
- A **decisão humana** sobre a falta é o oposto: o sistema não tem como deduzi-la
  e ela precisa durar. "Essa eu não compro", "essa fica pra semana que vem", "essa
  eu já resolvi por fora". Sem gravar isso, a linha volta todo dia.

A ausência da segunda é o que degradou a primeira. Com 83 linhas voltando
indefinidamente e sem meio de dizer "não", a fila virou ruído: das 54 ordens de
compra já criadas, 28 foram canceladas — e 12 ficaram num estado `suggested` que
sequer aparecia no filtro da tela.

Havia ainda um efeito colateral do mesmo buraco: nenhum dos motores desconta o
que já está em ordem aberta. "Tira chata 8mm" aparecia em três ordens
simultâneas (OC-00093, OC-00160, OC-00184) com 214,8 m já pedidos, enquanto o MRP
seguia pedindo 876,48 m.

## Decisão

A necessidade continua sendo **calculada ao vivo** a cada consulta, unificada
numa view sobre os motores existentes, e passa a **descontar o que já está em
ordem de compra aberta** — é a necessidade líquida que se mostra.

O banco grava **apenas as decisões**: descarte, adiamento e resolução por fora,
cada uma com autor, motivo e data. A decisão se ancora na necessidade por
(material, origem), não por um identificador de linha — a linha não existe.

## Alternativas consideradas

- **Materializar as necessidades numa tabela.** Daria histórico auditável e um
  identificador estável pra pendurar as decisões. Descartada pelo custo de manter
  a tabela fiel: exigiria trigger ou job reagindo a mudança de PV, de estoque, de
  cancelamento e de recebimento, e cada um deles é uma nova origem de linha
  fantasma. O sistema já tem histórico do que importa — a ordem de compra.
- **Só a view, sem gravar decisão nenhuma.** Resolveria a duplicata com o menor
  esforço e nenhuma migration. Descartada porque deixa de pé a causa do abandono
  da fila: sem poder dizer "não", as 83 linhas seguem voltando.
- **Estender `mrp_suggestions`.** Já existe, com 40 linhas vivas e hooks prontos.
  Descartada por linguagem: o nome e o schema são de um motor só, e passariam a
  carregar necessidades de PV, solado e reposição — o tipo de ambiguidade que
  este repositório vem pagando caro.

## Consequências

A fila nunca fica velha e não há o que ressincronizar. A tabela de decisões é
pequena e cresce devagar, porque só registra intervenção humana.

Em troca, não há como responder "como estava a necessidade em 12 de junho" — a
falta de ontem não é recuperável, só o que se decidiu sobre ela. Se auditoria
retroativa de necessidade vier a ser exigida, será preciso um snapshot periódico,
e aí esta decisão é revisitada.

A âncora por (material, origem) é o ponto frágil: se a chave de uma origem mudar
de forma, as decisões presas a ela se soltam e as necessidades reaparecem. É
falha benigna — reaparecer é o comportamento seguro —, mas exige que qualquer
mudança na identidade de uma origem seja tratada como quebra de contrato.
