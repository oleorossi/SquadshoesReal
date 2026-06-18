import { WarningCircle as AlertCircle } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import type { NfePreviewResponse } from '@/hooks/useNfe';

export function fmtMoney(n: number) {
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtCnpjCpf(d: string) {
  const v = (d || '').replace(/\D/g, '');
  if (v.length === 14) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (v.length === 11) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return v;
}

export function fmtCep(d: string) {
  const v = (d || '').replace(/\D/g, '');
  if (v.length === 8) return v.replace(/^(\d{5})(\d{3})$/, '$1-$2');
  return v;
}

export function NfePreviewPanel({ preview }: { preview: NfePreviewResponse['preview'] }) {
  const { emitente, destinatario, operacao, produtos, totais, transporte, pagamento, informacoes_complementares, warnings } = preview;
  return (
    <div className="space-y-4 text-sm">
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-2 text-amber-700 text-xs">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Emitente</p>
            <p className="font-medium">{emitente.razao_social || emitente.nome_fantasia || '—'}</p>
            <p className="text-muted-foreground">CNPJ {fmtCnpjCpf(emitente.cnpj)} · IE {emitente.inscricao_estadual}</p>
            <p className="text-xs text-muted-foreground">Série {emitente.serie_nfe} · Modelo 55 · {emitente.uf}{emitente.cidade ? ` — ${emitente.cidade}` : ''}{emitente.ambiente ? ` · Ambiente: ${emitente.ambiente}` : ''}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Destinatário</p>
            <p className="font-medium">{destinatario.nome}</p>
            <p className="text-muted-foreground">{destinatario.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF'} {fmtCnpjCpf(destinatario.documento)} · IE {destinatario.ie_valor}</p>
            <p className="text-xs">{destinatario.endereco}, {destinatario.numero}{destinatario.complemento ? ` — ${destinatario.complemento}` : ''} · {destinatario.bairro}</p>
            <p className="text-xs">{destinatario.cidade}/{destinatario.uf} · CEP {fmtCep(destinatario.cep)}</p>
            {(destinatario.telefone || destinatario.email) && (
              <p className="text-xs text-muted-foreground">{[destinatario.telefone, destinatario.email].filter(Boolean).join(' · ')}</p>
            )}
            {!destinatario.gc_id && (
              <p className="text-xs text-amber-600 mt-1">Cliente novo — será cadastrado no GestaoClick na emissão</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operação</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
            <div><span className="text-muted-foreground">Natureza:</span> {operacao.natureza_operacao}</div>
            <div><span className="text-muted-foreground">CFOP:</span> <span className="font-mono">{operacao.cfop}</span> {operacao.cfop_interstate ? '(inter)' : '(intra)'}</div>
            <div><span className="text-muted-foreground">Finalidade:</span> {operacao.finalidade}</div>
            <div><span className="text-muted-foreground">Tipo NF:</span> {operacao.tipo_nf}</div>
            <div><span className="text-muted-foreground">Forma emissão:</span> {operacao.tipo_emissao}</div>
            <div className="col-span-3"><span className="text-muted-foreground">Tipo atendimento:</span> {operacao.indicador_presenca}</div>
            <div className="col-span-2"><span className="text-muted-foreground">Indicador destinatário:</span> {operacao.indicador_final}</div>
            <div className="col-span-2"><span className="text-muted-foreground">Marca (xMarca):</span> {operacao.marca_xmarca}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Produtos ({totais.qtd_itens})</p>
            <p className="text-xs text-muted-foreground">{totais.qtd_pares.toLocaleString('pt-BR')} pares</p>
          </div>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">#</th>
                  <th className="px-2 py-1.5 font-medium">Descrição</th>
                  <th className="px-2 py-1.5 font-medium">Marca</th>
                  <th className="px-2 py-1.5 font-medium font-mono">NCM</th>
                  <th className="px-2 py-1.5 font-medium font-mono">CFOP</th>
                  <th className="px-2 py-1.5 font-medium text-right">Qtd</th>
                  <th className="px-2 py-1.5 font-medium">Un</th>
                  <th className="px-2 py-1.5 font-medium text-right">V. Unit</th>
                  <th className="px-2 py-1.5 font-medium text-right">V. Total</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((p, i) => (
                  <tr key={i} className="border-b border-border/30 last:border-0">
                    <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      {p.descricao}
                      {p.gc_status === 'pending_create' && (
                        <span className="ml-1 text-amber-600 text-xs" title="Será cadastrado no GestaoClick na emissão">(novo)</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{p.marca || '—'}</td>
                    <td className="px-2 py-1.5 font-mono">{p.ncm}</td>
                    <td className="px-2 py-1.5 font-mono">{p.cfop}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{p.quantidade.toLocaleString('pt-BR')}</td>
                    <td className="px-2 py-1.5">{p.unidade}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(p.valor_unitario)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtMoney(p.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {/* total_pedido = soma_itens + frete (computado no emit-nfe). Quando há
                    frete, mostra o desdobramento (mercadoria + frete) em vez de um
                    falso "diverge" — a NF é emitida com o total COM frete. */}
                {totais.total_pedido - totais.soma_itens > 0.01 && (
                  <>
                    <tr className="text-muted-foreground">
                      <td className="px-2 py-1 text-right" colSpan={8}>Mercadoria (itens)</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(totais.soma_itens)}</td>
                    </tr>
                    <tr className="text-muted-foreground">
                      <td className="px-2 py-1 text-right" colSpan={8}>Frete</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(totais.total_pedido - totais.soma_itens)}</td>
                    </tr>
                  </>
                )}
                <tr className="border-t-2 border-border font-medium">
                  <td className="px-2 py-2 text-right" colSpan={8}>Total da NF</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(totais.total_pedido)}</td>
                </tr>
                {/* Anomalia REAL: itens somam MAIS que o total da NF (não é frete). */}
                {totais.soma_itens - totais.total_pedido > 0.01 && (
                  <tr>
                    <td colSpan={9} className="px-2 py-1.5 text-xs text-red-600">
                      ⚠ Soma dos itens ({fmtMoney(totais.soma_itens)}) maior que o total da NF ({fmtMoney(totais.total_pedido)}) — confira os valores.
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transporte</p>
            <div className="text-xs space-y-0.5">
              <div><span className="text-muted-foreground">Modalidade:</span> {transporte.modalidade_frete}</div>
              <div><span className="text-muted-foreground">Volumes:</span> {transporte.qtd_volumes} {transporte.especie}{Number(transporte.qtd_volumes) > 1 ? 'S' : ''}</div>
              <div><span className="text-muted-foreground">Peso bruto:</span> {transporte.peso_bruto_kg ? `${transporte.peso_bruto_kg} kg` : '—'}</div>
              <div><span className="text-muted-foreground">Peso líquido:</span> {transporte.peso_liquido_kg ? `${transporte.peso_liquido_kg} kg` : '—'}</div>
            </div>
            {transporte.transportador && (
              <div className="mt-2 pt-2 border-t border-border space-y-0.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transportador (modFrete 3 — próprio)</p>
                {transporte.transportador.nome && (
                  <div className="text-xs"><span className="text-muted-foreground">Razão social:</span> {transporte.transportador.nome}</div>
                )}
                {transporte.transportador.cnpj && (
                  <div className="text-xs font-mono"><span className="text-muted-foreground">CNPJ:</span> {transporte.transportador.cnpj}</div>
                )}
                {transporte.transportador.inscricao_estadual && (
                  <div className="text-xs font-mono"><span className="text-muted-foreground">IE:</span> {transporte.transportador.inscricao_estadual}</div>
                )}
                {transporte.transportador.endereco && (
                  <div className="text-xs"><span className="text-muted-foreground">Endereço:</span> {transporte.transportador.endereco}</div>
                )}
                {(transporte.transportador.cidade || transporte.transportador.estado) && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Município:</span>{' '}
                    {[transporte.transportador.cidade, transporte.transportador.estado].filter(Boolean).join(' / ')}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pagamento — {pagamento.length} {pagamento.length === 1 ? 'parcela' : 'parcelas'}</p>
            <div className="text-xs space-y-0.5">
              {pagamento.length === 0 ? (
                <p className="text-muted-foreground">Sem parcelas configuradas — à vista no GestaoClick.</p>
              ) : (
                pagamento.map((p, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span><span className="text-muted-foreground">#{p.numero}</span> · {p.forma} · {p.vencimento}</span>
                    <span className="tabular-nums">{fmtMoney(p.valor)}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {informacoes_complementares && (
        <Card>
          <CardContent className="pt-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Informações Complementares</p>
            <p className="text-xs whitespace-pre-wrap">{informacoes_complementares}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
