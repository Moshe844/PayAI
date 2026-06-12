
import { memo, useState, type CSSProperties, type RefObject } from "react";

import {
  ChevronDown,
  ChevronUp,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Play,
  Sparkles,
  X,
} from "lucide-react";

import Image from "next/image";

import type { Components } from "react-markdown";

import ReactMarkdown from "react-markdown";

import {
  Prism as SyntaxHighlighter,
} from "react-syntax-highlighter";

import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

import remarkGfm from "remark-gfm";

import { extractFirstUrl } from "../lib/payfixHelpers";

import type {
  ChatMessage,
  UploadedFile,
} from "../lib/payfixTypes";

type FileReference = {
  key: string;
  label: string;
  file: string;
  line: string;
};

type ChatMessagesProps = {
  messages: ChatMessage[];

  copiedKey: string | null;

  setCopiedKey: (
    key: string | null
  ) => void;

  openRunnerFromCode: (
    codeString: string,
    language: string
  ) => void;

  openApplyModalWithContent: (
    content: string,
    fullMessage: string
  ) => void;

  projectPath: string;

  computerSearchResults: string;

  uploadedFiles: UploadedFile[];

  log: string;

  code: string;

  chatEndRef: RefObject<HTMLDivElement | null>;

  onOpenCodeLog: (
    payload: {
      log: string;
      code: string;
    }
  ) => void;

  onEditMessage: (
    messageIndex: number
  ) => void;

  onOpenAttachmentPreview: () => void;

  onOpenProjectPreview: () => void;

  onOpenFileReference: (
    reference: {
      file: string;
      line: number;
    }
  ) => void;

  onOpenAgentSession: (
    messages: ChatMessage[]
  ) => void;
};

function extractFileReferences(content: string) {
  const references = new Map<string, FileReference>();
  const pattern =
    /((?:[A-Za-z]:[\\/][^\n\r:]+?|(?:app|src|pages|components|lib|payfix-agent|agent-test-project|public|styles)[/\\][\w .\\/()-]+?|[\w .()-]+)\.(?:tsx?|jsx?|css|scss|json|html|md|xml|cs|php|py|java|txt|log)):(\d+)\b/g;

  for (const match of content.matchAll(pattern)) {
    const file = match[1];
    const line = match[2];
    const key = `${file}:${line}`;
    references.set(key, {
      key,
      label: `${file.split(/[\\/]/).pop()}:${line}`,
      file,
      line,
    });
  }

  return Array.from(references.values()).slice(0, 8);
}

function extractAgentRunStats(content: string) {
  if (!content.includes("AGENT RUN COMPLETE") && !content.includes("AGENT INVESTIGATION COMPLETE") && !content.includes("PATCH VALIDATION")) return null;

  const inspected = content.match(/FILES INSPECTED\s+([\s\S]*?)(?:\n\n[A-Z ]+\n|$)/)?.[1] || "";
  const evidence = content.match(/GROUNDING EVIDENCE\s+([\s\S]*?)(?:\n\n[A-Z ]+\n|$)/)?.[1] || "";
  const validation = content.match(/PROJECT VALIDATION\s+([\s\S]*?)(?:\n\n[A-Z ]+\n|$)/)?.[1] || "";
  const dependency = content.match(/DEPENDENCY PROPOSAL\s+([\s\S]*?)(?:\n\n[A-Z ]+\n|$)/)?.[1] || "";
  const rootCause = content.match(/ROOT CAUSE\s+([\s\S]*?)(?:\n\n[A-Z ]+\n|$)/)?.[1] || "";
  const patchConfidence = content.match(/PATCH CONFIDENCE\s+([\s\S]*?)(?:\n\n[A-Z ]+\n|$)/)?.[1] || "";
  const confidenceValues = [rootCause, patchConfidence]
    .map((section) => Number(section.match(/Confidence:\s*(\d+)%/i)?.[1] || 0))
    .filter((value) => value > 0);
  const trustScore = confidenceValues.length ? Math.round(confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length) : 0;
  const patchReady = /Patch preview is ready|PATCH APPLIED|Apply modal/i.test(content);
  const validationFailed = /\bFAIL\b|failed|blocked/i.test(validation);
  const runnerBlocked = /spawn EINVAL|command failed to start|runner issue/i.test(content);
  const evidenceOnly = /Evidence-only mode|evidence-only investigation/i.test(content);

  return {
    mode: evidenceOnly ? "Evidence-only" : "Project agent",
    inspectedCount: (inspected.match(/^- /gm) || []).length,
    evidenceCount: (evidence.match(/^- /gm) || []).length,
    trustScore,
    patchReady,
    validationFailed,
    runnerBlocked,
    dependencyNeeded: !/No dependency install proposed/i.test(dependency) && dependency.trim().length > 0,
  };
}

