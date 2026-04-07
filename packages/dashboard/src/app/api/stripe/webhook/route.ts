import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { upsertProUser } from '@/lib/proUsers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    if (secret && sig) {
      event = stripe.webhooks.constructEvent(raw, sig, secret);
    } else {
      event = JSON.parse(raw) as Stripe.Event;
    }
  } catch (err: any) {
    return NextResponse.json({ error: `invalid_signature: ${err?.message ?? ''}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const email =
          s.customer_details?.email ||
          s.customer_email ||
          (s.metadata?.email as string | undefined) ||
          '';
        if (email) {
          upsertProUser({
            email,
            stripe_customer_id: typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null,
            stripe_subscription_id:
              typeof s.subscription === 'string' ? s.subscription : s.subscription?.id ?? null,
            status: 'active',
            current_period_end: null,
          });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        let email = (sub.metadata?.email as string | undefined) || '';
        if (!email) {
          try {
            const cust = await stripe.customers.retrieve(customerId);
            if (!('deleted' in cust) || !cust.deleted) {
              email = (cust as Stripe.Customer).email || '';
            }
          } catch {}
        }
        if (email) {
          upsertProUser({
            email,
            stripe_customer_id: customerId,
            stripe_subscription_id: sub.id,
            status: event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status,
            current_period_end: sub.current_period_end ?? null,
          });
        }
        break;
      }
      default:
        break;
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'handler_error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
