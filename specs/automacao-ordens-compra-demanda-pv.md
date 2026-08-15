# Automação de Ordens de Compra por Demanda de Pedidos de Venda

> Especificação fechada por entrevista em 15/08/2026.
>
> Escopo: demanda automática originada por pedidos de venda confirmados, aprovação,
> documento PDF, recebimento e reflexo financeiro. Compras manuais e reposição por
> estoque mínimo continuam como fluxos separados.

## Goal

Garantir que todo pedido de venda confirmado tenha seus materiais avaliados em segundo
plano e que qualquer falta real gere automaticamente uma ordem de compra rastreável,
consolidada por fornecedor e quinzena, pronta para aprovação do Administrador e programada
para chegar antes do início da produção.

O fluxo deve proteger simultaneamente três resultados: a fábrica não começar sem material,
o mesmo material não ser comprado duas vezes e as datas/parcelas da compra aparecerem
corretamente no fluxo de caixa.

## Background / Problem

O sistema já possui consumo por PV, reservas, MRP, geração de OC, capacidade produtiva,
recebimento parcial e contas a pagar, mas hoje esses recursos não formam uma transação
confiável de ponta a ponta:

- A aprovação do PV grava o novo status e depois tenta gerar OCs no navegador
  (`src/hooks/useSaleOrders.ts`). Se a aba fechar ou o JavaScript falhar, o PV fica aprovado
  sem que a compra seja criada.
- Os geradores atuais podem adicionar itens até em OC aprovada, não separam mês/quinzena e
  não guardam a contribuição individual de cada PV. Cancelar um PV consolidado pode cancelar
  a OC inteira ou deixar quantidade antiga.
- Os motores divergem ao descontar estoque, reservas e compras em trânsito; alguns não
  descontam OC alguma e outro desconta a quantidade integral mesmo após recebimento parcial.
- Há mais de uma interpretação da semana de faturamento: primeiro dia exibido, segunda-feira
  anterior e sexta-feira. A regra desta feature exige uma única data-base.
- Lead time e margem de material são hoje subtraídos como dias úteis. A decisão de negócio é
  usar calendário fabril somente na produção e dias corridos para fornecedor/preparo.
- Aprovação, recebimento, estoque e financeiro são caminhos parcialmente independentes. Um
  recebimento parcial pode atualizar estoque sem corrigir vencimentos ou sem criar o vínculo
  financeiro estrutural da entrega.
- O download em lote atual abre impressões agrupadas; não entrega um ZIP com um PDF por OC.

## Autoridade e relação com especificações anteriores

Esta especificação é a fonte de verdade para **OCs automáticas originadas por PV** e
substitui, somente nesse recorte, decisões conflitantes de specs anteriores:

- Em `specs/alinhamento-motores-consumo-compras-ondas.md`, a geração por clique e a âncora no
  setor consumidor são substituídas por geração automática após confirmação e por cronograma
  retroativo ancorado no primeiro dia da semana de faturamento. A paridade do motor de
  consumo e as regras de unidades continuam válidas.
- Em `specs/remodelagem-criacao-ordem-de-compra.md`, o carrinho continua válido para compras
  manuais/necessidades não originadas por esta automação. A origem `pv_automatico` é uma
  exceção explícita: ela materializa diretamente uma OC em `Aguardando aprovação`.
- A proibição anterior de imprimir rascunho não vale para a OC automática provisória:
  ela pode gerar PDF, sempre identificada como **Provisória — Sem fornecedor** e nunca como
  documento aprovado.
- Alçadas existentes podem continuar nos fluxos manuais. As OCs desta automação só podem
  ser aprovadas ou suspensas por Administrador.
- As regras canônicas de consumo, variante de material, solado por grade, conversão
  dm²→unidade física e inexistência de perda de corte permanecem inalteradas.

## Scope

### In scope

- Processamento assíncrono e idempotente após confirmação/aprovação do PV.
- Reprocessamento por edição, cancelamento, mudança de faturamento e mudanças relevantes de
  estoque, cadastro, capacidade ou compras em trânsito.
- Consumo canônico, estoque/reservas, compras já aprovadas e recebimentos parciais.
- Cronograma produtivo retroativo por capacidade compartilhada e calendário da fábrica.
- Lead time do fornecedor, preparo por material, data de chegada e data-limite de emissão.
- Uma OC por fornecedor + mês + quinzena, acumulando vários PVs enquanto estiver em
  `Aguardando aprovação`.
- OC provisória para materiais sem fornecedor.
- Quantidade mínima e múltiplo/pacote no grupo e no item, com herança e arredondamento.
- Preço de compra obrigatório, condição de pagamento do fornecedor e travas de aprovação.
- Aba operacional de demandas automáticas em Ordens de Compra.
- Aba exclusiva de aprovação no menu do Administrador, inclusive ações em lote.
- PDF em qualquer estado e ZIP com um PDF por OC.
- Previsão no fluxo de caixa, compromisso após aprovação e reconciliação no recebimento.
- Recebimento parcial integrado a estoque, nota fiscal, vencimentos e preço cadastrado.
- Migração das OCs pendentes existentes, inclusive divisão por quinzena.
- Transferência da configuração de capacidades padrão para Planejamento.

### Out of scope (explicitly not now)

- Automatizar compras manuais ou reposição por estoque mínimo; os dois fluxos permanecem
  separados.
- Escolher entre vários fornecedores, fazer cotação/RFQ ou comparar preço e prazo. A regra de
  domínio desta feature é um fornecedor por material.
- Reprogramar automaticamente a produção quando uma compra estiver atrasada/urgente.
- Alterar a regra de agrupamento ou os layouts das fichas de operador.
- Reintroduzir perda de corte em qualquer motor.
- Enviar automaticamente o PDF ao fornecedor por e-mail/WhatsApp.
- Saneamento retroativo de OCs aprovadas, enviadas ou recebidas; documentos comprometidos não
  serão repartidos nem reescritos pela migração.

