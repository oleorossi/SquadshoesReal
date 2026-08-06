# Análise do motor de produção e do kanban

## Veredito em uma linha

O motor **agenda certo** e o quadro **não está travado** — mas ele mente em três lugares que mudam decisão de turno: dois números de tela estão inflados ~8x, seis OPs aparecem com pares "entregues" que nunca foram produzidos, e 240 pares de pedido cancelado/faturado estão ocupando o topo da fila.

---

## O que está funcionando

Não é elogio genérico — foi medido:

- **O agendador em si está correto.** A ordem dos setores respeita a precedência do roteiro, conta só dia útil (feriado incluído), e cobre o horizonte inteiro sem truncar pares. Três checagens cruzadas entre a agenda e o registro de etapas voltaram com zero divergência.
- **O motor não está defasado nem travado.** O último recálculo rodou hoje, **06/08 às 00:05**, automaticamente, sem ninguém abrir tela. Todas as 54 OPs da fila têm agenda futura.
- **A gravação de um apontamento é sólida.** Trava a linha durante a escrita, grava tudo numa transação só, e tem limite que impede apontar mais do que o total da OP — medido: **0 violações em 2.578 etapas**.
- **A higiene do quadro está limpa.** Zero etapa duplicada, zero setor órfão, zero OP na fila sem roteiro, zero OP com tudo concluído ainda aparecendo como viva.
- **Correção a uma suspeita anterior:** as 27 OPs "fora da fila" não são um bug de prazo — são OPs apagadas (soft-delete), e a exclusão está certa. **Nenhuma OP viva está fora da fila.**
- **Uma anotação do manual do projeto envelheceu:** ele diz que "Aviamento vem antes de Costura". No banco hoje é Costura Palmilha (30) → Costura Cabedal (40) → Aviamento (50), e a ordem que o quadro usa bate exatamente com a ordem configurada. A ordem está certa; o texto é que está velho.

---

## O que está quebrado

### 1. "Restam N pares" está inflado ~8x nas telas de estouro e planejamento — P1

**O que acontece:** o número "restante" soma o saldo de **todas as etapas abertas** da OP. Como o mesmo par atravessa 9 a 11 setores, ele é contado uma vez por setor. O rótulo na tela diz "pares", mas o valor é *carga de trabalho*, não pares físicos.

**Quanto custa:** a fila inteira tem **9.380 pares reais**, e as telas somam **75.332** — fator **8,03x**. Não é caso isolado: **50 das 54 OPs** aparecem na tela de estouro com esse número inflado.

**Evidência:**

| OP | Pares reais | "Restam" na tela | Fator | Etapas abertas |
|---|---|---|---|---|
| OP-2026-01245 | 1.728 | 15.552 | 9,00x | 9 |
| OP-2026-01247 | 1.728 | 15.552 | 9,00x | 9 |
| OP-2026-01193 | 288 | 2.880 | 10,00x | 10 |
| OP-00804 | 12 | 120 | 10,00x | 10 |

O fator é *exatamente* o número de etapas abertas.

Em Planejamento as duas colunas ficam **lado a lado na mesma linha**: `1728` e `15552`. A tela se contradiz sozinha.

Em Estouro, a frase "restam 15552 pares" fica **ao lado do botão "Gerar OS de terceirização"**. Quem dimensiona lote de terceirização, compra de material ou turno extra por esse número erra por 8x.

> Detalhe importante: o número **não** entra automaticamente na OS de terceirização (o botão só passa o PV). O risco é o humano lendo a tela e decidindo.

> O valor certo para "restam" é **9.380** — que bate com o total da fila, coerente com produção praticamente parada (48 apontamentos históricos, nenhum desde 30/07).

---

### 2. Setor pulado é lido como entrega COMPLETA — o quadro mostra 288 pares prontos onde existem 180 — P1

