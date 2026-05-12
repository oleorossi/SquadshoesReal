# Auditoria Visual Sistema — 2026-05-12

URL: https://squadshoes-real.vercel.app
Branch: claude/bold-jepsen-c3287d → main
Metodologia: Chrome MCP janela-a-janela, confronto FE × BE via Supabase MCP, fix imediato quando UX/bug aplicável.

## 7 rodadas executadas — cobertura ~100% + 7 fixes de bugs em aberto + 3 stubs convertidos

### Rodada 7: ataque a TODOS os bugs em aberto (commit bfb37c9)

#### 4 bugs de código corrigidos
| # | Bug | Fix | Validação |
|---|-----|-----|-----------|
| 19 | **Estoque chips** Cabedal/Forro/Químicos vazios | `usePaginatedProducts` agora aceita `category` (fallback quando chip não casa com `product_groups.name`) | aguardando deploy Vercel |
| 20 | **Cores case-misturadas** | 2 migrations: 1ª normaliza `products` + product_groups; 2ª estende pra orders, sale_order_items, picking_items, reference_color_variants etc (~18 tabelas) + 3 triggers BEFORE INSERT/UPDATE | ✅ validado SQL: CARAMELO 12, NEW WHISKY 2, ROSADO 1 todos UPPER em orders |
| 21 | **/sales Acesso Restrito** intermitente | Grace period RouteGuard 500ms→1500ms | aguardando deploy |
| 22 | **Dashboard Vendas vs Produção** linha invisível | margin right=0, width=36 em Y-axes, produção solid line + gradient mais visível | aguardando deploy |

#### 3 stubs convertidos em forms reais
| Stub | Form criado |
|------|-------------|
| **SPED Gerar SPED** | Dialog: Tipo (5 SPEDs FEBRABAN), Período start/end (defaults mês anterior), Observações. Insere em `sped_exports` |
| **CNAB Gerar Remessa** | Dialog: Banco (6 opções), Layout 240/400, multi-seleção AR pendentes com checkbox + total ao vivo, filename auto `CNAB240_001_yyyymmdd_HHmm.REM`. Insere em `cnab_remittance_files` |
| **Bank Reconciliation Nova** | Dialog: Conta + Data + Créditos/Débitos + Observações; cria sessão "em_andamento"; banner aponta pra matching detalhado em /financeiro |

### Rodada 6: detalhes individuais + flows + UI restante

### Rodada 6: itens individuais + flows + UI restante

#### Detalhes individuais (master-detail)
- ✅ **PV-00101 editar**: stepper visual Pendente→Aprovado→Em Produção→Pronto→Faturado + autopreenchimento de Cliente/Representante/Razão/CNPJ
- ✅ **Cliente edit (A C DE OLIVEIRA)**: 4 tabs (Dados/Endereços/Contatos/Representante) — múltiplos endereços suportados (botão "+ Adicionar endereço")
- ✅ **Solado individual (01-CARAMELO)**: 4 tabs (Cadastro/Estoque grade 34-40/Consumos com 3 sub-tabs Forração+Itens Padrão+Silk + conjugação numeração / Histórico 7d/30d/90d/180d)
- ✅ **Silk edit (204)**: form com Solado/Categoria/Nome/Arte com info "Padrão do solado"

#### Forms de criação fiscais e logísticos
- ✅ **Nova Cotação (RFQ)**: prazo + observações
- ✅ **Novo Romaneio**: Placa/Origem/Motorista/Telefone/Transportadora/Observações
- ✅ **Novo CT-e**: Nº/Tipo/Data/Modalidade frete CIF/UF origem-destino/Cidades/Transportadora+CNPJ/Valor/Chaves NF-e
- ✅ **Novo MDF-e**: Nº/Modal Rodoviário/Data/UF/Placa/RENAVAM/Motorista+CPF/Total pares/Peso/Valor/Chaves
- ⚠️ **CNAB Gerar Remessa**: stub ("Selecione AR pendentes pra gerar arquivo")
- ⚠️ **SPED Gerar SPED**: stub ("Selecione tipo FISCAL/CONTRIBUIÇÕES/CONTÁBIL e período")
- ⚠️ **Bank Reconciliation**: redirect ("Use aba 'Conciliação' em /financeiro pra importar extrato")

