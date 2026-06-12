import crypto from "crypto";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function first(...values: unknown[]) {
  return values.map(text).find(Boolean) || "";
}

function hmac(algorithm: string, secret: string, body: string, encoding: crypto.BinaryToTextEncoding = "hex") {
  return crypto.createHmac(algorithm, secret).update(body).digest(encoding);
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function detectWebhook(payload: unknown) {
  const root = asObject(payload);
  const data = asObject(root.data);
  const dataObject = asObject(data.object);
  const authNetPayload = asObject(root.payload);
  const squarePayment = asObject(asObject(data.object).payment);
  const adyenItem = asObject(asObject((root.notificationItems as unknown[])?.[0]).NotificationRequestItem);
  const paypalResource = asObject(root.resource);

  if (first(root.xRefNum, root.xCommand, root.xStatus)) {
    return {
      vendor: "Cardknox",
      event: first(root.xCommand, "payment.webhook"),
      orderId: first(root.xInvoice),
      transactionId: first(root.xRefNum),
      status: first(root.xStatus, root.xResult),
      amount: first(root.xAmount),
      authCode: first(root.xAuthCode),
    };
  }

  if (first(root.type).startsWith("payment_intent.") || first(dataObject.id).startsWith("pi_")) {
    const metadata = asObject(dataObject.metadata);
    return {
      vendor: "Stripe",
      event: first(root.type),
      orderId: first(metadata.orderId, metadata.order_id),
      transactionId: first(dataObject.id),
      status: first(dataObject.status),
      amount: first(dataObject.amount),
      currency: first(dataObject.currency),
    };
  }

  if (first(root.eventType).startsWith("net.authorize.")) {
    return {
      vendor: "Authorize.Net",
      event: first(root.eventType),
      orderId: first(authNetPayload.invoiceNumber),
      transactionId: first(authNetPayload.transactionId),
      status: first(authNetPayload.responseCode) === "1" ? "approved" : first(authNetPayload.responseCode),
      amount: first(authNetPayload.amount),
      authCode: first(authNetPayload.authCode),
    };
  }

  if (first(root.merchant_id, root.event_id) && first(root.type).includes("payment")) {
    return {
      vendor: "Square",
      event: first(root.type),
      orderId: first(squarePayment.order_id),
      transactionId: first(squarePayment.id, data.id),
      status: first(squarePayment.status),
      amount: first(asObject(squarePayment.amount_money).amount),
      currency: first(asObject(squarePayment.amount_money).currency),
    };
  }

  if (Array.isArray(root.notificationItems)) {
    return {
      vendor: "Adyen",
      event: first(adyenItem.eventCode),
      orderId: first(adyenItem.merchantReference),
      transactionId: first(adyenItem.pspReference),
      status: first(adyenItem.success) === "true" ? "success" : first(adyenItem.success),
      amount: first(asObject(adyenItem.amount).value),
      currency: first(asObject(adyenItem.amount).currency),
      authCode: first(adyenItem.reason).split(":")[0] || "",
    };
  }

  if (first(root.event_type).startsWith("PAYMENT.")) {
    return {
      vendor: "PayPal",
      event: first(root.event_type),
      orderId: first(paypalResource.invoice_id),
      transactionId: first(paypalResource.id),
      status: first(paypalResource.status),
      amount: first(asObject(paypalResource.amount).value),
      currency: first(asObject(paypalResource.amount).currency_code),
    };
  }

  return {
    vendor: "Generic",
    event: first(root.event, root.type, "payment.webhook"),
    orderId: first(root.orderId, root.order_id, root.invoice, root.invoiceNumber),
    transactionId: first(root.transactionId, root.transaction_id, root.paymentId, root.id),
    status: first(root.status),
    amount: first(root.amount),
    currency: first(root.currency),
    authCode: first(root.authCode, root.auth_code),
  };
}

function signatureStatus(req: Request, rawBody: string) {
  const secret = process.env.PAYFIX_WEBHOOK_TEST_SECRET || "";
  const headers = req.headers;

  if (!secret) {
    return {
      configured: false,
      verified: false,
      detail: "Set PAYFIX_WEBHOOK_TEST_SECRET to verify signatures. Payload parsing still works without it.",
    };
  }

  const stripe = headers.get("stripe-signature") || "";
  const anet = headers.get("x-anet-signature") || "";
  const square = headers.get("x-square-hmacsha256-signature") || "";
  const generic = headers.get("x-payfix-signature") || "";

  if (stripe) {
    const timestamp = stripe.match(/t=([^,]+)/)?.[1] || "";
    const expected = hmac("sha256", secret, `${timestamp}.${rawBody}`);
    return {
      configured: true,
      verified: stripe.includes(`v1=${expected}`),
      detail: "Stripe-style signature checked.",
    };
  }

  if (anet) {
    const expected = `sha512=${hmac("sha512", secret, rawBody)}`;
    return {
      configured: true,
      verified: anet.toLowerCase() === expected.toLowerCase(),
      detail: "Authorize.Net-style signature checked.",
    };
  }

  if (square) {
    const expected = hmac("sha256", secret, `${req.url}${rawBody}`, "base64");
    return {
      configured: true,
      verified: square === expected,
      detail: "Square-style signature checked using request URL + body.",
    };
  }

  if (generic) {
    return {
      configured: true,
      verified: generic === hmac("sha256", secret, rawBody),
      detail: "Generic HMAC SHA-256 signature checked.",
    };
  }

  return {
    configured: true,
    verified: false,
    detail: "Secret is configured, but no supported signature header was sent.",
  };
}

export async function GET() {
  return Response.json({
    ok: true,
    endpoint: "/api/webhook",
    purpose: "Local PayFix Webhook Lab receiver. Send POST JSON here from Webhook Lab to test replay, parsing, and optional signatures.",
    optionalSignatureSecret: "Set PAYFIX_WEBHOOK_TEST_SECRET in your Next dev server environment to verify signatures.",
  });
}

export async function POST(req: Request) {
  const receivedAt = new Date().toISOString();
  const rawBody = await req.text();
  const payload = safeJson(rawBody);

  if (!payload) {
    return Response.json(
      {
        ok: false,
        receivedAt,
        error: "Webhook body was not valid JSON.",
      },
      { status: 400 },
    );
  }

  const detected = detectWebhook(payload);

  return Response.json({
    ok: true,
    receivedAt,
    message: "PayFix test webhook received.",
    detected,
    signature: signatureStatus(req, rawBody),
    timelineHint: [
      `webhook ${detected.event}`,
      detected.transactionId ? `transactionId=${detected.transactionId}` : "",
      detected.orderId ? `orderId=${detected.orderId}` : "",
      detected.status ? `status=${detected.status}` : "",
      detected.amount ? `amount=${detected.amount}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
}