## Regras temporais e fórmulas canônicas

### Data-base e quinzena

1. `data_base_faturamento` é o **primeiro dia do intervalo exibido em Semana de
   Faturamento** no PV. Exemplo: `Semana 1 (01/09–04/09)` usa `01/09`.
2. O PV persiste uma única `billing_anchor`. Mês, semana, intervalo exibido e prazo legado
   devem ser derivados dela; se um payload trouxer valores incompatíveis, o servidor rejeita
   a gravação em vez de escolher silenciosamente um deles. Frontend, SQL, OP e OC consomem o
   mesmo resolvedor.
3. `quinzena = 1` quando o dia da `data_base_faturamento` estiver entre 1 e 15;
   `quinzena = 2` quando estiver entre 16 e o fim do mês.
4. A chave de consolidação é `(supplier_id, ano, mês, quinzena)`. Para fornecedor ausente,
   `supplier_id` é substituído por um bucket explícito `sem_fornecedor`.

### Cronograma de produção

5. O sistema parte da `data_base_faturamento` e calcula a produção para trás. A produção deve
   estar concluída antes dessa data: uma etapa final de 1 dia ocupa o último dia fabril
   anterior, não o próprio dia do faturamento.
6. Pedidos confirmados da mesma semana são calculados em conjunto, e suas janelas também
   disputam capacidade com todos os demais PVs/OPs ativos cujas janelas se sobreponham. O
   motor usa uma grade global determinística por setor/dia; não concede a mesma capacidade
   duas vezes só porque os pedidos faturam em semanas diferentes.
7. Carga de referências com produtividades diferentes é medida por esforço de setor
   (`quantidade ÷ capacidade_da_referência_no_setor`), e não pela soma cega de pares. A
   prioridade é: menor `billing_anchor`, depois confirmação mais antiga, depois número do PV.
   Precedência e paralelismo do roteiro canônico continuam válidos.
8. Capacidade efetiva por setor: valor válido da ficha técnica → padrão da categoria em
   `default_lead_times` → padrão `Geral`. Referência com ficha incompleta não pode sumir do
   cálculo. `default_lead_times.Geral` é o único fallback global desta feature; não criar uma
   terceira fonte concorrente.
9. A produção usa somente dias em que a fábrica está aberta, conforme a fonte canônica
   `is_business_day`: feriados fechados são pulados e sábados/dias excepcionais marcados como
   produtivos são contados.
10. Lead time do fornecedor e preparo do material usam **dias corridos**, inclusive fins de
   semana e feriados.
11. O cronograma usado por Compras é o mesmo calendário oficial consumido pelo Planejamento
    de Produção. Esta feature recalcula/projeta datas, mas não muda automaticamente prioridade,
    estado ou alocação confirmada de OP; divergência entre “data de compra” e “início oficial”
    não é permitida.

### Datas de material

Para cada contribuição material × PV:

```text
inicio_producao       = cronograma_retroativo(data_base_faturamento, carga, capacidades)
data_necessaria       = inicio_producao - preparo_material_dias_corridos
data_limite_emissao   = data_necessaria - lead_time_fornecedor_dias_corridos
```

- `preparo_material_dias`: valor do item; sem valor legado, usar 2.
- `lead_time_fornecedor_dias`: valor positivo do fornecedor; fornecedor ausente, vazio,
  nulo ou zero usa 15.
- O antigo `lead_time_buffer_material_dias` de ficha/categoria não pode ser somado novamente
  nesta feature; isso contaria o preparo duas vezes.
- No cabeçalho da OC consolidada, as datas são as mais críticas (menores) entre as linhas.
  Cada linha preserva suas datas e origens próprias.
- Convenções de fronteira: preparo 0 permite chegada no próprio início da produção; uma
  emissão em D com lead time 15 tem ETA em D+15; portanto `data_limite_emissao =
  data_necessaria - 15`. A criticidade muda somente depois de a data correspondente passar.

### Criticidade derivada

Criticidade é um badge derivado e **não substitui** o estado de ciclo de vida. Uma OC pode
estar simultaneamente `Aguardando aprovação` e `Atrasada`.

- **Normal:** a data-limite de emissão ainda não passou.
- **Atrasada:** `hoje > data_limite_emissao`, mas `hoje <= data_necessaria`.
- **Urgente:** `hoje > data_necessaria` e ainda existe saldo não recebido.

Os nomes acima são deliberadamente nessa ordem, conforme decisão do usuário; não inverter.

### Quantidade de compra

12. `necessidade_bruta` vem do motor canônico de consumo por PV/grade, nunca de uma cópia
    simplificada no frontend. Para OP já iniciada, reserva própria ativa e débito/consumo
    confirmado daquela origem representam material já atendido; uma baixa hard não pode
    reaparecer como nova falta.
13. A cobertura física usa uma fórmula de conservação única:

```text
atendido_origem = min(necessidade_bruta,
                      reserva_propria_ativa + consumo_proprio_confirmado)
estoque_livre   = max(0, quantity - soma_de_todas_as_reservas_ativas)
cobertura_fisica = min(necessidade_bruta,
                       atendido_origem + estoque_livre_alocado)
```

    A reserva própria não permanece dentro de `estoque_livre` e, portanto, nunca é somada
    duas vezes. `consumo_proprio_confirmado` vem de movimento/snapshot estruturalmente ligado
    ao PV/OP, não de texto livre.
14. A cobertura inbound considera saldo de OCs `approved`, `sent` e `parcial` com ETA até a
    data necessária: somente `quantity - received_quantity`, convertido da unidade de compra
    para estoque. `receiving` é estado transitório de uma operação de entrada e não uma fonte
    adicional de quantidade.
15. Inbound sem ETA explícita usa a ETA congelada na aprovação (`approved_at + lead_time
    snapshot`). Se nem ela puder ser calculada, não cobre demanda datada e aparece como
    pendência; uma previsão ausente nunca vira cobertura silenciosa.
