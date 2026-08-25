# Gerar OS por Pedido — Terceirização opcional (setor a setor) + fim do passo Revisão

> **Atualização de domínio (24/08/2026):** este documento continua sendo a
> fonte do fluxo opcional (zero, algumas ou todas as OS; dois passos; parcial
> permitida). A evolução posterior de capacidade/prazo/materiais substituiu
> apenas a escolha livre de prestador: cada ficha agora admite **um prestador
> ativo por atividade**, e uma linha só fica `ready` quando essa configuração
> exata contém prestador, capacidade, retorno e materiais válidos. O wizard
> exibe o prestador da ficha e não oferece override; tarifa manual e quantidade
> parcial continuam permitidas. Assim, as menções antigas abaixo a `ready` como
> somente `contractorId && rate > 0 && qty > 0` descrevem o estado anterior e
> devem ser lidas junto desse gate adicional de configuração.

## Goal
Permitir que o usuário **conclua** o assistente "Gerar Ordem de Serviço" (aberto a
partir de um Pedido de Venda) decidindo fazer **tudo internamente** — sem gerar
nenhuma OS — ou terceirizar **apenas alguns** setores, num único clique na própria
tela de serviços. Hoje o assistente dá a impressão (e, na prática, obriga) de que
todo procedimento precisa ir para a terceirização, porque o botão final fica
desabilitado quando nenhum setor tem contratada.

## Background / Problem
O componente [`GenerateServiceOrdersWizard.tsx`](src/components/contractors/GenerateServiceOrdersWizard.tsx)
tem 3 passos: **Pedido → Serviços e OPs → Revisão**. Funcionalmente ele **já é
opt-in por setor** — só gera OS para setores com contratada + preço + OP marcada, e
ignora os demais (setores sem contratada seguem internos, nada muda no sistema). O
lado SQL (`generate_op_service_orders`, migration `20260703120000`) também só
processa as linhas enviadas e pula linhas inválidas — não exige todos os setores.

O atrito é de **fluxo/UX**, não de motor:
1. Para avançar do passo "Serviços e OPs" para "Revisão", o assistente exige ao
   menos 1 OP marcada (`canNext`, [linha 228](src/components/contractors/GenerateServiceOrdersWizard.tsx:228)).
   Quem quer fazer **tudo interno** (nada marcado) fica preso, sem botão de
   conclusão.
2. O botão final "Gerar" fica **desabilitado** quando `ready.length === 0`
   ([linha 496](src/components/contractors/GenerateServiceOrdersWizard.tsx:496)) —
   ou seja, não há como "sair concluindo" sem terceirizar pelo menos um setor.
3. Cada setor sem contratada exibe "⚠ Escolha a contratada — sem ela essas OPs não
   são geradas" ([linha 372](src/components/contractors/GenerateServiceOrdersWizard.tsx:372)),
   reforçando a impressão de obrigatoriedade.
4. O passo **Revisão** é só conferência (resumo do que vira OS) e adiciona um clique.

## Scope
### In scope
- Fazer a terceirização de cada setor ser **opcional**: o usuário conclui o
  assistente com zero, alguns ou todos os setores terceirizados.
- Botão final **adaptativo** na tela "Serviços e OPs":
  - Nenhuma linha pronta (`ready.length === 0`) → **"Prosseguir"** (finaliza, cria
    zero OS, tudo segue interno).
  - Uma ou mais linhas prontas (`ready.length > 0`) → **"Gerar OS"** (cria OS só
    para as linhas prontas; setores/OPs sem contratada continuam internos).
- **Eliminar o passo "Revisão"**: assistente passa a ter 2 passos
  (**Pedido → Serviços e OPs**). O resumo que estava na Revisão passa a viver no
  **rodapé** da tela de serviços (ao vivo).
- Ajustar o gating para que a conclusão seja sempre possível a partir da tela de
  serviços (não exigir ≥1 OP marcada).
- Alteração **apenas frontend** neste componente; sem migration.

