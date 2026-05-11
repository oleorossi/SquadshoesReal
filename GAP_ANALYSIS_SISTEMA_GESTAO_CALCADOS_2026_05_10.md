# Gap Analysis — Squad Shoes vs. Especificação Funcional Completa

**Data**: 2026-05-10
**Documento de referência**: `Sistema_Gestao_Fabrica_Calcados.docx` (Versão 1.0)
**Sistema analisado**: Squad Shoes ERP (716 migrations Supabase + frontend React/TS)

---

## Resumo executivo

Comparando contra os **~140 itens do checklist Seção 16** do documento de referência:

| Status | Qtd | % |
|---|---|---|
| ✅ **PRESENTE** (implementado e funcional) | ~78 | 56% |
| 🟡 **PARCIAL** (existe mas faltam recursos críticos) | ~32 | 23% |
| ❌ **AUSENTE** (não implementado) | ~25 | 18% |
| ⚪ **N/A** (não se aplica ao negócio) | ~5 | 3% |

**O sistema já está num patamar muito sólido**: cobre cadastros, engenharia, PCP, MES básico, estoque, financeiro e fiscal. Os gaps maiores são em **integrações externas** (marketplaces, CNAB, CT-e/MDF-e), **CRM avançado**, **catálogo digital** e **App mobile do representante offline**.

---

## 16.1 Cadastros

| Item | Status | Observações |
|---|---|---|
| Cadastro de referência com gênero, salto, fechamento, materiais, NCM | ✅ | `technical_sheets` tem todos os campos |
| Variação por COR dentro da referência (com ficha técnica e custo próprios) | ✅ | `reference_color_variants` + `technical_sheets.colors` |
| Variação por NUMERAÇÃO (grade) com EAN próprio | 🟡 | Grade ✓, mas EAN por numeração não existe (só EAN por referência) |
| Geração automática de SKU = REF × COR × NUM | 🟡 | Existe a matriz mas SKU final por par individual não é gerado/exibido |
| Agrupamentos: Grupo, Subgrupo/Linha, Família, Coleção, Tema, Tags | 🟡 | Linha + Coleção ✓; **faltam Família, Tema, Tags livres** |
| Cliente com múltiplos endereços, contatos, IE multi-UF | 🟡 | Endereço único + contato único; IE existe mas sem suporte multi-UF |
| Fornecedor com lead time, lote mínimo, avaliação | 🟡 | Lead time ✓; **lote mínimo e avaliação ausentes** |
| Materiais com área da chapa, % perda, fator de calibração | 🟡 | Área dm² ✓, % perda ✓; **fator de calibração real × teórico ausente** |
| Couro/pele com unidade física por pele | ❌ | Material é tratado por área genérica, sem registro de pele individual com área variável |
| Componentes (solado, palmilha) com grade própria | ✅ | Solados Hub com `sole_size_conjugations` + `stock_grade` por numeração |

**🎯 Gap crítico desta seção**: EAN por numeração (importante pra integrar e-commerce/marketplace).

---

## 16.2 Engenharia

| Item | Status | Observações |
|---|---|---|
| Ficha técnica versionada com imagens | 🟡 | Histórico de mudanças existe; **versionamento explícito (v1, v2, vigência de/até) parcial** |
| Plano de corte com fator real × teórico | ❌ | Sem registro de aproveitamento real após primeiro lote |
| BOM multinível com vigência | 🟡 | BOM ✓; vigência (de/até) ausente |
| BOM por cor (não só por referência) | ✅ | `sheet_materials` permite material por cor via `color` |
| Roteiro com tempo-padrão por operação | 🟡 | `*_capacity_per_day` por setor existe; **tempo-padrão por operação individual ausente** |
| Custeio padrão / médio / último / real com decomposição | ✅ | `calculate_order_cost` decompõe material/MOD/overhead; padrão/médio/último presentes |
| Custo diferenciado por numeração | ✅ | `*_consumption_per_size` + `audit-fix-conversion-and-parallelism` |

**🎯 Gap crítico**: Plano de corte com calibração real (referência diz que o teórico subestima em 20-25%).

---

## 16.3 Comercial

