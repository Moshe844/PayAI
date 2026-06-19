import OpenAI from "openai";

import { payfixResponseConfig } from "../lib/modelRouting";
import { lookupAplUpcs, type AplIndexResult } from "../../lib/aplIndex";
import { decodeEmvTlv, emvDecodeToTimeline, looksLikeEmvTlv } from "../../lib/emvTlv";
import type {
  PaymentTimelineAnomaly,
  PaymentTimelineEvent,
  PaymentTimelineResult,
  PaymentTimelineStage,
  UploadedFile,
} from "../../lib/payfixTypes";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = "nodejs";

type ProjectFilePayload = {
  file: string;
  extension?: string;
  mime?: string;
  size?: number;
  kind?: "text" | "audio" | "image" | "binary";
  content?: string;
  encoding?: string;
  base64?: string;
  note?: string;
};

type ExtractedTimeline = {
  summary?: string;
  rootCauseAnalysis?: PaymentTimelineResult["rootCauseAnalysis"];
  investigationFindings?: PaymentTimelineResult["investigationFindings"];
  fixActions?: PaymentTimelineResult["fixActions"];
  externalLookups?: PaymentTimelineResult["externalLookups"];
  aplSources?: PaymentTimelineResult["aplSources"];
  lineItemAnalysis?: PaymentTimelineResult["lineItemAnalysis"];
  events?: PaymentTimelineEvent[];
  recommendedNextSteps?: string[];
};

const stages: PaymentTimelineStage[] = [
  "frontend",
  "backend",
  "gateway",
  "webhook",
  "database",
  "ui",
  "device",
  "unknown",
];

const knownAplSources: Record<string, { url: string; note: string }> = {
  NY: {
    url: "https://nyswicvendors.com/wp-content/uploads/2026/06/Full-APL-JUN-04-2026.pdf",
    note: "New York State WIC vendor APL PDF supplied by user. Use exact UPC matching against this source when NY/eWIC evidence is present.",
  },
  NJ: {
    url: "https://www.nj.gov/health/fhs/wic/documents/eWIC/APL.pdf",
    note: "New Jersey Department of Health eWIC APL PDF. Use exact UPC/PLU matching against this source when NJ/eWIC evidence is present.",
  },
};

function normalizeStage(stage: string): PaymentTimelineStage {
  return stages.includes(stage as PaymentTimelineStage) ? (stage as PaymentTimelineStage) : "unknown";
}

function compactText(value: string, limit = 24000) {
  return String(value || "").slice(0, limit);
}

function needsExternalProductLookup(text: string) {
  return /\b(eWIC|WIC|EBT|UPC|GTIN|PLU|xRemainingBalanceEBTW|xCommand"?\s*:\s*"?ebt|xErrorCode"?\s*:\s*"?01266)\b/i.test(
    text,
  );
}

function detectStateHints(text: string) {
  const states = new Set<string>();
  const upper = text.toUpperCase();

  if (/\b(NY|NYS|NEW YORK)\b/.test(upper)) states.add("NY");
  if (/\b(NJ|NEW JERSEY)\b/.test(upper)) states.add("NJ");

  const stateMatches = upper.matchAll(/\bSTATE\s*[:=]\s*([A-Z]{2})\b/g);
  for (const match of stateMatches) {
    states.add(match[1]);
  }

  return [...states];
}

function aplSourceHints(text: string) {
  const states = detectStateHints(text);
  const sources = states.map((state) => {
    const known = knownAplSources[state];
    if (known) return { state, ...known };

    return {
      state,
      url: "",
      note: `No built-in APL URL configured. Use web search for the official ${state} WIC/eWIC APL UPC PDF or approved product list.`,
    };
  });

  if (!sources.length && /\b(eWIC|WIC|EBT|UPC|APL)\b/i.test(text)) {
    sources.push(
      ...Object.entries(knownAplSources).map(([state, source]) => ({
        state,
        ...source,
        note: `${source.note} State was not detected in the trace, so PayFix checked this configured APL as a candidate source.`,
      })),
    );
  }

  return sources;
}