### Out of scope (explicitamente agora)
- Qualquer mudança no motor SQL (`generate_op_service_orders`,
  `get_pv_outsourceable_lines`) — já suportam geração parcial/vazia.
- Mudança na lógica de quais setores são terceirizáveis (whitelist de 8 setores /
  derivação por `order_stages` com fallback `production_sectors`).
- Mudança no fluxo antigo por item (`ServiceOrderFormDialog`) usado em outras telas.
- Criar qualquer registro/estado novo para "produção interna" — o requisito do
  usuário é que **nada muda** para os setores não terceirizados.
- Confirmação/modal extra ao clicar "Prosseguir" (ver Open questions).

## Requirements
Numeradas, testáveis, sem ambiguidade. Cada uma é um "must".

1. O assistente deve permitir **concluir sem terceirizar nenhum setor**: com nenhuma
   contratada escolhida, existe um botão habilitado **"Prosseguir"** que fecha o
   assistente **sem criar nenhuma OS**.
2. Clicar "Prosseguir" **não cria nenhuma OS** e **não altera** as OPs, o PV, nem os
   setores internos (nenhum efeito colateral no banco). Exibe um toast de feedback
   (ex.: "Nenhuma OS gerada — produção segue interna.") e fecha o assistente.
3. Com **um ou mais** setores preenchidos (contratada + preço + ≥1 OP marcada), o
   botão final vira **"Gerar OS"** e gera OS **apenas** para as linhas prontas
   (`ready`), exatamente como `doGenerate` faz hoje. Setores/OPs sem contratada
   **não** geram OS e seguem internos.
4. O caso **misto** (parte terceirizada, parte interna) é suportado num único clique:
   "Gerar OS" cria as prontas e ignora as demais, sem travar.
5. O passo **"Revisão" deixa de existir**. O assistente tem 2 passos:
   **Pedido → Serviços e OPs**. Quando aberto a partir do PV (`initialSaleOrderId`
   presente), abre direto em "Serviços e OPs".
6. A tela "Serviços e OPs" passa a exibir, no **rodapé**, um resumo ao vivo do que
   será gerado: nº de OS a criar (= `ready.length`), total de pares, total R$ e
   quantas linhas **ficam de fora** (`blockedCount` — marcadas mas sem contratada/
   preço). O aviso de "linhas de fora" que hoje mora na Revisão migra para cá.
7. O botão de conclusão da tela de serviços deve estar **habilitado** sempre que o
   PV estiver carregado (não deve exigir ≥1 OP marcada). Fica desabilitado apenas
   enquanto carrega linhas ou durante o `mutate` de geração.
8. Reabrir o assistente e gerar de novo **não duplica** OS (idempotência já
   garantida pelo índice único `uq_os_per_op_sector`; comportamento inalterado).
9. A partir do **hub Terceirizados** (`Contractors.tsx`), onde não há PV
   pré-selecionado, o passo "Pedido" continua sendo o primeiro; ao escolher o PV,
   "Continuar" leva a "Serviços e OPs", que passa a ser o passo final com o mesmo
   botão adaptativo. O comportamento novo vale para os dois pontos de entrada (é o
   mesmo componente compartilhado).

## Data model / Domain
Nenhuma mudança de schema. Referências relevantes (estado atual):

- **Componente:** [`src/components/contractors/GenerateServiceOrdersWizard.tsx`](src/components/contractors/GenerateServiceOrdersWizard.tsx)
  - `STEPS` = `['Pedido', 'Serviços e OPs', 'Revisão']` ([linha 45](src/components/contractors/GenerateServiceOrdersWizard.tsx:45)) → passa a `['Pedido', 'Serviços e OPs']`.
  - Abertura via PV começa no passo 1 ([linha 68](src/components/contractors/GenerateServiceOrdersWizard.tsx:68)).
  - `chosen` = OPs marcadas; `ready` = `chosen` com `contractorId && rate > 0 && qty > 0`
    ([linhas 195–198](src/components/contractors/GenerateServiceOrdersWizard.tsx:195)).
  - `totalPairs` / `totalValue` / `blockedCount` já calculados ([linhas 196–198](src/components/contractors/GenerateServiceOrdersWizard.tsx:196)).
  - `doGenerate` monta payload só de `ready` e chama a mutation ([linhas 205–226](src/components/contractors/GenerateServiceOrdersWizard.tsx:205)).
  - `canNext` (gate) na [linha 228](src/components/contractors/GenerateServiceOrdersWizard.tsx:228).
  - Rodapé com resumo já existe ([linhas 481–485](src/components/contractors/GenerateServiceOrdersWizard.tsx:481)).
  - Botões "Voltar" / "Continuar" / "Gerar N OS" ([linhas 486–501](src/components/contractors/GenerateServiceOrdersWizard.tsx:486)).
