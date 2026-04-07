import { NextRequest, NextResponse } from 'next/server';
import { getStripe, PRO_PRICE_USD_CENTS } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { email?: string; successUrl?: string; cancelUrl?: string } = {};
  try {
    body = await req.json();
  } catch {}

  const origin =
    req.headers.get('origin') ||
    (() => {
      try {
        return new URL(req.url).origin;
      } catch {
        return 'http://localhost:3000';
      }
    })();

  const successUrl = body.successUrl || `${origin}/?checkout=success`;
  const cancelUrl = body.cancelUrl || `${origin}/?checkout=cancel`;

  try {
    const stripe = getStripe();
    const priceId = process.env.STRIPE_PRO_PRICE_ID;

    const lineItems: any[] = priceId
      ? [{ price: priceId, quantity: 1 }]
      : [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: PRO_PRICE_USD_CENTS,
              recurring: { interval: 'month' },
              product_data: { name: 'starnose pro' },
            },
          },
        ];

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: lineItems,
      customer_email: body.email || undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      metadata: body.email ? { email: body.email } : undefined,
      subscription_data: body.email ? { metadata: { email: body.email } } : undefined,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'checkout_error' }, { status: 500 });
  }
}
