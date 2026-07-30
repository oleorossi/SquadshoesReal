/**
 * Corpus de batidas REAIS de produção — rede de regressão do motor de ponto.
 *
 * Extraído de `time_records` (projeto ssvxfoybzmjlypnipqzn) em 30/07/2026, durante a
 * auditoria de RH (`docs/AUDITORIA_RH_PONTO_2026-07-29.md`). Contém APENAS o array de
 * batidas — sem nome, matrícula ou data — então não carrega dado pessoal.
 *
 * Por que existe: até esta auditoria, a única rede sob `splitDayMinutes` eram casos
 * sintéticos. Eles passavam verdes enquanto o motor pagava 21h32 num único dia, porque
 * nenhum caso real estava travado. Este corpus cobre os 7 padrões de pareamento que
 * REALMENTE ocorrem, incluindo as bordas que produziram os achados do laudo:
 * batida ímpar ≥5, batida manual (`*`), madrugada, almoço curto e dia longo.
 *
 * Use com `splitDayMinutes.snapshot.test.ts`: qualquer mudança no motor passa a dizer
 * QUAIS buckets mudaram e em quantos minutos, em vez de só "os testes passaram".
 */

export interface CorpusBucket {
  /** Nome do padrão de pareamento. */
  bucket: string;
  /** O que este padrão representa no chão de fábrica. */
  descricao: string;
  batidas: string[][];
}

export const PUNCHES_REAIS: CorpusBucket[] = [
  {
    bucket: 'n1',
    descricao: 'Uma batida só — esqueceu de bater a saída. Sempre pendência.',
    batidas: [
      ['00:03'], ['00:06'], ['02:48'], ['02:51'], ['02:53'], ['03:04'],
      ['03:52'], ['04:36'], ['04:50'], ['04:51'], ['05:41'], ['06:28'],
    ],
  },
  {
    bucket: 'n3',
    descricao: 'Três batidas — faltou uma. Não dá pra inferir qual. Sempre pendência.',
    batidas: [
      ['08:13', '12:02', '21:06'], ['08:13', '13:00', '20:39'], ['08:13', '13:03', '20:10'],
      ['08:19', '12:03', '20:11'], ['08:00', '19:19', '19:44'], ['08:00', '08:04', '19:11'],
      ['07:55', '12:02', '18:58'], ['08:08', '13:06', '19:08'], ['08:09', '13:07', '19:01'],
      ['07:53', '18:25', '18:27'], ['08:22', '17:19', '18:56'], ['07:56', '12:53', '18:24'],
      ['08:00*', '18:00*', '18:21'], ['07:55', '13:00', '18:13'],
    ],
  },
  {
    bucket: 'impar5',
    descricao:
      'Cinco ou mais batidas em número ímpar — batida sobrando. Pagava o intervalo ' +
      'inteiro (até 21h32/dia) até a decisão do dono de 30/07/2026; agora é pendência.',
    batidas: [
      ['00:00', '08:00', '16:23', '17:26', '22:32'],
      ['00:40', '07:58', '12:02', '13:15', '22:16'],
      ['01:17', '08:01', '12:16', '13:17', '21:57'],
      ['01:55', '07:39', '12:01', '12:33', '20:04'],
      ['08:01', '12:00', '13:01', '15:59', '22:21'],
      ['08:00', '13:48', '14:42', '19:14', '22:00'],
      ['07:56', '12:00', '13:00', '18:02', '21:12'],
      ['08:38', '12:08', '12:59', '21:13', '21:48'],
      ['07:09', '12:01', '12:10', '13:03', '20:07'],
      ['08:04', '12:13', '13:02', '18:10', '21:00'],
      ['07:59', '12:00', '13:02', '18:01', '20:35'],
    ],
  },
  {
    bucket: 'n2_cruza',
    descricao:
      'Duas batidas cruzando o meio-dia — entrada e saída, almoço inferido. ' +
      'Inclui saídas lançadas à mão pelo RH (sufixo *).',
    batidas: [
      ['00:00', '18:00*'], ['00:13', '18:00*'], ['00:43', '18:00*'],
      ['06:33', '23:38'], ['06:33', '23:27'], ['06:45', '22:33'], ['06:49', '22:17'],
      ['07:36', '23:03'], ['08:19', '23:38'], ['07:46', '22:50'], ['07:58', '22:59'],
      ['08:05', '23:03'], ['08:17', '23:11'],
    ],
  },
  {
    bucket: 'n2_seco',
    descricao: 'Duas batidas sem cruzar o meio-dia — turno curto, sem almoço a descontar.',
    batidas: [
      ['13:13', '22:00'], ['13:28', '22:00'], ['00:03', '08:24'], ['00:03', '08:01'],
      ['13:16', '21:08'], ['14:06', '21:56'], ['13:06', '20:41'], ['13:11', '20:14'],
      ['13:07', '20:05'], ['13:08', '20:05'], ['03:52', '10:24'], ['13:02', '19:18'],
    ],
  },
  {
    bucket: 'par4',
    descricao: 'Quatro batidas — o padrão canônico: entrada, almoço, volta, saída.',
    batidas: [
      ['02:25', '08:39', '12:56', '20:28'], ['02:01', '08:39', '12:59', '18:35'],
      ['06:39', '12:10', '12:18', '23:03'], ['07:08', '12:13', '13:03', '23:15'],
      ['06:16', '12:02', '13:02', '21:59'], ['07:49', '12:08', '13:04', '23:26'],
      ['07:52', '12:14', '12:59', '23:24'], ['07:40', '12:01', '13:07', '23:06'],
      ['06:48', '12:29', '13:34', '22:06'], ['08:01', '12:05', '12:57', '23:04'],
      ['08:02', '12:05', '18:00*', '23:05'], ['08:06', '12:05', '13:09', '23:06'],
    ],
  },
  {
    bucket: 'par6',
    descricao: 'Seis ou mais batidas pares — saídas intermediárias além do almoço.',
    batidas: [
      ['07:53', '09:59', '11:05', '12:02', '13:06', '21:58'],
      ['07:09', '12:02', '13:00', '14:04', '14:55', '20:11'],
      ['07:58', '13:36', '15:09', '16:46', '16:57', '19:22'],
      ['07:36', '11:17', '11:26', '12:01', '12:53', '16:09', '17:14', '18:25'],
      ['07:47', '12:02', '12:54', '16:03', '16:24', '18:09'],
      ['07:50', '12:02', '13:04', '16:02', '16:20', '18:02'],
      ['07:59', '12:02', '13:09', '16:04', '16:15', '18:10'],
      ['07:59', '12:03', '13:00', '16:05', '16:21', '18:07'],
      ['08:10', '12:00', '12:56', '17:04', '17:19', '18:16'],
      ['07:53', '12:05', '12:33', '14:11', '14:16', '17:57'],
      ['08:09', '12:03', '12:55', '16:02', '16:16', '18:10'],
      ['09:26', '13:08', '14:23', '16:46', '16:56', '19:27'],
      ['08:10', '12:02', '12:55', '16:03', '16:16', '18:04'],
      ['08:11', '12:05', '12:57', '16:05', '16:18', '18:04'],
    ],
  },
];

/** Todos os arrays, achatados — para varreduras que não se importam com o bucket. */
export const TODAS_AS_BATIDAS: string[][] = PUNCHES_REAIS.flatMap(b => b.batidas);
