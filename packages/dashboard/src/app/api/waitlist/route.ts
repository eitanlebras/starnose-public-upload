import { NextRequest, NextResponse } from 'next/server';
import { getBackend } from '@/lib/waitlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  try {
    const backend = await getBackend();
    return NextResponse.json({ count: await backend.count() });
  } catch {
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ success: false, error: 'invalid_email' }, { status: 400 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '';

  const backend = await getBackend();
  const result = await backend.add(email, ip);
  if (result.ok) {
    return NextResponse.json({ success: true, count: result.count });
  }
  if (result.reason === 'duplicate') {
    return NextResponse.json({ success: false, error: 'duplicate' }, { status: 409 });
  }
  return NextResponse.json({ success: false, error: 'server_error' }, { status: 500 });
}
