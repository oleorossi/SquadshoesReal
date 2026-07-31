# Auditoria NF-e — 31/07/2026

Auditoria do fluxo de emissão de NF-e (`emit-nfe`, `cancel-nfe`, `nfe-status`,
`sync-nfe-from-provider`) contra a **spec oficial da API ClickNotas**
(`clicknotas.apib`, 3.814 linhas) e contra os **payloads/respostas reais**
gravados em `nfe_emitidas.gc_request_payload` / `gc_detail_response`.

> **Status deste documento:** correções **aplicadas e deployadas** em 31/07
> (commits `a66be8c` e seguinte). As seções abaixo já refletem a verificação
> **ao vivo contra a API** feita depois da 1ª rodada.
>
> ### ⚠ Errata da 1ª versão (corrigida em 31/07, após acesso à API)
>
> A primeira versão deste relatório afirmou duas coisas **erradas**, ambas
> derivadas de ler a spec sem poder testar:
>
> 1. **"A paginação está quebrada porque a API usa `pagina`, não `page`."**
>    Falso. A API aceita **os dois** — `?page=2` e `?pagina=2` devolvem
>    `pagina_atual: 2` idêntico. O que existia de real era só a condição de
>    parada (`total_pages` × `total_paginas`), que fazia o loop terminar
>    apenas na primeira página vazia: **5 requisições, não 30**.
> 2. **"Os buracos de numeração são notas que o sync nunca alcançou."**
>    Falso. `257, 259, 260, 262, 263` são **devoluções** (`tipo_nf=0`,
>    `finalidade_nf=4`) e são **corretamente puladas** pelo sync;
>    `261, 275-277, 239-242, 233, 234, 226-231` **não existem na API**.
>    Não há nota perdida — o comportamento estava certo.
>
> Em compensação, o acesso à API revelou um bug **mais grave** que a leitura da
> spec não podia mostrar: `situacao_nf = "Reprovada"` virava `processando`
> (ver P0-4).

---

## 0. Sumário executivo

