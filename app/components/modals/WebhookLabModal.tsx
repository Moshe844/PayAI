import { Copy, FileSearch, RefreshCw, Send, ShieldCheck, Webhook, X } from "lucide-react";
import { useMemo, useState } from "react";

type WebhookLabModalProps = {
  onClose: () => void;
  conversationText: string;
  hasConnectedProject: boolean;
};

type ReplayResult = {
  ok?: boolean;
  error?: string;
  vendor?: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  responseBody?: string;
  requestHeaders?: Record<string, string>;
  requestPayload?: unknown;
  detectedVendor?: string;
  validationWarnings?: string[];
  hint?: string;
};

type EndpointCandidate = {
  file: string;
  route: string;
  confidence: number;
  evidence: string;
};

type VendorKey = "generic" | "stripe" | "authorize.net" | "cardknox" | "square" | "adyen" | "paypal";

const vendorPresets: Record<
  VendorKey,
  {
    label: string;
    signature: string;
    note: string;
    payload: unknown;
  }
> = {
  generic: {
    label: "Generic",
    signature: "HMAC SHA-256 over raw JSON body",
    note: "Use this for custom payment webhooks or unknown gateway signatures.",
    payload: {
      event: "payment.authorized",
      orderId: "ORD-10092",
      transactionId: "txn_9a82",
      gateway: "GenericGateway",
      amount: 2500,
      currency: "USD",
      status: "approved",
      createdAt: "2026-06-10T14:03:14.781Z",
    },
  },
  stripe: {
    label: "Stripe",
    signature: "Stripe-Signature: t=<timestamp>,v1=<HMAC_SHA256(timestamp.body)>",
    note: "Useful for local handlers that use Stripe-style signature verification.",
    payload: {
      id: "evt_1PayFixDemo",
      type: "payment_intent.succeeded",
      created: 1781100194,
      data: {
        object: {
          id: "pi_3PayFixDemo",
          amount: 2500,
          currency: "usd",
          status: "succeeded",
          metadata: { orderId: "ORD-10092" },
        },
      },
    },
  },
  "authorize.net": {
    label: "Authorize.Net",
    signature: "x-anet-signature: sha512=<HMAC_SHA512(body)>",
    note: "Matches common Authorize.Net webhook handler signature shape.",
    payload: {
      notificationId: "payfix-demo-notification",
      eventType: "net.authorize.payment.authcapture.created",
      eventDate: "2026-06-10T14:03:14.781Z",
      webhookId: "payfix-demo-webhook",
      payload: {
        responseCode: 1,
        authCode: "349821",
        avsResponse: "Y",
        transactionId: "60123456789",
        invoiceNumber: "ORD-10092",
        amount: 25.0,
      },
    },
  },
  cardknox: {
    label: "Cardknox",
    signature: "Generic HMAC SHA-256 header unless your project uses a custom Cardknox header",
    note: "Cardknox projects vary; this preset focuses on common xRefNum/xStatus/xResult fields.",
    payload: {
      xCommand: "cc:sale",
      xStatus: "Approved",
      xResult: "A",
      xRefNum: "10918202479",
      xAuthCode: "349821",
      xAmount: "7.49",
      xInvoice: "ORD-10092",
      xMaskedCardNumber: "xxxxxxxxxxxx1111",
    },
  },
  square: {
    label: "Square",
    signature: "x-square-hmacsha256-signature: base64(HMAC_SHA256(url + body))",
    note: "Requires the exact webhook URL in the signature calculation.",
    payload: {
      merchant_id: "MLPAYFIXDEMO",
      type: "payment.updated",
      event_id: "payfix-square-event",
      created_at: "2026-06-10T14:03:14.781Z",
      data: {
        type: "payment",
        id: "sq0idp-payfix-demo",
        object: {
          payment: {
            id: "sq0idp-payfix-demo",
            status: "COMPLETED",
            order_id: "ORD-10092",
            amount_money: { amount: 2500, currency: "USD" },
          },
        },
      },
    },
  },
  adyen: {
    label: "Adyen",
    signature: "Payload preset only; many Adyen integrations verify HMAC per notification item",
    note: "Use this to test parser/state handling. Signature verification may need project-specific logic.",
    payload: {
      live: "false",
      notificationItems: [
        {
          NotificationRequestItem: {
            eventCode: "AUTHORISATION",
            success: "true",
            pspReference: "8536102391820479",
            merchantReference: "ORD-10092",
            amount: { value: 2500, currency: "USD" },
            reason: "349821:1111:03/2030",
          },
        },
      ],
    },
  },
  paypal: {
    label: "PayPal",
    signature: "Payload preset only; official verification uses PayPal transmission/cert APIs",
    note: "Use this to test payload handling. Do not treat local HMAC as real PayPal verification.",
    payload: {
      id: "WH-PAYFIX-DEMO",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      create_time: "2026-06-10T14:03:14.781Z",
      resource: {
        id: "PAYPAL-CAPTURE-10092",
        status: "COMPLETED",
        invoice_id: "ORD-10092",
        amount: { currency_code: "USD", value: "25.00" },
      },
    },
  },
};

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function flattenValues(value: unknown, values = new Set<string>()) {
  if (value === null || value === undefined) return values;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value);
    if (text.length >= 3) values.add(text);
    return values;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenValues(item, values));
    return values;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => flattenValues(item, values));
  }
  return values;
}

