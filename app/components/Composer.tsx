import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  ChevronDown,
  Clock3,
  Code2,
  ExternalLink,
  MoreHorizontal,
  FileText,
  FolderOpen,
  Globe2,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Upload,
  Wand2,
  Zap,
  X,
} from "lucide-react";
import Image from "next/image";

import type { AttachTab, UploadedFile } from "../lib/payfixTypes";

type ComposerProps = {
  hasConversation: boolean;
  hasAttachment: boolean;
  canSend: boolean;
  canBuildTimeline: boolean;
  loading: boolean;
  timelineLoading: boolean;
  agentLoading: boolean;

  question: string;
  setQuestion: (value: string) => void;
  quickReplyOptions: string[];
  selectedQuickReplies: string[];
  toggleQuickReply: (value: string) => void;
  clearSelectedQuickReplies: () => void;

  log: string;
  setLog: (value: string) => void;

  code: string;
  setCode: (value: string) => void;

  searchFolder: string;
  setSearchFolder: (value: string) => void;

  searchFileName: string;
  setSearchFileName: (value: string) => void;

  searchText: string;
  setSearchText: (value: string) => void;

  computerSearchResults: string;

  projectPath: string;
  connectedProjectPath: string;
  setProjectPath: (value: string) => void;

  uploadedFiles: UploadedFile[];
  uploadPreview: string[];
  pendingQuestion: string;
  pendingUploads: UploadedFile[];
  isEditingMessage: boolean;

  activeAttachTab: AttachTab;
  setActiveAttachTab: (tab: AttachTab) => void;

  searchComputer: () => void;
  connectProject: () => void;
  handleUpload: (files: FileList | null) => void;
  removeUpload: (index: number) => void;
  clearAttachments: () => void;
  cancelEditMessage: () => void;
  loadProjectContext: () => void;
  importBrowserCapture: () => void;
  analyze: () => void;
  runAgent: () => void;
  buildTimeline: () => void;
  openColorTool: () => void;
  openAttachmentPreview: () => void;
  openProjectPreview: () => void;
  openConversationSnapshot: () => void;

  children: ReactNode;
};

const uploadAccept =
  ".txt,.log,.json,.har,.csv,.xls,.xlsx,.cs,.ts,.tsx,.js,.jsx,.md,.xml,.config,image/*";

const inputClass =
  "pf-input rounded-[var(--pf-radius-sm)] px-3 py-3 text-[15px] font-medium shadow-inner";

const codeInputClass =
  "pf-input rounded-[var(--pf-radius-sm)] px-3 py-3 font-mono text-[14px] font-medium leading-6 caret-sky-400 selection:bg-sky-500/25";

const panelClass =
  "rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-white/[0.03] p-4 backdrop-blur-sm";