**O que acontece:** quando alguém pula setores no quadro, esses setores são fechados com **0 pares produzidos**. O card do quadro trata "fechado" como "entregou tudo" e mostra o total da OP como se tivesse sido produzido. Pior: nem fica âmbar de parcial — aparece verde, completo, pronto pro próximo setor.

**Quanto custa:** **41 etapas em 6 OPs vivas**. Duas delas mentem sobre a quantidade:

| OP | O quadro diz | Foi produzido de verdade | Diferença |
|---|---|---|---|
| OP-2026-01191 | 288 de 288, no Acabamento | 180 pares cortados | **108 pares que não existem** |
| OP-2026-01195 | 432 de 432, no Acabamento | 408 pares cortados | **24 pares que não existem** |

Rota real da OP-2026-01191: Corte Palmilha 180/288 em andamento; Corte Forração, Aviamento, Silk, Colagem, Montagem e Solagem **todos fechados com 0/288**; Acabamento 0/288.

O registro de apontamento confirma a origem — 18:11:45 Corte Palmilha +180 com nota "*Via Kanban, pulando: Corte Forração, Aviamento, Silk, Colagem, Montagem, Solagem*", seguido de seis linhas de quantidade **zero**.

**Quem programa o turno vê 288 pares prontos pra acabar, aloca gente no Acabamento e não encontra a mercadoria.** 108 pares nunca foram cortados, costurados, colados, montados nem solados.

> A própria tela promete o contrário: antes de gravar, o diálogo escreve "*Chega em Acabamento marcada como PARCIAL*". A tela promete âmbar e o quadro entrega verde.

---

### 3. Pulo com quantidade parcial deixa a OP em dois lugares ao mesmo tempo — P1

**O que acontece:** quando a origem é apontada **parcialmente**, o sistema fecha os setores intermediários mesmo assim. A OP fica com **dois setores em andamento** — e as telas discordam de onde ela está.

**Quanto custa:** 2 OPs hoje, com instruções contraditórias:

| OP | Telas de setor mandam pra | Kanban mostra em | Saldo abandonado na origem |
|---|---|---|---|
| OP-2026-01191 | Corte Palmilha | Acabamento | 108 pares |
| OP-2026-01195 | Corte Palmilha | Acabamento | 24 pares |

O setor de origem, ainda aberto com saldo, **não aparece como pendência em lugar nenhum do quadro**.

O caminho de lote tem o mesmo defeito: 28/07 08:10:38, Corte Palmilha +408 de 432, "*pulando: Corte Forração, Costura Palmilha, Aviamento, Silk, Colagem, Montagem, Solagem*" — sete setores fechados a zero, com a origem ainda aberta.

Há um risco técnico junto: cada setor pulado é uma gravação separada. Se falhar no meio, metade fica fechada e não tem volta automática.

> Ressalva honesta: o alcance é menor do que parece. Quem lê o "setor atual da OP" são 6 arquivos, e a listagem principal de Ordens não está entre eles. A divergência de estado é real e grave; o número de telas afetadas é menor.

---

### 4. O aviso que impediria apontar 36 pares montados sem nada colado foi desarmado pelo pulo — P2

**O que acontece:** existem duas travas que avisariam "esse setor está apontando mais do que o anterior entregou". As duas usam "setor fechado" como atalho para "entregou tudo". Depois de um pulo, o setor anterior está fechado com 0 pares — então as duas concluem que ele entregou tudo e **nenhuma dispara**. O pulo desarma a proteção do resto da rota daquela OP.

**Evidência — OP-2026-01221:**

- 28/07 11:24:09 — Corte Palmilha +36, sem aviso
- 28/07 11:24:11–14 — Corte Forração, Costura Palmilha, Aviamento, Silk, Colagem: todos 0 pares
- **30/07 15:58:56 — Montagem +36, NENHUM AVISO LEVANTADO**
- 30/07 15:58:58 — Solagem 0 pares, com avisos

O +36 na Montagem passou limpo, com Colagem, Silk, Aviamento e Costura Palmilha todos "fechados" com zero produzido.