**O app não emite NF-e desde 18/06/2026.** A última nota gerada por `emit-nfe`
foi a **#278**, que era a 4ª tentativa do mesmo PV (`ref_nfe = nfe-…-r4`) e
acabou cancelada. As **9 notas seguintes (#279–#287, até 30/07)** entraram no
banco como `gc-sync-*` — ou seja, foram **emitidas manualmente no painel
ClickNotas** e importadas pelo cron de sync.

Consequência direta: o **cutover GestaoClick → ClickNotas** (commit `ff00fa5`,
09/07) **nunca foi validado com uma emissão real**.

Hipótese causal, sustentada pela cronologia:

| Data | Evento |
|---|---|
| 18/06 | Última emissão pelo app (#278) |
| **20/06** | `aff1909` — número da NF = último do GC + 1 (**+30 requisições/emissão**) |
| **20/06** | `9da35ea` — código do produto na NF (**nome de campo errado**) |
| 20/06 → | Zero emissões pelo app; operação migra pro painel |
| 09/07 | `ff00fa5` — cutover para `api.clicknotas.com`, sem emissão de teste |

O limite da API é **3 requisições/segundo**. A busca de número dispara até 30
chamadas em rajada **antes de cada emissão**, e todas contra a mesma página
(bug de paginação) — 429 quase garantido.

---

## 1. Teste de divergência — o que enviamos × o que a NF virou

Base: as 3 únicas notas com `gc_request_payload` **e** `gc_detail_response`
gravados (#255, #256, #278). As demais são anteriores ao logging forense ou
vieram do sync.

### 1.1 Onde bate (sem divergência)

| Campo | Enviado | Gravado | Nota |
|---|---|---|---|
| `valor_venda` (item) | `36.90` unitário | `442.80` (=12×36.90) | ✅ o GC multiplica pela quantidade — o comentário em `index.ts:854` está correto |
| `valor_total_nf` | 3494.00 / 41259.60 | idem | ✅ bate nas 3 notas |
| `quantidade` | 12.00 / 1104.00 | idem | ✅ |
| `NCM` | 64041100 / 64029990 | idem | ✅ |
| `codigo_cfop` | 5101 | 5101 | ✅ |
| `tipo_atendimento` | 9 | 9 | ✅ |
| `indicador_final` | 0 | `consumidor_final: 0` | ✅ |
| `pagamento` (duplicatas) | 3 parcelas | 3 idênticas | ✅ |
| `produto_id` | 92992985… | idem | ✅ |

> ⚠️ A doc contradiz a realidade em `valor_venda`: o exemplo do GET
> (`quantidade: 3`, `valor_venda: 48.00`, `valor_total_nf: 48.00`, linha 1899)
> sugere que o valor seria o total da linha. **A evidência de produção vence** —
> 12 × 36,90 = 442,80 no retorno. Não mexer nesse campo.

### 1.2 Onde diverge

| Campo | Enviado | Gravado | Causa |
|---|---|---|---|
| `codigo` (item) | SKU da ficha | `4715271514130` (EAN auto do GC) | **nome de campo errado** — a spec usa `codigo_produto` |
| `unidade` (item) | `PAR` (#255) | `UN` | ignorado; vem do cadastro do produto |
| `marca` (item) | `Squad Shoes` | *chave não existe no retorno* | campo inexistente na API |
| `transporte.*` (12 campos) | modFrete 3, transportadora, 157 volumes, 504,912 kg | *nenhuma chave de transporte no retorno* | bloco inexistente na API |
| `peso_bruto` / `peso_liquido` | 504.912 | ausentes | idem |
| `natureza_operacao` | "Operação não presencial, outros" (#255) | "Venda de Produção do Estabelecimento" | ignorado; vem do painel, casado pelo CFOP |
| `informacoes_complementares` | "OC do Cliente: 300102" (#278) | idem — **texto do Simples Nacional sumiu** | nosso texto **substitui** o do GC |

Comportamento observado no campo de informações complementares:

- **#256** — enviamos `null` → GC gravou
  `"I - DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL.\r\nII - NAO GERA DIREITO A CREDITO FISCAL DE IPI."`
- **#255** — enviamos `null` → GC gravou `""` (vazio)
- **#278** — enviamos texto → GC gravou **só o nosso texto**

Ou seja: quando mandamos algo, o aviso legal é perdido; quando não mandamos, o
comportamento **não é determinístico**.

### 1.3 Integridade da base

| Checagem | Resultado |
|---|---|
| NFs sem PV vinculado | **37** |
| PVs `Faturado` sem NF (todos com `nfe_required = true`) | **30** |
| Buracos na numeração | `226–231, 233, 234, 239–242, 257, 259–263, 275–277` |
| NFs em status `erro` (estado legado, nenhum `mapSituacao` produz) | 10 (`208, 210, 222–225, 232, 235, 236, 238`) |

**Os buracos NÃO são um defeito** (verificado contra a API em 31/07). A conta
tem **64 notas em 4 páginas**. Dessas:

- `257, 259, 260, 262, 263` — **devoluções** (`tipo_nf=0`, `finalidade_nf=4`,
  natureza "Devolução de venda de produção do estabelecimento"). O sync as pula
  de propósito, para não lançá-las como receita de saída. Correto.
- `261, 275–277, 239–242, 233, 234, 226–231` — **não existem na API**. Números
  nunca usados ou rascunhos deletados no painel.

**Situações reais de `situacao_nf` na conta** (varredura das 64 notas) —
importante porque duas delas não eram tratadas:

| `situacao_nf` | Notas |
|---|---|
| `Aprovada` | maioria |
| `Cancelada` | 209, 237, 243–247, 259, 260, 278, 284 |
| **`Reprovada`** | 222, 223, 224, 225, 232, 235, 236 |
| **`Corrigida`** | 208, 238 |
| `Em aberto` | 210 |

---

## 2. Achados contra a spec ClickNotas

Contagem literal de ocorrências no `.apib`:

```
transporte 0 · volume 0 · modalidade_frete 0 · marca 0
especie 0 · tipo_contribuinte 0 · peso_bruto 7 (só em /produtos)
```

### P0-1 · `codigo` deveria ser `codigo_produto`

**Arquivo:** `supabase/functions/emit-nfe/index.ts:852`

A spec (linhas 2082–2092) lista os campos do item que podem sobrescrever o
cadastro: `produto_id`, **`codigo_produto`**, `nome_produto`, `unidade`,
`quantidade`, `valor_venda`, `valor_custo`, `NCM`.

```diff
-        ...(codigoNf ? { codigo: codigoNf } : {}),
+        ...(codigoNf ? { codigo_produto: codigoNf } : {}),
+        nome_produto: nomeProduto,
```

O commit `9da35ea` (20/06) que atendeu o pedido do dono — "a NF deve mostrar o
NOSSO código, não o `codigo_interno` auto do ClickNotas" — usou o nome errado e
**nunca chegou a rodar em produção**. A reclamação continua de pé.

Mesmo diagnóstico para `unidade`: é campo documentado do item, mas o valor
enviado em #255 (`PAR`) foi descartado. Vale reenviar junto com
`codigo_produto` e conferir no teste.

### P0-2 · Remover `gcMaxNfNumber`

**Arquivo:** `supabase/functions/emit-nfe/index.ts:44-83` (função),
`:1227-1241` (chamada), `:1261-1263` (payload), `:1314` (warning do preview)

1. A parada lê `meta.total_pages` — **o retorno traz `total_paginas`**
   (confirmado ao vivo: `total_paginas: 4`, `total_registros: 64`). A condição
   nunca dispara, então o loop só para na primeira página **vazia**: hoje são
   **5 requisições** antes de cada emissão, contra o teto de 3 req/s.
2. `numero` não é campo documentado do POST.

> A 1ª versão deste relatório dizia que a paginação estava quebrada
> (`page` × `pagina`) e falava em 30 requisições. **Errado** — a API aceita os
> dois nomes e o loop terminava na página vazia. A remoção continua certa, mas
> pelo motivo mais modesto acima.

Além disso, `numero` **não é campo documentado do POST** — nas 3 notas com
payload gravado ele está `null`, então nunca foi exercido.

**Decisão (dono, 31/07): remover.** Evidência de que o GC numera corretamente
sozinho: as 9 notas emitidas no painel saíram **279 → 287 sem buraco**.

```diff
-async function gcMaxNfNumber(serie: string): Promise<number | null> { … }   // −40 linhas
-    const maxGc = await gcMaxNfNumber(serieAtual);                          // −15 linhas
-      ...(numeroProximo ? { numero: numeroProximo } : {}),
```

Ganho: −30 requisições por emissão e some o risco de número duplicado.

### P0-3 · Simples Nacional — reinserir o aviso legal

**Arquivo:** `supabase/functions/emit-nfe/index.ts:1064-1075`

`companies.regime_tributario = '1'` (Simples Nacional) para a Squad Shoes. O
aviso da LC 123/2006 é obrigatório e hoje é apagado pelo nosso texto.

**Decisão (dono, 31/07): prefixar no payload**, para não depender do
comportamento não-determinístico do GC.

```diff
+    // Simples Nacional (regime_tributario='1'): o aviso da LC 123/2006 é
+    // obrigatório. O GC injeta esse texto quando NÃO mandamos o campo — mas
+    // quando mandamos, ele SUBSTITUI (NF #278 saiu sem o aviso). Prefixamos
+    // com o texto exato que o painel usa (visto no detalhe da NF #256).
+    const avisoSimplesNacional = String(fiscal.regime_tributario) === "1"
+      ? "I - DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL.\r\n"
+        + "II - NAO GERA DIREITO A CREDITO FISCAL DE IPI."
+      : null;
     const informacoesComplementares = [
+      avisoSimplesNacional,
       ocPart,
       livrePart,
       order.numero_pv ? `Pedido de Venda: ${order.numero_pv}` : null,
       weightWarning,
     ].filter(Boolean).join(" · ") || undefined;
```

⚠️ O separador ` · ` fica estranho depois de um texto legal com quebra de
linha. Sugestão: emitir o aviso e o resto separados por `"\r\n"`, mantendo
` · ` só entre OC/PV/avisos.

⚠️ **Não quebrar o `extractPvNumber`:** o sync usa o regex
`/Pedido\s+de\s+Venda\s*:?\s*([A-Za-z0-9-]+)/i` sobre esse mesmo campo para
vincular a nota ao PV. O trecho `Pedido de Venda: PV-xxxxx` precisa continuar
presente e íntegro.

### P1-1 · `tipo_contribuinte` não existe em `/clientes`

**Arquivo:** `supabase/functions/emit-nfe/index.ts:611`

Mandamos `tipo_contribuinte: "1"|"2"` no POST/PUT de cliente. A spec de
`/clientes` (linhas 124–192) lista: `tipo_pessoa, nome, razao_social, cnpj,
inscricao_estadual, inscricao_municipal, cpf, rg, data_nascimento, telefone,
celular, fax, email, ativo, contatos, enderecos`. **Não há
`tipo_contribuinte`.**

Se ele é descartado, o indicador de IE do destinatário (`indIEDest`) nunca é
definido pelo nosso lado — que é **exatamente a Rejeição 696 que queimou 7 NFs
do PV-00104** em maio.

Mitigação já presente e correta: quando o cliente é isento, a IE sai vazia
(`(client.inscricao_estadual || "").replace(/\D/g,"")` transforma `"ISENTO"` em
`""`), que é a convenção que a maioria das emissoras usa para inferir
`indIEDest=2`. **Confirmar com o suporte** se é assim que o ClickNotas decide, e
conferir `destinatario_ie` no detalhe da nota de teste.

### P1-2 · 2º CNPJ emitiria sob a loja errada

**Arquivo:** `supabase/functions/emit-nfe/index.ts:111-135`

`companies.gestaoclick_loja_id` é **NULL nas duas empresas**. Com isso
`resolveGcLojaId` cai no fallback da matriz **e cacheia o resultado numa
variável global do isolate, sem chave por empresa**:

```ts
let _gcLojaIdCache: string | null = null;   // ← global, não por company_id
```

Emitir pela **Lrms** (`37902162000125`) produziria uma NF sob a loja da **Squad
Shoes**, com `cnpj_emitente` local divergente da nota real. Mesmo problema em
`_gcTransportadoraIdCache`.

**Correção mínima (não precisa de código):** preencher
`companies.gestaoclick_loja_id` das duas empresas com o `id` retornado por
`GET /lojas`.

**Correção de código:** trocar o cache escalar por `Map<companyId, lojaId>`.

**Guarda barata:** o payload já manda `loja_id`; o detalhe retorna
`cnpj_emitente`. Vale comparar depois da emissão e recusar/avisar se divergir do
`fiscal.cnpj`.

### P1-3 · Bloco `transporte` — decisão: MANTER

**Decisão do dono (31/07): manter, é inofensivo.** Registrado aqui com a
evidência para quem ler depois:

- `transporte`, `volume`, `modalidade_frete`, `especie` e `marca` têm **0
  ocorrências** na spec inteira.
- Nas 3 notas auditadas, a resposta do GC não traz **nenhuma** chave de
  transporte, peso, volume ou frete — só `valor_frete: "0.00"`.
- Portanto **modFrete, transportador, peso bruto/líquido e nº de volumes nunca
  chegam ao XML por esta API**, e nenhuma das 5 variantes de nome de campo
  (`modFrete`/`modalidade_frete`/`frete_por_conta`/`tipo_frete`/`frete`) muda
  isso. `NFE_VOLUME_FIELD` nunca será preenchido pelo suporte.
- Peso **tem** caminho: `peso_liquido`/`peso_bruto` no `POST /produtos`
  (spec linha 1263) — já enviamos no cadastro do produto.
- Se o transportador/volumes forem exigidos pela contabilidade, o caminho é o
  **painel**, não a API.

> ⚠️ **Item em aberto — separar payload de side-effect.** O *payload* é de fato
> descartado, mas `resolveGcTransportadoraEmitenteId` (`:146-211`) **não é
> payload**: ela faz `GET /transportadoras` e, se não achar, **`POST
> /transportadoras`**, criando um cadastro real no sistema fiscal do ClickNotas
> (já criou a `id=552868`). São 2 requisições por cold start + um registro que
> ninguém usa. Recomendo desligar **só essa função** (trocando por
> `companies.gestaoclick_transportadora_id`, opcional) e manter o resto do
> bloco como decidido. **Pendente de decisão.**

### P0-4 · `situacao_nf = "Reprovada"` virava `processando` ⭐ *(achado da verificação ao vivo)*

**Arquivos:** `emit-nfe`, `nfe-status` e `sync-nfe-from-provider` — as três
cópias de `mapSituacao`, mais `sefazRejected`/`isTerminal` em `emit-nfe`.

A conta usa **`Reprovada`** para rejeição da SEFAZ e **`Corrigida`** para nota
autorizada com CC-e aplicada. Nenhuma das duas casava com os predicados:

```
"reprovada".includes("aprovada")  →  false   ← não é substring!
"reprovada".includes("rejeitada") →  false
```

Ambas caíam no `return "processando"` final. Ou seja: **uma NF-e rejeitada pela
SEFAZ ficava eternamente "em processamento"** — o operador esperava uma
autorização que nunca viria, e o `emit-nfe` ainda dava 4 voltas de poll
desnecessárias porque `isTerminal()` também não reconhecia o valor.

Há **7 notas `Reprovada`** e **2 `Corrigida`** na conta.

```diff
 function mapSituacao(situacao: string): string {
   const s = (situacao || "").toLowerCase();
-  if (s.includes("aprovada") || s.includes("autorizada")) return "autorizada";
-  if (s.includes("cancelada")) return "cancelada";
-  if (s.includes("rejeitada") || s.includes("denegada") || s.includes("erro")) return "rejeitada";
+  // rejeição PRIMEIRO — "reprovada" não casa com nenhum predicado antigo
+  if (s.includes("reprovada") || s.includes("rejeitada") || s.includes("denegada") || s.includes("erro")) return "rejeitada";
+  if (s.includes("aprovada") || s.includes("autorizada") || s.includes("corrigida")) return "autorizada";
+  if (s.includes("cancelada")) return "cancelada";
   if (s.includes("processando") || s.includes("aberta") || s.includes("aguardando")) return "processando";
   return "processando";
 }
```

⚠ **Efeito no próximo sync:** as 10 notas hoje em `erro` serão reclassificadas —
`222, 223, 224, 225, 232, 235, 236` → `rejeitada`; `208` e `238` → `autorizada`
(são `Corrigida`, isto é, autorizadas com CC-e). O guard anti-ressurreição do
sync só bloqueia `erro → processando`, então não impede essas transições. Não há
efeito financeiro automático (a receita é reconhecida pelo frontend na emissão,
não pelo sync), mas **`208` e `238` passam a contar como notas válidas na lista**
— conferir com a contabilidade.

### P2-1 · `sync-nfe-from-provider` — condição de parada e 429

**Arquivo:** `supabase/functions/sync-nfe-from-provider/index.ts`

```diff
-      const totalPages = r.json?.meta?.total_pages || r.json?.meta?.pagination?.total_pages;
+      const totalPages = r.json?.meta?.total_paginas || r.json?.meta?.total_pages;
```

A paginação em si **funcionava** — a API aceita `page` e `pagina`. Padronizamos
no nome documentado (`pagina`) por segurança, mas o defeito real era só a
condição de parada, que fazia o loop rodar uma página vazia extra por rodada.

O `if (!r.ok) return 502` no meio do loop fazia **um 429 abortar o sync
inteiro**; agora o 429 apenas interrompe a paginação e processa o que já veio.

### P2-2 · Filtro de devolução lê campo inexistente

**Arquivo:** `sync-nfe-from-provider/index.ts`

```diff
-const _finalidade = String(d?.finalidade ?? d?.finalidade_nfe ?? d?.finNFe ?? "")
+const _finalidade = String(d?.finalidade_nf ?? d?.finalidade ?? d?.finNFe ?? "")
```

O campo real no retorno é **`finalidade_nf`** (spec linha 1822).

⚠ **Na prática nenhuma devolução escapou**: todas as 11 da conta têm também
`tipo_nf = 0`, capturado por `_isEntrada`. Era redundância cega, não bug vivo —
mas uma devolução de **saída** (`tipo_nf=1` + `finalidade_nf=4`) passaria direto
e entraria como receita. Corrigido por robustez.

### P2-3 · Sem throttle — 3 req/s

Uma emissão de 8 itens dispara hoje:

| Etapa | Requisições |
|---|---|
| `GET /cidades` | 1 |
| `PUT /clientes/:id` + retry + `GET` verify | 2–3 |
| `GET /produtos?nome=` + `POST /produtos` por item | até 16 |
| `GET /lojas` | 1 |
| `GET/POST /transportadoras` | 1–2 |
| `gcMaxNfNumber` | **até 30** |
| `POST /notas_fiscais_produtos` | 1 |
| poll do detalhe | 4–7 |
| **Total** | **~60** |

Teto: **3 req/s**, 30.000/dia. Remover o `gcMaxNfNumber` (P0-2) já corta
metade. Para o resto, um limitador simples (fila com 1 chamada a cada ~350 ms,
retry com backoff no 429) dentro do `gcFetch` resolve.

### P2-4 · `nfe-status` procura URLs que não existem

`nfe-status/index.ts` tenta 6 nomes de campo para DANFE/XML
(`url_danfe`, `danfe_url`, `url_pdf`, `link_pdf`, `url_pdf_danfe`, `link_danfe`).
**Nenhum existe na spec** — o detalhe não retorna URL de arquivo. `xml_url` e
`danfe_url` estão vazios em 100% das notas do banco.

`nfe-download` já está corretamente marcado como 410/deprecado, com o app
usando `meudanfe.com.br/consulta/{chave}`. É só remover o ruído do
`nfe-status`.

### P3 · `natureza_operacao` é decorativa

A spec avisa (linha 2046) que as naturezas precisam estar **previamente
padronizadas no painel** como *Venda / Venda para não contribuinte / Venda para
contribuinte / Cupom Fiscal / Compra*. O #255 enviou "Operação não presencial,
outros" (que nem é uma natureza) e o GC gravou "Venda de Produção do
Estabelecimento" — o campo do payload é ignorado.

Não é bug, mas o preview do `EmitDialog` mostra ao operador um valor que **não é
o que vai sair na nota**. Vale ou remover do preview ou marcar como
"definido no painel".

---

## 3. O que está correto (não mexer)

- **Claim atômico anti-dupla-emissão** (`:1422-1462`) — insere a linha
  `processando` **antes** do POST, deixando o índice único parcial rejeitar o 2º
  request com 23505 sem chamar a SEFAZ. Desenho certo.
- **`cancel-nfe`** — bate com a spec (`POST /notas_fiscais_produtos/cancelar/{id}`
  com `{motivo}`), respeita o limite de 200 caracteres, faz claim de status,
  valida a janela de 24h com o timezone correto (−03:00), estorna o financeiro
  antes de cancelar a AR (ordem certa) e é idempotente no estorno.
- **`envio_automatico: 1`** — confirmado pela spec (linha 2108) como a forma de
  transmitir no cadastro, contornando o 403 do método `/emitir`.
- **Validações pré-emissão** — NCM de 8 dígitos, CNPJ/CPF, endereço completo,
  IE × contribuinte de ICMS, soma dos itens × total do pedido, CFOP
  intra/interestadual. Boa cobertura; barram antes de queimar numeração.
- **Limite de 5 retentativas por PV** (`:365-376`) — resposta certa ao incidente
  do PV-00104.
- **`valor_venda` unitário** — comprovado pelos dados; a doc é que está errada.

---

## 4. Plano de execução

Ordem importa: as correções de código precisam preceder o teste real, e o teste
real precisa preceder qualquer emissão em volume.

| # | Ação | Onde | Status |
|---|---|---|---|
| 1 | Preencher `companies.gestaoclick_loja_id` das 2 empresas via `GET /lojas` | dados | ✅ **feito** — Matriz `565099` (Squad Shoes), LRMS `565120` |
| 2 | Confirmar `forma_pagamento_id = 6519268` (hardcoded em `:1084`, nunca revalidado após o cutover de 09/07) | dados | ✅ **existe** — "Boleto Bancário", `tipo: BB`, 12 parcelas, intervalo 30 dias |
| 3 | Remover `gcMaxNfNumber` (P0-2) | `emit-nfe` | ✅ aplicado |
| 4 | `codigo` → `codigo_produto` + `nome_produto` (P0-1) | `emit-nfe` | ✅ aplicado |
| 5 | Aviso do Simples Nacional (P0-3), preservando o `Pedido de Venda:` | `emit-nfe` | ✅ aplicado |
| 6 | Throttle + backoff no `gcFetch` (P2-3) | `emit-nfe` | ✅ aplicado |
| 7 | `Reprovada`/`Corrigida` no `mapSituacao` (P0-4) | 3 funções | ✅ aplicado |
| 8 | `total_paginas` + 429 + `finalidade_nf` no sync (P2-1, P2-2) | `sync` | ✅ aplicado |
| 9 | **`dry_run` contra um PV real** — conferir payload, duplicatas, IE, NCM | — | ⬜ **pendente** |
| 10 | **Emitir 1 PV real de valor baixo**, conferir DANFE, cancelar em <24h se divergir | produção | ⬜ **pendente** |
| 11 | Reconciliação (seção 5) | dados | ⬜ pendente |

**Checklist do passo 8** — conferir no detalhe da nota emitida:

- [ ] `codigo_produto` = SKU da ficha (não um EAN de 13 dígitos)
- [ ] `unidade` = `UN`
- [ ] `informacoes_complementares` contém o aviso do Simples Nacional **e** o
      `Pedido de Venda: PV-xxxxx`
- [ ] `destinatario_ie` coerente com contribuinte/isento
- [ ] `cnpj_emitente` = CNPJ da empresa escolhida
- [ ] `numero_nf` = próximo da série, sem buraco
- [ ] `valor_total_nf` = soma dos itens (sem frete)
- [ ] duplicatas com os vencimentos da condição de pagamento

---

## 5. Reconciliação de dados

### 5.1 NFs órfãs com PV identificável (casamento por destinatário + valor exato)

| NF | Valor | Destinatário | PV |
|---|---|---|---|
| 286 | 10.507,20 | LNG 10 CONFECCOES LTDA | **PV-00148** |
| 285 | 61.495,20 | LNG 10 CONFECCOES LTDA | **PV-00146** |
| 283 | 43.939,20 | LNG 10 CONFECCOES LTDA | **PV-00145** |
| 279 | 41.259,60 | LNG 10 CONFECCOES LTDA | **PV-00144** |

Essas 4 podem ser vinculadas com segurança. As demais 33 ou não têm candidato
(o PV não existe no sistema — venda direta do painel) ou têm **múltiplos**
candidatos com o mesmo valor (ex.: #258 e #248 casam com 4 PVs diferentes de
R$ 14.328,00) — exigem decisão humana.

### 5.2 PVs `Faturado` sem NF

**30 PVs**, todos com `nfe_required = true` (nenhum é informal):

```
PV-00104, PV-00107, PV-00108, PV-00109, PV-00110, PV-00111, PV-00115,
PV-2026-00004, PV-2026-00013, PV-2026-00049, PV-2026-00052,
PV-2026-00068 … PV-2026-00082, PV-2026-00084, PV-2026-00089 … PV-2026-00091
```

Cada um é ou (a) uma nota emitida no painel que não foi vinculada, ou (b) uma
venda faturada sem nota. A distinção é fiscal, não técnica — precisa da
contabilidade.

### 5.3 Causa estrutural

O vínculo NF↔PV depende de `extractPvNumber` achar `"Pedido de Venda: PV-xxx"`
nas informações complementares. **Notas emitidas no painel não têm esse texto**
— por isso 37 órfãs. Enquanto a emissão for pelo painel, o vínculo continuará
quebrando.

**Melhoria sugerida:** uma tela de reconciliação em `/nfe` que liste NFs órfãs
ao lado de PVs candidatos (mesmo destinatário, valor dentro de ±0,02) e permita
vincular com um clique. É a única forma sustentável enquanto o painel for um
caminho de emissão válido.

---

## 6. Melhorias além dos bugs

1. **Preview honesto.** O `EmitDialog` mostra hoje `modalidade_frete`,
   `transportador`, `qtd_volumes`, `peso` e `marca_xmarca` — **nenhum desses
   chega à nota**. O operador confere dados que não existirão no DANFE. Marcar
   como "não enviado à SEFAZ (definido no painel)" ou remover.
2. **Alerta de fluxo abandonado.** Um card em `/nfe` avisando "última NF emitida
   pelo sistema há N dias — as últimas M vieram do painel" teria exposto esse
   problema em junho, não em julho.
3. **`gc_request_payload` para todas as notas.** Só 3 de 61 têm o payload
   gravado. Sem ele, auditoria como esta é impossível. Já está implementado —
   só não rodou porque o fluxo parou.
4. **Status `erro` órfão.** 10 notas nesse estado, que nenhum `mapSituacao`
   produz. Ou mapear para `rejeitada`, ou documentar o que significa.
5. **Teste de contrato da API.** Um teste que valide os nomes de campo do
   payload contra a lista da spec teria pego `codigo` vs `codigo_produto` e
   `page` vs `pagina` no code review. Nesta base, os 3 bugs de nome de campo
   custaram 6 semanas de fluxo parado.
