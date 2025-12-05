import type { ExportedHandler } from '@cloudflare/workers-types';

export interface Env {
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  TO_EMAIL: string;
  TURNSTILE_SECRET: string;
  ALLOWED_ORIGINS?: string;
  SITE_NAME?: string;
  RESEND_DISABLED?: string;
}

interface ContactPayload {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  budget?: string;
  deadline?: string;
  message: string;
  turnstileToken: string;
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const originHeader = request.headers.get('Origin');
    const allowedOrigin = resolveAllowedOrigin(originHeader, env.ALLOWED_ORIGINS);

    if (request.method === 'OPTIONS') {
      return buildCorsResponse(204, allowedOrigin);
    }

    if (url.pathname !== '/api/contact') {
      return buildJsonResponse(404, { success: false, error: 'Not found' }, allowedOrigin);
    }

    if (request.method !== 'POST') {
      return buildJsonResponse(405, { success: false, error: 'Method not allowed' }, allowedOrigin, {
        'Allow': 'POST, OPTIONS'
      });
    }

    let payload: ContactPayload;

    try {
      const raw = await request.json();
      payload = sanitizePayload(raw as Partial<ContactPayload>);
    } catch (err) {
      return buildJsonResponse(400, { success: false, error: 'Invalid JSON payload' }, allowedOrigin);
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      return buildJsonResponse(422, { success: false, error: validationError }, allowedOrigin);
    }

    const ip = request.headers.get('CF-Connecting-IP') ?? undefined;
    const turnstilePassed = await verifyTurnstile(payload.turnstileToken, env.TURNSTILE_SECRET, ip);
    if (!turnstilePassed) {
      return buildJsonResponse(403, { success: false, error: 'Bot verification failed' }, allowedOrigin);
    }

    try {
      await sendResendEmail(payload, env);
      return buildJsonResponse(200, { success: true }, allowedOrigin);
    } catch (error) {
      console.error('Resend delivery failure', error);
      return buildJsonResponse(502, { success: false, error: 'メール送信に失敗しました。時間をおいて再度お試しください。' }, allowedOrigin);
    }
  }
};

function sanitizePayload(payload: Partial<ContactPayload>): ContactPayload {
  return {
    name: (payload.name ?? '').trim(),
    email: (payload.email ?? '').trim(),
    phone: (payload.phone ?? '').trim(),
    subject: payload.subject ?? 'お問い合わせ',
    budget: payload.budget ?? '',
    deadline: (payload.deadline ?? '').trim(),
    message: (payload.message ?? '').trim(),
    turnstileToken: payload.turnstileToken ?? ''
  };
}

function validatePayload(payload: ContactPayload): string | null {
  if (!payload.name || payload.name.length < 2) {
    return 'お名前は2文字以上で入力してください。';
  }
  if (!payload.email || !emailRegex.test(payload.email)) {
    return 'メールアドレスの形式が正しくありません。';
  }
  if (!payload.subject) {
    return '件名を選択してください。';
  }
  if (!payload.message || payload.message.length < 10) {
    return 'メッセージは10文字以上で入力してください。';
  }
  if (!payload.turnstileToken) {
    return '検証トークンが取得できませんでした。';
  }
  return null;
}

async function verifyTurnstile(token: string, secret: string, ip?: string): Promise<boolean> {
  if (!secret) {
    throw new Error('TURNSTILE_SECRET is not configured');
  }

  const body = new URLSearchParams();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) {
    body.append('remoteip', ip);
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  if (!response.ok) {
    console.error('Turnstile verification failed with status', response.status);
    return false;
  }

  const result = (await response.json()) as { success: boolean };
  return Boolean(result.success);
}

async function sendResendEmail(payload: ContactPayload, env: Env): Promise<void> {
  if (env.RESEND_DISABLED === 'true') {
    console.info('Resend delivery skipped (RESEND_DISABLED=true)');
    return;
  }
  const toList = env.TO_EMAIL.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!toList.length) {
    throw new Error('TO_EMAIL is not configured');
  }

  const subject = `[${env.SITE_NAME ?? 'WANYA'}] ${payload.subject} from ${payload.name}`;

  const textBody = buildTextBody(payload);
  const htmlBody = buildHtmlBody(payload, env);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: toList,
      reply_to: payload.email,
      subject,
      text: textBody,
      html: htmlBody
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend API error: ${response.status} ${errorBody}`);
  }
}

function buildTextBody(payload: ContactPayload): string {
  return [
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Phone: ${payload.phone || '-'}`,
    `Subject: ${payload.subject}`,
    `Budget: ${payload.budget || '-'}`,
    `Deadline: ${payload.deadline || '-'}`,
    '',
    'Message:',
    payload.message
  ].join('\n');
}

function buildHtmlBody(payload: ContactPayload, env: Env): string {
  const escape = (value: string) => value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char));
  const row = (label: string, value: string) => `<tr><th align="left" style="padding:4px 8px;">${label}</th><td style="padding:4px 8px;">${escape(value)}</td></tr>`;
  return `<!doctype html>
<html lang="ja">
  <body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#f6f6f7;padding:16px;">
    <table cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:auto;background:#ffffff;border-radius:8px;border:1px solid #e0e0e0;">
      <tr>
        <td style="padding:16px 24px;border-bottom:1px solid #f0f0f0;">
          <strong>${escape(env.SITE_NAME ?? 'WANYA Contact')}</strong>
          <div style="color:#666;font-size:14px;margin-top:4px;">新しいお問い合わせが届きました。</div>
        </td>
      </tr>
      <tr>
        <td>
          <table style="width:100%;font-size:14px;">
            ${row('お名前', payload.name)}
            ${row('メール', payload.email)}
            ${row('電話', payload.phone || '-')} 
            ${row('件名', payload.subject)}
            ${row('ご予算', payload.budget || '-')} 
            ${row('希望納期', payload.deadline || '-')} 
          </table>
          <div style="padding:16px 24px;border-top:1px solid #f0f0f0;">
            <div style="font-weight:600;margin-bottom:8px;">メッセージ</div>
            <div style="white-space:pre-wrap;line-height:1.6;color:#333;">${escape(payload.message)}</div>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function resolveAllowedOrigin(origin: string | null, configured?: string): string | null {
  if (!origin || !configured) {
    return null;
  }
  const entries = configured.split(',').map((value) => value.trim()).filter(Boolean);
  if (entries.includes('*')) {
    return origin;
  }
  return entries.includes(origin) ? origin : null;
}

function buildCorsResponse(status: number, origin: string | null): Response {
  return new Response(null, {
    status,
    headers: buildCorsHeaders(origin)
  });
}

function buildJsonResponse(status: number, body: unknown, origin: string | null, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...buildCorsHeaders(origin),
      ...extraHeaders
    }
  });
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export default worker;