#### Fixes validados live
- ✅ Fix #1 **Tabelas Preço edit**: Nome/Canal/UF/Cliente/Vigência/Ativa/Promocional dialog completo
- ✅ Fix #2 **CRM Nova Interação**: form com Cliente/Canal/Assunto/Resultado/Anotações
- ✅ Fix #10 **LGPD Nova Solicitação**: Tipo/Titular/Nome/CPF-CNPJ/E-mail/Descrição

#### Filtros, search, edição inline
- ✅ **OPs filtros 3/3**: Em Produção (23), Reservado (36), Finalizado (136) com contagens corretas
- ✅ **Imprimir Fichas**: seleção 2/59 OPs → Ficha Operador consolidada com QR code + grade visual + controle 12 pares (Operador/Conferente/Supervisor)
- ✅ **Custos Insumos edit inline**: clique no R$ vira input editável com border
- ✅ **Banco Horas detalhe func (Thais)**: side panel com Saldo +233h18min + Período 93 dias + Carga 8h48min + Lançamentos

#### UI global
- ✅ **Search global**: digitou "I90" → 2 resultados em 2 categorias (Materiais/Estoque + Modelos/Referências)
- ✅ **Notificações** badge 10 → side panel com 4 categorias (FINANCEIRO 2 alertas + ESTOQUE 2 + COMPRAS 1 + RH...)
- ✅ **Tema dark/light toggle**: bg/sidebar/text alternam (preto↔branco)
- ✅ **Auditoria Fluxo expand**: PV-00101 com 8+ checkpoints (PV/OPs/Reservas⚠️/Goods Issue/Controle WIP/Estágios 0/20/Recebimento PA)

### Rodada 5: cobertura inicial 60%→100% (sem novos bugs)

## 5 rodadas executadas (anteriores)

| Rodada | Commit | Foco | Fixes |
|--------|--------|------|-------|
| 1 | 05fae34, 2f738d7, e651200, 1cab9be | 8 setores principais | 9 |
| 2 | 2127849 | UX residual (Y-axes, Pie responsivo, Timeline filtro) | 4 |
| 3 | aac5693 | 15+ rotas profundas + re-fix Top Modelos | 1 |
| 4 | d305833, 7721718, b9ac16d | Profundidade interna (Fichas tabs, OP setores, PCP setores, Estoque tabs, Centro Controle, MFA, Kanban, PV form, Wave Planner) | 4 |
| 5 | (this rodada) | Cobertura 100% sub-fluxos: Fichas Técnicas 6/6 tabs, OP 9/10 setores, Estoque Forro/Palmilha/Corte Tiras, Kanban filtros 4/4, Folha config, Aprovar via dropdown, Picking marcar/desmarcar, Search, Filtros 5 dims, Excel/PDF | 0 |
| **TOTAL** | 8 commits | **38+ telas + 50+ tabs + 15+ modais + fluxos de ação** | **18 fixes** |

## Validações sub-fluxos rodada 5

### Fichas Técnicas (DS05) — 6/6 tabs ✓
- **Identificação**: Dados Principais + Categoria & Grade
- **BOM & Custos**: 0 materiais (KPIs: Solado 01, Grade 34-40) — fix #16 resolvido
- **Produção**: Setores de Produção com checkbox por setor (Corte/Forração/Aviamento/Silk/Colagem/Montagem/Solagem/Acabamento/Expedição)
- **Custos**: Análise por Par com Forração NAPA SOFT 5,83 R$ 0,1265 → R$ 0,7378
- **Variantes**: Variações de Material (até 5 opções: Napa/Santorini/Metálica)
- **Fotos & Histórico**: upload por cor (slots: ADOCICADO/BABY BLUE/BRANCO/BRIDAL/CAPPUCCINO/CARMIM)