16. OCs provisórias, suspensas ou apenas aguardando aprovação não são estoque em trânsito.
    Suas contribuições persistidas impedem duplicação dentro da própria fila automática e
    são saída, nunca entrada, do mesmo recálculo.
17. Estoque e inbound são alocados por produto/cor/grade, primeiro às necessidades de data
    mais próxima, com ordenação estável. Devem valer os invariantes `soma(cobertura) <=
    estoque_livre + inbound_elegível` e saldo por numeração nunca negativo.
18. O lock/alocação deve serializar por produto/cor/grade, além da chave da OC. Workers de
    fornecedores ou quinzenas diferentes não podem prometer o mesmo estoque/inbound.
19. O worker persiste a falta crua de cada contribuição, mas aplica conversão, mínimo e
    múltiplo **uma única vez depois de somar a linha consolidada** por produto/fornecedor/
    bucket. Duas contribuições de 2 e 3 com pacote 5 geram 5, nunca 10.
20. A quantidade final é calculada na unidade de compra:

```text
falta_consolidada   = soma(faltas_cruas_alocadas_das_contribuições)
quantidade_compra   = conversao_estrita(falta_consolidada, unidade_estoque -> unidade_compra)
quantidade_minima   = max(quantidade_compra, minimo_efetivo)
quantidade_final    = ceil_para_proximo_multiplo(quantidade_minima, multiplo_efetivo)
```

21. O arredondamento deve mostrar a explicação na UI e no detalhe: por exemplo,
    `falta 28 m → pacote 5 m → comprar 30 m`.
22. Solados preservam a grade. Pacote com grade fixa usa a composição cadastrada; sem grade
    fixa, pares extras são distribuídos proporcionalmente pela grade demandada usando maior
    resto e desempate pela menor numeração. A distribuição extra é armazenada separadamente
    como `rounding_extra_grade`, não atribuída ficticiamente a um PV, e a soma da grade deve
    ser exatamente a quantidade da linha no PDF, inbound e recebimento.

## Requirements

### A. Gatilho, fila e idempotência

1. Rascunho de PV não gera demanda. A entrada ocorre somente quando o PV chega a um estado
   confirmado/aprovado para produção.
2. A confirmação deve registrar, na mesma transação, uma solicitação durável de recálculo.
   A geração da OC não pode depender da aba do navegador continuar aberta.
3. O processamento será em segundo plano imediato. A UI mostra `Calculando demanda` e o
   objetivo operacional é aparecer em até 60 segundos; esse SLA é pressuposto técnico
   ajustável sem mudar a regra de negócio.
4. Cada PV possui revisão/hash server-side incrementado na mesma transação de qualquer mudança
   relevante. Existe também uma revisão do calendário global de capacidade; mudar uma carga
   ou capacidade invalida todos os PVs cujas janelas possam ter sido deslocadas.
5. A fila deve ter tentativas automáticas e claim concorrente seguro (o padrão atual
   `FOR UPDATE SKIP LOCKED` ou mecanismo equivalente), idempotência por revisão do PV e locks
   ordenados por produto/cor/grade e chave de consolidação. Um retry ou dois workers nunca
   podem duplicar cobertura, contribuição ou OC.
6. Falha permanente deixa o job em `Erro`, registra mensagem técnica/correlação, notifica o
   Administrador e oferece `Reprocessar`. O PV continua confirmado; o erro não fica oculto.
7. Devem marcar demanda como desatualizada: confirmação, edição/cancelamento do PV, mudança de
   item/quantidade/variante/semana; mudança de ficha/capacidade/default; mudança de fornecedor,
   preço, mínimo, múltiplo, preparo, lead time ou condição; estoque/reserva relevante; e
   aprovação, cancelamento ou recebimento de uma OC inbound.
8. O worker recalcula a verdade atual e faz upsert/delete; não acumula deltas cegamente. Antes
   do commit, relê as revisões. Jobs obsoletos descartam o resultado sem escrever.
9. Aprovação e worker adquirem os mesmos locks na mesma ordem, bloqueiam a linha da OC e
   revalidam ausência de revisão pendente. Um PV que toca vários fornecedores ordena as chaves
   antes de bloquear para evitar deadlock.
10. Escritas do próprio worker carregam `correlation_id/origin` e só reenfileiram quando mudam
    uma entrada semântica do cálculo; saída idêntica não gera loop nem nova notificação.

### B. Demanda rastreável e consolidação

11. Cada quantidade automática deve ter contribuição normalizada por PV, item do PV,
   material/cor/grade, fornecedor, datas, mês e quinzena.
12. A contribuição ativa recalculável é versionada separadamente do snapshot comprometido
    por uma OC aprovada. Histórico aprovado nunca é sobrescrito pela “verdade atual”.
13. A tela e o PDF mostram os números dos PVs que originaram cada linha.
14. Mesmo fornecedor e mesma quinzena/mês compartilham uma única OC enquanto ela estiver em
    `Aguardando aprovação`, ainda que a demanda venha de vários PVs.
15. Pedidos de quinzenas ou meses diferentes sempre geram OCs diferentes.
16. Depois que a OC for aprovada, suspensa, enviada ou entrar em recebimento, ela deixa de ser
    alvo de agregação. Nova falta cria/usa outra OC elegível.
17. Mudança/cancelamento do PV remove sua contribuição de OC provisória/aguardando aprovação.
    Se não restar origem para uma linha, a linha é removida mesmo que tivesse ajuste manual;
    se a OC ficar vazia, é cancelada automaticamente com motivo auditável.
18. Se ainda restar demanda e a sugestão mudar, ajustes manuais finais são preservados e a UI
    mostra a divergência entre `sugerido atual` e `valor final`.
19. Se a semana mudar para outra quinzena, a contribuição é movida para a OC da nova chave e
    retirada da antiga, sem duplicação.

### C. Fornecedor e OC provisória