function detectPayloadVendor(value: unknown): VendorKey | "unknown" {
  if (!value || typeof value !== "object") return "unknown";
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
  const dataObject = data.object && typeof data.object === "object" ? (data.object as Record<string, unknown>) : {};

  if (root.xRefNum || root.xCommand || root.xStatus) return "cardknox";
  if (String(root.type || "").startsWith("payment_intent.") || String(dataObject.id || "").startsWith("pi_")) return "stripe";
  if (String(root.eventType || "").startsWith("net.authorize.")) return "authorize.net";
  if (root.merchant_id && String(root.type || "").includes("payment")) return "square";
  if (Array.isArray(root.notificationItems)) return "adyen";
  if (String(root.event_type || "").startsWith("PAYMENT.")) return "paypal";
  return "unknown";
}

function extractJsonCandidates(text: string) {
  const candidates: string[] = [];
  const fenced = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fenced) {
    const body = match[1]?.trim();
    if (body && safeParseJson(body)) candidates.push(body);
  }

  const objectMatches = text.match(/\{[\s\S]{40,4000}\}/g) || [];
  for (const match of objectMatches.slice(0, 8)) {
    if (safeParseJson(match)) candidates.push(match);
  }

  return [...new Set(candidates)].slice(0, 6);
}

async function readJsonResponse(response: Response, fallback: string) {
  const text = await response.text();

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const htmlHint = text.trim().startsWith("<")
      ? "The local agent returned HTML instead of JSON. Restart payfix-agent so the new webhook endpoint is active."
      : text.slice(0, 240);

    return {
      ok: false,
      error: `${fallback}: ${htmlHint}`,
    };
  }
}

