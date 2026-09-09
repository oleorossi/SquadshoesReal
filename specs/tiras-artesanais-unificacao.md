# Unificação de Tiras Artesanais — Cadastro, Demanda, Produção, Compra e Estoque

> Complemento posterior: `identidade-variantes-e-tiras-compradas.md` generaliza
> o domínio para Tiras e formaliza componentes `buy_ready` não artesanais, como
> STRASS, com identidade independente da napa da referência.

> **Override prospectivo confirmado pelo usuário em 18/08/2026 — origem no PV.**
> **Atualização:** a origem continua automática (`reference_base → internal`), mas a
> política de cor passou a ser configurável por posição. Linhas legadas seguem a cor
> principal; linhas `select_on_order` recebem cor canônica própria no PV. O contrato
> vigente está em `specs/cores-independentes-por-tira-no-pv.md` e substitui somente as
> afirmações deste documento que acoplavam cor principal à identidade `reference_base`.
>
> A partir desta decisão, uma linha `reference_base` não nasce sem origem: ela usa o
> material estrutural do cabedal e sua política de cor define se herda a cor principal
> ou exige seleção própria no pedido.
> resolvido pela ficha/variante, e nasce `internal`. Ao cadastrar ou alterar essa intenção
> no PV, o escritor server-side deve criar ou reutilizar atomicamente somente a identidade
> exata exigida e persistir o snapshot. Uma linha `finished_product_group` — inclusive
> STRASS — mantém grupo/cor próprios e nasce `buy_ready`; Vendas escolhe sua cor própria,
> não sua origem. Este override não migra implicitamente variantes híbridas históricas nem
> reescreve PVs, demandas, documentos, movimentos ou custos já congelados. Em qualquer
> origem, o atendimento consome primeiro a tira acabada exata; a napa só é debitada no
> recebimento/apontamento da produção interna efetivamente realizada.

> **Decisão confirmada em 24/08/2026 — rendimento sem cor e menu próprio.** A receita de
> conversão pertence ao tipo/medida da tira e à família do material-base; a cor não participa
> do rendimento. Portanto, NAPA SOFT 1370 × 1000 mm → Tira Meia Cana 10 mm com rendimento
> confirmado de 55 m/m usa os mesmos 55 m/m em todas as cores da NAPA SOFT. As cores ainda
> possuem variantes e saldos físicos separados. O domínio também passa a aparecer no grupo
> principal **Tiras**, independente de **Terceirizados** e de **Engenharia**; ordens canônicas
> de tiras não entram nas listas, métricas nem relatórios genéricos de Terceirizados.
>
> Especificação normativa-base fechada com o usuário em 16/08/2026 e atualizada pelos overrides
> prospectivos de 18/08/2026 e 24/08/2026 acima. Este documento define a fonte única para todo o domínio de
> tiras artesanais. Ele substitui, nas partes em que
> houver conflito, `cadastro-tira-artesanal-no-pv.md`,
> `calculadora-tiras-cortes-parciais.md`,
> `tira-artesanal-fonte-unica-e-os-cabedal.md` e os trechos de tiras de
> `tira-base-napa-por-ficha-tecnica.md` e `os-consolidada-por-prestador.md`.
>
> Em especial, ficam revogadas as regras antigas de produto acabado compartilhado entre
> bases, origem herdada de `products.is_artisanal`, escolha operacional por nome/cor,
> rendimento herdado de outra napa e perda fixa de 15%. A automação de compra de tira pronta
> e de falta de napa deve obedecer também a `automacao-ordens-compra-demanda-pv.md`; este
> documento especializa aquela regra para tiras, sem criar um segundo motor de compras.
>
> Uma variante de tira pode conservar capacidade **híbrida** no catálogo e no histórico:
> sua capacidade de compra é independente de ser artesanal. `source_mode` persistido no PV
> continua governando o motor e não pode ser sobrescrito por um `procurement_type` cadastral
> exclusivo (`purchased` versus `artisanal`). Para intenções novas ou deliberadamente
> alteradas depois do override de 18/08/2026, porém, esse `source_mode` é derivado de
> `identity_basis` (`reference_base → internal`; `finished_product_group → buy_ready`), não
> escolhido pelo vendedor. O integrador deve representar a capacidade por
> `purchase_enabled`/equivalente sem usar essa capability como default de origem.
>
> Esta especialização altera formalmente quatro contratos do motor geral de OCs para demandas
> de tira: (1) aceita produto híbrido por `purchase_enabled + source_mode`; (2) aceita
> `coverage_mode='pre_netted'` e não refaz o netting; (3) o recebimento por item distingue
> entregue, aceito e rejeitado; (4) aceita contribuição sistêmica
> `source_type='strap_stock_floor'`, com FK estrutural para o piso e `sale_order_id`/item nulos,
> sem criar PV fictício. A implementação do motor geral deve ser estendida para esses contratos;
> não pode aplicar suas regras exclusivas antigas ao adaptador de tiras.

## Authority and superseded decisions

As reversões abaixo foram novamente apresentadas e confirmadas pelo usuário durante a
entrevista em 15/08/2026; a linha de origem do PV recebeu o override prospectivo expresso de
18/08/2026 registrado acima. Não são inferências da implementação:

| Tema | Regra anterior revogada | Regra normativa atual |
|---|---|---|
| Produto acabado | Um produto por tipo/medida + cor, compartilhado entre bases | Um produto e saldo por tipo + medida + **base** + cor |
| Origem do PV | Default por `products.is_artisanal`; depois, origem vazia com escolha manual por tira | Intenção prospectiva derivada de `identity_basis`: `reference_base` nasce `internal`; `finished_product_group` nasce `buy_ready`; fatos históricos permanecem congelados |
| Base da tira | Seleção por receita/nome/OS | Derivada da ficha/variante e persistida por ID no PV |
| Rendimento | Herança/escala ou estimativa com 15% | Receita exata, rendimento confirmado, nenhuma perda adicional |
| Estoque de segurança | Não fazia parte da automação geral de PV | Foi confirmado para tira pronta, por variante exata, e é preservado quando um PV dispara o cálculo |

Matriz de precedência documental:

- `identidade-variantes-e-tiras-compradas.md`: preservar a identidade independente e a
  origem fixa `buy_ready` de `finished_product_group`/STRASS, além das capabilities híbridas
  já existentes; o override de 18/08/2026 vence somente qualquer leitura de que uma nova
  intenção `reference_base` ainda possa escolher manualmente `buy_ready`.
- `cadastro-tira-artesanal-no-pv.md`: preservar criação contextual/atômica; revogar produto
  compartilhado, default MADRID editável, escolha de base na OS e “sem migration”.
- `calculadora-tiras-cortes-parciais.md`: preservar cenários de cortes parciais/unidades;
  revogar qualquer exemplo ou fórmula com perda de 15%.
- `tira-artesanal-fonte-unica-e-os-cabedal.md`: preservar identidade por linha e base derivada
  da ficha; revogar default vindo de `is_artisanal` e, prospectivamente, a escolha manual de
  origem para linhas classificadas por `identity_basis`.
- `tira-base-napa-por-ficha-tecnica.md`: preservar roteamento pela ficha/variante e ausência de
  override manual no PV.
- `os-consolidada-por-prestador.md`: preservar uma OS aberta por prestador e linhas
  rastreáveis; semana-alvo pertence às linhas/lotes, não cria outro contêiner antes do envio.
- Trechos de tira de `consumo-consolidado-padronizacao.md`: a agregação antiga deixa de ser
  autoridade; passa a consumir o resolvedor desta especificação.

## Goal

Unificar todas as funções de tiras artesanais em um único local e uma única regra de
cálculo, garantindo que cada PV reserve, produza, compre, receba, custeie e debite a tira
e a napa-base corretas. O fluxo deve impedir, por construção, que uma tira feita de NAPA
SOFT OFF WHITE seja confundida com a equivalente feita de NAPA MADRID OFF WHITE.

O usuário de Vendas define a identidade comercial: cor/material principal do item e, quando
houver uma linha `finished_product_group`, a cor própria desse componente. A classificação da
linha define automaticamente a origem prospectiva: produzir com a napa estrutural do cabedal
para `reference_base`, comprar pronta para `finished_product_group`. A partir dessa intenção,
o sistema executa o netting de estoque, o planejamento, a demanda de napa ou de tira pronta,
a rastreabilidade por PV e a integração de estoque, custos, terceiros e financeiro.

## Background / Problem

O domínio atual está dividido entre Calculadora de Tiras, Receitas em Terceirizados,
cadastros em Produtos/Estoque/Grupos, criação dentro do PV, planejamento de compra e
criação de OS. Esses caminhos não compartilham integralmente a mesma identidade, fórmula,
precisão ou transação.

Os principais riscos observados são:

- receitas e produtos relacionados por nomes livres, permitindo que grafia, acento ou
  ordem de consulta escolham a base errada;
- estoque de tira agrupado apenas por tipo e cor, mesmo quando SOFT e MADRID são materiais
  fisicamente diferentes;
- uma calculadora aplicar perda fixa de 15%, enquanto consumo, reserva e banco usam outro
  cálculo;
- o frontend estimar rendimento para uma base sem receita exata, enquanto o banco bloqueia;
- compra, reserva, baixa, custeio, picking e OS recalcularem o mesmo valor com precisões
  diferentes;
- produto final ser criado sem receita ou a receita falhar depois da criação do produto;
- baixa duplicada, ausência de baixa no delta ou agrupamento de napas diferentes na mesma
  linha de separação;
- produção/compra criada no navegador depois da aprovação do PV, podendo desaparecer se a
  aba fechar ou a chamada falhar;
- entrega parcial de terceirizado sem vínculo estrutural com estoque e financeiro.

Caso de regressão que esta feature deve impedir: NAPA SOFT possui a cor cadastrada como
“CURA OFF WHITE” e NAPA MADRID como “CURA OF WHITE”. Mesmo que ambas sejam aprovadas como
alias da cor canônica OFF WHITE, a identidade da base continua diferente. Nenhum cadastro,
reserva, picking, produção ou débito pode usar apenas o texto “OFF WHITE” para escolher
entre elas.

## Scope

### In scope

- Um hub único no grupo principal **Tiras → Central de Tiras**, separado de Engenharia e
  Terceirizados.
- Cadastro hierárquico de família/tipo, medida, napa-base e cor da tira.
- Separação entre largura final visível e largura efetivamente cortada da napa.
- Cor canônica e aliases aprovados, sem decisão operacional por comparação de texto.
- Receita e rendimento exatos por medida + napa-base, com sugestão geométrica e aprovação
  do rendimento real.
- Matriz de criação em lote de medidas × bases × cores existentes nas napas.
- Origem prospectiva automática por `identity_basis` no PV: `reference_base` interna com
  cor/material do cabedal; `finished_product_group` com cor própria e compra pronta.
- Estoque acabado separado por identidade estrutural: napa-base em `reference_base` e grupo
  próprio em `finished_product_group`.
- Netting de estoque e preservação do estoque mínimo por variante exata.
- Produção própria na fábrica ou transformação por terceirizado com napa da empresa.
- Demanda automática da napa faltante ou da tira pronta faltante.
- Consolidação semanal de produção com contribuição e número de cada PV.
- Conclusões/recebimentos parciais, rejeições, sobras e cancelamentos.
- OS terceirizada, remessa da napa, recebimento gradual e calendário financeiro semanal ou
  quinzenal por terceirizado.
- Custeio separado por origem, snapshot do PV, custo médio de estoque e análise de variação.
- Migração segura de produtos, receitas e saldos antigos.
- Remoção dos motores/formulários duplicados como autoridades de escrita.
- Auditoria, permissões, idempotência, concorrência e testes de paridade entre todas as
  superfícies.

### Out of scope (explicitly not now)

- Escolher manualmente outra napa no PV quando a ficha da referência/variante aponta uma
  base diferente. A correção deve ocorrer na ficha técnica.
- Inventar rendimento, base, cor, fornecedor, preço ou divisão de saldo para dados legados
  ambíguos.
