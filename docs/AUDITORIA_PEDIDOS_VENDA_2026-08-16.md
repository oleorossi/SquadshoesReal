# Auditoria industrial — Pedido de Venda

Data: 16/08/2026  
Escopo: cadastro e edição do PV, referência, variação de material, cor/grade,
preço, ficha técnica, estoque, consumo e integridade comercial.

## Resultado executivo

O cálculo armazenado dos pedidos está consistente: não foram encontrados totais
divergentes, itens abertos com preço zero ou quantidade diferente da soma da
grade. A maior fragilidade estava antes do cálculo: a identidade comercial do
item podia nascer incompleta e a origem do preço era invisível.

Medição somente leitura no banco de produção antes das correções:

| Controle | Resultado |
|---|---:|
| Referências cadastradas | 53 |
| Referências publicadas | 13 |
| Referências em rascunho/revisão | 40 |
| Referências já usadas em vendas | 43 |
| Referências usadas com `sale_price <= 0` | 43 |
| Itens de PV abertos | 77 |
| Itens abertos com preço zero/negativo | 0 |
| Itens com quantidade diferente da grade × fichas | 0 |
| Itens com variante de outra referência | 0 |
| Itens com variante inativa | 0 |
| Itens sem variante apesar de haver opções ativas | 41 |
| PVs com total diferente da soma dos itens | 0 |
| Diferença financeira total | R$ 0,00 |

## Falhas encontradas

### 1. Vigência da tabela de preço não era respeitada

O PV buscava `clients.price_list_id` e aplicava os itens da tabela sem consultar
`price_lists.active`, `valid_from` ou `valid_to`. Uma tabela inativa, futura ou
vencida podia precificar um pedido.

Correção: o lookup agora valida vigência no dia local do navegador. A tabela
inválida fica identificada para auditoria, mas não fornece preço.

### 2. Preço da variação quase nunca era aplicado

Ao escolher a referência, o formulário preenchia primeiro o preço-base da ficha.
O efeito da variação só executava quando o preço ainda era zero. Assim,
`reference_material_variants.unit_price_override` era ignorado na situação mais
comum.

Correção: uma função única resolve a prioridade:

1. tabela do cliente por referência + cor + faixa de quantidade;
2. tabela do cliente por referência + faixa de quantidade;
3. preço próprio da variação de material;
4. preço-base da ficha técnica;
5. pendência de preço.

O preço automático acompanha cor e faixa de quantidade enquanto continuar sendo
automático. Depois de uma edição manual, o motor não sobrescreve o usuário.
Trocar a referência sempre elimina o preço da referência anterior e resolve de
novo a cadeia comercial.

### 3. Item novo podia nascer sem identidade de material

41 dos 77 itens abertos não têm `material_variant_id`, embora suas referências
ofereçam variantes ativas. Corrigir isso em massa seria inseguro: a variante muda
materiais resolvidos, consumo, custo, estoque e SKU fiscal.

Correção:

- item histórico permanece editável e recebe aviso;
- item novo é bloqueado até selecionar o grupo de material;
- uma única opção é selecionada automaticamente;
- o banco rejeita variante de outra referência, inativa ou ausência de variante
  em um novo item de referência que exige escolha;
- nenhum item histórico foi alterado retroativamente.

### 4. Carregamento repetido das variantes

Cada cartão de item consultava as variantes da própria referência, além da lista
global já carregada pelo formulário. Em pedidos longos isso criava um padrão N+1.

Correção: o formulário carrega as variantes ativas completas uma vez e compartilha
o mapa com todos os itens. Esse mesmo conjunto alimenta seleção, cores, SKU,
preço e validação.

### 5. Cadastro de referência interrompia o fluxo

O seletor não tinha criação, atualização de cache ou busca por material/SKU.

Correção:

- busca por código, nome, material e SKU;
- status da ficha e preço-base aparecem no resultado;
- referências publicadas/validadas têm prioridade visual;
- “Nova referência” abre a ficha técnica diretamente no cadastro;
- “Atualizar referências” recarrega fichas e materiais sem perder o PV;
- configuração de materiais abre diretamente a aba de variações da ficha.

## Organização da tela

Cada item ganhou uma linha compacta de decisão industrial:

`Referência → Material → Cor e grade → Preço`

Ela mostra o que já está resolvido, o que falta e a origem do preço. O objetivo é
que o operador finalize uma linha comercial e tecnicamente válida sem precisar
reabrir vários menus para conferir contexto.

## Integridade no banco

A migration `20270101004100_sale_order_commercial_integrity.sql` adiciona:

- vigência final maior ou igual à inicial;
- preço de regra maior que zero;
- quantidade mínima maior ou igual a um;
- normalização de cor em maiúsculas;
- unicidade por tabela + referência + cor normalizada + faixa;
- coerência entre item, referência e variação de material.

## Critério industrial usado

O desenho segue a prática de precificação configurável: preço pode depender de
cliente, produto, quantidade, data e configuração; uma mudança de variante deve
recalcular o preço pelas mesmas regras e manter sua origem compreensível.

Referências primárias consultadas:

- [SAP Variant Configuration and Pricing — Pricing Service](https://help.sap.com/docs/variant-configuration-and-pricing/feature-scope-description-for-sap-variant-configuration-and-pricing/pricing-service)
- [SAP — Variant Conditions](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/a73402f511734e6eac56063e631bf24e/fe64b6531de6b64ce10000000a174cb4.html)
- [SAP — Detailed Pricing Service](https://help.sap.com/docs/variant-configuration-and-pricing/what-is-sap-variant-configuration-and-pricing/ecd742bef6044a868226483633d7e764.html)

## Testes e verificação

- resolução por cor e maior faixa atingida;
- fallback para regra da referência;
- prioridade tabela → variação → ficha;
- bloqueio de tabela inativa, futura e vencida;
- erro em item novo sem variação;
- aviso em item histórico sem variação;
- typecheck real do aplicativo;
- verificação de tokens visuais;
- auditoria SQL antes e depois da migration.