- **Hook:** [`src/hooks/useGenerateOpServiceOrders.ts`](src/hooks/useGenerateOpServiceOrders.ts)
  (`usePvOutsourceableLines`, `useGenerateOpServiceOrders`, `fetchContractorRate`).
- **SQL (inalterado):** `get_pv_outsourceable_lines` e `generate_op_service_orders`
  em [`supabase/migrations/20260703120000_generate-op-service-orders.sql`](supabase/migrations/20260703120000_generate-op-service-orders.sql).
  Índice `uq_os_per_op_sector` garante ≤1 OS ativa por `(order_id, target_sector)`.
- **Pontos de abertura:** PV em [`SaleOrderForm.tsx`](src/pages/SaleOrderForm.tsx) (via
  `initialSaleOrderId`); hub em [`Contractors.tsx`](src/pages/Contractors.tsx).

## User flows
### Happy path A — tudo interno (não terceirizar nada)
1. No PV, usuário clica "Gerar OS por Pedido". Assistente abre direto em
   "Serviços e OPs" com o PV pré-carregado.
2. Usuário **não** escolhe contratada em nenhum setor (deixa tudo como está).
3. Rodapé mostra `0 OS · 0 pares · R$ 0,00` (e, se houver OPs marcadas sem
   contratada, "N de fora").
4. Botão final está **"Prosseguir"** e habilitado. Usuário clica.
5. Assistente fecha, **nenhuma OS é criada**, toast "Nenhuma OS gerada — produção
   segue interna.", e as OPs seguem no fluxo interno normal.

### Happy path B — terceirizar só alguns setores (misto)
1. Assistente abre em "Serviços e OPs".
2. Usuário escolhe contratada + preço para "Costura" e marca a(s) OP(s); deixa
   Montagem, Solagem etc. em branco.
3. Rodapé mostra `1 OS · 80 pares · R$ 1.600,00` (exemplo) e reflete quantas linhas
   ficam de fora.
4. Botão final vira **"Gerar OS"**. Usuário clica.
5. Sistema gera **apenas** a(s) OS de Costura; Montagem/Solagem seguem internos.
   Toast de sucesso ("1 OS gerada."), assistente fecha.

### Alternate — abertura pelo hub Terceirizados
1. Usuário abre o assistente sem PV. Passo "Pedido" aparece; escolhe o PV;
   "Continuar" → "Serviços e OPs".
2. Segue como Happy path A ou B.

## Edge cases & failure modes
- **PV sem setores terceirizáveis** (`groups.length === 0`): a tela mostra o
  EmptyState "Nada a terceirizar"; o botão final deve permitir **fechar/Prosseguir**
  mesmo assim (não fica preso). → botão "Prosseguir".
- **OPs marcadas mas sem contratada** (checked porém não `ready`): `ready.length === 0`
  ⇒ botão "Prosseguir"; ao concluir, essas OPs **não** geram OS e seguem internas.
  O rodapé mostra o contador "de fora" para dar visibilidade. (Não bloqueia — ver
  Open questions sobre confirmação.)
- **Parte pronta, parte bloqueada:** botão "Gerar OS" gera as prontas; rodapé mostra
  quantas ficam de fora; as bloqueadas seguem internas.
- **OS já existente para OP/setor** (`already_has_os`): OP fica desabilitada na
  lista (comportamento atual mantido); reprocessar não duplica (`uq_os_per_op_sector`).
