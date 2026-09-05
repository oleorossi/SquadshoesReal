# Variação do material dublado

## Regra aprovada em 05/09/2026

Ao escolher outro material principal para uma referência com cabedal dublado,
substituir somente a camada externa que fornece a cor. As camadas estruturais
continuam iguais. Se a forração usa o material dessa camada externa, acompanha
o material principal puro.

| Versão da I701 | Cabedal | Forração |
|---|---|---|
| Tradicional | NAPA SOFT + MASSABOX | NAPA SOFT |
| Glow | GLOW METALIC + MASSABOX | GLOW METALIC |

O dono informou: dublado Glow custa R$ 2,00/m acima do tradicional e tem as
mesmas dimensões. O tradicional em metros custa R$ 43,54/m; o novo custa
R$ 45,54/m. Largura 1370 mm, comprimento cadastral 1000 mm e espessura 1 mm.
Novos produtos começam sem saldo. As cores vêm dos produtos ativos de Glow:
CHAMPAGNE, PRATA, COBRE e OURO LIGHT.

## Diagnóstico

A variante Glow da I701 já existia, com material principal Glow e sem exceção
de cabedal. A proteção de cabedal composto mantinha `variant_drives_upper=false`,
preservando NAPA SOFT + MASSABOX inteiro. A forração já seguia o principal.
Não havia grupo nem produtos Glow + Massa Box no catálogo.

A proteção contra perder o Massa Box é correta. Faltava localizar o composto
equivalente ao trocar a camada externa.

## Implementação e sequência de entrega

1. **Comparar composições.** Usar `product_group_layers`, identificando uma única
   fonte de cor por UUID e comparando o multiconjunto das camadas fixas. Nomes e
   setores não determinam equivalência. Mais de um candidato exige escolha
   explícita; o sistema não escolhe pelo estoque nem pela ordem da consulta.
2. **Resolver no cadastro da variante.** Mostrar o cabedal resultante e a
   forração. Gravar `upper_material_group_id` com o composto e, quando a forração
   original for a fonte externa, `lining_material_group_id` com o material puro.
   Preservar exceções explícitas. Ao trocar o principal, recalcular os pins que
   correspondem ao principal anterior. Vale para criar, editar e duplicar.
3. **Preparar composição ausente.** A RPC `prepare_composite_upper_variant`
   reutiliza um composto equivalente ou cria somente grupo/camadas, com os
   mesmos controles de acesso de Grupos. O usuário cadastra cores, medidas e
   custo do acabado. Sem produtos ativos a variante não é salva como pronta.
   Valores físicos e econômicos não são inferidos de um material puro.
4. **Completar a I701.** Cadastrar quatro produtos do novo composto conforme os
   valores aprovados e corrigir somente a variante Glow da I701. Validar em
   transação antes de aplicar, depois confirmar resolvers, cores, custos e
   fichas de componente no banco real.
5. **Publicar e verificar.** Typecheck da aplicação, testes de comportamento do
   diálogo, testes do resolver de composição e SQL transacional. Publicação
   pelo pipeline CI → migrations → Vercel no mesmo commit.

## Invariantes

- `variant_drives_upper` continua desligado para cabedal composto.
- Cabedal debita um SKU acabado de dublado. A lista de camadas é cadastral;
  não gera débito adicional de Glow puro ou Massa Box.
- Materiais adicionais obrigatórios do cabedal, sem produto fixado e do
  mesmo grupo do cabedal original, também acompanham a variante. Suas áreas
  continuam somadas ao consumo principal. Produtos fixados, sobras e
  materiais de outros grupos preservam sua identidade.
- Forração usa seu próprio SKU de Glow puro.
- Área por par e conversão pela largura da ficha de componente continuam nos
  motores existentes; não há perda de corte adicional.
- Não mudar outras referências, pedidos, snapshots, reservas ou custos históricos.
- Grupo puro, família ou composto com camadas fixas divergentes não substituem
  automaticamente o dublado.
- Preparação repetida reutiliza a composição; conflitos de composição ou de
  nome são reportados, sem fusão de cadastros.

## Arquivos centrais

- `src/lib/compositeMaterialVariant.ts`: resolução estrutural e vínculo da forração.
- `src/components/technical-sheets/MaterialVariantsTab.tsx`: prévia e persistência.
- Migration `20270101016200`: preparação de composição com validação no servidor.
- Migration `20270101016300`: cadastro aprovado e correção da I701.
- `supabase/tests/prepare_composite_upper_variant.sql`: contratos transacionais.

## Limite intencional

Compostos futuros que ainda não possuem cadastro exigem informar suas cores,
medidas e custo antes de liberar a variante. O acréscimo de R$ 2,00/m foi
aprovado para Glow + Massa Box e não vira uma regra universal de preço.