> É aviso, não bloqueio (o usuário confirma e segue). E é a **mesma raiz** do item 2 — consertar lá desarma isso também.

---

### 5. Badge "96 rolados" numa OP de 24 pares — P2

**O que acontece:** o badge âmbar que deveria dizer "essa OP tem saldo atrasado rolando de dias anteriores" soma o rolado de **todos os setores**, contando o mesmo par várias vezes.

**Quanto custa:** 33 OPs com badge, somando 2.873 "rolados" numa fila de 9.380 pares.

| OP | Pares | "Rolados" | Vezes a OP |
|---|---|---|---|
| OP-2026-00786 | 24 | 96 | **4,00x** |
| OP-2026-00784 | 24 | 96 | 4,00x |
| OP-2026-00969 | 180 | 360 | 2,00x |
| OP-2026-01195 | 432 | 432 | 1,00x |

Decomposição da OP-2026-00786 (24 pares): Aviamento 24 + Corte Forração 24 + Corte Palmilha 24 + Costura Palmilha 24 = 96.

"96 rolados numa OP de 24 pares" é impossível e **destrói a confiança no sinal**.

> Bom saber: por setor, o número está **correto e limitado** ao tamanho da OP (medi: 0 violações, razão máxima 1,00). O erro está só na soma entre setores. Correção de uma linha.

> A pintura vermelha da semana passada na grade **não é bug**: significa "estava planejado e não foi feito", o que é verdade — zero apontamentos desde 30/07.

---

### 6. Um PV Cancelado e um PV já Faturado ocupam o topo da fila e consomem capacidade até 17/08 — P2

**O que acontece:** cancelar ou faturar um pedido não tira as OPs da fila do motor em todos os casos. Como a fila ordena por prazo mais antigo, esses pedidos vencidos há meses sobem para o topo.

**Quanto custa: 240 pares mortos ocupando as posições 1–11 e 18–26.**

| PV | Cliente | Status do PV | OPs | Pares | Posições | Atraso | Agenda futura consumida |
|---|---|---|---|---|---|---|---|
| PV-2026-00089 | ALCINEU DE MADUREIRA CALÇADOS | **Faturado** | 11 | 132 | 1–11 | 150 dias | 1.320 pares-setor, até 17/08, 10 setores |
| PV-2026-00094 | J. MILER COMÉRCIO DE CALÇADOS | **Cancelado** | 9 | 108 | 18–26 | 91–94 dias | 1.152 pares-setor, até 17/08, 11 setores |

Todas com **zero produção apontada**, paradas desde março/maio.

Dos 824 pares vencidos na fila, **240 (29%) são desses dois pedidos mortos**. Se alguém apontar produção neles, a fábrica corta material e paga mão de obra para 240 pares que ninguém vai comprar. E enquanto estão lá, empurram PV-00150, PV-00147 e PV-00151 para depois, inflando o atraso de todo mundo.

**Onde está o buraco, exatamente:** a cascata de **faturamento** funciona (44 PVs faturados, só 1 vazou — e por um motivo histórico: o PV-00089 foi alterado em massa, não por transição de status). A cascata de **cancelamento** não existe: 1 PV cancelado, **9 de 9 OPs vazaram**.

> Duas correções ao que foi levantado antes: o PV-00089 está Faturado mas **com nota fiscal em branco** — merece checagem à parte. E o Kanban ordena dentro da coluna por maior atraso, não por posição de fila; o efeito coincide porque são justamente os mais atrasados.

---

### 7. 13 OPs (6.504 pares) fecharam sem nenhum registro de etapa; 11 delas (4.944 pares) foram faturadas sem um único apontamento — P3

**O que acontece:** OPs criadas e levadas a Finalizado/Cancelada sem que o roteiro fosse materializado. Não afeta o quadro nem o motor (nenhuma está na fila) — mas qualquer relatório de pares por setor, produtividade ou custo de mão de obra por setor lê zero nelas.

