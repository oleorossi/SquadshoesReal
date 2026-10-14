/**
 * Matriz de estoque de solado por numeração + pedidos que consomem.
 *
 * Spec: specs/estoque-solado-por-numeracao.md (R1, R2, R9).
 *
 * Substitui a grade de 7 cartões da aba Estoque. O cartão mostrava a
 * quantidade BRUTA e pintava de verde numeração 100% empenhada — medido em
 * 01 CARAMELO: 36, 37, 38 e 39 com Livre = 0 e nenhum sinal disso.
 *
 * Decisão de desenho (aprovada pelo dono em 14/10/2026): a COLUNA é a unidade
 * de falha, não a célula. Numeração sem saldo livre é marcada de ponta a ponta,
 * atravessando as linhas, para "o 36 acabou" ser legível num relance.
 *
 * ⚠ Vermelho não é sinal sozinho: `--destructive` é a MESMA cor que
 *   `--primary` neste projeto (decisão registrada no index.css) e cor isolada
 *   não comunica negativo. O alarme é o ZERO em corpo grande; o vermelho
 *   acompanha.
 */
import { useMemo, useState } from 'react';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Stack as Boxes, X } from '@phosphor-icons/react';
import {
  useSoleStockMatrix,
  useSoleStockOrders,
  groupSoleStockOrders,
  type SoleStockMatrixRow,
} from '@/hooks/useSoleStockMatrix';

const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
/** Sinal menos tipográfico (U+2212) — o hífen some em fonte condensada. */
const fmtNeg = (v: number) => (v < 0 ? `−${fmt(Math.abs(v))}` : fmt(v));