- **Durante carregamento das linhas / durante geração:** botão final desabilitado
  (evita clique em estado incompleto ou duplo-disparo).
- **Voltar ao passo "Pedido"** (quando disponível) e trocar de PV zera as escolhas
  (comportamento atual, [linhas 79–85](src/components/contractors/GenerateServiceOrdersWizard.tsx:79)) — mantém.

## Constraints & assumptions
- **Stack/convenções:** React + shadcn, ícones `@phosphor-icons/react`, `sonner`
  para toast, tokens de design (sem cores hardcoded), pt-BR na UI. Seguir o padrão
  do próprio arquivo.
- **Typecheck canônico:** `bunx tsc -p tsconfig.app.json --noEmit` deve passar.
- **Sem migration** — o motor SQL já aceita geração parcial/vazia.
- **Assumção (usuário deixou implícito):** "Prosseguir" é uma saída limpa, sem
  efeito colateral no banco — funcionalmente equivale a fechar o assistente, mas com
  rótulo explícito + toast para dar segurança ("eu decidi fazer interno"). `onGenerated`
  **não** é chamado no "Prosseguir" (nada mudou para reprocessar); só em "Gerar OS".
- **Assumção:** sem modal de confirmação no "Prosseguir" (ação não destrutiva e
  reversível — basta reabrir o assistente). Registrado em Open questions.
- **Rótulos:** usar exatamente **"Prosseguir"** (palavra do usuário) para o caso
  tudo-interno e **"Gerar OS"** para o caso com terceirização (pode manter a
  contagem: "Gerar N OS").

## Open questions
- Quando o usuário **marcou OPs mas não escolheu contratada** e clica "Prosseguir",
  vale um aviso leve ("Você marcou N OPs sem contratada — elas ficarão internas.
  Prosseguir?") ou o contador no rodapé já basta? *Default assumido: só o contador,
  sem modal.*
- O passo "Pedido" deve continuar visível no stepper quando aberto pelo PV (para
  permitir trocar de PV voltando), ou some de vez nesse contexto? *Default assumido:
  mantém acessível voltando, como hoje.*

## Definition of Done
Checklist verificável item a item (rodar o app: PV → "Gerar OS por Pedido").

- [ ] **R1/R2** — Abrir o assistente por um PV, não escolher nenhuma contratada: o
  botão final aparece como **"Prosseguir"** e habilitado; ao clicar, o assistente
  fecha, **nenhuma OS** é criada (verificar em Terceirizados/OS que nada surgiu para
  esse PV) e aparece toast de produção interna.
- [ ] **R3/R4** — Escolher contratada + preço só em um setor e marcar 1 OP: botão
  vira **"Gerar OS"**; ao clicar, cria **apenas** a OS daquele setor; os demais
  setores não têm OS. Confirmar na lista de OS.
- [ ] **R5** — O stepper mostra **2 passos** (Pedido, Serviços e OPs); **não existe
  mais** o passo "Revisão"; abrindo pelo PV o assistente já cai em "Serviços e OPs".
- [ ] **R6** — O rodapé da tela de serviços exibe, ao vivo, nº de OS, total de pares,
  total R$ e o contador de linhas "de fora"; ao marcar/desmarcar setores/OPs o
  resumo atualiza.
- [ ] **R7** — Com o PV carregado e nada marcado, o botão final está habilitado
  ("Prosseguir"); durante carregamento/geração ele fica desabilitado.
- [ ] **R8** — Gerar OS para um setor, reabrir o assistente e tentar de novo o mesmo
  setor/OP: não duplica (OP aparece como já gerada / resultado "exists").
- [ ] **R9** — Abrir pelo hub Terceirizados (sem PV): passo "Pedido" aparece,
  escolhe PV, "Continuar" → "Serviços e OPs" com o mesmo botão adaptativo
  (Prosseguir / Gerar OS).
- [ ] **Build/typecheck** — `bunx tsc -p tsconfig.app.json --noEmit` limpo e
  `npm run check:tokens` sem violações novas.
