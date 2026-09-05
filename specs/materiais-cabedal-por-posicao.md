# Materiais de cabedal por posição

Estado: **seleção de material por posição linear implementada e verificada;
publicação em andamento**. Peças de cabedal medidas por área continuam fora desta
implementação, aguardando a definição de engenharia descrita abaixo.

## Objetivo integral

Permitir que as posições hoje exibidas na seção Tiras possam usar materiais de
cabedal diferentes entre si, além das cores independentes já existentes. A
configuração precisa chegar ao pedido, ao consumo, à reserva/débito e à ficha
de operador de Aviamento sem perder a sequência técnica.

Referência visual fornecida pelo dono:
`/Users/leonardomonnerat/.codex/attachments/6258a078-c0f7-4eee-8f7b-b387254e2938/image-1.png`.

O objetivo amplia a exclusão explícita de material-base por posição da spec
[Cores independentes](cores-independentes-por-tira-no-pv.md). Não basta manter a
base única atual nem cadastrar mais receitas para declarar esta entrega pronta.

## Distinção de consumo a confirmar com o dono

Foi perguntado se as posições representam peças de cabedal por área, tiras
lineares ou ambos na mesma ficha. A imagem tem um formulário em cm/pé, mas a
solicitação inclui material utilizado no cabedal; isso não prova a unidade do
componente que o dono quer configurar.

| Tipo de posição | Entrada de engenharia | Cálculo obrigatório |
|---|---|---|
| Tira linear fabricada | Família, medida, material e cm por pé/numeração | cm/par para metros; matéria-prima pela receita/rendimento específico do material |
| Peça de cabedal por área | Material e dm² por par/numeração | Área para unidade física pela largura/dimensões da ficha de componente |

Não converter consumos cadastrados automaticamente ao mudar o tipo. Uma peça
por área não deve exigir família/medida de tira nem passar por receita linear.
Uma tira linear não pode usar dm² como se fossem centímetros. Não inventar
consumo, largura, rendimento ou preço para preencher dados ausentes.

## Evidências da auditoria inicial de 05/09/2026 (antes desta implementação)

- `technicalStrapLines.ts` e `strapIdentity.ts` preservam UUID técnico e política
  de cor, mas só reconhecem `reference_base` e `finished_product_group`. A
  primeira identidade limpa o grupo explícito e herda uma base comum.
- `TechnicalSheets.tsx`, seção Range Aviamento, exige família/medida para toda
  posição. O PV desktop/mobile escolhe cor, não material por posição.
- `referenceStrapBaseGroups.ts` lista grupos indivisíveis. O grupo
  **NAPA SOFT + MASSABOX** é um SKU composto acabado, não duas necessidades de
  estoque. A migration `20270101014800_sp124_composite_upper_guards.sql` protege
  essa distinção; suas camadas não devem ser explodidas ao selecionar material.
- A ficha SP124 instalada aponta esse grupo composto, com
  `components_accessories=[]` e `strap_colors=[]` na consulta da auditoria. A
  configuração não salva da imagem não autoriza preencher a ficha no banco.
- `components_accessories`, com `mandatory=true`, já soma materiais extras de
  cabedal por grade. Isso não oferece seleção comercial por posição. O motor
  TS ignora entradas que tenham `id`; uma nova identidade de peça exige campo
  próprio ou mudança coordenada desse contrato.
- `ensure_sale_order_internal_strap_intents`, o guard de alinhamento e o
  resolvedor de base instalados ainda calculam uma base por referência/variante,
  antes de percorrer as posições. A migration 154 alterou apenas a cor.
- Preview, diagnóstico, manifesto offline e `orderConsumption.ts` compartilham
  essa premissa de base única. Alterar apenas o seletor visual seria incorreto.
- As demandas canônicas já preservam por posição a variante, receita, produto
  base/acabado e snapshot de identidade. São infraestrutura a reaproveitar.
- O worktree `CODE-multiple-strap-materials-safe`, commit `c5128d2`, é ancestral
  de `main`. Seu cadastro de até 25 receitas por família/medida já foi integrado;
  não há implementação nova de seleção por posição para trazer daquele local.

## Contratos da entrega completa

1. Cada posição tem identidade técnica estável, independente do nome, índice,
   material e cor; reordenação não pode trocar uma escolha entre posições.
2. A ficha determina o tipo de consumo e os materiais permitidos por posição.
   A política material deve ser separada da origem interna/compra pronta e da
   política de cor. Usar `finished_product_group` para liberar matéria-prima de
   cabedal mudaria indevidamente o débito.
3. O PV respeita a configuração técnica e conserva material e cor por posição.
   Mudança da variante principal não pode sobrescrever seleções próprias que
   continuem válidas. Seleção inválida deve bloquear a gravação com mensagem
   que identifique a posição.
4. O servidor reidrata a configuração por UUID técnico e valida grupo, cor,
   produto oficial e receita quando aplicável. Não confia em material, política,
   rendimento ou consumo adulterados no payload comercial.
