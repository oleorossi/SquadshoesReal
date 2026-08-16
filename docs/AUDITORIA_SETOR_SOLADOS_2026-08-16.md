# Auditoria do setor de solados — 16/08/2026

## Resultado executivo

O fluxo foi auditado de ponta a ponta: cadastro do solado, ficha técnica, item do
pedido de venda, cálculo de disponibilidade, geração/recebimento de ordem de
compra e baixa de estoque por numeração.

Os defeitos de maior impacto encontrados foram:

1. O preço e outros dados eram gravados, mas a consulta de `/solados` não os
   recarregava. Depois do `invalidate`, o formulário recebia `undefined` e dava a
   impressão de que o save havia falhado.
2. Fornecedor e prazo eram salvos por chamadas separadas e em uma coluna de prazo
   diferente da usada por parte do planejamento.
3. O range regravava o JSON completo da grade lido no cliente. Isso permitia
   salvamento parcial e expunha o cadastro à concorrência com uma baixa de estoque.
4. A conferência pré-PV comparava a demanda com o total do produto. Sobra em uma
   numeração podia esconder falta em outra.
5. O cálculo não descontava OCs abertas por numeração e podia sugerir a mesma
   compra novamente.
6. A variante de material do item do PV podia pinar um solado diferente; a baixa
   respeitava esse pin, mas a conferência de compra avaliava o solado padrão.
7. Um caminho de OC automática gravava a demanda completa na grade com
   `quantity` igual apenas ao déficit. A soma da grade divergente travava o
   recebimento.
8. A tela ignorava a situação em que somente a palmilha estava em falta.
9. Ao editar uma grade conjugada legada, chaves `33`, `34` e `33/34` podiam ser
   somadas novamente, duplicando o estoque.

## Correções implementadas

| Camada | Correção |
|---|---|
| Cadastro | A consulta do hub passou a buscar preço, fornecedor, lead time, MOQ, material, altura, notas, classificação, fachete e demais campos exibidos. |
| Persistência | `update_sole_profile` salva o perfil em uma transação, trava as variantes em ordem estável e mantém `unit = 'par'`. |
| Modelo × cor | Nome, range e dados técnicos são compartilhados no grupo; SKU, cor, preço e estoque continuam por variante física. |
| Grade | A troca de range altera apenas `_size_from/_size_to` no JSON vivo. Um range menor é bloqueado se esconder saldo fora da faixa. |
| Conjugados | A chave canônica (`33/34`) vence as individuais e o editor remove os baldes legados ao editar, sem dupla contagem. |
| Pedido de venda | Solado e palmilha respeitam a variante de material escolhida no item do PV, com a mesma precedência dos motores de consumo e baixa. |
| Compras | A falta é apurada por numeração e desconta o saldo restante de OCs `pending`, `approved`, `sent` e `parcial`. |
| OC | A grade de compra é sempre rateada para somar exatamente a quantidade do item, inclusive quando há MOQ. |
| Estoque | O hub é invalidado depois do ajuste por grade e exibe os valores novos sem recarregar a página. |
| Diagnóstico | `sole_sector_integrity_report()` lista unidade, preço, fornecedor, prazo, material, classificação, range e divergências entre cores. |

## Peculiaridades da indústria calçadista consideradas

Solado não é apenas “um produto em pares”. O controle operacional precisa preservar:

- modelo/família, variante de cor e compatibilidade com a fôrma;
- estoque e necessidade por numeração, inclusive numeração conjugada;
- composto (PVC, TR, PU, EVA, borracha etc.), fornecedor, lote mínimo e prazo;
- solado tradicional, conjugado, palmilha pronta e salto fachetado;
- consumo por numeração de forração, palmilha, fachete, cola e itens padrão;
- inspeção de recebimento e rastreabilidade de lote;
- requisitos de dureza/densidade e ensaios de abrasão, flexão, rasgamento,
  estabilidade dimensional/encolhimento, atrito e adesão/delaminação conforme o
  material e a especificação aprovada.

Referências primárias consultadas:

- IBTeC — laboratório físico-mecânico e ensaios para solados:
  <https://ibtec.org.br/laboratorio-fisico-mecanico>
- ISO 20871 — resistência à abrasão de solados:
  <https://www.iso.org/standard/63230.html>
- ISO 17707 — resistência à flexão:
  <https://www.iso.org/standard/31478.html>
- ISO 20873 — estabilidade dimensional:
  <https://www.iso.org/standard/63240.html>
- ISO 20872 — resistência ao rasgamento:
  <https://www.iso.org/standard/63239.html>
- ISO 20875 — delaminação de solados:
  <https://www.iso.org/standard/63242.html>
- ISO 24267 — coeficiente de atrito:
  <https://www.iso.org/cms/render/live/en/sites/isoorg/contents/data/standard/07/82/78252.html>
- GS1 Global Traceability Standard — lote e eventos de transformação:
  <https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard>
- Assintecal — materiais utilizados em calçados brasileiros:
  <https://www.assintecal.org.br/noticias/4124/assintecal-revela-materiais-mais-utilizados-nos-calcados-brasileiros>

## Regras preservadas

- Solado é unidade discreta `par`; não recebe conversão de área.
- Disponibilidade de solado é conferida no `stock_grade` bruto por numeração.
- Uma sobra em outra numeração não compensa o número faltante.
- Numeração conjugada representa um único balde e nunca é contada duas vezes.
- O consumo técnico continua com fonte única no modelo do solado; não foi copiado
  de volta para cada ficha ou variante de cor.
- Nenhum consumo recebeu fator de perda de corte.
- Não foram inventados valores de engenharia para numerações sem
  `sole_technical_specs`. Os diagnósticos existentes continuam sinalizando os
  gaps para preenchimento pelo responsável técnico.

## Lacunas de dados que exigem engenharia/qualidade

O software já possui inspeção de recebimento, quarentena e rastreabilidade de
lote genéricas. Os limites de aceitação de dureza, abrasão, flexão, retração e
adesão não podem ser preenchidos automaticamente: variam por composto, construção
e uso do calçado. Devem vir da especificação aprovada com fornecedor/laboratório.

Assim, esta entrega organiza o cadastro e permite registrar os requisitos nas
observações técnicas, sem fabricar tolerâncias. A evolução correta é transformar
os limites aprovados em plano de inspeção por família de solado e bloquear a
liberação do lote somente depois dessa decisão técnica.
