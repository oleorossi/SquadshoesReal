# Financeiro industrial integrado — execução e verificação

Objetivo do dono (05/09/2026): “Realizar agora a otimização de todo o setor financeiro, integração com estoque, entrada de nota fiscal, integração com ordem de compra, torná-lo o mais completo possível, com foco em indústria.”

Estado: **em execução, não concluído**. Este documento acompanha o objetivo integral; concluir uma etapa não encerra a reforma.

## Fontes e decisões preservadas

- `specs/financeiro-auditoria-e-reforma.md`: decisões anteriores sobre caixa, competência, factoring, NF, folha e fechamento. Os números daquela auditoria são históricos, não prova do estado atual.
- `AGENTS.md`: unidades físicas, conversões, estoque, histórico, permissões e publicação.
- `src/components/purchase/CONTEXT.md`: compra por fornecedor, alçada, grade/cor e recebimento avulso.
- Não aprovar folhas, efetuar pagamentos, vincular NFs a vendas, mudar saldos, reclassificar vendas antigas ou executar backfills históricos automaticamente.
- Recebíveis de factoring são brutos; juros/descontos são despesas separadas. Liquidação não pode cobrar a mesma despesa duas vezes.
- Lançamentos liquidados preservam seus fatos e trilha. Correção de operação deve ser explícita, auditável e atômica, não exclusão do histórico.
- Pedido sem fornecedor é rascunho; não vira compromisso financeiro ou recebimento silenciosamente.

### Decisão solicitada ao dono

A spec financeira diz que a obrigação nasce da NF; o contexto de Compras descreve AP no recebimento da OC. Foi perguntado se OC deve continuar apenas como previsão até a NF ou gerar título no recebimento sem nota. Até a resposta, não mudar esse gatilho nem converter títulos históricos. Em qualquer opção, a chegada posterior do XML nunca pode duplicar o passivo.

## Critérios completos de entrega

| ID | Requisito | Evidência exigida | Estado inicial |
|---|---|---|---|
| F01 | Totais e indicadores reais, período explícito, sem dados fictícios e sem falha de consulta apresentada como zero | testes de cálculo, consulta completa, erro/carregamento e tela | central NF corrigida e validada localmente; demais painéis em auditoria |
| F02 | Compra → recebimento → NF → estoque → AP com vínculo rastreável e única origem financeira | teste de fluxo completo e consulta das FKs/fatos | auditoria |
| F03 | Importação XML atômica e idempotente, inclusive concorrência e retomada após erro | E2E transacional, replay e falha intermediária | falha confirmada no fluxo sequencial atual |
| F04 | Duplicatas, prazos, vencimentos, valores e parcelamento corretos; divergência do total deve ser explícita | fixtures XML e testes de parcelas | auditoria |
| F05 | XMLs em lote com resultado individual e reaproveitamento seguro de documentos duplicados | UI renderizada + teste de reimportação | auditoria |
| F06 | Confronto OC × NF × recebido por item; preço, quantidade, cor, grade, unidade e fornecedor | teste de divergência e conferência parcial | auditoria |
| F07 | Recebimento parcial, saldo a entregar, múltiplas NFs por OC e rastreio de itens | testes de parcelas de recebimento e saldos | auditoria |
| F08 | Entrada física e custo respeitam unidade-base, conversão e despesas do documento; nenhum ajuste de área indevido | testes unitários/SQL e trilha de estoque | auditoria |
| F09 | Cancelamento/devolução/estorno preservam documento e conciliam estoque, OC e financeiro sem duplicar movimento | E2E de reversão e bloqueios | auditoria |
| F10 | Liquidações financeiras parciais/integral/lote com fatos por data, conta bancária, idempotência e concorrência | E2E com pagamentos em meses distintos | falha de histórico por data identificada |
| F11 | Conciliação OFX real, FITID por conta, reimportação segura, texto como fallback e confirmação humana | fixtures OFX + replay + UI | leitor puro implementado; persistência/baixa/UI ainda pendentes |
| F12 | Conciliação única e navegação coerente, sem dois motores divergentes | testes de rotas e do componente compartilhado | auditoria |
| F13 | Factoring: previsão de crédito, confirmação assistida em lote, despesa única e confronto com banco | testes de bruto/líquido, datas e replay | auditoria; data-base antiga ainda exige validação |
| F14 | Receita, AR e documento fiscal coerentes; receita reversível não sobrevive sozinha ao bloqueio do gate | paridade TS/Edge e testes de status | guard TS/Edge corrigido; integração transacional e CMV/factoring pendentes |
| F15 | Triagem assistida de NF saída órfã e pendência fiscal visível; nunca casar automaticamente por valor | testes de candidatos/vínculo/concorrência | auditoria; triagem histórica exige usuário |
| F16 | Informais fora dos indicadores fiscais reconhecidos, mas visíveis em relatório próprio | teste de exclusão e relatório | auditoria; reclassificação histórica não automática |
| F17 | Folha e terceirização integradas com AP sem duplicação; aprovação e pagamento distintos | teste de aprovação, parcelas e reconciliação | auditoria; não aprovar períodos antigos |
| F18 | Caixa realizado, fluxo projetado, compromissos de compra e DRE competência separados e reconciliáveis | cenários mensais, parciais e prova de origens | auditoria |
| F19 | CMV e margem industriais sem contar compra de matéria-prima e consumo duas vezes | teste compra/estoque/produção/venda e paridade SQL | auditoria |
| F20 | Fechamento com pendências acionáveis de NF, OC, estoque, AP/AR, banco e folha; estados vazios explícitos | testes de cada pendência e UI | não localizado na auditoria inicial |
| F21 | Plano de contas, centros de custo, orçamento, imobilizado, anexos e cobrança úteis, sem superfícies que prometem e não executam | inventário funcional + testes; recursos avançados preservados | auditoria |
| F22 | Permissões reais nas operações financeiras e de estoque, trilha de auditoria, impossibilidade de bypass por payload | SQL negativo por papel e testes de autorização | auditoria |
| F23 | Desempenho: paginação completa, ausência de consultas pesadas desnecessárias e invalidação de cache correta | testes de >1 página, erro e atualização dos indicadores | AP/AR e resumo NF paginados; demais consumidores em auditoria |
| F24 | Publicação main/banco/backend/Vercel do mesmo commit e verificação operacional sem movimentar dados reais de teste | CI, logs do deploy, consultas e navegador | pendente |

