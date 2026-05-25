import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignOut, DeviceMobile, Globe } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';

export default function MobileProfile() {
  const navigate = useNavigate();
  const [user, setUser] = useState<{ email?: string; full_name?: string } | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', u.id)
          .maybeSingle();
        setUser({ email: u.email ?? undefined, full_name: profile?.full_name ?? undefined });
      }
    })();
    // Detecta se app está rodando como PWA standalone (instalado)
    const mql = window.matchMedia('(display-mode: standalone)');
    setIsStandalone(mql.matches || (navigator as any).standalone === true);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold">Perfil</h2>

      <div className="bg-card border-[1.5px] border-foreground/15 rounded-lg p-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Nome</p>
        <p className="text-base font-bold">{user?.full_name || '—'}</p>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mt-2">Email</p>
        <p className="text-sm">{user?.email || '—'}</p>
      </div>

      <div className="bg-card border-[1.5px] border-foreground/15 rounded-lg p-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">App</p>
        <div className="flex items-center gap-2 text-sm">
          {isStandalone ? (
            <>
              <DeviceMobile className="h-4 w-4 text-emerald-600" weight="fill" />
              <span>Instalado como app</span>
            </>
          ) : (
            <>
              <Globe className="h-4 w-4 text-muted-foreground" />
              <span>Rodando no browser</span>
            </>
          )}
        </div>
        {!isStandalone && (
          <p className="text-xs text-muted-foreground mt-2">
            Pra instalar: Safari → Compartilhar → "Adicionar à Tela de Início".
          </p>
        )}
      </div>

      <button
        onClick={handleLogout}
        className="w-full border-[1.5px] border-destructive text-destructive rounded-lg py-3 font-bold uppercase tracking-wide flex items-center justify-center gap-2 active:bg-destructive/10"
      >
        <SignOut className="h-5 w-5" />
        Sair
      </button>

      <div className="pt-4 text-center text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
        Squad Vendas · v{import.meta.env.VITE_APP_VERSION || 'dev'}
      </div>
    </div>
  );
}