function extractComposerUrls(value: string) {
  const matches = value.match(/https?:\/\/[^\s<>"')\]}]+/gi) || [];
  return Array.from(new Set(matches.map((url) => url.replace(/[.,;:!?]+$/g, ""))));
}

type BrowserChoice = {
  id: "chrome" | "edge" | "firefox";
  label: string;
};

const browserChoices: BrowserChoice[] = [
  { id: "chrome", label: "Chrome" },
  { id: "edge", label: "Microsoft Edge" },
  { id: "firefox", label: "Firefox" },
];

function shortHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function Composer({
  hasConversation,
  hasAttachment,
  canSend,
  canBuildTimeline,
  loading,
  timelineLoading,
  agentLoading,
  question,
  setQuestion,
  quickReplyOptions,
  selectedQuickReplies,
  toggleQuickReply,
  clearSelectedQuickReplies,
  log,
  setLog,
  code,
  setCode,
  searchFolder,
  setSearchFolder,
  searchFileName,
  setSearchFileName,
  searchText,
  setSearchText,
  computerSearchResults,
  projectPath,
  connectedProjectPath,
  setProjectPath,
  uploadedFiles,
  uploadPreview,
  isEditingMessage,
  activeAttachTab,
  setActiveAttachTab,
  searchComputer,
  connectProject,
  handleUpload: originalHandleUpload,
  removeUpload,
  clearAttachments,
  cancelEditMessage,
  loadProjectContext,
  importBrowserCapture,
  analyze,
  runAgent,
  buildTimeline,
  openColorTool,
  openAttachmentPreview,
  openProjectPreview,
  openConversationSnapshot,
  children,
}: ComposerProps) {
  const [previewImage, setPreviewImage] = useState<UploadedFile | null>(null);
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [replyContextOpen, setReplyContextOpen] = useState(false);
  const [advancedActionsOpen, setAdvancedActionsOpen] = useState(false);
  const [extensionHelpOpen, setExtensionHelpOpen] = useState(false);
  const [browserSessionHint, setBrowserSessionHint] = useState<{ url: string; message: string } | null>(null);
  const [urlSessionGate, setUrlSessionGate] = useState<{ url: string; acknowledged: boolean } | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const canSubmitMessage = canSend && !loading && !agentLoading && !timelineLoading;
  const composerUrls = extractComposerUrls(question);
  const primaryComposerUrl = composerUrls[0] || "";
  const needsUrlSessionGate =
    Boolean(primaryComposerUrl) && (!urlSessionGate || urlSessionGate.url !== primaryComposerUrl || !urlSessionGate.acknowledged);
  const questionLineCount = Math.max(1, question.split(/\r?\n/).length);
  const questionLooksLikeCode =
    /(<\/?[a-z][\s\S]*?>|=>|function\s+\w*|const\s+\w+|let\s+\w+|className=|import\s+.+from|public\s+class|<\/|{\s*$|;\s*$)/m.test(
      question,
    ) || questionLineCount >= 4;
  const composerHeight = Math.min(320, Math.max(hasConversation ? 84 : 96, 36 + questionLineCount * 22));
  const labelUpload = (file: UploadedFile, index: number) =>
    file.isImage ? `Image ${index + 1}: ${file.name}` : `File ${index + 1}: ${file.name}`;
  const quickReplyVisible = hasConversation && quickReplyOptions.length > 0 && !loading && !agentLoading && !timelineLoading;

  function handleUpload(files: FileList | null) {
    originalHandleUpload(files);

    if (files?.length) {
      setSetupOpen(false);
      setReplyContextOpen(false);
    }
  }

  function searchComputerAndCollapse() {
    searchComputer();
    setSetupOpen(false);
    setReplyContextOpen(false);
  }

  function connectProjectAndCollapse() {
    connectProject();
    setSetupOpen(false);
    setReplyContextOpen(false);
  }

  useEffect(() => {
    if (!advancedActionsOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!moreMenuRef.current?.contains(event.target as Node)) {
        setAdvancedActionsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setAdvancedActionsOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [advancedActionsOpen]);

  function toggleAdvancedActions() {
    setAdvancedActionsOpen((open) => !open);
  }

  function closeMoreMenu() {
    setAdvancedActionsOpen(false);
  }

  function buildTimelineFromMore() {
    closeMoreMenu();
    buildTimeline();
  }

  function runAgentFromMore() {
    closeMoreMenu();
    runAgent();
  }

  function openVisualFixFromMore() {
    closeMoreMenu();
    openColorTool();
  }

  function submitFromComposer() {
    if (!canSubmitMessage) return;

    if (needsUrlSessionGate) {
      setUrlSessionGate({ url: primaryComposerUrl, acknowledged: false });
      setBrowserSessionHint({
        url: primaryComposerUrl,
        message: "Choose the browser where you are logged in, or click Continue without browser if this is a public page.",
      });
      return;
    }

    analyze();
  }

  async function chooseLoggedInBrowser(browser: BrowserChoice) {
    if (!primaryComposerUrl) return;
    setUrlSessionGate({ url: primaryComposerUrl, acknowledged: true });

    try {
      const response = await fetch("/api/local-agent/app/open-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browser: browser.id, url: primaryComposerUrl }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !data?.ok) {
        const rawError = data?.error || "PayFix Local Agent could not open the browser.";
        const friendlyError = /returned text\/html|missing this endpoint|old/i.test(rawError)
          ? "Restart payfix-agent so it has the new browser-opening endpoint."
          : rawError;
        throw new Error(friendlyError);
      }

      setBrowserSessionHint({
        url: primaryComposerUrl,
        message: `Opened in ${browser.label}. Click into the SDK/folder page, paste that page URL, visible file list, or screenshot here, then click Analyze.`,
      });
    } catch (error: unknown) {
      try {
        await navigator.clipboard.writeText(primaryComposerUrl);
      } catch {
        // Clipboard is a convenience fallback only.
      }

      const message = error instanceof Error ? error.message : "Could not open that browser automatically.";
      setBrowserSessionHint({
        url: primaryComposerUrl,
        message: `${message} Your draft stays in the box until you send it. I copied the URL if clipboard access is allowed. Open ${browser.label}, paste the opened folder URL or screenshot here, then click Analyze.`,
      });
    }
  }

  function continueWithoutBrowser() {
    if (!primaryComposerUrl) return;
    setUrlSessionGate({ url: primaryComposerUrl, acknowledged: true });
    setBrowserSessionHint({
      url: primaryComposerUrl,
      message: "Okay, click Analyze again and PayFix will read the public version. If it hits a login wall, attach the logged-in page evidence next.",
    });
  }

  return (
    <>
      {!hasConversation && (
        <div className="allow-scroll min-h-0 flex-1 overflow-y-auto border-b border-[var(--pf-border)] px-6 pb-8 pt-8">
          <div className="mx-auto max-w-[960px]">
            <div className="text-center">
              <div className="pf-badge mx-auto w-fit border-sky-500/25 bg-sky-500/10 text-sky-300">
                PayFix Dev Studio
              </div>
              <h1 className="mt-4 bg-gradient-to-br from-white via-sky-100 to-sky-300 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
                Debug payments like a senior engineer
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[var(--pf-text-muted)]">
                Drop logs, connect your repo, trace gateway flows, or let the agent patch your project - all from one console.
              </p>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { step: "01", label: "Ask", detail: "Describe the bug, decline, or payment flow.", Icon: MessageSquare },
                { step: "02", label: "Attach", detail: "Logs, HAR files, screenshots, or source.", Icon: Paperclip },
                { step: "03", label: "Fix", detail: "Analyze, trace payment, or run the agent.", Icon: Zap },
              ].map((item) => (
                <div
                  key={item.label}
                  className="group rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-white/[0.03] p-4 transition hover:border-sky-500/30 hover:bg-sky-500/[0.04]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold text-sky-400/80">{item.step}</span>
                    <item.Icon size={18} className="text-sky-400/70" />
                  </div>
                  <div className="mt-3 text-sm font-bold text-[var(--pf-text)]">{item.label}</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--pf-text-muted)]">{item.detail}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[var(--pf-text-faint)]">
              <span className="pf-kbd">Enter</span>
              <span className="text-xs">send</span>
              <span className="text-[var(--pf-border-strong)]">/</span>
              <span className="pf-kbd">Shift</span>
              <span className="text-xs">+</span>
              <span className="pf-kbd">Enter</span>
              <span className="text-xs">new line</span>
              <span className="text-[var(--pf-border-strong)]">/</span>
              <span className="text-xs">paste or drag files into composer</span>
            </div>
          </div>

          <div className="mx-auto mt-8 max-w-[1100px] rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)]/60 shadow-[var(--pf-shadow)]">
            <button
              type="button"
              onClick={() => setSetupOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/[0.02]"
            >
              <div>
                <div className="font-bold text-[var(--pf-text)]">Context workspace</div>
                <div className="mt-1 text-sm text-[var(--pf-text-muted)]">
                  Search files, upload evidence, connect a project, or paste logs/code.
                </div>
              </div>
              <span className="pf-badge">{setupOpen ? "Collapse" : "Expand"}</span>
            </button>

            {!setupOpen && (
              <div className="border-t border-[var(--pf-border)] px-5 pb-4">
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  {uploadedFiles.length > 0 && (
                    <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-sky-300">
                      Uploads: {uploadedFiles.length}
                    </span>
                  )}
                  {connectedProjectPath && (
                    <span className="rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-violet-300">
                      Project: {connectedProjectPath.split("\\").pop()}
                    </span>
                  )}
                  {log.trim() && <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-amber-300">Log included</span>}
                  {code.trim() && <span className="rounded-full border border-[var(--pf-border)] bg-white/5 px-3 py-1 text-[var(--pf-text-muted)]">Code included</span>}
                  {!hasAttachment && <span className="rounded-full border border-[var(--pf-border)] bg-white/[0.03] px-3 py-1 text-[var(--pf-text-faint)]">No context yet</span>}
                </div>
              </div>
            )}

            {setupOpen && (
              <div className="border-t border-[var(--pf-border)] p-4">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className={panelClass}>
                    <div className="flex items-center gap-2 font-semibold text-[var(--pf-text)]">
                      <Search size={17} className="text-emerald-400" />
                      Search anywhere
                    </div>

                    <p className="mt-1 text-sm text-[var(--pf-text-muted)]">
                      Find files or snippets without leaving the workspace.
                    </p>

                    <SearchFields
                      searchFolder={searchFolder}
                      setSearchFolder={setSearchFolder}
                      searchFileName={searchFileName}
                      setSearchFileName={setSearchFileName}
                      searchText={searchText}
                      setSearchText={setSearchText}
                    />

                    <button
                      onClick={searchComputerAndCollapse}
                      className="mt-3 inline-flex h-10 items-center gap-2 rounded-[var(--pf-radius-sm)] bg-emerald-600 px-5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500"
                    >
                      <Search size={16} />
                      Search computer
                    </button>
                  </div>

                  <div className={panelClass}>
                    <div className="flex items-center gap-2 font-semibold text-[var(--pf-text)]">
                      <Upload size={17} className="text-sky-400" />
                      Upload files
                    </div>

                    <p className="mt-1 text-sm text-[var(--pf-text-muted)]">
                      Attach logs, screenshots, configs, or source files.
                    </p>

                    <input
                      type="file"
                      multiple
                      accept={uploadAccept}
                      onChange={(e) => handleUpload(e.target.files)}
                      className="mt-3 block w-full rounded-[var(--pf-radius-sm)] border border-[var(--pf-border)] bg-black/20 p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500/15 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sky-300"
                    />

                    {uploadedFiles.length > 0 && (
                      <div className="mt-3 text-sm text-[var(--pf-text-muted)]">
                        Attached: {uploadPreview.join(", ")}
                      </div>
                    )}
                  </div>
                </div>

                <div className={`${panelClass} mt-4`}>
                  <div className="flex items-center gap-2 font-semibold text-[var(--pf-text)]">
                    <FolderOpen size={17} className="text-violet-400" />
                    Project path
                  </div>

                  <div className="mt-3 flex gap-3">
                    <input
                      value={projectPath}
                      onChange={(e) => setProjectPath(e.target.value)}
                      placeholder="C:\\Users\\you\\source\\repos\\MyProject"
                      className={`${inputClass} w-full font-mono text-sm`}
                    />

                    <button
                      onClick={connectProjectAndCollapse}
                      disabled={!projectPath.trim()}
                      className="pf-btn-primary shrink-0 px-6 disabled:opacity-40"
                    >
                      Connect
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <textarea
                    value={log}
                    onChange={(e) => setLog(e.target.value)}
                    placeholder="Paste payment log / error..."
                    className={`${inputClass} h-32 font-mono`}
                  />

                  <textarea
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Paste related code..."
                    spellCheck={false}
                    className={`${codeInputClass} h-32`}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {children}

      <div className="shrink-0 border-t border-[var(--pf-border)] bg-[var(--pf-bg-elevated)]/90 px-5 py-3 backdrop-blur-xl">
        <div className="mx-auto max-w-[1200px]">
          {hasConversation && (
            <>
              {replyContextOpen && (
                <div className="mb-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">Attach More Context</div>
                      <div className="text-sm text-slate-500">
                        Add one more clue before your reply.
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={openConversationSnapshot}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-blue-50"
                      >
                        <FileText size={14} />
                        Snapshot
                      </button>
                      <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                        {(["search", "upload", "project"] as const).map((tab) => (
                          <button
                            key={tab}
                            onClick={() => setActiveAttachTab(tab)}
                            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                              activeAttachTab === tab
                                ? "bg-slate-950 text-white shadow-sm"
                                : "text-slate-600 hover:bg-white"
                            }`}
                          >
                            {tab === "search" && "Search"}
                            {tab === "upload" && "Upload"}
                            {tab === "project" && "Project"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {activeAttachTab === "search" && (
                    <>
                      <SearchFields
                        searchFolder={searchFolder}
                        setSearchFolder={setSearchFolder}
                        searchFileName={searchFileName}
                        setSearchFileName={setSearchFileName}
                        searchText={searchText}
                        setSearchText={setSearchText}
                      />

                      <button
                        onClick={searchComputerAndCollapse}
                        className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
                      >
                        <Search size={16} />
                        Search Computer
                      </button>
                    </>
                  )}

                  {activeAttachTab === "upload" && (
                    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500">
                      <Upload size={16} />
                      Upload Files
                      <input
                        type="file"
                        multiple
                        accept={uploadAccept}
                        onChange={(e) => handleUpload(e.target.files)}
                        className="hidden"
                      />
                    </label>
                  )}

                  {activeAttachTab === "project" && (
                    <>
                      <input
                        value={projectPath}
                        onChange={(e) => setProjectPath(e.target.value)}
                        placeholder="Project path"
                        className={`${inputClass} w-full`}
                      />

                      <button
                        onClick={connectProjectAndCollapse}
                        disabled={!projectPath.trim()}
                        className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
                      >
                        <FolderOpen size={16} />
                        Connect Project
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {hasAttachment && (
            <div className="mb-2 flex h-10 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden pr-1">
              {computerSearchResults && (
                <button
                  type="button"
                  onClick={openAttachmentPreview}
                  className="inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-100"
                >
                  <Paperclip size={14} />
                  <span>Search attached:</span>
                  <span className="max-w-[220px] truncate rounded-full bg-emerald-200/60 px-2 py-0.5 text-emerald-900">
                    {searchFileName || "computer-results"}
                  </span>
                </button>
              )}

              {uploadedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="inline-flex h-8 max-w-[260px] shrink-0 items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-2.5 text-xs font-bold text-blue-700 shadow-sm"
                >
                  {file.isImage ? (
                    <button
                      type="button"
                      onClick={() => setPreviewImage(file)}
                      className="h-6 w-8 shrink-0 overflow-hidden rounded-lg border border-blue-200 bg-white"
                      title="Open screenshot"
                    >
                      <Image
                        src={file.content}
                        alt={file.name}
                        width={40}
                        height={32}
                        unoptimized
                        className="h-6 w-8 object-cover"
                      />
                    </button>
                  ) : (
                    <FileText size={16} className="shrink-0" />
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (file.isImage) {
                        setPreviewImage(file);
                      } else {
                        setPreviewFile(file);
                      }
                    }}
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                  >
                    {labelUpload(file, index)}
                  </button>

                  <button
                    type="button"
                    onClick={() => removeUpload(index)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-blue-100"
                    title="Remove attachment"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}

              {connectedProjectPath && (
                <button
                  type="button"
                  onClick={openProjectPreview}
                  className="inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-purple-300 bg-purple-50 px-3 text-xs font-bold text-purple-700 shadow-sm transition hover:bg-purple-100"
                >
                  <FolderOpen size={14} />
                  <span>Project:</span>
                  <span className="max-w-[220px] truncate rounded-full bg-purple-200/60 px-2 py-0.5 text-purple-900">
                    {connectedProjectPath.split("\\").pop() || "Connected"}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={clearAttachments}
                className="h-8 rounded-full border border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                Clear attachments
              </button>
            </div>
          )}

          {quickReplyVisible && (
            <div className="mb-2 rounded-2xl border border-blue-100 bg-blue-50/80 p-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                {quickReplyOptions.map((option) => {
                  const selected = selectedQuickReplies.includes(option);

                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => toggleQuickReply(option)}
                      className={`inline-flex min-h-8 max-w-full items-center rounded-full border px-3 py-1 text-left text-xs font-black transition ${
                        selected
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border-blue-200 bg-white text-blue-700 hover:border-blue-400 hover:bg-blue-100"
                      }`}
                      title={option}
                    >
                      <span className="truncate">{option}</span>
                    </button>
                  );
                })}

                {selectedQuickReplies.length > 0 && (
                  <button
                    type="button"
                    onClick={clearSelectedQuickReplies}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-slate-300 bg-white px-3 text-xs font-black text-slate-600 transition hover:bg-slate-50"
                    title="Clear selected replies"
                  >
                    <X size={13} />
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          <div
            onPaste={(e) => {
              if (e.clipboardData.files.length > 0) {
                handleUpload(e.clipboardData.files);
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();

              if (e.dataTransfer.files.length > 0) {
                handleUpload(e.dataTransfer.files);
              }
            }}
            className="relative"
          >
            {primaryComposerUrl && (
              <div className="mb-2 rounded-[var(--pf-radius-sm)] border border-sky-500/25 bg-sky-500/10 p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-black text-sky-100">
                      <Globe2 size={16} className="text-sky-300" />
                      Logged-in URL detected
                    </div>
                    <p className="mt-1 max-w-3xl text-sm leading-5 text-sky-100/80">
                      PayFix can read public pages, but private portals need the browser where you are signed in.
                      Before analyzing, open it in the browser where you are signed in. Then paste the opened page/folder URL,
                      visible file list, or attach a screenshot.
                    </p>
                    <p className="mt-1 max-w-3xl text-xs font-semibold leading-5 text-sky-100/65">
                      Your draft is not sent yet. Open the logged-in page first, attach/import the visible page evidence, then send.
                    </p>
                    <div className="mt-1 truncate text-xs font-semibold text-sky-200/70">{shortHost(primaryComposerUrl)}</div>
                  </div>

                  <a
                    href={primaryComposerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 text-xs font-black text-sky-100 transition hover:bg-sky-400/20"
                    title="Opens in your current/default browser. Use browser choices below if you are logged in elsewhere."
                  >
                    <ExternalLink size={14} />
                    Open default
                  </a>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {browserChoices.map((browser) => (
                    <button
                      key={browser.id}
                      type="button"
                      onClick={() => chooseLoggedInBrowser(browser)}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-[var(--pf-bg-elevated)] px-3 text-xs font-black text-[var(--pf-text)] transition hover:border-sky-400/40 hover:bg-sky-500/10"
                      title={`Open this URL in ${browser.label} through PayFix Local Agent. If the agent is not running, PayFix will copy the URL instead.`}
                    >
                      <ExternalLink size={13} />
                      Open {browser.label}
                    </button>
                  ))}
                  {browserSessionHint?.url === primaryComposerUrl && (
                    <span className="text-xs font-semibold leading-5 text-sky-100/75">{browserSessionHint.message}</span>
                  )}
                  <button
                    type="button"
                    onClick={continueWithoutBrowser}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 text-xs font-black text-amber-100 transition hover:bg-amber-300/20"
                    title="Skip the logged-in-browser step and let PayFix analyze only what the public/server reader can access."
                  >
                    Continue without browser
                  </button>
                  <button
                    type="button"
                    onClick={importBrowserCapture}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs font-black text-emerald-100 transition hover:bg-emerald-300/20"
                    title="After using the PayFix Page Capture extension, import the latest shared logged-in page as evidence."
                  >
                    <Upload size={13} />
                    Import shared page
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtensionHelpOpen(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-violet-300/25 bg-violet-300/10 px-3 text-xs font-black text-violet-100 transition hover:bg-violet-300/20"
                    title="Show exact setup steps for the PayFix browser capture extension."
                  >
                    <FileText size={13} />
                    Setup extension
                  </button>
                </div>
              </div>
            )}

            {/* Unified container so textarea + buttons look like one connected control */}
            <div className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)]/80 p-2 shadow-[var(--pf-shadow)] transition focus-within:border-sky-500/40 focus-within:shadow-[0_0_0_1px_rgba(56,189,248,0.25)]">
              <div className="relative">
                {questionLooksLikeCode && (
                  <div className="hidden">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-slate-300">
                      <Code2 size={13} className="text-blue-300" />
                      Code Composer
                    </div>
                    <div className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-400">
                      Enter sends • Shift+Enter newline
                    </div>
                  </div>
                )}
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey) {
                      return;
                    }

                    e.preventDefault();

                    submitFromComposer();
                  }}
                  disabled={loading || agentLoading || timelineLoading}
                  placeholder={
                    loading
                      ? "Waiting for PayFix AI..."
                      : hasConversation
                      ? "Reply here... paste screenshots or drag files here too..."
                      : "Ask your question... paste screenshots or drag files here too..."
                  }
                  // make top part rounded and bottom not so buttons can form the bottom rounded edge
                  style={{ height: composerHeight }}
                  className={`w-full resize-none rounded-b-none border-0 bg-transparent px-4 py-3 pr-40 text-[15px] font-medium shadow-none transition focus:ring-0 ${
                    questionLooksLikeCode
                      ? "rounded-t-[var(--pf-radius-sm)] font-mono leading-6 text-[var(--pf-text)] caret-sky-400 selection:bg-sky-500/25"
                      : "rounded-t-[var(--pf-radius-sm)] text-[var(--pf-text)]"
                  }`}
                  spellCheck={!questionLooksLikeCode}
                  draggable={false}
                />

                <div
                  className={`pointer-events-none absolute bottom-3 right-3 rounded-full px-3 py-1 text-xs font-semibold ${
                    questionLooksLikeCode ? "border border-sky-500/25 bg-sky-500/10 text-sky-300" : "bg-white/5 text-[var(--pf-text-faint)]"
                  }`}
                >
                  {questionLooksLikeCode ? "Code detected" : "Paste screenshot"}
                </div>
              </div>

              {/* buttons area shares the same parent background and gets the bottom rounded corners */}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-b-2xl bg-transparent">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReplyContextOpen((open) => !open);
                      if (!hasConversation) setSetupOpen((open) => !open);
                    }}
                    className="pf-btn-ghost h-10 px-4 text-sm"
                  >
                    <Plus size={16} />
                    {hasConversation ? "Add context" : "Context"}
                  </button>
                </div>

                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <button
                    onClick={submitFromComposer}
                    disabled={!canSubmitMessage}
                    className="pf-btn-primary h-11 px-6 text-sm"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        {hasConversation ? "Send Reply" : "Analyze"}
                      </>
                    )}
                  </button>

                  {isEditingMessage && (
                    <button
                      type="button"
                      onClick={cancelEditMessage}
                      disabled={loading || agentLoading || timelineLoading}
                      className="pf-btn-ghost h-10 px-4 text-sm disabled:opacity-40"
                    >
                      <X size={16} />
                      Cancel Edit
                    </button>
                  )}

                  <div ref={moreMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={toggleAdvancedActions}
                      aria-expanded={advancedActionsOpen}
                      aria-haspopup="menu"
                      className="pf-btn-ghost h-10 px-3 text-sm"
                    >
                      <MoreHorizontal size={16} />
                      More
                      <ChevronDown size={14} className={`transition ${advancedActionsOpen ? "rotate-180" : ""}`} />
                    </button>

                    {advancedActionsOpen && (
                      <div
                        role="menu"
                        className="absolute bottom-full right-0 z-40 mb-2 w-64 overflow-hidden rounded-[var(--pf-radius-sm)] border border-[var(--pf-border)] bg-[var(--pf-bg-elevated)] shadow-2xl shadow-black/35"
                      >
                        <div className="border-b border-[var(--pf-border)] px-3 py-2">
                          <div className="text-xs font-black uppercase tracking-wide text-[var(--pf-text-muted)]">More tools</div>
                        </div>

                        <div className="p-1.5">
                          <button
                            type="button"
                            role="menuitem"
                            title="Build a payment-specific timeline from logs or evidence."
                            onClick={buildTimelineFromMore}
                            disabled={loading || timelineLoading || agentLoading || !canBuildTimeline}
                            className="group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:text-[var(--pf-text-faint)]"
                          >
                            {timelineLoading ? (
                              <Loader2 size={16} className="shrink-0 animate-spin text-sky-300" />
                            ) : (
                              <Clock3 size={16} className="shrink-0 text-sky-300" />
                            )}
                            <span className="min-w-0">
                              <span className="block text-sm font-bold text-[var(--pf-text)]">Trace Payment</span>
                              <span className="hidden text-xs text-sky-200/80 group-hover:block">Device, SDK, app request, gateway, final result.</span>
                            </span>
                          </button>

                          <button
                            type="button"
                            role="menuitem"
                            title="Open Agent mode for project inspection, patches, validation, installs, or generated apps."
                            onClick={runAgentFromMore}
                            disabled={loading || timelineLoading || agentLoading || !canSend}
                            className="group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:text-[var(--pf-text-faint)]"
                          >
                            {agentLoading ? (
                              <Loader2 size={16} className="shrink-0 animate-spin text-indigo-300" />
                            ) : (
                              <Bot size={16} className="shrink-0 text-indigo-300" />
                            )}
                            <span className="min-w-0">
                              <span className="block text-sm font-bold text-[var(--pf-text)]">Run Agent</span>
                              <span className="hidden text-xs text-indigo-200/80 group-hover:block">Patch files, validate, install, or build projects.</span>
                            </span>
                          </button>

                          <button
                            type="button"
                            role="menuitem"
                            title="Find visible UI problems from a screenshot and prepare a source patch."
                            onClick={openVisualFixFromMore}
                            disabled={loading || agentLoading}
                            className="group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:text-[var(--pf-text-faint)]"
                          >
                            <Wand2 size={16} className="shrink-0 text-rose-300" />
                            <span className="min-w-0">
                              <span className="block text-sm font-bold text-[var(--pf-text)]">Visual Fix</span>
                              <span className="hidden text-xs text-rose-200/80 group-hover:block">Screenshot-to-source fixes for contrast/layout.</span>
                            </span>
                          </button>

                          {!hasConversation && (
                            <button
                              type="button"
                              role="menuitem"
                              title="Open the workspace for search, uploads, pasted logs/code, and project context."
                              onClick={() => {
                                setSetupOpen((open) => !open);
                                closeMoreMenu();
                              }}
                              className="group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-emerald-500/10"
                            >
                              <Paperclip size={16} className="shrink-0 text-emerald-300" />
                              <span className="min-w-0">
                                <span className="block text-sm font-bold text-[var(--pf-text)]">Context Workspace</span>
                                <span className="hidden text-xs text-emerald-200/80 group-hover:block">Search, upload, paste logs/code, or connect a repo.</span>
                              </span>
                            </button>
                          )}

                          {!hasConversation && (
                            <button
                              type="button"
                              role="menuitem"
                              title="Attach relevant files from the connected project to the regular chat."
                              onClick={() => {
                                closeMoreMenu();
                                loadProjectContext();
                              }}
                              disabled={loading || !connectedProjectPath}
                              className="group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:text-[var(--pf-text-faint)]"
                            >
                              <FolderOpen size={16} className="shrink-0 text-violet-300" />
                              <span className="min-w-0">
                                <span className="block text-sm font-bold text-[var(--pf-text)]">Use Project Files</span>
                                <span className="hidden text-xs text-violet-200/80 group-hover:block">Load selected project context into the chat.</span>
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-6">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-950">{previewImage.name}</div>
                <div className="text-sm text-slate-500">
                  {previewImage.type || "image"} - {Math.round(previewImage.size / 1024)} KB
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                title="Close preview"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-950 p-4">
              <Image
                src={previewImage.content}
                alt={previewImage.name}
                width={1400}
                height={900}
                unoptimized
                className="mx-auto h-auto max-h-[78vh] w-auto max-w-full rounded-xl object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-5">
              <div>
                <div className="truncate font-semibold text-slate-950">{previewFile.name}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {previewFile.type || "text/plain"} - {Math.round(previewFile.size / 1024)} KB
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="rounded-xl bg-slate-100 px-4 py-2 font-semibold"
                title="Close preview"
              >
                Close
              </button>
            </div>

            <pre className="min-h-0 flex-1 overscroll-contain overflow-auto whitespace-pre-wrap break-words bg-slate-950 p-5 text-sm leading-6 text-emerald-100">
              {previewFile.content || "This file is empty, or no text preview was available."}
            </pre>
          </div>
        </div>
      )}

      {extensionHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-6">
          <div className="w-full max-w-2xl overflow-hidden rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg-elevated)] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--pf-border)] px-5 py-4">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-sky-300">Logged-in page capture</div>
                <h2 className="mt-1 text-xl font-black text-[var(--pf-text)]">Set up the PayFix browser extension</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--pf-text-muted)]">
                  Use this when a portal needs your browser login. It shares only the page you explicitly capture.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExtensionHelpOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-[var(--pf-text)] transition hover:bg-white/10"
                title="Close extension setup"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5 text-sm leading-6 text-[var(--pf-text)]">
              <div className="rounded-[var(--pf-radius-sm)] border border-sky-500/25 bg-sky-500/10 p-4">
                <div className="font-black text-sky-100">Extension folder</div>
                <code className="mt-2 block break-all rounded-lg bg-slate-950/70 px-3 py-2 text-xs text-sky-100">
                  C:\Users\mekstein\payfix-ai\public\payfix-browser-capture-extension
                </code>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[var(--pf-radius-sm)] border border-[var(--pf-border)] bg-white/[0.03] p-4">
                  <div className="font-black">Chrome</div>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--pf-text-muted)]">
                    <li>Open <code>chrome://extensions</code>.</li>
                    <li>Turn on <strong>Developer mode</strong>.</li>
                    <li>Click <strong>Load unpacked</strong>.</li>
                    <li>Select the extension folder above.</li>
                  </ol>
                </div>

                <div className="rounded-[var(--pf-radius-sm)] border border-[var(--pf-border)] bg-white/[0.03] p-4">
                  <div className="font-black">Microsoft Edge</div>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--pf-text-muted)]">
                    <li>Open <code>edge://extensions</code>.</li>
                    <li>Turn on <strong>Developer mode</strong>.</li>
                    <li>Click <strong>Load unpacked</strong>.</li>
                    <li>Select the extension folder above.</li>
                  </ol>
                </div>
              </div>

              <div className="rounded-[var(--pf-radius-sm)] border border-emerald-500/25 bg-emerald-500/10 p-4">
                <div className="font-black text-emerald-100">Use it on a logged-in portal</div>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-emerald-100/80">
                  <li>Open the logged-in page or SDK folder in that browser.</li>
                  <li>Click the PayFix extension icon.</li>
                  <li>Click <strong>Share visible page</strong>.</li>
                  <li>Return to PayFix and click <strong>Import shared page</strong>.</li>
                  <li>Click <strong>Analyze</strong>.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type SearchFieldsProps = Pick<
  ComposerProps,
  | "searchFolder"
  | "setSearchFolder"
  | "searchFileName"
  | "setSearchFileName"
  | "searchText"
  | "setSearchText"
>;

function SearchFields({
  searchFolder,
  setSearchFolder,
  searchFileName,
  setSearchFileName,
  searchText,
  setSearchText,
}: SearchFieldsProps) {
  return (
    <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
      <input
        value={searchFolder}
        onChange={(e) => setSearchFolder(e.target.value)}
        placeholder="Folder/path"
        className={inputClass}
      />

      <input
        value={searchFileName}
        onChange={(e) => setSearchFileName(e.target.value)}
        placeholder="File name"
        className={inputClass}
      />

      <input
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder="Text inside files"
        className={inputClass}
      />
    </div>
  );
}

