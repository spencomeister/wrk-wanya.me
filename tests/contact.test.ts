import worker, { type Env } from '../src/index';
import type { ExecutionContext } from '@cloudflare/workers-types';

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string'
    ? input
    : input instanceof Request
      ? input.url
      : input?.toString() ?? '';

  if (url.includes('turnstile')) {
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }

  if (url.includes('api.resend.com')) {
    return new Response('{}', { status: 200 });
  }

  throw new Error(`Unexpected fetch target: ${url}`);
};

async function run() {
  const env: Env = {
    RESEND_API_KEY: 'test-api-key',
    FROM_EMAIL: 'contact@example.com',
    TO_EMAIL: 'owner@example.com',
    TURNSTILE_SECRET: 'test-secret',
    ALLOWED_ORIGINS: 'https://test.local',
    SITE_NAME: 'Test WANYA',
    RESEND_DISABLED: 'true'
  };

  const payload = {
    name: 'テストユーザー',
    email: 'user@example.com',
    phone: '',
    subject: 'テスト送信',
    budget: 'under_10000',
    deadline: 'ASAP',
    message: 'これはローカルテストです。',
    turnstileToken: '1x0000000000000000000000000000000AA'
  };

  const request = new Request('https://test.local/api/contact', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://test.local',
      'CF-Connecting-IP': '127.0.0.1'
    },
    body: JSON.stringify(payload)
  });

  const response = await worker.fetch(request, env, {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined
  } as ExecutionContext);

  const data = await response.json();

  if (!response.ok || !data.success) {
    console.error('Response payload:', data);
    throw new Error('Contact worker test failed');
  }

  console.log('Contact worker test passed:', data);
}

run()
  .catch((error) => {
    console.error(error);
    throw error;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
  });
