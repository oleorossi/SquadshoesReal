# Equipe & Capacidade — Fonte Única (RH → Custo → Produção Diária)

> Spec fechada em entrevista com o dono em 2026-07-19, motivada pela queixa
> "está parecendo que não tem setor de Costura cadastrado, sendo que eu tenho
> funcionários cadastrados no setor de Costura". Fundamentada em avaliação
> automatizada de 4 frentes com verificação adversarial (34 agentes, 28 achados
> confirmados sobre dados reais de `ssvxfoybzmjlypnipqzn`).
> Sucede e corrige pontos de [produtividade-por-modelo.md](produtividade-por-modelo.md).

## Goal

Fazer com que a **capacidade produtiva de cada setor** seja um dado único,
construído a partir das **pessoas reais** (cada funcionário com seu rendimento em
pares/dia, preenchido no RH e somado por setor), visível com a origem de cada
número — e que essa capacidade governe tanto o **custo de mão de obra por par**
(precificação) quanto o **Planejamento Diário** da fábrica.

## Background / Problem

Diagnóstico com números reais (2026-07-19):

1. **A fábrica inteira aparece zerada.** 45 dos 51 modelos ativos mostram
   `0 pares/dia` com a Costura apontada como gargalo, e 46 no total contando a
   Expedição. Causa: `sector_settings.headcount` é NULL em Costura e Expedição, e
   o motor converte ausência em capacidade 0 — como o gargalo é o menor valor,
   um único setor em branco apaga o número de todos os modelos que passam por ele
   e **mascara o gargalo verdadeiro** (Solagem, a 255 p/d).
2. **O mesmo fato está cadastrado em três lugares que não conversam:**
   `employees.department` (RH — onde estão as 2 costureiras),
   `sector_settings.team_size` (campo "Equipe" de Produção → Setores, marcado no
   próprio código como *"informativa — não entra no cálculo"*, NULL nos 10
   setores) e `sector_settings.headcount` (o único que a engine lê). O dono
   cadastra no RH e a engine continua achando o setor vazio.
3. **O guard que deveria avisar é inerte:** a categoria `headcount_drift` do
   `capacity_consistency_report()` exige `team_size` E `headcount` não-nulos, e
   `team_size` é NULL em 10/10 — nunca dispara.
4. **O cadastro do RH não sustenta derivação automática hoje:** só 7 de 18
   funcionários ativos casam com setor da engine; 7 estão com setor em branco, 2
   no genérico "Produção". Seis dos dez setores produtivos não têm ninguém. O
   campo Setor é `<Input>` de texto livre (`src/pages/Employees.tsx`), sem
   validação contra os setores canônicos — o buraco se repete a cada admissão.
5. **A tela não discrimina modelo.** Corrigido o headcount, as 51 fichas dão
   exatamente 255 p/d e índice 100, porque quase todas usam o mesmo tempo padrão
   da categoria — a tela chamada "Produtividade por Modelo" não responde "qual
   modelo rende mais", que é a pergunta que a originou.
6. **O número digitado não volta igual.** A eficiência é aplicada só na exibição:
   o dono digita 720 pares/dia, a tabela passa a mostrar 612, e ao reabrir o
   editor vê 720 — três números para a mesma coisa na mesma tela.
7. **Divergência de custo sem explicação:** operação de BOM cujo setor saiu do
   roteiro (`production_sectors`) soma no custeio do PV mas some da engine —
   DS22 mostra MO R$ 1,75/par na tela e R$ 2,05/par no custeio. O gap de
   R$ 0,2941 é exatamente Costura (0,1364) + Expedição (0,1577), as duas
   operações órfãs.
