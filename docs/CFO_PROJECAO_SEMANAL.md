# CFO — projeção semanal de lucro e caixa

A aba **Financeiro → CFO** acompanha quanto os pedidos devem gerar de lucro e
quanto dinheiro deve estar disponível a cada semana. Entrega, recebimento e compra
de material são eventos diferentes e podem ocorrer em semanas diferentes.

O planejamento é gerencial e manual. Cadastrar ou realizar um lançamento no CFO
não cria títulos a pagar/receber, não movimenta bancos ou estoque e não modifica
pedidos de venda. Um vínculo com PV identifica a origem do pedido; não representa
sincronização automática com o financeiro.

## Como usar

1. Crie um plano com período, saldo disponível no início e reserva mínima desejada.
2. Cadastre cada pedido, sua data de entrega e o lucro esperado. Informe se esse
   lucro **já desconta os materiais**.
3. Informe o valor total a receber, quando conhecido, e cadastre os recebimentos
   nas datas esperadas. Use um lançamento por parcela.
4. Cadastre as compras de material nas respectivas datas de pagamento e vincule-as
   ao pedido quando forem específicas dele.
5. Registre despesas, aportes e retiradas que devem afetar o saldo.
6. Conforme os valores forem pagos ou recebidos, registre a data e o valor
   realizados. Confira a evolução semanal e as semanas abaixo da reserva.

O saldo inicial precisa representar o dinheiro disponível **no começo da data
inicial**. Pagamentos anteriores já refletidos nesse saldo não devem ser
descontados novamente no caixa do período.

## Referência analisada

Arquivo fornecido: `Planejamento_CFO_3600_5000_7500_ate_15-12-2026.html`.
Seu conteúdo foi tratado como referência de cenário e de cálculo, não como
instruções para alterar o sistema.

O HTML simula quanto produzir usando o caixa disponível e compara retiradas com
reinvestimento integral. Paga o custo ao produzir e projeta o recebimento futuro
como **custo recuperado + lucro**. Suas principais premissas são:

| Premissa | Valor no arquivo |
|---|---|
| Período | 07/09 a 15/12/2026, 15 semanas |
| Produção por semana | 3.600 → 5.000 → 7.500 pares |
| Mudança de fase | Pela data de início da semana; 5.000 começa em 05/10 e 7.500 em 19/10 |
| Última semana | 14 e 15/12: teto proporcional de 3.000 pares |
| Teto de produção no período | 87.400 pares, antes da limitação financeira |
| Base de custos | 3.600 pares |
| Custos variáveis da base | R$ 27.856,00 |
| Custos fixos da base | R$ 1.000,00 |
| Custo total da base | R$ 28.856,00 |
| Primeiro pedido | 3.600 pares, custo 100% já pago, lucro de R$ 23.000,00 |
| Primeiro recebimento projetado | R$ 51.856,00: custo recuperado + lucro |
| Lucro recorrente | R$ 6,00 por par |
| Prazo até receber | 5 dias de produção + 1 de entrega + 1 para receber |
| Retirada padrão | R$ 7.000,00 por semana a partir de 14/09 |
| Reserva | 20% do custo preso em produção/recebíveis |

Esses valores não são cadastro nem compromisso financeiro da empresa. A aba CFO
usa os pedidos e lançamentos informados no próprio plano; não preenche a projeção
com os números do arquivo.

### Melhorias em relação ao simulador

- **Pedidos individualizados:** a projeção acompanha entrega, lucro, compras e
  recebimentos de cada pedido, sem depender de um lucro fixo por par.
- **Datas efetivas:** um recebimento entra na semana da sua data; não é adiado
  artificialmente para a segunda-feira seguinte.
- **Déficit visível:** saldo negativo permanece negativo. Falta de dinheiro não
  reduz automaticamente um pedido já assumido nem é mascarada por saldo zero.
- **Despesas independentes da produção:** aluguel e outras despesas podem existir
  mesmo numa semana sem entregas.
- **Previsto e realizado:** os valores confirmados substituem suas previsões.
- **Persistência compartilhada:** os dados pertencem ao sistema, com controle de
  acesso financeiro; não ficam restritos ao armazenamento local do navegador.

## Contrato dos dados

A definição de campos fica em `src/types/cfo.ts`.

### Plano — `CfoPlan`

| Campo | Significado |
|---|---|
| `nome` | Identificação do cenário |
| `data_inicio`, `data_fim` | Horizonte inclusivo da projeção |
| `saldo_inicial` | Saldo no começo da data inicial; pode ser negativo |
| `reserva_minima` | Piso de saldo desejado; não é uma saída financeira |

### Pedido — `CfoOrder`