**Casos:** OP-2026-01169 e 01168 (780 cada, PV-00146, NF285), OP-2026-01166 e 01165 (780 cada, **Canceladas**), OP-2026-00999 e 01000 (480 cada, PV-00140, NF022), OP-2026-00857 (420, PV-00107), OP-2026-00891/00890 (360 cada, PV-00116), OP-2026-00882/00880/00879/00881 (PV-00111).

Confirmação pelo lado da Expedição — PVs faturados com apontamento faltando:

| PV | Pares nas OPs | Expedição apontada |
|---|---|---|
| PV-00111 | 1.284 | **nenhum registro** |
| PV-00140 | 960 | nenhum registro |
| PV-00116 | 720 | nenhum registro |
| PV-00107 | 420 | nenhum registro |
| PV-00104 | 1.284 | 660 (624 faltando) |
| PV-00122 | 100 | 12 (88 faltando) |

> Honestidade sobre o tamanho: o número real é **4.944**, não 6.504 — 1.560 pares (OP-2026-01165/01166) estão Cancelados e devem ficar fora mesmo. É histórico fechado, não divergência viva.

---

### 8. Uma tela de custo tem "tempo real" decorativo — P3

A tela de Custos de Insumos monta uma escuta de mudanças de preço que **nunca dispara**: as tabelas que ela escuta não estão publicadas para tempo real. Conecta sem erro, e nenhum aviso jamais roda. Quem ajusta preço numa aba e volta pra essa continua vendo o preço velho — mas só se deixou a aba aberta em paralelo; entrar na tela sempre busca dado fresco.

Fora da lente que você pediu. Vale registrar porque parece funcionar e some da lista de suspeitos quando alguém investiga "por que o preço não atualiza".

---

### 9. OP reservada é idêntica a OP liberada no quadro — e infla o gargalo de 36 para 48 — P2

**O que acontece:** a fila carrega o estado de cada OP (`na fila` x `em produção`), mas o quadro **nunca lê esse campo**. OP ainda não liberada entra na coluna com a mesma cara de OP em andamento.

**Quanto custa:** **12 OPs, 548 pares.** Como não têm nenhum apontamento, caem na primeira etapa (Corte Palmilha) — e como têm prazo vencido de **59 a 94 dias**, a ordenação "atrasadas primeiro" as coloca no **topo da coluna, com selo vermelho**.

**Evidência:**

| Estado na fila | Estado da OP | OPs | Pares | Atraso |
|---|---|---|---|---|
| `em_producao` | Em Produção | 42 | 8.832 | 0–150 dias |
| `na_fila` | **Reservado** | **12** | **548** | 59–94 dias |

As 12 reservadas têm **0 apontamentos e 0 etapas com progresso** (medido).

O campo existe e chega até a tela, mas tem **2 ocorrências em todo o código-fonte — as duas são declaração de tipo**. Nenhuma tela o lê.

**Impacto:** a coluna do gargalo mostra 48 OPs; **36 são trabalho liberado e 12 não**. O aviso "Gargalo: Corte Palmilha · 48 OPs acumuladas" e o KPI de atrasadas contam trabalho que a produção não tinha autorização para começar. Quem decide reforço de turno pelo tamanho da coluna dimensiona por um número 33% maior que o real.

**Correção:** levar o estado até o card (um selo discreto "reservado") e decidir explicitamente se OP não liberada conta para gargalo e KPI. Não precisa sair do quadro — precisa ser distinguível.

---

### 10. Badge de WIP mistura busca filtrada com total: coluna de 48 OPs se apresenta como "1/20" — P3

**O que acontece:** no cabeçalho da coluna, o número visível vem do conjunto **filtrado pela busca**, mas o "/20" é acionado pelo total **não filtrado**. Buscando uma OP no Corte Palmilha, a badge lê **`1/20`** — parece folga confortável, num setor com 48 acumuladas marcado como gargalo.