8. **A mão de obra está subestimada ~4,1× onde há medição real.** Em Montagem a
   folha é R$ 7.200/mês ÷ 22 dias = R$ 327,27/dia, e a produção real medida pela
   Chamada do Dia foi 7.116 pares em 13 dias = 547,4 pares/dia — custo real de
   **R$ 0,598/par** contra **R$ 0,145/par** do modelo atual. São três erros
   multiplicativos independentes, sendo o principal usar custo-hora de **uma**
   pessoa dividido pelos pares do **setor inteiro**. Corrigir isso vai
   aproximadamente **dobrar** `order_costs.labor_cost` e derrubar a margem dos
   PVs novos — precisa do comparativo antes/depois aplicado também a custo, não
   só a datas.
9. **A dispersão está na produtividade, não no salário.** Entre os 3 montadores
   medidos o rendimento varia **3×** (346,8 · 206,2 · 115,0 pares/dia) enquanto
   todos ganham exatamente o mesmo salário. O modelo por headcount implica 204
   pares por pessoa e apaga essa diferença.
10. **O Planejamento Diário lê uma terceira fonte de capacidade.** Ele usa
    `technical_sheets.*_capacity_per_day` (com fallback nos 600 fixos), e **não**
    o que a tela de Produtividade edita — hoje são trilhos paralelos. Trocar a
    capacidade move as datas da fábrica inteira, com variação de **-58%**
    (Solagem) a **+104%** (Colagem) por setor.

## Scope

### In scope
- **Painel de Equipe compartilhado**: um componente único, idêntico, usado em
  Produção → Setores e em Produtividade por Modelo, gravando no mesmo campo.
- Derivação **automática e viva** da equipe a partir dos funcionários ativos do
  RH, com **ajuste manual** por setor e **origem visível** (RH / manual).
- Campo **Setor do funcionário** vira lista fixa dos setores canônicos, com
  possibilidade de **criar setor novo** (com pergunta se é de produção).
- Tratar **equipe não informada como "não dimensionado"** (≠ zero): setor sem
  cadastro sai do cálculo de gargalo em vez de zerar o modelo.
- **Unificação da capacidade**: o número calculado passa a ser a fonte do
  Planejamento Diário, substituindo os 600 pares/dia fixos de
  `sector_settings.daily_capacity_pairs`.
- Correção do **round-trip de pares/dia** (bruto × líquido) e da **operação órfã**
  que faz MO da engine divergir do custeio.
- Eliminação do campo duplicado `team_size`.

### Out of scope (explicitamente não agora)
- Descontar férias, afastamentos e atestados da capacidade (decisão do dono:
  quadro nominal vale sempre).
- Contar montadores em regime por par e terceirizados na equipe automática (eles
  entram, quando necessário, pelo ajuste manual).
- Fracionar um funcionário entre dois setores pelo cadastro do RH (o RH continua
  com um setor por pessoa; divisão se resolve no ajuste manual, que aceita 0,5).
- Cronoanálise dos tempos por setor (tela `/cronoanalise` já existe; sem tempos
  medidos a comparação entre modelos continua uniforme — ver Requisito 12).
- Redesenho da tela de Produtividade; só as correções listadas aqui.
- Resolver a semântica do setor Costura (ver Open questions).

## Requirements

1. **Componente único de Equipe.** Um só componente React (ex.:
   `components/production/SectorTeamPanel.tsx`) renderiza a lista de setores com
   o campo de pessoas, e é usado **sem variação visual ou de comportamento** em
   Produção → Setores e no botão Equipe da Produtividade. Ambos gravam em
   `sector_settings.headcount`. Não pode existir uma segunda tela com campo de
   equipe próprio.
2. **Equipe derivada do RH, viva.** A equipe de um setor é, por padrão, a
   **contagem de funcionários ativos cujo setor casa com aquele setor** (via
   `capacity_sector_key`, ignorando acento e caixa). Admissão, demissão ou troca
   de setor no RH refletem no número **sem nenhum clique**.
3. **Contam apenas funcionários ativos do setor.** Montadores em regime por par e
   terceirizados **não** entram na contagem automática; férias e afastamentos
   **não** reduzem a equipe.