- Rastrear fisicamente cada rolo/lote individual de napa, caso o estoque atual não possua
  controle de lote. A identidade mínima obrigatória é produto-base exato + cor.
- Alterar retroativamente movimentos de estoque, custos ou PVs já finalizados para “corrigir”
  o histórico. O legado ambíguo é saneado prospectivamente.
- Cotação entre vários fornecedores. Continua valendo um fornecedor por material.
- Reescrever regras gerais de OC que não sejam especializadas por esta feature.
- Reintroduzir percentual de perda de corte em qualquer motor.

## Requirements

### A. Hub único e fonte única

1. Deve existir a rota protegida e concedível `/tiras-artesanais`, no grupo próprio do menu
   **Tiras → Central de Tiras** e módulo de acesso `produtos`,
   contendo cadastro, receitas/rendimento, variantes/cores, estoque, demandas, lotes de
   produção, ordens terceirizadas e histórico. Abas mínimas: **Cadastro**, **Receitas e
   rendimento**, **Variantes e estoque**, **Demandas**, **Produção**, **Histórico/diagnóstico**
   e **Calculadora**.
2. “Calculadora de Tiras” deixa de ser um módulo operacional separado e passa a ser uma
   ferramenta dentro desse hub, alimentada pela mesma receita persistida.
3. Os pontos de entrada do PV, Estoque, Grupos, Compras e Terceirizados devem abrir o mesmo
   editor reutilizável, com o contexto pré-preenchido; não podem manter formulários ou
   validações independentes. O contrato mínimo do editor recebe `variantId`, `measureId`,
   `baseGroupId`, `colorId`, modo `create|edit|review`, origem da navegação e capabilities do
   usuário.
4. Rotas e botões legados devem redirecionar para o hub ou abrir o editor canônico. Não deve
   permanecer uma segunda tela capaz de gravar produto ou receita diretamente. Redirects
   mínimos:

   ```text
   /calculadora-tiras                 → /tiras-artesanais?tab=calculadora
   /artisanal-recipes                 → /tiras-artesanais?tab=receitas
   /terceirizados?tab=recipes         → /tiras-artesanais?tab=receitas
   ```
5. Uma única função/RPC server-side deve resolver identidade, quantidade de tira pronta,
   base exata, rendimento, quantidade de napa, disponibilidade, origem e datas. Compra,
   reserva, picking, baixa, produção, custeio, MRP, PDF e relatórios devem consumir o
   resultado persistido dessa resolução, sem refazer a fórmula localmente.
6. O frontend pode ter uma função pura espelho somente para preview imediato. Testes de
   paridade devem provar igualdade com a função canônica do banco para os mesmos inputs.
7. Toda gravação de produto + variante + receita deve ser atômica. Falha em qualquer parte
   não pode deixar produto ativo sem vínculo obrigatório nem receita órfã.

### B. Identidade, hierarquia e catálogo

8. Para `reference_base`, a hierarquia canônica é
   **família/tipo → medida → napa-base → cor canônica**. Exemplo:
   `TIRA CHATA → 8 mm → NAPA SOFT → OFF WHITE`. Para `finished_product_group`, a dimensão
   estrutural é o grupo próprio do componente acabado, seguida de sua cor canônica; a napa da
   referência não participa da identidade.
9. Família/tipo descreve a construção, como TIRA CHATA. Medida descreve a largura final
   visível, como 8 mm, 9 mm ou 10 mm.
10. A largura final e a largura da banda cortada são campos distintos. Somente a largura da
    banda cortada participa do cálculo geométrico.
11. A largura da banda pode variar para a mesma medida conforme a napa-base; por exemplo,
    TIRA CHATA 8 mm + SOFT pode usar uma banda diferente de TIRA CHATA 8 mm + MADRID.
12. A variante acabada `reference_base` possui identidade única por
    `(familia_id, medida_id, base_group_id, color_id)`. A variante
    `finished_product_group` usa a mesma chave física, mas seu `base_group_id` armazena o
    grupo próprio resolvido do `identity_group_id` da linha, não a napa da referência. Ambas
    apontam para exatamente um `finished_product_id` com unidade-base `m`; nomes e SKUs devem
    tornar a identidade física inequívoca, e nenhum lookup pode usar apenas
    `products.group_id + texto de cor`.
13. Em `reference_base`, SOFT OFF WHITE e MADRID OFF WHITE são variantes e saldos diferentes,
    ainda que usem o mesmo `color_id`. Não pode haver alocação, substituição, reserva ou baixa
    cruzada.
14. Uma tira comprada pronta que represente uma base/padrão material continua vinculada a
    essa base: padrão SOFT não atende MADRID. Já `finished_product_group`, como STRASS, é
    deliberadamente independente da napa do calçado e resolve exclusivamente por seu grupo
    próprio + medida + cor.
15. Relações operacionais devem usar IDs imutáveis de família, medida, variante, cor,
    produto-base quando aplicável, produto acabado e receita quando interna. A linha técnica
    carrega UUID estável, `identity_basis` e família/medida. No PV, `reference_base` combina
    medida + base estrutural do cabedal + cor principal do item; `finished_product_group`
    combina medida + `identity_group_id` + cor própria da linha. O `strap_variant_id` exato é
    persistido no snapshot. Nomes e `group_id + color` ficam apenas como rótulo/migração; é
    proibido lookup operacional por eles, inclusive `LIMIT 1`.
16. Deve existir um catálogo de cores canônicas e uma tabela de aliases. Normalização
    textual pode sugerir um alias, mas somente o Administrador pode aprová-lo. Um mesmo
    alias normalizado não pode estar aprovado para duas cores canônicas; conflito bloqueia
    a aprovação em vez de escolher uma cor por ordem de consulta.
17. “CURA OFF WHITE” e “CURA OF WHITE” podem apontar para a mesma cor canônica depois da
    aprovação, mas continuam ligados aos respectivos produtos-base SOFT e MADRID.
18. O seletor de cores da matriz deve listar a união das cores com produto de napa ativo em
    cada base vinculada, mostrando badges das bases que suportam cada cor.
19. Uma cor continua disponível para cadastro quando o produto-base ativo existe com saldo
    zero. Saldo zero gera falta real; não remove a cor do catálogo.
20. Nova cor de napa aparece como **Disponível para adicionar**. Usuário autorizado escolhe
    as medidas, revisa a matriz de combinações e confirma; o sistema não cria todas as
    variantes silenciosamente.
21. A criação em lote deve mostrar preview, criar somente combinações válidas, pular as já
    existentes e reportar criadas, puladas e bloqueadas.
22. Se houver dois produtos-base ativos para a mesma base + cor canônica, a combinação fica
    ambígua e bloqueada. O Administrador deve unificar os produtos ou designar um produto
    oficial antes de qualquer nova reserva ou baixa.
23. O estoque mínimo é obrigatório e configurado por variante exata. O formulário pode
    sugerir um valor herdado para acelerar o cadastro, mas o valor salvo pertence à variante
    e é editável. Zero é um valor explícito válido; `NULL` não é válido em variante ativa.
    Este mínimo de segurança é diferente de quantidade mínima comercial/MOQ. Cada variante
    também deve salvar `min_stock_replenishment_mode` (`internal` ou `buy_ready`), que governa
    exclusivamente a reposição do piso. Se somente uma origem estiver habilitada, a UI pode
    pré-selecioná-la, mas o valor deve ser confirmado e persistido; uma variante ativa não
    pode ficar sem essa definição. A origem escolhida deve ser uma capability válida no
    momento do cadastro; sua indisponibilidade posterior segue a suspensão do requisito 73.
24. Itens, receitas e variantes com histórico não podem ser excluídos fisicamente pela UI;
    devem ser arquivados/inativados.
25. Ao descontinuar uma napa-base ou cor, novas receitas e produção interna ficam bloqueadas,
    mas histórico e saldo de tira pronta permanecem. O saldo acabado pode ser consumido até
    zerar; compra pronta continua somente se seu cadastro comercial permanecer ativo.

### C. Receita, rendimento e precisão

26. A receita oficial é única e versionada por `(medida_id, base_group_id)`; cores da mesma
    medida/base compartilham a receita e o rendimento confirmado. Cor não pode existir no
    payload, na chave única nem no formulário de receita. Exemplo normativo: NAPA SOFT
    1370 × 1000 mm + Tira Meia Cana 10 mm + 55 m/m continua em 55 m/m para PRETO, OFF WHITE
    e qualquer outra cor pertencente à família NAPA SOFT. Seu ciclo é
    `draft → pending_approval → approved → superseded`, com saídas auditadas para
    `suspended` ou `archived`; somente `approved` vigente atende novos PVs.
27. Cada receita deve conter, no mínimo: largura final, largura da banda, largura útil da
    napa, rendimento teórico, rendimento confirmado, executor padrão, custo de transformação
    por metro, status, versão, aprovador e vigência.
28. A largura útil da napa vem do cadastro/ficha do material-base oficial. Não deve ser
    digitada novamente em cada cor nem inferida pela maior dimensão. Produtos de cores da
    mesma napa-base devem compartilhar a largura canônica; divergência cadastral suspende a
    receita até o saneamento, em vez de escolher uma largura arbitrária.
29. O número de bandas físicas completas é:

    ```text
    bandas_completas = floor(largura_util_napa_mm / largura_banda_mm)
    ```

30. Para um metro linear de napa, o rendimento geométrico teórico em metros de tira é o
    número de bandas completas. Exemplo: `floor(1370 / 20) = 68 m/m`, com sobra lateral de
    10 mm; nunca 68,5 m/m.
31. O hub deve sugerir o rendimento teórico e permitir que o usuário autorizado digite o
    rendimento real confirmado.
32. O rendimento confirmado deve ser maior que zero e menor ou igual à capacidade teórica.
    Exemplo: teórico 68, confirmado 64 é válido; 70 deve ser bloqueado.
33. O rendimento confirmado, e não o teórico, governa estoque, custo, reserva, baixa,
    planejamento, produção e compra de napa.
34. Ausência de receita exata ativa e aprovada para medida + base bloqueia a confirmação do
    PV quando a origem for interna. A tela mostra a sugestão geométrica e abre o hub, mas não
    utiliza estimativa provisória.
35. É proibido herdar ou escalar rendimento de outra napa ou outra medida. Uma receita de
    60 m/m em base de 1000 mm não autoriza o sistema a inventar 84 m/m para uma base de
    1400 mm.
36. O rendimento real apurado num lote deve ser registrado e comparado à receita. O sistema
    pode sugerir atualização, mas a receita oficial só muda após aprovação de Administrador
    ou usuário de Engenharia/Produtos explicitamente autorizado.
37. Alterar rendimento cria nova versão prospectiva. PVs já confirmados mantêm o snapshot da
    versão usada e não são recalculados silenciosamente.
38. Nenhum caminho pode aplicar perda fixa ou percentual adicional. Os rendimentos
    cadastrados já representam a realidade produtiva; a constante de 15% deve deixar de
    participar de todos os cálculos e testes.
39. As fórmulas canônicas são:

    ```text
    tira_pronta_m = consumo_cm_por_par * pares / 100
    napa_necessaria_m = tira_a_produzir_m / rendimento_confirmado_m_por_m
    ```

40. Cálculos devem manter precisão integral durante agregação, persistir no mínimo 6 casas
    decimais nas fronteiras operacionais e arredondar para 2 casas apenas na apresentação.
    Nunca arredondar cada contribuição antes de somar.

### D. Pedido de venda e origem derivada da intenção

41. Ao criar/editar uma intenção prospectiva num PV com tiras habilitadas, cada linha deve
    mostrar sua identidade e aplicar a origem por `identity_basis`, sem botões manuais de
    origem:
    - `reference_base`: usa a cor principal do item, a base estrutural do cabedal resolvida
      pela ficha/variante e `source_mode='internal'`;
    - `finished_product_group`: usa o grupo próprio persistido na ficha, a cor própria
      escolhida para a linha e `source_mode='buy_ready'`. STRASS pertence a este caso.
    A linha nasce na ficha/BOM com `technical_strap_line_id UUID NOT NULL` e
    `identity_basis`, copiados para o snapshot do item do PV.
