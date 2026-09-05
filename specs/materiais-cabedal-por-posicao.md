# Materiais de cabedal por posição

Estado: **em desenvolvimento; seleção por posição ainda não implementada**.

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

## Evidências da auditoria de 05/09/2026

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

- Pré-requisito de impressão implementado nesta branch:
  `operatorStrapGroupingSignature` passa a considerar identidade de origem,
  grupo de identidade, grupo e nome do material presentes no snapshot. O
  fallback legado e a ordem técnica permanecem. Isso protege os campos atuais;
  a futura identidade material por posição também deverá entrar na assinatura.
- Cinco testes adicionados: origem distinta; dois identificadores de grupo;
  material composto versus puro; compatibilidade legada/grafia. Quatro deles
  reproduziram o agrupamento incorreto antes da correção.
- Verificação do pré-requisito: 38 testes focados aprovados em quatro arquivos,
  TypeScript canônico e ESLint dos arquivos alterados aprovados. Revisão
  independente sem bloqueio para esse diff. Não é prova do novo fluxo completo.
- **Não concluídos:** definição do tipo de posição, editor, seleção/persistência
  comercial por posição, resolvedores SQL, preview/offline, consumo físico,
  reserva/débito e verificação operacional da nova configuração.

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