function isActivityMessage(content: string) {
  return /^(Thinking|Converting image|Agent is running|PayFix Agent is investigating|Analyzing|Building timeline|Searching project|Reading files|Generating patch)/i.test(
    content.trim(),
  );
}

function responseTone(content: string) {
  if (/PATCH APPLIED|success|COMPLETE|validated|approved/i.test(content)) {
    return "success";
  }

  if (/failed|error|blocked|could not|No automatic patch|Validation failed/i.test(content)) {
    return "warning";
  }

  return "neutral";
}

function isLongMessage(content: string) {
  return content.length > 1800 || content.split(/\r?\n/).length > 22;
}

function previewMessage(content: string) {
  const lines = content.split(/\r?\n/);
  const previewLines = lines.slice(0, 22).join("\n");
  const previewText = previewLines.length > 2200 ? `${previewLines.slice(0, 2200)}...` : previewLines;

  return `${previewText}\n\n...`;
}

function compactContextPreview(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  const preview = lines.slice(0, 12).join("\n");
  return preview.length > 1600 ? `${preview.slice(0, 1600)}...` : preview;
}

function codeLanguageFromContent(value: string) {
  if (/#import|NSString|NSInteger|BOOL|@interface|@implementation|\[[A-Za-z]/.test(value)) return "objectivec";
  if (/import\s+React|className=|<\/?[A-Za-z]/.test(value)) return "tsx";
  if (/using\s+System|public\s+class|namespace\s+/.test(value)) return "csharp";
  if (/function\s+\w*|const\s+\w+|let\s+\w+|=>/.test(value)) return "typescript";
  if (/^\s*(SELECT|UPDATE|INSERT|DELETE)\b/im.test(value)) return "sql";
  if (/^\s*[{[]/.test(value.trim())) return "json";
  return "text";
}

function ChatMessages({
  messages,
  copiedKey,
  setCopiedKey,
  openRunnerFromCode,
  openApplyModalWithContent,
  projectPath,
  computerSearchResults,
  uploadedFiles,
  log,
  code,
  chatEndRef,
  onOpenCodeLog,
  onEditMessage,
  onOpenAttachmentPreview,
  onOpenProjectPreview,
  onOpenFileReference,
  onOpenAgentSession,
}: ChatMessagesProps) {
  const [previewImage, setPreviewImage] = useState<UploadedFile | null>(null);
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const [expandedContexts, setExpandedContexts] = useState<Set<string>>(new Set());
  const [expandedCodeBlocks, setExpandedCodeBlocks] = useState<Set<string>>(new Set());
  const [showAllMessages, setShowAllMessages] = useState(false);
  const hiddenMessageCount = showAllMessages ? 0 : Math.max(0, messages.length - 12);
  const visibleMessages = hiddenMessageCount ? messages.slice(hiddenMessageCount) : messages;

  function openUploadedFile(file: UploadedFile) {
    if (file.isImage) {
      setPreviewImage(file);
      return;
    }

    setPreviewFile(file);
  }

  return (
    <>
      <div className="allow-scroll min-h-0 flex-1 bg-[linear-gradient(180deg,#edf4fb_0%,#e7eef6_100%)] px-5 py-2.5">
        <div className="mx-auto max-w-[1200px] space-y-2">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-dashed border-blue-200 bg-white/80 p-8 text-center text-slate-500 shadow-sm">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <FileText size={22} />
              </div>

              <div className="text-base font-semibold text-slate-800">
                Ready for context
              </div>

              <div className="mt-1 text-sm">
                Attach files/search results or ask a question to begin.
              </div>
            </div>
          )}

          {hiddenMessageCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllMessages(true)}
              className="mx-auto flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            >
              <ChevronDown size={14} />
              Show {hiddenMessageCount} older message(s)
            </button>
          )}

          {visibleMessages.map((message, visibleMessageIndex) => {
            const messageIndex = hiddenMessageCount + visibleMessageIndex;
            const agentStats = message.role === "assistant" ? extractAgentRunStats(message.content) : null;
            const activityMessage = message.role === "assistant" && isActivityMessage(message.content);
            const tone = message.role === "assistant" ? responseTone(message.content) : "neutral";
            const longMessage = !activityMessage && isLongMessage(message.content);
            const isExpanded = expandedMessages.has(messageIndex);
            const renderedContent = longMessage && !isExpanded ? previewMessage(message.content) : message.content;
            const markdownComponents: Components = {
              p: ({ children }) => (
                <div className="mb-2.5 last:mb-0">
                  {children}
                </div>
              ),

              h1: ({ children }) => (
                <div className="mb-3 mt-4 border-b border-slate-200 pb-2 text-lg font-black tracking-tight text-slate-950 first:mt-0">
                  {children}
                </div>
              ),

              h2: ({ children }) => (
                <div className="mb-2 mt-4 rounded-xl bg-slate-100 px-3 py-2 text-sm font-black uppercase tracking-wide text-slate-800 first:mt-0">
                  {children}
                </div>
              ),

              h3: ({ children }) => (
                <div className="mb-2 mt-3 text-sm font-black uppercase tracking-wide text-slate-700 first:mt-0">
                  {children}
                </div>
              ),

              hr: () => (
                <div className="my-4 border-t border-slate-200" />
              ),

              ul: ({ children }) => (
                <ul className="my-2 space-y-1.5 rounded-xl bg-slate-50/80 px-5 py-3">
                  {children}
                </ul>
              ),

              li: ({ children }) => (
                <li className="pl-1">
                  {children}
                </li>
              ),

              pre: ({ children }) => (
                <>{children}</>
              ),

              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-blue-600 underline"
                >
                  {children}
                </a>
              ),

              code({
                className,
                children,
              }) {
              const match =
                /language-(\w+)/.exec(
                  className || ""
                );

              const language =
                match?.[1] || "text";

              const codeString =
                String(children).replace(
                  /\n$/,
                  ""
                );

              const copyKey = `${messageIndex}-${language}-${codeString.length}`;

              // MULTILINE CODE BLOCK
              if (className) {
                const codeIsLarge = codeString.length > 12000 || codeString.split(/\r?\n/).length > 240;
                const codeBlockKey = `${messageIndex}-${language}-${codeString.length}`;
                const codeExpanded = expandedCodeBlocks.has(codeBlockKey);

                return (
                  <div className="group relative overflow-hidden rounded-2xl border border-[#3c3c3c] bg-[#1e1e1e] shadow-lg shadow-slate-950/15">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3c3c3c] bg-[#252526] px-4 py-2.5">
                      <div>
                        <div className="text-xs font-black uppercase tracking-wide text-[#9cdcfe]">
                          {language}
                        </div>
                        <div className="mt-0.5 text-[11px] font-semibold text-slate-400">
                          {codeString.split(/\r?\n/).length} lines
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(
                              codeString
                            );

                            setCopiedKey(
                              copyKey
                            );

                            setTimeout(() => {
                              setCopiedKey(
                                null
                              );
                            }, 2000);
                          }}
                          className="flex h-8 items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 text-xs font-bold text-white transition hover:bg-slate-700"
                        >
                          {copiedKey ===
                          copyKey ? (
                            <>
                              <Check size={14} />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy size={14} />
                              Copy
                            </>
                          )}
                        </button>

                        <button
                          onClick={() =>
                            openRunnerFromCode(
                              codeString,
                              language
                            )
                          }
                          className="flex h-8 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-500"
                        >
                          <Play size={14} />
                          Run
                        </button>

                        <button
                          onClick={() =>
                            openApplyModalWithContent(
                              codeString,
                              message.content
                            )
                          }
                          className="flex h-8 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-blue-500"
                        >
                          <FileText size={14} />
                          Apply
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setExpandedCodeBlocks((current) => {
                              const next = new Set(current);
                              if (next.has(codeBlockKey)) {
                                next.delete(codeBlockKey);
                              } else {
                                next.add(codeBlockKey);
                              }
                              return next;
                            });
                          }}
                          className="flex h-8 items-center gap-2 rounded-lg border border-slate-600 bg-[#1e1e1e] px-3 text-xs font-bold text-slate-100 transition hover:bg-slate-800"
                        >
                          {codeExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                          {codeExpanded ? "Collapse" : "Expand"}
                        </button>
                      </div>
                    </div>

                    {codeIsLarge ? (
                      <pre
                        className={`overflow-auto whitespace-pre-wrap break-words bg-[#1e1e1e] p-5 font-mono text-[14px] leading-6 text-[#d4d4d4] ${
                          codeExpanded ? "max-h-[78vh]" : "max-h-[520px]"
                        }`}
                      >
                        {codeString}
                      </pre>
                    ) : (
                      <SyntaxHighlighter
                        style={
                          vscDarkPlus as Record<
                            string,
                            CSSProperties
                          >
                        }
                        language={
                          language ===
                          "text"
                            ? "javascript"
                            : language
                        }
                        PreTag="div"
                        customStyle={{
                          margin: 0,
                          borderRadius: 0,
                          padding: "20px",
                          background: "#1e1e1e",
                          fontSize: "14px",
                          lineHeight: 1.65,
                          maxHeight: codeExpanded ? "78vh" : "520px",
                          overflow: "auto",
                        }}
                        codeTagProps={{
                          style: {
                            fontFamily:
                              "Consolas, 'Cascadia Code', 'Courier New', monospace",
                          },
                        }}
                      >
                        {codeString}
                      </SyntaxHighlighter>
                    )}
                  </div>
                );
              }

              // INLINE CODE
              return (
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.9em] text-pink-600">
                  {children}
                </code>
              );
              },
            };

          return (
            <div
              key={messageIndex}
              className={`rounded-2xl p-3.5 leading-6 shadow-sm ring-1 transition ${
                message.role ===
                "user"
                  ? "bg-blue-50/95 text-blue-950 shadow-blue-100/60 ring-blue-200"
                  : tone === "success"
                  ? "bg-white/95 text-slate-900 ring-emerald-200"
                  : tone === "warning"
                  ? "bg-white/95 text-slate-900 ring-amber-200"
                  : "bg-white/95 text-slate-900 ring-slate-200"
              }`}
            >
              {/* HEADER */}
              <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                <span className="inline-flex items-center gap-2">
                  {message.role === "assistant" && (
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full ${
                        activityMessage
                          ? "bg-blue-50 text-blue-600"
                          : tone === "success"
                          ? "bg-emerald-50 text-emerald-600"
                          : tone === "warning"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {activityMessage ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    </span>
                  )}
                  {message.role ===
                  "user"
                    ? "You"
                    : "PayFix AI"}
                </span>

                {message.role === "user" ? (
                  <button
                    type="button"
                    onClick={() => onEditMessage(messageIndex)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-blue-200 bg-white px-2.5 text-xs font-semibold normal-case tracking-normal text-blue-700 transition hover:bg-blue-50"
                  >
                    <Pencil size={13} />
                    Edit
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(message.content);
                      setCopiedKey(`${messageIndex}-response`);
                      setTimeout(() => setCopiedKey(null), 2000);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 text-xs font-semibold normal-case tracking-normal text-slate-700 transition hover:bg-slate-50"
                    title="Copy full AI response"
                  >
                    {copiedKey === `${messageIndex}-response` ? <Check size={13} /> : <Copy size={13} />}
                    {copiedKey === `${messageIndex}-response` ? "Copied" : "Copy Response"}
                  </button>
                )}
              </div>

              {activityMessage && (
                <div className="mb-3 rounded-2xl border border-blue-100 bg-blue-50/75 p-4">
                  <div className="flex items-center gap-3 text-sm font-semibold text-blue-900">
                    <Loader2 size={17} className="animate-spin" />
                    {message.content}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100">
                    <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-500" />
                  </div>
                </div>
              )}

              {agentStats && !activityMessage && (
                <div className="mb-3 flex flex-wrap gap-1.5 rounded-2xl bg-slate-50/90 p-2 ring-1 ring-slate-200">
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-100">
                    {agentStats.mode}
                  </span>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 ring-1 ring-blue-100">
                    {agentStats.inspectedCount} file(s)
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 ring-1 ring-indigo-100">
                    {agentStats.evidenceCount} evidence line(s)
                  </span>
                  {agentStats.trustScore > 0 && (
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
                        agentStats.trustScore >= 85
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                          : agentStats.trustScore >= 70
                            ? "bg-amber-50 text-amber-700 ring-amber-100"
                            : "bg-rose-50 text-rose-700 ring-rose-100"
                      }`}
                    >
                      Trust {agentStats.trustScore}%
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
                      agentStats.patchReady ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {agentStats.patchReady ? "Patch ready" : "No patch"}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      agentStats.runnerBlocked
                        ? "bg-amber-50 text-amber-700"
                        : agentStats.validationFailed
                          ? "bg-rose-50 text-rose-700"
                          : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {agentStats.runnerBlocked
                      ? "Runner blocked"
                      : agentStats.validationFailed
                        ? "Validation failed"
                        : "Validation clean/skipped"}
                  </span>
                  {agentStats.dependencyNeeded && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                      Dependency check
                    </span>
                  )}
                </div>
              )}

              {/* CONTENT */}
              <div className="prose prose-slate max-w-none text-[14px] leading-6 prose-pre:p-0 prose-table:text-sm">
                <div
                  className={`relative ${
                    longMessage && !isExpanded
                      ? "max-h-[420px] overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-24 after:bg-gradient-to-t after:from-white after:to-transparent"
                      : ""
                  }`}
                >
                  {!activityMessage && (
                    <ReactMarkdown
                      remarkPlugins={[
                        remarkGfm,
                      ]}
                      components={
                        markdownComponents
                      }
                    >
                      {renderedContent}
                    </ReactMarkdown>
                  )}

                {message.role === "assistant" &&
                extractFileReferences(renderedContent).length ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
                    {extractFileReferences(renderedContent).map((reference) => (
                      <button
                        key={reference.key}
                        type="button"
                        onClick={() =>
                          onOpenFileReference({
                            file: reference.file,
                            line: Number(reference.line),
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 no-underline transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                        title={`Open project preview near ${reference.file}:${reference.line}`}
                      >
                        <FileText size={13} />
                        {reference.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {message.generatedFiles?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {message.generatedFiles.map((file, fileIndex) => (
                      <a
                        key={`${file.name}-${fileIndex}`}
                        href={file.content}
                        download={file.name}
                        className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 no-underline transition hover:bg-emerald-100"
                      >
                        <Download size={14} />
                        <span className="max-w-[220px] truncate">{file.name}</span>
                        <span className="rounded-full bg-white/80 px-2 py-0.5 text-emerald-900">
                          {Math.max(1, Math.round(file.size / 1024))} KB
                        </span>
                      </a>
                    ))}
                  </div>
                ) : null}

                {/* USER ATTACHMENT CHIPS */}
                {message.role ===
                  "user" && (
                  <>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onOpenProjectPreview}
                        disabled={!projectPath}
                        className="rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-bold text-purple-700 transition hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-purple-50"
                        title={projectPath ? "Open connected project files" : "No project connected"}
                      >
                        Project:{" "}
                        {projectPath
                          ? "Connected"
                          : "Not connected"}
                      </button>

                      <button
                        type="button"
                        onClick={onOpenAttachmentPreview}
                        disabled={!computerSearchResults}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-emerald-50"
                        title={computerSearchResults ? "Open search results" : "No search attached"}
                      >
                        Search:{" "}
                        {computerSearchResults
                          ? "Attached"
                          : "None"}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const messageUploads = message.attachedUploads || [];
                          const firstUpload = (messageUploads.length ? messageUploads : uploadedFiles)[0];
                          if (firstUpload) {
                            openUploadedFile(firstUpload);
                          }
                        }}
                        disabled={!(message.attachedUploads?.length || uploadedFiles.length)}
                        className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-blue-50"
                        title="Open attached upload"
                      >
                        Uploads:{" "}
                        {message.attachedUploads?.length ?? uploadedFiles.length}
                      </button>

                    {(message.attachedUploads || [])
                      .map((file, uploadIndex) => (
                        <button
                          key={`${file.name}-${uploadIndex}`}
                          type="button"
                          onClick={() => openUploadedFile(file)}
                          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-blue-200 bg-white px-2 text-[11px] font-bold text-blue-700 transition hover:bg-blue-50"
                        >
                          {file.isImage ? (
                            <Image
                              src={file.content}
                              alt={file.name}
                              width={24}
                              height={18}
                              unoptimized
                              className="h-5 w-7 rounded object-cover"
                            />
                          ) : (
                            <FileText size={13} />
                          )}
                          <span className="max-w-[180px] truncate">
                            {file.isImage ? "Image" : "File"} {uploadIndex + 1}: {file.name}
                          </span>
                        </button>
                      ))}

                      {message.attachedLog ||
                      message.attachedCode ? (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenCodeLog(
                              {
                                log:
                                  message.attachedLog ||
                                  "",
                                code:
                                  message.attachedCode ||
                                  "",
                              }
                            )
                          }
                          className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 underline-offset-2 transition hover:bg-slate-100 hover:underline"
                        >
                          Code/Log:
                          Included
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 opacity-70"
                        >
                          Code/Log:{" "}
                          {log || code
                            ? "Included"
                            : "None"}
                        </button>
                      )}
                    </div>

                    {(message.attachedLog || message.attachedCode) && (
                      <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                        {[
                          { key: "log", label: "Attached log", value: message.attachedLog || "" },
                          { key: "code", label: "Attached code", value: message.attachedCode || "" },
                        ]
                          .filter((item) => item.value.trim())
                          .map((item) => {
                            const contextKey = `${messageIndex}-${item.key}`;
                            const expanded = expandedContexts.has(contextKey);
                            const lineCount = item.value.trim().split(/\r?\n/).length;

                            return (
                              <div
                                key={item.key}
                                className="overflow-hidden rounded-2xl bg-[#1e1e1e] text-[#d4d4d4] shadow-sm ring-1 ring-[#3c3c3c]"
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
                                {item.key === "code" ? (
                                  <SyntaxHighlighter
                                    style={vscDarkPlus as Record<string, CSSProperties>}
                                    language={codeLanguageFromContent(item.value)}
                                    PreTag="div"
                                    wrapLongLines
                                    customStyle={{
                                      margin: 0,
                                      maxHeight: expanded ? "520px" : "160px",
                                      overflow: expanded ? "auto" : "hidden",
                                      padding: "14px",
                                      background: "#1e1e1e",
                                      fontSize: "13px",
                                      lineHeight: 1.65,
                                    }}
                                    codeTagProps={{
                                      style: {
                                        fontFamily:
                                          "Consolas, 'Cascadia Code', 'Courier New', monospace",
                                      },
                                    }}
                                  >
                                    {expanded ? item.value.trim() : compactContextPreview(item.value)}
                                  </SyntaxHighlighter>
                                ) : (
                                  <pre
                                    className={`overscroll-contain whitespace-pre-wrap break-words bg-[#1e1e1e] p-3 text-xs leading-5 text-[#d4d4d4] ${
                                      expanded ? "max-h-[520px] overflow-auto" : "max-h-40 overflow-hidden"
                                    }`}
                                  >
                                    {expanded ? item.value.trim() : compactContextPreview(item.value)}
                                  </pre>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </>
                )}

                {message.role === "assistant" && message.isAgentSessionSummary && message.agentSessionMessages?.length ? (
                  <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-black text-indigo-950">
                          <Sparkles size={16} className="text-indigo-600" />
                          PayFix investigation saved
                        </div>
                        <div className="mt-1 text-xs font-semibold text-indigo-700">
                          {message.agentSessionMessages.length} investigation message(s) saved with its evidence trail.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenAgentSession(message.agentSessionMessages || [])}
                        className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-indigo-500"
                      >
                        Reopen Investigation
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* OPEN LINK BUTTON */}
                {message.role ===
                  "assistant" &&
                  extractFirstUrl(
                    message.content
                  ) && (
                    <a
                      href={extractFirstUrl(
                        message.content
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-700"
                    >
                      Open Link
                    </a>
                  )}
                </div>

                {longMessage && (
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedMessages((current) => {
                        const next = new Set(current);
                        if (next.has(messageIndex)) {
                          next.delete(messageIndex);
                        } else {
                          next.add(messageIndex);
                        }
                        return next;
                      });
                    }}
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {isExpanded ? "Collapse response" : "Show full response"}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                      {message.content.split(/\r?\n/).length} lines
                    </span>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div ref={chatEndRef} />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-6">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-950">{previewFile.name}</div>
                <div className="text-sm text-slate-500">
                  {previewFile.type || "text/plain"} - {Math.round(previewFile.size / 1024)} KB
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                title="Close preview"
              >
                <X size={18} />
              </button>
            </div>

            <pre className="min-h-0 flex-1 overflow-auto bg-slate-950 p-5 text-sm leading-6 text-emerald-100">
              {previewFile.content}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

export default memo(ChatMessages, (prev, next) => {
  return (
    prev.messages === next.messages &&
    prev.copiedKey === next.copiedKey &&
    prev.projectPath === next.projectPath &&
    prev.computerSearchResults === next.computerSearchResults &&
    prev.uploadedFiles === next.uploadedFiles &&
    prev.log === next.log &&
    prev.code === next.code
  );
});