## Sequência por dependência

1. Indicadores verdadeiros e correção do gate de receita; inventário atualizado e diagnóstico.
2. Contrato atômico de entrada documental e confronto com compra/estoque/AP.
3. Fatos de liquidação e conciliação bancária idempotente.
4. Factoring, folha/terceirização, CMV, caixa e competência sobre os fatos corrigidos.
5. Fechamento, rastreabilidade, relatórios industriais e recursos avançados.
6. Revisão completa, teste transacional de todas as integrações, publicação e conferência em produção.

## Evidência inicial (05/09/2026)

- Baseline: main `ab61f7c7c76553160582908a9a3876f5ac9c2688`, worktree inicialmente limpa.
- A central `UnifiedInvoicesTab.tsx` continha R$ 45.230, R$ 128.450 e R$ 15.414 fixos, sem consulta; imposto genérico de 12% também fixo.
- Banco: quatro NFs de entrada importadas, R$ 5.159,16, emissão entre março e julho. Os indicadores fixos não correspondiam ao dado real.
- NFs de saída: 47 autorizadas; 45 não informam ambiente SEFAZ e duas informam produção. Homologação conhecida deve ser excluída; o legado não deve ser reclassificado silenciosamente.
- A auditoria identifica importação em chamadas separadas e callback de AP sem espera. O estado atual das constraints/RPCs será registrado antes da correção.

## Verificação por etapa

Nenhum item da matriz está concluído só porque existe um teste ou arquivo. Registrar aqui os comandos, resultados e cenários efetivamente cobertos a cada entrega, mantendo o restante aberto.

### Primeira etapa — registro de implementação e verificação (05/09/2026)

