import { AlertTriangle, Bug, Camera, Code2, Globe2, Loader2, Network, RefreshCw, Search, X } from "lucide-react";
import Image from "next/image";
import type { LiveAppInspectionResult } from "../../lib/payfixTypes";

type LiveInspectorModalProps = {
  result: LiveAppInspectionResult | null;
  loading: boolean;
  targetUrl: string;
  setTargetUrl: (value: string) => void;
  onEditVisualTarget?: (target: NonNullable<LiveAppInspectionResult["dom"]>["visualTargets"][number]) => void;
  onInspect: () => void;
  onClose: () => void;
};

function severityClass(severity: string) {
  if (severity === "critical") return "border-red-200 bg-red-50 text-red-950";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-blue-200 bg-blue-50 text-blue-950";
}

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

function statusClass(status?: number) {
  if (!status) return "bg-slate-100 text-slate-600";
  if (status >= 500) return "bg-red-100 text-red-700";
  if (status >= 400) return "bg-amber-100 text-amber-700";
  if (status >= 300) return "bg-blue-100 text-blue-700";
  return "bg-emerald-100 text-emerald-700";
}

function trimBody(value?: string) {
  if (!value) return "";
  return value.length > 1200 ? `${value.slice(0, 1200)}\n... trimmed ...` : value;
}