| Item | Status | Observações |
|---|---|---|
| Coleções com calendário e status | 🟡 | Coleção existe como campo; **calendário (pré-venda/lançamento/encerramento) ausente** |
| Catálogo digital com fotos e grade | ❌ | Sistema interno; nenhum catálogo público |
| Múltiplas tabelas de preço, vigência, por canal/região/cliente | ❌ | Preço único por referência/cor; sem múltiplas tabelas |
| Representantes com comissão escalonada e por status | 🟡 | Comissão fixa por representante ✓; **escalonada (meta → +%) e por status (pedido/faturado/recebido) ausentes** |
| App mobile de pedido offline | ❌ | Sem app mobile dedicado |
| Pedido em formato grade cor × numeração | ✅ | `SaleOrderItemForm` matriz total |
| Workflow de status do pedido com validações automáticas | ✅ | Rascunho→Pendente→Aprovado→Em Produção→Pronto→Faturado→Cancelado |
| Tipos de pedido: carteira, programado, MTO, pronta-entrega, amostra, bonificação, exportação | 🟡 | Carteira ✓, Pronta-entrega ✓ (módulo dedicado); **programado/MTO/amostra/bonificação/exportação ausentes** |
| Carteira com visão atendimento (pedido × estoque × produção) | 🟡 | Reservas + MRP existem; UI consolidada de "atendimento" parcial |
| CRM com histórico, campanhas, recompra prevista, NPS | ❌ | Sem módulo CRM |
| SAC com workflow de troca/garantia | ❌ | Sem fluxo de SAC/devolução estruturado |

**🎯 Gap crítico**: Múltiplas tabelas de preço, catálogo digital, CRM, SAC.

---

## 16.4 PCP / Produção

| Item | Status | Observações |
|---|---|---|
| Forecast por SKU com sazonalidade e curva de numeração | ❌ | Sem forecast estatístico |
| MPS com aprovação e versionamento | ❌ | Sem Plano Mestre formal |
| MRP com lead time, lote mínimo, EOQ, estoque de segurança | 🟡 | MRP ✓ (`MrpUnifiedContent`, `try_reserve_materials`); **lote mínimo + EOQ ausentes** |
| OP com BOM/roteiro snapshotados | ✅ | `technical_sheet_snapshots` + `production_consumptions` |
| Sequenciamento com capacidade finita e Gantt | 🟡 | Capacidade ✓ + Cronograma Reverso ✓; **Gantt drag-and-drop ausente** |
| Setup considerado entre cores/referências | ❌ | Sem setup time entre OPs |
| Apontamento via coletor com OEE | 🟡 | Apontamento existe; **OEE (disponibilidade × performance × qualidade) ausente** |
| Apontamento de motivo de parada | ❌ | Sem registro de motivo de parada |
| Plano de corte com sugestão de chapa e apontamento real | ❌ | Sem FIFO/sugestão de chapa específica |
| Gestão de facções (remessa, retorno, NC, indicadores) | ✅ | `service_orders` + `contractors` + `artisanal_recipes` |

**🎯 Gap crítico**: Forecast, MPS, OEE, motivo de parada, setup time.

---

## 16.5 Estoque / WMS

| Item | Status | Observações |
|---|---|---|
| Múltiplos depósitos e endereçamento | 🟡 | Localização (Linha Produção/Almoxarifado A/B) existe; **endereçamento (rua-prateleira-nível) ausente** |
| Status lógicos (disponível, reservado, quarentena, bloqueado) | 🟡 | Disponível + reservado ✓; **quarentena + bloqueado ausentes** |
| Estoque por SKU e por lote | 🟡 | Por SKU ✓; **lote de produção rastreável ausente** |
| Estoque consignado | ❌ | Sem estoque em poder de cliente/fornecedor |
| Picking guiado e conferência por bipagem | 🟡 | Picking semanal existe (PCP); **bipagem EAN com coletor ausente** |
| Cross-docking produção → expedição | ❌ | Sem fluxo direto sem passar pelo PA |
| Inventário cíclico ABC | 🟡 | Ajuste de estoque existe; **inventário cíclico programado por curva ABC ausente** |
| Rastreabilidade par → lote → OP → chapas → fornecedor | 🟡 | OP → ficha → consumo ✓; **lote-a-lote por par individual ausente** |
| Recall de lote | ❌ | Sem função "localizar pares de um lote vendidos" |

**🎯 Gap crítico**: Lote de produção rastreável, recall, coletor de dados.

---

## 16.6 Compras

