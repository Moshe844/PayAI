import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileText,
  Monitor,
  Server,
  Smartphone,
  Webhook,
  X,
} from "lucide-react";
import Image from "next/image";

import type {
  PaymentTimelineAnomaly,
  PaymentTimelineEvent,
  PaymentTimelineResult,
  PaymentTimelineStage,
} from "../../lib/payfixTypes";

type TimelineModalProps = {
  timeline: PaymentTimelineResult;
  onClose: () => void;
};

const stageStyles: Record<PaymentTimelineStage, { label: string; className: string }> = {
  frontend: { label: "Frontend", className: "bg-sky-50 text-sky-700 border-sky-200" },
  backend: { label: "Backend", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  gateway: { label: "Gateway", className: "bg-violet-50 text-violet-700 border-violet-200" },
  webhook: { label: "Webhook", className: "bg-amber-50 text-amber-700 border-amber-200" },
  database: { label: "Database", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  ui: { label: "UI", className: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  device: { label: "Device", className: "bg-rose-50 text-rose-700 border-rose-200" },
  unknown: { label: "Unknown", className: "bg-slate-50 text-slate-700 border-slate-200" },
};

const severityStyles = {
  info: "border-blue-200 bg-blue-50 text-blue-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  critical: "border-rose-200 bg-rose-50 text-rose-800",
};

const actionStyles = {
  info: "border-blue-200 bg-blue-50 text-blue-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  critical: "border-rose-200 bg-rose-50 text-rose-900",
};

function stageIcon(stage: PaymentTimelineStage) {
  const props = { size: 18 };

  if (stage === "frontend") return <Monitor {...props} />;
  if (stage === "backend") return <Server {...props} />;
  if (stage === "gateway") return <CheckCircle2 {...props} />;
  if (stage === "webhook") return <Webhook {...props} />;
  if (stage === "database") return <Database {...props} />;
  if (stage === "device") return <Smartphone {...props} />;
  return <Clock {...props} />;
}

function stageBadge(stage: PaymentTimelineStage) {
  const style = stageStyles[stage] || stageStyles.unknown;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${style.className}`}>
      {stageIcon(stage)}
      {style.label}
    </span>
  );
}

function eventIdentity(event: PaymentTimelineEvent) {
  return [event.gateway, event.transactionId && `Txn ${event.transactionId}`, event.orderId && `Order ${event.orderId}`]
    .filter(Boolean)
    .join(" / ");
}

function anomalyLabel(anomaly: PaymentTimelineAnomaly) {
  return anomaly.type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatBytes(size: number) {
  if (!size) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function sourcePreview(content: string, isImage: boolean) {
  if (isImage) return "";
  return content.length > 4000 ? `${content.slice(0, 4000)}\n\n... truncated preview ...` : content;
}

function downloadSource(name: string, type: string, content: string, isImage: boolean) {
  const href = isImage
    ? content
    : URL.createObjectURL(new Blob([content], { type: type || "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  if (!isImage) URL.revokeObjectURL(href);
}

const paymentPipeline = [
  {
    label: "Device read",
    description: "Card reader, terminal, USB/HID/COM, or device output",
    match: (event: PaymentTimelineEvent) => event.stage === "device" || /\b(reader|device|terminal|usb|hid|com|tap|swipe|insert)\b/i.test(`${event.action} ${event.evidence}`),
  },
  {
    label: "EMV/TLV",
    description: "Tags, cryptogram, TVR/TSI, card/kernel outcome",
    match: (event: PaymentTimelineEvent) => /\b(emv|tlv|9f27|9f26|95|tvr|tsi|df8129|aac|arqc|cryptogram)\b/i.test(`${event.action} ${event.evidence}`),
  },
  {
    label: "SDK event",
    description: "SDK callback, parser, exception, card read event",
    match: (event: PaymentTimelineEvent) => /\b(sdk|callback|event|exception|parser|parse|idtech|cardreader|card read)\b/i.test(`${event.action} ${event.evidence}`),
  },
  {
    label: "App request",
    description: "Backend/app authorization request sent to gateway",
    match: (event: PaymentTimelineEvent) => event.stage === "backend" || /\b(request|authorize|auth request|http|api|post|executehttprequest)\b/i.test(`${event.action} ${event.evidence}`),
  },
  {
    label: "Gateway response",
    description: "Processor/gateway response, status, error code, auth code",
    match: (event: PaymentTimelineEvent) => event.stage === "gateway" || /\b(gateway|processor|xresult|xstatus|xerror|response|authcode|refnum)\b/i.test(`${event.action} ${event.evidence}`),
  },
  {
    label: "Final decision",
    description: "Approved, declined, failed, stored final state",
    match: (event: PaymentTimelineEvent) => /\b(approved|declined|failed|failure|success|final|settled|captured|void|rejected)\b/i.test(`${event.status} ${event.action} ${event.evidence}`),
  },
];

function pipelineStatus(timeline: PaymentTimelineResult) {
  return paymentPipeline.map((step) => {
    const related = timeline.events.filter(step.match);
    return {
      ...step,
      related,
      present: related.length > 0,
    };
  });
}

export default function TimelineModal({ timeline, onClose }: TimelineModalProps) {
  const sourceEvidence = timeline.sourceEvidence || [];
  const paymentStages = pipelineStatus(timeline);

  return (
    <div className="fixed inset-0 z-[260] flex items-start justify-center bg-black/55 p-6 backdrop-blur-sm">
      <div className="mt-4 flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-blue-600">Payment Trace</div>
            <h3 className="mt-1 text-2xl font-bold">Payment Trace Reconstruction</h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            <X size={16} />
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-6">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
            <aside className="space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="font-bold">Summary</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{timeline.summary}</p>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="font-bold">Correlation</div>
                <CorrelationRow label="Transactions" values={timeline.correlation.transactionIds} />
                <CorrelationRow label="Orders" values={timeline.correlation.orderIds} />
                <CorrelationRow label="Gateways" values={timeline.correlation.gateways} />
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold">Payment Pipeline</div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                    {paymentStages.filter((stage) => stage.present).length}/{paymentStages.length}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {paymentStages.map((stage) => (
                    <div
                      key={stage.label}
                      className={`rounded-xl border p-3 ${
                        stage.present
                          ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                          : "border-amber-200 bg-amber-50 text-amber-950"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-bold">{stage.label}</div>
                        <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] font-black">
                          {stage.present ? `${stage.related.length} event(s)` : "Missing"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold leading-5 opacity-80">{stage.description}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold">Anomalies</div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                    {timeline.anomalies.length}
                  </span>
                </div>

                <div className="mt-3 space-y-3">
                  {timeline.anomalies.length ? (
                    timeline.anomalies.map((anomaly) => (
                      <div
                        key={anomaly.id}
                        className={`rounded-xl border p-3 text-sm ${severityStyles[anomaly.severity]}`}
                      >
                        <div className="flex items-center gap-2 font-bold">
                          <AlertTriangle size={16} />
                          {anomaly.title}
                        </div>
                        <div className="mt-1 text-xs font-semibold uppercase opacity-75">
                          {anomalyLabel(anomaly)} / {anomaly.severity}
                        </div>
                        <p className="mt-2 leading-5">{anomaly.detail}</p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                      No obvious timeline anomalies detected.
                    </div>
                  )}
                </div>
              </section>

              {sourceEvidence.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-bold">Source Evidence</div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                      {sourceEvidence.length}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-slate-500">
                    Files used for this timeline run. These stay here after the composer clears.
                  </p>

                  <div className="mt-3 space-y-3">
                    {sourceEvidence.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 font-bold text-slate-900">
                              <FileText size={16} className="shrink-0 text-blue-600" />
                              <span className="truncate">{file.name}</span>
                            </div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">
                              {file.type || "text/plain"} / {formatBytes(file.size)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => downloadSource(file.name, file.type, file.content, file.isImage)}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-100"
                          >
                            <Download size={14} />
                            Download
                          </button>
                        </div>

                        {file.isImage ? (
                          <Image
                            src={file.content}
                            alt={file.name}
                            width={560}
                            height={240}
                            unoptimized
                            className="mt-3 max-h-48 w-full rounded-lg border border-slate-200 object-contain bg-white"
                          />
                        ) : (
                          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs leading-5 text-green-200">
                            {sourcePreview(file.content, file.isImage) || "No preview content was available."}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </aside>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {timeline.rootCauseAnalysis && (
                <div className="mb-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide text-indigo-600">Root Cause</div>
                      <h4 className="mt-1 text-lg font-bold text-indigo-950">{timeline.rootCauseAnalysis.title}</h4>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-700 shadow-sm">
                      {Math.round(timeline.rootCauseAnalysis.confidence * 100)}% confidence
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-indigo-950">{timeline.rootCauseAnalysis.detail}</p>
                  {timeline.rootCauseAnalysis.evidence.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-indigo-950">
                      {timeline.rootCauseAnalysis.evidence.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {Boolean(timeline.externalLookups?.length) && (
                <div className="mb-5 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                  <div className="font-bold text-cyan-950">External Lookup Findings</div>
                  <div className="mt-3 space-y-3">
                    {timeline.externalLookups?.map((lookup, index) => (
                      <div key={`${lookup.query}-${index}`} className="rounded-xl bg-white/80 p-3 text-sm leading-6 text-cyan-950">
                        <div className="font-bold">{lookup.query}</div>
                        <p className="mt-1">{lookup.result}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-cyan-700">
                          <span>{Math.round(lookup.confidence * 100)}% confidence</span>
                          {lookup.sourceUrl ? (
                            <a
                              href={lookup.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-cyan-800 hover:bg-cyan-100"
                            >
                              Source
                            </a>
                          ) : (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                              No source URL
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Boolean(timeline.aplSources?.length) && (
                <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                  <div className="font-bold text-blue-950">APL Sources Checked</div>
                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {timeline.aplSources?.map((source, index) => (
                      <div key={`${source.state}-${index}`} className="rounded-xl bg-white/80 p-3 text-sm leading-6 text-blue-950">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-bold">{source.state}</div>
                          {source.url ? (
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"
                            >
                              Open APL
                            </a>
                          ) : (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                              Search required
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-blue-900">{source.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Boolean(timeline.lineItemAnalysis?.length) && (
                <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="font-bold text-slate-950">Basket / UPC Analysis</div>
                  <p className="mt-1 text-sm text-slate-500">
                    Every UPC extracted from the payment request should appear here.
                  </p>
                  <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-bold">Line</th>
                          <th className="px-3 py-2 font-bold">UPC</th>
                          <th className="px-3 py-2 font-bold">Qty</th>
                          <th className="px-3 py-2 font-bold">Unit</th>
                          <th className="px-3 py-2 font-bold">Amount</th>
                          <th className="px-3 py-2 font-bold">APL / Category</th>
                          <th className="px-3 py-2 font-bold">Finding</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {timeline.lineItemAnalysis?.map((item, index) => (
                          <tr key={`${item.upc}-${index}`} className="align-top">
                            <td className="px-3 py-3 font-mono font-bold text-slate-500">{item.line}</td>
                            <td className="px-3 py-3 font-mono font-bold text-slate-950">{item.upc}</td>
                            <td className="px-3 py-3">{item.quantity || "n/a"}</td>
                            <td className="px-3 py-3">{item.unitPrice || "n/a"}</td>
                            <td className="px-3 py-3">{item.amount || "n/a"}</td>
                            <td className="px-3 py-3">
                              <div className={`rounded-lg border p-2 ${severityStyles[item.severity]}`}>
                                <div className="font-bold">{item.aplStatus || "unknown"}</div>
                                <div className="mt-1">{item.category || "No category verified"}</div>
                              </div>
                            </td>
                            <td className="max-w-sm px-3 py-3 leading-5">
                              <div>{item.finding}</div>
                              <div className="mt-2 rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-500">
                                {item.evidence}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {Boolean(timeline.investigationFindings?.length) && (
                <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="font-bold text-slate-950">Investigation Findings</div>
                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {timeline.investigationFindings?.map((finding, index) => (
                      <div
                        key={`${finding.title}-${index}`}
                        className={`rounded-xl border p-3 text-sm leading-6 ${severityStyles[finding.severity]}`}
                      >
                        <div className="font-bold">{finding.title}</div>
                        <p className="mt-1">{finding.detail}</p>
                        <div className="mt-2 rounded-lg bg-white/70 p-2 text-xs font-semibold">{finding.evidence}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Boolean(timeline.fixActions?.length) && (
                <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="font-bold text-emerald-950">Concrete Fix Actions</div>
                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {timeline.fixActions?.map((action, index) => (
                      <div
                        key={`${action.title}-${index}`}
                        className={`rounded-xl border p-3 text-sm leading-6 ${actionStyles[action.priority]}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold">{action.title}</div>
                          <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] font-bold">{action.owner}</span>
                        </div>
                        <p className="mt-2">{action.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold">Events</div>
                  <p className="mt-1 text-sm text-slate-500">
                    Reconstructed payment flow from frontend, backend, gateway, webhook, database, UI, and device evidence.
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
                  {timeline.events.length}
                </span>
              </div>

              <div className="mt-5 space-y-4">
                {timeline.events.length ? (
                  timeline.events.map((event) => (
                    <article
                      key={event.id}
                      className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold text-white">
                            {event.sequence}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              {stageBadge(event.stage)}
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                                {event.status || "unknown"}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-500">
                                {Math.round(event.confidence * 100)}% confidence
                              </span>
                            </div>

                            <h4 className="mt-3 text-lg font-bold text-slate-950">{event.action}</h4>
                            <div className="mt-1 text-sm text-slate-500">
                              {event.timestamp || "No timestamp"} / {event.source}
                            </div>
                            {eventIdentity(event) && (
                              <div className="mt-2 text-sm font-semibold text-slate-700">{eventIdentity(event)}</div>
                            )}
                          </div>
                        </div>
                      </div>

                      <pre className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-sm leading-6 text-green-300">
                        {event.evidence || "No evidence text provided."}
                      </pre>
                    </article>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
                    No events were extracted from the current context.
                  </div>
                )}
              </div>

              {timeline.recommendedNextSteps.length > 0 && (
                <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                  <div className="font-bold text-blue-900">Recommended Next Steps</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-blue-900">
                    {timeline.recommendedNextSteps.map((step, index) => (
                      <li key={`${step}-${index}`}>{step}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function CorrelationRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 flex flex-wrap gap-2">
        {values.length ? (
          values.map((value) => (
            <span key={value} className="max-w-full truncate rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {value}
            </span>
          ))
        ) : (
          <span className="text-sm text-slate-400">None detected</span>
        )}
      </div>
    </div>
  );
}
