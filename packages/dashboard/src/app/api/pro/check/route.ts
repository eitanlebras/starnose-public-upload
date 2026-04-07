import { NextRequest, NextResponse } from 'next/server';
import { isPro } from '@/lib/proUsers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let email = '';
  try {
    const body = await req.json();
    email = typeof body?.email === 'string' ? body.email : '';
  } catch {}
  return NextResponse.json({ isPro: isPro(email) });
}