42. Uma linha `reference_base` não começa com origem `NULL`, não oferece “Aplicar a todas” e
    não pode ser sobrescrita para `buy_ready` no fluxo comum de Vendas. Ao cadastrar ou
    alterar cor/material do item, o escritor server-side resolve a cor canônica, relê medida
    e base estrutural por UUID, cria ou reutiliza somente a variante interna exata exigida e
    persiste `strap_colors + strap_sourcing` na mesma transação do PV. Uma linha
    `finished_product_group` exige sua cor canônica própria, mas sua origem `buy_ready` é
    fixa. Snapshots históricos completos são preservados enquanto o fato permanece
    intocado; não há backfill silencioso para converter combinações híbridas antigas.
43. A quantidade bruta de tira vem da ficha técnica/consumo e da quantidade/grade do item do
    PV, usando a fórmula do requisito 39.
44. Para `reference_base`, napa-base e cor são derivadas automaticamente da referência,
    variante de material e cor principal do item, respeitando a precedência técnica canônica
    do cabedal. Vendas não pode trocar a base nem a cor da tira separadamente. Para
    `finished_product_group`, o grupo próprio vem da ficha e a cor é independente da cor
    principal do item.
45. A inexistência prévia da variante acabada `reference_base` exata não deve abrir outro
    formulário nem obrigar Vendas a sair do PV: o escritor cria/reutiliza atomicamente apenas
    a combinação pedida. Se ficha/variante não identificar base, medida, receita ou produto-
    base oficial inequívocos, ou se a cor principal não resolver para uma única cor canônica,
    o PV fica bloqueado com mensagem acionável para corrigir o cadastro. Vendas vê diagnóstico
    read-only e a ação **Solicitar correção**; **Abrir cadastro** só aparece para quem possui
    capability de gestão do catálogo.
46. Para a origem interna derivada de `reference_base`, a confirmação exige receita exata
    aprovada e custo de transformação válido. Para `finished_product_group`/`buy_ready`, exige
    preço de compra positivo; ausência de fornecedor segue o fluxo de OC provisória, sem
    esconder a demanda. Por decisão expressa deste escopo, variante legada sem preço também
    bloqueia a intenção de compra pronta e entra em revisão; não se aplica a tolerância geral
    que deixa legado sem preço avançar até uma OC bloqueada.
47. Na confirmação do PV, o sistema persiste por linha: `identity_basis`, variante e produtos
    exatos, origem derivada, quantidade, receita/versão quando interna, rendimento, data de
    necessidade, custo unitário aplicável, composição explicativa e chave idempotente.
48. No fluxo prospectivo comum não existe troca manual de origem: editar cor/material
    principal rederiva uma linha `reference_base`; editar a cor própria rederiva uma linha
    `finished_product_group`. Isso só pode replanejar documentos ainda reversíveis. Override
    administrativo de snapshot histórico ou troca depois de iniciar OS/lote interno ou
    aprovar OC exige Administrador, reversão transacional do reversível, motivo obrigatório e
    trilha de auditoria; fatos congelados não mudam implicitamente.
49. Editar quantidade, grade, referência, variante, cor, semana de faturamento ou cancelar o
    PV deve recalcular apenas sua contribuição enquanto os documentos estiverem abertos.
    Documentos aprovados/iniciados não podem ser reescritos silenciosamente.
50. Cancelar um PV antes da execução libera suas reservas e remove somente sua contribuição
    de lote/OS/OC consolidada. Nunca cancela o documento inteiro que contém outros PVs.
51. Cancelar um PV depois de a tira ter sido produzida ou recebida libera a tira acabada para
    o saldo livre da variante. Produção, baixa da napa, recebimento e custos já realizados
    permanecem registrados.
52. A confirmação deve apenas enfileirar/processar uma operação server-side transacional.
    Geração de demanda não pode depender do navegador permanecer aberto.
53. O worker deve ter retry, idempotência e diagnóstico visível. A demanda deve aparecer no
    hub em até 60 segundos em operação normal; falha não pode deixar PV aprovado sem uma
    pendência processável e visível. Jobs esgotados vão para diagnóstico/dead-letter e podem
    ser reprocessados sem duplicar demanda. Mudança transacional de estoque, reserva,
    recebimento parcial, custódia ou estado/quantidade de OC, lote e OS também deve reconciliar
    imediatamente ou reenfileirar todas as variantes afetadas. Eventos derivados carregam
    `correlation_id`; comparação semântica/no-op impede ciclos de reenfileiramento.

### E. Netting, reservas e estoque mínimo

54. O netting deve ocorrer por variante exata e considerar somente quantidades restantes de
    demanda e oferta: saldo físico atual, demandas ativas, contribuições/lotes já
    comprometidos e saldos restantes de recebimentos/produções parciais. Reserva é uma
    alocação da oferta a uma demanda, não uma nova demanda nem uma nova oferta. O worker
    canônico de alocação é o único dono desse netting; telas e montadores de OC não o repetem.
    Cada reprocessamento faz reconciliação global determinística: neutraliza logicamente as
    reservas e coberturas automáticas da revisão anterior, adiciona de volta sua reserva
    própria, recalcula do zero e substitui/supersede tudo atomicamente.
55. Ao alocar uma nova contribuição depois das anteriores, o estoque físico utilizável é:

    ```text
    estoque_nao_alocado = max(0,
      saldo_fisico - reservas_ativas_de_demandas_anteriores
    )
    disponivel_para_nova_contribuicao = max(0,
      estoque_nao_alocado - estoque_minimo_da_variante
    )
    ```

56. Na reconciliação agregada da variante, a necessidade total é calculada sem subtrair
    reservas outra vez, porque as demandas que originaram essas reservas já estão no
    numerador:

    ```text
    necessidade_reposicao = max(0,
      soma_demandas_ativas_restantes
      + estoque_minimo
      - saldo_fisico_atual
      - entradas_comprometidas_restantes
    )
    ```

    A implementação deve reconciliar as alocações em ordem de prioridade e distribuir o
    resultado por contribuição antes de escolher o documento de reposição. A mesma reserva
    ou entrada não pode ser subtraída/creditada duas vezes. O worker emite uma falta líquida
    persistida, com `purchase_product_id` exato e marcação `pre_netted`; o agregador geral de
    OCs consolida essa falta e aplica mínimo/múltiplo, mas não desconta estoque novamente.
57. Exemplo obrigatório: saldo 100 m, mínimo 30 m, PV de 90 m. O sistema reserva 70 m e
    produz/compra 20 m conforme a origem derivada e congelada da linha do PV, preservando
    30 m.
58. Tanto na origem interna quanto na compra pronta, usa-se primeiro o saldo acabado exato e
    repõe-se somente a falta líquida. Criar/aprovar o PV, reservar ou planejar nunca debita a
    napa; a baixa da base pertence exclusivamente ao recebimento/apontamento da transformação
    interna efetivamente realizada.
59. Se PVs de origens diferentes disputarem o mesmo saldo, a prioridade é o início produtivo
    mais próximo; em empate, o PV confirmado primeiro. A falta remanescente de cada PV segue
    o `source_mode` derivado ou historicamente congelado naquela linha. A parcela necessária
    apenas para recompor o estoque
    mínimo não herda a origem do primeiro/último PV: ela segue sempre o
    `min_stock_replenishment_mode` da variante.
60. Estoque acabado produzido internamente e comprado pronto forma um único saldo físico da
    variante exata. Cada movimento preserva origem, documento e custo, e o produto mantém
    custo médio ponderado.
61. Reservas, alocações e geração de falta devem ocorrer no servidor sob locks determinísticos
    adquiridos em ordem estável para `strap_variant_id` e todos os `base_product_id` afetados.
    Dois PVs simultâneos — inclusive medidas diferentes disputando a mesma napa — não podem
    prometer os mesmos metros nem criar demanda duplicada. Ao planejar produção, o scheduler
    também adquire locks por executor + dia, em ordem cronológica estável, para impedir que
    workers de variantes distintas prometam a mesma capacidade diária.
62. Somente entradas realmente comprometidas contam para evitar nova reposição: lote/OS
    ativo com contribuição persistida ou OC aprovada/enviada/parcial pelo saldo ainda não
    recebido. Provisões sem fornecedor e estimativas sem documento não são estoque em trânsito.
    Ao reprocessar, o motor reconhece e soma de volta a reserva da própria contribuição antes
    de recalculá-la, para não recomprar sua cobertura. A oferta só cobre a demanda se sua ETA/
    conclusão planejada for menor ou igual à data em que o material/tira é necessário; entrada
    tardia permanece visível, mas não esconde a falta do prazo atual.

### F. Planejamento e lote semanal

63. A tira deve estar concluída na semana fabril imediatamente anterior ao
    `main_production_start` calculado pelo cronograma global do PV e sua revisão de capacidade.
64. A janela da tira começa no primeiro dia em que a fábrica estiver aberta nessa semana e
    termina no último dia aberto, respeitando feriados, fechamentos e sábados produtivos. Se a
    semana inteira estiver fechada, usa-se a semana fabril aberta imediatamente anterior e
    registra-se a exceção de calendário; nunca se agenda num dia fechado.
65. Somente a parte produtiva usa calendário fabril/dias úteis. Lead time de fornecedor e
    preparo de material seguem dias corridos conforme a especificação geral de OCs. A
    transformação é distribuída na janela usando a capacidade em metros/dia configurada para
    o executor numa grade global executor × dia, compartilhada entre todas as variantes e
    lotes. Se a semana anterior não comportar a carga, o sistema estende o início para dias
    fabris anteriores, preservando o prazo. Quantidade que ainda não couber fica
    `unscheduled_m`, destacada como risco; nunca sobrecarrega o mesmo dia, troca origem ou
    empurra o prazo silenciosamente. Toda alocação executor × dia é persistida e serializada;
    a soma ativa de todos os lotes no dia nunca pode exceder a capacidade congelada.
66. Demandas internas compatíveis devem ser consolidadas pela chave
    `(target_week, strap_variant_id, recipe_id/version, executor_type, contractor_id)` em
    estados abertos elegíveis. Vários PVs podem compor o mesmo lote, mas cada contribuição
    permanece separada; receitas/terceiros diferentes nunca se misturam.
67. Enquanto o lote não tiver iniciado, uma nova contribuição compatível é adicionada ao
    mesmo lote. Depois de iniciado/fechado, a nova demanda gera complemento separado e
    auditado, sem alterar quantidades já executadas.
68. O lote e seu arquivo devem mostrar uma linha consolidada por variante e, imediatamente
    abaixo, a abertura por número do PV e metros. A parcela sistêmica do piso aparece numa
    linha própria **Reposição de estoque mínimo**, sem número de PV e sem ser atribuída a um
    pedido fictício. Exemplo:

    ```text
    TIRA CHATA 8 mm · NAPA SOFT · OFF WHITE — 230,00 m
      PV-00152 — 120,00 m
      PV-00158 —  80,00 m
      Reposição de estoque mínimo — 30,00 m
    ```

69. O arquivo de produção deve ser um PDF reproduzível, com lote, executor, semana, prazo,
    variante/base/cor, rendimento, napa planejada, total de tira e contribuições por PV.
70. A criticidade atual é derivada, nunca gravada como status: **Normal** até o início
    planejado da transformação; **Atrasada** quando hoje passou do início mas não da data-limite;
    **Urgente** quando hoje passou da data-limite e ainda há saldo aberto. Um PV confirmado
    depois do prazo continua permitido e já aparece Urgente para Planejamento e Administrador.
71. Se houver lote Atrasado/Urgente compatível ainda não iniciado, a contribuição pode ser
    anexada; caso contrário, cria-se lote complementar com a criticidade derivada. Nenhuma
    demanda vencida pode ser escondida em lote concluído.
72. Em conclusão parcial, a tira aprovada é alocada primeiro ao PV com início produtivo mais
    próximo; em empate, ao confirmado primeiro. O operador vê a sugestão e pode revisá-la
    antes de confirmar.