export default function WebhookLabModal({
  onClose,
  conversationText,
  hasConnectedProject,
}: WebhookLabModalProps) {
  const [url, setUrl] = useState("http://localhost:3000/api/webhook");
  const [method, setMethod] = useState("POST");
  const [vendor, setVendor] = useState<VendorKey>("stripe");
  const [secret, setSecret] = useState("");
  const [signatureHeader, setSignatureHeader] = useState("x-payfix-signature");
  const [payload, setPayload] = useState(pretty(vendorPresets.stripe.payload));
  const [comparisonText, setComparisonText] = useState("");
  const [loading, setLoading] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointCandidate[]>([]);
  const payloadJson = useMemo(() => safeParseJson(payload), [payload]);
  const payloadValid = Boolean(payloadJson);
  const detectedPayloadVendor = useMemo(() => detectPayloadVendor(payloadJson), [payloadJson]);
  const vendorMismatch =
    payloadValid && detectedPayloadVendor !== "unknown" && vendor !== "generic" && detectedPayloadVendor !== vendor;
  const jsonCandidates = useMemo(() => extractJsonCandidates(conversationText), [conversationText]);
  const comparison = useMemo(() => {
    if (!payloadJson || !comparisonText.trim()) return [];
    const text = comparisonText.toLowerCase();
    return [...flattenValues(payloadJson)]
      .filter((value) => /[a-z0-9]/i.test(value))
      .map((value) => ({ value, found: text.includes(value.toLowerCase()) }))
      .filter((item) => item.found || /(ord|txn|pi_|evt_|ref|capture|approved|declined|\d{5,})/i.test(item.value))
      .slice(0, 20);
  }, [comparisonText, payloadJson]);

  function applyVendor(nextVendor: VendorKey) {
    setVendor(nextVendor);
    setPayload(pretty(vendorPresets[nextVendor].payload));
    setSignatureHeader(nextVendor === "stripe" ? "stripe-signature" : nextVendor === "authorize.net" ? "x-anet-signature" : "x-payfix-signature");
  }

  async function discoverEndpoints() {
    setDiscoverLoading(true);

    try {
      const response = await fetch("/api/local-agent/webhook/discover");
      const data = await readJsonResponse(response, "Endpoint discovery failed");
      if (!data.ok) throw new Error(String(data.error || "Endpoint discovery failed."));
      setEndpoints(Array.isArray(data.endpoints) ? (data.endpoints as EndpointCandidate[]) : []);
    } catch (error: unknown) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : "Endpoint discovery failed.",
      });
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function replayWebhook() {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/local-agent/webhook/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          method,
          vendor,
          secret,
          signatureHeader,
          payload,
        }),
      });
      const data = await readJsonResponse(response, "Webhook replay failed");
      setResult(data as ReplayResult);
    } catch (error: unknown) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : "Webhook replay failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  function copyTimelineContext() {
    const text = `WEBHOOK REPLAY
VENDOR: ${vendorPresets[vendor].label}
URL: ${url}
METHOD: ${method}
SIGNATURE STYLE: ${vendorPresets[vendor].signature}
PAYLOAD:
${payload}

COMPARISON LOGS:
${comparisonText || "No comparison logs provided."}

RESULT:
${pretty(result || {})}`;
    void navigator.clipboard.writeText(text);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-600">
              <Webhook size={16} />
              Webhook Lab
            </div>
            <h3 className="mt-1 text-2xl font-bold text-slate-950">Gateway Webhook Simulator</h3>
            <p className="mt-1 text-sm text-slate-500">
              Vendor payloads, signature headers, endpoint discovery, replay, and log correlation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-6">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_460px]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
                {(Object.keys(vendorPresets) as VendorKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyVendor(key)}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                      vendor === key
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-blue-50"
                    }`}
                  >
                    {vendorPresets[key].label}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
                <div className="flex items-center gap-2 font-bold">
                  <ShieldCheck size={16} />
                  {vendorPresets[vendor].signature}
                </div>
                <p className="mt-1">{vendorPresets[vendor].note}</p>
              </div>

              {vendorMismatch && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950">
                  Selected {vendorPresets[vendor].label}, but the payload looks like {vendorPresets[detectedPayloadVendor].label}.
                  Replay can still test the endpoint, but this is a vendor/payload mismatch.
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px]">
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder="Webhook endpoint URL"
                />
                <select
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                >
                  <option>POST</option>
                  <option>PUT</option>
                  <option>PATCH</option>
                </select>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder="Optional signature secret"
                />
                <input
                  value={signatureHeader}
                  onChange={(event) => setSignatureHeader(event.target.value)}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder="Generic signature header"
                />
              </div>

              <textarea
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                className="mt-4 h-80 w-full resize-none rounded-xl border border-slate-300 bg-slate-950 p-4 font-mono text-sm leading-6 text-green-200 shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                spellCheck={false}
              />

              <textarea
                value={comparisonText}
                onChange={(event) => setComparisonText(event.target.value)}
                className="mt-4 h-32 w-full resize-none rounded-xl border border-slate-300 p-4 text-sm leading-6 shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                placeholder="Paste DB/order/backend logs here to compare against this webhook payload..."
              />

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={replayWebhook}
                  disabled={loading || !url.trim() || !payloadValid}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {loading ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                  Replay Webhook
                </button>
                <button
                  type="button"
                  onClick={copyTimelineContext}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <Copy size={16} />
                  Copy for Timeline
                </button>
                {!payloadValid && <span className="text-sm font-semibold text-rose-600">Payload JSON is invalid.</span>}
              </div>
            </section>

            <aside className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-slate-950">Endpoint Discovery</div>
                  <button
                    type="button"
                    onClick={discoverEndpoints}
                    disabled={discoverLoading || !hasConnectedProject}
                    className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {discoverLoading ? <RefreshCw size={14} className="animate-spin" /> : <FileSearch size={14} />}
                    Discover
                  </button>
                </div>
                {!hasConnectedProject && (
                  <p className="mt-3 text-sm leading-6 text-slate-500">Connect a project first to discover webhook endpoints.</p>
                )}
                <div className="mt-3 space-y-2">
                  {endpoints.map((endpoint) => (
                    <button
                      key={`${endpoint.file}-${endpoint.route}`}
                      type="button"
                      onClick={() => setUrl(`http://localhost:3000${endpoint.route}`)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50"
                    >
                      <div className="font-bold text-slate-950">{endpoint.route}</div>
                      <div className="mt-1 break-all text-xs text-slate-500">{endpoint.file}</div>
                      <div className="mt-2 text-xs font-semibold text-blue-700">
                        {endpoint.confidence}% confidence / {endpoint.evidence}
                      </div>
                    </button>
                  ))}
                  {hasConnectedProject && !endpoints.length && (
                    <p className="text-sm leading-6 text-slate-500">No discovered endpoints yet.</p>
                  )}
                </div>
              </section>

              {jsonCandidates.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="font-bold text-slate-950">Replay From Logs</div>
                  <p className="mt-1 text-sm text-slate-500">JSON payloads found in the current conversation.</p>
                  <div className="mt-3 space-y-2">
                    {jsonCandidates.map((candidate, index) => (
                      <button
                        key={`${candidate.slice(0, 40)}-${index}`}
                        type="button"
                        onClick={() => setPayload(pretty(safeParseJson(candidate)))}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50"
                      >
                        <div className="font-bold text-slate-950">Payload {index + 1}</div>
                        <pre className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">
                          {candidate}
                        </pre>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="font-bold text-slate-950">Payload vs Logs</div>
                {comparison.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {comparison.map((item) => (
                      <span
                        key={item.value}
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          item.found ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {item.found ? "found" : "missing"}: {item.value}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    Paste order/backend logs into the comparison box to check order IDs, transaction IDs, status, auth codes,
                    and amounts against the webhook payload.
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-slate-950">Replay Result</div>
                  {result && (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${
                        result.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {result.status || "error"}
                    </span>
                  )}
                </div>
                {result ? (
                  <>
                    {result.validationWarnings?.length ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900">
                        {result.validationWarnings.join(" ")}
                      </div>
                    ) : null}
                    <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs leading-5 text-green-200">
                      {pretty(result)}
                    </pre>
                  </>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    Replay a webhook to see status, response body, timing, and generated signature headers.
                  </p>
                )}
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
