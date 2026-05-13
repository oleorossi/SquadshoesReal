import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { House as Home, SignIn as LogIn, MagnifyingGlass as Search, WarningCircle as AlertCircle } from '@phosphor-icons/react';

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    // Registrar o caminho não encontrado para debugging
    console.error(`[404 Debug] Caminho não encontrado: ${location.pathname}${location.search}${location.hash}`);
    
    // Opcionalmente, você pode enviar isso para um serviço de log externo aqui
  }, [location.pathname]);

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-12 text-center sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md w-full">
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-destructive/10 p-6">
            <AlertCircle className="h-12 w-12 text-destructive" />
          </div>
        </div>
        
        <h1 className="text-6xl font-extrabold tracking-tight text-foreground sm:text-7xl">404</h1>
        
        <div className="mt-4">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Página não encontrada
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Desculpe, não conseguimos encontrar a página que você está procurando.
            <span className="block mt-2 font-mono text-xs bg-muted p-2 rounded truncate" title={location.pathname}>
              Caminho: {location.pathname}
            </span>
          </p>
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild className="gap-2">
            <Link to="/dashboard">
              <Home className="h-4 w-4" />
              Ir para o Painel
            </Link>
          </Button>
          
          <Button variant="outline" asChild className="gap-2">
            <Link to="/auth">
              <LogIn className="h-4 w-4" />
              Página de Login
            </Link>
          </Button>
        </div>

        <div className="mt-8 border-t pt-6">
          <p className="text-sm text-muted-foreground">
            Se você acredita que isso é um erro, por favor entre em contato com o suporte técnico.
          </p>
        </div>
      </div>
    </div>
  );
};

export default NotFound;