73. Reposição destinada apenas ao estoque mínimo tem prioridade depois de todos os PVs do
    lote. Este escopo preserva/recompõe o mínimo quando um PV dispara o cálculo; reposição
    autônoma sem PV continua no fluxo separado de MRP/reposição, reutiliza o mesmo
    `min_stock_replenishment_mode` e não cria demanda duplicada.
    O worker cria uma contribuição sistêmica `stock_floor`, sem atribuí-la ficticiamente a um
    PV, usando o `min_stock_replenishment_mode` da variante. Sua data de necessidade é a menor
    data ainda aberta entre os PVs que provocaram o déficit, mas sua prioridade operacional
    permanece depois de todas as contribuições reais desses PVs. Se a origem configurada
    estiver inválida ou inativa, a reposição do piso fica suspensa e acionável; o sistema não
    troca de origem silenciosamente nem bloqueia a cobertura possível dos PVs.
    Quando o modo for `internal`, a contribuição produz tira e compra somente eventual falta
    da napa-base após rendimento/reserva; quando for `buy_ready`, compra o produto acabado e
    nunca reserva ou debita napa.
    O bucket financeiro/comercial do piso usa e congela mês + quinzena do PV aberto com a
    menor data de necessidade. Se PVs causadores estiverem em quinzenas diferentes, nunca se
    escolhe pela ordem do job. Enquanto OC/lote/OS estiver aberto e não comprometido, mudar ou
    remover esse PV recalcula o âncora e move somente a contribuição do piso; depois do
    compromisso, o snapshot permanece e eventual diferença gera complemento auditado.

### G. Produção com napa própria

74. Em intenção prospectiva `reference_base`, a origem automática “Produzir com napa própria”
    significa usar o material estrutural do cabedal pertencente à empresa, podendo o executor
    ser a fábrica ou um terceirizado definido na receita. A mesma semântica continua valendo
    para snapshots internos históricos preservados.
75. Após descontar tira pronta disponível, a quantidade de napa a reservar é a falta líquida
    de tira dividida pelo rendimento confirmado da receita.
76. A confirmação calcula e persiste separadamente:

    ```text
    base_required = finished_internal_shortage / confirmed_yield
    base_reserved = min(base_required, base_available_now)
    base_inbound_allocated = min(
      base_required - base_reserved,
      committed_base_inbound_remaining
    )
    base_shortage = max(0,
      base_required - base_reserved - base_inbound_allocated
    )
    ```

    Somente `base_reserved` vira reserva física. A napa só é debitada quando a produção
    correspondente é concluída/recebida, nunca apenas na criação do lote.
77. Se existir `base_shortage`, a origem da tira continua interna e a falta líquida da napa
    gera demanda automática de compra do `base_product_id`. O mesmo worker canônico faz a
    alocação uma única vez e entrega à OC uma contribuição `pre_netted`.
78. A compra da napa faltante segue fornecedor, lead time, preparo, preço, mínimo, múltiplo,
    quinzena, aprovação, PDF, recebimento e financeiro de
    `automacao-ordens-compra-demanda-pv.md`. Sua data necessária é o início planejado do lote
    interno ou a data de remessa ao terceirizado — o que ocorrer primeiro — para que a napa
    esteja fisicamente disponível antes da transformação.
79. A produção permite múltiplos apontamentos parciais. Cada apontamento informa metros de
    tira aprovados, metros de napa realmente consumidos, data, operador e observações.
80. Cada parcial debita somente a napa efetivamente consumida, dá entrada somente na tira
    aprovada, atualiza o saldo restante e aloca a saída aos PVs conforme os requisitos 72–73.
    Se o consumo real superar o estoque contábil disponível, a operação debita até o
    disponível e cria `pending_reconciliation` para o déficit; não inventa estoque negativo
    nem impede o apontamento físico de concluir.
81. A conclusão registra rendimento real do lote:

    ```text
    rendimento_real = tira_aprovada_m / napa_consumida_m
    ```

    Desvio não altera receita automaticamente; gera comparação e sugestão para aprovação.
82. Produção acima da demanda entra no saldo livre da mesma variante. Produção abaixo mantém
    o saldo do lote e dos PVs pendente.
83. Cancelamento antes da produção libera a reserva da napa. Depois da transformação, não se
    “desproduz” a tira: libera-se o acabado, preservando baixa e custos.
84. Toda conclusão/recebimento deve ser idempotente e vinculada estruturalmente ao lote, item,
    variante, produto-base, produto acabado e movimentos. É proibida baixa por texto livre.
85. Deve existir um único responsável pela baixa. Inserir uma OS e chamar outra baixa manual
    não pode debitar a napa duas vezes; atualizar um lote deve movimentar apenas o delta
    confirmado.

### H. Transformação por terceirizado com napa da empresa

86. Quando o executor da receita for externo, a falta interna gera uma **Ordem de Serviço
    terceirizada**, não uma OC de material acabado. Executor terceirizado e fornecedor da
    tira pronta são papéis independentes e nunca servem de fallback um para o outro.
87. Demandas devem ser otimizadas por terceirizado numa OS-contêiner aberta, com linhas por
    variante/contribuição. O envio trava o contêiner; demandas posteriores entram em nova OS
    aberta, preservando o modelo de `os-consolidada-por-prestador.md` onde não conflitar.
    MOQ/múltiplo de compra de material não se aplica a serviço; não há lote mínimo de serviço
    neste escopo.
88. A OS e seu PDF devem listar produto-base/cor e quantidade de napa remetida, tira/medida a
    produzir, rendimento, prazo, metros e número de cada PV ao lado da respectiva linha. A
    contribuição de piso usa o rótulo **Reposição de estoque mínimo**, nunca um PV inventado.
89. A remessa transfere a napa para controle “em poder do terceirizado”, sem tratá-la como
    consumo definitivo, mas a retira imediatamente da disponibilidade da fábrica e a coloca
    numa localização/ledger de custódia. `base_available_now` considera somente o saldo na
    localização fábrica e exclui todo `balance_in_custody` ainda aberto. A baixa final ocorre
    conforme o material efetivamente consumido nos recebimentos. A OS só pode encerrar quando
    toda a napa remetida estiver
    reconciliada como consumida, devolvida, perda aprovada ou ajuste administrativo e o saldo
    final em poder do terceiro for zero.
90. O terceirizado pode devolver gradualmente. Cada recebimento parcial registra quantidade
    entregue, aprovada, rejeitada, napa consumida, documento/NF, data e responsável. A linha
    da OS congela receita, rendimento e custo de transformação por metro na emissão; mudança
    posterior no cadastro não reprecifica o serviço comprometido.
91. Somente metros aprovados entram no estoque de tira e geram valor a pagar. Exemplo:
    entrega 100 m, rejeita 15 m → entrada e pagamento de 85 m; 15 m permanecem pendentes na
    OS como rejeitados/devolvidos.
92. Metragem rejeitada não entra no estoque e não gera pagamento. A obrigação de reposição
    permanece aberta até nova entrega, cancelamento autorizado ou ajuste administrativo.
93. Quando a rejeição for responsabilidade do terceirizado e exigir napa adicional, o
    sistema não libera material automaticamente. Administrador autoriza a nova remessa e o
    custo da perda fica vinculado ao terceirizado.
94. A perda atribuída ao terceirizado gera uma pendência de desconto calculada pelo custo da
    napa perdida, usando o custo médio congelado na remessa. O desconto só entra no próximo
    ciclo após aprovação administrativa; não é aplicado automaticamente. Napa atribuída à
    rejeição/perda do terceiro vai para conta de perda/claim, não compõe simultaneamente o
    custo das tiras aprovadas. O desconto compensa essa perda sem duplicar recuperação.
95. Cada terceirizado possui calendário de pagamento configurável: frequência semanal ou
    quinzenal, corte e data(s) de pagamento. A data de entrada do recebimento determina o
    ciclo.
96. Recebimentos aprovados do mesmo terceirizado e ciclo formam um único lançamento
    financeiro consolidado no fechamento do ciclo, com abertura auditável das OS, linhas,
    parciais, metros, valores e descontos que compõem o total. O valor bruto de cada parcial é
    `metros_aprovados * custo_transformacao_snapshot_por_m`; descontos aprovados aparecem
    separadamente e reduzem o líquido do ciclo. Um desconto maior que o bruto do ciclo não
    cria título negativo: zera o líquido e carrega o crédito restante ao ciclo seguinte.
97. A condição de pagamento não pode ser texto impossível de calcular. O calendário deve ser
    estruturado e versionado; se a data cair em dia bancário não útil, usa-se o próximo dia
    bancário útil.
98. Nenhuma obrigação financeira é criada na emissão/envio da OS. A previsão pode aparecer
    no fluxo de caixa. Cada recebimento aceito cria uma competência imutável
    (`contractor_accrual`); o contas a pagar/título consolidado nasce somente no fechamento
    do ciclo a partir dessas competências. Recebimento retroativo após ciclo fechado entra
    no próximo ciclo ou num ciclo de ajuste, sem reabrir silenciosamente o título fechado.
99. O custo de transformação por metro cadastrado é o mesmo para execução na fábrica ou por
    terceirizado com napa própria, conforme decisão do usuário. O histórico ainda registra
    quem executou e o valor efetivamente reconhecido.

### I. Compra da tira pronta

100. Para uma linha prospectiva `finished_product_group`, a origem fixa “Comprar tira pronta”
     compra o produto acabado da variante exata de seu grupo/cor próprios, sem reserva, baixa
     ou saída da napa-base da fábrica. A mesma regra física vale para snapshots `buy_ready`
     históricos preservados. A data necessária entregue ao motor geral de OC é a data-limite
     em que a tira deve estar pronta, definida no requisito 64.
101. A variante deve declarar se compra pronta está habilitada. Quando habilitada, seu
     `finished_product_id` deve possuir, antes da ativação, `purchase_price > 0`, unidade de
     compra válida, `conversion_rate > 0` — e igual a 1 quando unidade de compra = unidade de
     estoque —, `min_order_quantity > 0`, `purchase_multiple > 0` e dias de preparo válidos
     (pré-preenchidos com 2 quando ausentes). Essa validação decorre de `purchase_enabled`, não
     de `procurement_type`; portanto também alcança o produto híbrido artesanal. O sistema não
     permite criar/ativar item comprável com qualquer campo inválido. Uma variante somente
     interna pode existir sem esses dados, mas a opção “Comprar tira pronta” permanece
     indisponível até completar seu cadastro comercial. `supplier_id` pode faltar apenas para
     o fluxo explícito de OC provisória do requisito 102.
102. Continua valendo um fornecedor por material. Falta de fornecedor cria contribuição em
     **OC Provisória — Sem fornecedor** com aprovação bloqueada; não autoriza substituir por
     outra base ou outra tira.
103. A falta líquida de tira pronta entra na OC do fornecedor + mês + quinzena e se consolida
     enquanto estiver em **Aguardando aprovação**, aplicando mínimo e múltiplo/pacote apenas
     depois de somar as contribuições compatíveis.
104. Aprovar a OC congela produto, base representada, preço, unidade, conversão, quantidade,
     condição de pagamento, contribuições e PDF. Novos PVs não alteram OC aprovada.
105. Recebimento parcial da tira pronta dá entrada apenas na quantidade aceita, atualiza o
     preço de compra efetivo e o custo médio separadamente, e mantém o saldo restante como
     inbound. Deve registrar entregue, aceita e rejeitada; somente aceita entra no estoque e
     no financeiro, enquanto rejeição mantém saldo/devolução/não conformidade conforme a OC.
     A quantidade aceita aloca primeiro os PVs prioritários; sobra causada por MOQ/pacote vai
     ao saldo livre, sem ser atribuída ficticiamente a um PV. Conversão de pacote/rolo para
     metros usa o snapshot congelado da OC. Não movimenta napa da fábrica.
106. O PDF da OC deve mostrar o número do PV ao lado ou imediatamente abaixo dos itens a que
     cada contribuição se refere. Contribuição sistêmica usa o rótulo **Reposição de estoque
     mínimo**, sem número fictício. Download múltiplo segue ZIP com um PDF por OC.
