# Auditoria Visual ao Vivo — 2026-05-10

Sessão via Claude in Chrome no site live (https://squadshoes-real.vercel.app), autenticado como Leonardo Monnerat (Administrador). Navegação real página a página com screenshots.

Severidades:
- 🔴 **Crítico**: bug de dados, fluxo quebrado, perda visual
- 🟠 **Alto**: confusão UX clara, regressão de design system
- 🟡 **Médio**: inconsistência menor, polimento
- 🔵 **Info**: observação pra próxima rodada

---

## Dashboard (`/dashboard`)

**1. 🔴 Gráfico "Vendas vs Produção" sem barras renderizadas**
- O card mostra eixo Y (0/45k/90k/135k/180k) e meses (dez/jan/fev/mar/abr/mai), mas as barras de Vendas e Produção não desenham. Apenas legenda está visível.
- *Hipótese*: dados de produção estão zerados ou query falha silenciosa.
- *Onde investigar*: hook que alimenta o BarChart, provavelmente em `Dashboard.tsx` ou similar.

**2. 🔴 Donut "Distribuição de Estoque" também vazio**
- Legenda lista Acessório/Forração da Palmilha/Cabedal/Palmilha/Embalagem mas o donut não é desenhado.
- Mesma raiz provável.

**3. 🟠 Card "Saldo Líquido" destacado em VERMELHO mostrando valor positivo**
- `R$ 47.849` "estimado" com bg vermelho/destrutivo — semântica de alerta, mas saldo é positivo (não é débito).
- *Fix sugerido*: aplicar lógica `valor >= 0 ? success : destructive`.

**4. 🟡 Faturamento R$ 0,00 com seta "Total ordens" ↗ (verde)**
- Valor zero com indicador positivo é confuso. Talvez não há faturamento no mês atual.

---

## Pedidos de Venda — Listagem (`/sales`)

**5. 🔴 Inconsistência de contagem entre tabs e cards**
- Tab "Pedidos Ativos" mostra `2`, mas o card "Total Pedidos" mostra `6 / 720 pares` e a tabela renderiza ≥4 linhas (PV-00097 + 00094 + 00093 + 00092…) com tab Ativos selecionada.
- Card "Aprovados: 0 / 2 em produção" também não bate com a tabela visível.
- *Hipótese*: tabs filtram por `status NOT IN (Faturado, Cancelado)` mas a contagem do tab não casa com a query da lista.

**6. 🟠 Coluna "Total" em VERMELHO (text-destructive)**
- Valores positivos como `R$ 2.995,20` aparecem em vermelho — semântica de débito.
- Inconsistente: total do PV é receita (positivo), não dívida.
- *Onde*: provavelmente classe `text-destructive` aplicada genericamente, deveria ser `text-foreground` ou `text-success`.

**7. 🟡 Coluna "Nº CLIENTE" sempre vazia (—)**
- Todos os 4+ PVs visíveis têm "—" na coluna. Ocupa espaço sem trazer info.
- *Fix sugerido*: `hidden sm:table-cell` ou só esconder se 100% das linhas tem null.

**8. 🟡 Nome do cliente truncado sem tooltip**
- "VIP SHOES ARARUAMA COME..." cortado. Hover não revela completo (a verificar).

**9. 🔵 Coluna "Entrega / Fat." mostra warning ⚠ pra todos os PVs com data passada**
- OK comportamento, mas as datas `08/04/2026`, `05/04/2026` já passaram (hoje é 10/05/2026). PVs ficaram em rascunho/produção com prazo vencido. Sistema deveria sugerir reset de prazo ou alerta mais visível.

**10. 🔴 Bug intermitente: "Acesso Restrito" aparece em /sales/new mesmo sendo Administrador**
- Primeira navegação direto pra `/sales/new` → form carregou → após scroll, página se transformou em "Acesso Restrito" e sidebar foi recolhida.
- Segunda navegação (via clique no botão "+ Novo Pedido") → carregou normal.
- Diagnóstico: race condition no auth check. ProtectedRoute deve ter um momento entre "loading auth" e "loaded" onde a renderização cai pro fallback de unauthorized.
- *Investigar*: hook `useAuth` ou `useUserRole` retorna `false` momentaneamente durante refetch, derrubando o ProtectedRoute.

---

## Pedidos de Venda — Visualização (modal de detalhe)

**11. 🟠 Modal de detalhe não mostra info de Factoring**
- PV-2026-00097 (status "Em Produção", abrindo o modal): aparece header com Consumo de materiais, Margem, OPs, Gerar PDF, Etiquetas.
- Resumo cliente: Pagamento "30 dias", Entrega 08/04/2026.
- **Mas não há indicação se o PV é Factoring nem o desconto previsto**. Se for, o usuário precisa abrir a edição completa pra ver.

**12. 🟡 Cores de tira em casos mistos (UPPER/lowercase)**
- TIRA 1/2/3: ADOCICADO/CHAMPAGNE/`milk` (este último em lowercase). Inconsistência de cadastro mas a UI poderia uppercase no display por consistência visual.

---

## Pedidos de Venda — Form (Novo `/sales/new`)

**13. 🟡 Input "Razão Social / Nome Fantasia *" com border vermelho desde o início**
- Form recém-aberto, nenhum click no submit, mas o campo já mostra `border-destructive`.
- O `submitAttempted` flag deveria começar `false` e só virar `true` após primeira tentativa de submit.
- *Visual*: sugere erro pra usuário sem ação dele.

**14. 🔵 Stepper Pendente → Aprovado → Em Produção → Pronto → Faturado bem visual**
- OK, sem cancelado/atalhos.

---

## Pedidos de Venda — Form de Edição (`/sales/edit/:id`)

**15. 🔴 CRÍTICO: Matriz "Distribuição por Numeração" mostra TAMANHOS DIFERENTES dos cadastrados**
- PV-2026-00097 abrindo edição:
  - Modal de detalhe (visualização): grade mostra 25/26/27/28/29/30/31/32 com 4/4/4/4/2/2/2/2 (= 24 pares)
  - Form de edição: matriz mostra 35/36/37/38 com TODOS VAZIOS (`-`)
- Cabeçalho do bloco diz "24 pares/ficha" (correto), mas os inputs da grade estão vazios.
- **Hipótese**: o solado vinculado a I90/I110 hoje tem range 35-38 (atualizado posteriormente), mas o item original do PV tem `size_distribution` com 25-32. Form usa o range *atual* do solado e ignora a distribuição original — se usuário salvar, **perde a distribuição original**.
- *Onde investigar*: hook que renderiza a matriz em `OrderMatrixForm.tsx` ou `SaleOrderItemForm.tsx`, função que constrói os keys da grade (provavelmente vai pra `solado.stock_grade._size_from/to` em vez de mesclar com `item.size_distribution`).

**16. 🟠 Breadcrumb mostra UUID completo do pedido**
- "Comercial > Pedidos de Venda > Editar > 3f5d2ca1-679a-4108-9d5e-4e9fdddfa56f"
- Header: "Editar Pedido `3f5d2ca1`" (UUID truncado).
- Deveria mostrar `PV-2026-00097` (order_number) — UUID interno é irrelevante pro usuário.

**17. 🟠 Subtotal/Total do PV em VERMELHO (text-destructive) consistentemente**
- "SUBTOTAL R$ 499,20" (por item) e "VALOR TOTAL DO PEDIDO R$ 2.995,20" ambos vermelhos. Repetido bug do listing.

**18. 🟡 Cliente combobox mostra "0" abaixo do valor selecionado**
- "#L036 — VIP SHOES ARARUAMA COMERCIO DE CALCADO..." e logo abaixo um "0" solto.
- *Hipótese*: contador de hits da busca ou lixo de string interpolation.

**19. 🟡 Coluna "(Tira chata Cost..." truncada na fonte (UI label)**
- Acima dos selects TIRA 1/2/3 aparece um label "(Tira chata Cost..." cortado. Não consigo ler o que é.
- *Fix*: encurtar label ou aumentar largura disponível.

**20. 🔵 Mensagem de validação "Pedido pronto para envio — todos os campos validados"**
- Verde, no rodapé. UX bom.

**21. 🔵 Card "EMBALAGENS DAS FICHAS TÉCNICAS" com aviso amber**
- "⚠ Nenhuma embalagem do tipo selecionado configurada nas fichas técnicas." OK feedback.

---

## Ficha Técnica (`/fichas-tecnicas`)

**22. 🟠 Status confuso 3-way pra mesma ficha**
- I110 mostra:
  - Listagem: badge **"Rascunho"**
  - Form Identificação: dropdown "Status Produção: **Ativo**"
  - Barra de Progresso: **"Status ✗"** (faltando, único item não-checked dos 8)
- 3 indicadores diferentes pro mesmo conceito de "estado da ficha".
- Recomendação: unificar em 1 campo `ficha_status` com domínio claro (rascunho/aprovada/inativa) e propagar pra todas as views.

**23. 🟠 Subtítulo do header "SEM CORES" em VERMELHO destrutivo + "R$ 0,00" também vermelho**
- "I110 NAPA SOFT > **SEM CORES** > **R$ 0,00**"
- Bg destrutivo gritante pra status informativo (sem variantes cadastradas). UX agressiva sem necessidade.
- *Fix*: usar amber (warning) em vez de destructive.

**24. 🟠 "Driver técnico" badge solto no canto direito do card sem contexto**
- No header de "Grupo de Solado — Base do Produto" aparece um Badge "Driver técnico" sem explicação.
- Tooltip-only? Não testei hover.

**25. 🔴 Tabela "Consumo por Numeração — Produção" com TODOS os valores ZERO**
- Cabedal (m): 0/0/0/0/0/0/0/0/0/0/0/0 (12 numerações infantis 21-32)
- Forração (m): 0/0/0/0/0/0/0/0/0/0/0/0
- Palmilha (m): 0/0/0/0/0/0/0/0/0/0/0/0
- *Sem aviso visual* de que essa configuração está incompleta. Sistema usa esses valores pra debitar estoque — se 0, débitos não acontecem corretamente.
- Recomendação: row inteiro com fundo amber + alerta "Preencha o consumo por numeração antes de aprovar a ficha".

**26. 🟠 "Cor da Palmilha por Cor de Cabedal: 0/26 mapeados"**
- 26 cores de cabedal listadas (ADOCICADO, BABY BLUE, BRANCO, BRIDAL, CAPPUCCINO, CARMIM…), nenhuma com palmilha mapeada.
- Mesma situação em "Cor da Forração por Cor de Cabedal: 0/26 mapeados".
- Sistema cai em fallback (provável Preto) — mas dado faltando crítico exibido como contador discreto. Deveria ter banner avisando.

**27. 🟠 Configuração de Tiras: numerações 21-24 com 0 cm/par mas 25-36 com 36cm**
- Pode ser intencional (tira só pra tamanhos > 24) mas sem explicação visual.
- Tamanho 21 produzirá com 0cm de tira → produto malformado se não houver outro fluxo.
- Sugestão: linha visual (ex: zig-zag) separando "sem tira" de "com tira" + tooltip explicativo.

**28. 🟡 "Habilitar tiras neste modelo" check em VERMELHO destrutivo**
- Estado ativo/checked pinta o card em destructive em vez de primary/success.
- Inconsistência semântica (check = ok, não = erro).

**29. 🟡 Stepper de filtro complexo no topo "1 → 2 → 3 → 4 → Abrir Ficha"**
- 1 Selecione Referência → 2 Selecione Material * → 3 Cor (filtrada) → 4 Preço → Abrir Ficha
- UX confuso: parece que o usuário precisa fazer todo o stepper só pra abrir uma ficha. Mas a tabela embaixo também abre direto via clique. **Funcionalidade duplicada com objetivos pouco claros.**

**30. 🟡 Coluna "Solado / Cabedal" mistura case e formato**
- I110: "SOLADO INFANTIL" + "NAPA SOFT" (2 itens, 1 maiúscula 1 maiúscula com espaço)
- 170: "Solado Infantil" (capitalize)
- STX: só "NAPA SOFT" (sem solado)
- TR05: "01" (sem nome — só código)
- Inconsistência grave de cadastro. UI não normaliza.

---

## Estoque (`/estoque`)

**31. 🟡 7 tabs no header (Visão Geral / Materiais / Alertas / — Consumíveis / Histórico / Auditoria / Corte Tiras)**
- Sobrecarga em desktop. Em mobile vai embolar.
- "— Consumíveis" tem caractere `—` antes do nome — provavelmente bug de label.

**32. 🟠 9 chips de filtro lateralmente "Todos / Solados / Cabedal / Forro / Palmilha / Químicos / Componentes / Embalagem / Fichas de Componentes ↗"**
- Muito denso, vai quebrar em mobile.
- "Fichas de Componentes ↗" leva a outra página — chip errado pra esse uso (navegação misturada com filtro).

**33. 🟡 SKU de teste no DB ("adssd" pra ABS DEDO)**
- Provavelmente cadastro inicial de teste. UI não detecta/avisa.

**34. 🟡 "Visualização 8" no header**
- Botão sem contexto, label confuso. Provavelmente número de visualizações salvas.

**35. 🟡 "Top Modelos: Nenhum produto encontrado" em página vazia**
- Card com placeholder vazio na Visão Geral. Confuso pra novo usuário.

---

## Estoque — Edição de Grupo (modal "Dados do Grupo")

**36. 🔴 Modal de edição de grupo CORTA inputs de Estoque & Localização**
- Aba "Dados do Grupo": labels "Estoque Mínimo / Estoque Máximo / Segurança" visíveis no rodapé do modal mas seus INPUTS estão fora da área visível.
- Modal não rola internamente nem expande. Usuário **não consegue editar** esses campos.
- *Reproduz*: clicar Pencil em "ELÁSTICO 7MM" → tab "Dados do Grupo" → rolar tentar.

**37. 🟠 Categoria do grupo VAZIA mas listagem mostra "Acessório"**
- Modal Dados do Grupo: campo Categoria sem valor.
- Listagem: mesma linha mostra coluna Categoria = "Acessório".
- Inconsistência de fonte: a categoria pode estar na variante (não no grupo) e a UI confunde.

**38. 🔵 Banner amber "Os campos abaixo são compartilhados por todas as variantes" — UX exemplar**
- Avisa que salvar aplica a todas as N variantes. Bom feedback.

**39. 🟡 Variantes com case mistos**
- "Preto" (capitalize), "OFF white" (parcial maiúscula). UI não normaliza display.

**40. 🟡 Botão "Editar completo" — label confuso**
- "Completo" sugere algo total mas é só edição da variante individual. Renomear pra "Editar variante" ou "Detalhes".

---

## Estoque — Edição de Variante (drawer "Editar variante completa")

**41. 🟠 Campo "Cor *" com border DESTRUTIVO mesmo preenchido**
- Cor "Preto" mostrada com border vermelho. submitAttempted/required mal acionado.

**42. 🟡 Toggle "Ativa" ON em VERMELHO destrutivo**
- Estado positivo (ativo, ON) usa cor de alerta. Devia ser primary ou success.

**43. 🔵 Drawer organizado em 3 seções (Identificação / Estoque / Preços & Compras)**
- UX limpa, scroll funcionando dentro do drawer. Bom contraste com bug 36.

**44. 🟡 Drawer NÃO mostra NCM nem código de barras**
- Schema tem esses campos (auditoria estática anterior), mas drawer simplifica. Pode forçar usuário a editar via outro lugar (ex: aba Variantes na ficha técnica).

**45. 🔵 "Reservado: 0"** — boa exposição do campo (vinda de auditoria E9).

---

## Solados (`/solados`)

**46. 🔴 PARES EM ESTOQUE = 0 nos 9 solados ativos**
- Header: "9 solados / 0 pares em estoque / 3 abaixo do mínimo".
- Todo o estoque de solados está zerado — alerta crítico mas o KPI não destaca.

**47. 🟠 Naming inconsistente entre solados**
- "01 - CARAMELO" / "01 - Preto" (case mistura)
- "Saltinho Bloco - Caramelo" / "Saltinho Bloco - Preto"
- "SOLADO INFANTIL" (todo upper) vs "Solado Infantil - Caramelo" (capitalize)
- "238" sem cor visível na lista.

**48. 🟠 SKU "OIAJSDI" do SOLADO INFANTIL — parece random/teste**
- Sem padrão (outros têm "01", "204", "238" — números sequenciais).

**49. 🟠 Range 25-36 cadastrado mas presets sugerem 25-34 ou 22-28 como ★ recomendado**
- SOLADO INFANTIL: range cadastrado é "25 até 36" (Cadastro) mas na aba Consumos, presets ★ marcados são "Infantil 25-34" e "Infantil Pequeno 22-28" — nenhum casa exatamente.
- *Hipótese*: presets ★ são "comumente usados" não "atual" — confuso.

**50. 🟠 Aba Estoque diz "Configure o range na aba Cadastro primeiro" mesmo com range cadastrado**
- Mensagem de empty state inconsistente. Range existe (25-36) mas as numerações individuais não foram populadas no `stock_grade` JSONB.

**51. 🔵 UX excelente na aba Consumos**
- Banner amber explicando "Consumo é por REFERÊNCIA, não por cor"
- Sub-tabs Forração-Palmilha / Itens Padrão / Silk
- Botões "Puxar de Família" / "Copiar de Qualquer Solado" / "Salvar"
- Presets de conjugação Infantil/Misto/Adulto/Adulto todo conjugado

**52. 🔵 Conjugação UI bem estruturada**
- Add manual via "Rótulo" + "Tamanhos (separados por vírgula)" + Adicionar.

---

## Ordens de Produção (`/orders`)

**53. 🔴 Pipeline de produção PARADO**
- 39 OPs em "PREPARAÇÃO" (Corte/Aviamento)
- 0 OPs em Costura, Montagem, Finalização, Expedição
- PV-2026-00097 está "Em produção" desde 20/04 (~3 semanas) sem mover de fase.
- Sistema não está movimentando OPs entre setores. Pode ser bug do tracking ou processo manual abandonado.

**54. 🔴 Cards de OP mostram "0/10 progresso" e badge "ATRASADA" vermelho**
- Mesmo "Em produção", todas as OPs estão em 0% (10 etapas, 0 marcadas).
- Indica que o avanço por setor não está sendo registrado.

**55. 🔵 Kanban com 5 colunas claras (Preparação 01/05 → Expedição 05/05)**
- Numeração + descrição (Corte/Aviamento, Costura/Silk, Colagem/Montagem, Solagem/Acabamento, Pronto p/ envio).
- Boa visualização.

**56. 🟡 Botão "Aprovar" sem contexto**
- Aprovar o quê? Provavelmente as OPs selecionadas. Tooltip ajudaria.

---

## Financeiro (`/finance`)

**57. 🔴 BUG CRÍTICO: aba "Contas" CRASHA com ErrorBoundary**
- Clicar em "Contas" no Financeiro derruba a página inteira pra "Algo deu errado / Ocorreu um erro ao carregar esta página".
- Console:
  ```
  Error: A <Select.Item /> must have a value prop that is not an empty string.
  This is because the Select value can be set to an empty string to clear the
  selection and show the placeholder.
  ```
- *Causa*: algum `<SelectItem value="">` em [Finance.tsx](src/pages/Finance.tsx) (provavelmente o filtro de status em Contas a Pagar — vimos `value=""` em "Todos" no audit estático).
- *Fix urgente*: trocar `value=""` por `value="all"` (ou similar) e atualizar handler.

**58. 🔴 Alertas Inteligentes 1 e 2 com TEXTO INVISÍVEL**
- Card "Alertas Inteligentes 3" tem 3 alertas, mas os 2 primeiros têm texto cinza claríssimo sobre fundo amber claro — quase ilegível.
- Apenas o 3º (8 contas a pagar vencidas) tem texto vermelho legível.
- Bug grave de contraste — provavelmente classe de cor faltando aplicada pra `dark mode` mas em light também.

**59. 🟡 Gráfico "Projeção de Saldo — Próximos 30 dias" plano**
- Linha fixa em ~70k de 10/05 a 07/06, sem variação.
- Provavelmente as projeções de A Receber / A Pagar não estão alimentando o cálculo, ou estão equilibradas (R$94k - R$24k = R$70k em todos os dias).

**60. 🔵 Breadcrumb "Financeiro › Visão Geral" funcionando** (fix do round 25).

**61. 🟡 Receitas/Despesas/Resultado do Mês = R$0,00 com -100.0%**
- Empresa sem movimentação no mês corrente. Comparativo "-100%" é matematicamente correto mas confuso.

---

## RH — Painel + Banco de Horas

**62. 🔴 13 de 15 funcionários (87%) sem escala de trabalho atribuída**
- Card de alerta "13 funcionários sem escala de trabalho atribuída" → botão "Atribuir".
- Sistema RH depende disso pra calcular HE/falta/banco. Sem escala, lógica fica quebrada.

**63. 🔴 Banco de horas com saldo extremo em 11 de 15 funcionários (73%)**
- Top: Thais Batista +233h 18min, Elton +165h, Gisele +141h, Daiane +137h, Catia +118h
- Acumulado de crédito da empresa: **+1213h** (~5 semanas/8 horas).
- Indica problema crônico operacional — sistema deveria escalar alertas (não só badge no painel).

**64. 🔵 Visual de BH excelente** — KPIs (Funcionários/Crédito/Débito/Saldo Líquido) claros, lista bem organizada com filtros, sub-tabs Funcionários/Setores.

**65. 🔵 Painel RH com chips de funcionários BH** — UX boa, mostra os top 6 e "+5 mostrar todos".

---

## Resumo Executivo

### Bugs CRÍTICOS (🔴) — 11 itens, ação imediata:

1. **Modal "Dados do Grupo" no Estoque corta inputs** (#36): usuário não consegue editar Estoque Mínimo/Máximo/Segurança.
2. **Form de PV não lê size_distribution original** (#15): edição de PV antigo perde os valores de pares por numeração.
3. **Acesso Restrito intermitente em /sales/new** (#10): bug de race no auth check.
4. **Pipeline de produção parado** (#53, #54): 39 OPs em Preparação, 0 em outros setores. Tracking de progresso quebrado.
5. **Aba "Contas" do Financeiro CRASHA** (#57): `<SelectItem value="">` viola Radix UI, ErrorBoundary derruba página.
6. **Alertas Inteligentes invisíveis no Financeiro** (#58): 2 dos 3 alertas com texto ilegível.
7. **Tabela de "Consumo por Numeração" da Ficha Técnica TODA ZERO** (#25): cabedal/forração/palmilha = 0/0/0/0… — débitos de estoque não acontecem.
8. **Gráficos do Dashboard vazios** (#1, #2): "Vendas vs Produção" e "Distribuição de Estoque" sem dados renderizados.
9. **Saldo Líquido positivo em VERMELHO destrutivo** (#3): semântica invertida.
10. **Pares em Estoque dos solados = 0** (#46): 9 solados, todos zerados.
11. **13 de 15 funcionários sem escala** (#62): RH depende disso pra cálculos.

### Bugs ALTOS (🟠) — 28 itens, próxima sprint
### Bugs MÉDIOS (🟡) — 18 itens, polimento
### Observações INFO (🔵) — 13 itens, pontos positivos

---

## Próximos passos sugeridos

1. **Fix imediato bug #57** (Finance Contas crash) — produção quebrada pra um módulo inteiro.
2. **Investigar #15** (PV edit perde size_distribution) — risco de perda de dados se usuário salva.
3. **Investigar #25** (consumo por numeração zerado nas fichas) — débitos de estoque comprometidos.
4. **Audit cor `text-destructive` aplicada a valores positivos** — múltiplos pontos (#3, #6, #17, #23 entre outros).
5. **Fix #36** (modal estoque corta inputs).
6. **Resolver alertas RH** (#62, #63) — atribuir escalas e parametrizar BH.

Auditoria realizada via Claude in Chrome em sessão autenticada como Leonardo Monnerat (Administrador), navegando o site live em produção.