- Central NF: totais por mês de emissão, centavos inteiros, separação de documento e caixa, exclusão de homologação identificada e aviso de ambiente legado. Consulta paginada com erro explícito se houver falha ou limite de segurança, usando os prefixos de invalidação existentes.
- Foram removidos os três valores fixos e a estimativa genérica de imposto de 12%. Nenhum imposto real foi apurado/reclassificado.
- 24 testes de cálculo/hook/componente passaram. Navegador isolado: entrada R$ 1.250,75, saída R$ 2.500,00, duas pendências com fixtures sintéticas; troca para mês vazio; falha de consulta e recuperação pelos botões de tentativa. Zero escritas. A sessão local não tinha login: isto prova a tela/consulta controlada, não um fluxo autenticado completo em produção.
- Sync financeiro: receitas `confirmed` barradas por cancelamento/informalidade/gate fiscal/total zero viram `estornado`, preservando a linha. AR parcial/recebida e FE `posted/paid/reconciled` não são reescritas pelo resync. Filtros server-side protegem baixas concorrentes. As cópias TS e Edge permanecem idênticas. Não foi executado resync histórico.
- Listas da central NF: carregamento e erros são explícitos, erro de itens não libera lançamento no estoque, status `erro` não aparece como `processando`, falha ao consultar situação fiscal libera nova tentativa. Sete testes renderizados passaram.
- AP/AR: retirado limite fixo de 2.000; páginas ordenadas por id imutável e resultado completo ordenado por vencimento + id no cliente. Contagem exata obrigatória em cada página, detecção de total alterado/IDs repetidos/fim prematuro e avanço pelo tamanho efetivo recebido, inclusive se o servidor limitar a 500. Dezenove testes cobrem helper e hooks. O helper é compartilhado com o resumo NF. Isto não cria snapshot transacional de valores: alterações simultâneas sem mudança de quantidade ainda exigem nova consulta. Dado vivo: zero AP e 1.053 AR, nenhuma com valor liquidado registrado; não foram criadas liquidações históricas.
- Leitor OFX puro: XML/SGML, BRL, identidade da conta + FITID, centavos exatos, data civil do banco, rejeição de conteúdo divergente, moeda/correção não suportada e XML inválido; pendências não contam como realizado. 49 testes sintéticos passaram, incluindo ambiguidade por agência omitida. Ainda não conectado à baixa, sem persistência bancária e sem suporte de decodificação de arquivo binário nesta etapa. Upload futuro precisa ler bytes e respeitar `CHARSET:1252`, nunca chamar `File.text()` indiscriminadamente; a deduplicação persistente deve usar `(bank_account_id confirmado, FITID)`, não metadados opcionais do arquivo. Referência: [FDX OFX Banking 2.3, §§ 3.2.8 e 11.4.2–11.4.4](https://financialdataexchange.org/wp-content/uploads/2025/12/OFX-Banking-Specification-v2.3.pdf).
- Suíte geral antes das últimas ampliações: 440 arquivos verdes, 4.005 testes verdes, oito casos de banco pulados em cinco arquivos. Skip não é prova de integração. Build e check de tokens passaram (93 ocorrências preexistentes, zero novas).
- Segunda execução geral (com o primeiro leitor OFX e guards expandidos): 441 arquivos verdes, 4.055 testes verdes e os mesmos oito pulados. Typecheck canônico passou. ESLint escopado do core mostra oito `any` preexistentes; verificador de baseline passou sem erros novos. Não foram apagados testes nem atualizados baselines para encobrir falha.
- Terceira execução geral: 444 arquivos verdes, 4.081 testes verdes e oito casos de banco pulados. Typecheck canônico e build passaram; 91 ocorrências de tokens preexistentes, zero novas. Prévia isolada conferida para ambas as listas: falhas ocultam dados antigos, mostram indisponibilidade e permitem tentar novamente; nenhuma escrita enviada. Testes transacionais da nova fronteira de compra são separados desta suíte e ainda precisam ser executados.
- A etapa de código está commitada na feature (`a95c190`, seguida de `a14a06e` para a primeira versão da migration 157). Nenhuma mudança financeira publicada em main/produção até aqui. O workflow manual de teste aceita migration + E2E na mesma transação, somente com `dry_run=true` e ROLLBACK final.
- Primeiro dry-run de 157, [run 33969864292](https://github.com/oleorossi/SquadshoesReal/actions/runs/33969864292): falhou e desfez a transação. A simulação de cadastro alterado comprovou que `tg_block_invalid_purchase_order_receipt` ainda valida unidade de compra viva e rejeita o fechamento de uma OC cujo command já calculou corretamente pelo snapshot. Correção do guard em revisão antes de repetir o teste. `plpgsql.check_asserts` estava `on`; será fixado explicitamente nos E2Es.
- Segundo dry-run de 157, [run 33970074191](https://github.com/oleorossi/SquadshoesReal/actions/runs/33970074191), commit `4825b72`: passou pelo recebimento com snapshot, mas interrompeu a preparação do legado por falta de permissão para `session_replication_role`. A execução foi desfeita. O teste será adaptado com fixtures sintéticas criadas antes da migration, via `setup_sql_path`, sem elevar permissões nem desativar triggers. A etapa ainda não está liberada para produção.
- Terceiro dry-run, `33970283935`, identificou eventos de constraint diferida entre setup e DDL. O setup agora valida essa constraint e restaura seu modo original, e o E2E força todas as constraints antes do ROLLBACK. Não houve COMMIT, desativação de trigger ou elevação de privilégios.
- **157 aprovada em ensaio transacional:** [run 33970413286](https://github.com/oleorossi/SquadshoesReal/actions/runs/33970413286), commit `dfddbbb`, HTTP 201, `ok=true`. Validou criação/append, snapshot físico, mudança posterior de cadastro, recebimento parcial, repetição sem duplicar estoque, custo médio, fallback legado, bloqueio de alteração de quantidade legada, estados recebíveis, valores finitos, mudança da unidade-base, tupla parcial, trava financeira após AP, deduplicação e alteração operacional. Sete testes estruturais específicos passaram; não substituem o E2E. Consulta pós-rollback confirmou ausência de coluna/helper/registro157 e zero resíduos das fixtures.
- 158 adiciona proteção de baixas parciais nos três caminhos SQL de cancelamento/reversão, complementando TS/Edge. Não muda a política de AP, factoring ou CMV e não executa backfill. E2E inteiramente sintético: três PVs, duas NF-e e 18 AR, nenhum provedor fiscal; somente três contas sem caixa devem ser canceladas. Validação registrada no workflow ainda pendente.
- **158 aprovada em ensaio transacional:** [run 33970522414](https://github.com/oleorossi/SquadshoesReal/actions/runs/33970522414), commit `68c5ceb`, HTTP 201, `preserve_partial_receipts_on_cancel_e2e: PASS`. Pós-rollback: helper ausente e zero PVs, NF-e ou AR das fixtures. Não houve pagamento, cancelamento fiscal real, backfill ou resync histórico.
- Verificação local final da etapa: **446 arquivos e 4.093 testes aprovados; oito casos opcionais de banco pulados em cinco arquivos**. Typecheck canônico aprovado, espelho TS/Edge idêntico e lint sem novos erros comparado à baseline `ab61f7c`. Build aprovado; 91 ocorrências antigas de tokens, nenhuma nova. Os ensaios SQL de 157/158 acima são as provas comportamentais do banco, não os testes pulados.
- Entrega desta onda: indicadores reais da central NF, tratamento de falhas, consultas completas de AP/AR, preservação de baixas em TS/Edge/SQL, snapshot físico e guards de recebimento/edição da OC. O leitor OFX é apenas fundação e ainda não opera baixas bancárias. A reforma integral permanece aberta; importação atômica NF×OC×estoque/AP, liquidações por evento, conciliação persistente e demais itens da matriz **não estão concluídos**. Publicação da onda deve seguir CI → migrations → Edge/Vercel do mesmo SHA, sem bypass do CI.

### Achados pendentes da auditoria de banco/integração

- NF: documento → itens → estoque → flag de entrada → custo → AP são chamadas separadas. Estoque pode confirmar e a flag falhar; retry com novo UUID pode duplicar crédito. O custo do movimento também pode capturar o custo anterior, pois o WAC é atualizado depois.
- Não existe vínculo canônico da NF de entrada/itens com recebimento de OC genérica; o aviso de sobreposição é best-effort e não impede crédito duplo pela OC e pela NF.
- Consulta real: quatro NFs (R$ 5.159,16), nenhuma AP vinculada. Uma contém duplicata no XML, mas não tem itens nem AP. É evidência do estado, não atribuição da causa à versão atual.
- OC: a fronteira de comando já possui locks, replay/hash e atualização atômica. Os 332 itens genéricos legados consultados não têm snapshots de unidade/conversão; cinco itens abertos dependem de conversão. Não preencher snapshots históricos supondo que o cadastro atual seja o da emissão.
- Receber `draft/pending/suggested` é bloqueado na tela, mas era aceito no servidor. Não há OC genérica hoje em `approved/sent/parcial`; as linhas `pending` de tiras usam outra fronteira.
- Cancelamento de OC parcial preserva estoque já recebido, mas pode cancelar a AP integral. Requer reconciliação do passivo conforme a decisão de origem/momento da AP.
- Exclusão direta de NF pode apagar itens e remover o vínculo de AP sem reverter estoque; ACL de NF precisa de revisão por papel. Preservar histórico existente, sem correção em massa.
- O gatilho de estorno de CMV considera uma entry ativa de factoring suficiente para manter CMV. Como o cancelamento atual estorna receita antes de excluir factoring, CMV pode sobreviver. A próxima fronteira transacional deve tratar receita, custo e despesa financeira com preservação dos fatos liquidados.
- Pagamentos parciais usam valor acumulado e uma única data; não há histórico suficiente para separar meses. Implantar fatos imutáveis de liquidação antes da conciliação persistente, sem inventar datas anteriores.