**Evidência:** `ProducaoKanbanGestao.tsx:843-844` calcula o limite sobre o conjunto completo; `:925` imprime a contagem filtrada. A dica de contexto da **mesma badge** (`:923`) usa o número completo — então passar o mouse mostra **48** e ler mostra **1**.

O comentário nas linhas **831-834** documenta exatamente este bug sendo corrigido no `Σ pares` do cabeçalho ("*misturava dois universos durante a busca... quem lia dividia 4.120 por 3 e planejava com um número que não existe*"). A correção alinhou o `Σ pares`; a badge ficou com o híbrido.

**Impacto:** baixo — só durante busca ativa, e o realce âmbar e a faixa de gargalo continuam corretos. Entra na lista porque é uma linha e o diagnóstico já está escrito no arquivo.

---

## "Tempo real": o que atualiza sozinho e o que não

O quadro tem tempo real, mas **só para uma coisa**: apontamento de produção.

| O que muda na fábrica | Chega sozinho no quadro aberto? | Como |
|---|---|---|
| **Apontamento de produção** (o evento do dia a dia) | ✅ **Sim**, em ~0,4s | A tabela de etapas é publicada e o quadro escuta; ao chegar, ele renova fila + agenda + capacidade |
| **Virada do dia** (recálculo automático às 00:05) | ❌ **Não** | O motor reescreveu hoje 54 OPs / 75.332 pares-setor às 00:05 e nenhum quadro aberto soube |
| **Mudança de capacidade de setor** | ❌ **Não** | Recalcula a fábrica inteira; outro terminal continua com as barras antigas |
| **Reordenar a fila / fixar prioridade** | ❌ **Não** | Nenhum outro quadro vê a nova ordem |
| **Mudança de ficha técnica que afeta capacidade** | ❌ **Não** | Mesma causa |
| **Queda de conexão** | ❌ **Não recupera** | Sem recuperação de eventos perdidos e sem re-sincronizar ao reconectar |
| **Sair da tela e voltar** | ✅ Sim | Voltar pra tela sempre busca dado fresco |
| **Trocar de janela e voltar** | ❌ Não | Está desligado de propósito |

**Onde isso morde de verdade — dois casos:**

**(a) Quadro deixado no monitor a noite toda.** É o uso previsto (está escrito no código: "*Pro analista deixar num monitor o dia inteiro*"). Atravessa a meia-noite mostrando a agenda de **ontem**. Medido, comparando o corte de ontem com o de hoje: **33 das 54 OPs** mudam a próxima data agendada, e o total "rolado" cai de 4.481 para 2.873 pares — ou seja, **o quadro de ontem superestima em 1.608 pares (+56%)**.

> Notícia boa que eu esperava ser ruim: a **data prevista de conclusão** e o **atraso em dias** ficaram estáveis — mudaram em **zero das 54 OPs**. Esses dois campos não envelhecem da noite pro dia.

**(b) Não dá pra saber se o quadro está vivo.** O cabeçalho tem um relógio que anda sozinho, **independente dos dados**. Não existe nenhum selo de "atualizado às HH:MM". Quadro congelado é visualmente idêntico a quadro vivo: relógio andando, OPs nas colunas, barras coloridas.

E isso morde mesmo com a conexão perfeita, porque **quadro parado é o estado normal aqui**: nos últimos 14 dias houve apontamento em **7 dias**, sempre em rajadas curtas (31/07: 100 lançamentos entre 11h37 e 15h09; 29/07: 27 em 10 segundos). **Hoje, até 09:22, zero.** Sem o selo, ninguém consegue distinguir "fábrica não apontou" de "conexão morta".

**Um defeito de exibição relacionado:** setor que roda em paralelo **nunca ganha card** no quadro. Corte Forração tem **514 pares em 28 OPs agendados pra hoje**, o cabeçalho da coluna mostra "hoje: 514/514" com barra âmbar de 100%, e logo abaixo a coluna diz **"Sem OP aguardando"**. Hoje o quadro inteiro são **2 colunas** — 48 cards em Corte Palmilha e 6 em Acabamento — com as outras 9 vazias.