20. A automação exige **um fornecedor efetivo por material**. Na migração, vínculo explícito
    do item vence; um único vínculo legado inequívoco de grupo/preferência pode ser promovido
    ao campo canônico. Conflito ou ausência não é resolvido por preço/prazo: vira pendência.
    Depois da migração, todos os motores consomem o mesmo FK canônico.
21. Material sem fornecedor entra em uma OC **Provisória — Sem fornecedor**, separada por
    mês/quinzena, com lead time calculado em 15 dias corridos.
22. A OC provisória pode ser visualizada e baixada em PDF, mas não pode ser aprovada, enviada
    nem virar compromisso financeiro.
23. Ao cadastrar fornecedor no material, o item sai automaticamente da provisória e entra na
    OC `Aguardando aprovação` daquele fornecedor/mês/quinzena, fundindo-se com ela se existir.
24. A aprovação fica bloqueada enquanto houver qualquer linha sem fornecedor.

### D. Cadastros de grupo, item e fornecedor

25. O grupo de material terá padrões positivos para `quantidade mínima de compra` e
    `múltiplo/tamanho do pacote`, ambos interpretados na unidade de compra dos itens.
26. Padrão de grupo só pode ser aplicado quando seus materiais compartilham a mesma unidade de
    compra; grupo heterogêneo exige valores explícitos em cada item.
27. Ao selecionar o grupo na criação, os valores aparecem pré-preenchidos e **são persistidos
    no novo item**. O usuário pode alterá-los antes de salvar. A herança dinâmica item→grupo
    existe apenas como fallback de legado até o item ser regularizado; mudança futura do grupo
    não altera silenciosamente itens já criados.
28. Nenhum material comprável novo pode ser salvo sem mínimo e múltiplo próprios positivos.
    Interfaces, RPCs, imports e criações rápidas devem obedecer à mesma validação server-side.
29. O “mínimo do fornecedor” desta regra é o mínimo específico item/grupo na unidade de compra.
    O campo global `suppliers.min_order_quantity`, sem unidade, não participa do cálculo.
30. Cada material terá `preparo_material_dias` inteiro não negativo: `NULL` legado vira 2 e
    zero é válido. Alteração recalcula apenas OCs ainda não aprovadas.
31. Todo produto terá `procurement_type = purchased | internal | artisanal`. Material
    `purchased` novo exige preço de compra, mínimo e múltiplo válidos; internal/artisanal não
    entra em OC.
32. Criar `products.purchase_price` como último preço por `purchase_unit`, separado de
    `products.unit_price`/custo médio por unidade de estoque. A OC usa `purchase_price`; no
    backfill, só derivar do custo atual quando unidade e conversão forem válidas e auditáveis.
    Preço ausente em legado bloqueia aprovação, sem inventar valor.
33. A aprovação congela preço, unidade de compra e fator de conversão da linha. Alterar o
    cadastro depois não reprecifica documento aprovado.
34. Fornecedor sem lead time válido usa fallback 15. A condição de pagamento deve ser válida e
    estruturada em parcelas (dias + percentuais que somam 100%); texto livre pode ser mantido
    só para exibição. A aprovação bloqueia condição vazia/ininterpretável e salva seu snapshot.
35. Os conceitos concorrentes de lead time do produto/fornecedor devem ser reconciliados;
    esta automação usa o lead time do fornecedor e não um override silencioso do item.
36. A área de pares/dia de `default_lead_times` será movida de Produção → Análises para a aba
    **Capacidades padrão** em Produção → Planejamento. Ela edita capacidades por setor/categoria
    e `Geral`; não expõe o buffer antigo como preparo do material. Rotas antigas redirecionam,
    o editor duplicado deixa de escrever e campos fixos legados ficam depreciados/somente
    leitura até remoção própria.

### E. Estados, aprovação e auditoria

37. Estados mínimos da origem automática:
    - `draft` → label **Provisória — Sem fornecedor**;
    - `pending` → label **Aguardando aprovação**;
    - `suspended` → label **Suspensa**;
    - `approved` → aprovada e congelada;
    - `sent` → enviada ao fornecedor;
    - `receiving` → lock transitório durante a transação de entrada;
    - `parcial` → ao menos um recebimento confirmado e saldo ainda aberto;
    - `received` e `cancelled` → terminais.
38. Somente Administrador pode aprovar, suspender, reabrir ou alterar valores finais de uma
    OC automática. Usuários autorizados de Compras podem consultar e baixar PDFs.
39. Aprovação e suspensão são sempre da OC inteira, nunca apenas de algumas linhas.
40. A aba do Administrador permite seleção múltipla e aprovação/suspensão em lote. Cada OC é
    transacionada de forma atômica; uma inválida não desfaz as válidas e o resultado lista
    sucessos/falhas. Na suspensão em lote, um motivo comum é obrigatório e fica copiado no
    histórico individual de cada OC.
41. Suspender é a rejeição explícita do Administrador e exige motivo, autor e data. Falta de
    preço/condição/conversão apenas mantém a OC em `Aguardando aprovação` com bloqueio; não a
    suspende automaticamente. Exceção: legado ambíguo pode ser migrado já Suspenso.
42. Contribuições de uma OC suspensa ficam `blocked_by_suspension`: mudanças do PV atualizam a
    demanda sombra, mas não as linhas comerciais suspensas e não criam cópia da mesma origem.
    Nova demanda independente pode formar outra OC pendente.
43. Suspensa só volta por ação do Administrador. Se já existir uma OC `pending` da mesma chave,
    a reabertura mostra a reconciliação e funde contribuições/linhas na pendente; a suspensa é
    marcada como substituída/cancelada com auditoria. Nunca coexistem duas pendentes da chave.
44. Antes de aprovar ou reabrir, o Administrador pode editar fornecedor, quantidade, preço e
    datas. A tela mantém lado a lado o valor calculado e o valor final, com autor/data/motivo
    de cada alteração.
