import { useState, type ReactNode } from "react";
import {
  Bot,
  Clock3,
  Code2,
  FileText,
  FolderOpen,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Send,
  Upload,
  Wand2,
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
  ".txt,.log,.json,.har,.cs,.ts,.tsx,.js,.jsx,.md,.xml,.config,image/*";

const inputClass =
  "rounded-xl border border-slate-300 bg-white px-3 py-3 text-[15px] font-medium text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

const codeInputClass =
  "rounded-xl border border-[#3c3c3c] bg-[#1e1e1e] px-3 py-3 font-mono text-[14px] font-medium leading-6 text-[#d4d4d4] shadow-inner outline-none transition placeholder:text-[#858585] selection:bg-[#264f78] focus:border-[#007acc] focus:ring-4 focus:ring-[#007acc]/20";

const panelClass =
  "rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-200";

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
  const [setupOpen, setSetupOpen] = useState(true);
  const [replyContextOpen, setReplyContextOpen] = useState(false);
  const canSubmitMessage = canSend && !loading && !agentLoading && !timelineLoading;
  const questionLineCount = Math.max(1, question.split(/\r?\n/).length);
  const questionLooksLikeCode =
    /(<\/?[a-z][\s\S]*?>|=>|function\s+\w*|const\s+\w+|let\s+\w+|className=|import\s+.+from|public\s+class|<\/|{\s*$|;\s*$)/m.test(
      question,
    ) || questionLineCount >= 4;
  const composerHeight = Math.min(320, Math.max(hasConversation ? 84 : 96, 36 + questionLineCount * 22));
  const labelUpload = (file: UploadedFile, index: number) =>
    file.isImage ? `Image ${index + 1}: ${file.name}` : `File ${index + 1}: ${file.name}`;

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

  return (
    <>
      {!hasConversation && (
        <div className="min-h-0 flex-1 overflow-y-auto border-b border-slate-200/80 bg-white/50 px-5 pb-8 pt-5 backdrop-blur">
          <div className="mx-auto max-w-[1500px] rounded-2xl bg-white/92 shadow-[0_18px_46px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80">
            <button
              type="button"
              onClick={() => setSetupOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <div>
                <div className="font-bold text-slate-950">Context Workspace</div>
                <div className="mt-1 text-sm text-slate-500">
                  Search, upload, connect a project, or paste logs before asking.
                </div>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {setupOpen ? "Collapse" : "Expand"}
              </span>
            </button>

            {!setupOpen && (
              <div className="border-t border-slate-100 px-5 pb-4">
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  {uploadedFiles.length > 0 && (
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                      Uploads: {uploadedFiles.length}
                    </span>
                  )}
                  {connectedProjectPath && (
                    <span className="rounded-full bg-purple-50 px-3 py-1 text-purple-700">
                      Project: {connectedProjectPath.split("\\").pop()}
                    </span>
                  )}
                  {log.trim() && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">Log included</span>}
                  {code.trim() && <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Code included</span>}
                  {!hasAttachment && <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-500">No context yet</span>}
                </div>
              </div>
            )}

            {setupOpen && (
              <div className="border-t border-slate-100 p-4">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className={panelClass}>
                    <div className="flex items-center gap-2 font-semibold">
                      <Search size={17} className="text-emerald-600" />
                      Search Anywhere on Computer
                    </div>

                    <p className="mt-1 text-sm text-slate-500">
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
                      className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
                    >
                      <Search size={16} />
                      Search Computer
                    </button>
                  </div>

                  <div className={panelClass}>
                    <div className="flex items-center gap-2 font-semibold">
                      <Upload size={17} className="text-blue-600" />
                      Upload Files / Images
                    </div>

                    <p className="mt-1 text-sm text-slate-500">
                      Attach logs, screenshots, configs, or source files.
                    </p>

                    <input
                      type="file"
                      multiple
                      accept={uploadAccept}
                      onChange={(e) => handleUpload(e.target.files)}
                      className="mt-3 block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm shadow-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700"
                    />

                    {uploadedFiles.length > 0 && (
                      <div className="mt-3 text-sm text-slate-700">
                        Attached: {uploadPreview.join(", ")}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-200">
                  <div className="flex items-center gap-2 font-semibold">
                    <FolderOpen size={17} className="text-violet-600" />
                    Project Path
                  </div>

                  <div className="mt-3 flex gap-3">
                    <input
                      value={projectPath}
                      onChange={(e) => setProjectPath(e.target.value)}
                      placeholder="C:\\Users\\mekstein\\source\\repos\\MyProject"
                      className={`${inputClass} w-full`}
                    />

                    <button
                      onClick={connectProjectAndCollapse}
                      disabled={!projectPath.trim()}
                      className="rounded-xl bg-slate-950 px-6 font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
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

      <div className="shrink-0 border-t border-slate-300/80 bg-white/88 px-5 py-1.5 shadow-[0_-18px_52px_rgba(15,23,42,0.14)] backdrop-blur-xl">
        <div className="mx-auto max-w-[1500px]">
          {hasConversation && (
            <>
              <div className="mb-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setReplyContextOpen((open) => !open)}
                  className="inline-flex h-8 items-center gap-2 rounded-full border border-slate-300 bg-white/90 px-3.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <Plus size={14} />
                  Add Context
                </button>

                {replyContextOpen && (
                  <button
                    type="button"
                    onClick={() => setReplyContextOpen(false)}
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500 transition hover:bg-slate-200"
                  >
                    Collapse
                  </button>
                )}
              </div>

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
            {/* Unified container so textarea + buttons look like one connected control */}
            <div className="rounded-2xl bg-white/95 p-2 shadow-[0_14px_42px_rgba(15,23,42,0.16)] ring-1 ring-slate-300/90 transition focus-within:ring-blue-200">
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

                    if (canSubmitMessage) {
                      analyze();
                    }
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
                  className={`w-full resize-none rounded-b-none px-4 py-3 pr-40 text-[15px] font-medium shadow-sm transition focus:ring-4 ${
                    questionLooksLikeCode
                      ? "rounded-t-2xl border border-[#3c3c3c] bg-[#1e1e1e] font-mono leading-6 text-[#d4d4d4] caret-[#569cd6] placeholder:text-[#858585] shadow-inner selection:bg-[#264f78] focus:border-[#007acc] focus:ring-[#007acc]/20"
                      : `${inputClass} rounded-t-2xl`
                  }`}
                  spellCheck={!questionLooksLikeCode}
                  draggable={false}
                />

                <div
                  className={`pointer-events-none absolute bottom-3 right-3 rounded-full px-3 py-1 text-xs font-semibold ${
                    questionLooksLikeCode ? "bg-[#252526] text-[#9cdcfe] shadow-sm ring-1 ring-[#3c3c3c]" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {questionLooksLikeCode ? "Code detected" : "Paste screenshot"}
                </div>
              </div>

              {/* buttons area shares the same parent background and gets the bottom rounded corners */}
              <div className="mt-2 flex flex-nowrap items-center gap-2 overflow-x-auto rounded-b-2xl bg-transparent">
                {!hasConversation && (
                  <button
                    onClick={loadProjectContext}
                    disabled={loading || !connectedProjectPath}
                    className="h-10 rounded-xl bg-violet-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
                  >
                    Use Project Files
                  </button>
                )}

                <button
                  onClick={analyze}
                  disabled={!canSubmitMessage}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"
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
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <X size={16} />
                    Cancel Edit
                  </button>
                )}

                <button
                  onClick={buildTimeline}
                  disabled={loading || timelineLoading || agentLoading || !canBuildTimeline}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
                >
                  {timelineLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Building...
                    </>
                  ) : (
                    <>
                      <Clock3 size={16} />
                      Trace Timeline
                    </>
                  )}
                </button>

                <button
                  onClick={runAgent}
                  disabled={loading || timelineLoading || agentLoading || !canSend}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
                >
                  {agentLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Agent...
                    </>
                  ) : (
                    <>
                      <Bot size={16} />
                      Run Agent
                    </>
                  )}
                </button>

                <button
                  onClick={openColorTool}
                  disabled={loading || agentLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
                >
                  <Wand2 size={16} />
                  Color Tool
                </button>
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