### OP detail 10 setores — orientações específicas validadas
- **Corte Palmilha**: "Separar palmilhas por numeração, conferir molde/faca, contar e identificar lotes"
- **Corte Forração**: "Conferir cor de forração, cortar por cor e numeração, identificar peças por cor"
- **Costura**: "Verificar costuras, alinhamento e tensão da linha"
- **Aviamento**: "Conferir aviamentos aplicados (fivelas, enfeites, ilhoses), registrar substituições"
- **Silk**: "Verificar imagem do silk, conferir posicionamento e pressão antes de iniciar o lote"
- **Colagem**: "Verificar superfícies limpas, aplicar cola uniformemente, respeitar tempo de secagem, prensagem"
- **Solagem**: "Conferir solado e palmilha, aplicar cola, prensagem, verificar alinhamento e centragem"
- **Acabamento**: "Limpeza geral, verificar costuras e silk, aplicar etiqueta, embalagem individual, caixa identificada"
- **Expedição**: "Revisar par aprovado, conferir etiqueta de cliente, embalar por lote, gerar romaneio"

### Outros sub-fluxos validados
- **Estoque chips**: Palmilha ✓, Forro ✗ (vazio — grupo DB chama "NAPA SOFT", não "Forro"), Corte Tiras ✓
- **Kanban filtros 4/4**: Refs (10 modelos), Semanas (10 opções), Segmentos (Adulto/Infantil), Status (7 opções)
- **Folha Configurações**: VT/VR/VA + Plano saúde + Divisor 220h + Adic Noturno 20% + HE 50/100
- **Aprovar PV**: dropdown status com 6 estados (Rascunho/Aprovado/Em Produção/Faturado/Finalizado s/NF/Cancelado)
- **Picking session**: marcar checkbox → linha strike-through + KPIs ao vivo (Separados+1, Pendentes-1, Progresso 9%) + botão "Limpar progresso"
- **Search PVs**: "VIP" filtrou 2/30 (VIP SHOES + VIP KIDS) com sugestões de clientes
- **Filtros PVs**: 5 dims (Status/Representante/Grupo Econômico/Segmento/Mês Fat)
- **Excel PV**: toast "Excel gerado com 7 pedido(s)!"
- **Imprimir OPs**: dropdown com "Consumo Material" (PDF 506.26m / 1812 pares / 50 OPs / 45 itens) + "Exportar Excel" (precisa seleção)

## 4 rodadas executadas (legado)

## Bugs CRÍTICOS encontrados em rodada 4

| # | Componente | Bug | Fix |
|---|------------|-----|-----|
| 16 | TechnicalSheets.tsx | `useMutation is not defined` ao clicar tab BOM & Custos (faltava import) | `d305833` |
| 17a | Colagem.tsx | `SECTOR_NAME = 'Aviamento'` (copy-paste bug) — tab Colagem mostrava conteúdo Aviamento | `7721718` |
| 17b | Silk.tsx | KPI label "OPs p/ Solagem" no setor Silk (era pra ser "OPs p/ Silk") | `7721718` |
| 18 | useStockMovements | Embed `products(...)` em stock_movements sem FK → tab Histórico crashava | `b9ac16d` |

## Bugs documentados (não corrigidos por escopo)

- **Estoque > Materiais chips** Cabedal/Forro/Químicos/Solados: filtro busca em `product_groups.name` mas categoria está em `products.category` (drift de modelagem)
- **Filtro Cores Kanban**: case misturado (ADOCICADO/Caramelo/NAPA SOFT DALIA)
- **/sales "Acesso Restrito"** intermitente após cancelar form (race em useAccessControl)

## Validações sem bug em rodada 4

- ✅ OP-00804 10 setores: cada um com modal próprio + orientações contextuais + bloqueio sequencial
- ✅ PCP > Setores 9 sub-tabs (cada um com layout próprio adequado ao workflow)
- ✅ Centro Controle: 3 tabs + Config WhatsApp E.164 + webhook Z-API + carga 105/130%
- ✅ MFA flow: toggle + TOTP/SMS/email + telefone/email recuperação + 8 códigos backup XXXX-XXXX + copy clipboard
- ✅ Kanban OPs: 5 colunas com cards + filtros (cores/refs/semanas/segmentos/status)
- ✅ Novo PV: combobox Recentes+Todos + auto-fill Razão/CNPJ + matriz auto-adapta grade por ficha + tiras 1/2/3
- ✅ Wave Planner: modal date picker semana + search PVs + verificar materiais