45. Alterar o fornecedor de OC automática exige confirmação e atualiza o fornecedor canônico
    dos materiais afetados na mesma transação; em seguida move/funde a OC na chave correta. Não
    é permitido manter cabeçalho e cadastro do material divergentes.
46. Quantidade manual inválida não é aceita: ao salvar, o sistema a eleva para cobrir a falta,
    o mínimo e o próximo múltiplo permitido, explicando o ajuste.
47. Aprovação é bloqueada se faltar fornecedor, item, preço positivo, condição de pagamento,
    unidade/conversão válida ou se houver recálculo pendente para aquela chave.
48. No instante da aprovação, cabeçalho e itens comerciais ficam congelados. Mudança posterior
    de PV, cadastro ou demanda nunca altera a OC aprovada; gera outra necessidade/OC.
49. Toda criação, contribuição, recálculo, ajuste manual, suspensão, reabertura, aprovação,
    envio, recebimento e cancelamento terá trilha de auditoria consultável.

### F. Telas, alertas e documentos

50. Ordens de Compra ganha uma aba **Demandas automáticas** sem substituir as abas/fluxos de
    compra manual e estoque mínimo.
51. A aba mostra fornecedor, mês/quinzena, PVs, itens, quantidade sugerida/final, datas,
    criticidade, estado, total, bloqueios de cadastro e estado do job, com filtros equivalentes.
52. O menu do Administrador ganha uma aba exclusiva **Aprovação de Ordens de Compra** com
    contador de pendentes.
53. Nova OC e transição para `Atrasada`/`Urgente` geram notificação interna idempotente; o
    mesmo evento não pode notificar repetidamente em cada refresh.
54. Qualquer estado pode gerar um arquivo binário `application/pdf` baixável, não apenas abrir
    `window.print`. Provisória, Aguardando aprovação e Suspensa exibem faixa textual inequívoca
    de que o documento não está aprovado.
55. O PDF inclui: número/status/criticidade da OC; fornecedor e contatos; mês/quinzena; datas
    de emissão e chegada; condição de pagamento; endereço de entrega; itens com cor/grade,
    unidade, quantidade, preço e total; PVs de origem; observações e aprovação quando houver.
56. A versão aprovada preserva snapshot/hash e artefato PDF versionado imutável do conteúdo
    comercial. Mudanças de estado posteriores podem mudar a identificação visual em nova
    renderização, mas não itens/valores aprovados nem o arquivo oficial daquela versão.
57. Download em lote gera um único ZIP, com um PDF por OC e nomes de arquivo estáveis, sem
    abrir várias janelas de impressão.

### G. Fluxo de caixa, recebimento e estoque

58. Existem três camadas financeiras sem sobreposição:
    - `forecast`: OC `Aguardando aprovação`, projeção analítica ancorada na data planejada de
      emissão; não cria `accounts_payable`;
    - `committed_unbilled`: OC aprovada, compromisso efetivo ancorado na emissão/aprovação;
    - `invoiced`: valor já coberto por NF de recebimento, com vencimentos efetivos.
59. Na aprovação, a previsão sai do bucket forecast e vira parcelas
    `committed_unbilled`, usando o snapshot estruturado da condição, preço, unidade e fator.
60. OC provisória ou suspensa não entra como compromisso; a suspensa pode permanecer visível
    em análise separada de risco, sem somar no caixa confirmado.
61. O recebimento pede a data de emissão da NF do fornecedor, número/chave da nota, quantidades
    e preços efetivos. Antes de confirmar, mostra os novos vencimentos calculados pela condição
    salva na OC e permite ajuste manual auditado; mudança posterior no fornecedor não reescreve
    o documento.
62. Recebimento parcial é obrigatório: somente a quantidade/grade recebida entra no estoque.
    A parcela correspondente é convertida de `committed_unbilled` para `invoiced`; o saldo
    físico e financeiro continua como compromisso aberto.
63. Cada recebimento parcial pode ter sua própria NF, data e vencimentos. Em qualquer visão do
    caixa, `valor_total_aberto = committed_unbilled_remanescente + invoiced_em_aberto`; forecast
    é exibido em camada separada e nunca somado novamente.
64. Estoque, `stock_movements`, saldo recebido do item/grade, documento de recebimento e reconciliação
    financeira são confirmados de modo transacional e idempotente.
65. Se o preço da NF diferir da OC, o recebimento atualiza `products.purchase_price` com o
    último preço real por unidade de compra e recalcula `products.unit_price` pelo método de
    custo médio existente, sem misturar as duas semânticas.
66. Contas a pagar e movimentos de estoque terão FKs estruturais para OC/recebimento; token em
    texto ou observação pode continuar apenas para exibição, não como vínculo de integridade.

## Data model / Domain

Os nomes abaixo são lógicos; na implementação, reutilizar colunas existentes quando a
semântica for idêntica e criar migration quando não for.

### Entidades existentes reutilizadas

- `sale_orders`, `sale_order_items`: status, `billing_week`, mês/semana e itens/grade.
- `technical_sheets`, `default_lead_times`, `holidays`: roteiro, capacidade e calendário.
- `products`, `product_groups`, `suppliers`: material, grupo, fornecedor, preço, unidade,
  mínimo, múltiplo, lead time e condição.
- `material_reservations`, `products.quantity`, `stock_grade`: cobertura física.
- `purchase_orders`, `purchase_order_items`, `purchase_order_approvals`: documento e aprovação.
- `accounts_payable`, `stock_movements`: financeiro e razão de estoque.

### Campos/cadastros a consolidar

- `product_groups.min_order_quantity` — novo padrão do grupo.
- `product_groups.purchase_multiple` — reutilizar, validando valor positivo.
- `products.min_order_quantity` / `products.purchase_multiple` — valores próprios positivos
  persistidos na criação; grupo é prefill e fallback temporário de legado.