5. Resolver base e pin dentro da identidade de cada posição. Locks usam ordem
   estável de identidades; a ordem visual permanece a sequência da ficha.
6. Snapshot comercial, origem, demanda, reserva e débito devem apontar para o
   mesmo material físico. Pedidos já comprometidos não são recalculados pela
   ficha atual; nenhuma reescrita ou reconciliação histórica em massa.
7. Mesma base repetida em duas posições soma ambas as contribuições. Materiais
   diferentes não são agrupados apenas porque têm a mesma cor, família ou medida.
8. Peças detalhadas de cabedal não podem ser somadas novamente sobre o consumo
   total legado do mesmo cabedal. Matéria-prima já debitada na fabricação da
   tira não pode sofrer outra baixa como peça de cabedal da OP.
9. Manter conversões canônicas, ausência de perda adicional e finalização
   tolerante com `pending_reconciliation` quando faltar estoque.
10. Atualizar desktop, mobile e manifesto offline, incluindo cópia/edição e
    identificação de itens duplicados, sem normalizador apagar a nova política.
11. Aviamento e impressões existentes mostram posição, material e cor efetivos
    do snapshot. Grupos compostos continuam indivisíveis. OPs materialmente
    diferentes nunca compartilham uma ficha apenas pela sequência de cores.
12. Publicar e verificar frontend/banco/backend do mesmo commit pelo gate
    CI → migrations → Edge/Vercel, sem a integração nativa de produção de main.

## Progresso e verificação

### Implementado na branch `codex/cabedal-materiais-por-posicao`

- Política técnica independente da origem e da cor: `material_mode` aceita
  `follow_reference`, `fixed_group` ou `select_on_order`. Material fixo usa
  `material_group_id`; escolha comercial exige uma lista explícita de 1 a 25
  `allowed_material_group_ids`. Grupos são UUIDs indivisíveis, inclusive o
  composto NAPA SOFT + MASSABOX. Compra pronta não recebe política de base.
- Editor na ficha, seleção material/cor no PV desktop e no mobile, manifesto
  offline versão 2 e persistência dos rascunhos. Catálogo antigo não é tratado
  como capaz de autorizar o novo fluxo. Trocar uma posição invalida somente sua
  origem; mudar a variante principal preserva escolhas próprias ainda válidas.
- Snapshot comercial e de origem preservam `base_group_id`/`base_group_name`;
  a origem também conserva produto-base, variante e receita exatos. Itens com
  materiais diferentes não são mesclados como duplicatas.
- Migration `20270101016100_materiais_por_posicao_tira.sql`: validação técnica,
  resolução por UUID da posição, materialização por base/cor, writer reidratado,
  guard do item, preview, manifesto, diagnóstico e guarda de confirmação.
  Helpers privados sem EXECUTE público. Nenhum dado histórico é reescrito.
  As versões 159/160 pertencem ao trabalho financeiro separado; esta migration
  não depende delas e não as inclui.
- Consumo e agrupamento distinguem a identidade física/material, não só o nome.
  A/B/A soma as duas contribuições A e mantém B separado. As fichas de operador
  rica e rápida mostram a sequência, material e cor congelados. Snapshot
  canônico não é completado pela ficha viva, preservando inclusive zero explícito.
- As posições continuam lineares, com a entrada existente em cm/pé e snapshot
  em cm/par. Matéria-prima é calculada pela receita/rendimento do material.
  Não há conversão automática para área nem novo débito de cabedal paralelo.

### Evidências e limites de verificação

- Testes automatizados cobrem política, editor real renderizado, seleção desktop,
  mobile/offline com IndexedDB, cópia, reconciliação histórica, consumo e impressão.
  Rodada integral: 4.186 testes aprovados, 8 ignorados e nenhuma falha
  (`bun run test --maxWorkers=4 --testTimeout=15000`). O tempo adicional foi
  necessário para a consulta inicial de RLS: falhou por timeout de 5 segundos
  na suíte e passou isoladamente, com os cinco testes de segurança aprovados.
  Build de produção, TypeScript canônico, gate ESLint contra `origin/main`,
  tokens e nomes acessíveis sem regressões passaram.
- Ensaio PostgreSQL efêmero (PGlite), com definições reais das funções e schema
  relevante, dados sintéticos e rollback: writer/materializador A/B/A, bases
  distintas, pin, receitas, payload adulterado, preview 10/20/30 m e rendimentos
  100/60, manifesto v2, material ausente, atomicidade após a primeira posição e
  histórico aprovado sem demanda passaram. Adaptadores locais limitados a auth
  e SHA256; nenhuma função de domínio substituída por mock.
