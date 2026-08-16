# Auditoria do setor de Fichas Técnicas — 16/08/2026

## Resultado executivo

A ficha técnica já alimenta os motores de consumo, reserva, débito, custeio,
MRP e pedido de venda. A auditoria encontrou o motor principal consistente nas
unidades atuais, mas encontrou divergências na interface e no diagnóstico:

- o seletor de solado atualizava nome e grupo, porém não salvava
  `primary_sole_id`, que é o vínculo usado como fallback pelo motor;
- “Aplicar solado em massa” enviava o payload em formato incompatível com o
  hook de atualização e não copiava o UUID do solado;
- a auditoria exigia cabedal de modelos de tiras, placa de palmilha pronta e
  mapeamento local mesmo quando havia regra global por cor;
- a ficha permitia editar `fachete_material`, mas reserva/débito/custeio usam o
  grupo de fachete do produto-solado, com fallback para a forração da ficha;
- snapshots históricos eram apresentados junto de pendências acionáveis.

As correções mantêm uma fonte de verdade para cada conceito e introduzem uma
linha de prontidão: **Identificação → Engenharia → Estoque → Produção →
Liberação**.

## Evidência do banco vivo antes da correção

- 53 fichas: 13 publicadas e 40 rascunhos; 43 já usadas em pedidos de venda.
- 0 produtos referenciados com unidade não canônica.
- 0 conversões inválidas entre unidade de compra e estoque.
- 0 materiais de área atualmente sem largura para dm² → metro linear.
- 0 lacunas atuais de specs de solado na faixa vendida.
- `consumption_consistency_report()` sem divergências ativas.
- 113 snapshots históricos marcados como desatualizados, mas nenhum PV aberto
  com reservas desatualizadas.
- o relatório legado dizia 0/53 fichas completas e 53 solados sem specs; os
  falsos positivos vinham de ignorar `primary_sole_id` e construções especiais.

Furos de débito encontrados em OPs antigas finalizadas/canceladas continuam
somente no diagnóstico. Eles não foram debitados retroativamente, preservando a
decisão de não alterar inventários históricos já conferidos. OP aberta com
reserva `soft` também não é tratada como furo: a baixa ocorre na finalização.

## Mapa canônico: ficha → estoque/PV

| Origem da ficha | Como resolve | Unidade/baixa |
|---|---|---|
| Cabedal e forração | pin da variante/ficha, depois grupo + cor do PV | consumo em dm²/par convertido pela largura da ficha de componente para `m` |
| Palmilha cortada | grupo + cor; geometria por numeração do solado | dm²/par convertido em `placa` ou unidade física cadastrada |
| Palmilha pronta | coligação de cor do solado | `un`/`par`; não consome placa |
| Solado | variante, regra global de cor e `primary_sole_id` | por numeração em `stock_grade`, nunca por área |
| Tiras | família/medida e cor do item do PV | unidade nativa do catálogo, sem exigir cabedal principal |
| BOM (`sheet_materials`) | produto exato ou grupo da variante | unidade-base de `products.unit`; área usa largura quando aplicável |
| Componentes diretos/por cor | produto exato | `un`, `par`, massa, volume ou unidade-base cadastrada |
| Fachete | grupo no produto-solado; fallback para forração | consumo por numeração em `sole_technical_specs` |
| Embalagem | configuração central do tipo de solado | debitada pelo fluxo de embalagem, não duplicada na ficha |

Não existe acréscimo de perda de corte: os consumos cadastrados já representam
o rendimento real e adicionar margem duplicaria a perda.

## Critérios industriais usados

- BOM, ficha de dados e lista de operações precisam compartilhar o mesmo dado
  mestre com ERP/MRP, evitando redigitação entre engenharia e produção. Referência:
  [Lectra/Kubix Link — La Sportiva](https://www.lectra.com/en/library/la-sportiva-digitalization-and-collection-management-with-kubix-link).
- desenvolvimento técnico, planejamento da produção, qualidade e normas são
  competências integradas no processo calçadista. Referência:
  [SENAI — Técnico em Calçados](https://www.sp.senai.br/curso/tecnico-em-calcados/99068).
- a numeração precisa permanecer ligada ao padrão de tamanho e ao solado, pois
  consumo e estoque são segmentados por grade. Referência:
  [ISO/TC 137 — Footwear sizing designations and marking systems](https://www.iso.org/committee/52496.html).
- alterações precisam ser rastreáveis até pedidos e lotes afetados. Referência:
  [ISO — traceability in supply chains](https://www.iso.org/news/2017/02/Ref2159.html).

## Correções implementadas

1. Persistência de `primary_sole_id` ao selecionar o solado.
2. Aplicação em massa com payload correto e cópia conjunta de UUID, grupo,
   consumo e processo.
3. Backfill determinístico das fichas antigas sem UUID do solado.
4. Auditoria condicional para tiras, palmilha pronta, forração opcional e regras
   globais de cor.
5. Auditoria por ficha de unidade, taxa de conversão e largura de materiais de
   área.
6. Fonte do fachete exibida como somente leitura, com edição centralizada no
   setor de Solados.
7. Linha de prontidão com uso em PV, OPs abertas e apenas sincronizações
   acionáveis.
8. Ações secundárias reunidas em “Ferramentas”, mantendo Auditoria e Nova Ficha
   como decisões principais.

## Verificação pós-correção

- os três falsos positivos medidos caíram para zero;
- 47 fichas antigas receberam `primary_sole_id`; 6 permaneceram pendentes por
  não terem grupo/produto de solado resolvível com segurança;
- 4 fichas já atendem todos os bloqueios críticos de prontidão; as demais agora
  mostram pendências reais de cadastro, sem usar “MOD ausente” como bloqueio;
- NL01–NL04 continuam no diagnóstico baixo de forração legada, porém o motor
  canônico suprime essa linha quando ela representa o mesmo forro de palmilha;
  portanto não há débito duplo. O dado foi mantido para não alterar engenharia
  histórica sem uma decisão de cadastro.

## Guardas de regressão

- testes unitários da prontidão e da aplicação em massa;
- contrato que trava o vínculo do solado, o payload de mutation e a fonte única
  do fachete;
- testes existentes de consumo TS, BOM e unidades;
- auditoria SQL reaplicável em `scripts/audit-technical-sheets-live.sql`.
