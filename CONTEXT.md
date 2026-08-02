# Context: Produção por par e Folha

Glossário do vínculo entre a **Ficha de Montadores** (chão de fábrica) e a
**Folha** (RH). Só linguagem de negócio — nada de implementação.

## Ficha de Montadores
A **tela** onde se lança, dia a dia, quanto cada montador e cada solador
produziu. Existe apenas para Montagem e Solagem — são os dois ofícios pagos por
produção.
**Não confundir com:** [[Ficha]] — o lote de pares. A tela chama-se "ficha" por
herança do papel que substituiu; o que ela registra são pares, não fichas.
**Sinônimos rejeitados:** "apontamento de produção" (é o PCP, outro fluxo),
"chamada" (é uma das visões da tela, não a tela).

## Ficha
Lote de pares que anda junto pela fábrica: 12, 15 ou 18 pares. O trabalhador
recebe fichas e devolve fichas; a quantidade de fichas é uma medida de **ritmo**,
não de pagamento.
**Não confundir com:** [[Par]] — a unidade que o RH paga.
**Sinônimos rejeitados:** "lote" (o sistema já usa lote para outra coisa na
produção), "grade" (grade é o conjunto de numerações de um pedido).

## Par
Unidade física produzida e **unidade única de pagamento** de quem é [[Regime por
par]]. Todo valor devido nasce de `pares × R$/par`.

## Dificuldade
Classificação do par no momento do lançamento: **médio** ou **difícil**. Existe
só porque paga R$/par diferente. É escolhida no lançamento, nunca no cadastro do
modelo.
**Sinônimos rejeitados:** "complexidade", "nível" — e não há um terceiro grau
("fácil" não existe).

## Regime por par
Forma de pagamento de um funcionário: ele ganha por par produzido, e **não** tem
salário, diária, falta, atraso nem hora extra. O relógio de ponto dele registra
presença e nada mais.
**Não confundir com:** mensalista, remoto e diarista — os outros três regimes,
todos ligados ao ponto.
**Sinônimos rejeitados:** "produção" sozinho (ambíguo com o setor de Produção),
"comissionado", "empreitada".

## Dia produtivo
Dia em que a pessoa lançou pares na Ficha de Montadores. É o "quantos dias
trabalhou" de quem é [[Regime por par]].
**Não confundir com:** **dia útil** (o denominador da escala do mensalista) e
**dia de ponto** (dia com batida no relógio). Um por-par pode bater ponto e não
produzir; esse dia não é produtivo.

## R$/par gravado
O valor por par que vale para um lançamento é o que ficou **gravado naquele
lançamento**, não o que está no cadastro hoje. Reajustar o cadastro muda os
lançamentos futuros e nunca os passados.
**Não confundir com:** o **R$/par do cadastro**, que é só a origem do valor no
momento em que o lançamento é criado, e serve de referência de conferência.
**Sinônimos rejeitados:** "tabela de preço", "valor vigente".

## Espelho de Ponto
Documento legal (Portaria MTP 671) com as batidas dia a dia. Existe para
**todo** funcionário registrado, inclusive quem é [[Regime por par]] — é
obrigação trabalhista e independe de como a pessoa é paga.
**Não confundir com:** [[Relatório da Folha]] e [[Holerite]], que são documentos
de pagamento. Para quem é por par, o Espelho não menciona dinheiro.

## Relatório da Folha
Listagem de **todos** os funcionários do período em um papel só, para conferir
antes de pagar. Traz dois blocos, porque as duas formas de pagar não se somam na
mesma linha: quem é pago pelo relógio de ponto e quem é [[Regime por par]].

## Holerite
Demonstrativo **individual** do que a pessoa recebe no período, discriminando de
onde veio cada valor. Para quem é por par, discrimina dias produtivos, pares e
R$/par — nunca salário, falta ou hora extra.
**Não confundir com:** [[Recibo de pagamento]], que é assinado na entrega do
dinheiro e prova a quitação.
