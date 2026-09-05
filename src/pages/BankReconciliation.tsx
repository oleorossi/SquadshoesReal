import { Navigate, useLocation } from 'react-router-dom';

/** Mantém uma única fronteira de importação/match na central Financeiro. */
export default function BankReconciliation() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('tab', 'conciliacao');
  return (
    <Navigate
      replace
      to={{ pathname: '/financeiro', search: `?${params.toString()}`, hash: location.hash }}
    />
  );
}