function firstField(text: string, field: string) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`["']?${escaped}["']?\\s*[:=]\\s*["']?([^"',&\\s}]+)`, "i"));
  return match?.[1] || "";
}

function findLineValue(text: string, line: string, suffix: string) {
  return firstField(text, `x${line}${suffix}`);
}

function money(value: string) {
  const number = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) && number > 0 ? number.toFixed(2) : "";
}

function extractEwicEvidence(text: string): {
  summary: string;
  upcs: string[];
  lineItemAnalysis: NonNullable<PaymentTimelineResult["lineItemAnalysis"]>;
} {
  const byLine = new Map<string, { line: string; upc: string }>();
  const upcMatches = text.matchAll(/["']?x(\d+)Upc["']?\s*[:=]\s*["']?([0-9]{8,14})/gi);

  for (const match of upcMatches) {
    byLine.set(match[1], { line: match[1], upc: match[2] });
  }

  const looseUpcMatches = text.matchAll(/\b(?:UPC|GTIN|PLU)\b[^0-9]{0,24}([0-9]{8,14})/gi);
  let looseIndex = 900;
  for (const match of looseUpcMatches) {
    if (![...byLine.values()].some((item) => item.upc === match[1])) {
      byLine.set(String(looseIndex), { line: "", upc: match[1] });
      looseIndex += 1;
    }
  }

  const lineItemAnalysis = [...byLine.values()]
    .sort((a, b) => Number(a.line || 9999) - Number(b.line || 9999))
    .map((item) => {
      const quantity = item.line ? findLineValue(text, item.line, "Quantity") || findLineValue(text, item.line, "Qty") : "";
      const unitPrice = item.line ? findLineValue(text, item.line, "UnitPrice") || findLineValue(text, item.line, "Price") : "";
      const amount =
        item.line && quantity && unitPrice
          ? money(String(Number(quantity) * Number(String(unitPrice).replace(/[^0-9.-]/g, ""))))
          : money(unitPrice);

      return {
        line: item.line || "unknown",
        upc: item.upc,
        quantity,
        unitPrice,
        amount,
        category: "",
        aplStatus: "needs APL lookup",
        finding: "UPC was extracted from the payment request. Verify this exact UPC against the state eWIC APL and basket category mapping.",
        severity: "warning" as const,
        evidence: item.line ? `x${item.line}Upc=${item.upc}` : `UPC=${item.upc}`,
      };
    });

  const balances = /xRemainingBalanceEBTW/i.test(text);
  const summary = [
    firstField(text, "xCommand") ? `Command: ${firstField(text, "xCommand")}` : "",
    firstField(text, "xAmount") ? `Amount: ${firstField(text, "xAmount")}` : "",
    firstField(text, "xError") ? `Gateway error: ${firstField(text, "xError")}` : "",
    firstField(text, "xErrorCode") ? `Gateway error code: ${firstField(text, "xErrorCode")}` : "",
    lineItemAnalysis.length
      ? `Extracted UPCs:\n${lineItemAnalysis
          .map(
            (item) =>
              `- line ${item.line}: UPC ${item.upc}, qty=${item.quantity || "unknown"}, unitPrice=${
                item.unitPrice || "unknown"
              }, amount=${item.amount || "unknown"}`,
          )
          .join("\n")}`
      : "No xNUpc fields were extracted.",
    balances ? `Remaining balance blob detected. The model must compare item categories against this evidence.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary,
    upcs: lineItemAnalysis.map((item) => item.upc),
    lineItemAnalysis,
  };
}

function summarizeProjectFiles(projectFiles: ProjectFilePayload[]) {
  return projectFiles
    .slice(0, 15)
    .map((file) => {
      if (file.kind === "text") {
        return `PROJECT FILE: ${file.file}
TYPE: text
MIME: ${file.mime || "text/plain"}
CONTENT:
${compactText(file.content || "", 20000)}`;
      }

      return `PROJECT FILE: ${file.file}
TYPE: ${file.kind || "binary"}
MIME: ${file.mime || "unknown"}
SIZE: ${file.size || 0} bytes
NOTE: ${file.note || "Binary content was available as metadata for timeline correlation."}`;
    })
    .join("\n\n");
}

function summarizeUploads(uploadedFiles: UploadedFile[]) {
  return uploadedFiles
    .filter((file) => !file.isImage)
    .map(
      (file) => `UPLOADED FILE: ${file.name}
TYPE: ${file.type}
CONTENT:
${compactText(file.content, 20000)}`,
    )
    .join("\n\n");
}

function summarizeHarUploads(uploadedFiles: UploadedFile[]) {
  const summaries: string[] = [];

  for (const file of uploadedFiles.filter((upload) => /\.har$/i.test(upload.name) || /har|json/i.test(upload.type))) {
    try {
      const parsed = JSON.parse(file.content);
      const entries = Array.isArray(parsed?.log?.entries) ? parsed.log.entries : [];
      if (!entries.length) continue;

      const lines = entries.slice(0, 80).map((entry: Record<string, unknown>, index: number) => {
        const request = (entry.request || {}) as Record<string, unknown>;
        const response = (entry.response || {}) as Record<string, unknown>;
        const url = String(request.url || "");
        const method = String(request.method || "");
        const status = String(response.status || "");
        const statusText = String(response.statusText || "");
        const startedDateTime = String(entry.startedDateTime || "");
        const time = String(entry.time || "");
        const mimeType = String((response.content as Record<string, unknown> | undefined)?.mimeType || "");
        const blocked =
          /3ds|three|acs|challenge|iframe|cardinal|checkout|payment/i.test(url) ||
          Number(status) >= 400 ||
          status === "0";

        return `${index + 1}. ${startedDateTime || "no timestamp"} ${method} ${url}
   status=${status || "unknown"} ${statusText} durationMs=${time || "unknown"} mime=${mimeType || "unknown"}${
     blocked ? "\n   TRACE ATTENTION: payment/3DS-looking request or failed/blocked response" : ""
   }`;
      });

      summaries.push(`HAR NETWORK SUMMARY: ${file.name}
Total requests: ${entries.length}
Payment/3DS/error requests are marked with TRACE ATTENTION.
${lines.join("\n")}`);
    } catch {
      // Not a valid HAR/JSON upload; regular text summarization still includes it.
    }
  }

  return summaries.join("\n\n");
}

function dedupe(values: Array<string | undefined>) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function parseTime(value?: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function eventKey(event: PaymentTimelineEvent) {
  return [
    event.stage,
    event.action.toLowerCase(),
    event.status.toLowerCase(),
    event.transactionId || "",
    event.orderId || "",
  ].join("|");
}

function hasFailureStatus(event: PaymentTimelineEvent) {
  return /fail|error|declin|timeout|invalid|void|cancel|reject/i.test(event.status);
}

function hasSuccessStatus(event: PaymentTimelineEvent) {
  return /success|approved|paid|captured|authorized|complete|settled/i.test(event.status);
}

function detectAnomalies(events: PaymentTimelineEvent[]) {
  const anomalies: PaymentTimelineAnomaly[] = [];
  const byStage = new Set(events.map((event) => event.stage));
  const add = (anomaly: Omit<PaymentTimelineAnomaly, "id">) => {
    anomalies.push({ id: `a-${anomalies.length + 1}`, ...anomaly });
  };

  if (events.length === 0) {
    add({
      type: "missing_stage",
      severity: "critical",
      title: "No payment trace events found",
      detail: "The provided context did not contain enough request, response, webhook, or state evidence to build a trace.",
      relatedEventIds: [],
    });
    return anomalies;
  }

  if (byStage.has("gateway") && !byStage.has("backend")) {
    add({
      type: "missing_stage",
      severity: "warning",
      title: "Gateway event without backend request",
      detail: "The trace includes a gateway response, but no backend request event was identified.",
      relatedEventIds: events.filter((event) => event.stage === "gateway").map((event) => event.id),
    });
  }

  if ((byStage.has("gateway") || byStage.has("backend")) && !byStage.has("webhook")) {
    add({
      type: "missing_stage",
      severity: "warning",
      title: "No webhook event found",
      detail: "No webhook delivery or handler event was identified. That can hide final payment status, retries, or asynchronous failure.",
      relatedEventIds: [],
    });
  }

  const seen = new Map<string, PaymentTimelineEvent>();
  for (const event of events) {
    const key = eventKey(event);
    const previous = seen.get(key);
    if (previous) {
      add({
        type: "duplicate_event",
        severity: "critical",
        title: "Possible duplicate payment event",
        detail: "Two events have the same stage, action, status, transaction/order identity. Check retry/idempotency handling.",
        relatedEventIds: [previous.id, event.id],
      });
    } else {
      seen.set(key, event);
    }
  }

  const successful = events.filter(hasSuccessStatus);
  const failed = events.filter(hasFailureStatus);
  if (successful.length && failed.length) {
    add({
      type: "status_mismatch",
      severity: "critical",
      title: "Conflicting payment statuses",
      detail: "The same trace contains success-like and failure-like outcomes. Verify transaction IDs, order IDs, webhook ordering, and final DB state.",
      relatedEventIds: [...successful, ...failed].map((event) => event.id),
    });
  }

  return anomalies;
}

function normalizeEvents(events: PaymentTimelineEvent[]) {
  return events
    .map((event, index) => ({
      id: event.id || `e-${index + 1}`,
      stage: normalizeStage(String(event.stage || "unknown")),
      timestamp: event.timestamp || "",
      sequence: Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : index + 1,
      source: String(event.source || "provided context").slice(0, 220),
      action: String(event.action || "Observed payment event").slice(0, 220),
      status: String(event.status || "unknown").slice(0, 120),
      gateway: event.gateway ? String(event.gateway).slice(0, 80) : "",
      transactionId: event.transactionId ? String(event.transactionId).slice(0, 120) : "",
      orderId: event.orderId ? String(event.orderId).slice(0, 120) : "",
      amount: event.amount ? String(event.amount).slice(0, 80) : "",
      evidence: String(event.evidence || "").slice(0, 800),
      confidence: Math.max(0, Math.min(1, Number(event.confidence || 0.5))),
    }))
    .sort((a, b) => {
      const aTime = parseTime(a.timestamp);
      const bTime = parseTime(b.timestamp);
      if (aTime !== null && bTime !== null) return aTime - bTime;
      return a.sequence - b.sequence;
    })
    .map((event, index) => ({ ...event, sequence: index + 1 }));
}

function mergeLineItemAnalysis(
  modelItems: PaymentTimelineResult["lineItemAnalysis"] = [],
  extractedItems: NonNullable<PaymentTimelineResult["lineItemAnalysis"]>,
  aplIndex?: AplIndexResult | null,
) {
  const merged = [...modelItems];
  const seen = new Set(merged.map((item) => item.upc));

  for (const item of extractedItems) {
    if (!seen.has(item.upc)) {
      merged.push({
        ...item,
        severity: "critical",
        finding:
          "This UPC was present in the request but was not resolved by the model lookup. Treat it as an unresolved APL/eligibility check before accepting category-balance explanations.",
      });
    }
  }

  if (!aplIndex?.lookups.length) return merged;

  const lookupByUpc = new Map(aplIndex.lookups.map((lookup) => [lookup.upc, lookup]));

  return merged.map((item) => {
    const lookup = lookupByUpc.get(item.upc);
    if (!lookup) return item;

    const matchedRow = lookup.matchedRows[0] || lookup.replacementCandidates[0];
    const severity =
      lookup.status === "found on APL"
        ? ("info" as const)
        : lookup.status === "unknown/not verified"
          ? item.severity
          : ("critical" as const);

    return {
      ...item,
      category: matchedRow?.category || item.category,
      aplStatus: lookup.status,
      severity,
      finding:
        lookup.status === "found on APL"
          ? `Exact UPC appears on the indexed APL as: ${matchedRow?.description || matchedRow?.raw || item.upc}.`
          : lookup.status === "replacement/new UPC found"
            ? `Exact UPC was not found on the indexed APL, but a nearby/newer UPC candidate exists: ${
                matchedRow?.description || matchedRow?.raw || "candidate found"
              }.`
            : lookup.status === "not found on APL"
              ? "Exact UPC was not found in the indexed APL. This is a concrete eWIC eligibility/root-cause candidate."
              : item.finding,
      evidence: `${item.evidence}\nAPL: ${lookup.evidence}${lookup.sourceUrl ? `\nSource: ${lookup.sourceUrl}` : ""}`,
    };
  });
}

function aplExternalLookups(aplIndex?: AplIndexResult | null): NonNullable<PaymentTimelineResult["externalLookups"]> {
  if (!aplIndex) return [];

  return aplIndex.lookups.map((lookup) => ({
    query: `APL lookup for UPC ${lookup.upc}`,
    result: lookup.evidence,
    sourceUrl: lookup.sourceUrl,
    confidence: lookup.status === "unknown/not verified" ? 0.25 : 1,
  }));
}

function aplSourcesFromIndex(aplIndex: AplIndexResult | null, fallback: PaymentTimelineResult["aplSources"]) {
  if (!aplIndex?.sources.length) return fallback;

  return aplIndex.sources.map((source) => ({
    state: source.state,
    url: source.url,
    note: `${source.status.toUpperCase()}: ${source.note}`,
  }));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const question = String(body.question || "");
    const log = String(body.log || "");
    const code = String(body.code || "");
    const computerSearchResults = String(body.computerSearchResults || "");
    const uploadedFiles: UploadedFile[] = body.uploadedFiles || [];
    const projectFiles: ProjectFilePayload[] = body.projectFiles || [];

    const textContext = `
USER QUESTION:
${question || "Build a payment trace timeline from the attached context."}

PAYMENT LOGS:
${compactText(log)}

CODE / PROJECT / SEARCH CONTEXT:
${compactText(code)}

COMPUTER SEARCH RESULTS:
${compactText(computerSearchResults)}

UPLOADED TEXT FILES:
${summarizeUploads(uploadedFiles)}

HAR / NETWORK EVIDENCE:
${summarizeHarUploads(uploadedFiles) || "No HAR network export attached."}

PROJECT FILES:
${summarizeProjectFiles(projectFiles)}
`;
    const ewicEvidence = extractEwicEvidence(textContext);
    const aplSources = aplSourceHints(textContext);
    const aplIndex =
      ewicEvidence.upcs.length && aplSources.length ? await lookupAplUpcs(ewicEvidence.upcs, aplSources) : null;
    const enhancedTextContext = `${textContext}

DETERMINISTIC EWIC / UPC EXTRACTION:
${ewicEvidence.summary || "No deterministic eWIC/UPC evidence extracted."}

DETERMINISTIC APL INDEX LOOKUP:
${aplIndex?.summary || "No deterministic APL lookup was run. Need UPCs and at least one APL source."}

OFFICIAL APL SOURCE HINTS:
${
  aplSources.length
    ? aplSources.map((source) => `- ${source.state}: ${source.url || "[search required]"} - ${source.note}`).join("\n")
    : "No APL source hints detected."
}
`;

    if (looksLikeEmvTlv(textContext)) {
      return Response.json({
        ok: true,
        timeline: emvDecodeToTimeline(decodeEmvTlv(textContext)),
        emvOnly: true,
      });
    }

    const imageParts = uploadedFiles
      .filter((file) => file.isImage)
      .slice(0, 8)
      .map((file) => ({
        type: "input_image" as const,
        image_url: file.content,
        detail: "high" as const,
      }));
    const useProductLookup =
      needsExternalProductLookup(enhancedTextContext) || ewicEvidence.upcs.length > 0 || aplSources.length > 0;

    const response = await openai.responses.create({
      ...payfixResponseConfig("timeline", {
        text: {
          format: {
            type: "json_schema",
            name: "payment_trace_timeline",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                rootCauseAnalysis: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    detail: { type: "string" },
                    confidence: { type: "number" },
                    evidence: { type: "array", items: { type: "string" } },
                  },
                  required: ["title", "detail", "confidence", "evidence"],
                },
                investigationFindings: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      title: { type: "string" },
                      detail: { type: "string" },
                      severity: { type: "string", enum: ["info", "warning", "critical"] },
                      evidence: { type: "string" },
                    },
                    required: ["title", "detail", "severity", "evidence"],
                  },
                },
                fixActions: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      title: { type: "string" },
                      detail: { type: "string" },
                      owner: { type: "string" },
                      priority: { type: "string", enum: ["info", "warning", "critical"] },
                    },
                    required: ["title", "detail", "owner", "priority"],
                  },
                },
                externalLookups: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      query: { type: "string" },
                      result: { type: "string" },
                      sourceUrl: { type: "string" },
                      confidence: { type: "number" },
                    },
                    required: ["query", "result", "sourceUrl", "confidence"],
                  },
                },
                aplSources: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      state: { type: "string" },
                      url: { type: "string" },
                      note: { type: "string" },
                    },
                    required: ["state", "url", "note"],
                  },
                },
                lineItemAnalysis: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      line: { type: "string" },
                      upc: { type: "string" },
                      quantity: { type: "string" },
                      unitPrice: { type: "string" },
                      amount: { type: "string" },
                      category: { type: "string" },
                      aplStatus: { type: "string" },
                      finding: { type: "string" },
                      severity: { type: "string", enum: ["info", "warning", "critical"] },
                      evidence: { type: "string" },
                    },
                    required: [
                      "line",
                      "upc",
                      "quantity",
                      "unitPrice",
                      "amount",
                      "category",
                      "aplStatus",
                      "finding",
                      "severity",
                      "evidence",
                    ],
                  },
                },
                events: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      id: { type: "string" },
                      stage: { type: "string", enum: stages },
                      timestamp: { type: "string" },
                      sequence: { type: "number" },
                      source: { type: "string" },
                      action: { type: "string" },
                      status: { type: "string" },
                      gateway: { type: "string" },
                      transactionId: { type: "string" },
                      orderId: { type: "string" },
                      amount: { type: "string" },
                      evidence: { type: "string" },
                      confidence: { type: "number" },
                    },
                    required: [
                      "id",
                      "stage",
                      "timestamp",
                      "sequence",
                      "source",
                      "action",
                      "status",
                      "gateway",
                      "transactionId",
                      "orderId",
                      "amount",
                      "evidence",
                      "confidence",
                    ],
                  },
                },
                recommendedNextSteps: { type: "array", items: { type: "string" } },
              },
              required: [
                "summary",
                "rootCauseAnalysis",
                "investigationFindings",
                "fixActions",
                "externalLookups",
                "aplSources",
                "lineItemAnalysis",
                "events",
                "recommendedNextSteps",
              ],
            },
            strict: true,
          },
        },
      }),
      max_output_tokens: 5000,
      tools: useProductLookup ? [{ type: "web_search_preview" }] : [],
      input: [
        {
          role: "system",
          content: `You are PayFix Timeline Builder. Extract concrete payment-flow events from logs, code, payloads, files, and screenshots.

Rules:
- Build frontend/backend/gateway/webhook/database/ui/device events only when evidence exists.
- Do not invent order IDs, transaction IDs, gateway names, webhook events, database events, or UI events.
- If the input is only EMV/TLV/card data, say it is device evidence and host response data is needed.
- Evidence must quote or summarize the exact log/code/payload clue supporting the event.
- Do not stop at the gateway's surface error. Produce root-cause analysis and concrete fix actions.
- For eWIC/WIC/EBT traces, inspect UPC/PLU/GTIN, line item amount, benefit category, category remaining balances, xRemainingBalanceEBTW, xErrorCode, xError, xStatus, and xResult.
- You MUST account for every UPC listed in DETERMINISTIC EWIC / UPC EXTRACTION. Do not omit an extracted UPC.
- Treat DETERMINISTIC APL INDEX LOOKUP as stronger evidence than product/category guesses. If it says the exact UPC is not found, do not call that UPC eligible unless another explicit APL row proves it.
- Use OFFICIAL APL SOURCE HINTS as the starting point for eWIC APL checks. If a URL is listed for the detected state, use that source first.
- For states not listed in OFFICIAL APL SOURCE HINTS, search the web for official state WIC/eWIC APL, approved product list, UPC list, or APL PDF. Prefer .gov, state WIC portals, or official state-approved vendor portals.
- Preserve UPC leading zeros. Try exact 8/11/12/13/14 digit UPC/GTIN variants only when the evidence supports the variant. Do not treat a similar product as eligible unless the exact UPC or a clearly documented replacement UPC is found.
- For every extracted UPC, produce a lineItemAnalysis entry. Set aplStatus to one of: "found on APL", "not found on APL", "replacement/new UPC found", or "unknown/not verified".
- If lookup/APL evidence is missing, set aplStatus to "unknown/not verified" and make the fix action request the state APL/APL update file.
- If a UPC appears to be absent from the state APL or replaced by a newer UPC, make that the root cause only when evidence supports it. Name both the declined UPC and replacement UPC if present.
- For eWIC limit/category declines, identify the most likely mismatch: category balance exceeded, UPC not benefit-eligible, wrong mapping/category, quantity/price mismatch, split tender issue, unsupported item, or missing line-level evidence.
- If UPC/GTIN/PLU/product identifiers are present and web search is available, look up every extracted UPC and summarize cautiously in externalLookups. externalLookups.sourceUrl must contain the URL used for the lookup, or "" if no source was found.
- aplSources must list every APL/source URL used or searched. If the state is unknown, include an "unknown" entry explaining which state/jurisdiction evidence is missing.
- If an APL lookup shows a declined UPC is not on the APL but a newer/replacement UPC is listed, the root cause should be the missing/retired UPC rather than generic category balance.
- Fix actions must be practical: what merchant/developer/gateway/support should check or change next, including exact fields to compare when possible.
- If there is not enough evidence to calculate eligibility or amount matching, say exactly what data is missing, such as basket line items, UPC list, APL/category, approved foods list, benefit balances, or gateway request payload.`,
        },
        { role: "user", content: [{ type: "input_text", text: enhancedTextContext }, ...imageParts] },
      ],
    });

    const extracted = JSON.parse(response.output_text || "{}") as ExtractedTimeline;
    const events = normalizeEvents(extracted.events || []);
    const result: PaymentTimelineResult = {
      summary: extracted.summary || "Payment timeline built from the provided context.",
      correlation: {
        transactionIds: dedupe(events.map((event) => event.transactionId)),
        orderIds: dedupe(events.map((event) => event.orderId)),
        gateways: dedupe(events.map((event) => event.gateway)),
      },
      rootCauseAnalysis: extracted.rootCauseAnalysis || {
        title: "Root cause not determined",
        detail: "The provided context did not contain enough evidence for a specific root cause.",
        confidence: 0.2,
        evidence: [],
      },
      investigationFindings: extracted.investigationFindings || [],
      fixActions: extracted.fixActions || [],
      externalLookups: [...aplExternalLookups(aplIndex), ...(extracted.externalLookups || [])],
      aplSources: aplSourcesFromIndex(aplIndex, extracted.aplSources?.length ? extracted.aplSources : aplSources),
      lineItemAnalysis: mergeLineItemAnalysis(extracted.lineItemAnalysis || [], ewicEvidence.lineItemAnalysis, aplIndex),
      events,
      anomalies: detectAnomalies(events),
      recommendedNextSteps: extracted.recommendedNextSteps || [],
    };

    return Response.json({ ok: true, timeline: result });
  } catch (error: unknown) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to build payment trace." },
      { status: 500 },
    );
  }
}
