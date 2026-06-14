import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Scissors, Warning } from '@phosphor-icons/react';
import {
  ROLO_COMPRIMENTO_M,
  ROLO_LARGURA_MM,
  type ArtisanalStrapCutRow,
} from '@/lib/strapRollCut';

/**
 * Bloco SEPARADO (vermelho) das TIRAS ARTESANAIS cortadas do rolo.
 *
 * Renderizado abaixo dos materiais BOM no Resumo de Consumo e na Lista de
 * Separação do PV. Não se mistura com os materiais normais: título e linhas em
 * vermelho deixam claro que o valor destacado é "corte do rolo" (cm a cortar do
 * comprimento do rolo), NÃO consumo direto de estoque.
 */
export default function ArtisanalStrapRollCutBlock({ rows }: { rows: ArtisanalStrapCutRow[] }) {
  if (!rows || rows.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-1.5">
        <Scissors className="h-4 w-4 text-red-600 dark:text-red-400" weight="fill" />
        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
          Tiras artesanais — corte do rolo ({ROLO_COMPRIMENTO_M}m × {ROLO_LARGURA_MM}mm)
        </h3>
        <Badge className="ml-1 bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 text-[10px] uppercase tracking-wide hover:bg-red-500/15">
          RoloCut
        </Badge>
      </div>
      <p className="px-3 text-xs text-red-600/80 dark:text-red-400/80">
        Estas tiras são cortadas do rolo. O valor destacado é quanto cortar do
        comprimento do rolo — não é consumo direto de estoque.
      </p>

      <div className="rounded-lg border border-red-500/30 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-red-500/5 hover:bg-red-500/5">
              <TableHead className="text-red-600 dark:text-red-400">Tira (cor)</TableHead>
              <TableHead className="text-right text-red-600 dark:text-red-400">Largura corte (mm)</TableHead>
              <TableHead className="text-right text-red-600 dark:text-red-400">Total de tiras (m)</TableHead>
              <TableHead className="text-right text-red-600 dark:text-red-400">Rendimento útil (m/rolo)</TableHead>
              <TableHead className="text-right text-red-600 dark:text-red-400">Cortar do rolo (cm)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const { cut } = row;
              return (
                <TableRow key={row.key} className="hover:bg-red-500/5">
                  <TableCell className="font-medium text-red-700 dark:text-red-300">
                    {row.groupName}
                    {row.color && row.color !== '—' && (
                      <span className="text-red-600/70 dark:text-red-400/70"> · {row.color}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-700 dark:text-red-300">
                    {cut.widthMissing ? '—' : row.largura_mm.toFixed(0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-700 dark:text-red-300">
                    {row.metros_necessarios.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-700 dark:text-red-300">
                    {cut.valid ? cut.metros_uteis_rolo.toFixed(1) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {cut.valid ? (
                      <span className="font-mono font-bold text-lg text-red-600 dark:text-red-400">
                        {cut.cm_a_cortar.toFixed(1)}
                        <span className="text-xs font-normal text-red-600/70 dark:text-red-400/70"> cm</span>
                      </span>
                    ) : (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                          <Warning className="h-3.5 w-3.5" /> {cut.warning}
                        </span>
                        {cut.widthMissing && (
                          <Link to="/artisanal-recipes" className="text-[11px] underline text-red-600/80 dark:text-red-400/80">
                            Cadastrar largura em Receitas → Produtos artesanais →
                          </Link>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
