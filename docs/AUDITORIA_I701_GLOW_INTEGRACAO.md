# I701 / Glow Metallic — integração de materiais

Auditoria de 05/09/2026, após a publicação de `53971ae`.

**Regra esclarecida pelo dono:** cada consumo cadastrado corresponde a uma
peça do cabedal, não a uma face do material. As peças de 2,74 e 2,28 dm²
continuam somadas. R$ 45,54/m é o custo completo do dublado, incluindo as duas
faces, dublagem simples e frete; nenhum desses itens deve ser cobrado novamente.
A hipótese de retirar os 2,28 dm² como segunda face foi descartada, sem alteração
dos consumos cadastrados. O dono ainda aponta valores incorretos; a divergência
exata de valor/tela está em investigação, sem aprovação dos totais por ele.

Verificação local do ajuste: 182 testes relacionados passaram, typecheck real
(`tsconfig.app.json`), build e lint das linhas alteradas passaram. A suíte
geral também foi executada; os testes SQL acima validam separadamente o banco,
pois testes de integração desabilitados na suíte local não provam essa cadeia.

## Resultado inicial

O cadastro novo está correto, mas a validação ampliada encontrou uma segunda
linha de cabedal que ainda resolvia o material tradicional. A referência não
deve receber aprovação geral enquanto as pendências cadastrais abaixo existirem.

| Caminho | Evidência |
|---|---|
| Cadastro do dublado | Quatro SKUs ativos, em metros, R$ 45,54/m, largura 1370 mm, comprimento 1000 mm, espessura 1 mm |
| Compra → estoque | Unidade de compra e estoque `m`; fator 1 |
| Área → consumo | `get_material_conversion_info` retorna 137 dm²/m para as quatro cores, sem aviso |
| Cabedal principal | Resolve Glow + Massabox por cor |
| Forração da palmilha | Resolve Glow puro por cor; permanece SKU independente |
| Material adicional do cabedal | Encontrado erro: os 2,28 dm²/par obrigatórios ainda resolviam Napa Soft + Massabox |
| Palmilha | Material não informado; o motor sinaliza que a linha fica fora de reserva/débito |

A reprodução usou a grade da imagem: 480 pares, números 25–34, com 80 pares
nos números 29 e 30 e 40 pares nos demais. Antes da correção adicional, o
cabedal principal consumia 9,6 m de Glow dublado. A segunda linha consumia
7,988321 m de Napa dublada em CHAMPAGNE; em COBRE, OURO LIGHT e PRATA o fallback
escolhia um SKU AMARELO cadastrado em `un`, resultando em 1.094,4 unidades.

## Correção adicional

Uma linha obrigatória sem produto fixado, do mesmo grupo do cabedal original,
deve seguir a origem do cabedal da variante. As áreas são mantidas e somadas;
nenhum material é removido da geometria. Materiais de outros grupos e produtos
escolhidos explicitamente conservam sua identidade.

Para a grade de 480 pares, o sistema atualmente calcula o dublado como:

`(2,74 + 2,28) × 480 ÷ 137 = 17,5883211679 m`

O custo desse cabedal é R$ 800,97 antes do arredondamento das demais parcelas.
A forração permanece 16,0666569343 m de Glow simples nessa mesma grade.
As camadas do dublado não geram consumo adicional de matéria-prima.

A validação do cadastro também foi ajustada: duas peças do mesmo material,
sem SKU fixado e sem marcação explícita de sobra, são aditivas. Antes eram
classificadas automaticamente como sobra e o salvamento exigia um pin
indevido. Sobras explícitas continuam exigindo sua identificação física.

## Teste integrado do estoque

`supabase/tests/i701_glow_stock_integration.sql` executa operações reais do
banco dentro de uma transação terminada em `ROLLBACK`:

- As quatro cores resolvem um único SKU dublado, com a área total de ambas
  as peças. Para 100 pares do número 34: 3,6642335766 m de dublado e
  4,1666423358 m de forração simples.
- Entrada pelo comando canônico de estoque registra quantidade e custo;
  repetir o mesmo identificador não duplica a entrada.
- O snapshot e a reserva usam os SKUs corretos; repetir a criação das
  reservas não duplica a necessidade.
- Finalizar com saldo gera a baixa física e o movimento correspondente.
  Sem saldo, as reservas ficam em `pending_reconciliation`, sem inventar
  consumo realizado. Repetir a finalização não gera outra baixa.
- Com apenas 1 m disponível, baixa 1 m (R$ 45,54) e mantém os 2,6642335766 m
  restantes pendentes. Uma cor inexistente no cabedal, mesmo com outra cor
  em estoque, não gera reserva nem débito do dublado errado.

Os cenários passaram com a migration `20270101016500` aplicada dentro da
mesma transação de teste. A checagem de 480 pares também passou nas quatro
cores. Depois do rollback, foram confirmados os saldos originais e a ausência
de PVs, OPs, fichas e entradas de teste persistentes.

Solado e fivela mantêm suas faltas de estoque; o teste não oculta esses
materiais nem aprova a referência para conseguir executar o cenário.

## Limites encontrados na infraestrutura existente

O campo legado `current_stock` não acompanha todas as baixas de produção.
Os caminhos auditados de estoque, consumo e MRP usam `products.quantity`,
que permaneceu correto e conciliado com os movimentos nos testes.

Separadamente, `reserve_missing_materials_for_order` considera a existência
de uma reserva/débito por produto, sem calcular todos os déficits quantitativos.
Esse caminho de reparo precisa de revisão própria; não é usado na criação
normal testada, que já recebe o cabedal consolidado. Nenhuma reconciliação
retroativa foi executada.

A revisão de cores inválidas fora do catálogo também identificou um fallback
legado na forração do motor TypeScript. A proteção adicional desta entrega
cobre o cabedal composto. As quatro cores válidas da I701 têm o dublado e a
forração correspondentes; o parecer não cobre combinações inválidas arbitrárias
nos demais componentes.

Após o esclarecimento sobre peças, a revisão da apresentação de custos
identificou candidatos à divergência relatada: o resumo superior considera
somente `sheet_materials` (vazio na I701); a aba Custos usa a ficha tradicional,
sem variante/cor; sua média de Napa inclui um SKU em `un` junto aos SKUs em
metros; e a coluna "Preço/un" mostra preço por dm² sem explicitar a unidade.
Esses achados não estabelecem qual valor motivou a reclamação do dono. A tela
e os valores observado/esperado ainda precisam ser identificados.

## Pendências da referência

- `insole_material` e `insole_plate_product` estão vazios. Não há BOM,
  mapeamento nem exceção de variante que identifique a placa da palmilha.
  As referências semelhantes não fornecem prova suficiente para preencher
  o material automaticamente.
- A faixa da ficha é 23–36, mas as especificações do solado começam em 25.
  Os mapas de palmilha e forração também não cobrem 23/24. O fallback atual
  usa 4,56 dm²/par de placa e 5,3259 dm²/par de forro nesses números; isso
  exige confirmação de engenharia ou correção da faixa vendida.
- A auditoria indica ausência de mão de obra cadastrada: nenhuma operação,
  tempos e capacidades zerados. O custo completo da referência ainda não
  pode ser considerado validado.

`status_ficha` segue `rascunho`. O banco permitiria certas transições de
status sem resolver todas essas pendências; aceitar um UPDATE não é prova
de prontidão para produção. Nenhum PV, OP ou histórico da I701 foi alterado.
