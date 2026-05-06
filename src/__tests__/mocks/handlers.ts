import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('*/materials', () => {
    return HttpResponse.json([]);
  }),
  http.post('*/materials', async ({ request }) => {
    const material = await request.json();
    return HttpResponse.json({ id: 'mock-id', ...material as object }, { status: 201 });
  }),
  http.get('*/production-orders', () => {
    return HttpResponse.json([]);
  }),
  http.post('*/production-orders', async ({ request }) => {
    const op = await request.json();
    return HttpResponse.json({ id: 'op-id', status: 'created', ...op as object }, { status: 201 });
  }),
];