- `products.material_preparation_days` — default/backfill 2.
- `products.procurement_type` — `purchased | internal | artisanal`.
- `products.supplier_id` (ou FK canônico equivalente após migração) — um fornecedor efetivo.
- `products.purchase_price` — último preço positivo por `purchase_unit`, separado do custo
  médio `unit_price` por unidade de estoque.
- `suppliers.lead_time_days` — fonte do prazo.
- condição de pagamento normalizada (parcelas com dias/percentuais) — fonte para snapshot;
  `suppliers.payment_terms` textual pode continuar como label.

### Fila e contribuições

Criar estrutura equivalente a:

```text
purchase_demand_jobs
  id, sale_order_id, sale_order_revision, schedule_revision,
  status, attempts, available_at,
  started_at, finished_at, last_error, correlation_id, created_at, updated_at

purchase_demand_contributions
  id, sale_order_id, sale_order_item_id, product_id,
  supplier_id, billing_anchor, billing_year, billing_month, billing_fortnight,
  gross_qty_stock, own_reserved_qty, own_consumed_qty,
  allocated_free_stock_qty, allocated_inbound_qty, raw_shortage_stock_qty,
  purchase_unit, grade, color, demand_state,
  production_start_date, required_arrival_date, purchase_by_date,
  purchase_order_id, purchase_order_item_id, calculation_revision,
  created_at, updated_at
```

- A chave natural deve impedir duas contribuições ativas da mesma revisão/origem/material.
- Contribuições apontam estruturalmente para a linha da OC; não depender apenas de
  `linked_sale_order_ids` no cabeçalho.
- `demand_state` distingue `active`, `blocked_by_suspension`, `committed_snapshot` e
  `fulfilled`; snapshot aprovado é append-only.
- Uma constraint/índice parcial garante no máximo uma OC automática elegível por
  fornecedor/bucket no estado `pending` e uma provisória por bucket.
- O calendário oficial possui revisão global; agenda/alocação por produto e setor mantém
  invariantes de conservação e ordenação determinística.

### OC e item

Campos adicionais/equivalentes:

- Origem `source_type = 'pv_automatico'`.
- `billing_year`, `billing_month`, `billing_fortnight`.
- `required_arrival_date` e `purchase_by_date` no item; mínimos derivados no cabeçalho.
- `payment_terms_snapshot` estruturado e parcelas previstas.
- `system_raw_shortage`, `system_suggested_quantity`, `quantity` final,
  `system_unit_price`, flags/motivo de override e `rounding_extra_grade`.
- Snapshot de `purchase_unit`, unidade de estoque e fator de conversão na aprovação.
- Estado `suspended`, `suspended_by`, `suspended_at`, `suspension_reason`.
- Versionamento otimista (`version`/`updated_at`), snapshot/hash da aprovação e referência ao
  artefato PDF oficial versionado.

### Recebimento e financeiro

Criar/reutilizar documento normalizado de recebimento com:

```text
purchase_receipts
  id, purchase_order_id, invoice_id/key/number, invoice_issue_date,
  received_at, confirmed_by, status, idempotency_key

purchase_receipt_items
  receipt_id, purchase_order_item_id, quantity, grade,
  unit_price, unit, conversion_factor_snapshot
```

`accounts_payable` e `stock_movements` devem apontar por FK para a OC e, quando aplicável,
para o recebimento. O financeiro diferencia `committed_unbilled` de `invoiced`; cada entrada
parcial converte apenas seu valor, preservando o saldo comprometido e sem dupla contagem.

## User flows

### Happy path

1. Comercial confirma o PV com mês e semana de faturamento.
2. A transação marca a demanda para processamento; a tela mostra `Calculando demanda`.
3. O worker atualiza a grade global de capacidade, combinando pedidos da semana e demais
   janelas sobrepostas; calcula início produtivo, consumo, cobertura, falta crua e datas.
4. Para cada fornecedor + mês + quinzena, cria ou atualiza a OC em
   `Aguardando aprovação`, soma as contribuições e só então aplica mínimo/múltiplo.
5. Compras acompanha a aba Demandas automáticas. O Administrador recebe contador/notificação
   e abre a aba exclusiva de aprovação.
6. O Administrador revisa valores calculados/finais, aprova a OC inteira ou aprova várias.
7. A OC fica congelada, ganha snapshot PDF e vira compromisso no fluxo de caixa.
8. Compras baixa o PDF individual ou seleciona várias OCs e baixa um ZIP.
9. Quando o material chega, informa a NF, recebe total/parcialmente, revisa vencimentos e
   confirma. Estoque e financeiro são reconciliados juntos.

### Material sem fornecedor

1. A falta entra na OC Provisória da quinzena com fallback de 15 dias.
2. O PDF é permitido com identificação de documento provisório; aprovação é bloqueada.
3. O usuário cadastra o fornecedor no material.
4. O worker move a contribuição para a OC pendente correta e remove/cancela a provisória vazia.

### Edição ou cancelamento de PV

1. A mudança enfileira nova revisão.
2. O worker recalcula todas as contribuições afetadas.
3. Em OC provisória/pendente, remove o que deixou de existir e move o que mudou de quinzena.
4. Em OC aprovada, não altera nada; a compra já comprometida segue como inbound e somente uma
   eventual falta adicional gera nova OC.

### Suspensão e correção

1. Administrador informa motivo e suspende a OC inteira, individualmente ou em lote.
2. A OC deixa de receber novas demandas e não conta como compra em trânsito/caixa confirmado.
3. Administrador edita campos finais, vê os valores originais e reabre para aprovação.
4. A reabertura executa todas as validações; se outra OC pendente da chave já existir, mostra e
   executa a fusão em vez de criar uma segunda pendente.

### Recebimento parcial

1. Usuário seleciona a OC e informa NF/data/linhas recebidas.
2. O sistema normaliza unidades e mostra estoque que entrará, preço novo e parcelas recalculadas.
3. Usuário ajusta vencimentos se necessário e confirma uma vez.
4. Só as quantidades/valores recebidos são efetivados; o saldo permanece aberto e continua
   contando como inbound.

