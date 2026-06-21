
import { memo, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

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
  RotateCcw,
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
  GeneratedFile,
  ChatMessage,
  UploadedFile,
} from "../lib/payfixTypes";

type FileReference = {
  key: string;
  label: string;
  file: string;
  line?: string;
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

  rollbackTarget?: {
    file: string;
    relative: string;
  } | null;

  rollbackLoading?: boolean;

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
    messages: ChatMessage[],
    summary?: ChatMessage
  ) => void;

  onStartAgentPrompt?: (
    prompt: string
  ) => void;

  onCreateCodeFromGeneratedFile?: (
    file: GeneratedFile,
    sourceMessage: string
  ) => void;

  onRollbackLastApply?: () => void;
};

function extractFileReferences(content: string) {
  const references = new Map<string, FileReference>();
  const pattern =
    /((?:[A-Za-z]:[\\/][^\n\r:]+?|(?:app|src|pages|components|lib|payfix-agent|agent-test-project|public|styles)[/\\][\w .\\/()-]+?|[\w .()-]+)\.(?:tsx?|jsx?|css|scss|json|html|md|xml|cs|php|py|java|txt|log)):(\d+)\b/g;

  for (const match of content.matchAll(pattern)) {
    const file = match[1];
    const line = match[2];
    const uploadedMatch = file.match(/^uploaded-file[-_](.+)$/i);
    const key = uploadedMatch ? file.toLowerCase() : `${file}:${line}`;
    const labelName = uploadedMatch?.[1] || file.split(/[\\/]/).pop() || file;
    references.set(key, {
      key,
      label: uploadedMatch ? labelName : `${labelName}:${line}`,
      file,
      line: uploadedMatch ? undefined : line,
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

function normalizeOrderedStepMarkers(content: string) {
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let step = 0;
  let changed = false;

  const normalized = lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line;
    }

    if (inFence) return line;

    const match = line.match(/^(\s{0,3})(\d+)\.\s+(.+)$/);
    if (!match) return line;

    step += 1;
    if (Number(match[2]) !== step) changed = true;
    return `${match[1]}${step}. ${match[3]}`;
  });

  return changed ? normalized.join("\n") : content;
}

function isGeneratedImageFile(file: GeneratedFile) {
  return Boolean(file.content?.trim()) && (file.type.startsWith("image/") || /^data:image\//i.test(file.content) || /\.svg$/i.test(file.name));
}

function hasRenderableImageContent(file: { content?: string; isImage?: boolean; type?: string; name?: string }) {
  const content = file.content?.trim() || "";
  if (!content) return false;
  return Boolean(file.isImage || file.type?.startsWith("image/") || /^data:image\//i.test(content) || /\.svg$/i.test(file.name || ""));
}

function generatedFilesFromSvgCode(content: string): GeneratedFile[] {
  const explicitName = content.match(/Filename:\s*([^\s`"'<>]+\.svg)/i)?.[1] || "generated-logo.svg";
  const files: GeneratedFile[] = [];

  for (const match of content.matchAll(/```(?:svg|xml)?\s*(<svg[\s\S]*?<\/svg>)\s*```/gi)) {
    const svg = match[1].trim();
    files.push({
      name: files.length ? explicitName.replace(/\.svg$/i, `-${files.length + 1}.svg`) : explicitName,
      type: "image/svg+xml",
      size: new Blob([svg]).size,
      content: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    });
  }

  if (!files.length) {
    const inline = content.match(/(<svg[\s\S]*?<\/svg>)/i)?.[1]?.trim();
    if (inline) {
      files.push({
        name: explicitName,
        type: "image/svg+xml",
        size: new Blob([inline]).size,
        content: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(inline)}`,
      });
    }
  }

  return files.slice(0, 4);
}

function stripVisibleSvgSource(content: string) {
  return content
    .replace(/```(?:svg|xml)?\s*<svg[\s\S]*?<\/svg>\s*```/gi, "\n\nSVG source hidden. Use the preview/download card below.\n\n")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "\n\nSVG source hidden. Use the preview/download card below.\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNoiseUrl(href?: string) {
  const clean = (href || "").trim().replace(/["')>]+$/g, "");
  return !clean || /^https?:\/\/www\.w3\.org\/2000\/svg$/i.test(clean);
}

function messageActionPrompts(content: string) {
  const actions: Array<{ label: string; prompt: string }> = [];
  const hasBuiltPaxAndroidApp = /PAX ANDROID APP BUILT|PayFix created\/updated the connected Android project/i.test(content);
  const hasValidationFailure =
    /Sandbox checks found failures|SANDBOX CHECKS[\s\S]*\bFAIL\b|PROJECT VALIDATION[\s\S]*\bFAIL\b|VALIDATION[\s\S]*\bFAIL\b|Build failed with an exception|Plugin \[id:/i.test(
      content,
    );
  const isActionDiscoveryResponse =
    /\b(what should i do|how do i fix|what are my options|what can be run|how can this be automated|next actions?|do next|recommended next)\b/i.test(
      content,
    ) ||
    /\b(run analysis|search project|fix automatically|generate patch|run build|execute tests|trace issue)\b/i.test(content);
  const isLargeProjectWork =
    /\b(refactor|feature implementation|implement feature|multi-file|multiple files|long-running|large change|full app|full project|generated project|from scratch|dependency install|build loop|debug loop|migration|rewrite|codebase-wide)\b/i.test(
      content,
    );
  const isSketchOrVisualPlan =
    /\b(sketch|wireframe|mockup|prototype|ui concept|diagram|flowchart|app map|site map|sitemap|screen map|user flow|ux flow|dashboard design|visual plan)\b/i.test(
      content,
    );
  const isSpreadsheetContext =
    /\b(excel|spreadsheet|workbook|worksheet|xlsx|xls|csv|formula|formulas|macro|macros|vba|pivot|named range|#REF!|#VALUE!|#N\/A|cell|sheet)\b/i.test(
      content,
    );

  if (
    !hasBuiltPaxAndroidApp &&
    /Here is the exact path I would take|Android Studio|app\/src\/main|AndroidManifest|build\.gradle|Official downloads\/docs|PAX|BroadPOS|PosLink|CardPointe/i.test(
      content,
    ) &&
    /\b(build|implementation|POS|Android|MainActivity|token|SDK|project)\b/i.test(content)
  ) {
    actions.push({
      label: "Build full app with Agent",
      prompt:
        "Create the full runnable project from the previous build guide. If no project is connected, ask me for the target parent path, folder name, app stack/language, and any vendor SDK files or portal downloads I have access to. Then create the folder/files, add the required dependencies/placeholders, wire the Android app structure, include README setup steps, and run validation/build checks where possible.",
    });
    actions.push({
      label: "Prepare project checklist",
      prompt:
        "Turn the previous build guide into an Agent-ready implementation checklist: exact files to create, dependencies to install, vendor SDK artifacts needed, secrets/config values needed, and validation commands.",
    });
  }

  if (hasBuiltPaxAndroidApp) {
    if (hasValidationFailure) {
      actions.push({
        label: "Fix build failure",
        prompt:
          "Continue this saved Agent investigation and fix the current build failure. Use the latest Gradle/IDE validation output, inspect the exact affected files, prepare a safe patch, and rerun validation.",
      });
    }
    actions.push({
      label: "Exact next steps",
      prompt:
        "Continue this saved Agent investigation and tell me exactly what to do next in my IDE. Include exact menu clicks, files to open, commands to run, expected result, and what error to send back if it fails.",
    });
    actions.push({
      label: "Check for more errors",
      prompt:
        "Continue this saved Agent investigation, run project validation, check for remaining build/dependency/source errors, and prepare the next safe patch if one is proven.",
    });
    return actions;
  }

  if (hasValidationFailure) {
    const failedCommand =
      content.match(/FAIL\s+([^\n]+)/i)?.[1]?.trim() ||
      content.match(/failures(?: in)? ([^:\n]+)/i)?.[1]?.trim() ||
      "the failing validation command";

    actions.push({
      label: /build/i.test(failedCommand) ? "Fix build failure" : "Fix validation failure",
      prompt: `Investigate and fix ${failedCommand}. Use the failure output from the previous message, inspect exact files, prepare a safe patch if needed, and run validation again.`,
    });
    actions.push({
      label: "Explain failure",
      prompt: `Explain why ${failedCommand} failed, whether it is related to the latest change, and what exact files need attention.`,
    });
  }

  if (/Dependency installed/i.test(content)) {
    actions.push({
      label: "Run validation",
      prompt:
        "Run the right validation checks after the dependency install. If anything fails, summarize the exact failure and prepare a fix.",
    });
  }

  if (/Missing package|Missing packages|Cannot find module|ModuleNotFoundError|unresolved crate|no required module provides package/i.test(content)) {
    actions.push({
      label: "Fix dependencies",
      prompt:
        "Inspect project imports and package metadata, detect all missing dependencies for this project, offer the safe install action, then run validation.",
    });
  }

  if (/Dependency install failed/i.test(content)) {
    actions.push({
      label: "Fix install failure",
      prompt:
        "Investigate the dependency install failure, inspect package metadata and imports, then propose the correct install or project metadata fix.",
    });
  }

  if (/Local agent is not reachable|running payfix-agent may be old|missing this endpoint|Connection error/i.test(content)) {
    actions.push({
      label: "Diagnose local agent",
      prompt:
        "Diagnose why the local PayFix agent is unreachable or outdated. Check the expected endpoints, connected project, and exact restart steps.",
    });
  }

  if (isActionDiscoveryResponse) {
    if (/\b(error|failure|failed|exception|stack trace|traceback|root cause|debug|issue)\b/i.test(content)) {
      actions.push({
        label: "Run analysis",
        prompt:
          "Run a focused Agent analysis for the current issue. Use the latest request, attachments, connected project, and prior context. Identify the first concrete blocker and next safe action.",
      });
    }
    if (/\b(project|repo|repository|codebase|file|files|source|component|class|function|dependency|SDK|artifact)\b/i.test(content)) {
      actions.push({
        label: "Search project",
        prompt:
          "Search the connected project for the exact files, symbols, configs, and dependency references related to the current issue. Report exact matches before proposing a patch.",
      });
    }
    if (/\b(fix|patch|change|update|modify|repair|safe patch|source change|config change)\b/i.test(content)) {
      actions.push({
        label: "Generate patch",
        prompt:
          "Generate a safe patch preview for the current issue. Inspect exact files first, avoid unrelated changes, show changed lines, and run validation if applied.",
      });
    }
    if (/\b(build|compile|gradle|maven|npm|pnpm|yarn|dotnet|cargo|pytest|validation|test|tests|lint|typecheck)\b/i.test(content)) {
      actions.push({
        label: /\b(test|tests)\b/i.test(content) && !/\bbuild|compile|gradle|maven\b/i.test(content) ? "Execute tests" : "Run build",
        prompt:
          "Run the right build/test/validation checks for the connected project. Show exact commands, exit status, important output, and the next concrete blocker or success state.",
      });
    }
    if (/\b(trace|timeline|flow|request path|payment|transaction|emv|tlv|gateway|network|sequence)\b/i.test(content)) {
      actions.push({
        label: "Trace issue",
        prompt:
          "Trace the current issue end to end. Build a concise timeline from available evidence, identify the first proven divergence, and recommend the next action.",
      });
    }
    if (isSpreadsheetContext) {
      actions.push({
        label: "Analyze workbook",
        prompt:
          "Analyze the attached spreadsheet/workbook. Inspect sheets, formulas, broken references, named ranges, pivots, macros/VBA if present, and explain the concrete issue before asking for more information.",
      });
    }
  }

  if (isLargeProjectWork) {
    actions.push({
      label: "Open Agent session",
      prompt:
        "Open a dedicated Agent session for this larger project task. Keep context isolated, inspect the connected project, track steps clearly, prepare safe changes, and validate before reporting completion.",
    });
  }

  if (isSketchOrVisualPlan) {
    actions.push(
      {
        label: "Make modern",
        prompt:
          "Revise the latest sketch/design to feel more modern and production-ready. Preserve the product concept while improving hierarchy, spacing, and polish.",
      },
      {
        label: "Improve UX",
        prompt:
          "Improve the latest sketch/design for UX clarity. Preserve the concept, make the workflow clearer, reduce clutter, and explain the key changes.",
      },
      {
        label: "Create code",
        prompt:
          "Create a runnable app/project from the latest generated sketch/design. Ask for or use target parent path, folder name, stack, and assets, then create files and validation steps.",
      },
    );
  }

  if (isSpreadsheetContext) {
    actions.push(
      {
        label: "Analyze workbook",
        prompt:
          "Analyze the attached spreadsheet/workbook. Inspect sheets, formulas, broken references, named ranges, pivots, macros/VBA if present, and explain the concrete issue before asking for more information.",
      },
      {
        label: "Run formulas",
        prompt:
          "Evaluate or recalculate the spreadsheet formulas available from the uploaded workbook/CSV evidence, then list formula errors, broken references, and expected outputs.",
      },
      {
        label: "Fix references",
        prompt:
          "Find broken spreadsheet references, missing sheets, bad named ranges, formula errors, or pivot source issues in the current workbook evidence and prepare a safe fix plan.",
      },
    );
  }

  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = action.prompt.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
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
  rollbackTarget,
  rollbackLoading = false,
  chatEndRef,
  onOpenCodeLog,
  onEditMessage,
  onOpenAttachmentPreview,
  onOpenProjectPreview,
  onOpenFileReference,
  onOpenAgentSession,
  onStartAgentPrompt,
  onCreateCodeFromGeneratedFile,
  onRollbackLastApply,
}: ChatMessagesProps) {
  const [previewImage, setPreviewImage] = useState<UploadedFile | null>(null);
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const [expandedContexts, setExpandedContexts] = useState<Set<string>>(new Set());
  const [expandedCodeBlocks, setExpandedCodeBlocks] = useState<Set<string>>(new Set());
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const hiddenMessageCount = showAllMessages ? 0 : Math.max(0, messages.length - 12);
  const visibleMessages = hiddenMessageCount ? messages.slice(hiddenMessageCount) : messages;

  function updateJumpToBottomVisibility() {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowJumpToBottom(container.scrollTop > 120 && distanceFromBottom > 80);
  }

  function jumpToBottom() {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  useEffect(() => {
    updateJumpToBottomVisibility();
  }, [messages.length, showAllMessages]);

  function openUploadedFile(file: UploadedFile) {
    if (file.isImage) {
      setPreviewImage(file);
      return;
    }

    setPreviewFile(file);
  }

  return (
    <>
      <div
        ref={scrollContainerRef}
        onScroll={updateJumpToBottomVisibility}
        className="allow-scroll relative min-h-0 flex-1 px-5 py-3"
      >
        <div className="mx-auto max-w-[1200px] space-y-3">
          {messages.length === 0 && (
            <div className="rounded-[var(--pf-radius)] border border-dashed border-[var(--pf-border)] bg-white/[0.02] p-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400">
                <FileText size={22} />
              </div>

              <div className="text-base font-semibold text-[var(--pf-text)]">
                Ready for context
              </div>

              <div className="mt-1 text-sm text-[var(--pf-text-muted)]">
                Attach files, connect a project, or ask a question to begin.
              </div>
            </div>
          )}

          {hiddenMessageCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllMessages(true)}
              className="mx-auto flex items-center gap-2 rounded-full border border-[var(--pf-border)] bg-white/[0.04] px-4 py-2 text-xs font-semibold text-[var(--pf-text-muted)] transition hover:border-sky-500/30 hover:bg-sky-500/10 hover:text-sky-300"
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
            const generatedDisplayFiles =
              message.role === "assistant"
                ? [...(message.generatedFiles || []), ...generatedFilesFromSvgCode(message.content)]
                : message.generatedFiles || [];
            const visibleMessageContent =
              message.role === "assistant" && generatedDisplayFiles.length
                ? stripVisibleSvgSource(message.content)
                : message.content;
            const longMessage = !activityMessage && isLongMessage(visibleMessageContent);
            const isExpanded = expandedMessages.has(messageIndex);
            const renderedContent = longMessage && !isExpanded ? previewMessage(visibleMessageContent) : visibleMessageContent;
            const markdownContent = message.role === "assistant" ? normalizeOrderedStepMarkers(renderedContent) : renderedContent;
            const firstSafeUrl = (() => {
              const url = extractFirstUrl(message.content);
              if (!url || isNoiseUrl(url) || generatedDisplayFiles.length) return "";
              return url;
            })();
            const canApplyCodeBlocks =
              message.role === "assistant" &&
              !message.isAgentSessionSummary &&
              !message.patchAlreadyApplied &&
              !/PATCH ALREADY APPLIED/i.test(message.content);
            const canRollbackFromMessage =
              message.role === "assistant" &&
              Boolean(rollbackTarget && onRollbackLastApply) &&
              /PATCH APPLIED|PATCH VALIDATION/i.test(message.content) &&
              !/PATCH ROLLED BACK/i.test(message.content);
            const markdownComponents: Components = {
              p: ({ children }) => (
                <p className="my-2 first:mt-0 last:mb-0">
                  {children}
                </p>
              ),

              h1: ({ children }) => (
                <div className="mb-3 mt-4 border-b border-[var(--pf-border)] pb-2 text-lg font-black tracking-tight text-[var(--pf-text)] first:mt-0">
                  {children}
                </div>
              ),

              h2: ({ children }) => (
                <div className="mb-2 mt-4 rounded-[var(--pf-radius-sm)] bg-white/[0.04] px-3 py-2 text-sm font-black uppercase tracking-wide text-[var(--pf-text)] first:mt-0">
                  {children}
                </div>
              ),

              h3: ({ children }) => (
                <div className="mb-2 mt-3 text-sm font-black uppercase tracking-wide text-[var(--pf-text-muted)] first:mt-0">
                  {children}
                </div>
              ),

              hr: () => (
                <div className="my-4 border-t border-[var(--pf-border)]" />
              ),

              ul: ({ children }) => (
                <ul className="my-3 space-y-2 rounded-[var(--pf-radius-sm)] bg-black/20 px-5 py-3 text-[15px] leading-7">
                  {children}
                </ul>
              ),

              ol: ({ children, start }) => (
                <ol start={start} className="pf-step-list my-4">
                  {children}
                </ol>
              ),

              li: ({ children }) => (
                <li className="pl-1">
                  {children}
                </li>
              ),

              pre: ({ children }) => (
                <>{children}</>
              ),

              a: ({ href, children }) =>
                isNoiseUrl(href) ? (
                  <span>{children}</span>
                ) : (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-sky-400 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-300"
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
              const isCodeBlock = Boolean(className) || codeString.includes("\n");

              // MULTILINE CODE BLOCK
              if (isCodeBlock) {
                const isSvgSource = /<svg[\s\S]*<\/svg>/i.test(codeString);
                if (isSvgSource) {
                  return (
                    <details className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-slate-600">
                        Show SVG source
                      </summary>
                      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-xs leading-5 text-emerald-100">
                        {codeString}
                      </pre>
                    </details>
                  );
                }
                const codeIsLarge = codeString.length > 12000 || codeString.split(/\r?\n/).length > 240;
                const codeBlockKey = `${messageIndex}-${language}-${codeString.length}`;
                const codeExpanded = expandedCodeBlocks.has(codeBlockKey);

                return (
                  <div className="group relative my-4 overflow-hidden rounded-2xl border border-[var(--pf-code-border)] bg-[var(--pf-code-bg)] shadow-lg shadow-black/20">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--pf-code-border)] bg-white/[0.035] px-4 py-2.5">
                      <div>
                        <div className="text-xs font-black uppercase tracking-wide text-sky-300">
                          {language}
                        </div>
                        <div className="mt-0.5 text-[11px] font-semibold text-[var(--pf-text-faint)]">
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
                          className="flex h-8 items-center gap-2 rounded-lg border border-[var(--pf-border)] bg-white/[0.055] px-3 text-xs font-bold text-[var(--pf-text)] transition hover:bg-white/[0.1]"
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

                        {canApplyCodeBlocks && (
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
                        )}

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
                          className="flex h-8 items-center gap-2 rounded-lg border border-[var(--pf-border)] bg-white/[0.035] px-3 text-xs font-bold text-[var(--pf-text)] transition hover:bg-white/[0.08]"
                        >
                          {codeExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                          {codeExpanded ? "Collapse" : "Expand"}
                        </button>
                      </div>
                    </div>

                    {codeIsLarge ? (
                      <pre
                        className={`overflow-auto whitespace-pre-wrap break-words bg-[var(--pf-code-bg)] p-5 font-mono text-[14px] leading-7 text-[#e8eef8] ${
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
                          background: "var(--pf-code-bg)",
                          fontSize: "14px",
                          lineHeight: 1.75,
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
                <code className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[0.9em] font-semibold text-sky-200">
                  {children}
                </code>
              );
              },
            };

          return (
            <div
              key={messageIndex}
              className={`rounded-[var(--pf-radius)] border leading-6 transition ${
                message.role === "user"
                  ? "ml-auto max-w-[920px] border-sky-500/20 bg-sky-500/[0.07] p-4 text-[var(--pf-text)]"
                  : tone === "success"
                  ? "mx-auto max-w-[980px] border-emerald-500/25 bg-emerald-500/[0.045] p-5 text-[var(--pf-text)]"
                  : tone === "warning"
                  ? "mx-auto max-w-[980px] border-amber-500/25 bg-amber-500/[0.045] p-5 text-[var(--pf-text)]"
                  : "mx-auto max-w-[980px] border-[var(--pf-border)] bg-white/[0.025] p-5 text-[var(--pf-text)]"
              }`}
            >
              {/* HEADER */}
              <div className="mb-4 flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-wide text-[var(--pf-text-faint)]">
                <span className="inline-flex items-center gap-2">
                  {message.role === "assistant" && (
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full ${
                        activityMessage
                          ? "bg-sky-500/15 text-sky-400"
                          : tone === "success"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : tone === "warning"
                          ? "bg-amber-500/15 text-amber-400"
                          : "bg-white/5 text-[var(--pf-text-muted)]"
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
                    className="pf-btn-ghost h-8 rounded-full px-2.5 text-xs normal-case tracking-normal text-sky-300"
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
                    className="pf-btn-ghost h-8 rounded-full px-2.5 text-xs normal-case tracking-normal"
                    title="Copy full AI response"
                  >
                    {copiedKey === `${messageIndex}-response` ? <Check size={13} /> : <Copy size={13} />}
                    {copiedKey === `${messageIndex}-response` ? "Copied" : "Copy Response"}
                  </button>
                )}
              </div>

              {activityMessage && (
                <div className="mb-3 rounded-[var(--pf-radius-sm)] border border-sky-500/20 bg-sky-500/10 p-4">
                  <div className="flex items-center gap-3 text-sm font-semibold text-sky-200">
                    <Loader2 size={17} className="animate-spin" />
                    {message.content}
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-sky-500/15">
                    <div className="h-full w-1/2 animate-pulse rounded-full bg-sky-400" />
                  </div>
                </div>
              )}

              {agentStats && !activityMessage && (
                <div className="mb-3 flex flex-wrap gap-1.5 rounded-[var(--pf-radius-sm)] border border-[var(--pf-border)] bg-black/20 p-2">
                  <span className="rounded-full border border-[var(--pf-border)] bg-white/[0.04] px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-[var(--pf-text-muted)]">
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
              <div className="pf-chat-prose prose prose-slate max-w-none text-[15.5px] leading-[1.62] prose-pre:p-0 prose-table:text-sm">
                <div
                  className={`relative ${
                    longMessage && !isExpanded
                      ? "max-h-[420px] overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-24 after:bg-gradient-to-t after:from-[var(--pf-bg)] after:to-transparent"
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
                      {markdownContent}
                    </ReactMarkdown>
                  )}

                {message.role === "assistant" &&
                extractFileReferences(renderedContent).length ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--pf-border)] pt-3">
                    {extractFileReferences(renderedContent).map((reference) => (
                      <button
                        key={reference.key}
                        type="button"
                        onClick={() =>
                          onOpenFileReference({
                            file: reference.file,
                            line: Number(reference.line || 1),
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--pf-border)] bg-white/[0.045] px-3 py-1.5 text-xs font-bold text-[var(--pf-text-muted)] no-underline transition hover:border-sky-400/40 hover:bg-sky-500/10 hover:text-sky-200"
                        title={
                          reference.line
                            ? `Open project preview near ${reference.file}:${reference.line}`
                            : `Open evidence source ${reference.file}`
                        }
                      >
                        <FileText size={13} />
                        {reference.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {generatedDisplayFiles.length ? (
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {generatedDisplayFiles.map((file, fileIndex) =>
                      isGeneratedImageFile(file) ? (
                        <div
                          key={`${file.name}-${fileIndex}`}
                          className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm"
                        >
                          <div className="relative flex aspect-square items-center justify-center bg-[linear-gradient(45deg,#f8fafc_25%,transparent_25%),linear-gradient(-45deg,#f8fafc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f8fafc_75%),linear-gradient(-45deg,transparent_75%,#f8fafc_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0] p-4">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={file.content} alt={file.name} className="max-h-full max-w-full object-contain" />
                            <a
                              href={file.content}
                              download={file.name}
                              className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/85 text-white shadow-lg backdrop-blur transition hover:bg-blue-600"
                              title={`Download ${file.name}`}
                            >
                              <Download size={17} />
                            </a>
                          </div>
                          <div className="border-t border-emerald-100 px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-xs font-black text-emerald-900">{file.name}</span>
                              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                                {Math.max(1, Math.round(file.size / 1024))} KB
                              </span>
                            </div>
                            {onCreateCodeFromGeneratedFile && /\b(ui|design|wireframe|mockup|prototype|diagram|sketch|blueprint|map)\b/i.test(file.name) ? (
                              <button
                                type="button"
                                onClick={() => onCreateCodeFromGeneratedFile(file, message.content)}
                                className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-black text-white shadow-sm transition hover:bg-blue-600"
                                title="Open Agent workspace and turn this visual plan into a project"
                              >
                                <Sparkles size={14} />
                                Create code script
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : (
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
                      ),
                    )}
                  </div>
                ) : null}

                {message.role === "assistant" && !message.agentSessionMessages?.length && onStartAgentPrompt && messageActionPrompts(message.content).length ? (
                  <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                    <div className="mb-2 text-xs font-black uppercase tracking-wide text-blue-700">Next actions</div>
                    <div className="flex flex-wrap gap-2">
                      {messageActionPrompts(message.content).map((action) => (
                        <button
                          key={action.prompt}
                          type="button"
                          onClick={() => onStartAgentPrompt(action.prompt)}
                          className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-left text-xs font-black text-blue-700 shadow-sm ring-1 ring-blue-100 transition hover:bg-blue-600 hover:text-white"
                          title={action.prompt}
                        >
                          <Sparkles size={13} />
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {canRollbackFromMessage && rollbackTarget && onRollbackLastApply ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-amber-950">Undo available</div>
                        <div className="mt-1 break-all text-xs font-semibold text-amber-800">
                          Latest snapshot: {rollbackTarget.relative || rollbackTarget.file}. Open options to choose one file or multiple snapshots.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onRollbackLastApply}
                        disabled={rollbackLoading}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-amber-600 px-4 text-xs font-black text-white shadow-sm transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {rollbackLoading ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                        {rollbackLoading ? "Loading..." : "Undo options"}
                      </button>
                    </div>
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
                          {hasRenderableImageContent(file) ? (
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

                {message.role === "assistant" && message.agentSessionMessages?.length ? (
                  <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-black text-indigo-950">
                          <Sparkles size={16} className="text-indigo-600" />
                          {message.isAgentSessionSummary ? "PayFix investigation saved" : "Agent workspace saved"}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-indigo-700">
                          {message.agentSessionMessages.length} investigation message(s) available with its evidence trail.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenAgentSession(message.agentSessionMessages || [], message)}
                        className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-indigo-500"
                      >
                        Reopen Investigation
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* OPEN LINK BUTTON */}
                {message.role === "assistant" && firstSafeUrl && (
                    <a
                      href={firstSafeUrl}
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

      {showJumpToBottom ? (
        <button
          type="button"
          onClick={jumpToBottom}
          className="fixed bottom-[232px] right-8 z-[210] flex h-12 w-12 items-center justify-center rounded-full border border-sky-200/70 bg-white text-slate-950 shadow-2xl shadow-black/35 transition hover:-translate-y-0.5 hover:bg-sky-50 hover:text-sky-700"
          title="Jump to latest message"
          aria-label="Jump to latest message"
        >
          <ChevronDown size={24} strokeWidth={2.6} />
        </button>
      ) : null}

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
    prev.code === next.code &&
    prev.rollbackTarget === next.rollbackTarget &&
    prev.rollbackLoading === next.rollbackLoading
  );
});