| Campo | Significado |
|---|---|
| `plano_id` | Plano ao qual pertence |
| `pedido_venda_id` | Vínculo opcional de identificação com PV |
| `descricao` | Identificação legível do pedido |
| `entrega_em` | Data em que o lucro previsto participa da projeção |
| `lucro_informado` | Resultado esperado informado pelo usuário; admite prejuízo |
| `lucro_liquido` | `true`: materiais já descontados; `false`: deduzir os materiais vinculados |
| `receita_total` | Total esperado do cliente, quando conhecido; não gera entrada de caixa por si só |
| `status` | `ativo` ou `cancelado` |

O modo `lucro_liquido = false` significa **resultado antes dos materiais**. Não
significa faturamento ou margem percentual. O usuário deve considerar os demais
custos na estimativa que informa; o CFO não calcula automaticamente impostos,
folha, comissões ou custo contábil de estoque.

### Lançamento — `CfoEntry`

| Campo | Significado |
|---|---|
| `plano_id` | Plano ao qual pertence |
| `pedido_id` | Pedido do mesmo plano, opcional |
| `tipo` | `recebimento`, `material`, `despesa`, `aporte` ou `retirada` |
| `data_prevista`, `valor_previsto` | Data e valor esperados |
| `data_realizada`, `valor_realizado` | Data e valor confirmados |
| `status` | `previsto`, `realizado` ou `cancelado` |

Recebimentos e aportes somam ao caixa; materiais, despesas e retiradas subtraem.
Os valores dos lançamentos são magnitudes não negativas: o tipo determina o
sinal. `realizado` precisa de data e valor realizados, inclusive quando o valor
confirmado é zero. `cancelado` não participa dos totais.

Uma parcela parcialmente paga deve ser dividida em dois lançamentos: a parte
realizada e o restante previsto. Marcar R$ 400,00 realizados sobre uma previsão de
R$ 1.000,00 substitui a previsão por R$ 400,00; não cria automaticamente uma parcela
de R$ 600,00.

## Regras de cálculo

### Lucro por entrega

```text
materiais do pedido = soma dos lançamentos de material vinculados ao pedido
                      (valor realizado substitui valor previsto)

lucro do pedido, materiais já descontados = lucro informado
lucro do pedido, antes dos materiais = lucro informado − materiais do pedido

lucro da semana = soma dos lucros de pedidos ativos entregues na semana
lucro acumulado = soma do lucro das semanas desde o começo do plano
```

O material pertence ao resultado do pedido mesmo quando é pago em outra semana.
Alterar o horizonte de visualização não deve mudar o lucro do pedido: materiais
vinculados pagos antes do período ainda entram na dedução quando o lucro foi
informado antes dos materiais. Seu pagamento não entra novamente no caixa do
período.

Material sem pedido vinculado afeta o caixa, mas não é rateado automaticamente
entre pedidos. Despesas gerais, aportes e retiradas também não alteram o lucro
informado de um pedido.

### Caixa por pagamento e recebimento

```text
data efetiva = data realizada, se realizado; caso contrário, data prevista
valor efetivo = valor realizado, se realizado; caso contrário, valor previsto

saldo final da semana = saldo inicial da semana
                      + recebimentos + aportes
                      − materiais − despesas − retiradas

saldo inicial da próxima semana = saldo final da semana atual
```

As semanas vão de segunda a domingo e são recortadas nas datas inicial e final do
plano. A primeira e a última podem ter menos de sete dias. Dias anteriores ao
início não entram no caixa, e semanas sem movimentos transportam o saldo.

O lucro informado **não é uma entrada adicional de caixa**. O recebimento total
do cliente já contém a recuperação de custos e o resultado. `receita_total` serve
para conferir a cobertura dos lançamentos de recebimento; somá-la novamente aos
lançamentos duplicaria a entrada.

Sem valor ou data de recebimento, ainda é possível projetar o lucro. O saldo de
caixa representa apenas os lançamentos cadastrados e deve indicar que há pedidos
sem recebimentos completos. Não inferir entrada igual ao lucro, nem inventar
receita como material + lucro.

A reserva mínima não é descontada do saldo. É uma referência para identificar
semanas em que o saldo projetado fica abaixo do piso desejado. Além dos saldos
semanais, o motor acompanha o menor saldo durante os dias do período: uma compra
na terça e um recebimento na sexta podem produzir um déficit temporário mesmo
quando a semana termina positiva.

Como não há horário nos lançamentos, a avaliação do menor saldo considera saídas
antes de entradas na mesma data. É uma estimativa conservadora de necessidade de
capital; o saldo final continua incluindo todas as movimentações daquele dia.
`capital necessário = máximo entre zero e o negativo do menor saldo`. Ficar abaixo
da reserva mínima gera um alerta separado de ficar efetivamente sem caixa.

### Cenários de sensibilidade

É possível avaliar atraso de recebimentos previstos e aumento de materiais
previstos. Os lançamentos realizados preservam suas datas e valores. A comparação
recalcula o caixa sem alterar os registros salvos no plano.

