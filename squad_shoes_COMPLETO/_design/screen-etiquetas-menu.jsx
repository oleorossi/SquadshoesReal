// LOGÍSTICA · ETIQUETAS — menu de tipos de etiqueta que o usuário pode imprimir
// (não é o catálogo de templates do sistema — é a tela onde operador escolhe o que imprimir)
function LogEtiquetas() {
  const tipos = [
    { id: 'CXIND-A', nome: 'Caixa individual · A',  dim: '100×60mm',   uso: 'Padrão · uma cor', icon: 'sm', impr: 'Zebra GX430t · 5 estações', hoje: 824 },
    { id: 'CXIND-B', nome: 'Caixa individual · B',  dim: '100×100mm',  uso: 'Sandália de tiras', icon: 'md', impr: 'Zebra GX430t · 5 estações', hoje: 142 },
    { id: 'CXIND-C', nome: 'Caixa individual · C',  dim: '100×50mm',   uso: 'Linha econômica',  icon: 'xs', impr: 'Brother QL-820 · 2 estações', hoje: 218 },
    { id: 'CXEXT-A', nome: 'Caixa externa · A',     dim: '100×150mm',  uso: 'Master pack',       icon: 'lg', impr: 'Zebra ZD420 · 2 estações', hoje: 64 },
    { id: 'CXEXT-B', nome: 'Caixa externa · B',     dim: '100×150mm',  uso: 'Manifesto',         icon: 'lg', impr: 'Zebra ZD420 · 2 estações', hoje: 28 },
    { id: 'MP-A',    nome: 'Matéria-prima',         dim: '100×70mm',   uso: 'Recebimento',       icon: 'md', impr: 'Zebra GX430t · 1 estação',  hoje: 8 },
    { id: 'PAR',     nome: 'Tag de par',            dim: '50×80mm',    uso: 'Tag interna',       icon: 'xs', impr: 'Brother QL-820 · 2 estações', hoje: 480 },
    { id: 'MINIQR',  nome: 'Mini-tag de posto',     dim: '70×50mm',    uso: 'Apontamento posto', icon: 'sm', impr: 'Brother QL-820 · 2 estações', hoje: 16 },
    { id: 'CARTAO',  nome: 'Cartão de OP (A5)',     dim: '148×210mm',  uso: 'Chão de fábrica',   icon: 'xl', impr: 'HP M404 · A4 padrão',       hoje: 12 },
  ];
  return (
    <LightShell active="etq" breadcrumb="LOGÍSTICA · ETIQUETAS" title="IMPRIMIR ETIQUETAS" actions={<>
      <button className="btn-l">Histórico de impressões</button>
      <button className="btn-l">Status impressoras</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Etiquetas hoje', v: '1.792', s: 'em 9 tipos' },
          { l: 'Impressoras',    v: '12',    s: '4 modelos · 6 ativas' },
          { l: 'Pendentes',      v: '34',    s: 'aguardando bipar' },
          { l: 'Reimpressões',   v: '8',     s: '0,4% do total' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5 }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ marginBottom: 14 }}>
          <div className="p-eyebrow">Selecione o tipo</div>
          <div className="p-display" style={{ fontSize: 22, marginTop: 4 }}>9 FORMATOS DISPONÍVEIS</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {tipos.map((t, i) => {
            const dims = { xs: 48, sm: 60, md: 72, lg: 92, xl: 110 };
            return (
              <div key={i} style={{ border: '1px solid var(--p-line)', background: 'var(--p-soft)', padding: 16, cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                {/* mini preview */}
                <div style={{ width: dims[t.icon], height: dims[t.icon] * 0.7, background: '#fff', border: '1px solid #000', position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 4, left: 4, right: 4, height: 2, background: '#000' }}/>
                  <div style={{ position: 'absolute', top: 10, left: 4, height: 6, width: 16, background: '#000' }}/>
                  <div style={{ position: 'absolute', top: 10, right: 4, fontFamily: 'Anton', color: 'var(--p-red)', fontSize: dims[t.icon] * 0.35, lineHeight: 1 }}>37</div>
                  <div style={{ position: 'absolute', bottom: 4, left: 4, right: 4, height: 3, background: '#000' }}/>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9.5, color: 'var(--p-red)', fontWeight: 700, letterSpacing: '0.1em' }}>{t.id}</div>
                    <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8.5, color: 'var(--p-mute)', letterSpacing: '0.1em' }}>{t.hoje} hoje</div>
                  </div>
                  <div style={{ fontFamily: 'Anton', fontSize: 16, marginTop: 4, letterSpacing: '0.01em', lineHeight: 1 }}>{t.nome}</div>
                  <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 3 }}>{t.dim}</div>
                  <div style={{ fontSize: 11, marginTop: 6, fontWeight: 500 }}>{t.uso}</div>
                  <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 4 }}>{t.impr}</div>
                  <button className="btn-l-red btn-l" style={{ marginTop: 10, fontSize: 11, height: 28 }}>Imprimir →</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </LightShell>
  );
}
window.LogEtiquetas = LogEtiquetas;
