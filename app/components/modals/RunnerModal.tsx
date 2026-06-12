import { Play } from "lucide-react";

import type { RunnerMode } from "../../lib/payfixTypes";

type RunnerModalProps = {
  runnerMode: RunnerMode;
  runnerLanguage: string;
  runnerHtml: string;
  setRunnerHtml: (value: string) => void;
  runnerCss: string;
  setRunnerCss: (value: string) => void;
  runnerJs: string;
  setRunnerJs: (value: string) => void;
  runnerUnsupportedMessage: string;
  runnerRefreshKey: number;
  refreshRunner: () => void;
  runnerSrcDoc: string;
  onClose: () => void;
};

export default function RunnerModal({
  runnerMode,
  runnerLanguage,
  runnerHtml,
  setRunnerHtml,
  runnerCss,
  setRunnerCss,
  runnerJs,
  setRunnerJs,
  runnerUnsupportedMessage,
  runnerRefreshKey,
  refreshRunner,
  runnerSrcDoc,
  onClose,
}: RunnerModalProps) {
  return (
    <div className="fixed inset-0 z-[260] flex items-start justify-center bg-slate-950/70 p-4 pt-5 backdrop-blur-sm">
      <div className="h-[calc(100vh-40px)] w-full max-w-7xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-xl font-bold">Code Runner</h3>
            <p className="text-sm text-slate-500">Detected: {runnerLanguage}</p>
          </div>
          <button onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-700">
            Close
          </button>
        </div>

        {runnerMode === "unsupported" ? (
          <div className="grid h-[calc(100vh-113px)] grid-cols-2 gap-4 p-6">
            <div className="overflow-auto rounded-xl bg-slate-950 p-4 text-sm text-slate-200">
              <div className="mb-2 font-bold text-white">Code</div>
              <pre className="whitespace-pre-wrap">{runnerJs}</pre>
            </div>
            <div className="overflow-auto rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              <div className="mb-2 font-bold">Cannot run in browser</div>
              <pre className="whitespace-pre-wrap">{runnerUnsupportedMessage}</pre>
            </div>
          </div>
        ) : (
          <div className="grid h-[calc(100vh-113px)] grid-cols-1 gap-4 p-6 lg:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-3">
              {(runnerMode === "html" || runnerMode === "css") && (
                <textarea
                  value={runnerHtml}
                  onChange={(e) => setRunnerHtml(e.target.value)}
                  placeholder="HTML"
                  className="min-h-0 flex-1 rounded-xl border p-3 font-mono text-sm"
                />
              )}

              {(runnerMode === "html" || runnerMode === "css") && (
                <textarea
                  value={runnerCss}
                  onChange={(e) => setRunnerCss(e.target.value)}
                  placeholder="CSS"
                  className="min-h-0 flex-1 rounded-xl border p-3 font-mono text-sm"
                />
              )}

              {(runnerMode === "html" || runnerMode === "js") && (
                <textarea
                  value={runnerJs}
                  onChange={(e) => setRunnerJs(e.target.value)}
                  placeholder="JavaScript"
                  className="min-h-0 flex-1 rounded-xl border p-3 font-mono text-sm"
                />
              )}

              <button
                onClick={refreshRunner}
                className="inline-flex w-fit items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 font-semibold text-white"
              >
                <Play size={16} />
                Run / Refresh Preview
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border bg-white">
              <iframe
                key={runnerRefreshKey}
                title="runner-preview"
                className="h-full w-full bg-white"
                sandbox="allow-scripts"
                srcDoc={runnerSrcDoc}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