const fmtData = (iso: string | null) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}` : iso;
};

interface Props {
  productId: string;
  /** Numerações do cadastro, usadas quando ainda não há nenhum dado. */
  fallbackSizeKeys: string[];
  /** Slot do header — fica à esquerda do chip de filtro. */
  actions?: React.ReactNode;
}

export default function SoleStockMatrix({ productId, fallbackSizeKeys, actions }: Props) {
  const [filtro, setFiltro] = useState<string | null>(null);
  const matrixQ = useSoleStockMatrix(productId);
  const ordersQ = useSoleStockOrders(productId);

  const linhas = useMemo<SoleStockMatrixRow[]>(() => {
    const vindas = matrixQ.data ?? [];
    if (vindas.length > 0) return vindas;
    // Solado com range cadastrado mas sem nada lançado: mostra a grade vazia
    // em vez de sumir com a tabela.
    return fallbackSizeKeys.map(k => ({
      size_key: k,
      size_ord: Number(k.split('/')[0]) || null,
      estoque: 0, empenhado: 0, livre: 0, falta: 0, em_compra: 0,
      projetado: 0, projetado_carteira: 0, a_pedir: 0,
    }));
  }, [matrixQ.data, fallbackSizeKeys]);

  const pedidos = useMemo(
    () => groupSoleStockOrders(ordersQ.data ?? []),
    [ordersQ.data],
  );

  const totais = useMemo(() => {
    const t = {
      estoque: 0, empenhado: 0, livre: 0, falta: 0, em_compra: 0,
      projetado: 0, projetado_carteira: 0, a_pedir: 0,
    };
    for (const l of linhas) {
      t.estoque += l.estoque; t.empenhado += l.empenhado; t.livre += l.livre;
      t.falta += l.falta; t.em_compra += l.em_compra;
      t.projetado += l.projetado; t.projetado_carteira += l.projetado_carteira;
      t.a_pedir += l.a_pedir;
    }
    return t;
  }, [linhas]);

  /** Consumo somado dos pedidos, por numeração — a linha que fecha com a matriz. */
  const consumoPorNumero = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of pedidos) {
      for (const [k, c] of Object.entries(p.porNumero)) out[k] = (out[k] || 0) + c.consumo;
    }
    return out;
  }, [pedidos]);

  const consumoTotal = useMemo(
    () => Object.values(consumoPorNumero).reduce((s, v) => s + v, 0),
    [consumoPorNumero],
  );

  // Numeração esgotada: sem saldo livre E com alguém querendo. Estoque zerado
  // sem demanda não é falha — é só numeração que não se vende.
  const esgotadas = useMemo(() => {
    const s = new Set<string>();
    for (const l of linhas) {
      if (l.livre <= 0 && (l.falta > 0 || l.empenhado > 0)) s.add(l.size_key);
    }
    return s;
  }, [linhas]);

  const temFalta = totais.falta > 0;
  const carregando = matrixQ.isLoading || ordersQ.isLoading;
  const erro = matrixQ.isError || ordersQ.isError;

  if (erro) {
    return (
      <Panel title="Estoque por numeração">
        <p className="text-sm text-red-600 dark:text-red-400">
          Não foi possível carregar o estoque por numeração. Recarregue a página — o
          saldo não foi alterado.
        </p>
      </Panel>
    );
  }

  const colClass = (k: string) =>
    esgotadas.has(k)
      ? 'bg-red-500/[0.055] dark:bg-red-500/10 border-x border-red-500/30 dark:border-red-500/40'
      : '';

  const Cell = ({ k, children, className = '' }: { k: string; children: React.ReactNode; className?: string }) => (
    <td className={`px-2.5 py-1.5 text-right tabular-nums ${colClass(k)} ${className}`}>{children}</td>
  );

  const Linha = ({
    rotulo, valor, destaque, mudo, negativoRuim = true, travessao,
  }: {
    rotulo: string;
    valor: (l: SoleStockMatrixRow) => number;
    destaque?: boolean;
    mudo?: boolean;
    negativoRuim?: boolean;
    travessao?: (l: SoleStockMatrixRow) => boolean;
  }) => {
    const total = linhas.reduce((s, l) => s + valor(l), 0);
    return (
      <tr className={destaque ? 'border-t border-border' : ''}>
        <th scope="row" className={`px-4 py-1.5 text-left text-xs font-medium whitespace-nowrap
          ${destaque ? 'text-foreground font-bold' : mudo ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
          {rotulo}
        </th>
        {linhas.map(l => {
          const v = valor(l);
          const vazio = travessao?.(l);
          const zeroDestaque = destaque && v === 0 && esgotadas.has(l.size_key);
          return (
            <Cell key={l.size_key} k={l.size_key}
              className={destaque ? 'font-display text-xl leading-none py-2.5' : 'font-mono text-sm'}>
              {vazio ? (
                <span className="text-muted-foreground/50">—</span>
              ) : (
                <span className={
                  zeroDestaque ? 'text-red-600 dark:text-red-400'
                  : negativoRuim && v < 0 ? 'text-red-600 dark:text-red-400 font-bold'
                  : mudo ? 'text-muted-foreground' : 'text-foreground'
                }>
                  {fmtNeg(v)}
                </span>
              )}
            </Cell>
          );
        })}
        <td className={`px-3 py-1.5 text-right border-l border-border font-bold tabular-nums
          ${destaque ? 'font-display text-xl leading-none' : 'font-mono text-sm'}
          ${negativoRuim && total < 0 ? 'text-red-600 dark:text-red-400' : mudo ? 'text-muted-foreground' : 'text-foreground'}`}>
          {fmtNeg(total)}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      <Panel
        eyebrow="Estoque"
        title="Estoque por numeração"
        subtitle={carregando ? 'Carregando…' : `${fmt(totais.estoque)} em estoque · ${fmt(totais.empenhado)} empenhados · ${fmt(totais.livre)} livres`}
        actions={
          <>
            {filtro && (
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setFiltro(null)}>
                <X className="h-3 w-3" /> nº {filtro}
              </Button>
            )}
            {actions}
          </>
        }
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5" />
                {linhas.map(l => (
                  <th key={l.size_key} scope="col"
                      className={`px-2.5 py-2.5 text-right text-xs font-medium ${colClass(l.size_key)}
                        ${esgotadas.has(l.size_key) ? 'text-red-600 dark:text-red-400 font-bold' : 'text-muted-foreground'}`}>
                    <button type="button"
                      onClick={() => setFiltro(f => (f === l.size_key ? null : l.size_key))}
                      aria-pressed={filtro === l.size_key}
                      aria-label={`Filtrar pedidos do tamanho ${l.size_key}`}
                      className="font-mono hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1">
                      {l.size_key}
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground border-l border-border">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              <Linha rotulo="Estoque físico" valor={l => l.estoque} negativoRuim={false} />
              <Linha rotulo="Empenhado" valor={l => l.empenhado} negativoRuim={false} />
              <Linha rotulo="Livre" valor={l => l.livre} destaque />
              <Linha rotulo="Falta p/ pedidos" valor={l => l.falta} travessao={l => l.falta === 0} />
              <Linha rotulo="Em compra" valor={l => l.em_compra} mudo negativoRuim={false} travessao={l => l.em_compra === 0} />
              <Linha rotulo="Projetado" valor={l => l.projetado} destaque />
              <Linha rotulo="Projetado carteira" valor={l => l.projetado_carteira} />
              {temFalta && (
                <Linha rotulo="A pedir (múltiplo de 10)" valor={l => l.a_pedir} mudo negativoRuim={false} travessao={l => l.a_pedir === 0} />
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 py-2.5 border-t border-border text-xs text-muted-foreground font-mono">
          <span>Livre = Estoque &minus; Empenhado</span>
          <span>Projetado = Livre &minus; Falta + Em compra</span>
          <span>coluna marcada = sem saldo livre</span>
        </div>
      </Panel>

      <Panel
        eyebrow={temFalta ? 'Triagem' : 'Empenho'}
        title={temFalta ? 'Pedidos em produção' : 'Quem está consumindo este estoque'}
        subtitle={
          pedidos.length === 0
            ? 'Nenhum pedido em produção consome este solado.'
            : `${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'} · ordenado pela semana de faturamento`
        }
        flush
      >
        {pedidos.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground">
            <Boxes className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Estoque livre por inteiro</p>
            <p className="text-xs mt-1">Quando um pedido entrar em produção, ele aparece aqui por numeração.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <tbody>
                {pedidos.map(p => (
                  <tr key={p.saleOrderId} className="border-b border-muted">
                    <th scope="row" className="px-4 py-2 text-left align-baseline">
                      <span className="block font-mono text-[13px] font-medium text-foreground">{p.orderNumber}</span>
                      <span className="block text-[11.5px] text-muted-foreground">{p.clientName}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {p.pvStatus}
                        {p.billingMonday && ` · sem. ${fmtData(p.billingMonday)}`}
                      </span>
                    </th>
                    {linhas.map(l => {
                      const c = p.porNumero[l.size_key];
                      const apagado = filtro && filtro !== l.size_key;
                      return (
                        <Cell key={l.size_key} k={l.size_key} className={apagado ? 'opacity-30' : ''}>
                          {c && c.consumo > 0 ? (
                            <>
                              <span className="font-mono text-sm text-foreground">{fmt(c.consumo)}</span>
                              {c.falta > 0 && (
                                <span className="block font-mono text-[11px] font-bold leading-tight text-red-600 dark:text-red-400">
                                  {fmtNeg(-c.falta)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </Cell>
                      );
                    })}
                    <td className="px-3 py-2 text-right align-baseline border-l border-border font-mono text-sm font-bold tabular-nums">
                      {fmt(p.consumoTotal)}
                      {p.faltaTotal > 0 && (
                        <span className="block text-[11px] font-bold leading-tight text-red-600 dark:text-red-400">
                          {fmtNeg(-p.faltaTotal)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border">
                  <th scope="row" className="px-4 py-2 text-left text-xs font-bold text-foreground whitespace-nowrap">
                    Consumo total
                  </th>
                  {linhas.map(l => (
                    <Cell key={l.size_key} k={l.size_key} className="font-mono text-sm font-bold text-foreground">
                      {fmt(consumoPorNumero[l.size_key] ?? 0)}
                    </Cell>
                  ))}
                  <td className="px-3 py-2 text-right border-l border-border font-mono text-sm font-bold tabular-nums text-foreground">
                    {fmt(consumoTotal)}
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                    Estoque físico
                  </th>
                  {linhas.map(l => (
                    <Cell key={l.size_key} k={l.size_key} className="font-mono text-sm text-muted-foreground">
                      {fmt(l.estoque)}
                    </Cell>
                  ))}
                  <td className="px-3 py-1.5 text-right border-l border-border font-mono text-sm text-muted-foreground tabular-nums">
                    {fmt(totais.estoque)}
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <th scope="row" className="px-4 py-2.5 text-left text-xs font-bold text-foreground whitespace-nowrap">
                    Saldo
                  </th>
                  {linhas.map(l => {
                    const saldo = l.estoque - (consumoPorNumero[l.size_key] ?? 0);
                    return (
                      <Cell key={l.size_key} k={l.size_key}
                        className={`font-display text-xl leading-none py-2.5 ${saldo < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                        {fmtNeg(saldo)}
                      </Cell>
                    );
                  })}
                  <td className={`px-3 py-2.5 text-right border-l border-border font-display text-xl leading-none tabular-nums
                    ${totais.estoque - consumoTotal < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                    {fmtNeg(totais.estoque - consumoTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {pedidos.length > 0 && (
          <div className="px-4 py-2.5 border-t border-border text-xs text-muted-foreground font-mono">
            Saldo = Estoque &minus; Consumo total · número menor em vermelho = parte do consumo sem lastro
          </div>
        )}
      </Panel>

      {temFalta && (
        <Badge variant="destructive" className="text-xs">
          {fmt(totais.falta)} pares em falta · a pedir {fmt(totais.a_pedir)}
        </Badge>
      )}
    </div>
  );
}