## Edge cases & failure modes

- **Dois PVs confirmados simultaneamente para o mesmo fornecedor/bucket** → locks + índice
  único; uma única OC recebe as duas contribuições.
- **Duas quinzenas disputam o mesmo material** → lock por produto/cor/grade e alocação por data;
  o mesmo estoque/inbound não cobre as duas.
- **Retry após timeout** → mesma revisão/idempotency key; nenhum cabeçalho, item, movimento ou
  parcela duplicado.
- **PV muda durante o cálculo** → worker detecta revisão obsoleta, descarta o resultado e
  processa a revisão mais nova.
- **Capacidade muda** → revisão global invalida todas as janelas afetadas, não apenas o PV que
  motivou a alteração.
- **Semanas diferentes com janelas sobrepostas** → grade global compartilha o mesmo setor/dia.
- **Referências com capacidades diferentes** → carga em fração de recurso, sem somar pares como
  se tivessem a mesma produtividade.
- **Data do PV cruza mês/quinzena** → contribuição é movida atomicamente entre OCs pendentes.
- **OC é aprovada enquanto job está rodando** → aprovação bloqueia ou o worker perde o lock;
  nunca editar documento já aprovado.
- **Inbound chega depois da necessidade** → não cobre a falta desse PV; aparece no detalhe para
  explicar por que uma nova compra ainda é necessária.
- **Recebimento parcial** → desconta apenas saldo ainda aberto, convertido corretamente.
- **Reserva do próprio PV** → conta como cobertura dele; não descontar a mesma reserva duas vezes.
- **Débito hard do próprio PV** → movimento/snapshot da origem marca demanda já atendida e não
  vira nova falta após reduzir o estoque.
- **Ficha de componente sem largura** → seguir regra canônica: quantidade não confiável fica
  como pendência de cadastro e não vira aprovação silenciosa de compra ~100× inflada.
- **Ficha técnica/categoria incompleta** → usar padrão Geral e sinalizar a fonte; nunca omitir o
  PV do cronograma.
- **Fornecedor/lead ausente** → provisória e/ou fallback 15, sem apagar a demanda.
- **Preço ou condição ausente** → OC visível, aprovação bloqueada, correção acionável.
- **Mínimo/múltiplo inválido** → criação de item novo bloqueada; legado sinalizado e OC bloqueada
  até regularização.
- **Ajuste manual e demanda cai** → preservar override somente enquanto houver alguma origem;
  origem zero remove a linha.
- **Duas faltas abaixo de um pacote** → agregar falta crua antes do arredondamento; sobra fica
  associada à linha da OC, não a um PV.
- **Arredondamento de solado** → `rounding_extra_grade` conserva total por numeração; soma da
  grade, PDF, inbound e recebimento são idênticos.
- **OC suspensa** → sua demanda fica visível como suspensa e não gera cópias automáticas da
  mesma contribuição; novas contribuições independentes podem formar outra OC pendente.
- **Reabrir suspensa com pendente existente** → fundir e encerrar a suspensa na mesma transação.
- **Lote com uma OC inválida** → demais aprovam; retorno identifica claramente a inválida.
- **ZIP muito grande** → geração mostra progresso, limita lote com mensagem clara e nunca abre
  pop-ups por documento.
- **Recebimento/NF repetido** → chave/idempotência bloqueia segundo crédito de estoque e segunda
  conta a pagar.
- **Recebimento parcial de solado** → saldo e inbound são reconciliados por numeração, não só
  pela quantidade total.
- **Falha financeira após tentativa de estoque** → transação reverte ambos; nunca existir
  entrada física sem o estado financeiro correspondente.
- **Preço de NF em unidade diferente** → conversão estrita; conversão ausente bloqueia o
  recebimento em vez de assumir 1:1.
- **OC legada sem PV rastreável** → não inventar vínculo/quinzena; colocar em Suspensa com motivo
  de migração para revisão humana.
- **Ação do próprio worker dispara trigger** → `correlation_id` e comparação semântica fazem a
  fila convergir; não há loop infinito.

## Migration / rollout

1. Executar relatório read-only de produtos/grupos/fornecedores, OCs pendentes, unidades,
   preços, mínimos, múltiplos, condições e vínculos com PV.
2. Criar campos/tabelas/índices/RLS e o worker sem ainda gerar OCs; como estratégia segura de
   rollout, rodar primeiro em modo sombra (ou validação equivalente) e comparar consumo,
   cobertura, datas e quantidades com casos reais.
3. Backfill `material_preparation_days = 2`. Não inventar preço, fornecedor, condição ou
   embalagem para legado; sinalizar pendências.
4. Consolidar fornecedor canônico: promover vínculo legado apenas quando for único e
   inequívoco; conflitos permanecem sem fornecedor na provisória.
5. Separar `purchase_price` do custo médio. Derivar preço legado somente com unidade/conversão
   comprovadas; demais materiais ficam pendentes.
6. Para mínimo/múltiplo legado, quando todos os itens válidos de um grupo compartilharem
   unidade e valor, a migração pode **propor** o padrão do grupo, mas não gravá-lo sem revisão;
   grupos divergentes permanecem pendentes.
7. Atualizar todos os criadores de material comprável para as novas validações antes de
   endurecer a trava server-side.
8. Migrar OCs `pending` existentes:
   - usar vínculos estruturais/`linked_sale_order_ids` disponíveis;
   - dividir por fornecedor + mês + quinzena;
   - preservar quantidade, preço e total originais, sem arredondar silenciosamente;
   - itens sem origem suficiente ficam Suspensos para revisão;
   - registrar relação documento antigo → documentos novos e auditoria da divisão.
9. Não dividir nem reescrever OCs `approved`, `sent`, em recebimento ou recebidas.
10. Ativar triggers de dirty/outbox e remover a geração dependente do navegador para PV.
11. Corrigir o agregador antigo para nunca anexar em aprovada/enviada e nunca atravessar
   quinzena; fluxos manuais/ROP continuam separados.