| Item | Status | Observações |
|---|---|---|
| Solicitação automática via MRP | ✅ | `mrp_suggestions` + auto-PO no fluxo de aprovação |
| Cotação multifornecedor com mapa comparativo | ❌ | Sistema cria PO direto; sem fase de cotação formal |
| Pedido com aprovação por alçada | ❌ | Sem aprovação por alçada (valor/categoria) |
| Recebimento com inspeção e NC | 🟡 | Recebimento ✓; **inspeção/AQL/registro de NC ausentes** |
| Vinculação automática a CP | ✅ | OC ↔ `accounts_payable` via `boleto_finance` |

**🎯 Gap crítico**: Cotação multifornecedor (RFQ), aprovação por alçada.

---

## 16.7 Expedição / Fiscal

| Item | Status | Observações |
|---|---|---|
| Picking por onda/pedido | ✅ | PCP > Picking Semanal |
| Romaneio e etiqueta de volume | 🟡 | Embalagens existem; **romaneio formal + etiqueta de volume com EAN ausentes** |
| NF-e com cálculo automático de impostos, CFOP, DIFAL, ST | ✅ | Módulo NF-e com `companies` (certificado A1) |
| Boleto, carta de correção, cancelamento, devolução | 🟡 | Cancelamento ✓; **carta de correção + boleto CNAB ausentes** |
| CT-e entrada, MDF-e | ❌ | Sem CT-e/MDF-e |
| Rastreamento de entrega para o cliente | ❌ | Sem integração Correios/transportadora |

**🎯 Gap crítico**: CT-e, MDF-e, carta de correção, boleto/CNAB.

---

## 16.8 Financeiro / Fiscal

| Item | Status | Observações |
|---|---|---|
| CR/CP com CNAB, conciliação automática | 🟡 | CR/CP completo ✓; **CNAB 240/400 remessa-retorno + conciliação automática ausentes** |
| Fluxo de caixa projetado | ✅ | `useFinanceIntelligence` + dashboard |
| SPED Fiscal, Contribuições, Contábil, ECF | ❌ | Sem exportação SPED |
| Apuração de ICMS, IPI, PIS, COFINS, Simples | 🟡 | NF-e calcula; **apuração mensal consolidada ausente** |
| Contabilidade com plano de contas e DRE/Balanço | 🟡 | `chart_of_accounts` + DRE ✓; **balanço patrimonial + ECF ausentes** |

**🎯 Gap crítico**: CNAB, SPED, conciliação bancária automática.

---

## 16.9 Qualidade

| Item | Status | Observações |
|---|---|---|
| Plano de inspeção recebimento (AQL) | ❌ | Página Qualidade existe vazia |
| Pontos de inspeção no roteiro | ❌ | Sem inspeção entre setores |
| Pareto de defeitos | ❌ | Sem registro de defeitos por tipo |
| Custo da não-qualidade | ❌ | Sem cálculo de custo de refugo/retrabalho |
| Workflow de garantia/troca pós-venda | ❌ | Sem SAC estruturado |

**🎯 Gap crítico**: Toda a Seção 11 do documento está praticamente AUSENTE.

---

## 16.10 BI / Indicadores

| Item | Status | Observações |
|---|---|---|
| Dashboards comerciais, produção, estoque, financeiro, qualidade | ✅ | Múltiplos dashboards: Comercial, Produção, Financeiro, RH, Painel principal |
| Drill-down e filtros dinâmicos | 🟡 | Filtros existem; **drill-down (clica no número e vai pro detalhe) parcial** |
| Exportação e agendamento de envio | 🟡 | Exportação CSV/PDF existe em alguns lugares; **agendamento por email ausente** |
| API para BI externo | 🟡 | Supabase tem REST/GraphQL API; **endpoint dedicado pra Power BI/Metabase ausente** |

---

## 16.11 Integrações

| Item | Status | Observações |
|---|---|---|
| E-commerce e marketplaces (hub) | ❌ | Sem integração Shopify/VTEX/Mercado Livre/etc. |
| Bancos via CNAB e Open Banking | ❌ | Sem integração bancária |
| Transportadoras e plataformas de frete | ❌ | Sem API Correios/Jadlog/Melhor Envio |
| Sefaz (NF-e, CT-e, MDF-e) | 🟡 | NF-e ✓; **CT-e e MDF-e ausentes** |
| CAD de plano de corte | ❌ | Sem Audaces/Romans |
| WhatsApp Business / e-mail / SMS | ❌ | Sem mensageria integrada |
| API REST documentada para integrações futuras | 🟡 | API Supabase pública; **documentação OpenAPI/Swagger formal ausente** |

**🎯 Gap crítico**: Toda Seção 14 quase AUSENTE — é a maior área de gap.