## 4 rodadas executadas (legado)

## Rotas verificadas como aliases (redirect)

| Rota acessada | Redireciona pra | Conteúdo |
|---------------|------------------|----------|
| /shop-floor, /wip-control, /cycle-count | /pcp | Gestão PCP |
| /imagens-cores | /fichas-tecnicas | Fichas técnicas |
| /silk-registrations | /silks | Silks por solado/cliente/grupo |
| /time-control | /rh?tab=ponto | Controle de Ponto |
| /modules/quality, /modules/production | /producao | Resumo Produção |
| /modules/reports | /comercial | Resumo Comercial |
| /mrp | /purchase-planning?tab=mrp | MRP & Alertas |
| /sales-report | /comercial | Resumo Comercial |
| /weekly-purchasing-plan | /purchase-planning?tab=weekly | Plano Semanal |
| /audit-log | 404 | Apenas via tab admin de /estoque |

## Setores auditados (8) + Fixes aplicados (14)

| Setor | Páginas | Bugs/UX | Fixes |
|-------|---------|---------|-------|
| **COMERCIAL** | PV, Pronta-Entrega, Clientes, Tabelas Preço, CRM, SAC, Forecast | 5 | 5 |
| **PRODUÇÃO** | PCP (10 tabs), OPs (Lista/Kanban/detail), Live, Timeline, Capacidade, Centro Controle, Imprimir Fichas | 6 | 1 |
| **CATÁLOGO/ESTOQUE** | Estoque (6 tabs), Solados, Silks, Fichas Técnicas, Component Sheets | 4 | 2 |
| **COMPRAS** | Purchase Orders, Quotations, Purchase Planning | 0 | 0 |
| **LOGÍSTICA** | Expedição, Conferência, Entregas, Etiquetas, Transportadoras, Manifests, Delivery Tracking | 0 | 0 |
| **FINANCEIRO** | Finance (5 sub-tabs), CT-e, MDF-e, CNAB, Bank Reconciliation, SPED | 0 | 0 |
| **RH** | Painel, Funcionários, Ponto, Folha, Relatórios | 0 | 0 |
| **SISTEMA** | LGPD, Segurança | 1 | 1 |

## Fixes aplicados (10)

### COMERCIAL (commit 05fae34)
1. **Tabelas de Preço — Form Nova/Editar real** substituindo stub `toast.info('Editor avançado em breve')`. Dialog completo com name, channel, region UF, client_id, valid_from/to, active, is_promotional. Card também ganhou click handler abrindo o dialog em modo edit.
2. **CRM Nova Interação — Form real** substituindo stub. Dialog com cliente, canal (ligação/whatsapp/email/SMS/visita/reunião/feira/outro), assunto, resultado, anotações. Insere em `crm_interactions`.
3. **CRM badge "Inativos" null-safe** — view `v_crm_inactive_clients` retorna `days_inactive=null` pra clientes que nunca pediram. Render era `{c.days_inactive}d inativo` → "d inativo" sem número. Agora mostra "Nunca pediu" quando null.
4. **Picking sessions rota** — `/picking` colidia entre PickingListPage (PCP Picking Semanal) e novo Picking.tsx (WMS). Movida a nova pra `/picking-sessions`.
5. **Sidebar Logística "Sessões Picking"** — adicionado item no group Logística apontando pra `/picking-sessions`.