12. Mover a tela de capacidades, manter redirects e remover o segundo editor concorrente.
13. Liberar em modo observável, com painel de jobs/erros e rollback que desativa novos
    jobs sem apagar contribuições/documentos já criados.

## Constraints & assumptions

- Stack e padrões do projeto: React Query + Supabase, `sonner`, Phosphor, domínio pt-BR,
  migrations em `supabase/migrations/`, alias `@/` e permissões via `RouteGuard`/RLS.
- Cálculo crítico e autorização ficam no servidor; frontend apenas apresenta e solicita RPCs.
- Unidades canônicas e conversões seguem `src/lib/unitConversion.ts`,
  `src/lib/purchaseMultiple.ts` e os resolvers SQL equivalentes. `conversion_rate = 0` nunca
  vira 1 silenciosamente.
- Necessidade de área usa largura de `component_sheets.dimensions_width`; nenhuma perda de
  corte é aplicada.
- A fila assíncrona pode reutilizar o padrão existente de dirty flag/cron e
  `FOR UPDATE SKIP LOCKED` ou mecanismo transacional equivalente; nomes físicos são decisão de
  engenharia, mas durabilidade/idempotência/concorrência são obrigatórias.
- Datas são armazenadas como `date` para regras de dia; timestamps/auditoria em UTC, exibidos
  em `America/Sao_Paulo`.
- Uma única fonte server-side calcula âncora de faturamento, cronograma, shortage e datas; UI,
  PDF e financeiro consomem os resultados persistidos.
- `purchase_price` (última compra, unidade de compra) e `unit_price` (custo médio, unidade de
  estoque) são conceitos separados e testados separadamente.
- Padrão `Geral` é uma linha canônica de `default_lead_times`, não um novo cadastro paralelo.
- Compras automáticas não reprogramam a fábrica; criticidade apenas alerta.
- Suposição registrada: usuários do setor Compras têm leitura/download das OCs automáticas;
  somente Administrador altera valores finais ou estado de aprovação.
- Suposição técnica registrada: “segundo plano imediato” tem alvo inicial de até 60 segundos;
  telemetria pode ajustar o SLA sem mudar as regras de compra.

## Open questions

Nenhuma decisão de produto permanece aberta para esta versão. Nomes físicos de colunas/RPCs e
o mecanismo concreto do worker podem ser ajustados à descoberta do schema, sem mudar as
semânticas, fórmulas e invariantes acima.

## Definition of Done

- [ ] **Reqs. 1–10:** confirmar um PV cria job durável; fechar a aba não impede a OC; resultado
      atende o alvo de 60 s; revisão obsoleta, retry, dois workers e writes do próprio worker
      não duplicam nem entram em loop.
- [ ] **Reqs. 11–19:** dois PVs do mesmo fornecedor/quinzena formam uma OC; editar/cancelar um
      remove apenas sua contribuição; mudar de quinzena move a contribuição; aprovada não muda.
- [ ] **Regras 12–22 das fórmulas:** reserva própria/alheia, débito hard, inbound parcial/tardio,
      dois buckets concorrentes e duas faltas menores que um pacote conservam estoque e geram
      uma única quantidade arredondada, inclusive área e solado por grade.
- [ ] **Cronograma:** duas semanas com janelas sobrepostas e duas referências de capacidades
      diferentes compartilham corretamente setor/dia; primeiro dia da semana é a âncora,
      produção usa calendário fabril e fornecedor/preparo usam dias corridos.
- [ ] **Criticidade:** testes de fronteira provam Normal → Atrasada → Urgente exatamente nas
      datas definidas, incluindo igualdade, S1 parcial, fim de mês, sábado produtivo e fuso,
      com os termos na ordem decidida.
- [ ] **Reqs. 20–24:** material sem fornecedor cria provisória por quinzena, permite PDF,
      bloqueia aprovação e migra automaticamente para a OC do fornecedor após cadastro.
- [ ] **Reqs. 25–36:** grupo preenche mínimo/múltiplo no novo item e permite alteração; nenhum
      comprado nasce sem campos/preço; preparo usa 2; lead usa 15; preço de compra e custo médio
      ficam separados; condição estruturada e capacidades em Planejamento são verificadas.
- [ ] **Reqs. 37–49:** chamada direta à RPC/RLS prova admin-only; lote, suspensão, fusão ao
      reabrir, edição de fornecedor e auditoria funcionam; aprovação congela o documento.
- [ ] **Reqs. 50–57:** abas operacional/admin, contador, notificações idempotentes, PDFs de
      todos os estados e ZIP com um PDF por OC são verificados em claro/escuro e por usuário.
- [ ] **Reqs. 58–66:** forecast, compromisso e AP aparecem em camadas sem dupla contagem; duas
      NFs parciais (inclusive solado por grade) movimentam apenas seus valores/estoque,
      recalculam vencimentos, atualizam último preço e custo médio separadamente e são
      idempotentes.
- [ ] **Migração:** OCs pendentes rastreáveis são divididas por fornecedor/quinzena preservando
      totais; casos ambíguos ficam Suspensos; nenhuma OC aprovada/enviada/recebida é alterada.
- [ ] Queries de integridade retornam zero: contribuição duplicada; mais de uma OC `pending`
      automática por chave; linha sem origem; aprovado mutado após snapshot; recebimento acima
      do saldo; AP/movimento sem FK; drift de total do cabeçalho versus itens.
- [ ] Testes unitários cobrem datas/quinzenas/calendários, capacidade, netting, unidades,
      mínimo/múltiplo, criticidade e parcelamento; integração cobre disputa do mesmo produto
      entre buckets, aprovação concorrente com worker, reabertura concorrente, mudança global
      de capacidade, PV→OC, parcial por grade e cancelamento.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit`, `bun run test`, `bun run lint` e
      `bun run check:tokens` passam sem regressão nova.
