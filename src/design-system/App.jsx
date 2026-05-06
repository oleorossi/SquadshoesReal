import React, { useState, useEffect } from 'react';
import {
  Sidebar, Topbar, Btn,
} from './components/Components';
import { TweaksPanel, TweakSection, TweakToggle, TweakRadio, useTweaks } from './components/TweaksPanel';
import { Dashboard }        from './components/Dashboard';
import { ProducaoScreen }   from './components/ProducaoScreen';
import { OrdensScreen }     from './components/OrdensScreen';
import { MateriaisScreen }  from './components/MateriaisScreen';

const TWEAK_DEFAULTS = {
  density: 'comfortable',
  sidebarGlass: false,
  showAlert: true,
};

const titles = {
  dashboard: { title: 'Painel da fábrica',     subtitle: 'Planta 02 · Turno A · 30/04/2026', breadcrumbs: ['Franca · Planta 02', 'Painel'] },
  producao:  { title: 'Produção',              subtitle: '4 linhas ativas · turno A',         breadcrumbs: ['Operações', 'Produção'] },
  ordens:    { title: 'Ordens de produção',    subtitle: '12 ativas · 3 atrasadas',           breadcrumbs: ['Operações', 'Ordens (OPs)'] },
  qualidade: { title: 'Controle de qualidade', breadcrumbs: ['Operações', 'Qualidade'] },
  expedicao: { title: 'Expedição',             breadcrumbs: ['Operações', 'Expedição'] },
  materiais: { title: 'Materiais',             subtitle: '94 SKUs · 4 em alerta', breadcrumbs: ['Estoque', 'Materiais'] },
  acabados:  { title: 'Produtos acabados',     breadcrumbs: ['Estoque', 'Acabados'] },
  fornec:    { title: 'Fornecedores',          breadcrumbs: ['Estoque', 'Fornecedores'] },
  reports:   { title: 'Relatórios',            breadcrumbs: ['Insights', 'Relatórios'] },
  team:      { title: 'Equipe',                breadcrumbs: ['Insights', 'Equipe'] },
};

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Lucide icons (lazy, optional). If using lucide-react component lib, swap data-lucide for <Icon/>.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.lucide) {
      window.lucide.createIcons();
    }
  });

  const t = titles[page] || { title: 'Squad Shoes Factory OS' };
  const sidebarW = collapsed ? 72 : 248;

  const renderScreen = () => {
    switch (page) {
      case 'dashboard': return <Dashboard />;
      case 'producao':  return <ProducaoScreen />;
      case 'ordens':    return <OrdensScreen />;
      case 'materiais': return <MateriaisScreen />;
      default:
        return (
          <div style={{ padding: 28 }}>
            <div style={{ background: 'white', border: '1px solid hsl(214 14% 89%)', borderRadius: 14, padding: 60, textAlign: 'center' }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 18, fontWeight: 700 }}>{t.title}</div>
              <div style={{ fontSize: 13, color: 'hsl(215 12% 46%)', marginTop: 6 }}>Tela em construção.</div>
            </div>
          </div>
        );
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'hsl(210 20% 98.5%)' }}>
      <Sidebar active={page} onNav={setPage} collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} glass={tweaks.sidebarGlass} />
      <div style={{ marginLeft: sidebarW, transition: 'margin-left 220ms cubic-bezier(0.4, 0, 0.2, 1)' }}>
        <Topbar
          title={t.title}
          subtitle={t.subtitle}
          breadcrumbs={t.breadcrumbs}
          actions={<>
            <Btn variant="ghost" size="sm" icon="download">Exportar</Btn>
            <Btn variant="primary" size="sm" icon="plus">Nova OP</Btn>
          </>}
        />
        {renderScreen()}
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection title="Layout">
          <TweakRadio label="Densidade" value={tweaks.density}
            options={[{ value: 'compact', label: 'Compacto' }, { value: 'comfortable', label: 'Confortável' }]}
            onChange={v => setTweak('density', v)} />
          <TweakToggle label="Sidebar com glassmorphism" value={tweaks.sidebarGlass}
            onChange={v => setTweak('sidebarGlass', v)} />
        </TweakSection>
        <TweakSection title="Conteúdo">
          <TweakToggle label="Mostrar alerta de linha parada" value={tweaks.showAlert}
            onChange={v => setTweak('showAlert', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}