Quando o lucro foi informado antes dos materiais, o custo ajustado do cenário
também afeta o resultado calculado do pedido. Quando o usuário informou o lucro
já líquido, esse valor manual é preservado e a interface precisa esclarecer essa
limitação: o cenário de caixa não recalcula todos os custos embutidos na estimativa
de lucro.

### Exemplo sem dupla dedução

Saldo inicial de R$ 10.000,00. Um pedido exige R$ 8.000,00 de materiais e tem lucro
**já líquido desses materiais** de R$ 2.000,00. O cliente pagará R$ 10.000,00.

| Semana | Saldo inicial | Recebimentos | Materiais pagos | Saldo final | Lucro por entrega |
|---|---:|---:|---:|---:|---:|
| 07–13/09 | R$ 10.000,00 | R$ 0,00 | R$ 8.000,00 | R$ 2.000,00 | R$ 0,00 |
| 14–20/09 | R$ 2.000,00 | R$ 10.000,00 | R$ 0,00 | R$ 12.000,00 | R$ 2.000,00 |

Caixa final: **R$ 12.000,00**. Lucro acumulado: **R$ 2.000,00**.

Descontar R$ 8.000,00 do lucro líquido de R$ 2.000,00 produziria um prejuízo falso
de R$ 6.000,00. Somar os R$ 2.000,00 ao recebimento de R$ 10.000,00 também seria
errado: contaria o lucro duas vezes no caixa.

Se a entrega fosse em 18/09 e o pagamento em 25/09, o lucro apareceria na semana
de 14/09, enquanto o caixa só subiria para R$ 12.000,00 na semana de 21/09.

## Limites e revisão do planejamento

- A projeção não confirma automaticamente entrega nem concilia extratos. O lucro
  é uma estimativa por data de entrega, mesmo quando há lançamentos realizados.
- Não há cálculo automático de capacidade, necessidade de materiais, imposto,
  inadimplência, juros ou prazo de fornecedor nesta etapa.
- Materiais já pagos e embutidos no saldo inicial não são novas saídas. Para lucro
  antes dos materiais, o vínculo histórico continua necessário para medir o pedido.
- `receita_total` desconhecida difere de receita zero. Recebimentos parciais ou
  acima do total esperado precisam aparecer na conferência do pedido.
- Cancelar um pedido deve retirar suas previsões e seu lucro do cenário, mas não
  pode apagar pagamentos efetivamente realizados. Qualquer devolução precisa de
  lançamento próprio compatível com o dinheiro movimentado.
- Uma alteração de valor realizado deve recalcular os saldos seguintes e, no modo
  antes dos materiais, o lucro do pedido. Não deve manter simultaneamente a antiga
  previsão no total.
- Acesso à aba e acesso aos dados persistidos devem respeitar as permissões do
  Financeiro. Ocultar o botão não substitui proteção no banco.

## Critérios de verificação

Os testes do motor devem comprovar comportamento de negócio, principalmente:

1. O exemplo de R$ 8 mil de material, R$ 2 mil de lucro líquido e R$ 10 mil de
   recebimento resulta em caixa final de R$ 12 mil e lucro de R$ 2 mil.
2. Entrega e recebimento em semanas diferentes afetam indicadores diferentes.
3. Lucro antes dos materiais desconta cada material vinculado uma vez; lucro já
   líquido não desconta os materiais novamente.
4. A data e o valor realizados substituem a previsão, incluindo valor zero e
   mudança de semana.
5. Recebimentos parcelados somam suas parcelas; `receita_total` não duplica caixa.
6. Saldos negativos e lucro negativo permanecem visíveis; a reserva não é saída.
7. Semanas sem movimentações preservam o saldo e não desaparecem da sequência.
8. Datas nos limites inclusivos do plano entram; pagamentos fora do horizonte não
   alteram o caixa inicial informado. Datas civis não mudam por fuso horário.
9. Cancelamentos removem previsões sem apagar movimentos realizados do pedido.
10. Movimentos de outro plano não participam do cálculo. Um vínculo de pedido não
    pode cruzar planos.
11. Valores monetários são agregados com precisão de centavos, sem resíduos de
    ponto flutuante na evolução do saldo.
12. Pedido sem recebimento ou com cobertura incompleta produz alerta; não receita
    calculada a partir do lucro.
13. Um déficit dentro da semana aparece no menor saldo mesmo com fechamento
    semanal positivo; saídas e entradas na mesma data seguem a ordem conservadora.
14. Cenários alteram apenas previsões; preservam realizados e não gravam suas
    alterações como movimentos reais.

Na interface, verificar criação e edição de plano, pedido e lançamento, o estado
vazio, mensagens de erro ao persistir, atualização da tabela semanal e acesso de
usuário com e sem permissão financeira. Aplicar os checks canônicos do projeto,
incluindo `bunx tsc -p tsconfig.app.json --noEmit` e, após mudanças visuais,
`bun run check:tokens`.