---

## O que eu faria, nesta ordem

### BUG — conserta, não precisa decisão sua

**1. Não fechar setores intermediários quando a origem foi apontada parcialmente.**
*Esforço:* condicional numa linha + bloquear no diálogo a combinação "quantidade parcial + destino que pula setor" (a tela já calcula os dois sinais, só falta cruzar).
*Destrava:* **os itens 2, 3 e 4 de uma vez.** É a raiz dos três. Faça este primeiro.
*Depois, estruturalmente:* juntar apontamento + pulos + fechamento numa gravação só, para acabar com o risco de falhar no meio.

**2. Corrigir o rótulo "restam N pares".**
*Esforço:* uma coluna nova na consulta + 3 rótulos de tela.
*Destrava:* o item 1. Para de mostrar 15.552 onde há 1.728 na tela ao lado do botão de terceirização. Manter o número atual (é medida de carga útil pro motor), só com o nome certo: "pares·setor".
*Nota:* o valor de referência correto é **9.380**, não 2.652 — 2.652 conta só Expedição, e 20 das 54 OPs não têm etapa de Expedição.

**3. Corrigir o badge "rolados".**
*Esforço:* **uma linha** na consulta (mostrar por setor, ou o maior entre setores, em vez da soma).
*Destrava:* o item 5. Não mexer no cálculo em si — por setor ele está provadamente correto.

**4. Cascatear o CANCELAMENTO do pedido para as OPs.**
*Esforço:* uma migration (um gatilho, espelhando o que o faturamento já faz). O resto da limpeza já é automático.
*Destrava:* metade do item 6. Fecha o vazamento na origem — 9 de 9 OPs vazaram no único PV cancelado que existe.

**5. Fazer o quadro re-sincronizar ao reconectar + um piso de atualização automática.**
*Esforço:* uma linha (re-sincronizar quando a conexão volta) + um intervalo de 60–120s.
*Destrava:* a virada do dia (janela 00:00→00:05), mudança de capacidade, reordenação de fila, e a recuperação depois de queda de conexão. Cobre os itens da tabela acima marcados com ❌.
*Alternativa mais elegante, se quiser gastar um pouco mais:* publicar a tabela de execuções do motor — é 1 registro por recálculo e cobre os 4 gatilhos que hoje não chegam à tela.

**6. Trocar o relógio nu por um selo "atualizado às HH:MM".**
*Esforço:* pequeno, uma linha de tela.
*Destrava:* **o maior valor prático da lista de tempo real.** Com produção em rajadas e zero apontamento hoje, "parado" é o normal — sem o selo, ninguém sabe se está vendo a verdade.

**7. Corrigir a badge de WIP para não misturar busca com total.**
*Esforço:* uma linha.
*Destrava:* o item 10. O arquivo já traz o diagnóstico escrito no comentário das linhas 831-834.

**8. Dar card ao setor que roda em paralelo.**
*Esforço:* correção na derivação do card.
*Destrava:* Corte Forração deixar de dizer "Sem OP aguardando" com 514 pares agendados.

---

### DECISÃO DE PRODUTO — você escolhe

**8. O que fazer com os 240 pares mortos já na fila.**
As 11 OPs do PV-2026-00089 (Faturado, 132 pares) e as 9 do PV-2026-00094 (Cancelado, 108 pares). O gatilho novo do item 4 não limpa retroativo. **Precisa da sua palavra:** tirar da fila, ou produzir?
*Junto disso:* o PV-2026-00089 está marcado **Faturado com nota fiscal em branco** — merece uma olhada separada.

**8-b. OP reservada deve contar no gargalo e no KPI de atrasadas?**
Hoje conta (item 9: 12 OPs, 548 pares, inflando Corte Palmilha de 36 para 48). Mostrar o selo é bug e está no item 4 acima; **se ela entra na conta do gargalo é decisão sua.**

