import { useState } from "react";

type ColorToolModalProps = {
  uploadedFiles: { name: string; isImage?: boolean; size?: number }[];
  cssFileName: string;
  setCssFileName: (value: string) => void;
  cssSelector: string;
  setCssSelector: (value: string) => void;
  cssProperty: string;
  setCssProperty: (value: string) => void;
  cssColor: string;
  setCssColor: (value: string) => void;
  cssFileMatches: string[];
  selectedCssFile: string;
  setSelectedCssFile: (value: string) => void;
  cssPreview: string;
  onClose: () => void;
  onFindCssFile: () => void;
  onPreviewCssColor: () => void;
  onApplyCssColor: () => void;
  onRunVisualFixAgent: (prompt: string) => void;
  onUploadEvidence: (files: FileList | null) => void;
};

export default function ColorToolModal({
  uploadedFiles,
  cssFileName,
  setCssFileName,
  cssSelector,
  setCssSelector,
  cssProperty,
  setCssProperty,
  cssColor,
  setCssColor,
  cssFileMatches,
  selectedCssFile,
  setSelectedCssFile,
  cssPreview,
  onClose,
  onFindCssFile,
  onPreviewCssColor,
  onApplyCssColor,
  onRunVisualFixAgent,
  onUploadEvidence,
}: ColorToolModalProps) {
  const [visualFixPrompt, setVisualFixPrompt] = useState("");
  const inputClass =
    "mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm font-semibold text-slate-100 shadow-sm transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-slate-950/70 p-4 pt-6 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 bg-slate-900 px-6 py-5">
          <div>
            <div className="text-sm font-black uppercase tracking-wide text-sky-300">Visual Fix Agent</div>
            <h3 className="mt-1 text-2xl font-black tracking-tight text-white">Turn a bad-looking screen into a code patch</h3>
            <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-300">
              Type the visual issue here, attach a screenshot/design/UI file here, then run PayFix. This is separate from the regular chat composer.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-xl bg-slate-800 px-4 py-2 font-bold text-slate-100 transition hover:bg-slate-700">
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="rounded-2xl border border-sky-400/40 bg-sky-500/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-base font-black text-sky-100">What happens when you run it</div>
                <p className="mt-1 max-w-2xl text-[15px] font-semibold leading-7 text-sky-100/85">
                  PayFix creates an Agent task that reads the connected project, uses the screenshot/live UI evidence, identifies the broken visual rule, and prepares a safe patch preview before anything is written.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRunVisualFixAgent(visualFixPrompt)}
                className="inline-flex h-11 shrink-0 items-center rounded-xl bg-sky-500 px-5 text-sm font-black text-white shadow-sm transition hover:bg-sky-400"
              >
                Run Visual Fix Agent
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
              <label className="text-base font-black text-white" htmlFor="visual-fix-prompt">
                Describe the visual problem
              </label>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">
                Type the exact issue here. This text is what the Agent will use, not the regular chat composer.
              </p>
              <textarea
                id="visual-fix-prompt"
                value={visualFixPrompt}
                onChange={(event) => setVisualFixPrompt(event.target.value)}
                placeholder="Example: The agent response text is too faint on the dark card, and the buttons blend into the background. Find the source and patch it."
                className="mt-3 min-h-28 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-3 text-[15px] font-semibold leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30"
              />
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-base font-black text-white">Attach visual evidence for this fix</div>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">
                    Upload evidence here for this Visual Fix run. The Agent will receive these files with the visual issue you typed above.
                  </p>
                </div>
                <label className="inline-flex h-10 cursor-pointer items-center rounded-xl bg-white px-4 text-sm font-black text-slate-950 transition hover:bg-sky-50">
                  Upload evidence
                  <input
                    type="file"
                    multiple
                    accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.html,.css,.scss,.txt,image/*"
                    className="hidden"
                    onChange={(event) => {
                      onUploadEvidence(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>

              {uploadedFiles.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {uploadedFiles.slice(0, 8).map((file, index) => (
                    <span
                      key={`${file.name}-${index}`}
                    className="max-w-full truncate rounded-full bg-white/10 px-3 py-1.5 text-sm font-black text-slate-100 ring-1 ring-white/10"
                    >
                      {file.isImage ? "Image" : "File"}: {file.name}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-slate-600 px-3 py-2 text-sm font-semibold text-slate-400">
                  No visual evidence attached yet. Upload a screenshot/design file here before running when possible.
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 text-sm font-semibold text-slate-300 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-950/50 p-3 ring-1 ring-white/10">
                <div className="font-black text-white">Normal composer + Agent</div>
                <div className="mt-1 leading-5">Best for broad project work: bugs, features, logs, tests, installs, refactors, and general patch requests.</div>
              </div>
              <div className="rounded-xl bg-sky-500/10 p-3 ring-1 ring-sky-400/30">
                <div className="font-black text-sky-100">Visual Fix Agent</div>
                <div className="mt-1 leading-5">Best for visible UI problems: unreadable text, overflow, spacing, bad contrast, broken responsive layout, and screenshot-to-source patching.</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 text-[15px] sm:grid-cols-3">
              {[
                ["1. Give it evidence", "Upload a screenshot/file here, use Live Inspector, or select a visual target."],
                ["2. It finds the source", "Maps the problem to likely components, styles, selectors, tokens, or layout code."],
                ["3. You review the patch", "Shows what changed and lets you validate before applying."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-xl bg-slate-950/60 p-3 ring-1 ring-white/10">
                  <div className="font-black text-white">{title}</div>
                  <div className="mt-1 text-sm font-semibold leading-6 text-slate-300">{body}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
              <div className="text-sm font-black uppercase tracking-wide text-emerald-200">Why developers should care</div>
              <div className="mt-1 text-sm font-semibold leading-6 text-emerald-50/90">
                It removes the annoying hunt: “which component, style rule, or layout code made this unreadable?” Instead of manually searching the repo, PayFix turns visible UI defects into reviewable code changes.
              </div>
            </div>
          </div>

          <details className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
            <summary className="cursor-pointer text-sm font-black text-slate-100">
              Optional: manual CSS override
            </summary>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">
              This is for quick one-off color edits when you already know the selector/property. For real UI bugs, use the Agent workflow above because it finds the source and prepares a patch.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-bold text-slate-200">CSS file name</label>
                <input
                  value={cssFileName}
                  onChange={(e) => setCssFileName(e.target.value)}
                  placeholder="globals.css or app.css"
                  className={inputClass}
                />
                <button onClick={onFindCssFile} className="mt-2 rounded-xl bg-slate-700 px-4 py-2 font-bold text-white shadow-sm transition hover:bg-slate-600">
                  Find CSS File
                </button>
              </div>

              <div>
                <label className="text-sm font-bold text-slate-200">Matched file</label>
                <select
                  value={selectedCssFile}
                  onChange={(e) => setSelectedCssFile(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select file...</option>
                  {cssFileMatches.map((file) => (
                    <option key={file} value={file}>
                      {file}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-bold text-slate-200">Class / ID selector</label>
                <input
                  value={cssSelector}
                  onChange={(e) => setCssSelector(e.target.value)}
                  placeholder=".button or #header"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="text-sm font-bold text-slate-200">CSS property</label>
                <select
                  value={cssProperty}
                  onChange={(e) => setCssProperty(e.target.value)}
                  className={inputClass}
                >
                  <option value="color">color</option>
                  <option value="background-color">background-color</option>
                  <option value="border-color">border-color</option>
                  <option value="box-shadow">box-shadow</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-bold text-slate-200">Choose color</label>
                <div className="mt-1 flex gap-3">
                  <input
                    type="color"
                    value={cssColor}
                    onChange={(e) => setCssColor(e.target.value)}
                    className="h-12 w-16 rounded-xl border border-slate-700 bg-slate-950 p-1 shadow-sm"
                  />
                  <input
                    value={cssColor}
                    onChange={(e) => setCssColor(e.target.value)}
                    className={`${inputClass} mt-0 font-mono`}
                  />
                  <div className="h-12 w-20 rounded-xl border border-slate-700 shadow-inner" style={{ backgroundColor: cssColor }} />
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button onClick={onPreviewCssColor} className="rounded-xl bg-violet-600 px-5 py-2 font-bold text-white shadow-sm transition hover:bg-violet-500">
                Preview manual color
              </button>
              <button onClick={onApplyCssColor} className="rounded-xl bg-rose-600 px-5 py-2 font-bold text-white shadow-sm transition hover:bg-rose-500">
                Apply manual color
              </button>
            </div>
          </details>

          {cssPreview && (
            <div className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-sm text-green-300 shadow-inner">
              <pre className="whitespace-pre-wrap">{cssPreview}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
