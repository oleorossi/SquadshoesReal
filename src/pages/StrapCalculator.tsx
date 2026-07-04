/**
 * Calculadora de Tiras — rendimento de corte artesanal (tira reta).
 *
 * Ferramenta avulsa (não depende de OP/ficha/estoque). Responde: "quantos metros
 * de tira eu tiro por metro linear do material?" (número-herói), o total do rolo,
 * as três perdas (geométrica/processo/total) e o custo por metro de tira e por par.
 *
 * Toda a matemática mora em `@/lib/strapYield` (parity travada com o motor de corte
 * do PV `strapRollCut` — dados idênticos ⇒ resultado idêntico). Cálculo reativo:
 * atualiza ao digitar. Campos com defaults do rolo canônico, todos editáveis.
 */
import { useMemo, useState } from 'react';
import { CaretDown, Scissors, Info, Ruler, Warning } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { computeStrapYield, STRAP_YIELD_DEFAULTS } from '@/lib/strapYield';

/** Linha de resultado secundária (rótulo à esquerda, valor mono à direita). */
function ResultRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <div className="min-w-0">
        <span className="text-sm text-foreground">{label}</span>
        {hint && <span className="ml-1 text-xs text-muted-foreground">{hint}</span>}
      </div>
      <span className="shrink-0 font-mono text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