107. Todas as demais regras de aprovação administrativa, suspensão, urgência, lead time,
     preço, recebimento e financeiro seguem `automacao-ordens-compra-demanda-pv.md`, exceto
     pelas quatro especializações normativas declaradas no cabeçalho deste documento.

### J. Custos e estoque contábil

108. Para origem interna, o custo unitário previsto da tira é:

     ```text
     custo_interno_por_m =
       (custo_medio_napa_por_m / rendimento_confirmado_m_por_m)
       + custo_transformacao_por_m_de_tira
     ```

109. Para compra pronta, o custo unitário previsto é o preço de compra vigente e válido da
     variante acabada, convertido para a unidade-base `m` quando necessário.
110. O PV congela o custo da origem derivada — ou do snapshot histórico preservado — para
     **toda** a metragem daquela linha, mesmo quando parte será atendida por saldo existente.
     Exemplo: precisa 100 m, há 60 m e faltam 40 m; se a origem congelada é interna, os 100 m
     usam o custo interno previsto.
111. Alterações posteriores em napa, rendimento, transformação, fornecedor ou preço de compra
     afetam somente novos PVs. A margem aprovada do PV não é recalculada retroativamente.
112. Movimentos físicos continuam usando o custo efetivo de cada entrada e mantêm custo médio
     ponderado no único saldo da variante. O sistema mostra a variação entre custo congelado
     do PV e custo efetivo realizado.
113. O relatório de variação deve abrir por PV, variante, origem, quantidade, custo previsto,
     custo realizado e motivo da diferença, sem misturar bases.

### K. Permissões, estados e auditoria

114. Administrador e usuários de Engenharia/Produtos explicitamente autorizados podem criar
     ou editar famílias, medidas, variantes e receitas; aprovação de rendimento exige uma
     capability separada de aprovação.
115. Vendas pode consultar a identidade resolvida, definir cor/material principal do item e
     escolher a cor própria de `finished_product_group`; a origem é derivada automaticamente
     e não possui controle manual. Vendas não altera base, receita, rendimento, custos
     mestres ou aliases.
116. Produção pode consultar lotes/OS e registrar execução, parciais, consumo e rejeição, mas
     não aprova receita nem resolve ambiguidade cadastral.
117. Somente Administrador resolve alias, produto-base duplicado, migração ambígua, override
     de origem histórica após compromisso, perda de terceirizado e desconto financeiro.
     Capabilities server-side mínimas são `manage_strap_catalog`, `approve_strap_recipe`,
     `execute_strap_batch` e `resolve_strap_migration`; acesso ao módulo, por si só, não concede
     todas as ações.
118. Estados mínimos de cadastro são `active`, `review_required`, `suspended` e `archived`.
     Variante em revisão/suspensa preserva histórico, mas bloqueia novas reservas, produções,
     compras e débitos **novos** daquela combinação. Documento já comprometido pode concluir,
     receber, devolver ou ser estornado de forma auditada; suspensão não apaga nem paralisa
     cegamente um fato físico em andamento.
119. Lotes/OS/contribuições devem distinguir estado operacional de criticidade. “Urgente” e
     “Atrasada” são indicadores derivados de data, não substituem `pending`, `in_progress`,
     `partial`, `completed` ou `cancelled`.
120. Toda criação, edição, aprovação, inativação, derivação ou override administrativo de
     origem, alocação, recálculo, reserva, movimento, parcial, rejeição, cancelamento, perda e
     desconto deve registrar antes/depois, usuário, horário, motivo e IDs de origem.
121. RLS e RPCs devem aplicar essas permissões no servidor. Esconder botão no frontend não é
     controle de acesso suficiente. Valores de custo, margem e financeiro exigem também o gate
     canônico `canSeeFinancialValues`/equivalente; Produção pode operar sem vê-los.

### L. Migração e retirada do legado

122. Antes de alterar dados, deve existir relatório read-only de produtos, grupos, receitas,
     cores, aliases propostos, bases duplicadas, saldos, reservas, inbounds, OS e PVs
     afetados, com contagens, totais e checksums de conservação guardados para comparação.
123. A migração automática só vincula dados quando família, medida, base, cor e produto forem
     inequívocos por relacionamentos existentes. Nome semelhante, maior saldo ou primeira
     linha retornada não são evidência suficiente. Cada linha técnica legada recebe UUID
     estável por mapa persistido `(technical_sheet_id, caminho/ordinal legado, hash do
     conteúdo) → technical_strap_line_id`; nunca se usa `length + 1` como identidade nova.
124. Produto/receita/saldo antigo sem napa-base comprovada entra em `review_required`. O
     Administrador deve escolher a base e conferir ou dividir o saldo antes de liberar. Ao
     dividir produto acabado antes compartilhado, a soma dos novos saldos deve ser exatamente
     o saldo legado; movimentos históricos não são reescritos. Variante legada sem origem de
     reposição do piso também entra em revisão: a UI pode sugerir uma capability existente,
     mas Administrador confirma `min_stock_replenishment_mode`; é proibido inferi-lo de
     `products.is_artisanal`, do primeiro PV ou da ordem de processamento.
125. Casos ambíguos bloqueiam somente a variante afetada. Demais tiras corretamente migradas
     continuam operando. PV, reserva ou OS aberta que dependa da variante ambígua fica
     suspensa/acionável e não continua sendo processada pelo motor legado. Decisões antigas
     guardadas por `group + color` só são remapeadas para o UUID/variante quando houver um
     match único. PV aberto ambíguo e intocado não recebe origem nem identidade nova por
     backfill; quando o usuário alterar deliberadamente sua intenção e ela ainda for
     reversível, passa a valer a derivação prospectiva por `identity_basis`.
126. Aliases como “OFF WHITE”/“OF WHITE” são apenas sugeridos; Administrador aprova ou rejeita.
     A migração não une cores automaticamente.
127. Duplicatas da mesma base + cor devem ser unificadas/designadas antes de liberar o vínculo.
     Nenhum saldo é somado ou movido silenciosamente.
128. Histórico finalizado mantém seus IDs, `source_mode` e snapshots originais. Variantes
     híbridas históricas, inclusive combinações internas/compradas que deixaram de ser
     selecionáveis prospectivamente, não são convertidas em massa. Quando possível,
     adiciona-se referência nova sem reescrever quantidade, custo ou movimento histórico. A
     evolução de `artisanal_recipes` deve preservar/migrar seus IDs e FKs de OS por mapa
     explícito.
129. O corte deve: criar catálogo/mapeamentos sem ativar; migrar inequívocos; congelar
     escritores antigos; reconciliar documentos abertos; ativar o resolvedor novo numa troca
     única; migrar grants/favoritos explícitos de `/calculadora-tiras` e
     `/artisanal-recipes` para o novo hub sem herdar o acesso amplo de RH/Terceirizados nem
     elevar permissões; e então revogar/remover RPCs, triggers e policies antigas de escrita.
     `ArtisanalRecipes`, `CreateStrapProductDialog`, `ArtisanalProductDialog`,
     `GroupEditDialog` e o editor legado em `Contractors` deixam de gravar diretamente.
130. Testes que hoje exigem perda fixa, rendimento herdado, agrupamento somente por cor ou
     produto acabado compartilhado entre bases devem ser substituídos por testes desta
     especificação. O cutover deve remover nominalmente `trg_debit_service_order_base` na
     criação da OS e a baixa manual em `waveTimelineService`; somente a RPC de recebimento/
     conclusão parcial movimenta napa. Deve haver plano de rollback antes da ativação e views
     históricas somente leitura depois dela.

## Data model / Domain

Os nomes abaixo são canônicos para a implementação. Tabelas existentes podem ser migradas ou
renomeadas, mas não podem permanecer como uma segunda fonte de verdade com semântica diferente.

### Catálogo

- `artisanal_strap_types`
  - `id`, `name`, `active`, `created_at`, `updated_at`.
  - Exemplo: TIRA CHATA.
- `artisanal_strap_measures`
  - `id`, `strap_type_id`, `display_name`, `finished_width_mm`, `active`.
  - Unique ativo por `(strap_type_id, finished_width_mm)`.
- `canonical_colors`
  - `id`, `name`, `active`.
- `color_aliases`
  - `id`, `canonical_color_id`, `alias`, `alias_norm`, `status`, `approved_by`, `approved_at`.
  - Sugestão pendente nunca participa da resolução operacional.
  - Índice parcial unique global em `alias_norm` para `status='approved'`; a normalização é
    determinística e versionada. Aprovar um alias já pertencente a outra cor retorna conflito.
- `base_material_width_profiles`
  - `id`, `base_group_id`, `usable_width_mm`, `status`, vigência, aprovador e auditoria.
  - Existe um perfil vigente por base. Todos os produtos oficiais de cor vinculados devem
    ser compatíveis; divergência põe a variante afetada em revisão.
- `base_material_color_official_products`
  - Tabela persistida, não apenas view: `base_group_id`, `color_id`,
    `official_product_id`, `status`, `approved_by`, `approved_at`, timestamps.
  - Unique ativo por base + cor e FK para `products`; permite ao Administrador designar o
    oficial com histórico/auditoria.
- `artisanal_strap_variants`
  - `id`, `measure_id`, `base_group_id`, `identity_basis`,
    `internal_production_enabled`, `color_id`, `finished_product_id`, `min_stock_m`,
    `min_stock_replenishment_mode` (`internal`|`buy_ready`), `purchase_enabled`, `status`,
    `review_reason`, timestamps.
  - Unique `(measure_id, base_group_id, color_id)`.
  - Em `reference_base`, `base_group_id` é a napa/material estrutural do cabedal. Em
    `finished_product_group`, é o grupo próprio do componente acabado, resolvido do
    `identity_group_id` da linha; nesse caso `internal_production_enabled=false`,
    `purchase_enabled=true` e o piso é `buy_ready`.
  - `finished_product_id` único por variante; unidade do produto = `m`.
  - Para `reference_base`, o produto-base atual é resolvido exclusivamente por
    `base_material_color_official_products`; a variante não duplica esse vínculo. Ao confirmar
    o PV, o produto oficial exato é congelado em `sale_order_strap_demands.base_product_id`,
    preservando o histórico caso a designação oficial mude depois. Para
    `finished_product_group`, `base_product_id` e receita interna são nulos; o produto acabado
    pertence ao grupo próprio e é a identidade comprável.
  - O `finished_product_id` guarda o cadastro comercial canônico de compra pronta:
    `products.supplier_id`, `products.purchase_unit`, `products.conversion_rate`,
    `products.purchase_price`, `products.min_order_quantity`,
    `products.purchase_multiple` e `products.material_preparation_days`. Esses campos não
    podem ser copiados para a variante ou outra tabela concorrente; aprovação da OC congela
    seus valores no documento.
  - Fonte de cada conceito: `products.quantity` e `products.unit_price` são saldo físico e
    custo médio contábil; `artisanal_strap_variants.min_stock_m` é o único mínimo de
    segurança gravável; `min_stock_replenishment_mode` é a única origem padrão do piso e não
    substitui `source_mode` do PV; o campo separado de preço de compra do produto é comercial;
    status da variante governa a ativação operacional. `products.min_stock` legado deixa de
    ser gravável para esses itens; `products.active` é sincronizado pela mesma transação e não
    pode divergir nem ser editado por outro formulário.

### Receita versionada

- `artisanal_strap_recipes`
  - `id`, `measure_id`, `base_group_id`, `base_width_profile_id`, `version`,
    `usable_base_width_mm_snapshot`,
    `cut_band_width_mm`, `theoretical_yield_m_per_m`, `confirmed_yield_m_per_m`,
    `executor_type` (`factory`|`contractor`), `default_contractor_id`,
    `transformation_cost_per_m`, `status`, `valid_from`,
    `approved_by`, `approved_at`, `supersedes_recipe_id`, timestamps.
  - Unique `(measure_id, base_group_id, version)` e índice parcial para uma única versão
    `approved` vigente por medida + base.
  - `default_contractor_id` obrigatório quando executor = contractor e nulo quando factory.
- A largura final mora em `artisanal_strap_measures`; a banda e o rendimento variam por base
  e moram na receita.

### Demanda do PV

