/**
 * A4Layout — primitives compartilhados para todos os relatórios A4.
 *
 * Seguindo o handoff Novidade (styles-paper.css):
 *   - .sheet  → folha A4 vertical (794×1123 @ 96dpi)
 *   - .sheet-l→ folha A4 horizontal (1123×794)
 *   - .a4-head→ header com brand mark + título do documento
 *   - .a4-foot→ rodapé absoluto com ID + data + paginação
 *   - .sig    → bloco de assinatura
 *
 * Use junto com .paper como container externo.
 */
import React from 'react';

export type A4HeadProps = {
  title: string;
  num: string;
  sub?: string;
  emittedAt?: string;
  emittedBy?: string;
};

export function A4Head({ title, num, sub, emittedAt, emittedBy }: A4HeadProps) {
  const meta = [emittedAt, emittedBy].filter(Boolean).join(' · ');
  return (
    <div className="a4-head">
      <div className="brand">
        <div className="brand-mark">SS</div>
        <div>
          <div className="brand-name">SQUAD SHOES</div>
          <div className="brand-sub">{sub || 'Relatório de Produção'}</div>
        </div>
      </div>
      <div className="doc-meta">
        <div className="doc-title">{title}</div>
        <div className="doc-num">{num}</div>
        {meta && <div className="p-eyebrow" style={{ marginTop: 2 }}>{meta}</div>}
      </div>
    </div>
  );
}

export type A4FootProps = {
  doc: string;
  page?: string;
  version?: string;
  generatedAt?: string;
  landscape?: boolean;
};

export function A4Foot({ doc, page = '1 de 1', version = 'v2026.05', generatedAt, landscape }: A4FootProps) {
  return (
    <div className={`a4-foot ${landscape ? 'l' : ''}`}>
      <span>{doc}</span>
      <span>{[generatedAt, version].filter(Boolean).join(' · ')}</span>
      <span>Página {page}</span>
    </div>
  );
}

export function Sigs({ labels = ['Líder de produção', 'Supervisor', 'Gerência'] }: { labels?: string[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${labels.length}, 1fr)`, gap: 24, marginTop: 30 }}>
      {labels.map((l, i) => (
        <div key={i} className="sig">
          <div className="sig-line" />
          <div className="sig-cap">{l}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * PaperShell — wrapper completo (paper + sheet). Use pra envelopar qualquer relatório.
 *
 * @example
 * <PaperShell>
 *   <A4Head title="Diário" num="RD-2026-129" />
 *   ...conteúdo...
 *   <Sigs />
 *   <A4Foot doc="RD-2026-129" />
 * </PaperShell>
 */
export function PaperShell({ children, landscape = false }: { children: React.ReactNode; landscape?: boolean }) {
  return (
    <div className="paper">
      <div className={landscape ? 'sheet sheet-l' : 'sheet'}>{children}</div>
    </div>
  );
}

/** PrintBar — barra fixa no topo (não imprime) com botão Imprimir. */
export function PrintBar({ title, onPrint }: { title: string; onPrint?: () => void }) {
  return (
    <div className="a4-shell-bar no-print sticky top-0 z-10 bg-background border-b border-border px-4 py-2 flex items-center justify-between">
      <span className="text-sm font-medium">{title}</span>
      <button
        onClick={onPrint || (() => window.print())}
        className="btn-l btn-l-red"
      >
        Imprimir
      </button>
    </div>
  );
}
