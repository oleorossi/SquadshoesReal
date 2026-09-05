import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import BankReconciliation from '@/pages/BankReconciliation';

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="destino">{location.pathname}{location.search}{location.hash}</output>;
}

describe('rota histórica de conciliação', () => {
  it('redireciona para a central e preserva sessão/filtros/hash', async () => {
    render(
      <MemoryRouter initialEntries={['/conciliacao-bancaria?reconciliation=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&foo=x#linha']}>
        <Routes>
          <Route path="/conciliacao-bancaria" element={<BankReconciliation />} />
          <Route path="/financeiro" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    const target = await screen.findByLabelText('destino');
    expect(target).toHaveTextContent('/financeiro');
    expect(target).toHaveTextContent('tab=conciliacao');
    expect(target).toHaveTextContent('reconciliation=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(target).toHaveTextContent('foo=x');
    expect(target).toHaveTextContent('#linha');
  });
});