- A ficha/BOM deve persistir `technical_strap_line_id UUID NOT NULL` e `measure_id` em cada
  linha de tira, além de `identity_basis`. Em `reference_base`, cor e base não pertencem à
  linha genérica: o PV combina a cor principal do item com o material estrutural do cabedal.
  Em `finished_product_group`, a ficha persiste também `identity_group_id` e o PV escolhe uma
  cor própria da linha. Se o armazenamento continuar em JSON durante a migração, os UUIDs são
  estáveis e não podem ser regenerados a cada leitura/edição.
- `sale_order_strap_demands`
  - `id`, `sale_order_id`, `sale_order_item_id`, `technical_strap_line_id UUID NOT NULL`,
    `strap_variant_id`, `base_product_id`, `finished_product_id`,
    `recipe_id` (obrigatório para internal; nulo para buy_ready),
    `source_mode` (`internal`|`buy_ready`), `purchase_product_id` (nulo sem falta;
    `base_product_id` na falta de napa ou `finished_product_id` na compra pronta),
    `coverage_mode='pre_netted'`,
    `gross_required_m`, `finished_stock_allocated_m`, `finished_shortage_m`,
    `base_required_m`, `base_reserved_m`, `base_inbound_allocated_m`, `base_shortage_m`,
    `purchase_shortage_stock_unit`, `main_production_start`, `schedule_revision`,
    `strap_start`, `strap_deadline`, `base_required_at`, `base_purchase_by`, `target_week`,
    `status`, snapshots de identidade, rendimento e custo, `revision`, `operation_type`,
    `idempotency_key`, `payload_hash`, timestamps.
  - Índice parcial garante uma única revisão corrente por
    `(sale_order_item_id, technical_strap_line_id)`; a revisão anterior vira `superseded` na
    mesma transação.
  - `UNIQUE(operation_type, idempotency_key)`: mesma chave + mesmo hash retorna o resultado;
    mesma chave + payload diferente retorna conflito.
- Para intenção prospectiva, o writer deriva e congela `source_mode` exclusivamente de
  `identity_basis`: `reference_base → internal`, `finished_product_group → buy_ready`. A
  coluna continua necessária porque fatos históricos e demandas já comprometidas preservam
  o snapshot que realmente os originou; sua existência não autoriza um seletor manual novo.
- A tabela deve permitir retirar/recalcular a contribuição de um PV sem apagar as demais
  contribuições do mesmo lote, OS ou OC.
- `strap_stock_floor_contributions`
  - `id`, `strap_variant_id`, `base_product_id`, `finished_product_id`, `recipe_id`,
    `confirmed_yield_snapshot`, `source_mode`, `calculation_revision`, `required_m`,
    `base_required_m`, `base_reserved_m`, `base_inbound_allocated_m`, `base_shortage_m`,
    `purchase_product_id`, `purchase_shortage_stock_unit`, `coverage_mode='pre_netted'`,
    datas de necessidade/planejamento, `billing_anchor_demand_id`, `billing_month`,
    `billing_fortnight`, `correlation_id`, `status`, `revision`, `operation_type`,
    `idempotency_key`, `payload_hash`, timestamps.
  - `source_mode` é snapshot de `artisanal_strap_variants.min_stock_replenishment_mode`.
    A linha representa somente a diferença necessária para recompor o piso, deriva do estado
    agregado da variante e nunca possui `sale_order_id`. Uma única revisão corrente por
    variante é garantida por índice parcial. No modo `internal`, `purchase_product_id` só
    aponta para a napa-base se houver `base_shortage_m`; no modo `buy_ready`, aponta para o
    produto acabado. `billing_anchor_demand_id` referencia somente o PV mais urgente usado
    para derivar mês/quinzena; não transforma o piso em contribuição daquele PV. Reprocessamento
    supersede/reduz/move a contribuição atomicamente quando o piso já estiver coberto ou o
    âncora aberto mudar; não cria demanda cumulativa.
- Extensão canônica de `purchase_demand_contributions` do motor geral de OCs:
  - adicionar `source_type` (`pv_automatico`|`strap_stock_floor`) e
    `strap_stock_floor_contribution_id`.
  - `source_type='pv_automatico'` exige `sale_order_id` e `sale_order_item_id` e mantém a FK do
    piso nula; `source_type='strap_stock_floor'` exige a FK do piso e mantém os dois campos de
    PV nulos. Um `CHECK` XOR impede linha híbrida/órfã.
  - Para o piso, `billing_anchor`, ano, mês e quinzena vêm dos snapshots de
    `strap_stock_floor_contributions`; vínculo com OC/item continua estrutural como no motor
    geral. O PDF usa o rótulo do requisito 106 em vez de número de PV.
- `strap_demand_jobs`
  - `id`, origem/revisão, `status`, `attempts`, `next_attempt_at`, `locked_at`, `locked_by`,
    `last_error`, `idempotency_key`, `payload_hash`, timestamps.
  - Unique por origem/revisão, processamento com lock/skip locked, retry e dead-letter
    consultável. Mudança de receita, variante, base oficial, executor, calendário,
    `schedule_revision`, estoque, reserva, recebimento parcial, custódia ou estado/quantidade
    de OC, lote e OS reconcilia na própria transação ou reenfileira a demanda afetada.
    `correlation_id`, origem do evento e hash semântico tornam eventos derivados rastreáveis;
    nenhuma mudança material vira no-op, e no-op não cria loop.

### Produção e recebimentos

- `strap_executor_capacities`
  - `id`, `executor_type`, `contractor_id`, `capacity_m_per_open_day`, `calendar_id`,
    vigência, versão e status.
  - Capacidade deve ser positiva antes do planejamento; fábrica usa calendário fabril e
    terceiro usa o calendário operacional configurado para o executor.
- `strap_production_batches`
  - `id`, `target_week`, `executor_type`, `contractor_id`, `production_start_date`,
    `deadline`, `schedule_revision`, `capacity_profile_id`,
    `capacity_m_per_open_day_snapshot`, `status`, `started_at`, `completed_at`, timestamps.
  - A criticidade atual vem de view/função; não existe coluna `urgency` mutável.
  - Índice parcial unique define um único bucket aberto por
    `(target_week, executor_type, contractor_id, schedule_revision)`; `contractor_id` é
    normalizado por coluna/chave auxiliar não nula para a fábrica. Uma nova geração/revisão
    cria outro bucket sem reescrever o anterior.
- `strap_production_batch_items`
  - `id`, `batch_id`, `strap_variant_id`, `recipe_id`/versão, totais planejados de
    tira/napa, `scheduled_m`, `unscheduled_m`, totais realizados, status.
  - Unique `(batch_id, strap_variant_id, recipe_id)`; a chave completa do requisito 66 resulta
    do bucket no cabeçalho + item dentro do bucket, sem índice impossível entre tabelas.
- `strap_production_batch_contributions`
  - `id`, `batch_item_id`, `sale_order_strap_demand_id`, `stock_floor_contribution_id`, metros
    planejados/alocados/entregues, prioridade e status.
  - `CHECK` XOR exige exatamente uma origem entre demanda de PV e contribuição de piso.
- `strap_executor_daily_capacity_buckets`
  - `id`, `executor_type`, `contractor_id`, `work_date`, `capacity_profile_id`,
    `capacity_m_snapshot`, `schedule_revision`, `status`, timestamps.
  - Unique parcial dos estados ativos por `(executor_type, contractor_key, work_date)`, usando
    uma chave auxiliar não nula para fábrica. `schedule_revision` fica no histórico, mas nunca
    autoriza dois buckets ativos no mesmo executor/dia. Replanejamento supersede bucket e
    alocações anteriores atomicamente antes de ativar a nova revisão.
- `strap_executor_daily_capacity_allocations`
  - `id`, `capacity_bucket_id`, `batch_item_id`, `scheduled_m`, `status`, timestamps.
  - Unique ativo por `(capacity_bucket_id, batch_item_id)`. A RPC de agendamento bloqueia
    todas as chaves executor/dia afetadas em ordem estável e valida, na mesma transação, que a
    soma de alocações de todos os buckets/revisões ainda ativos seja menor ou igual a
    `capacity_m_snapshot` do único bucket ativo. O saldo sem alocação permanece em
    `strap_production_batch_items.unscheduled_m` e nunca aparece como planejado.
- `strap_production_receipts`
  - `id`, `batch_item_id`, `service_order_item_id`, `operation_type`, metros
    entregues/aprovados/rejeitados, napa consumida/devolvida/perdida, saldo em poder do
    terceirizado, documento, data, usuário, `idempotency_key` e `payload_hash`.
  - `CHECK` XOR exige exatamente um entre `batch_item_id` e `service_order_item_id`; todas as
    quantidades são não negativas e deve valer
    `delivered_m = approved_m + rejected_m`.
  - Unique por tipo de operação + idempotency key, com a mesma regra de replay/hash da demanda.
- Para executor externo, `service_orders` continua como contêiner e
  `service_order_items` referencia variante, receita, lote e contribuição. Recebimentos
  parciais devem ser linhas próprias; não sobrescrever um único `received_quantity` sem
  histórico.

### Terceirizado e financeiro

- `contractor_payment_schedules`
  - `id`, `contractor_id`, `frequency` (`weekly`|`biweekly`), dia(s)/regra de corte,
    dia(s) ou offset de pagamento, timezone `America/Sao_Paulo`, calendário bancário,
    vigência e versão.
- `contractor_payment_cycles`
  - `contractor_id`, `schedule_version_id`, `cycle_start`, `cycle_end`, `payment_date`,
    `status`; unique por prestador + versão + início/fim.
- `contractor_loss_claims`
  - OS/item/recebimento, produto-base, quantidade, custo snapshot, responsável, evidências,
    status (`pending`|`approved`|`rejected`|`applied`), aprovador e ciclo aplicado.
- O lançamento financeiro consolidado deve possuir FK estrutural para terceirizado e ciclo;
  tabela de composição liga cada parcial e desconto. Não usar token em `notes` como vínculo.
- O terceirizado deve apontar para um beneficiário financeiro válido usado pelo contas a
  pagar. Isso não o transforma no fornecedor comercial da tira pronta.
- `contractor_accruals` registra cada parcial aceito; o fechamento do ciclo materializa um
  único `accounts_payable` imutável com todas as competências e descontos. Eventual lote de
  pagamento é etapa posterior e referencia esse AP; não o substitui.

### Extensão do recebimento de OC para tira pronta

- `purchase_receipt_items` deve possuir `delivered_quantity`, `accepted_quantity`,
  `rejected_quantity`, motivo/disposição da rejeição e saldo aberto.
- Deve valer `delivered = accepted + rejected`. Somente `accepted` alimenta estoque, custo
  médio, alocação de PV e contas a pagar; `rejected` gera devolução/não conformidade e mantém
  o tratamento do saldo da OC explicitamente rastreável.
- A extensão é usada pelo adaptador de tira e pode ser generalizada pelo motor de OC; não se
  deve criar um recebimento paralelo desconectado da OC.

### Estoque e movimentos

- Reservas e movimentos precisam de FKs para `strap_variant_id`, `base_product_id`,
  `finished_product_id`, demanda do PV, lote/OS, item e recebimento.
- Entrada de tira pronta registra `origin_type` (`internal_factory`,
  `internal_contractor`, `buy_ready`) e custo efetivo.
- Baixa de napa registra quantidade real, receita/versão e documento de transformação.
- Quantidade reservada parcialmente consumida usa saldo
  `reserved_quantity - consumed_quantity`, nunca a reserva original integral.
- `contractor_material_custody_movements`
  - `id`, `service_order_id`, `service_order_item_id`, `base_product_id`, tipo
    (`sent`|`consumed`|`returned`|`lost`|`adjusted`), quantidade, custo snapshot,
    `contractor_loss_claim_id`, documento, `idempotency_key`, `payload_hash`, usuário e data.
  - `adjusted` possui quantidade assinada, motivo e aprovação administrativa. Saldo por
    OS/item/produto nunca negativo. Deve valer
    `balance_in_custody = SUM(sent) + SUM(adjusted) - SUM(consumed) - SUM(returned) - SUM(lost)`;
    remessas adicionais são novos movimentos `sent`. O encerramento exige saldo igual a zero.
  - Movimento `lost` exige FK para `contractor_loss_claims` já aprovado e só é postado pela
    RPC de aprovação. Claim pendente/rejeitado não reduz o saldo de custódia e bloqueia o
    encerramento enquanto o material não for devolvido, consumido ou ajustado validamente.

