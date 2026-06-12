import { useState } from "react";
import { Bot, FileText, Loader2, Send, Upload, X } from "lucide-react";

import type { ChatMessage, UploadedFile } from "../../lib/payfixTypes";

type AgentSessionModalProps = {
  messages: ChatMessage[];
  loading: boolean;
  status: string;
  connectedProjectPath: string;
  uploads: UploadedFile[];
  onClose: () => void;
  onSend: (prompt: string) => void;
  onUpload: (files: FileList | null) => void;
  onRemoveUpload: (index: number) => void;
};

function roleLabel(role: ChatMessage["role"]) {
  return role === "user" ? "You" : "PayFix Agent";
}

type AgentAction = {
  label: string;
  prompt: string;
};

function agentActionPrompts(content: string): AgentAction[] {
  const validationPlan = content.match(/VALIDATION PLAN\s+([\s\S]*?)(?:\n\nConfidence:|\n\n[A-Z][A-Z ]+\n|$)/)?.[1] || "";
  const patchReady = /Patch preview is ready|PATCH REVIEW\s+Patch preview/i.test(content);
  const dependency = content.match(/DEPENDENCY PROPOSAL\s+Package:\s*([^\n]+)/i)?.[1]?.trim();
  const actions: AgentAction[] = [];

  if (patchReady) {
    actions.push({
      label: "Explain patch",
      prompt: "Review the patch preview and explain exactly what it will change, what risk it has, and how to validate it.",
    });
  }

  if (dependency) {
    actions.push({
      label: "Handle dependency",
      prompt: `Install the missing package ${dependency} only if it is still required, then validate the project and report the exact result.`,
    });
  }

  for (const match of validationPlan.matchAll(/^\s*-\s+(.+)$/gm)) {
    const action = match[1]?.trim();
    if (action && !/no patch was prepared/i.test(action)) {
      actions.push({
        label: action.length > 38 ? `${action.slice(0, 35)}...` : action,
        prompt: action,
      });
    }
  }

  if (/No automatic patch is ready|No safe patch was prepared|No verified patch/i.test(content)) {
    actions.push({
      label: "Deep website audit",
      prompt:
        "Run a deeper behavioral website bug audit. Do not repeat the structural syntax scan unless diagnostics prove a compiler/build error. Inspect state persistence, effects, async/loading flows, localStorage/sessionStorage, modals, composer layout, disabled states, fetch error handling, and saved-chat workflow. Report what new areas you checked. Return only proven bugs or risks with exact file:line evidence and proposed fixes.",
    });
  }

  const seen = new Set<string>();
  return actions
    .filter((action) => {
      const key = action.prompt.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function contextPreview(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  const preview = lines.slice(0, 10).join("\n");
  return preview.length > 1200 ? `${preview.slice(0, 1200)}...` : preview;
}

export default function AgentSessionModal({
  messages,
  loading,
  status,
  connectedProjectPath,
  uploads,
  onClose,
  onSend,
  onUpload,
  onRemoveUpload,
}: AgentSessionModalProps) {
  const [draft, setDraft] = useState("");
  const [expandedContexts, setExpandedContexts] = useState<Set<string>>(new Set());
  const hasProject = Boolean(connectedProjectPath);
  const modeLabel = hasProject ? "Engineering mode" : "Evidence-only mode";
  const title = hasProject ? "Project Investigation" : "Evidence Investigation";

  function sendDraft() {
    const prompt = draft.trim();
    if (!prompt || loading) return;
    setDraft("");
    onSend(prompt);
  }

  return (
    <div className="fixed inset-0 z-[280] flex items-start justify-center bg-slate-950/65 p-5 backdrop-blur-sm">
      <div className="mt-3 flex h-[93vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between border-b border-slate-200 bg-gradient-to-br from-white via-white to-blue-50 px-6 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-blue-600">
              <Bot size={16} />
                Agent Workspace / {modeLabel}
              </div>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{title}</h2>
            <p className="mt-1 truncate text-sm text-slate-500">
              {connectedProjectPath || "Evidence-only mode: upload logs, screenshots, TLV, HAR, or gateway responses."}
            </p>
          </div>

          <button
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
            title="Close agent workspace"
          >
            <X size={20} />
          </button>
        </div>

        <div className="border-b border-slate-200 bg-slate-50/90 px-6 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 ring-1 ring-blue-100">
              {connectedProjectPath ? "Reads exact files" : "Evidence-only"}
            </span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
              {connectedProjectPath ? "Validates before apply" : "Uploads/logs/screenshots"}
            </span>
            <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-black text-purple-700 ring-1 ring-purple-100">
              {connectedProjectPath ? "Review required" : "No file writes"}
            </span>
            {status && <span className="ml-auto truncate text-xs font-bold text-slate-500">{status}</span>}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f3f7fb_0%,#edf2f7_100%)] px-6 py-4">
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
                <div className="text-lg font-black text-slate-950">
              {hasProject ? "Ask Agent to investigate the connected project." : "Ask Agent to investigate attached evidence."}
                </div>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  {hasProject
                    ? "Use this for deeper debugging: build failures, suspicious behavior, patch requests, dependency issues, localhost inspection, and multi-file code changes."
                    : "Use this for payment evidence: EMV/TLV, declined transactions, HAR files, gateway logs, screenshots, webhook payloads, and processor responses."}
                </p>
              </div>
            )}

            {messages.map((message, index) => (
              <article
                key={`${message.role}-${index}-${message.content.slice(0, 24)}`}
                className={`rounded-2xl p-4 shadow-sm ring-1 ${
                  message.role === "user"
                    ? "bg-blue-50 text-blue-950 ring-blue-100"
                    : "bg-white text-slate-950 ring-slate-200"
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">{roleLabel(message.role)}</div>
                  {message.role === "assistant" && loading && index === messages.length - 1 && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                      <Loader2 size={13} className="animate-spin" />
                      Working
                    </span>
                  )}
                </div>
                {message.role === "assistant" && /^Agent is running/i.test(message.content) ? (
                  <div className="rounded-2xl bg-slate-950 p-4 text-slate-100">
                    <div className="flex items-center gap-3 text-sm font-black">
                      <Loader2 size={16} className="animate-spin text-blue-300" />
                      {message.content}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-300 sm:grid-cols-3">
                      <span className="rounded-xl bg-white/5 px-3 py-2">Inspect context</span>
                      <span className="rounded-xl bg-white/5 px-3 py-2">Find evidence</span>
                      <span className="rounded-xl bg-white/5 px-3 py-2">Prepare reviewable action</span>
                    </div>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{message.content}</pre>
                )}
                {message.attachedUploads?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {message.attachedUploads.map((file, uploadIndex) => (
                      <span
                        key={`${file.name}-${uploadIndex}`}
                        className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm ring-1 ring-slate-200"
                      >
                        <FileText size={13} />
                        <span className="max-w-56 truncate">
                          {file.isImage ? "Image" : "File"} {uploadIndex + 1}: {file.name}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {(message.attachedLog || message.attachedCode) && (
                  <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                    {[
                      { key: "log", label: "Payment/log context", value: message.attachedLog || "" },
                      { key: "code", label: "Pasted code context", value: message.attachedCode || "" },
                    ]
                      .filter((item) => item.value.trim())
                      .map((item) => {
                        const contextKey = `${index}-${item.key}`;
                        const expanded = expandedContexts.has(contextKey);
                        const lineCount = item.value.trim().split(/\r?\n/).length;

                        return (
                          <div
                            key={item.key}
                            className="overflow-hidden rounded-2xl bg-slate-950 text-slate-100 shadow-sm ring-1 ring-slate-800"
                          >
                            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2">
                              <div className="text-xs font-black uppercase tracking-wide text-slate-300">
                                {item.label} / {lineCount} line(s)
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedContexts((current) => {
                                    const next = new Set(current);
                                    if (next.has(contextKey)) {
                                      next.delete(contextKey);
                                    } else {
                                      next.add(contextKey);
                                    }
                                    return next;
                                  });
                                }}
                                className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-100 transition hover:bg-white/20"
                              >
                                {expanded ? "Minimize" : "Expand"}
                              </button>
                            </div>
                            <pre
                              className={`overscroll-contain whitespace-pre-wrap break-words p-3 text-xs leading-5 text-emerald-100 ${
                                expanded ? "max-h-[520px] overflow-auto" : "max-h-36 overflow-hidden"
                              }`}
                            >
                              {expanded ? item.value.trim() : contextPreview(item.value)}
                            </pre>
                          </div>
                        );
                      })}
                  </div>
                )}
                {message.role === "assistant" && agentActionPrompts(message.content).length > 0 && (
                  <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                    <div className="mb-2 text-xs font-black uppercase tracking-wide text-blue-700">Next actions</div>
                    <div className="flex flex-wrap gap-2">
                      {agentActionPrompts(message.content).map((action) => (
                        <button
                          key={action.prompt}
                          onClick={() => onSend(action.prompt)}
                          disabled={loading}
                          className="rounded-xl bg-white px-3 py-2 text-left text-xs font-black text-blue-700 shadow-sm ring-1 ring-blue-100 transition hover:bg-blue-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                          title={`Send to Agent: ${action.prompt}`}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-200 bg-white p-4">
          <div className="rounded-2xl bg-slate-950 p-3 shadow-xl shadow-slate-950/10">
            {uploads.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {uploads.map((file, index) => (
                  <button
                    key={`${file.name}-${index}`}
                    type="button"
                    onClick={() => onRemoveUpload(index)}
                    className="inline-flex max-w-full items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-slate-100 ring-1 ring-white/10 transition hover:bg-rose-500/25 hover:text-white"
                    title="Remove this Agent attachment"
                  >
                    <FileText size={14} />
                    <span className="max-w-44 truncate">{file.name}</span>
                    <X size={13} />
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendDraft();
                }
              }}
              placeholder="Ask Agent what to inspect, change, validate, or install..."
              className="min-h-28 w-full resize-y rounded-2xl border border-white/10 bg-slate-900 p-4 text-[15px] leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-400">Enter sends. Shift+Enter adds a new line.</div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-black text-slate-100 ring-1 ring-white/10 transition hover:bg-slate-700">
                  <Upload size={16} />
                  Upload
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      onUpload(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  onClick={sendDraft}
                  disabled={loading || !draft.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  Send to Agent
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
