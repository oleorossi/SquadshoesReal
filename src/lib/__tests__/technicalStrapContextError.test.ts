import { technicalStrapContextErrorMessage } from '@/lib/technicalStrapContextError';

describe('technicalStrapContextErrorMessage', () => {
  it.each([
    [
      { code: 'technical_sheet_stale' },
      'A ficha técnica mudou durante a correção. Os dados foram atualizados; confira e tente novamente.',
    ],
    [
      { details: '{"code":"strap_pipeline_busy"}' },
      'Outra operação de tiras está em andamento. Aguarde alguns segundos e tente novamente.',
    ],
    [
      { code: 'PGRST003' },
      'O banco está ocupado e não conseguiu iniciar a correção a tempo. Aguarde alguns segundos e tente novamente.',
    ],
    [
      { code: '55P03' },
      'Outro cadastro está usando estes dados. Aguarde alguns segundos e tente novamente.',
    ],
  ])('traduz o erro técnico %# para uma orientação em pt-BR', (error, expected) => {
    expect(technicalStrapContextErrorMessage(error)).toBe(expected);
  });
});