### Máquina de estados e imutabilidade

- Receita aprovada, snapshot de PV, OC aprovada e recebimento confirmado são registros
  versionados/imutáveis. Correção posterior ocorre por nova versão ou estorno auditado.
- Criticidade é derivada da data corrente; status operacional é persistido.
- Constraints e triggers devem impedir valor negativo, rendimento inválido, produto sem
  unidade `m`, variante ativa sem mínimo/origem de reposição do piso e duas identidades
  oficiais concorrentes.
- Demanda: `pending → allocated → planned → in_progress → partial → fulfilled`, com saídas
  auditadas para `superseded`, `cancelled` ou `error`.
- Lote/linha: `draft → planned → in_progress → partial → completed`, com `cancelled` apenas
  antes de fatos irreversíveis ou por estorno administrativo.
- OS externa: `pending → sent → in_progress/partial → completed`; envio é o ponto de
  compromisso e trava novas linhas no contêiner.
- `suspended` bloqueia novos compromissos, mas permite receber/concluir/devolver ou estornar
  documento já comprometido sob regras e auditoria.
- Demanda, lote e OS podem entrar em `suspended` a partir de qualquer estado ainda aberto,
  guardando `suspended_from_status`, motivo, usuário e data. Após saneamento, somente
  Administrador retoma para o estado anterior válido ou cancela. Em documento já enviado/
  iniciado, suspensão bloqueia novos apontamentos não essenciais, mas permite recebimento,
  devolução e reconciliação do material que já está fisicamente em trânsito.

## User flows

### Happy path — cadastrar uma família/medidas/cores

1. Usuário autorizado abre **Tiras → Central de Tiras** e cria TIRA CHATA.
2. Adiciona medidas 8, 9 e 10 mm.
3. Para 8 mm, vincula NAPA SOFT e NAPA MADRID; informa a banda real para cada base.
4. O sistema lê a largura útil das napas, calcula bandas completas e sugere o rendimento.
5. Usuário informa rendimento real, custo, executor e envia para aprovação.
6. Após aprovada, a matriz mostra as cores ativas existentes em cada napa, inclusive as de
   saldo zero, com badge SOFT/MADRID.
7. Usuário seleciona cores e medidas, revisa o preview e confirma atomicamente as variantes.
   Para cada variante, confirma o estoque mínimo e se a reposição desse piso será interna ou
   por compra pronta.

### Happy path — PV com produção interna

1. A ficha classifica a linha como `reference_base`; a variante de material resolve NAPA
   MADRID e Vendas define OFF WHITE como cor principal do item.
2. Na própria gravação do PV, o servidor cria/reutiliza TIRA CHATA 8 mm + NAPA MADRID + OFF
   WHITE e congela `source_mode='internal'`, sem pedir escolha manual de origem.
3. O worker persiste a demanda, aloca tira pronta exata preservando o mínimo e calcula a falta.
4. Para a falta, aplica o rendimento confirmado de 8 mm + MADRID e reserva NAPA MADRID OFF
   WHITE; jamais procura NAPA SOFT pela semelhança da cor.
5. Se faltar napa, cria contribuição na automação de OC da napa.
6. Cria/adiciona contribuição ao lote da semana anterior ao início produtivo.
7. Na conclusão parcial, debita a napa real, entra a tira aprovada e aloca aos PVs prioritários.

### Happy path — PV com compra pronta

1. A ficha classifica STRASS como `finished_product_group`; Vendas escolhe a cor própria dessa
   linha e o servidor congela `source_mode='buy_ready'`.
2. O worker usa primeiro o saldo acabado preservando o mínimo.
3. A falta vai para a OC do fornecedor/quinzena da tira pronta, sem movimentar napa.
4. O PDF abre os metros por PV. Após aprovação, a OC congela.
5. Cada recebimento aceito entra no saldo da tira e atualiza custo; a napa continua intacta.

### Happy path — terceirizado com napa da fábrica

1. A receita interna aponta executor terceirizado. A demanda entra como linha na OS aberta
   daquele prestador, com PV, variante, napa e quantidades.
2. Ao enviar, a napa passa para “em poder do terceirizado” e a OS trava.
3. O prestador entrega parcialmente; conferência informa entregue/aprovado/rejeitado e napa
   consumida.
4. Somente aprovado entra no estoque e é alocado. Rejeitado permanece pendente e não paga.
5. A entrada aprovada entra no ciclo semanal/quinzenal determinado pela data e calendário do
   prestador.
6. Ao fechar o ciclo, um lançamento financeiro consolida todas as entradas daquele prestador,
   com abertura completa.

### Cancelar ou editar PV

- Antes do compromisso: worker remove/move somente a contribuição, libera reservas e recalcula
  o documento aberto.
- Depois de produção/recebimento: a quantidade já pronta vira saldo livre; fatos físicos e
  financeiros permanecem.
- Depois de OC aprovada ou lote/OS iniciado: editar a identidade prospectiva ou fazer override
  de origem histórica exige Administrador e não altera snapshots sem reversão explícita.

### Migração

1. Dry-run classifica cada combinação como inequívoca, alias sugerido, produto duplicado,
   base ausente ou saldo sem origem e congela checksums de saldos/reservas/inbounds.
2. O catálogo e os mapas novos são criados sem ativar o resolvedor.
3. Combinações inequívocas migram para IDs/variantes exatas; grupo/medida extraídos apenas do
   nome viram sugestão, não migração automática.
4. Registros ambíguos ou sem campo obrigatório ficam em revisão somente naquela variante.
   Administrador aprova aliases, escolhe produto oficial, confirma a origem de reposição do
   piso e confere/divide saldo com conservação obrigatória.
5. Origem legada explícita mapeia `in_house → internal` e `purchased → buy_ready`; PV aberto
   sem origem comprovada e intocado fica acionável, sem backfill. Se o usuário alterar
   deliberadamente uma intenção ainda reversível, a linha passa a seguir
   `reference_base → internal` ou `finished_product_group → buy_ready`.
6. Escritores antigos são congelados; reservas, demandas e documentos abertos são
   reconciliados; OS histórica conserva `artisanal_recipe_id` ou mapa/snapshot equivalente.
7. O resolvedor novo é ativado numa única virada, permissões/favoritos são migrados e os
   escritores/gatilhos antigos são revogados. Views históricas permanecem somente leitura.
8. Checksums pós-corte provam conservação e o plano de rollback permanece disponível até a
   validação operacional.

## Edge cases & failure modes

- **SOFT e MADRID com a mesma cor canônica** → duas variantes, dois produtos acabados e dois
  saldos; somente o produto-base apontado pela ficha pode ser reservado/debitado.
- **Alias ainda pendente** → não participa da resolução; cadastro fica bloqueado até aprovação.
- **Dois produtos-base para base + cor** → `review_required`; nunca escolher pelo maior saldo.
- **Saldo zero da napa** → cor continua cadastrável; produção interna gera demanda real da napa.
- **Receita ausente** → bloquear origem interna; não usar teórico, outra base ou escala por
  largura como fallback.
- **Preço da tira pronta zero/ausente** → bloquear confirmação de compra pronta.
- **Fornecedor ausente** → criar OC provisória visível e impedir aprovação, conforme spec de OC.
- **Rendimento confirmado acima do físico** → constraint bloqueia gravação.
- **Largura útil menor que a banda** → zero bandas; receita não pode ser ativada.
- **Contribuições muito pequenas** → somar em precisão total antes de arredondar; não desaparecer.
- **Duas abas confirmam PVs simultâneos** → locks + unique keys produzem uma alocação e uma
  contribuição por origem, sem estoque negativo ou duplicação.
- **Snapshots históricos internos e comprados na mesma variante híbrida** → cada fato conserva
  seu `source_mode`; nenhuma migração implícita os converte. Intenções prospectivas novas
  seguem `identity_basis`; somente a parcela do piso segue
  `min_stock_replenishment_mode`, independentemente da ordem dos jobs.
- **Origem configurada do piso torna-se indisponível** → suspender e sinalizar apenas a
  contribuição `stock_floor`; não mudar de origem nem impedir a cobertura válida dos PVs.
- **Worker falha depois do PV** → job permanece pendente/erro com retry e alerta; nunca some.
- **PV troca de semana** → contribuição aberta migra para o lote/OC correto; snapshots
  comprometidos permanecem.
- **PV depois do início planejado, mas antes do prazo** → Atrasada; depois do prazo com saldo
  aberto → Urgente; não bloquear confirmação.
- **Semana anterior sem nenhum dia fabril aberto** → mover para a semana fabril anterior mais
  próxima, registrar exceção e recalcular a data necessária da napa.
- **Mudança da revisão do cronograma global** → supersede/reagenda somente contribuições ainda
  abertas; documentos comprometidos mantêm snapshot e mostram divergência.
- **Produção parcial menor que a demanda** → entra somente o realizado; saldo continua aberto.
- **Produção maior que a demanda** → excedente vira saldo livre da mesma variante/base.
- **Recebimento terceirizado com rejeição** → entrada/AP somente do aprovado; rejeitado pendente.
- **Nova napa para refazer defeito externo** → exige autorização; perda e desconto auditados.
- **Data de pagamento em feriado bancário** → próximo dia bancário útil.
- **Cancelamento de um PV consolidado** → remove/libera apenas sua contribuição, nunca as outras.
- **Base/cor inativada** → sem nova produção; estoque acabado existente ainda consumível.
- **Tentativa de excluir receita usada** → arquivar/versionar; FK histórica permanece.
- **Reprocessar conclusão/recebimento** → mesma chave idempotente retorna o resultado existente,
  sem nova baixa, entrada ou AP.
- **Repetir chave com payload diferente** → erro de conflito; nunca tratar como replay válido.
- **Consumo físico acima do disponível** → debitar o disponível e abrir reconciliação pendente,
  sem saldo negativo nem perda do apontamento.
- **Atualizar lote aberto** → movimentar somente diferenças confirmadas; insert/update não podem
  acionar dois motores de baixa.

## Constraints & assumptions

- Stack: React/Vite/TypeScript + Supabase/Postgres + React Query, seguindo os padrões do projeto.
- Autoridade operacional fica no banco/worker; lógica crítica não depende de estado React.
- Unidades canônicas: tira e napa linear em `m`; larguras em `mm`; custos em BRL por unidade
  declarada. `conversion_rate` não substitui largura de ficha nem rendimento de tira.
- Produção usa calendário fabril; fornecedor/preparo usam dias corridos. A data da semana de
  faturamento continua derivada do primeiro dia canônico já definido no PV.
- A demanda automática segue o modo robusto em background escolhido pelo usuário, com fila,
  locks, retry e observabilidade.
- O worker de tiras é dono do netting/acoplamento de estoque da tira e da napa. O construtor
  de OC recebe `purchase_product_id + falta pre_netted` e não desconta estoque uma segunda
  vez; MOQ/múltiplo continuam sendo aplicados somente após consolidação na OC.
- Não há percentual de perda. Sobra física de largura pode ser exibida informativamente, sem
  multiplicador escondido.
- Precisão: cálculo/agregação sem arredondamento intermediário; persistência com pelo menos 6
  casas; UI geralmente com 2 casas e acesso ao valor detalhado.
- Identidade usa IDs e constraints; normalização de texto serve apenas para busca/sugestão.
- UI em pt-BR, responsiva a 360 px, usando tokens e componentes canônicos; ícones Phosphor e
  `sonner` conforme o guia do projeto.
- Rotas novas usam `ProtectedRoute` + `RouteGuard`; permissões são reforçadas por RLS/RPC.
- Migrations ficam em `supabase/migrations/`; tipos Supabase são regenerados, nunca editados à
  mão.
