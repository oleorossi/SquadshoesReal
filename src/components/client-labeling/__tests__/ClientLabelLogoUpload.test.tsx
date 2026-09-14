import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientLabelLogoUpload } from '@/components/client-labeling/ClientLabelLogoUpload';

const { uploadMock, removeMock, getPublicUrlMock, toastError, toastSuccess } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  getPublicUrlMock: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: uploadMock,
        remove: removeMock,
        getPublicUrl: getPublicUrlMock,
      }),
    },
  },
}));

describe('ClientLabelLogoUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mockResolvedValue({ error: null });
    removeMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({
      data: { publicUrl: 'https://cdn.example/storage/v1/object/public/client-logos/cli-2/label-logo-objetiva.png' },
    });
  });

  it('expõe o campo de logomarca do cliente', () => {
    render(
      <ClientLabelLogoUpload clientId="cli-2" logoUrl={null} onLogoChange={vi.fn()} />,
    );
    expect(screen.getByText(/Logomarca do cliente/i)).toBeTruthy();
    expect(document.getElementById('objetiva-logo-upload')).toBeTruthy();
    expect((document.getElementById('objetiva-logo-upload') as HTMLInputElement).accept).toMatch(/png/i);
  });

  it('envia PNG para o path da hangtag e devolve a URL', async () => {
    const onLogoChange = vi.fn();
    render(
      <ClientLabelLogoUpload clientId="cli-2" logoUrl={null} onLogoChange={onLogoChange} />,
    );
    const input = document.getElementById('objetiva-logo-upload') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'marca.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalled();
    });
    expect(uploadMock.mock.calls[0]![0]).toBe('cli-2/label-logo-objetiva.png');
    await waitFor(() => {
      expect(onLogoChange).toHaveBeenCalled();
    });
    expect(String(onLogoChange.mock.calls[0]![0])).toContain('label-logo-objetiva.png');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('recusa SVG', async () => {
    const onLogoChange = vi.fn();
    render(
      <ClientLabelLogoUpload clientId="cli-2" logoUrl={null} onLogoChange={onLogoChange} />,
    );
    const input = document.getElementById('objetiva-logo-upload') as HTMLInputElement;
    const file = new File(['<svg></svg>'], 'marca.svg', { type: 'image/svg+xml' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(onLogoChange).not.toHaveBeenCalled();
  });
});