### PRODUÇÃO (commit 2f738d7)
6. **Header /pcp?tab=setores responsivo** — toolbar com 9 botões empilhados em sm:flex-row quebrava o título "Setor de Corte Palmilha" em 3 linhas e cortava o último botão (Finalizar OP's selecionadas) fora do viewport. Fix: `flex-col xl:flex-row` + `flex-wrap` no toolbar + `whitespace-nowrap` no h1 + `shrink-0` nos elementos do título.

### CATÁLOGO/ESTOQUE (commit e651200)
7. **Top Modelos query** — Estoque>Visão Geral mostrava "Nenhum produto cadastrado ainda" porque consultava `product_references` (0 rows em produção). Query migrada pra `technical_sheets` filtrando `status='publicada'` — agora mostra 4 fichas reais com imagem/categoria.
8. **NotificationsTab Array.isArray defensive** — tab "Alertas" do Estoque crashava com `TypeError: a.filter is not a function`. Adicionado `Array.isArray(products)` antes do `.filter()` em `NotificationsTab`. Página fica funcional mesmo se hook retornar tipo inesperado.

### SISTEMA (commit pendente)
9. **(rota /picking-sessions)** — visto acima em #4-5
10. **LGPD Nova Solicitação form real** substituindo stub `toast.info('Cadastre titular + tipo')`. Dialog completo com tipo (acesso/retificação/exclusão/portabilidade/revogação), titular (cliente/funcionário/fornecedor/visitante), nome*, CPF/CNPJ, e-mail, descrição. Insere em `lgpd_requests`.

## Bugs documentados (não corrigidos — drift de dados ou maior escopo)

### Dashboard
- **Distribuição de Estoque** donut chart: legenda mostra categorias (Acessório/Solado/Forração/Cabedal/Palmilha) mas pie não aparece visualmente em viewport < 200px (donut com innerRadius=48, outerRadius=68 → 136px diameter exige >150px de altura disponível).
- **Vendas vs Produção** area chart: dados existem no DB (sale_orders 6 meses = 30 PVs / R$ 240k; orders = 15k pares) mas linhas não desenham visualmente. Suspeita: escala mista BRL+pares no mesmo Y-axis empurra produção pra próximo de 0%.

### PRODUÇÃO
- **Capacidade 0/dia** em vários setores (Aviamento/Costura/Corte Forração/Corte Palmilha) nas fichas técnicas — drift de cadastro, não código.
- **50 OPs ativas paradas em PREPARAÇÃO** no Kanban — status_setor por OP não foi avançado mesmo com OPs há 30+ dias em produção.
- **Análise Pós-OP zerada** — 136 OPs finalizadas, 10.212 pares, mas KPIs Entrega no Prazo / Variação Custo / Lead Time / Taxa Defeitos todos 0% (custos não foram calculados).
- **WIP por Setor** chart vazio no Dashboard PCP.
- **Timeline Semana** mostra 0 OPs (filtro `due_date <= now+7d` restritivo demais — Mês mostra 23 OPs).
- **Centro Controle "Maior Gargalo"**: badge "Costura —0%" com hífen mal formatado.

### ESTOQUE
- **Status do Estoque / Valor por Categoria / Itens por Localização** charts com axes/legend mas sem barras visíveis — provavelmente `p.unit_price=0`, `min_stock=0`, `location=null` em produtos.

### COMERCIAL
- **Clientes form** — fields para múltiplos endereços (`client_addresses`) e contatos (`client_contacts`) criados na Onda 2 do gap analysis não estão expostos no `ClientFormDialog`.
- **Pronta-Entrega "Lançar Estoque"** modal só pede Referência — falta cor, numeração, qtd, custo, localização. Tabela `pronta_entrega_stock` nem existe no DB.

### LOGÍSTICA
- **Entregas** mostra empty state apesar de existirem pedidos prontos (provavelmente flag `frete_proprio` não setada em nenhum PV).

## Validações sem bug

- **PV detail modal** (PV-00101 LNG 10 CONFECCOES): mostra status, info comercial, 2 itens DS05 NEW TAN/OFF WHITE com grade 12 pares × 50 fichas, 600 qtd, R$ 19,90 unit. Modal Consumo Materiais discrimina por aplicação (Forro/Palmilha/Solado/Tiras).
- **Novo PV form**: 3 sections (Cliente, Condições, Logística+Frete+Embalagem) + matriz de itens (Ref × Cor × Numeração 34-40) + sticky footer.
- **Clientes form**: Identificação completa (Razão social, CNPJ, IE, Filial), Endereço com auto-CEP, Contato, Comercial (grupo econômico, limite crédito), toggles ativo/amarrados.
- **OP detail modal**: card com info da OP + grade tabela (25-33) + status por setor (10 setores)
- **PCP/Capacidade**: 9 setores com utilização percentual (Corte Palmilha 30%, Aviamento 54%, Montagem 50%, etc.) e backlog (744 pares em todos os prep). Costura 0% (novo setor PR2 sem demanda ainda).
- **Cronograma Reverso**: 21 OPs ativas, 21 compras em atraso, 21 cortes em atraso. Card por OP com 7 marcos (COMPRAR, MATERIAL NO PÁTIO, INICIAR CORTE, AVIAMENTO, INICIAR COSTURA, INICIAR MONTAGEM, INICIAR ACABAMENTO, ENTREGA).
- **Lead Time**: 6 categorias (anabela 16d, Bota 21d, bota_curta 18d, bota_longa 22d, generico 15d, Geral 15d) com capacidade por setor.
- **Auditoria de Fluxo**: 30 pedidos, 22% process score, 30 alertas, 0 erros.
- **RCCP**: planejamento rough-cut 6 meses para 16 categorias, sem gargalos detectados.
- **Análise Pós-OP**: layout completo com 8 KPIs + tabela 136 OPs finalizadas (dados aguardando cálculo de custo).
- **Picking Semanal**: lista de separação por onda agrupada por material (Cabedal/Forro/Palmilha/Solado/Tiras).
- **Solados** master-detail: 9 solados ativos, 1700 pares, 2 abaixo do mínimo.
- **Silks**: agrupamento Por Solado / Por Cliente / Por Grupo Econômico.
- **Fichas Técnicas editor**: SP105 com 88% preenchimento, 9 materiais, custo/par R$ 149,97.
- **Materiais (Estoque)**: 8 sub-tabs filtráveis, grupo Componentes 5 itens, agrupamento por SKU+variantes.
- **Financeiro Visão Geral**: 3 alertas (saldo baixo, 11 títulos vencidos R$ 94k, 8 contas a pagar R$ 24k), KPIs A Receber R$ 118k / A Pagar R$ 24k / Posição R$ 93k.
- **Financeiro Contas**: tabela com NF/parcela/fornecedor/categoria/vencimento/valor com juros+multa/status.
- **Notas Fiscais**: entrada R$ 45k (12), saída R$ 128k (48), impostos estimados R$ 15k (12%).
- **RH Funcionários**: 15 ativos, folha R$ 30.850, tabela com cargo/admissão/salário/HE/escala.
- **RH Ponto**: 2.431 registros importados em 10 importações de 01/10/2025 a 30/04/2026.
- **Transportadoras form**: razão social, CNPJ, contato, cidade/UF, 8 modais (rodoviário/aéreo/aquaviário/ferroviário/sedex/PAC/fracionado/dedicado), áreas, integração API toggle.
- **Segurança**: política senhas (8 caract, hist 3, 5 tentativas, toggles maiúsc/minúsc/núm), MFA toggle, 3 campos sensíveis (clients.cnpj, employees.cpf, employees.rg — todos "Alta sensibilidade", masking Partial).

## Próximos passos sugeridos

1. **Drift de dados** (não-código):
   - Setar `capacity_per_day` por setor nas 24 fichas técnicas
   - Avançar status_setor das OPs paradas em PREPARAÇÃO via Live (operadores marcando finalização)
   - Rodar "Calcular Custos" nos PVs pra preencher Análise Pós-OP
   - Setar `unit_price`/`min_stock`/`location` nos 133 produtos pra ativar gráficos de Estoque

2. **UX residual** (próxima rodada):
   - Expor `client_addresses` e `client_contacts` no ClientFormDialog
   - Implementar Pronta-Entrega completa (criar tabela + modal com cor/num/qtd/custo)
   - Charts Dashboard: separar Y-axes pra vendas (BRL) e produção (pares)
   - Timeline filtro Semana: incluir OPs em produção independente de `due_date`