- Testes obrigatórios incluem unitários, integração com banco, concorrência/idempotência,
  paridade TS×SQL, migração e regressão dos fluxos antigos.
- O build deve usar Bun e passar `bunx tsc -p tsconfig.app.json --noEmit`, `bun run test`,
  `bun run check:tokens` e build de produção.
- O custo de transformação igual entre fábrica e terceiro é uma decisão comercial deste
  escopo; o executor real continua registrado para análise.

## Open questions

Nenhuma decisão de produto permanece aberta para implementação desta especificação.

## Definition of Done

- [ ] **Reqs. 1–7 — hub/fonte única:** `/tiras-artesanais` existe no módulo `produtos`; abas,
      redirects, favoritos/grants e editor contextual funcionam no grupo próprio **Tiras**;
      nenhuma OS canônica de tira aparece nas listas, métricas ou relatórios genéricos de
      Terceirizados; PV, Estoque, Grupos e Compras abrem o mesmo editor. Um teste arquitetural prova que
      somente RPCs/tabelas canônicas gravam o domínio.
- [ ] **Reqs. 8–25 — identidade:** criar TIRA CHATA 8 mm em SOFT OFF WHITE e MADRID OFF WHITE
      resulta em duas variantes/produtos/saldos. Unique constraints impedem duplicatas e
      qualquer tentativa de cruzar bases falha.
- [ ] **Reqs. 12–15 — resolução por ID:** SOFT, MADRID e uma terceira base não hardcoded
      (ex.: GLOW METALIC) resolvem exclusivamente por `strap_variant_id`; instrumentação/
      testes provam que nenhuma chamada operacional usa `group_id + color` ou `LIMIT 1`.
- [ ] **Reqs. 16–22 — cores:** “CURA OFF WHITE” e “CURA OF WHITE” aparecem como sugestão;
      antes da aprovação não resolvem juntas; depois da aprovação compartilham `color_id`,
      preservando produtos-base diferentes. Dois produtos na mesma base/cor bloqueiam.
- [ ] **Reqs. 18–23 — matriz:** uma napa ativa de saldo zero aparece no seletor; nova cor fica
      “Disponível para adicionar”; preview cria apenas medidas selecionadas e exige mínimo
      e origem de reposição do piso explícitos por variante.
- [ ] **Reqs. 26–40 — rendimento:** com base 1370 mm e banda 20 mm, teórico = 68 e sobra =
      10 mm; confirmado 64 salva, 70 é rejeitado. Para 640 m, consumo com confirmado 64 é
      exatamente 10 m antes da formatação. NAPA SOFT + Tira Meia Cana 10 mm com rendimento
      55 m/m devolve os mesmos 55 m/m para todas as cores da família, sem cadastro duplicado.
- [ ] **Reqs. 26–37 — aprovação/versionamento:** receita percorre
      `draft → pending_approval → approved`; nova versão supersede prospectivamente a anterior,
      sem reprecificar PV/lote/OS comprometido e sem perder FK histórica.
- [ ] **Reqs. 34–38 — sem fallback:** remover a receita MADRID bloqueia produção interna dessa
      combinação; nenhuma tela inventa rendimento SOFT/MADRID ou adiciona 15%.
- [ ] **Reqs. 39–40 — paridade/precisão:** testes TS×RPC cobrem valores pequenos e provam que
      três parcelas de 0,0049 m totalizam 0,0147 m, sem zerar por arredondamento por linha.
- [ ] **Reqs. 41–53 — PV:** `reference_base` copia cor principal + material estrutural do
      cabedal, é materializada atomicamente e nasce `internal`; `finished_product_group` usa
      cor própria e nasce `buy_ready`. Não há “Aplicar a todas” nem seletor manual de origem.
      Ficha sem base/medida e interna sem receita bloqueiam. A fila é persistida na mesma
      operação do PV, inclusive offline, e sobrevive ao fechamento da aba; o worker cumpre
      SLO operacional de até 60 s em staging, com retry/dead-letter visível e sem duplicar.
- [ ] **Reqs. 44–47 — napa correta:** num PV cuja ficha aponta MADRID OFF WHITE, consulta das
      reservas/movimentos mostra somente o `base_product_id` MADRID; não existe movimento SOFT.
- [ ] **Reqs. 48–51 — edição/cancelamento:** antes do compromisso, editar/cancelar um PV remove
      só sua contribuição; após produção, libera o acabado sem apagar baixa/custo; alterar
      identidade comprometida ou fazer override de origem histórica exige Administrador e
      motivo.
- [ ] **Reqs. 54–62 — netting:** saldo 100, mínimo 30 e demanda 90 gera 70 reservados + 20 de
      reposição. Dois PVs simultâneos não compartilham os mesmos metros; prioridade segue data
      e depois confirmação. Reprocessar depois de criar a reserva/lote mantém 20 m — não cria
      70/90 adicionais — e mesma chave com payload diferente falha.
- [ ] **Reqs. 23, 56–59 e 73 — origem do piso:** com saldo 0, mínimo 30, uma linha
      `reference_base/internal` de 40 e uma linha `finished_product_group/buy_ready` de 40, os
      80 m seguem as origens derivadas e os 30 m adicionais seguem somente
      `min_stock_replenishment_mode`. Alternar a ordem de processamento produz o mesmo
      resultado; a contribuição aparece como `stock_floor`, sem número de PV, e retry não a
      duplica. Com PVs em quinzenas diferentes, o piso usa o bucket do PV com menor data e muda
      de OC somente enquanto não comprometido. Origem padrão inválida suspende apenas o piso,
      sem trocar silenciosamente.
- [ ] **Reqs. 56, 73, 77–78 e 103–107 — piso integrado à OC:** contribuição de piso aparece
      em `purchase_demand_contributions` com `source_type='strap_stock_floor'`, FK do piso e
      campos de PV nulos. No modo interno, 30 m de tira com rendimento 60 geram 0,5 m de napa
      antes de aplicar MOQ/múltiplo do produto-base; no modo `buy_ready`, compra 30 m do produto
      acabado. Nenhum dos caminhos converte tira em napa 1:1 nem refaz o netting.
- [ ] **Reqs. 54–62 e 76–77 — duas camadas:** uma linha `reference_base/internal` compra falta
      do `base_product_id`; uma linha `finished_product_group/buy_ready` compra falta do
      `finished_product_id`; o construtor da OC não refaz o netting `pre_netted`. Duas medidas
      disputando a mesma napa são serializadas sem sobrealocação.
- [ ] **Reqs. 58–60 — histórico híbrido:** snapshots históricos da mesma variante, um interno
      e outro comprado pronto, conservam seu `source_mode`, saldo físico e reposições sem
      migração implícita nem `procurement_type` sobrescrevendo fatos. Novas intenções provam a
      derivação por `identity_basis`.
- [ ] **Reqs. 60 e 108–113 — custos:** estoque interno/comprado compartilha saldo e WAC com
      origem nos movimentos; PV de 100 m com 60 m em estoque congela os 100 m pelo custo da
      origem derivada/congelada e mostra variação contra o realizado sem recalcular margem.
      Com napa R$ 20/m, rendimento 60 e transformação R$ 0,50/m, o custo previsto é
      R$ 0,833333/m e 100 m custam R$ 83,3333 antes da apresentação.
- [ ] **Reqs. 63–73 — planejamento:** lote cai na semana fabril anterior; feriado/sábado
      produtivo alteram a data corretamente; dois PVs compatíveis formam um lote com uma linha
      consolidada e subtotais por PV. Testes cobrem capacidade em m/dia, sobrecarga,
      `schedule_revision`, semana totalmente fechada e criticidades distintas Normal,
      Atrasada e Urgente. Dois workers planejando variantes distintas para o mesmo executor/dia
      — inclusive em revisões diferentes — não excedem a capacidade; só existe um bucket ativo,
      cada alocação diária fica persistida e o excesso permanece em `unscheduled_m`.
- [ ] **Reqs. 68–69 — documento:** PDF do lote mostra variante/base/cor, rendimento, napa,
      prazo e número/metragem de cada PV imediatamente abaixo da linha consolidada; a parcela
      do piso aparece separadamente como “Reposição de estoque mínimo”.
- [ ] **Reqs. 74–85 — produção própria:** confirmação reserva a napa sem debitar; cada parcial
      debita somente consumo real, entra somente tira aprovada, mantém saldo e registra
      rendimento; o saldo acabado exato é usado antes de reservar base; repetir a chave não
      duplica movimentos.
- [ ] **Reqs. 76, 84–85 — integridade:** query de movimentos prova uma única baixa por parcial;
      criar/atualizar planejamento/OS gera zero movimento; somente a RPC de parcial move napa.
      `trg_debit_service_order_base` e a chamada manual de `waveTimelineService` deixaram de
      ser escritores.
- [ ] **Reqs. 77–78 — falta de napa:** origem interna com napa insuficiente cria contribuição
      da napa exata na automação geral de OC, sem trocar para tira pronta.
- [ ] **Reqs. 86–99 — terceiro:** demandas do mesmo prestador entram na OS aberta com linhas e
      PVs; envio trava; entrega 100/rejeição 15 entra e paga 85; os 15 ficam pendentes; nova
      napa exige autorização e desconto exige aprovação. Remessas adicionais são movimentos
      `sent`; ajuste assinado exige aprovação; a OS não conclui enquanto
      `balance_in_custody ≠ 0`. Claim de perda pendente não reduz o saldo nem permite fechar;
      somente sua aprovação posta o movimento `lost` vinculado.
- [ ] **Reqs. 95–98 — financeiro terceiro:** entradas parciais do mesmo prestador/ciclo geram
      competências únicas e, no fechamento, um título consolidado sem duplicidade; ciclos
      semanal e quinzenal respondem à data/timezone, ajustam dia bancário não útil e carregam
      crédito excedente sem título negativo.
- [ ] **Reqs. 100–107 — compra pronta:** gera OC da tira exata, não movimenta napa, consolida
      por fornecedor/quinzena, bloqueia preço inválido, recebe parcialmente e exibe PVs no PDF;
      seleção múltipla baixa ZIP com um PDF por OC. Duas parciais com NF/rejeição alocam apenas
      aceito; sobra de MOQ/pacote fica livre e conversão congelada fecha em metros. Com
      `purchase_enabled=true`, preço, unidade/conversão, MOQ, múltiplo e preparo inválidos
      bloqueiam ativação mesmo se `procurement_type` continuar artesanal.
- [ ] **Reqs. 114–121 — segurança/auditoria:** testes com perfis de Vendas, Produção,
      Engenharia e Administrador provam cada permissão tanto pela UI quanto por tentativa
      direta no banco; Vendas não altera a origem derivada, e Vendas/Produção/Consulta não
      aprovam receita; custo fica oculto sem gate financeiro; audit log contém antes/depois e
      IDs.
- [ ] **Reqs. 122–130 — migração:** dry-run classifica todos os registros; inequívocos migram;
      ambíguos ficam em revisão somente na variante. Checksums de `products.quantity`,
      reservas, inbounds e movimentos provam conservação; nenhuma OS perde receita/snapshot;
      PV aberto intocado não recebe backfill de origem, e somente uma alteração deliberada
      ainda reversível aplica a regra prospectiva.
- [ ] **Regressão — retirada de regras antigas:** testes comportamentais cobrem
      `strapRollCut`, `strapYield`, `cuttingOptimizer`, BOM, picking e RPC; provam ausência de
      15%, herança/escala de receita e agrupamento somente por nome/cor.
- [ ] **Paridade ponta a ponta:** consumo do PV, BOM, picking, plano semanal, compra, reserva,
      baixa e custeio devolvem a mesma variante, base, quantidade e receita para a mesma linha.
- [ ] **Cutover de escritores:** varredura de `pg_proc`, `pg_trigger`, `pg_views`, policies e
      frontend prova que editores/RPCs antigos não gravam; somente views históricas read-only
      permanecem.
- [ ] **Qualidade técnica:** constraints de unicidade/integridade ativas, RLS coberta, testes
      unitários e de integração (sem tratar skip como verde), typecheck, tokens e build passam;
      fluxos principais funcionam em viewport de 360 px.