**9. Distinguir "setor concluído produzindo" de "setor pulado".**
Hoje os dois estados são a mesma coisa no sistema, e é isso que desarma os avisos (item 4). Criar um terceiro estado é uma migration + ajuste em três lugares.
*Só faz sentido depois do item 1.* E vem junto uma pergunta sua: **o pulo de setor deve pedir confirmação humana?** Hoje o código auto-confirma os avisos sem passar por você.

**10. Etiquetar as 13 OPs históricas sem registro de etapa.**
Para os relatórios de produtividade excluírem explicitamente, em vez de somar zero. **Não fazer preenchimento retroativo às cegas.**
*Antes de gastar qualquer hora nisso:* confirmar se existe algum relatório vivo lendo essa tabela hoje. Se não existir, é higiene de dado histórico, não número em uso.

**11. Atualizar a nota do manual sobre a ordem dos setores.**
Ela diz "Aviamento antes de Costura"; o banco e o quadro mostram Costura Palmilha (30) → Costura Cabedal (40) → Aviamento (50), coerentes entre si. É o texto que envelheceu.

---

## O que eu não consegui verificar

**1. Com que frequência a conexão cai na rede da fábrica.** Não existe nenhum registro disso — o único vestígio é uma mensagem no console do navegador, que ninguém lê. O item 7 está provado como *mecanismo* (não existe caminho de recuperação), **não** como frequência observada. Pode ser que caia toda hora ou nunca.

**2. Se existe algum relatório vivo lendo o registro de etapas para produtividade ou custo de mão de obra por setor.** É a pergunta que decide se o item 7 vale trabalho ou é só higiene. Ficou em aberto — não confirmei em nenhum dos dois sentidos.

**3. Não rodei o aplicativo.** Tudo foi apurado lendo o banco de produção e o código. A escuta de tempo real da tela de custos foi provada inerte pelo lado do banco (as tabelas não estão publicadas), mas não confirmei em execução o que aparece na tela nesse momento.

**4. Não testei nenhuma correção.** Todos os esforços estimados acima são leitura de código, não experimento — e nada foi escrito no banco (a análise inteira foi somente leitura).

---

## Como esta análise foi feita

Cinco investigações independentes (motor no servidor, derivação do quadro, tempo real, apontamento, e auditoria dos pedidos reais). Cada uma foi seguida de um **revisor cético**, encarregado de derrubar os achados rodando as consultas por conta própria em vez de confiar no que o primeiro escreveu.

O ceticismo pagou: **dois achados grandes foram derrubados** e não estão neste relatório — a alegação de que a agenda repetia a mesma semana quatro vezes, e a de que 20 OPs sem etapa de Expedição corrompiam a data prevista. Ambas não sobreviveram à medição independente. Da mesma forma, a suspeita inicial de que 27 OPs estavam fora da fila por falta de prazo caiu: são OPs apagadas, e a exclusão está certa.

**Uma ressalva de método, para você saber o grau de confiança de cada item:** o revisor da lente do quadro falhou por erro de servidor. Os itens 9 e 10 vinham dessa lente e teriam sido descartados sem julgamento — **eu os verifiquei manualmente** (as consultas de estado da fila e a leitura direta de `ProducaoKanbanGestao.tsx:843-844`, `:923` e `:925`), e é por isso que estão aqui. Os itens 2 e 3, também dessa lente, sobreviveram porque a investigação de apontamento chegou às mesmas conclusões por outro caminho e **o cético dela confirmou** — achado encontrado duas vezes, por rotas independentes.

Tudo foi apurado contra o banco de produção `ssvxfoybzmjlypnipqzn` em 06/08/2026, em modo somente leitura.

---

## Adendo — decisões tomadas pelo dono (06/08/2026)

