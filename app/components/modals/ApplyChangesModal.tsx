import { useState } from "react";

type ApplyChangesModalProps = {
  description: string;
  patchSetFiles: string[];
  applyAllLoading: boolean;
  agentFollowUpLoading: boolean;
  applyFilePath: string;
  setApplyFilePath: (value: string) => void;
  applyMode: "insert" | "replace" | "overwrite";
  setApplyMode: (value: "insert" | "replace" | "overwrite") => void;
  applySearchContent: string;
  setApplySearchContent: (value: string) => void;
  applyNewContent: string;
  setApplyNewContent: (value: string) => void;
  diffOldContent: string;
  diffNewContent: string;
  canApply: boolean;
  onClose: () => void;
  onPreview: () => void;
  onApply: () => void;
  onApplyAll: () => void;
  onAgentFollowUp: (prompt: string) => void;
};

function numberedLines(value: string) {
  const lines = value ? value.split(/\r?\n/) : [];
  return lines.length ? lines : [""];
}

function lineClass(line: string, mode: "old" | "new") {
  if (line.startsWith("FILE:") || line === "---") return "bg-slate-800 text-slate-100";
  if (mode === "old") {
    return line.trim() ? "bg-rose-950/30 text-rose-100" : "bg-slate-950 text-slate-500";
  }
  return line.trim() ? "bg-emerald-950/30 text-emerald-100" : "bg-slate-950 text-slate-500";
}

type UnifiedDiffRow = {
  type: "same" | "add" | "remove";
  oldLine?: number;
  newLine?: number;
  text: string;
};

