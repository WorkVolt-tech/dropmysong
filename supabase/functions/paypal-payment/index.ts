import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getDefaultKey(jsonName: string, legacyName: string) {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  const raw = Deno.env.get(jsonName);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return parsed.default || Object.values(parsed)[0] || '';
  } catch {
    return '';
  }
}

function paypalBaseUrl() {
  return (Deno.env.get('DMS_PAYPAL_ENVIRONMENT') || 'sandbox').toLowerCase() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getPayPalAccessToken() {
  const clientId = Deno.env.get('DMS_PAYPAL_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('DMS_PAYPAL_CLIENT_SECRET') || '';
  if (!clientId || !clientSecret) throw new Error('PayPal API credentials are not configured');

  const basic = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'Accept-Language': 'en_US',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    console.error('PayPal OAuth error', response.status, data);
    throw new Error('Could not authenticate with PayPal');
  }

  return data.access_token as string;
}

async function paypalRequest(path: string, accessToken: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');

  const response = await fetch(`${paypalBaseUrl()}${path}`, { ...init, headers });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

  if (!response.ok) {
    const error: any = new Error(data?.message || data?.name || `PayPal request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function amountString(value: unknown) {
  return Number(value || 0).toFixed(2);
}

function sameAmount(left: unknown, right: unknown) {
  return amountString(left) === amountString(right);
}

function extractPurchaseUnit(order: any) {
  return Array.isArray(order?.purchase_units) ? order.purchase_units[0] : null;
}

function extractCapture(order: any) {
  const purchase = extractPurchaseUnit(order);
  const captures = purchase?.payments?.captures;
  return Array.isArray(captures) ? captures.find((item: any) => item.status === 'COMPLETED') || captures[0] : null;
}

function validateOrderAgainstRequest(order: any, requestRow: any) {
  const purchase = extractPurchaseUnit(order);
  if (!purchase) throw new Error('PayPal order is missing its purchase unit');

  const requestId = purchase.custom_id || purchase.reference_id;
  if (requestId !== requestRow.id) throw new Error('PayPal order does not match this request');

  const amount = purchase.amount;
  if (amount?.currency_code !== 'CAD' || !sameAmount(amount?.value, requestRow.tip_amount)) {
    throw new Error('PayPal order amount does not match this request');
  }
}

async function confirmRequestFromOrder(admin: any, requestRow: any, order: any) {
  validateOrderAgainstRequest(order, requestRow);
  const capture = extractCapture(order);
  if (!capture || capture.status !== 'COMPLETED') {
    throw new Error('PayPal payment is not completed');
  }

  const captureAmount = capture.amount;
  if (captureAmount?.currency_code !== 'CAD' || !sameAmount(captureAmount?.value, requestRow.tip_amount)) {
    throw new Error('PayPal capture amount does not match this request');
  }

  const { error } = await admin
    .from('song_requests')
    .update({
      payment_status: 'confirmed',
      payment_confirmed_at: new Date().toISOString(),
      paypal_order_id: order.id,
      paypal_capture_id: capture.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestRow.id);

  if (error) throw new Error(error.message);

  return {
    confirmed: true,
    order_id: order.id,
    capture_id: capture.id,
  };
}

async function captureAndConfirm(admin: any, requestRow: any, orderId: string, accessToken: string) {
  let order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, accessToken, {
    method: 'GET',
  });

  validateOrderAgainstRequest(order, requestRow);

  if (order.status === 'COMPLETED') {
    return confirmRequestFromOrder(admin, requestRow, order);
  }

  if (order.status !== 'APPROVED') {
    throw new Error(`PayPal order is not approved (status: ${order.status || 'unknown'})`);
  }

  try {
    order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, accessToken, {
      method: 'POST',
      headers: {
        'PayPal-Request-Id': `dms-capture-${orderId}`.slice(0, 38),
        Prefer: 'return=representation',
      },
      body: '{}',
    });
  } catch (error: any) {
    // If the browser return and webhook raced each other, another request may
    // already have captured the order. Re-read it before treating that as fatal.
    console.warn('PayPal capture attempt returned an error; checking order state', error?.data || error?.message || error);
    order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, accessToken, {
      method: 'GET',
    });
  }

  return confirmRequestFromOrder(admin, requestRow, order);
}

async function verifyWebhook(event: any, req: Request, accessToken: string) {
  const webhookId = Deno.env.get('DMS_PAYPAL_WEBHOOK_ID') || '';
  if (!webhookId) throw new Error('PayPal webhook ID is not configured');

  const body = {
    auth_algo: req.headers.get('paypal-auth-algo'),
    cert_url: req.headers.get('paypal-cert-url'),
    transmission_id: req.headers.get('paypal-transmission-id'),
    transmission_sig: req.headers.get('paypal-transmission-sig'),
    transmission_time: req.headers.get('paypal-transmission-time'),
    webhook_id: webhookId,
    webhook_event: event,
  };

  const verification = await paypalRequest('/v1/notifications/verify-webhook-signature', accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return verification?.verification_status === 'SUCCESS';
}

async function requestFromOrder(admin: any, order: any) {
  const purchase = extractPurchaseUnit(order);
  const requestId = purchase?.custom_id || purchase?.reference_id;
  if (!requestId) return null;

  const { data } = await admin
    .from('song_requests')
    .select('id,event_id,artist,song,tip_amount,payment_method,payment_status,guest_token,paypal_order_id,paypal_capture_id')
    .eq('id', requestId)
    .maybeSingle();

  return data || null;
}

async function handleWebhook(req: Request, admin: any) {
  let event: any;
  try {
    event = JSON.parse(await req.text());
  } catch {
    return json({ error: 'Invalid webhook payload' }, 400);
  }

  const accessToken = await getPayPalAccessToken();
  const verified = await verifyWebhook(event, req, accessToken);
  if (!verified) return json({ error: 'Invalid PayPal webhook signature' }, 400);

  if (event?.event_type === 'CHECKOUT.ORDER.APPROVED') {
    const orderId = event?.resource?.id;
    if (!orderId) return json({ ok: true });

    const order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, accessToken, { method: 'GET' });
    const requestRow = await requestFromOrder(admin, order);
    if (!requestRow || requestRow.payment_method !== 'paypal' || Number(requestRow.tip_amount || 0) <= 0) {
      return json({ ok: true });
    }

    try {
      await captureAndConfirm(admin, requestRow, orderId, accessToken);
    } catch (error) {
      console.error('Automatic PayPal capture from approved-order webhook failed', error);
      return json({ error: 'Could not capture approved PayPal order' }, 500);
    }
  }

  if (event?.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const orderId = event?.resource?.supplementary_data?.related_ids?.order_id;
    if (!orderId) return json({ ok: true });

    const order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, accessToken, { method: 'GET' });
    const requestRow = await requestFromOrder(admin, order);
    if (!requestRow || requestRow.payment_method !== 'paypal' || Number(requestRow.tip_amount || 0) <= 0) {
      return json({ ok: true });
    }

    try {
      await confirmRequestFromOrder(admin, requestRow, order);
    } catch (error) {
      console.error('PayPal completed-capture confirmation failed', error);
      return json({ error: 'Could not confirm PayPal capture' }, 500);
    }
  }

  return json({ ok: true });
}

export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = getDefaultKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Supabase service configuration is missing' }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (req.headers.get('paypal-transmission-id')) {
      try {
        return await handleWebhook(req, admin);
      } catch (error: any) {
        console.error('PayPal webhook error', error);
        return json({ error: error?.message || 'PayPal webhook failed' }, 500);
      }
    }

    let body: {
      action?: 'create' | 'capture';
      request_id?: string;
      guest_token?: string;
      order_id?: string;
      language?: string;
    } = {};

    try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

    if (!body.request_id || !body.guest_token) {
      return json({ error: 'request_id and guest_token are required' }, 400);
    }

    const { data: requestRow, error: requestError } = await admin
      .from('song_requests')
      .select('id,event_id,artist,song,tip_amount,payment_method,payment_status,guest_token,paypal_order_id,paypal_capture_id')
      .eq('id', body.request_id)
      .maybeSingle();

    if (requestError) return json({ error: requestError.message }, 500);
    if (!requestRow || requestRow.guest_token !== body.guest_token) return json({ error: 'Request not found' }, 404);
    if (requestRow.payment_method !== 'paypal' || Number(requestRow.tip_amount || 0) <= 0) {
      return json({ error: 'This request is not waiting for PayPal' }, 409);
    }

    if (requestRow.payment_status === 'confirmed') {
      return json({ confirmed: true, order_id: requestRow.paypal_order_id, capture_id: requestRow.paypal_capture_id });
    }

    try {
      const accessToken = await getPayPalAccessToken();

      if (body.action === 'capture') {
        if (!body.order_id) return json({ error: 'order_id is required' }, 400);
        if (requestRow.paypal_order_id && requestRow.paypal_order_id !== body.order_id) {
          return json({ error: 'PayPal order does not match this request' }, 409);
        }

        const result = await captureAndConfirm(admin, requestRow, body.order_id, accessToken);
        return json(result);
      }

      if (body.action !== 'create') return json({ error: 'Unknown action' }, 400);

      const { data: eventRow, error: eventError } = await admin
        .from('events')
        .select('id,slug,name')
        .eq('id', requestRow.event_id)
        .maybeSingle();

      if (eventError) return json({ error: eventError.message }, 500);
      if (!eventRow) return json({ error: 'Event not found' }, 404);

      const appBase = Deno.env.get('DMS_PUBLIC_APP_URL') || 'https://workvolt-tech.github.io/dropmysong/';
      const returnUrl = new URL('index.html', appBase);
      returnUrl.searchParams.set('event', eventRow.slug);
      returnUrl.searchParams.set('paypal', 'return');
      returnUrl.searchParams.set('request', requestRow.id);

      const cancelUrl = new URL(returnUrl);
      cancelUrl.searchParams.set('paypal', 'cancel');

      const description = `Drop My Song tip — ${requestRow.artist} — ${requestRow.song}`.slice(0, 127);
      const orderBody = {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: requestRow.id,
          custom_id: requestRow.id,
          description,
          amount: {
            currency_code: 'CAD',
            value: amountString(requestRow.tip_amount),
          },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'Drop My Song by DJ Maxo',
              locale: body.language === 'fr' ? 'fr-CA' : 'en-CA',
              shipping_preference: 'NO_SHIPPING',
              user_action: 'PAY_NOW',
              return_url: returnUrl.toString(),
              cancel_url: cancelUrl.toString(),
            },
          },
        },
      };

      const order = await paypalRequest('/v2/checkout/orders', accessToken, {
        method: 'POST',
        headers: {
          'PayPal-Request-Id': crypto.randomUUID(),
          Prefer: 'return=representation',
        },
        body: JSON.stringify(orderBody),
      });

      const approveUrl = order?.links?.find((link: any) => link.rel === 'payer-action' || link.rel === 'approve')?.href;
      if (!order?.id || !approveUrl) return json({ error: 'PayPal did not return an approval link' }, 502);

      const { error: saveError } = await admin
        .from('song_requests')
        .update({
          paypal_order_id: order.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestRow.id);

      if (saveError) return json({ error: saveError.message }, 500);

      return json({
        confirmed: false,
        order_id: order.id,
        approve_url: approveUrl,
      });
    } catch (error: any) {
      console.error('PayPal payment function error', error?.data || error);
      return json({ error: error?.message || 'PayPal payment failed' }, error?.status && error.status < 500 ? error.status : 500);
    }
  },
};
