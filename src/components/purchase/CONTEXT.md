# Context: Compras

Glossário do caminho que uma falta de material percorre até virar uma compra.
Só linguagem de negócio — nada de implementação.

## Necessidade
Uma falta concreta: *tanto* de *tal material*, por causa de *tal origem* (um PV,
o MRP, o ponto de reposição, um solado em falta). Ela é **calculada, não
declarada** — muda sozinha quando o PV muda de quantidade ou quando entra
estoque, e desaparece sozinha quando deixa de faltar.
**Não confundir com:** [[Item de carrinho]] — a necessidade é o que o sistema
observa; o item de carrinho é o que uma pessoa decidiu comprar. Uma necessidade
pode existir por semanas sem nunca virar item de carrinho.
**Sinônimos rejeitados:** "sugestão" (implica que o sistema está propondo algo, e
a maior parte das necessidades ninguém vai comprar), "requisição" (é um documento
com dono e aprovação — não é isso), "pedido" (é do cliente, outro fluxo).

## Necessidade líquida
A necessidade **depois de descontar o que já está em ordem de compra aberta**. É
sempre esse número que se mostra ao comprador. A necessidade bruta só aparece
quando ele abre o detalhe pra entender de onde veio.
**Não confundir com:** a necessidade bruta, que ignora o que já foi pedido — foi
ela que fez o mesmo material ser comprado em três ordens diferentes.

## Decisão de compra
O que uma pessoa determinou sobre uma necessidade e o sistema não teria como
deduzir: **descartar** (não vou comprar, e por quê), **adiar** (não agora, volta a
aparecer em tal data) ou **resolver por fora** (já providenciei, não me cobre
mais). É a única coisa que o sistema guarda sobre uma necessidade — a falta em si
ele recalcula.
**Sinônimos rejeitados:** "ignorar", "arquivar" — ambos escondem que a decisão tem
autor, motivo e data.

## Carrinho de compras
A lista **única e compartilhada** do que a fábrica pretende comprar agora. Todo
mundo vê o mesmo carrinho; cada linha registra quem a colocou e quando. Nada sai
do carrinho sozinho: sai porque alguém fechou a compra ou removeu.
**Não confundir com:** [[Ordem de compra]] — o carrinho é intenção, e pode
misturar materiais de fornecedores diferentes. A ordem é compromisso, e é sempre
de um fornecedor só.
**Sinônimos rejeitados:** "cesta", "lista de compras", "pré-pedido".

## Item de carrinho
Uma linha do carrinho: material, cor, quantidade na unidade de compra e — quando
é solado — a [[Grade de compra]]. Nasce de uma necessidade ou de uma inclusão
direta ("preciso disso e o sistema não sabe").

## Fechamento
O momento em que o carrinho é convertido em ordens de compra. Um fechamento
produz **várias** ordens de uma vez: uma por fornecedor. É onde o comprador vê,
lado a lado, tudo que vai nascer, e onde a [[Alçada]] se manifesta antes de ser
tarde.
**Sinônimos rejeitados:** "checkout" (o projeto fala português no domínio),
"finalizar" (ambíguo com concluir o recebimento).

## Ordem de compra
O compromisso com **um** fornecedor: o que se pede, quanto, por quanto, pra
quando. É o documento que se manda pro fornecedor e que vira contas a pagar
quando recebido.
**Sinônimos rejeitados:** "pedido de compra" (colide com pedido de venda na fala
do dia a dia), "OC" só na UI e em número (OC-00184) — no código, ordem de compra.

## Rascunho
Ordem de compra que ainda **não tem fornecedor resolvido**. Existe, tem número e
pode ser consultada, mas não é compra: não vira contas a pagar, não entra no saldo
projetado, não é enviada nem impressa. Sai de rascunho no instante em que ganha
fornecedor.
**Não confundir com:** ordem **pendente**, que já tem fornecedor e está só
esperando aprovação ou envio. Rascunho é falta de informação; pendente é falta de
decisão.
**Sinônimos rejeitados:** "sugerida" (é como o estado se chamava, e o nome fazia
parecer que o sistema estava propondo a compra), "A definir" (era o nome de
fornecedor que se usava pra disfarçar a ausência de um).

## Fornecedor resolvido
O fornecedor de um material foi resolvido quando se sabe **de quem** comprar
aquilo. O sistema tenta na ordem: o fornecedor do próprio material, o fornecedor
cadastrado no grupo do material, e o de quem se comprou aquilo da última vez.
Falhando as três, quem resolve é uma pessoa — e a escolha dela pode virar o
padrão do grupo, pra não se repetir.
**Não confundir com:** ter um nome escrito no campo. "A definir" e "Sem
Fornecedor" são nomes, não fornecedores resolvidos.

## Alçada
A faixa de valor que determina **quem precisa aprovar** uma ordem de compra antes
que ela possa ser enviada ao fornecedor. Vale sobre o valor da ordem, não do
carrinho — um carrinho de R$ 30 mil que vira três ordens de R$ 10 mil não exige a
aprovação que uma ordem única de R$ 30 mil exigiria.
**Sinônimos rejeitados:** "limite de compra" (sugere teto de gasto, e não é —
acima da faixa não é proibido, é aprovado por outra pessoa).

## Grupo de material
O material como o fornecedor o vende: `TIRA OVERLOCK 5MM`, `NAPA SANTORINE`. É a
unidade de negociação e a unidade de exibição na fila e no carrinho.
**Não confundir com:** o **material cadastrado**, que é grupo + cor. Um grupo pode
ter dezenas de materiais cadastrados sob ele — `TIRA OVERLOCK 5MM` tem 18, um por
cor. Comprar é sobre o grupo; estocar e consumir é sobre o material cadastrado.

## Cor
A variação do material dentro do [[Grupo de material]]. Na fila e no carrinho a
quantidade é **sempre discriminada por cor** — o fornecedor precisa saber quantos
metros de cada uma, e somar tudo numa linha só perde a informação que faz o
pedido ser atendível.

## Grade de compra
A distribuição por numeração de uma linha de **solado**: quantos pares de 33/34,
de 35, de 36. Solado não se compra por quantidade solta. A grade acompanha o item
desde o carrinho, porque é ali que se decide — depois da ordem criada já é tarde.
**Não confundir com:** a **grade do pedido** (produção), que é a numeração do que o
cliente pediu. A grade de compra deriva dela, mas pode ser diferente: arredonda
pra fechar caixa, ou soma vários pedidos.

## Lançamento avulso
O registro de uma nota que **já chegou** sem ordem de compra prévia. É registro
retroativo, não compra — não passa por carrinho, fila nem alçada, porque não há
mais nada a decidir.
**Não confundir com:** [[Rascunho]]. O avulso é uma compra que já aconteceu; o
rascunho é uma que ainda não pode acontecer.
