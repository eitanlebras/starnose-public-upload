import { NextResponse } from 'next/server';
import { getBackend } from '@/lib/waitlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const backend = await getBackend();
    return NextResponse.json({ count: await backend.count() });
  } catch {
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}