As quatro pendências da seção "DECISÃO DE PRODUTO" foram decididas no mesmo dia.
Registrado aqui pra ninguém reabrir:

| Pendência | Decisão | Onde foi feito |
|---|---|---|
| 240 pares de pedido morto na fila | **Excluir.** As 20 OPs viraram `Cancelada`; fila 54 → 34 OPs, 9.380 → 9.140 pares, 15 reservas devolvidas ao estoque | migration `20261216120000` |
| OP reservada conta no gargalo? | **Sim, desde que o faturamento esteja chegando** — janela de 30 dias, e vencido conta (é o caso mais urgente, não o menos) | `countsForConstraint` em `ProducaoKanbanGestao.tsx` |
| Pular setor pede confirmação humana? | **Sim.** Caixa de aceite nos dois diálogos; a porta de gravação recusa sem ela. No lote, o aceite reseta a cada OP | `applyPointing` + os dois diálogos |
| Card em setor paralelo | **Opção C: card de verdade por setor.** Substitui a regra de 12/07/2026 ("um card por OP, na coluna mais avançada") | `deriveCards` em `kanbanDerive.ts` |

⚠ **Duas armadilhas descobertas ao executar, que valem mais que as decisões:**

**1. `Finalizado` fabrica produção fantasma.** Marcar as OPs do PV faturado como
`Finalizado` dispara `tg_close_stages_on_op_finalize`, que fecha toda etapa
pendente com `quantity_processed = quantity_total`. Nas 11 OPs sem produção
nenhuma, isso criaria **132 pares fantasma em 11 setores** — a mesma mentira que
este laudo tirou do Kanban, injetada direto no banco e contaminando
produtividade e custo de mão de obra por setor. Quem barrou foi
`fn_guard_manual_stage_transition`, e a transação inteira reverteu. Use
`Cancelada` pra OP que nunca rodou.

**2. Card por setor exige rechavear a tela.** Com a mesma OP em duas colunas,
seleção em lote, refs de rolagem e halo tinham de deixar de ser chaveados por
`order_id`. Ficaram por `card.key` (`order_id::setor`) — **menos o halo de
pouso**, que segue por OP de propósito: depois do apontamento a OP muda de
coluna, então a chave de origem não casaria com card nenhum e o realce sumiria.
E os KPIs do topo passaram a contar OPs DISTINTAS, senão a OP em paralelo era
contada duas vezes (a mesma dupla contagem que o laudo achou no "restam N pares").

### Nota de migration — a colisão de carimbo aconteceu de novo (06/08/2026)

As duas migrations desta auditoria nasceram como `20261210120000` e
`20261212120000`. Na hora de criar, conferi as **duas** fontes que o CLAUDE.md
manda conferir e elas concordavam (topo registrado = maior arquivo local =
`20261208120000`). Ainda assim colidiu: **outra sessão registrou
`20261210120000`** (`catalogo-recadastro-de-cor-e-rls`) enquanto este trabalho
acontecia.

⚠ **A regra das duas fontes não imuniza contra sessão paralela** — ela só fecha
a janela entre repo e banco num instante. Em worktree compartilhado, reconsulte
**na hora de aplicar**, não só na hora de criar o arquivo.

Resolvido pela regra do projeto: o arquivo **já registrado** manteve o carimbo,
e só os meus (não registrados sob ele) foram renomeados com `git mv`, conteúdo
intacto, preservando a ordem relativa:

| era | virou |
|---|---|
| `20261210120000_cascata-cancelamento-pv-e-metricas-honestas` | `20261214120000` |
| `20261212120000_limpar-ops-de-pv-morto-na-fila` | `20261216120000` |

E o registro foi alinhado ao nome do arquivo: aplicadas via MCP, elas tinham
sido gravadas sob o carimbo da data real (`20260806170528` e `20260806174945`),
que é MENOR que o topo da sequência sintética — um `db push` as re-executaria.
Depois do alinhamento: zero carimbos duplicados nos arquivos e zero no banco.
