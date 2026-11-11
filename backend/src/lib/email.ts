import type { Bindings } from '../env';

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(env: Bindings, message: EmailMessage): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
    }),
  });
  return response.ok;
}

export async function sendAuthLink(
  env: Bindings,
  to: string,
  purpose: 'verify' | 'reset',
  token: string,
): Promise<boolean> {
  const action = purpose === 'verify' ? 'Verify your email' : 'Reset your password';
  const url = `${env.WEB_URL}/auth/${purpose}?token=${encodeURIComponent(token)}`;
  return sendEmail(env, {
    to,
    subject: `${action} · NEXA`,
    text: `${action}: ${url}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${action} by opening this link:</p><p><a href="${url}">${action}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}