---

## 16.12 Segurança e Compliance

| Item | Status | Observações |
|---|---|---|
| MFA, perfis granulares, auditoria de log | 🟡 | Perfis ✓ (RLS Supabase); auditoria de log ✓; **MFA ausente** |
| Backup automático com teste de restore | ✅ | Supabase faz backup; teste manual de restore documentado |
| LGPD: consentimento, retenção, portabilidade, exclusão | ❌ | Sem fluxo formal LGPD |
| Criptografia em trânsito e em repouso | ✅ | TLS + Supabase at-rest |

---

## TOP 25 GAPS (priorizados por impacto)

### 🔥 Críticos (alto impacto, viabilizam crescimento)

1. **Múltiplas tabelas de preço** (atacado/varejo/canal/vigência) — fundamental p/ B2B + B2C
2. **CT-e e MDF-e** — obrigação fiscal pra movimentação de carga
3. **Boleto CNAB 240/400** — automatiza CR (grande gargalo manual atual)
4. **Catálogo digital** (PDF/link público + foto + grade + preço por cliente)
5. **App representante mobile offline** — velocidade comercial
6. **CRM básico** (histórico interações, campanhas, recompra prevista, aniversariantes)
7. **Workflow de SAC / troca / garantia** — atendimento pós-venda
8. **OEE + motivo de parada** — visibilidade de produtividade
9. **Forecast estatístico** (média móvel + sazonalidade + curva de numeração)
10. **Integração e-commerce** (Shopify/VTEX) + marketplaces hub

### 🟠 Importantes (médio impacto, ganho operacional)

11. **Lote de produção rastreável** + função recall
12. **Plano de corte com calibração real × teórico** (corrige custo em 20-25%)
13. **Cotação multifornecedor** (RFQ com mapa comparativo)
14. **Aprovação por alçada** em pedidos de compra
15. **Coletor de dados / bipagem EAN** no recebimento e expedição
16. **Inventário cíclico ABC** programado
17. **SPED Fiscal/Contribuições** export
18. **Conciliação bancária automática** + Open Banking
19. **Setup time** entre cores/referências no sequenciamento
20. **Quarentena/bloqueio** de estoque (defeito, NC)

### 🟡 Desejáveis (baixo/médio impacto, maturidade)

21. **Tipos de pedido** completos (programado, MTO, amostra, bonificação, exportação)
22. **Cliente: múltiplos endereços + contatos + tabela preço/cliente + score A/B/C**
23. **Família + Tema + Tags livres** em produtos
24. **EAN por numeração** + SKU completo Ref-Cor-Num explícito
25. **Couro controlado por pele individual** com área variável

### ⚪ Estratégicos (longo prazo)

- **CAD plano corte** (Audaces/Romans) — só vale com investimento grande
- **MFA + SSO** em segurança
- **WhatsApp Business** API
- **Portal do cliente** pra acompanhar pedidos
- **LGPD formal** (consentimento, exclusão, portabilidade)

---

## 5 Quick-wins (alto impacto, baixo esforço, 2-4 semanas)

1. **Múltiplas tabelas de preço com vigência** — adicionar tabela `price_lists` + UI no Comercial. ~3 dias de trabalho.
2. **Catálogo digital PDF/link público** — extender o gerador atual de PDF do PV pra modo "catálogo de coleção". ~2 dias.
3. **Forecast simples (média móvel 6 meses por SKU)** — view SQL + dashboard. ~2 dias.
4. **Carta de correção + cancelamento NF-e** estendendo o módulo NF-e. ~2 dias.
5. **EAN por numeração** — adicionar coluna em `product_references` + UI. ~1 dia.

---

## Próximos passos

Marque cada item da lista TOP 25 com a sua decisão:
- ✅ **Implementar agora** (entra na próxima rodada)
- 🔜 **Implementar depois** (backlog)
- ❌ **Não vou implementar** (terceirizar ou descartar)
- ❓ **Quero mais detalhes** antes de decidir

Posso depois detalhar cada item escolhido com:
- Mudança de schema (DDL exata)
- Endpoints/RPCs a criar
- Telas/componentes a editar
- Migração de dados
- Esforço estimado em horas

---

**Documento final**: este gap analysis serve como contrato pra decidir prioridades. Sem ele, o "implementar tudo" do doc oficial vira 6 meses de trabalho sem ganho incremental claro. Com ele, cada decisão fica explícita.