export default function StrapCalculator() {
  const [larguraMaterialMm, setLarguraMaterialMm] = useState<number>(STRAP_YIELD_DEFAULTS.larguraMaterialMm);
  const [larguraTiraMm, setLarguraTiraMm] = useState<number>(0);
  const [perdaPct, setPerdaPct] = useState<number>(STRAP_YIELD_DEFAULTS.perdaPct);
  const [comprimentoRoloM, setComprimentoRoloM] = useState<number>(STRAP_YIELD_DEFAULTS.comprimentoRoloM);
  const [kerfMm, setKerfMm] = useState<number>(STRAP_YIELD_DEFAULTS.kerfMm);
  const [custoMetroLinear, setCustoMetroLinear] = useState<number>(0);
  const [mmTiraPar, setMmTiraPar] = useState<number>(0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const result = useMemo(
    () =>
      computeStrapYield({
        larguraMaterialMm,
        larguraTiraMm,
        perdaPct,
        comprimentoRoloM,
        kerfMm,
        custoMetroLinear: custoMetroLinear > 0 ? custoMetroLinear : null,
        mmTiraPar: mmTiraPar > 0 ? mmTiraPar : null,
      }),
    [larguraMaterialMm, larguraTiraMm, perdaPct, comprimentoRoloM, kerfMm, custoMetroLinear, mmTiraPar],
  );

  const resetDefaults = () => {
    setLarguraMaterialMm(STRAP_YIELD_DEFAULTS.larguraMaterialMm);
    setLarguraTiraMm(0);
    setPerdaPct(STRAP_YIELD_DEFAULTS.perdaPct);
    setComprimentoRoloM(STRAP_YIELD_DEFAULTS.comprimentoRoloM);
    setKerfMm(STRAP_YIELD_DEFAULTS.kerfMm);
    setCustoMetroLinear(0);
    setMmTiraPar(0);
  };

  const aprovPct = result.valid ? Math.min(100, Math.max(0, result.aprovGeoPct)) : 0;
  const showCost = result.valid && result.custoMetroTira != null;

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="ENGENHARIA · CORTE"
        title="Calculadora de Tiras"
        description="Rendimento de corte de tira reta artesanal: quantos metros de tira você tira por metro linear do material, o total do rolo, as perdas (geométrica e de processo) e o custo por metro e por par. Defaults do rolo padrão (40 m × 1370 mm, 15%) — todos editáveis."
        actions={
          <Button variant="outline" size="sm" onClick={resetDefaults} className="h-9">
            Restaurar padrão
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,400px)_1fr]">
        {/* ── ENTRADAS ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Ruler className="h-4 w-4 text-muted-foreground" weight="bold" />
              Entradas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="lm">Largura útil do material</Label>
              <NumberInput
                id="lm"
                value={larguraMaterialMm}
                onChange={setLarguraMaterialMm}
                unit="mm"
                decimals={2}
                placeholder="1370"
              />
              <p className="text-xs text-muted-foreground">Largura aproveitável do rolo/manta, descontando a borda imprestável.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lt">Largura da tira</Label>
              <NumberInput id="lt" value={larguraTiraMm} onChange={setLarguraTiraMm} unit="mm" decimals={2} placeholder="20" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p">Perda de processo</Label>
                <NumberInput id="p" value={perdaPct} onChange={setPerdaPct} unit="%" decimals={2} placeholder="15" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr">Comprimento do rolo</Label>
                <NumberInput id="cr" value={comprimentoRoloM} onChange={setComprimentoRoloM} unit="m" decimals={2} placeholder="40" />
              </div>
            </div>

            {/* Camada de custo (opcional) */}
            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Custo (opcional)
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cml">Custo do material por metro linear</Label>
                <CurrencyInput id="cml" value={custoMetroLinear} onChange={setCustoMetroLinear} />
                <p className="text-xs text-muted-foreground">R$ por metro linear do material comprado.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="par">Tira usada por par</Label>
                <NumberInput id="par" value={mmTiraPar} onChange={setMmTiraPar} unit="mm/par" decimals={2} placeholder="500" />
                <p className="text-xs text-muted-foreground">Total de tira que um par consome (nº de tiras × comprimento).</p>
              </div>
            </div>

            {/* Avançado — kerf */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <CaretDown className={cn('h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-180')} />
                Avançado
              </button>
              {showAdvanced && (
                <div className="mt-2 space-y-1.5">
                  <Label htmlFor="k">Espessura de corte (kerf)</Label>
                  <NumberInput id="k" value={kerfMm} onChange={setKerfMm} unit="mm" decimals={2} placeholder="0" />
                  <p className="text-xs text-muted-foreground">Material consumido pela lâmina entre tiras. No corte a estilete é ~0.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── RESULTADO ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {!result.valid ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex items-center gap-3 py-8">
                <Warning className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" weight="fill" />
                <p className="text-sm text-amber-700 dark:text-amber-300">{result.error}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Número-herói */}
              <Card className="border-red-500/30 bg-red-500/10">
                <CardContent className="py-6">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-600/80 dark:text-red-400/80">
                    <Scissors className="h-3.5 w-3.5" weight="fill" />
                    Rendimento líquido
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-mono text-5xl font-bold leading-none text-red-600 dark:text-red-400">
                      {formatNumber(result.mtPorMetroLiq, 2)}
                    </span>
                    <span className="text-lg font-medium text-red-600/80 dark:text-red-400/80">m de tira / m linear</span>
                  </div>
                  <p className="mt-2 text-sm text-red-700/80 dark:text-red-300/80">
                    Bruto {formatNumber(result.mtPorMetroBruto, 0)} m/m ({result.N} tira{result.N === 1 ? '' : 's'} na largura),
                    menos {formatNumber(result.perdaProcessoPct, 1)}% de perda de processo.
                  </p>
                </CardContent>
              </Card>

              {/* Barra de aproveitamento da largura */}
              <Card>
                <CardContent className="py-4">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">Aproveitamento da largura</span>
                    <span className="font-mono text-muted-foreground">
                      {result.N} × {formatNumber(larguraTiraMm, 0)} mm · sobra {formatNumber(result.sobraLarguraMm, 0)} mm
                    </span>
                  </div>
                  <div className="relative h-5 w-full overflow-hidden rounded-md border border-border bg-muted/40">
                    <div
                      className="absolute inset-y-0 left-0 bg-red-500/60"
                      style={{ width: `${aprovPct}%` }}
                      title={`${formatNumber(result.aprovGeoPct, 1)}% aproveitado`}
                    />
                    <div
                      className="absolute inset-y-0 right-0"
                      style={{
                        left: `${aprovPct}%`,
                        backgroundImage: 'repeating-linear-gradient(45deg, hsl(var(--border)) 0 1px, transparent 1px 7px)',
                      }}
                      title={`sobra ${formatNumber(result.sobraLarguraMm, 0)} mm`}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                    <span>Aproveitado {formatNumber(result.aprovGeoPct, 1)}%</span>
                    <span>Sobra {formatNumber(100 - result.aprovGeoPct, 1)}%</span>
                  </div>
                </CardContent>
              </Card>

              {/* Totais + perdas */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm text-muted-foreground">Rolo inteiro</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-y divide-border/60 py-0">
                    <ResultRow label="Total de tira (líquido)" value={`${formatNumber(result.mtTotalLiq, 2)} m`} />
                    <ResultRow label="Total de tira (bruto)" value={`${formatNumber(result.mtTotalBruto, 2)} m`} />
                    <ResultRow label="Nº de tiras na largura" value={`${result.N}`} />
                    <ResultRow label="Sobra de largura" value={`${formatNumber(result.sobraLarguraMm, 0)} mm`} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm text-muted-foreground">Perdas</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-y divide-border/60 py-0">
                    <ResultRow label="Geométrica" hint="(borda)" value={`${formatNumber(result.perdaGeoPct, 1)}%`} />
                    <ResultRow label="Processo" hint="(corte)" value={`${formatNumber(result.perdaProcessoPct, 1)}%`} />
                    <ResultRow label="Total efetiva" value={`${formatNumber(result.perdaTotalPct, 1)}%`} />
                    <ResultRow label="Aproveitamento geométrico" value={`${formatNumber(result.aprovGeoPct, 1)}%`} />
                  </CardContent>
                </Card>
              </div>

              {/* Custo */}
              {showCost && (
                <Card className="border-red-500/20">
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm text-muted-foreground">Custo</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-y divide-border/60 py-0">
                    <ResultRow
                      label="Custo por metro de tira"
                      hint="(sobre o rendimento líquido)"
                      value={`${formatCurrency(result.custoMetroTira)} /m`}
                    />
                    {result.custoTiraPar != null ? (
                      <ResultRow
                        label="Custo de tira por par"
                        hint={`(${formatNumber(mmTiraPar, 0)} mm/par)`}
                        value={`${formatCurrency(result.custoTiraPar)} /par`}
                      />
                    ) : (
                      <div className="py-2 text-xs text-muted-foreground">
                        Informe a tira usada por par para ver o custo por par.
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Aviso de estimativa (fixo) */}
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Estimativa. Confira no corte real — a % de perda cobre a variação do corte artesanal. Tiras cortadas
              no sentido do comprimento do rolo.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