4. **Ajuste manual sobrepõe o RH, por setor.** O usuário pode digitar um valor
   (aceita 0,5) que passa a valer no lugar da contagem do RH **apenas naquele
   setor**, ficando marcado como manual até ser limpo. Limpar o ajuste devolve o
   setor ao valor do RH.
5. **Setor sem ninguém no RH usa o ajuste manual.** Onde o RH não tem funcionário
   mapeado, vale o número manual já salvo (hoje: Corte Palmilha 1, Corte Forração
   1, Aviamento 2, Silk 1, Solagem 1, Colagem 3). A derivação **nunca** propõe ou
   grava 0 por ausência de funcionário — isso destruiria 6 setores que hoje têm
   número válido.
6. **Origem visível.** Cada linha do painel mostra de onde veio o número: `RH`
   (com a contagem), `manual` (com o valor digitado) ou `não informado`. Quando
   houver ajuste manual e o RH divergir, a linha mostra os dois ("RH: 3 · você
   usa 2") sem alterar nada sozinha.
7. **Equipe não informada ≠ zero.** Setor sem equipe (nem RH nem manual) é
   tratado como **não dimensionado**: fica **fora** do cálculo de gargalo, e o
   modelo é marcado como parcial, exibindo a capacidade dos setores conhecidos e
   um aviso nomeando o(s) setor(es) faltante(s). Zero só existe quando o usuário
   digita zero explicitamente (setor parado).
8. **Setor do funcionário vira lista.** O campo Setor em RH → Funcionários passa
   a ser uma seleção com os 10 setores de produção mais as áreas de apoio
   (Administrativo, Comercial, Terceirizado), com opção de **criar setor novo**.
   Os funcionários hoje fora do padrão (7 em branco, 2 em "Produção") aparecem
   numa lista de pendências para reclassificação, sem serem alterados
   automaticamente.
9. **Criar setor pergunta o tipo.** Ao criar um setor novo, o sistema pergunta se
   é **setor de produção**. Se sim, exige posição no fluxo (antes/depois de qual
   setor), se roda em paralelo com outros, e o custo-hora — e o setor passa a
   valer na engine, nas fichas técnicas e no fluxo. Se não, fica só no RH, para
   folha e ponto, sem qualquer efeito em capacidade.
10. **Capacidade como fonte única do Planejamento Diário.** A capacidade derivada
    (equipe × jornada ÷ minutos por par) passa a alimentar o motor de produção
    diária, substituindo o `daily_capacity_pairs` fixo de 600. A migração deve
    ser verificável: antes de trocar, mostrar lado a lado a capacidade atual e a
    nova por setor, para o dono conferir o impacto nas datas.
11. **Round-trip de pares/dia consistente.** O que o usuário digita, vê e reabre
    é o **mesmo número**. A capacidade passa a ser tratada como valor único por
    modelo × setor; se a eficiência continuar existindo como fator, ela deve
    aparecer explicitamente como uma linha separada ("capacidade informada 720 →
    considerando 85% de eficiência: 612"), nunca como diferença silenciosa entre
    o campo e a tabela.
12. **A comparação entre modelos precisa discriminar.** Enquanto um modelo usar
    apenas tempos padrão da categoria, a tela deve dizer isso explicitamente no
    card ("tempos padrão — capacidade ainda não medida neste modelo") em vez de
    exibir índice 100 como se fosse resultado medido. Um modelo só entra no
    ranking comparativo com pelo menos um setor com capacidade informada.
13. **Operação órfã não pode divergir do custeio.** Operação de BOM ativa cujo
    setor não está em `production_sectors` deve (a) aparecer no
    `capacity_consistency_report()` e (b) ser somada na MO da engine **ou**
    desativada — o invariante "MO da engine = MO do custeio" tem que valer. Caso
    concreto a resolver: DS22 (R$ 1,75 na engine × R$ 2,05 no custeio).
14. **Guard de drift funcional.** A categoria `headcount_drift` deve comparar o
    número em uso com a contagem do RH (e não com `team_size`, que será
    eliminado), disparando quando divergirem.
15. **Eliminar o campo duplicado.** `sector_settings.team_size` sai da interface;
    a coluna só permanece no banco se alguma leitura legítima ainda existir, e
    nesse caso passa a ser espelho de `headcount`, nunca origem.
16. **Avisos completos e acionáveis.** O corte em 8 avisos deixa de esconder o
    aviso que zerou o cálculo: avisos que impedem o número (setor não
    dimensionado) aparecem sempre e no topo, com link direto para a ação que
    resolve — não para outra tela genérica.
17. **Preenchimento facilitado.** O painel de Equipe abre com foco no primeiro
    setor pendente, destaca em vermelho as linhas não dimensionadas, permite
    percorrer os campos pelo teclado, e mostra na própria linha quantos
    funcionários o RH tem para aquele setor com um clique para adotar o número.
18. **Mobile.** O painel funciona em 360px (o dono usa no chão de fábrica): alvos
    de toque de no mínimo 44px, contraste adequado e sem rolagem horizontal.

### Produtividade individual (2ª rodada da entrevista)

> **Achado que muda o desenho:** a produtividade individual em pares/dia **já
> existe e já é digitada** — é a **Chamada do Dia** (`ficha_montadores`, tela
> `src/pages/FichaMontadoresPage.tsx`): 33 lançamentos reais de 15 a 29/06/2026,
> 3 montadores, médias de **346,8 · 206,2 · 115,0 pares/dia**. A tabela já é
> genérica por setor (`ficha_montadores.setor`) e a tela já tem o array `SETORES`
> preparado para ganhar setor novo em uma linha. **Criar um campo "pares/dia" em
> `employees` seria a quarta fonte do mesmo fato** — exatamente o erro que este
> spec existe para corrigir.

19. **Rendimento por funcionário vem da Chamada do Dia, estendida aos 10
    setores.** Não se cria campo novo em `employees`: a Chamada é promovida a
    registro de produtividade de toda a fábrica (hoje só `montagem` tem
    lançamento). A produtividade de uma pessoa num setor é a **média dos
    lançamentos dela** naquele setor, numa janela recente configurável (padrão:
    últimos 30 dias com lançamento). Onde não houver Chamada, o número pode ser
    digitado direto como valor de referência da pessoa.
20. **Capacidade do setor = soma das pessoas.** A capacidade base de um setor é a
    **soma** da produtividade dos funcionários ativos daquele setor (A + B = 330
    pares/dia), substituindo o cálculo abstrato por `equipe × jornada ÷ minutos`.
21. **Precedência: a ficha técnica manda.** Quando a referência tiver capacidade
    lançada para aquele setor (o valor que o dono informa em Produtividade por
    Modelo), **é ela que vale** como total do setor para aquele modelo. A soma das
    pessoas é a base usada apenas quando a ficha não tem valor.
22. **Distribuição proporcional ao rendimento.** Em ambos os casos, a produção do
    setor se reparte entre as pessoas **na proporção do rendimento individual**.
    Com A=150 e B=180 (45,45% e 54,55%), um modelo cuja ficha diz 240 pares/dia
    resulta em 109 pares para A e 131 para B. Essa distribuição é exibida e serve
    de base para metas e conferência — arredondamento não pode criar ou perder
    pares (a diferença de arredondamento vai para o maior rendimento).
23. **Funcionário sem medição entra pela média dos colegas.** Quem ainda não tem
    produtividade preenchida entra na soma com a **média dos funcionários medidos
    do mesmo setor**, marcado na tela como estimativa. Se **ninguém** do setor
    tiver número, o setor fica **não dimensionado** (Requisito 7) — nunca zero.
24. **Coerência com o custo — fórmula exata.** `min-pessoa/par = Σ(jornadas das
    pessoas medidas) ÷ Σ(pares dessas mesmas pessoas)`. Com A e B (2 × 540 min) e
    330 pares, dá **3,2727** min/par. **Não** usar a média aritmética dos min/par
    individuais (3,60 e 3,00 → 3,30): erra sempre para mais, e o erro cresce com a
    dispersão entre as pessoas. O `N` do numerador tem que ser **o mesmo conjunto
    de pessoas** que gerou os pares do denominador — misturar roster do RH com
    headcount manual produz erro de 3× (caso real: Colagem tem 1 pessoa no RH e
    headcount manual 3).
25. **Não duplicar cadastro de equipe.** Com o rendimento individual, a contagem
    de pessoas do setor passa a ser **derivada** da lista de funcionários — o
    campo de equipe do painel (Requisitos 1–6) deixa de ser digitado como número
    solto e passa a mostrar a composição ("2 pessoas · 330 pares/dia"), com
    ajuste manual apenas como exceção (terceirizado, reforço temporário).
26. **Cobertura tem que ser total para o número valer.** A soma só é válida com
    **100% dos ativos do setor medidos**. Com cobertura parcial (2 de 3
    costureiros), a tela exibe `parcial: 2 de 3 medidos` e extrapola pela média
    (Requisito 23) — nunca soma só os medidos. Motivo: 330 quando o real é 500 é
    um número **plausível e silencioso**, que vira gargalo falso e estrangula o
    planejamento sem nenhum alarme — pior que o zero que causou o problema atual.
27. **Pessoa em dois setores.** O registro de produtividade carrega uma **fração
    de alocação por setor**, com validação de que a soma das frações de um mesmo
    funcionário não passa de 1,0. A produtividade se declara como "pares/dia se
    dedicado integralmente", e a contribuição para o setor é `pares × fração`, com
    a jornada entrando também proporcional. Sem isso, quem atua em dois setores
    tem os mesmos 540 minutos contados duas vezes (caso real: uma funcionária com
    cargo "Faz tudo").
28. **Eficiência não pode ser aplicada duas vezes.** Produtividade observada já
    embute a ineficiência real. Setor cuja capacidade vem de medição **não** sofre
    o desconto de `efficiency_pct` (hoje 85%), senão 330 lançados viram 280
    exibidos. A eficiência permanece apenas como multiplicador de cenário sobre
    capacidade teórica.
29. **Custo-hora do setor passa a derivar do RH junto com a capacidade.** Se o
    roster do RH define a capacidade, tem que definir também a taxa:
    `hourly_rate(setor) = média dos salários das pessoas do setor ÷ 220`. Caso
    contrário o denominador vem do RH e o numerador de um cadastro manual
    desatualizado, e o custo erra sem sinal. Observação registrada: **hoje isso
    não muda nenhum valor** — a dispersão salarial dentro de cada setor é zero
    (Costura 2 × R$ 2.400, Montagem 3 × R$ 2.400, Colagem R$ 1.850, Acabamento
    R$ 1.850) — mas passa a importar assim que houver salários diferentes.
30. **Escala vem do RH; forma vem do BOM.** A soma das produtividades dá **um**
    número por setor. Escrevê-lo direto no BOM de todas as fichas apagaria a
    diferença entre modelos (é o sintoma já registrado: os 8 custos mais recentes
    têm MO idêntica de R$ 2,0471/par). Regra: a produtividade define a **escala**
    do setor; a diferença entre modelos continua vindo da razão entre os tempos
    das fichas (Requisito 21 — a ficha manda quando tem valor). Uma célula
    modelo × setor tem **uma só escritora**.

## Data model / Domain

```
employees (ativo, department → vira lista canônica)
        │  contagem por setor (viva)
        ▼
sector_settings.headcount ◄── ajuste manual (0,5 aceito; sobrepõe por setor)
        │        ▲
        │        └── painel único SectorTeamPanel (2 telas, mesmo campo)
        ├──────────────────────► get_model_productivity  → custo/par, gargalo
        └──────────────────────► motor de produção diária → datas, kanban
                                  (substitui daily_capacity_pairs = 600)
```

- **Origem do número por setor** precisa ser um estado explícito, não inferido:
  `rh` (derivado), `manual` (override), `nao_informado`. Sugerido: manter
  `headcount` como o valor efetivo e adicionar o override explícito
  (ex.: `headcount_override numeric NULL`), com o valor do RH calculado na
  leitura — assim uma admissão reflete sem escrita.
- **Setores canônicos**: os 10 de `sector_settings` (Corte Palmilha, Corte
  Forração, Aviamento, Costura, Silk, Colagem, Montagem, Solagem, Acabamento,
  Expedição), com `flow_order` e `parallel_group` já existentes. Criar setor de
  produção implica inserir linha aqui — hoje a tabela é fechada para INSERT por
  decisão anterior; a política precisa ser revista para atender o Requisito 9.
- **Áreas de apoio** (Administrativo, Comercial, Terceirizado e as que o dono
  criar como "não é produção") vivem só no domínio de RH e nunca entram em
  `sector_settings`.
- **Casamento RH → setor** usa `capacity_sector_key` (mesma normalização do resto
  do sistema: acento, caixa, e o par histórico Aviamento/mesa).

## User flows

### Happy path
1. O dono abre Produtividade por Modelo e vê que a Costura está marcada como
   **não dimensionada**, com aviso no topo — os demais modelos continuam
   mostrando capacidade dos setores conhecidos, sem zerar.
2. Clica em **Equipe**. O painel abre no primeiro setor pendente, com a linha da
   Costura destacada e a informação "RH: 2 pessoas" ao lado.
3. Clica em adotar o número do RH (ou digita outro). Salva.
4. A capacidade, o gargalo e o custo por par recalculam na hora; o Planejamento
   Diário passa a usar a mesma capacidade.
5. Quando contratar a terceira costureira no RH, o número sobe sozinho — sem
   passar pela tela de Produtividade.

### Alternate / edge flows
- Dono abre o mesmo painel por Produção → Setores: mesma tela, mesmo resultado.
- Setor sem ninguém no RH (Silk, Solagem…): a linha mostra "manual: 1" e o RH não
  interfere.
- Funcionário cadastrado sem setor: aparece na lista de pendências do RH; não
  entra em nenhuma contagem até ser classificado.
- Dono cria o setor "Manutenção" e responde que **não** é de produção: o setor
  passa a existir para folha e ponto, e não aparece no painel de capacidade.

## Edge cases & failure modes

- Equipe não informada → setor fora do gargalo + modelo parcial com aviso
  nomeando o setor (**nunca** 0 pares/dia).
- RH com 0 funcionários num setor que tem ajuste manual → vale o manual, sem
  aviso de erro (é o estado normal hoje em 6 setores).
- Ajuste manual igual à contagem do RH → mostrar como "RH" (não poluir com
  override redundante).
- Funcionário desativado no RH → contagem cai automaticamente; se isso zerar o
  setor e não houver manual, o setor vira "não dimensionado" com aviso, e não 0.
- Setor com nome novo criado no RH mas marcado como não-produção → nunca aparece
  no painel de capacidade nem no fluxo.
- Dois usuários editando equipe ao mesmo tempo → última escrita vence (fábrica
  com um operador; não justifica bloqueio).
- Troca da capacidade do Planejamento Diário → mudança de datas em OPs já
  planejadas; exige a comparação lado a lado do Requisito 10 antes de aplicar.

## Constraints & assumptions

- Stack e convenções do repo: Bun, typecheck `bunx tsc -p tsconfig.app.json
  --noEmit`, design tokens (`check:tokens`), ícones Phosphor, `sonner`, React
  Query, domínio em pt-BR, migrations com timestamp de 14 dígitos.
- Não tocar: motor de consumo de materiais, custeio de material, débito de
  estoque, fichas de operador.
- Mexer com cuidado (tem teste e histórico): `compute_wave_timeline`,
  `production_schedule`/recompute e `calculate_order_cost_item` — o Requisito 10
  altera a fonte de capacidade que esses motores usam.
- Jornada canônica: 540 min (9h), a mesma da folha; divisor de custo-hora 220.
- Assumido (dono deferiu): funcionário que divide o dia entre setores se resolve
  pelo ajuste manual com 0,5, sem cadastro de setor secundário no RH.
- Assumido: "ativo" é o funcionário não desligado, independentemente de estar em
  férias ou afastado.

## Ordem de implantação (as etapas 0 e 1 são pré-requisitos quebrados hoje)

**Etapa 0 — destravar, antes de qualquer código novo.** (a) Fechar o Requisito 13:
enquanto DS22 divergir R$ 0,2941/par entre engine e custeio, não há como provar
que a mudança preserva o invariante. (b) Trocar "equipe vazia = 0 pares" por "não
dimensionado" (Requisito 7) — sozinho isso devolve o uso da tela hoje. (c) Dados:
reclassificar os 9 funcionários sem setor canônico, preencher `termination_date`
(hoje o desligamento é um booleano sem data) e responder a pergunta da Costura.

**Etapa 1 — medição.** Estender a Chamada do Dia aos 10 setores (aditivo, sem
migration de schema) e criar a leitura agregada por pessoa/setor com fração de
alocação. Sem lançamento diário nos outros 9 setores, nada disso produz número —
e o histórico mostra que a **disciplina de preenchimento é o gargalo real**: a
Montagem parou de lançar em 29/06, três semanas atrás.

**Etapa 2 — ligar no motor.** Capacidade do setor = soma medida; custo-hora
derivado do RH; precedência da ficha; e só então a unificação com o Planejamento
Diário (Requisito 10), com o comparativo antes/depois de datas **e** de custo.

## Open questions

- **O "150 pares" de uma pessoa foi medido produzindo qual modelo?** Você definiu
  que é a média da pessoa, sem amarrar a modelo, e que a ficha manda quando tiver
  valor — o que resolve o uso prático. Fica o registro do risco: sem saber o mix
  em que a média foi observada, a escala do setor herda o mix daquele período em
  silêncio. Mitigação sugerida (barata): a Chamada passa a registrar,
  opcionalmente, a referência produzida no dia — os campos `referencia`/
  `reference_id` **já existem na tabela** e estão sempre nulos.
- **Ativar pagamento por par muda o significado do número.** Hoje a Chamada é
  medição pura (nenhum funcionário no regime `producao`, todos os valores por par
  zerados), então os pares lançados não têm viés. Quando o pagamento por par
  entrar, o mesmo lançamento passa a valer dinheiro — decidir se a medição de
  capacidade continua na mesma linha ou ganha trilha própria.
- **O que é o setor "Costura" no seu chão de fábrica: costura do cabedal ou da
  palmilha?** Hoje um trigger remove a Costura do roteiro quando a palmilha é
  pronta (`insole_ready_made`), tratando-a como etapa da palmilha — e por isso 5
  fichas (ST 10, CF 03, CF 05, CF 07, CF 09) estão sem Costura. Se for costura de
  cabedal, essas fichas estão com roteiro e custo de mão de obra a menos, e o
  trigger precisa ser corrigido. Esta é a única pendência que bloqueia parte do
  Requisito 13.
- Qual a equipe real da Expedição (o RH não tem ninguém lá e não há valor manual).

## Definition of Done

- [ ] R1 — O mesmo painel de Equipe aparece em Produção → Setores e em
      Produtividade por Modelo; alterar numa tela reflete na outra sem reload, e
      não existe nenhum outro campo de equipe no sistema (busca no código).
- [ ] R2/R3 — Cadastrar um funcionário ativo em Costura no RH faz a equipe da
      Costura subir sem nenhum clique na tela de capacidade; um funcionário em
      férias continua contando; um montador por par não conta.
- [ ] R4/R5/R6 — Digitar 2,5 na Montagem marca a linha como "manual"; limpar o
      campo devolve o valor do RH; Silk (sem ninguém no RH) mantém o valor manual
      e não é zerado.
- [ ] R7 — Com a Costura sem equipe, os modelos exibem a capacidade dos demais
      setores e um aviso "Costura não dimensionada", e **nenhum** modelo mostra 0
      pares/dia por esse motivo (hoje são 45).
- [ ] R8/R9 — O campo Setor do funcionário é uma lista; os 7 sem setor e os 2 em
      "Produção" aparecem como pendências; criar "Manutenção" como não-produção
      não faz o setor aparecer no painel de capacidade.
- [ ] R10 — O Planejamento Diário passa a usar a capacidade derivada; a tela de
      comparação mostra, por setor, a capacidade antiga (600) e a nova antes de
      aplicar.
- [ ] R11 — Digitar 720 pares/dia, salvar, reabrir o editor e a tabela mostram
      720 de forma consistente; se houver eficiência, ela aparece como linha
      explícita.
- [ ] R12 — Um modelo sem capacidade medida exibe "tempos padrão" e não recebe
      índice 100; dois modelos com capacidades diferentes no mesmo setor exibem
      índices e custos diferentes.
- [ ] R13 — A MO por par da engine bate com `order_costs.labor_cost ÷ qty` em
      DS22 e em mais dois PVs recentes; operações órfãs aparecem no report.
- [ ] R14 — Alterar a equipe de um setor no RH sem atualizar a engine dispara a
      categoria `headcount_drift` no relatório de Diagnóstico.
- [ ] R16/R17/R18 — O aviso do setor não dimensionado aparece no topo com link de
      ação; o painel abre no primeiro pendente; funciona em 360px com alvos de
      44px; `check:tokens` limpo.
- [ ] R19/R20 — Preencher 150 no costureiro A e 180 no B pelo RH faz a Costura
      exibir 330 pares/dia sem nenhum outro cadastro.
- [ ] R21 — Com a ficha do modelo X informando 240 pares/dia na Costura, o cálculo
      daquele modelo usa 240 (e não 330); um modelo sem valor na ficha usa 330.
- [ ] R22 — A distribuição mostra 109 para A e 131 para B (soma exata de 240, sem
      par perdido no arredondamento).
- [ ] R23 — Um terceiro costureiro sem medição entra pela média (165) marcado como
      estimativa; se apagar os três números, a Costura vira "não dimensionada" e
      nenhum modelo mostra 0 pares/dia.
- [ ] R24 — `min-pessoa/par` da Costura resulta **3,2727** com 2 pessoas e 330
      pares/dia (e não 3,30 da média aritmética), e a MO por par da engine
      continua batendo com `order_costs.labor_cost ÷ qty`.
- [ ] R26 — Com 2 de 3 costureiros medidos, a tela mostra "parcial: 2 de 3
      medidos" e extrapola pela média; **não** exibe a soma dos dois como se
      fosse a capacidade do setor.
- [ ] R27 — Uma pessoa alocada 50% em Colagem e 50% em Acabamento contribui com
      metade dos pares e metade da jornada em cada, e o sistema recusa alocação
      somando mais de 100%.
- [ ] R28 — Um setor com capacidade medida de 330 pares/dia exibe 330, não 280
      (sem desconto de eficiência sobre número observado).
- [ ] R30 — Depois de ligar a produtividade, dois modelos com tempos diferentes na
      mesma Costura continuam com custos diferentes (a escala do setor não
      achatou a diferença entre modelos).
- [ ] Typecheck, `bun run test` e build de produção verdes.