- Ensaio ampliado: enfileiramento real A/B/A gerou três contribuições, duas
  variantes e produto/receita/base corretos por UUID; replay não duplicou o job.
  A regressão sintética de cinco posições e três cores também passou, mantendo
  o modo material legado e permitindo cor principal não canônica quando todas
  as posições têm cores independentes. Promoção de rascunho com política técnica
  alterada foi recusada mesmo mantendo exatamente o mesmo SKU/cor/receita.
- Complemento operacional executado com funções reais e seis gatilhos centrais
  de estoque/reserva: worker, reconciliação, início do lote, recebimento, vínculo
  da reserva acabada à OP e settlement canônico passaram. A gerou 40 m de tira
  com 0,4 m de matéria-prima; B gerou 20 m com 0,333333333 m. As três posições
  consumiram 10/20/30 m; o saldo acabado terminou em zero e as demandas foram
  atendidas, sem debitar a matéria-prima de novo. Replay de recebimento e de
  settlement não duplicou movimentos. Teste preservado separadamente em
  `supabase/tests/strap_material_positions_physical_e2e.sql`.
- O ambiente descartável não replica todo o conjunto de FKs, RLS e gatilhos de
  produção. A aquisição do job foi preparada manualmente, não pela infraestrutura
  de cron. Não é prova de concorrência real, de todas as transições automáticas
  da OP nem da UI autenticada ponta a ponta. Testes ignorados continuam ignorados.
- A primeira tentativa visual foi inconclusiva (Chrome sem resposta e navegador
  interno indisponível), mas a alternativa `agent-browser` headless funcionou.
  O componente real, com CSS/fontes reais e dados sintéticos, passou pelos três
  modos com cliques: material fixo composto, dois materiais permitidos e seguir
  referência. UUIDs, medida e consumos intactos; sem erros, alertas ou overflow.
  Essa conferência cobre o editor isolado, não todo o fluxo autenticado do PV.
- Revisão independente das funções instaladas e consumidores TS: o resolvedor
  antigo de base global está órfão e o débito legado é no-op. O caminho canônico
  mantém UUID da posição, produto-base, receita e rendimento até a reserva,
  lote, recebimento e baixa. Nenhum P1/P2 confirmado nessa revisão; ela é leitura
  de código, não um ensaio completo de baixa em produção.
- CI do PR 195 aprovado integralmente no commit `33bcc1e`, com o timeout padrão,
  antes da integração fast-forward em main. O workflow de produção deve usar a
  revisão final, incluindo este registro e o teste operacional adicional.
- **Pendente nesta entrega linear:** concluir a publicação pelo CI e verificar a
  versão instalada. Peças medidas por área constituem uma extensão separada,
  ainda dependente de definição; não inventar consumos nem reinterpretar cm/pé.

### Publicação e contingência

- Preservar o gate existente: CI integral do commit → migrations → Edge/Vercel.
  Não publicar diretamente pela integração Git nativa de main nem aplicar SQL
  fora do histórico de migrations. Main deve conter só o trabalho desta branch;
  as alterações financeiras isoladas não fazem parte desta entrega.
- Atenção à próxima entrega financeira: se 159/160 continuarem inéditas quando
  161 já estiver no banco, revisar seus carimbos antes do primeiro deploy. O
  workflow usa `db push` sem `--include-all`, portanto não insere automaticamente
  migrations anteriores à última versão remota. Não renumerar migrations já
  aplicadas nem alterar aquela branch como parte desta entrega.
- Se o CI ou a aplicação da migration falharem, não liberar o frontend. Após a
  publicação, verificar versão 2 do manifesto, políticas/ACL e SHA do deploy.
- Navegadores mobile que mantenham o bundle antigo precisam atualizar para usar
  o manifesto v2; o cache v1 não autoriza escolhas de material por posição.
- Em falha funcional, interromper novas configurações por posição e preparar
  correção compatível. Não apagar os novos campos ou restaurar resolvedor global
  sobre pedidos já confirmados; não refazer históricos nem debitar estoque
  retroativamente. Uma reversão apenas visual não desfaz a migration do banco.

## Testes de aceitação necessários

- Dois materiais e três cores no mesmo pedido; mesmo material repetido;
  rendimentos diferentes por material quando forem tiras lineares.
- Grupo composto acabado versus material puro, sem explosão de camadas.
- Consumo por grade com zero explícito; unidade ausente/divergente; proibição de
  converter cadastro ao trocar tipo de posição sem nova informação de engenharia.
- Receita/SKU/cor ausentes, payload adulterado e duas confirmações concorrentes:
  falha atômica sem persistência parcial ou débito duplicado.
- Alterar e reordenar ficha depois da confirmação: snapshot histórico intacto.
- Seleção desktop/mobile/offline; copiar e reabrir PV; combinações materialmente
  distintas não mescladas como duplicatas.
- Consumo TS/SQL, demanda, reserva, realização e baixa do mesmo material físico.
- Aviamento rico e impressão rápida: sequência, material e cor por posição,
  sem agrupamento entre materiais distintos nem perda de legibilidade.