export default function LiveInspectorModal({
  result,
  loading,
  targetUrl,
  setTargetUrl,
  onEditVisualTarget,
  onInspect,
  onClose,
}: LiveInspectorModalProps) {
  const failedNetwork = result?.network.filter((entry) => entry.failure || (entry.status && entry.status >= 400)) || [];
  const visibleNetwork = failedNetwork.length ? failedNetwork : result?.network.slice(-25) || [];
  const consoleProblems =
    result?.consoleMessages.filter((entry) => ["error", "warning"].includes(entry.type)).slice(-40) || [];

  return (
    <div className="fixed inset-0 z-[360] flex items-center justify-center bg-slate-950/70 p-5">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-600">
              <Search size={16} />
              Live App Inspector
            </div>
            <h3 className="mt-1 text-2xl font-bold text-slate-950">Inspect Running App</h3>
            <p className="mt-1 text-sm text-slate-500">
              Screenshot, DOM, console, network, page errors, and obvious layout issues from a live localhost app.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Target URL</span>
                <input
                  value={targetUrl}
                  onChange={(event) => setTargetUrl(event.target.value)}
                  placeholder="http://localhost:3000"
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </label>
              <button
                type="button"
                onClick={onInspect}
                disabled={loading}
                className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {loading ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
                {loading ? "Inspecting..." : "Inspect Running App"}
              </button>
            </div>

            {result?.detectedApps.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {result.detectedApps.map((app) => (
                  <button
                    key={app.url}
                    type="button"
                    onClick={() => setTargetUrl(app.url)}
                    className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-100"
                  >
                    <Globe2 size={13} />
                    {app.url}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          {result?.error && (
            <section className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm leading-6 text-red-950 shadow-sm">
              <div className="flex items-center gap-2 font-bold">
                <AlertTriangle size={18} />
                Inspector could not run
              </div>
              <p className="mt-2 break-words">{result.error}</p>
              {result.setup?.length ? (
                <ul className="mt-3 list-disc space-y-1 pl-5">
                  {result.setup.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}

          {result && !result.error && (
            <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
              <aside className="space-y-5">
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Run</div>
                  <div className="mt-2 break-all font-semibold text-slate-950">{result.targetUrl}</div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                      {result.durationMs || 0} ms
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                      {result.network.length} requests
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                      {result.consoleMessages.length} console
                    </span>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Detected Project</div>
                  {result.detectedProject ? (
                    <>
                      <div className="mt-2 font-bold text-slate-950">{result.detectedProject.packageName}</div>
                      <div className="mt-1 break-all font-mono text-xs leading-5 text-slate-500">
                        {result.detectedProject.root}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                          {result.detectedProject.framework}
                        </span>
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                          {result.detectedProject.confidence}% confidence
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{result.detectedProject.reason}</p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      No project root was linked automatically. Connect the project path manually if you want file-level root cause hints.
                    </p>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-950">Findings</h4>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                      {result.findings.length}
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {result.findings.map((finding) => (
                      <article key={finding.id} className={`rounded-2xl border p-4 ${severityClass(finding.severity)}`}>
                        <div className="text-xs font-bold uppercase">{finding.severity}</div>
                        <div className="mt-1 font-bold">{finding.title}</div>
                        <p className="mt-2 text-sm leading-6">{finding.detail}</p>
                        {finding.sourceHint && (
                          <div className="mt-2 rounded-full bg-white/70 px-3 py-1 text-xs font-bold">
                            Hint: {finding.sourceHint}
                          </div>
                        )}
                        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-xs leading-5 text-green-200">
                          {finding.evidence}
                        </pre>
                      </article>
                    ))}
                  </div>
                </section>

                {result.rootCause && (
                  <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-indigo-950 shadow-sm">
                    <div className="text-xs font-bold uppercase tracking-wide">Root Cause Engine</div>
                    <h4 className="mt-1 font-bold">{result.rootCause.title}</h4>
                    <div className="mt-2 inline-flex rounded-full bg-white/80 px-3 py-1 text-xs font-bold">
                      {result.rootCause.confidence}% confidence
                    </div>
                    <p className="mt-3 text-sm leading-6">{result.rootCause.why}</p>
                    {result.rootCause.likelyFiles.length ? (
                      <div className="mt-4 space-y-2">
                        {result.rootCause.likelyFiles.map((file) => (
                          <div key={file.file} className="rounded-xl bg-white/80 p-3 text-xs leading-5">
                            <div className="break-all font-mono font-bold">{file.file}</div>
                            <div className="mt-1">{file.reason}</div>
                            {file.importedBy?.length ? (
                              <div className="mt-1 text-indigo-700">Imported by: {file.importedBy.join(", ")}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4 rounded-xl bg-white/80 p-3 text-sm leading-6">
                      <span className="font-bold">Suggested fix: </span>
                      {result.rootCause.suggestedFix}
                    </div>
                  </section>
                )}
              </aside>

              <main className="space-y-5">
                {result.screenshotBase64 && (
                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-4 font-bold text-slate-950">
                      <Camera size={18} className="text-blue-600" />
                      Screenshot
                    </div>
                    <div className="bg-slate-950 p-4">
                      <div className="relative min-h-[420px] overflow-hidden rounded-xl bg-slate-900">
                        <Image
                          src={`data:image/png;base64,${result.screenshotBase64}`}
                          alt="Live app screenshot"
                          width={1365}
                          height={900}
                          unoptimized
                          className="h-auto w-full"
                        />
                      </div>
                    </div>
                  </section>
                )}

                <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 font-bold text-slate-950">
                      <Bug size={18} className="text-blue-600" />
                      Console
                    </div>
                    <div className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4">
                      {consoleProblems.length ? (
                        <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-green-200">
                          {consoleProblems.map((entry) => `[${entry.type}] ${entry.text}`).join("\n\n")}
                        </pre>
                      ) : (
                        <p className="text-sm text-slate-300">No console warnings or errors captured.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 font-bold text-slate-950">
                        <Network size={18} className="text-blue-600" />
                        Network Requests
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                        {failedNetwork.length ? `${failedNetwork.length} problem(s)` : `${visibleNetwork.length} shown`}
                      </span>
                    </div>
                    <div className="mt-4 max-h-80 space-y-3 overflow-auto pr-1">
                      {visibleNetwork.length ? (
                        visibleNetwork.map((entry, index) => (
                          <article key={`${entry.method}-${entry.url}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-bold text-white">
                                    {entry.method}
                                  </span>
                                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClass(entry.status)}`}>
                                    {entry.status || "pending"} {entry.statusText || ""}
                                  </span>
                                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500">
                                    {entry.resourceType}
                                  </span>
                                </div>
                                <div className="mt-2 break-all font-mono text-xs font-semibold text-slate-900">
                                  {shortUrl(entry.url)}
                                </div>
                              </div>
                            </div>

                            {entry.failure && (
                              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700">
                                {entry.failure}
                              </div>
                            )}

                            {(entry.requestBody || entry.responseBody) && (
                              <details className="mt-3">
                                <summary className="cursor-pointer text-xs font-bold text-blue-700">
                                  View request / response body
                                </summary>
                                <div className="mt-2 grid grid-cols-1 gap-2">
                                  {entry.requestBody && (
                                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-[11px] leading-4 text-green-200">
                                      {trimBody(entry.requestBody)}
                                    </pre>
                                  )}
                                  {entry.responseBody && (
                                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-[11px] leading-4 text-green-200">
                                      {trimBody(entry.responseBody)}
                                    </pre>
                                  )}
                                </div>
                              </details>
                            )}
                          </article>
                        ))
                      ) : (
                        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No network requests captured.</p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2 font-bold text-slate-950">
                    <Code2 size={18} className="text-blue-600" />
                    Visual CSS Targets
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Inspector identifies live elements and computed styles here. Send a target to Visual Fix Agent to find the source and prepare a patch.
                  </p>
                  {result.dom?.visualTargets?.length ? (
                    <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {result.dom.visualTargets.slice(0, 12).map((target, index) => (
                        <div key={`${target.selector}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 truncate font-mono text-xs font-bold text-slate-950">
                              {target.selector}
                            </div>
                            <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-500">
                              {target.rect.width}x{target.rect.height}
                            </span>
                          </div>
                          <div className="mt-2 line-clamp-2 text-xs text-slate-600">{target.text || target.tag}</div>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                            <span className="rounded-full bg-white px-2 py-1">color {target.styles.color}</span>
                            <span className="rounded-full bg-white px-2 py-1">bg {target.styles.backgroundColor}</span>
                          </div>
                          {onEditVisualTarget && (
                            <button
                              type="button"
                              onClick={() => onEditVisualTarget(target)}
                              className="mt-3 inline-flex h-8 items-center rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition hover:bg-blue-500"
                            >
                              Edit Color
                            </button>
                          )}
                          {target.className && (
                            <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-2 text-[11px] leading-4 text-green-200">
                              {target.className}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">No visual targets captured yet.</p>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="font-bold text-slate-950">DOM Snapshot</h4>
                    <button
                      type="button"
                      onClick={onInspect}
                      disabled={loading}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                      Refresh
                    </button>
                  </div>
                  {result.dom ? (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="rounded-xl bg-slate-50 p-4">
                        <div className="text-xs font-bold uppercase text-slate-400">Forms</div>
                        <div className="mt-1 text-2xl font-bold">{result.dom.forms.length}</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-4">
                        <div className="text-xs font-bold uppercase text-slate-400">Buttons</div>
                        <div className="mt-1 text-2xl font-bold">{result.dom.buttons.length}</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-4">
                        <div className="text-xs font-bold uppercase text-slate-400">Overflow Elements</div>
                        <div className="mt-1 text-2xl font-bold">{result.dom.overflowElements.length}</div>
                      </div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs leading-5 text-green-200 md:col-span-3">
                        {JSON.stringify(
                          {
                            title: result.dom.title,
                            url: result.dom.url,
                            horizontalOverflow: result.dom.horizontalOverflow,
                            documentWidth: result.dom.documentWidth,
                            viewportWidth: result.dom.viewportWidth,
                            forms: result.dom.forms,
                            buttons: result.dom.buttons.slice(0, 20),
                            overflowElements: result.dom.overflowElements.slice(0, 10),
                            visualTargets: result.dom.visualTargets.slice(0, 10),
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">No DOM snapshot captured yet.</p>
                  )}
                </section>
              </main>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