function buildUnifiedDiff(oldValue: string, newValue: string) {
  const oldLines = numberedLines(oldValue);
  const newLines = numberedLines(newValue);
  const max = Math.max(oldLines.length, newLines.length);
  const rows: UnifiedDiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (let index = 0; index < max; index += 1) {
    const oldText = oldLines[index] ?? "";
    const newText = newLines[index] ?? "";

    if (oldText === newText) {
      rows.push({ type: "same", oldLine, newLine, text: oldText });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (oldText !== "") {
      rows.push({ type: "remove", oldLine, text: oldText });
      oldLine += 1;
    }

    if (newText !== "") {
      rows.push({ type: "add", newLine, text: newText });
      newLine += 1;
    }
  }

  return rows;
}

function UnifiedDiff({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const rows = buildUnifiedDiff(oldContent, newContent);

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">Unified Diff</div>
          <div className="text-sm font-bold text-slate-950">Review changed lines before Apply</div>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 shadow-sm">
          {rows.filter((row) => row.type !== "same").length} changed row(s)
        </span>
      </div>

      <div className="max-h-72 overflow-auto font-mono text-xs leading-5">
        {rows.map((row, index) => (
          <div
            key={`${row.type}-${index}-${row.text.slice(0, 24)}`}
            className={`grid grid-cols-[56px_56px_32px_1fr] border-b border-slate-100 ${
              row.type === "add"
                ? "bg-emerald-50 text-emerald-950"
                : row.type === "remove"
                  ? "bg-rose-50 text-rose-950"
                  : "bg-white text-slate-700"
            }`}
          >
            <div className="select-none px-3 py-1 text-right text-slate-400">{row.oldLine || ""}</div>
            <div className="select-none border-r border-slate-200 px-3 py-1 text-right text-slate-400">
              {row.newLine || ""}
            </div>
            <div
              className={`select-none px-2 py-1 text-center font-black ${
                row.type === "add" ? "text-emerald-700" : row.type === "remove" ? "text-rose-700" : "text-slate-300"
              }`}
            >
              {row.type === "add" ? "+" : row.type === "remove" ? "-" : ""}
            </div>
            <pre className="whitespace-pre-wrap break-words px-3 py-1">{row.text || " "}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function CodePanel({
  title,
  content,
  emptyText,
  mode,
}: {
  title: string;
  content: string;
  emptyText: string;
  mode: "old" | "new";
}) {
  const lines = numberedLines(content || emptyText);

  return (
    <div className="min-h-0 overflow-hidden rounded-2xl bg-slate-950 shadow-lg ring-1 ring-slate-800">
      <div className="flex h-10 items-center justify-between border-b border-slate-800 bg-slate-900 px-4">
        <div className="text-xs font-black uppercase tracking-wide text-white">{title}</div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
            mode === "old" ? "bg-rose-500/15 text-rose-200" : "bg-emerald-500/15 text-emerald-200"
          }`}
        >
          {mode === "old" ? "Before" : "After"}
        </span>
      </div>

      <div className="h-full overflow-auto pb-8 font-mono text-xs leading-5">
        {lines.map((line, index) => (
          <div key={`${mode}-${index}-${line.slice(0, 20)}`} className={`grid grid-cols-[56px_1fr] ${lineClass(line, mode)}`}>
            <div className="select-none border-r border-slate-800/80 px-3 py-0.5 text-right text-slate-500">
              {index + 1}
            </div>
            <pre className="whitespace-pre-wrap break-words px-3 py-0.5">{line || " "}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ApplyChangesModal({
  description,
  patchSetFiles,
  applyAllLoading,
  agentFollowUpLoading,
  applyFilePath,
  setApplyFilePath,
  applyMode,
  setApplyMode,
  applySearchContent,
  setApplySearchContent,
  applyNewContent,
  setApplyNewContent,
  diffOldContent,
  diffNewContent,
  canApply,
  onClose,
  onPreview,
  onApply,
  onApplyAll,
  onAgentFollowUp,
}: ApplyChangesModalProps) {
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const hasPatchSet = patchSetFiles.length > 1;
  const changedLineCount =
    Math.abs(numberedLines(diffNewContent).length - numberedLines(diffOldContent).length) ||
    numberedLines(diffNewContent).filter((line, index) => line !== numberedLines(diffOldContent)[index]).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-5 backdrop-blur-sm">
      <div className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-blue-600">Patch Review</div>
            <h3 className="mt-1 text-xl font-black">Preview / Apply File Change</h3>
            <p className="mt-1 text-sm text-slate-500">
              Review the exact file change before PayFix writes anything to disk.
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-200">
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-5">
          {description && (
            <div className="mb-4 rounded-2xl bg-blue-50 p-4 text-sm leading-6 text-blue-950 shadow-sm ring-1 ring-blue-100">
              <div className="font-black">What the agent found</div>
              <p className="mt-1 whitespace-pre-wrap">{description}</p>
            </div>
          )}

          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">Target</div>
              <div className="mt-1 truncate text-sm font-black text-slate-950" title={applyFilePath || "No file selected"}>
                {applyFilePath.split(/[\\/]/).pop() || "No file"}
              </div>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">Patch Mode</div>
              <div className="mt-1 text-sm font-black capitalize text-slate-950">{applyMode}</div>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">Diff Status</div>
              <div className={`mt-1 text-sm font-black ${canApply ? "text-emerald-700" : "text-amber-700"}`}>
                {canApply ? "Preview verified" : "Preview required"}
              </div>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">Scope</div>
              <div className="mt-1 text-sm font-black text-slate-950">
                {hasPatchSet ? `${patchSetFiles.length} files` : `${changedLineCount} changed lines`}
              </div>
            </div>
          </div>

          {hasPatchSet && (
            <div className="mb-4 rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-950 shadow-sm ring-1 ring-indigo-100">
              <div className="font-black">Multi-file patch detected</div>
              <p className="mt-1">
                This answer includes {patchSetFiles.length} file changes. You can apply only the selected file, or apply
                the full set together after previews pass.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {patchSetFiles.map((file) => (
                  <span key={file} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-700 shadow-sm">
                    {file.split(/[\\/]/).pop() || file}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_190px]">
              <label className="text-xs font-black uppercase tracking-wide text-slate-500">
                Target file
                <input
                  value={applyFilePath}
                  onChange={(e) => setApplyFilePath(e.target.value)}
                  placeholder="Full file path"
                  className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm normal-case tracking-normal"
                />
              </label>

              <label className="text-xs font-black uppercase tracking-wide text-slate-500">
                Mode
                <select
                  value={applyMode}
                  onChange={(e) => setApplyMode(e.target.value as "insert" | "replace" | "overwrite")}
                  className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm normal-case tracking-normal"
                >
                  <option value="insert">Insert / append</option>
                  <option value="replace">Replace exact block</option>
                </select>
              </label>
            </div>

            <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm leading-6 text-blue-900 ring-1 ring-blue-100">
              {applyMode === "replace"
                ? "Replace mode only works when the exact current code block is found in the file."
                : "Insert mode appends the snippet, or places browser scripts before </body> in HTML files."}
            </div>

            {applyMode === "replace" && (
              <textarea
                value={applySearchContent}
                onChange={(e) => setApplySearchContent(e.target.value)}
                placeholder="Exact current code to replace"
                className="mt-3 h-24 w-full rounded-xl border border-slate-300 p-3 font-mono text-sm"
              />
            )}

            <textarea
              value={applyNewContent}
              onChange={(e) => setApplyNewContent(e.target.value)}
              placeholder={applyMode === "overwrite" ? "New full file content" : "Snippet or replacement code"}
              className="mt-3 h-28 w-full rounded-xl border border-slate-300 p-3 font-mono text-sm"
            />

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button onClick={onPreview} className="rounded-xl bg-purple-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-purple-500">
                Preview Diff
              </button>
              <button
                onClick={onApply}
                disabled={!canApply}
                className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
              >
                {hasPatchSet ? "Apply This File" : "Apply Changes"}
              </button>
              {hasPatchSet && (
                <button
                  onClick={onApplyAll}
                  disabled={applyAllLoading}
                  className="rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                >
                  {applyAllLoading ? "Applying All..." : `Apply All ${patchSetFiles.length} Files`}
                </button>
              )}
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {canApply ? `${changedLineCount} changed line(s)` : "Preview required before apply"}
              </span>
            </div>
          </div>

          <div className="mt-4">
            <UnifiedDiff oldContent={diffOldContent} newContent={diffNewContent} />
          </div>

          <div className="mt-4 grid h-[34vh] grid-cols-1 gap-4 lg:grid-cols-2">
            <CodePanel title="Current File" content={diffOldContent} emptyText="Preview the diff to load current file." mode="old" />
            <CodePanel title="New File" content={diffNewContent} emptyText="Preview the diff to see the proposed result." mode="new" />
          </div>

          <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-white shadow-lg ring-1 ring-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-blue-300">Agent Follow-up</div>
                <div className="mt-1 text-sm text-slate-300">
                  Ask PayFix to revise this patch, inspect another file, add another change, or explain the risk.
                </div>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-black text-slate-300">
                Same project + patch context
              </span>
            </div>

            <textarea
              value={followUpPrompt}
              onChange={(event) => setFollowUpPrompt(event.target.value)}
              placeholder="Example: also update the CSS file, but keep this HTML change..."
              className="mt-3 min-h-24 w-full resize-y rounded-xl border border-white/10 bg-slate-900 p-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
            />

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  const prompt = followUpPrompt.trim();
                  if (!prompt) return;
                  onAgentFollowUp(prompt);
                  setFollowUpPrompt("");
                }}
                disabled={agentFollowUpLoading || !followUpPrompt.trim()}
                className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-black text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {agentFollowUpLoading ? "Agent working..." : "Ask Agent"}
              </button>
              <div className="text-xs text-slate-400">
                This does not apply anything automatically. New changes still come back as a reviewable preview.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
