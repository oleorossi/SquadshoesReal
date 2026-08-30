import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientFormDialog from '@/components/clients/ClientFormDialog';
import type { ClientFormData } from '@/hooks/useClients';

const { lookupCnpjMock, toastErrorMock, toastSuccessMock, toastWarningMock } = vi.hoisted(() => ({
  lookupCnpjMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarningMock: vi.fn(),
}));

vi.mock('@/lib/cnpjLookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cnpjLookup')>()),
  lookupCnpj: lookupCnpjMock,
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    warning: toastWarningMock,
  },
}));

const EMPTY_FORM: ClientFormData = {
  razao_social: '',
  nome_fantasia: '',
  cnpj: '27414388000123',
  inscricao_estadual: '',
  endereco: '',
  numero: '',
  bairro: '',
  cidade: '',
  estado: '',
  cep: '',
  codigo_municipio: '',
  email: '',
  telefone: '',
  contato: '',
  notes: '',
  economic_group_id: null,
  active: true,
  logo_url: '',
  silk_url: null,
  is_favorite: false,
  accepts_bundled_packaging: true,
  credit_limit: 0,
  branch_code: null,
  branch_name: null,
  icms_contribuinte: null,
};

function Harness() {
  const [form, setForm] = useState(EMPTY_FORM);
  return (
    <>
      <ClientFormDialog
        open
        onOpenChange={vi.fn()}
        editingClient={null}
        form={form}
        setForm={setForm}
        economicGroups={[]}
        onSubmit={vi.fn()}
      />
      <output data-testid="client-form-state">{JSON.stringify(form)}</output>
    </>
  );
}

describe('ClientFormDialog — consulta de CNPJ', () => {
  beforeEach(() => {
    lookupCnpjMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    toastWarningMock.mockReset();
  });

  it('preenche os dados oficiais quando a consulta retorna sucesso', async () => {
    lookupCnpjMock.mockResolvedValue({
      status: 'success',
      data: {
        razao_social: 'VIA Z COMERCIO DE CALCADOS LTDA',
        nome_fantasia: 'VIA Z',
        descricao_tipo_de_logradouro: 'RUA',
        logradouro: 'DOS TESTES',
        numero: '123',
        bairro: 'CENTRO',
        municipio: 'VALENCA',
        uf: 'RJ',
        cep: '27600000',
        codigo_municipio_ibge: 3306107,
        ddd_telefone_1: '2420000000',
        email: 'cliente@example.com',
      },
    });
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTitle('Buscar dados do CNPJ na Receita Federal'));

    await waitFor(() => expect(screen.getByTestId('client-form-state')).toHaveTextContent(
      'VIA Z COMERCIO DE CALCADOS LTDA',
    ));
    expect(screen.getByTestId('client-form-state')).toHaveTextContent('VALENCA');
    expect(screen.getByTestId('client-form-state')).toHaveTextContent('27600-000');
    expect(screen.getByTestId('client-form-state')).toHaveTextContent('3306107');
    expect(toastSuccessMock).toHaveBeenCalledWith('Dados do CNPJ preenchidos automaticamente!');
  });

  it.each([
    ['not-found', 'error', 'CNPJ não encontrado na base consultada da Receita Federal.'],
    ['timeout', 'warning', 'A consulta do CNPJ demorou demais. Tente novamente.'],
    ['rate-limit', 'warning', 'Limite temporário de consultas atingido. Aguarde um instante e tente novamente.'],
    ['service', 'error', 'O serviço de consulta de CNPJ está indisponível no momento. Tente novamente mais tarde.'],
    ['network', 'error', 'Não foi possível acessar o serviço de consulta de CNPJ. Tente novamente; se persistir, avise o suporte.'],
  ] as const)('exibe mensagem específica para %s', async (status, tone, message) => {
    lookupCnpjMock.mockResolvedValue({ status });
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTitle('Buscar dados do CNPJ na Receita Federal'));

    const toastMock = tone === 'warning' ? toastWarningMock : toastErrorMock;
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(message));
  });
});
