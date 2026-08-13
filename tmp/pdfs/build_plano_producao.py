from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.colors import HexColor

OUT = 'output/pdf/plano-correcoes-auditoria-producao.pdf'

pdfmetrics.registerFont(TTFont('DejaVu', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
pdfmetrics.registerFont(TTFont('DejaVu-Bold', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'))

NAVY = HexColor('#102A43'); BLUE = HexColor('#1D4ED8'); RED = HexColor('#B42318')
AMBER = HexColor('#B54708'); GREEN = HexColor('#027A48'); SLATE = HexColor('#475467')
PALE = HexColor('#F8FAFC'); LINE = HexColor('#D0D5DD')

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleX', fontName='DejaVu-Bold', fontSize=22, leading=28, textColor=NAVY, spaceAfter=8))
styles.add(ParagraphStyle(name='Sub', fontName='DejaVu', fontSize=10.5, leading=15, textColor=SLATE, spaceAfter=12))
styles.add(ParagraphStyle(name='H1X', fontName='DejaVu-Bold', fontSize=15, leading=20, textColor=NAVY, spaceBefore=10, spaceAfter=7))
styles.add(ParagraphStyle(name='H2X', fontName='DejaVu-Bold', fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=8, spaceAfter=5))
styles.add(ParagraphStyle(name='BodyX', fontName='DejaVu', fontSize=8.8, leading=12.5, textColor=HexColor('#1D2939'), spaceAfter=5))
styles.add(ParagraphStyle(name='Small', fontName='DejaVu', fontSize=7.5, leading=10, textColor=SLATE))
styles.add(ParagraphStyle(name='Cell', fontName='DejaVu', fontSize=7.4, leading=9.2, textColor=HexColor('#1D2939')))
styles.add(ParagraphStyle(name='CellBold', fontName='DejaVu-Bold', fontSize=7.4, leading=9.2, textColor=HexColor('#1D2939')))
styles.add(ParagraphStyle(name='CellWhite', fontName='DejaVu-Bold', fontSize=7.4, leading=9.2, textColor=colors.white))

def p(text, style='BodyX'):
    return Paragraph(text, styles[style])

def badge(label, color):
    t = Table([[p(label, 'CellWhite')]], colWidths=[27*mm])
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),color),('TEXTCOLOR',(0,0),(-1,-1),colors.white),('ALIGN',(0,0),(-1,-1),'CENTER'),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('BOX',(0,0),(-1,-1),0,color),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
    return t

def table(rows, widths, header=True):
    data = [
        [p(str(c), 'CellWhite' if header and ri == 0 else 'Cell') for c in row]
        for ri, row in enumerate(rows)
    ]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
    st=[('GRID',(0,0),(-1,-1),0.35,LINE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]
    if header: st += [('BACKGROUND',(0,0),(-1,0),NAVY),('TEXTCOLOR',(0,0),(-1,0),colors.white)]
    for r in range(1 if header else 0, len(rows)):
        if r % 2 == 0: st.append(('BACKGROUND',(0,r),(-1,r),PALE))
    t.setStyle(TableStyle(st)); return t

def footer(canvas, doc):
    canvas.saveState(); canvas.setFont('DejaVu', 7.5); canvas.setFillColor(SLATE)
    canvas.drawString(18*mm, 12*mm, 'Squad Shoes - Plano de correcoes de Producao')
    canvas.drawRightString(192*mm, 12*mm, f'Pagina {doc.page}')
    canvas.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=A4, rightMargin=16*mm, leftMargin=16*mm, topMargin=15*mm, bottomMargin=18*mm)
story=[]
story += [p('Plano de correcoes', 'TitleX'), p('Auditoria completa de Producao, lead time, fichas tecnicas, reservas e baixas de estoque', 'Sub')]
story.append(Table([[badge('PRIORIDADE: CRITICA', RED), p('<b>Versao:</b> 13/08/2026<br/><b>Escopo:</b> Producao, PCP, Kanban, Estoque, Compras e Fichas Tecnicas<br/><b>Metodo:</b> leitura de codigo, migrations, diagnosticos e testes locais. Nenhum dado foi alterado.', 'BodyX')]], colWidths=[35*mm, 140*mm], style=[('VALIGN',(0,0),(-1,-1),'MIDDLE'),('BACKGROUND',(0,0),(-1,-1),HexColor('#FFF7ED')),('BOX',(0,0),(-1,-1),0.5,HexColor('#FED7AA')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
story += [Spacer(1,10), p('Decisao executiva', 'H1X'), p('Nao iniciar uma reconciliacao historica automatica. Primeiro, fechar os controles que impedem novos furos; depois medir o banco de producao com acesso autenticado e tratar as pendencias por lote auditavel. O maior risco atual nao e o calculo de consumo: e permitir que a operacao avance apesar de material indisponivel, apontamento inconsistente ou baixa pendente.', 'BodyX')]
story += [p('Fluxo-alvo apos as correcoes', 'H2X'), table([
    ['1. Planejar','Uma agenda canônica por OP, considerando capacidade, calendario util, material e prazo fornecedor.'],
    ['2. Liberar','Corte bloqueado quando faltar material/OC; override exige justificativa e trilha.'],
    ['3. Produzir','Apontamento nao pode pular rota com saldo parcial; estado da OP deriva do menor setor pendente.'],
    ['4. Consumir','Reserva vira baixa idempotente no evento fisico definido por componente/setor.'],
    ['5. Finalizar','Saldo faltante vira conciliacao visivel, nunca cancelamento silencioso.'],
], [35*mm,140*mm])]
story += [Spacer(1,8), p('Mapa de prioridades', 'H1X'), table([
    ['Ordem','Frente','Severidade','Resultado exigido'],
    ['0','Evidencia viva e congelamento seguro','Critica','Numeros atuais medidos antes de qualquer ajuste de dado.'],
    ['1','Gate de material no Corte','Critica','Nenhuma OP inicia sem material/OC ou override auditado.'],
    ['2','Integridade do fluxo de etapas','Critica','Nao ha pulo parcial, dupla localizacao ou falsa conclusao.'],
    ['3','Baixa por evento fisico','Alta','Estoque acompanha WIP e conserva idempotencia.'],
    ['4','Agenda unica e lead time','Alta','OP, Kanban, onda e compras mostram as mesmas datas.'],
    ['5','Furos, reservas e saldo','Alta','Pendencias atuais classificadas e reconciliadas por aprovacao.'],
    ['6','Ficha tecnica e qualidade de consumo','Alta','Nenhum componente orfao ou consumo sem cobertura tecnica.'],
    ['7','Compras e embalagem','Media','Compra sem prazo nao vira promessa; politica de embalagem definida.'],
    ['8','Confiabilidade do Kanban e dados historicos','Media','Sinais de fila corretos e relatorios distinguem historico incompleto.'],
    ['9','Drift do banco e observabilidade','Alta','CI detecta diferenca entre SQL vivo e repositorio.'],
], [11*mm,48*mm,25*mm,91*mm])]

story.append(PageBreak())

phases=[
('0','Congelar evidencia e criar linha de base','CRITICA',RED,
 ['Executar no banco de producao, somente leitura: debit_consistency_report, list_stock_debit_holes(400), audit_stock_drift_report, consumption_consistency_report, list_ops_with_stale_reservations e lista de OPs com material_gate ativo.','Salvar snapshot por OP, produto, valor, status e data; separar historico anterior da correcao do comportamento futuro.','Proibir scripts de backfill/debito em massa ate a aprovacao do inventario fisico.'],
 ['Relatorio assinado com totais e amostra por classe de falha.','Zero alteracoes em products, stock_movements, reservations ou OPs nesta fase.'],
 'Base segura para priorizar e medir reducao de risco.'),
('1','Transformar material em bloqueio de execucao','CRITICA',RED,
 ['No inicio de Corte e na criacao/inicio de onda, chamar check_order_material_gate dentro da RPC do servidor.','Bloquear quando houver falta sem OC aberta ou ETA posterior ao inicio; permitir somente override com usuario, motivo, data e alerta.','Fazer recompute_material_gate falhar de forma visivel nos eventos que mudam demanda: PV, ficha, estoque, OC, prazo de fornecedor e cancelamento.'],
 ['Teste: OP com napa em falta nao inicia Corte.','Teste: override deixa trilha e aparece no Kanban/diagnostico.','Teste: mudanca de prazo de OC recalcula a data efetiva.'],
 'Elimina plano inexequivel e transforma badge informativo em controle operacional.'),
('2','Corrigir o fluxo de etapas e o Kanban','CRITICA',RED,
 ['Impedir pulo de setores quando a origem tiver quantidade pendente.','Quando o pulo for integral e permitido, concluir intermediarios com estado explicito de bypass, nao como producao entregue.','Derivar setor atual pela menor etapa realmente pendente; ajustar cards, alertas de predecessor e contadores.','Unificar apontamento, bypass e fechamento em uma unica RPC transacional.'],
 ['Nenhuma OP fica em dois setores simultaneamente.','Card nao mostra quantidade total como entregue quando houve bypass/zero.','Teste de falha no meio da transacao deixa todos os estagios consistentes.'],
 'Remove falsa disponibilidade de pares e evita programacao de trabalho sobre material inexistente.'),
('3','Definir e implementar a baixa fisica por componente/setor','ALTA',AMBER,
 ['Definir matriz aprovada: componente -> setor que consome -> evento de baixa. Ex.: cabedal/forro no Corte, componentes de montagem na Montagem, embalagem na Expedição.','Manter reserva na aprovacao; converter apenas a fração produzida no apontamento do setor dono.','Criar RPC unica, idempotente por OP + componente + setor + quantidade acumulada; usar advisory lock e ledger em stock_movements.','Manter settle_open_reservations_for_order como rede de seguranca na finalizacao, jamais como principal evento de consumo.'],
 ['Repetir um apontamento nao duplica baixa.','Apontar 40 de 100 pares baixa somente 40 pares equivalentes.','Cancelamento libera apenas a reserva ainda nao consumida.'],
 'Faz o estoque refletir WIP real e reduz ajustes posteriores.'),
('4','Unificar agenda, capacidade e lead time','ALTA',AMBER,
 ['Eleger calendario canônico por OP: dependencias paralelas, capacidade, dias uteis, feriados, buffer e material_ready_date.','Persistir janelas por setor na OP e fazer Kanban, carga, onda, picking e compras lerem essa mesma origem.','Retirar fallbacks silenciosos para created_at ou delivery_date; dado ausente vira pendencia de planejamento.','Testar paridade numerica entre TS e SQL para cenarios de capacidade, Costura, material e feriado.'],
 ['Uma OP apresenta a mesma data em todas as telas.','Alterar capacidade/prazo atualiza todas as superficies.','Cenario Costura sem capacidade na ficha usa fallback da categoria corretamente.'],
 'Lead time deixa de ser estimativa concorrente e passa a orientar a operacao.'),
('5','Tratar furos de baixa, reservas antigas e drift','ALTA',AMBER,
 ['Exibir fila de conciliacao por severidade, OP, produto e valor; exigir aprovacao para cada lote.','Reconciliar somente apos inventario fisico ou decisao do responsavel; registrar justificativa, usuario e movimento compensatorio.','Alertar diariamente: reserva em OP terminal, baixa parcial, consumo sem debito e divergencia products x ledger.','Nao debitar retroativamente as OPs historicas em massa.'],
 ['Todo furo tem dono, status e decisao.','Nenhuma OP finalizada nova deixa reserva em reserved.','Relatorio separa pendencia nova de historico herdado.'],
 'Recupera confianca do estoque sem corromper inventarios ja conferidos.'),
('6','Sanear fichas tecnicas e consumo','ALTA',AMBER,
 ['Resolver direct_components orfaos com ferramenta de relink e decisao humana nos UUIDs ambiguos.','Preencher specs de fachete dos solados marcados como fachetados; nao inferir consumo fisico.','Bloquear publicacao de ficha com componente inexistente, largura ausente em material de area ou campos por tamanho incompletos quando aplicaveis.','Criar teste numerico TS x SQL com PVs reais anonimizados, incluindo per-size, variante, sole-driven lining e BOM.'],
 ['consumption_consistency_report sem itens altos por ficha orfa.','Ficha invalida nao pode congelar snapshot nem gerar reserva.','Paridade TS x SQL tolerancia definida e coberta no CI.'],
 'Garante que reserva, compra, custo e debito nascem da mesma ficha valida.'),
('7','Fechar planejamento de compra e politica de embalagem','MEDIA',HexColor('#D97706'),
 ['Remover fallback que trata entrega como data de compra quando purchase_by_date estiver ausente.','Exibir ETA real da OC no gate, em vez de apresentar apenas material_ready_date.','Definir politica de embalagem: reservar na aprovacao e baixar na expedicao, ou outra regra formal; aplicar em todos os caminhos.','Validar replanejamento de OCs abertas ao mudar prazo/quantidade do PV.'],
 ['Nenhuma sugestao de compra sem data-limite explicita.','Embalagem possui um unico evento fisico de baixa idempotente.'],
 'Evita compra tardia e saldo de embalagem artificial.'),
('8','Corrigir sinais de Kanban e preservar historico','MEDIA',HexColor('#D97706'),
 ['Trocar “restam pares” por “pares-setor” onde for carga; mostrar pares fisicos em campo separado.','Corrigir badge de rolados para nao somar o mesmo par em varios setores.','Remover/cancelar OPs de PV cancelado ou faturado que seguem na fila, com processo auditavel.','Marcar relatorios de produtividade/custo com cobertura de apontamento e separar OPs historicas sem roteiro.','Adicionar selo “dados atualizados em” e refresh controlado no quadro.'],
 ['Nenhum contador de pares fisicos supera a quantidade da OP.','PV terminal nao ocupa capacidade futura.','Relatorio informa cobertura antes de exibir produtividade.'],
 'Evita decisoes humanas baseadas em indicadores inflados ou fila morta.'),
('9','Eliminar drift entre banco e repositorio','ALTA',AMBER,
 ['Adicionar auditoria de corpo de funcoes SQL no CI contra snapshot aprovado do banco.','Antes de db push, bloquear quando migration, schema_migrations e definicao viva divergirem.','Exportar snapshot versionado das funcoes criticas: consumo, reserva, debito, agenda, ondas e compras.','Documentar procedimento de emergencia para aplicacao SQL e reconciliacao posterior no Git.'],
 ['CI falha com drift de funcao critica.','Cada mudanca de SQL tem migration reproduzivel e teste de contrato.'],
 'Evita que uma correcao exista no Git mas nunca chegue ao banco, ou o inverso.')]

for idx, (num,title,severity,color,actions,acceptance,outcome) in enumerate(phases):
    phase_story = [p(f'Fase {num} - {title}', 'H1X'), Table([[badge(severity,color), p(f'<b>Resultado esperado:</b> {outcome}', 'BodyX')]], colWidths=[32*mm,143*mm], style=[('VALIGN',(0,0),(-1,-1),'MIDDLE'),('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),0.4,LINE),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]), Spacer(1,5), p('<b>Correcoes</b>', 'H2X')]
    for a in actions: phase_story.append(p('• '+a))
    phase_story += [p('<b>Criterios de aceite</b>', 'H2X')]
    for a in acceptance: phase_story.append(p('• '+a))
    story += phase_story
    if idx < len(phases) - 1: story.append(PageBreak())

story.append(PageBreak())
story += [p('Sequenciamento de implantacao', 'H1X'), table([
 ['Janela','Entrega','Regra de seguranca'],
 ['Semana 1','Fase 0 + testes vermelhos das Fases 1 e 2','Somente leitura no banco; nenhuma baixa retroativa.'],
 ['Semanas 2-3','Fases 1 e 2','Feature flags; piloto com poucas OPs e auditoria diaria.'],
 ['Semanas 4-6','Fase 3','Matriz aprovada pelo dono; migracao gradual por componente/setor.'],
 ['Semanas 6-8','Fases 4, 6 e 7','Paridade SQL/TS obrigatoria antes de ativar.'],
 ['Continuo','Fases 5, 8 e 9','Painel diario, CI e reconciliacao aprovada por lote.'],
], [28*mm,50*mm,97*mm]), p('Governanca e nao-regressao', 'H1X')]
for x in ['Cada migracao deve ter teste automatizado que falha antes da correcao e passa depois.', 'Nenhuma reconciliacao de estoque historica deve ser automatica; exige inventario ou aprovacao formal.', 'Toda baixa precisa carregar OP, produto, evento, quantidade e idempotency key auditavel.', 'Qualquer override de material ou etapa deve aparecer na Central de Producao e no diagnostico.', 'Publicar somente apos typecheck, testes de consumo/lead time e verificacao do banco vivo.']:
    story.append(p('• '+x))
story += [p('Premissas e limites desta versao', 'H1X'), p('Este documento prioriza correcoes com base na auditoria concluida em codigo e relatorios anteriores. Os valores atuais de producao (quantidade de furos, drift e OPs afetadas) devem ser atualizados na Fase 0 via consulta autenticada ao banco antes de qualquer intervencao de dados. A correcao de fichas que exige medida fisica, como consumo de fachete, depende de cadastro de engenharia e nao deve ser inferida por software.', 'BodyX')]

doc.build(story, onFirstPage=footer, onLaterPages=footer)
