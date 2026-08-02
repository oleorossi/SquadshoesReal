/**
 * Prévia compartilhada de aplicação em massa a variantes de cor.
 *
 * Existe porque listar "os campos que mudaram" não é suficiente: o que machuca é
 * a cor que tinha valor PRÓPRIO e vai ser sobrescrita. `COMPONENTES DIVERSOS`
 * tem 6 custos distintos em 8 itens e `LINHANYL` 4 em 6 — sem nomear quem perde
 * o quê, o achatamento só aparece depois, no custeio errado.
 *
 * Usada nos dois caminhos que gravam várias cores de uma vez (spec
 * `estoque-cores-e-editores.md` R2.8 / R4.8):
 *   - MasterVariantDialog → aba "Aplicar a todas as cores"
 *   - ProductFormDialog   → propagação para as irmãs de cor
 */
import React from 'react';

export type BulkImpact = {
  campo: string;
  label: string;
  /** Valor que será gravado, já formatado. */
  novo: string;
  /** Cores que hoje têm valor diferente e vão perdê-lo. */
  perdem: { cor: string; valor: string }[];
};

/** Monta o impacto a partir do diff e das irmãs. `valorDe` lê o campo na irmã. */
export function buildBulkImpact<T>(
  diff: Record<string, any>,
  labels: Record<string, string>,
  irmas: T[],
  valorDe: (irma: T, campo: string) => unknown,
  corDe: (irma: T) => string,
): BulkImpact[] {
  return Object.entries(diff).map(([campo, novoRaw]) => {
    const novo = String(novoRaw ?? '');
    const perdem = irmas
      .map(irma => ({ cor: corDe(irma), valor: String(valorDe(irma, campo) ?? '') }))
      .filter(x => x.valor !== novo && x.valor !== '');
    return { campo, label: labels[campo] || campo, novo, perdem };
  });
}

export function BulkApplyPreview({ impacto }: { impacto: BulkImpact[] }) {
  if (impacto.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum campo alterado.</p>;
  }
  return (
    <div className="max-h-[46vh] overflow-y-auto space-y-3 text-sm">
      {impacto.map(({ campo, label, novo, perdem }) => (
        <div key={campo} className="rounded-md border px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{label}</span>
            <span className="font-mono text-xs">{novo === '' ? '(vazio)' : novo}</span>
          </div>
          {perdem.length > 0 && (
            <div className="mt-1.5 text-xs text-warning">
              <p className="font-medium">
                {perdem.length} cor{perdem.length === 1 ? '' : 'es'} {perdem.length === 1 ? 'perde' : 'perdem'} valor próprio:
              </p>
              <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                {perdem.slice(0, 6).map(x => (
                  <li key={x.cor}>
                    • {x.cor}: <span className="font-mono">{x.valor}</span> → <span className="font-mono">{novo}</span>
                  </li>
                ))}
                {perdem.length > 6 && <li>• … e mais {perdem.length - 6}</li>}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
