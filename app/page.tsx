"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  BrainCircuit,
  ChevronDown,
  CreditCard,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  PlayCircle,
  Radio,
  RotateCcw,
  Search,
  Usb,
  Webhook,
  Wrench,
  X,
} from "lucide-react";

import ChatMessages from "./components/ChatMessages";
import Composer from "./components/Composer";
import Sidebar from "./components/Sidebar";
import AgentSessionModal from "./components/modals/AgentSessionModal";
import AboutModal from "./components/modals/AboutModal";
import ApplyChangesModal from "./components/modals/ApplyChangesModal";
import {
  AttachmentPreviewModal,
  CodeLogPreviewModal,
  ProjectPreviewModal,
} from "./components/modals/AttachmentPreviewModal";
import ColorToolModal from "./components/modals/ColorToolModal";
import DeleteChatModal from "./components/modals/DeleteChatModal";
import DeviceLabModal from "./components/modals/DeviceLabModal";
import EmvDecoderModal from "./components/modals/EmvDecoderModal";
import HelpModal from "./components/modals/HelpModal";
import LiveInspectorModal from "./components/modals/LiveInspectorModal";
import RunnerModal from "./components/modals/RunnerModal";
import TimelineModal from "./components/modals/TimelineModal";
import WebhookLabModal from "./components/modals/WebhookLabModal";
import { decodeEmvTlv, looksLikeEmvTlv } from "./lib/emvTlv";
import {
  buildRunnerSrcDoc,
  readBrowserFile,
  splitFullHtml,
  unsupportedInstructions,
} from "./lib/payfixHelpers";
import type {
  AttachTab,
  ChatMessage,
  GeneratedFile,
  EmvTlvDecodeResult,
  LiveAppInspectionResult,
  PaymentTimelineResult,
  RunnerMode,
  SavedChat,
  UploadedFile,
} from "./lib/payfixTypes";

type DraftState = {
  question?: string;
  log?: string;
  code?: string;
  projectPath?: string;
  connectedProjectPath?: string;
  projectContext?: string;
  searchFolder?: string;
  searchFileName?: string;
  searchText?: string;
  computerSearchResults?: string;
  computerSearchPreview?: string;
  uploadedFiles?: UploadedFile[];
  messages?: ChatMessage[];
  activeChatId?: string;
};

type ComputerSearchResult = {
  type: string;
  file: string;
  line: number;
  text?: string;
};

type ProjectMatch = {
  file: string;
  line: number;
  text: string;
};

type ProjectMemoryResult = {
  ok: boolean;
  root?: string;
  packageName?: string;
  framework?: string;
  packageManager?: string;
  fileCount?: number;
  textFileCount?: number;
  grouped?: Record<string, number>;
  dependencies?: string[];
  capabilities?: string[];
  importantFiles?: { file: string; relative: string; group: string }[];
  error?: string;
};

type ProjectMapResult = {
  ok: boolean;
  root?: string;
  grouped?: Record<string, { file: string; relative: string; imports: string[] }[]>;
  edges?: { from: string; to: string }[];
  error?: string;
};

type SandboxRunnerResult = {
  ok: boolean;
  packageManager?: string;
  commands?: { ok: boolean; command: string; output: string }[];
  skipped?: string[];
  error?: string;
};

type GitStatusResult = {
  ok: boolean;
  branch?: string;
  dirty?: boolean;
  changedFiles?: { status: string; file: string }[];
  diffStat?: string;
  error?: string;
};

type WatchModeResult = {
  ok: boolean;
  watchers?: { id: string; file: string; relative: string; startedAt: string }[];
  events?: {
    eventId?: string;
    watcherId?: string;
    id?: string;
    file: string;
    relative?: string;
    eventType: string;
    at: string;
    addedLines?: number;
    removedLines?: number;
    changed?: boolean;
    preview?: string;
    issues?: { severity: "error" | "warning" | "info"; message: string }[];
    analysis?: {
      title: string;
      confidence: number;
      risk: "low" | "medium" | "high";
      evidence: string[];
      probableCause: string;
      suggestedFix: string;
      validation: string[];
    };
  }[];
  error?: string;
};

type ProjectFileContent = {
  file: string;
  extension?: string;
  mime?: string;
  size?: number;
  kind?: "text" | "audio" | "image" | "binary";
  content?: string;
  encoding?: string;
  base64?: string;
  note?: string;
};

type ProjectFileListItem =
  | string
  | {
      file: string;
      readable?: boolean;
      textSearchable?: boolean;
      mime?: string;
      size?: number;
    };

type ProjectReadResponse = {
  ok: boolean;
  root?: string;
  filesRead?: number;
  files?: ProjectFileContent[];
  error?: string;
};

type AgentPatch = {
  mode: "replace" | "insert" | "none";
  file: string;
  search: string;
  replacement: string;
  language: string;
  explanation: string;
};

type ApplyPatchSetItem = {
  fileCandidate: string;
  resolvedFile: string;
  mode: "insert" | "replace" | "overwrite";
  search: string;
  replacement: string;
};

type DependencyProposal = {
  needed: boolean;
  packageName: string;
  devDependency: boolean;
  reason: string;
};

type AgentApiResponse = {
  ok: boolean;
  error?: string;
  markdown?: string;
  patchReady?: boolean;
  warning?: string;
  result?: {
    patch?: AgentPatch;
    findings?: string[];
    patchSet?: AgentPatch[];
  };
  patchSet?: AgentPatch[];
  preview?: {
    ok?: boolean;
    oldContent?: string;
    newContent?: string;
    error?: string;
  } | null;
  dependencyProposal?: DependencyProposal;
  filesRead?: {
    file: string;
    name: string;
    kind: string;
    size: number;
  }[];
  loopSteps?: {
    step: string;
    status: "done" | "skipped" | "blocked";
    detail: string;
  }[];
};

function statusTone(message: string) {
  if (/failed|error|blocked|could not|no .*found|invalid/i.test(message)) {
    return {
      dot: "bg-amber-500",
      shell: "border-amber-200 bg-amber-50 text-amber-900 shadow-amber-950/10",
      hover: "hover:bg-amber-100",
    };
  }

  if (/success|connected|loaded|applied|complete|ready|found no obvious/i.test(message)) {
    return {
      dot: "bg-emerald-500",
      shell: "border-emerald-200 bg-emerald-50 text-emerald-900 shadow-emerald-950/10",
      hover: "hover:bg-emerald-100",
    };
  }

  return {
    dot: "bg-blue-500",
    shell: "border-blue-200 bg-blue-50 text-blue-900 shadow-blue-950/10",
    hover: "hover:bg-blue-100",
  };
}

type RollbackSnapshot = {
  id: string;
  file: string;
  relative: string;
  createdAt: string;
  reason: string;
};

type ConversationImage = {
  id: string;
  file: UploadedFile;
  messageNumber: number;
  imageNumber: number;
  prompt: string;
};

type TimelineSourceCandidate = {
  id: string;
  title: string;
  description: string;
  question: string;
  log: string;
  code: string;
  uploadedFiles: UploadedFile[];
  computerSearchResults: string;
  connectedProjectPath: string;
  useProjectContext: boolean;
};

type ImageConversionTarget = {
  extension: "jpg" | "jpeg" | "png" | "webp";
  mime: "image/jpeg" | "image/png" | "image/webp";
  label: string;
};

type DeviceScanResult = {
  ok?: boolean;
  error?: string;
  comPorts?: Record<string, unknown>[];
  usbDevices?: Record<string, unknown>[];
  hidDevices?: Record<string, unknown>[];
  issues?: Record<string, unknown>[];
};

type LiveVisualTarget = NonNullable<LiveAppInspectionResult["dom"]>["visualTargets"][number];

function errorMessage(error: unknown, fallback = "Something went wrong.") {
  return error instanceof Error ? error.message : fallback;
}

function cssRgbToHex(value: string) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return "#2563eb";

  return `#${[match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

const timelineTracePattern =
  /\b(transaction|txn|order\s*id|invoice|webhook|gateway|authorization|auth(?:orize)?\s+(?:request|response|code)|capture|declin(?:e|ed|ing)|approved|approval\s+code|refund|void|settle(?:ment)?|emv|tlv|terminal|device|idtech|verifone|ingenico|pax|com\d+|usb|hid|request\s+id|response\s+code|return_code|host\s+response|batch|avs|cvv|trace\s+id)\b/i;

function timelineUploadLooksTraceable(file: UploadedFile) {
  if (file.isImage) return false;
  return timelineTracePattern.test(`${file.name}\n${file.type}\n${file.content}`);
}

function timelineSourceLooksTraceable(source: {
  question?: string;
  log?: string;
  code?: string;
  uploadedFiles?: UploadedFile[];
  computerSearchResults?: string;
  connectedProjectPath?: string;
  useProjectContext?: boolean;
}) {
  const uploads = source.uploadedFiles || [];
  const text = [
    source.question,
    source.log,
    source.code,
    source.computerSearchResults,
    uploads.filter((file) => !file.isImage).map((file) => `${file.name}\n${file.content}`).join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return Boolean(
    source.log?.trim() ||
      looksLikeEmvTlv(text) ||
      timelineTracePattern.test(text) ||
      uploads.some(timelineUploadLooksTraceable),
  );
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [log, setLog] = useState("");
  const [code, setCode] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [connectedProjectPath, setConnectedProjectPath] = useState("");
  const [projectContext, setProjectContext] = useState("");
  const [searchFolder, setSearchFolder] = useState("");
  const [searchFileName, setSearchFileName] = useState("");
  const [searchText, setSearchText] = useState("");
  const [computerSearchResults, setComputerSearchResults] = useState("");
  const [computerSearchPreview, setComputerSearchPreview] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [pendingUploads, setPendingUploads] = useState<UploadedFile[]>([]);
  const [agentStatus, setAgentStatus] = useState("");
  const [projectMatches, setProjectMatches] = useState<ProjectMatch[]>([]);
  const [loadedProjectFiles, setLoadedProjectFiles] = useState<ProjectFileContent[]>([]);
  const [loading, setLoading] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentSessionOpen, setAgentSessionOpen] = useState(false);
  const [agentSessionMessages, setAgentSessionMessages] = useState<ChatMessage[]>([]);
  const [agentSessionUploads, setAgentSessionUploads] = useState<UploadedFile[]>([]);
  const [timelineResult, setTimelineResult] = useState<PaymentTimelineResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [editSnapshot, setEditSnapshot] = useState<{
    messages: ChatMessage[];
    question: string;
    log: string;
    code: string;
    projectPath: string;
    connectedProjectPath: string;
    projectContext: string;
    computerSearchResults: string;
    computerSearchPreview: string;
    searchFolder: string;
    searchFileName: string;
    searchText: string;
    uploadedFiles: UploadedFile[];
  } | null>(null);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [chatToDelete, setChatToDelete] = useState<SavedChat | null>(null);
  const [activeChatId, setActiveChatId] = useState("");
  const [activeAttachTab, setActiveAttachTab] = useState<AttachTab>("search");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showColorEditor, setShowColorEditor] = useState(false);
  const [cssFileName, setCssFileName] = useState("");
  const [cssSelector, setCssSelector] = useState("");
  const [cssProperty, setCssProperty] = useState("color");
  const [cssColor, setCssColor] = useState("#2563eb");
  const [cssFileMatches, setCssFileMatches] = useState<string[]>([]);
  const [selectedCssFile, setSelectedCssFile] = useState("");
  const [cssPreview, setCssPreview] = useState("");
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyFilePath, setApplyFilePath] = useState("");
  const [applyMode, setApplyMode] = useState<"insert" | "replace" | "overwrite">("insert");
  const [applySearchContent, setApplySearchContent] = useState("");
  const [applyNewContent, setApplyNewContent] = useState("");
  const [applyDescription, setApplyDescription] = useState("");
  const [applyPatchSet, setApplyPatchSet] = useState<ApplyPatchSetItem[]>([]);
  const [applyAllLoading, setApplyAllLoading] = useState(false);
  const [applyAgentFollowUpLoading, setApplyAgentFollowUpLoading] = useState(false);
  const [lastRollback, setLastRollback] = useState<RollbackSnapshot | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [dependencyProposal, setDependencyProposal] = useState<DependencyProposal | null>(null);
  const [dependencyInstalling, setDependencyInstalling] = useState(false);
  const [diffOldContent, setDiffOldContent] = useState("");
  const [diffNewContent, setDiffNewContent] = useState("");
  const [applyPreviewKey, setApplyPreviewKey] = useState("");
  const [showRunner, setShowRunner] = useState(false);
  const [runnerMode, setRunnerMode] = useState<RunnerMode>("js");
  const [runnerLanguage, setRunnerLanguage] = useState("javascript");
  const [runnerHtml, setRunnerHtml] = useState("");
  const [runnerCss, setRunnerCss] = useState("");
  const [runnerJs, setRunnerJs] = useState("");
  const [runnerUnsupportedMessage, setRunnerUnsupportedMessage] = useState("");
  const [runnerRefreshKey, setRunnerRefreshKey] = useState(0);
  const [attachmentPreviewOpen, setAttachmentPreviewOpen] = useState(false);
  const [projectPreviewOpen, setProjectPreviewOpen] = useState(false);
  const [projectPreviewReference, setProjectPreviewReference] = useState<{ file: string; line: number } | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineSourcePickerOpen, setTimelineSourcePickerOpen] = useState(false);
  const [codeLogPreview, setCodeLogPreview] = useState<{ log: string; code: string } | null>(null);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [webhookLabOpen, setWebhookLabOpen] = useState(false);
  const [deviceLabOpen, setDeviceLabOpen] = useState(false);
  const [deviceLabLoading, setDeviceLabLoading] = useState(false);
  const [deviceScanResult, setDeviceScanResult] = useState<DeviceScanResult | null>(null);
  const [liveInspectorOpen, setLiveInspectorOpen] = useState(false);
  const [liveInspectorLoading, setLiveInspectorLoading] = useState(false);
  const [liveInspectorUrl, setLiveInspectorUrl] = useState("http://localhost:3000");
  const [liveInspectorResult, setLiveInspectorResult] = useState<LiveAppInspectionResult | null>(null);
  const [projectIqOpen, setProjectIqOpen] = useState(false);
  const [projectIqLoading, setProjectIqLoading] = useState(false);
  const [projectMemory, setProjectMemory] = useState<ProjectMemoryResult | null>(null);
  const [projectMap, setProjectMap] = useState<ProjectMapResult | null>(null);
  const [sandboxRunnerResult, setSandboxRunnerResult] = useState<SandboxRunnerResult | null>(null);
  const [gitStatusResult, setGitStatusResult] = useState<GitStatusResult | null>(null);
  const [watchModeResult, setWatchModeResult] = useState<WatchModeResult | null>(null);
  const [watchFilePath, setWatchFilePath] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [emvDecodeResult, setEmvDecodeResult] = useState<EmvTlvDecodeResult | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const draftRestoredRef = useRef(false);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!toolsOpen) return;

    function closeToolsOnOutsideClick(event: MouseEvent | TouchEvent) {
      if (!toolsMenuRef.current || toolsMenuRef.current.contains(event.target as Node)) {
        return;
      }

      setToolsOpen(false);
    }

    document.addEventListener("mousedown", closeToolsOnOutsideClick);
    document.addEventListener("touchstart", closeToolsOnOutsideClick);

    return () => {
      document.removeEventListener("mousedown", closeToolsOnOutsideClick);
      document.removeEventListener("touchstart", closeToolsOnOutsideClick);
    };
  }, [toolsOpen]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("payfix_saved_chats") || "[]") || [];
        const draft: DraftState = JSON.parse(localStorage.getItem("payfix_active_draft") || "{}") || {};
        const draftActiveChatId = draft.activeChatId || "";
        const activeSavedChat = draftActiveChatId
          ? saved.find((chat: SavedChat) => chat.id === draftActiveChatId)
          : null;

        setSavedChats(saved);
        setQuestion(draft.question || "");
        setLog(draft.log || "");
        setCode(draft.code || "");
        setProjectPath(draft.projectPath || "");
        setConnectedProjectPath(draft.connectedProjectPath || "");
        setProjectContext(draft.projectContext || "");
        setSearchFolder(draft.searchFolder || "");
        setSearchFileName(draft.searchFileName || "");
        setSearchText(draft.searchText || "");
        setComputerSearchResults(draft.computerSearchResults || "");
        setComputerSearchPreview(draft.computerSearchPreview || "");
        setUploadedFiles(draft.uploadedFiles || []);
        setMessages(draft.messages || activeSavedChat?.messages || []);
        setActiveChatId(draftActiveChatId || activeSavedChat?.id || crypto.randomUUID());
      } catch {
        setActiveChatId(crypto.randomUUID());
      } finally {
        draftRestoredRef.current = true;
      }
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!draftRestoredRef.current) return;

    const saveDraft = () => {
      localStorage.setItem(
        "payfix_active_draft",
        JSON.stringify({
          question,
          log,
          code,
          projectPath,
          connectedProjectPath,
          projectContext,
          searchFolder,
          searchFileName,
          searchText,
          computerSearchResults,
          computerSearchPreview,
          uploadedFiles,
          activeChatId,
        }),
      );
    };
    const saveTimer = window.setTimeout(saveDraft, 500);

    return () => window.clearTimeout(saveTimer);
  }, [
    question,
    log,
    code,
    projectPath,
    connectedProjectPath,
    projectContext,
    searchFolder,
    searchFileName,
    searchText,
    computerSearchResults,
    computerSearchPreview,
    uploadedFiles,
    activeChatId,
  ]);

  useEffect(() => {
    if (!agentStatus || loading || agentLoading || timelineLoading || dependencyInstalling) return;

    const clearStatusTimer = window.setTimeout(() => {
      setAgentStatus("");
    }, /failed|error|blocked|could not/i.test(agentStatus) ? 6500 : 3500);

    return () => window.clearTimeout(clearStatusTimer);
  }, [agentStatus, loading, agentLoading, timelineLoading, dependencyInstalling]);

  const hasConversation = messages.length > 0;
  const hasAttachment =
    Boolean(computerSearchResults) ||
    uploadedFiles.length > 0 ||
    Boolean(connectedProjectPath) ||
    Boolean(projectContext) ||
    Boolean(log.trim()) ||
    Boolean(code.trim());
  const canSend = Boolean(question.trim()) || hasAttachment;
  const hasFreshTimelineInput = Boolean(question.trim() || log.trim() || code.trim() || uploadedFiles.length);
  const uploadPreview = useMemo(
    () =>
      uploadedFiles.map((file) => {
        const maxNameLength = 20;
        const shortName = file.name.length > maxNameLength ? `${file.name.slice(0, maxNameLength)}...` : file.name;
        return `${shortName} (${Math.round(file.size / 1024)} KB)`;
      }),
    [uploadedFiles],
  );
  const conversationImages = useMemo<ConversationImage[]>(() => {
    const seen = new Set<string>();

    return messages.flatMap((message, messageIndex) => {
      if (message.role !== "user") return [];

      return (message.attachedUploads || [])
        .filter((file) => file.isImage && file.content)
        .map((file, uploadIndex) => ({
          id: `${messageIndex}-${uploadIndex}-${file.name}-${file.size}`,
          file,
          messageNumber: messageIndex + 1,
          imageNumber: uploadIndex + 1,
          prompt: message.content,
        }))
        .filter((item) => {
          const key = `${item.file.name}-${item.file.size}-${item.file.content.slice(0, 80)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    });
  }, [messages]);
  const timelineSourceCandidates = useMemo<TimelineSourceCandidate[]>(() => {
    const candidates: TimelineSourceCandidate[] = [];

    if (timelineResult?.sourceEvidence?.length) {
      candidates.push({
        id: "last-timeline-source",
        title: "Last Timeline Source",
        description: `${timelineResult.sourceEvidence.length} uploaded file(s) from the most recent trace run.`,
        question: "Rebuild the payment trace timeline from the previous uploaded source file(s).",
        log: "",
        code: "",
        uploadedFiles: timelineResult.sourceEvidence,
        computerSearchResults: "",
        connectedProjectPath: "",
        useProjectContext: false,
      });
    }

    messages.forEach((message, index) => {
      if (message.role !== "user") return;

      const attachedUploads = message.attachedUploads || [];
      const textUploads = attachedUploads.filter((file) => !file.isImage);

      if (
        !timelineSourceLooksTraceable({
          question: message.content,
          log: message.attachedLog || "",
          code: message.attachedCode || "",
          uploadedFiles: attachedUploads,
        })
      ) {
        return;
      }

      candidates.push({
        id: `message-${index}`,
        title: `Message ${index + 1}`,
        description: [
          textUploads.length ? `${textUploads.length} text file(s)` : "",
          message.attachedLog ? "payment log" : "",
          message.attachedCode ? "code" : "",
        ]
          .filter(Boolean)
          .join(" / ") || "payment-related message",
        question: message.content || "Build a payment trace timeline from this previous message.",
        log: message.attachedLog || "",
        code: message.attachedCode || "",
        uploadedFiles: attachedUploads,
        computerSearchResults: "",
        connectedProjectPath: "",
        useProjectContext: false,
      });
    });

    if (computerSearchResults && timelineSourceLooksTraceable({ computerSearchResults })) {
      candidates.push({
        id: "search-results",
        title: "Attached Search Results",
        description: "Current computer search context.",
        question: "Build a payment trace timeline from attached computer search results.",
        log: "",
        code: "",
        uploadedFiles: [],
        computerSearchResults,
        connectedProjectPath: "",
        useProjectContext: false,
      });
    }

    return candidates;
  }, [computerSearchResults, messages, timelineResult?.sourceEvidence]);
  const smartWatchAlerts = useMemo(() => {
    const alerts: Array<{ severity: "error" | "warning" | "info"; title: string; detail: string }> = [];

    for (const event of (watchModeResult?.events || []).slice(0, 8)) {
      if (event.analysis && event.analysis.risk !== "low") {
        alerts.push({
          severity: event.analysis.risk === "high" ? "error" : "warning",
          title: `${event.analysis.title}: ${event.relative || event.file}`,
          detail: `${event.analysis.probableCause} Confidence ${event.analysis.confidence}%.`,
        });
      }

      for (const issue of event.issues || []) {
        if (issue.severity === "info") continue;
        alerts.push({
          severity: issue.severity,
          title: `${event.relative || event.file}: ${issue.severity === "error" ? "possible breakage" : "warning"}`,
          detail: issue.message,
        });
      }
    }

    for (const command of sandboxRunnerResult?.commands || []) {
      if (!command.ok) {
        alerts.push({
          severity: "error",
          title: `Sandbox failed: ${command.command}`,
          detail: command.output.slice(0, 260) || "Command failed without output.",
        });
      }
    }

    for (const entry of liveInspectorResult?.consoleMessages || []) {
      if (["error", "warning"].includes(entry.type)) {
        alerts.push({
          severity: entry.type === "error" ? "error" : "warning",
          title: `Console ${entry.type}`,
          detail: entry.text.slice(0, 260),
        });
      }
    }

    for (const request of liveInspectorResult?.network || []) {
      if (request.failure || (request.status && request.status >= 400)) {
        alerts.push({
          severity: request.status && request.status >= 500 ? "error" : "warning",
          title: `Failed request ${request.status || ""}`.trim(),
          detail: `${request.method || "GET"} ${request.url}`.slice(0, 260),
        });
      }
    }

    return alerts.slice(0, 8);
  }, [liveInspectorResult, sandboxRunnerResult, watchModeResult]);
  const canBuildTimeline = hasFreshTimelineInput || hasConversation || timelineSourceCandidates.length > 0;
  const runnerSrcDoc = useMemo(
    () => buildRunnerSrcDoc(runnerHtml, runnerCss, runnerJs),
    [runnerHtml, runnerCss, runnerJs],
  );

  function questionReferencesImage(text: string) {
    return /\b(screenshot|screen shot|image|picture|photo|attached image|uploaded image|jpg|jpeg|png|webp)\b/i.test(
      text,
    );
  }

  function imageConversionTarget(text: string): ImageConversionTarget | null {
    if (!/\b(convert|export|save|send|return|make|change)\b/i.test(text)) {
      return null;
    }

    if (/\b(jpe?g)\b/i.test(text)) {
      return { extension: "jpg", mime: "image/jpeg", label: "JPG" };
    }

    if (/\b(png)\b/i.test(text)) {
      return { extension: "png", mime: "image/png", label: "PNG" };
    }

    if (/\b(webp)\b/i.test(text)) {
      return { extension: "webp", mime: "image/webp", label: "WebP" };
    }

    return null;
  }

  function wantsDecode(text: string) {
    return /\b(decode|encoded|base64|base64url|hex|url encoded|jwt|token)\b/i.test(text);
  }

  function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function mimeFromBytes(bytes: Uint8Array) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    return "text/plain";
  }

  function extensionFromMime(mime: string) {
    if (mime === "image/png") return "png";
    if (mime === "image/jpeg") return "jpg";
    if (mime === "image/gif") return "gif";
    if (mime === "application/pdf") return "pdf";
    if (mime === "application/json") return "json";
    return "txt";
  }

  function textFromBytes(bytes: Uint8Array) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  function base64ToBytes(value: string) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  function hexToBytes(value: string) {
    const cleaned = value.replace(/\s+/g, "").replace(/^0x/i, "");
    const pairs = cleaned.match(/.{1,2}/g) || [];
    return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)));
  }

  function extractDecodeCandidates(text: string) {
    const candidates = new Set<string>();
    const fenced = text.matchAll(/```(?:\w+)?\s*([\s\S]*?)```/g);
    for (const match of fenced) {
      if (match[1]?.trim()) candidates.add(match[1].trim());
    }

    const quoted = text.matchAll(/["'`]([^"'`\s]{16,})["'`]/g);
    for (const match of quoted) {
      if (match[1]?.trim()) candidates.add(match[1].trim());
    }

    const longTokens = text.match(/[A-Za-z0-9+/=_-]{24,}|(?:%[0-9a-fA-F]{2}){4,}|(?:0x)?[0-9a-fA-F]{32,}/g) || [];
    longTokens.forEach((token) => candidates.add(token.trim()));

    const trimmed = text.trim();
    if (trimmed.length >= 16 && trimmed.length < 200000) {
      candidates.add(trimmed);
    }

    return [...candidates].slice(0, 6);
  }

  function buildDecodedFile(bytes: Uint8Array, baseName: string): GeneratedFile {
    const decodedText = textFromBytes(bytes);
    const textLooksReadable = decodedText.replace(/[\r\n\t -~]/g, "").length / Math.max(decodedText.length, 1) < 0.08;
    const jsonText = decodedText.trim();
    let mime = textLooksReadable ? "text/plain" : mimeFromBytes(bytes);
    let content = decodedText;

    if (textLooksReadable && /^[\[{]/.test(jsonText)) {
      try {
        content = JSON.stringify(JSON.parse(jsonText), null, 2);
        mime = "application/json";
      } catch {
        content = decodedText;
      }
    }

    if (mime === "text/plain" || mime === "application/json") {
      return {
        name: `${baseName}.${extensionFromMime(mime)}`,
        type: mime,
        size: new Blob([content], { type: mime }).size,
        content: `data:${mime};charset=utf-8;base64,${bytesToBase64(new TextEncoder().encode(content))}`,
      };
    }

    return {
      name: `${baseName}.${extensionFromMime(mime)}`,
      type: mime,
      size: bytes.byteLength,
      content: `data:${mime};base64,${bytesToBase64(bytes)}`,
    };
  }

  function decodePastedStrings(text: string): { files: GeneratedFile[]; summary: string[] } {
    const files: GeneratedFile[] = [];
    const summary: string[] = [];
    const candidates = extractDecodeCandidates(text);

    candidates.forEach((candidate, index) => {
      try {
        if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(candidate)) {
          const parts = candidate.split(".");
          const decoded = parts.slice(0, 2).map((part, partIndex) => {
            const bytes = base64ToBytes(part);
            const textPart = textFromBytes(bytes);
            return partIndex === 0 ? JSON.parse(textPart) : JSON.parse(textPart);
          });
          const content = JSON.stringify({ header: decoded[0], payload: decoded[1], signature: parts[2] }, null, 2);
          files.push({
            name: `decoded-jwt-${index + 1}.json`,
            type: "application/json",
            size: new Blob([content], { type: "application/json" }).size,
            content: `data:application/json;charset=utf-8;base64,${bytesToBase64(new TextEncoder().encode(content))}`,
          });
          summary.push(`Decoded JWT ${index + 1} into header/payload JSON.`);
          return;
        }

        if (/%[0-9a-fA-F]{2}/.test(candidate)) {
          const decoded = decodeURIComponent(candidate);
          files.push({
            name: `decoded-url-${index + 1}.txt`,
            type: "text/plain",
            size: new Blob([decoded], { type: "text/plain" }).size,
            content: `data:text/plain;charset=utf-8;base64,${bytesToBase64(new TextEncoder().encode(decoded))}`,
          });
          summary.push(`Decoded URL-encoded string ${index + 1}.`);
          return;
        }

        if (/^(?:0x)?[0-9a-fA-F\s]+$/.test(candidate) && candidate.replace(/\s+|0x/gi, "").length % 2 === 0) {
          files.push(buildDecodedFile(hexToBytes(candidate), `decoded-hex-${index + 1}`));
          summary.push(`Decoded hex string ${index + 1}.`);
          return;
        }

        if (/^[A-Za-z0-9+/=_-]+$/.test(candidate) && candidate.length % 4 !== 1) {
          files.push(buildDecodedFile(base64ToBytes(candidate), `decoded-base64-${index + 1}`));
          summary.push(`Decoded base64/base64url string ${index + 1}.`);
        }
      } catch {
        // Keep scanning other candidates.
      }
    });

    return { files, summary };
  }

  function convertedFileName(name: string, extension: string) {
    const baseName = name.replace(/\.[^/.\\]+$/, "") || "converted-image";
    return `${baseName}.${extension}`;
  }

  function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not read converted image."));
      reader.readAsDataURL(blob);
    });
  }

  function loadImageElement(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load the image for conversion."));
      image.src = src;
    });
  }

  async function convertImage(file: UploadedFile, target: ImageConversionTarget): Promise<GeneratedFile> {
    const image = await loadImageElement(file.content);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Image conversion is not available in this browser.");
    }

    if (target.mime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(image, 0, 0);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error(`Could not export ${target.label}.`));
          }
        },
        target.mime,
        target.mime === "image/jpeg" ? 0.92 : undefined,
      );
    });

    return {
      name: convertedFileName(file.name, target.extension),
      type: target.mime,
      size: blob.size,
      content: await blobToDataUrl(blob),
    };
  }

  async function convertImagesForChat(files: UploadedFile[], target: ImageConversionTarget) {
    const images = files.filter((file) => file.isImage && file.content);
    if (!images.length) {
      throw new Error("No image was available to convert.");
    }

    return Promise.all(images.map((file) => convertImage(file, target)));
  }

  function resolveReferencedUploads(explicitUploads?: UploadedFile[]) {
    if (explicitUploads?.length) {
      return explicitUploads;
    }

    if (uploadedFiles.length > 0 || !questionReferencesImage(question)) {
      return uploadedFiles;
    }

    if (conversationImages.length === 1) {
      setAgentStatus(`Using prior image: ${conversationImages[0].file.name}`);
      return [conversationImages[0].file];
    }

    if (conversationImages.length > 1) {
      setImagePickerOpen(true);
      setAgentStatus("Choose which previous image this message is about.");
      return null;
    }

    return uploadedFiles;
  }

  function recentConversationForAgent() {
    return messages
      .slice(-8)
      .map((message, index) => {
        const label = message.role === "user" ? "USER" : "PAYFIX AI";
        const uploads = (message.attachedUploads || [])
          .map((file, uploadIndex) => `${file.isImage ? "Image" : "File"} ${uploadIndex + 1}: ${file.name}`)
          .join(", ");

        return `${index + 1}. ${label}: ${message.content.slice(0, 2500)}${
          uploads ? `\nATTACHMENTS: ${uploads}` : ""
        }`;
      })
      .join("\n\n");
  }

  function compressedAgentMemory() {
    const fileMentions = new Set<string>();
    const attachmentMentions: string[] = [];
    const userIntents: string[] = [];

    messages.slice(-16).forEach((message, index) => {
      const content = String(message.content || "");
      const files = content.match(/[A-Za-z]:[\\/][^\s`"'<>]+|[\w.-]+\.(tsx|ts|jsx|js|css|html|json|md|php|py)/gi) || [];
      files.slice(0, 8).forEach((file) => fileMentions.add(file));

      if (message.role === "user") {
        userIntents.push(`Message ${index + 1}: ${content.slice(0, 280)}`);
      }

      (message.attachedUploads || []).forEach((file) => {
        attachmentMentions.push(`${file.isImage ? "Image" : "File"}: ${file.name} (${file.type}, ${Math.round(file.size / 1024)} KB)`);
      });
    });

    return [
      connectedProjectPath ? `Connected project: ${connectedProjectPath}` : "",
      fileMentions.size ? `Mentioned files:\n${[...fileMentions].slice(0, 18).map((file) => `- ${file}`).join("\n")}` : "",
      attachmentMentions.length
        ? `Recent attachments:\n${attachmentMentions.slice(-12).map((item) => `- ${item}`).join("\n")}`
        : "",
      userIntents.length ? `Recent user intents:\n${userIntents.slice(-8).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  function webhookLabConversationText() {
    return [
      ...messages.map((message, index) => {
        const uploads = (message.attachedUploads || [])
          .filter((file) => !file.isImage)
          .map((file) => `ATTACHED FILE: ${file.name}\n${file.content}`)
          .join("\n\n");

        return `MESSAGE ${index + 1} / ${message.role.toUpperCase()}:
${message.content}
${message.attachedLog ? `\nATTACHED LOG:\n${message.attachedLog}` : ""}
${message.attachedCode ? `\nATTACHED CODE:\n${message.attachedCode}` : ""}
${uploads ? `\n${uploads}` : ""}`;
      }),
      question ? `CURRENT QUESTION:\n${question}` : "",
      log ? `CURRENT LOG:\n${log}` : "",
      code ? `CURRENT CODE:\n${code}` : "",
      uploadedFiles
        .filter((file) => !file.isImage)
        .map((file) => `CURRENT UPLOAD: ${file.name}\n${file.content}`)
        .join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  function escapeHtml(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function downloadTextFile(fileName: string, content: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function currentAttachedTextContext() {
    return [
      question,
      log,
      code,
      computerSearchResults,
      uploadedFiles.filter((file) => !file.isImage).map((file) => file.content).join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  function openEmvDecoderFromCurrentContext() {
    const context = currentAttachedTextContext();

    if (!looksLikeEmvTlv(context)) {
      setAgentStatus("Paste or attach raw EMV/TLV hex first, then open EMV Decoder.");
      return;
    }

    setEmvDecodeResult(decodeEmvTlv(context));
    setAgentStatus("EMV/TLV decoded.");
  }

  function openConversationSnapshot() {
    if (!messages.length) {
      setAgentStatus("No conversation to capture yet.");
      return;
    }

    const body = messages
      .map((message) => {
        const uploads = (message.attachedUploads || [])
          .filter((file) => file.isImage && file.content)
          .map(
            (file, index) => `
              <figure>
                <img src="${file.content}" alt="${escapeHtml(file.name)}" />
                <figcaption>Image ${index + 1}: ${escapeHtml(file.name)}</figcaption>
              </figure>`,
          )
          .join("");

        return `
          <article class="${message.role}">
            <h2>${message.role === "user" ? "You" : "PayFix AI"}</h2>
            <pre>${escapeHtml(message.content)}</pre>
            ${uploads ? `<div class="images">${uploads}</div>` : ""}
          </article>`;
      })
      .join("");

    const snapshotWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!snapshotWindow) {
      setAgentStatus("Popup blocked. Allow popups to open the full conversation snapshot.");
      return;
    }

    snapshotWindow.document.write(`<!doctype html>
<html>
  <head>
    <title>PayFix Conversation Snapshot</title>
    <style>
      body { margin: 0; background: #eef3f8; color: #0f172a; font-family: Arial, sans-serif; }
      main { max-width: 980px; margin: 0 auto; padding: 32px; }
      header { margin-bottom: 20px; }
      h1 { margin: 0; font-size: 28px; }
      p { color: #475569; }
      article { margin: 16px 0; padding: 18px; border: 1px solid #dbe3ef; border-radius: 18px; background: white; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08); }
      article.user { background: #eff6ff; border-color: #bfdbfe; }
      h2 { margin: 0 0 12px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #475569; }
      pre { margin: 0; white-space: pre-wrap; font: 15px/1.6 Arial, sans-serif; }
      .images { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 14px; }
      figure { margin: 0; }
      img { max-width: 100%; border-radius: 12px; border: 1px solid #dbe3ef; }
      figcaption { margin-top: 6px; color: #475569; font-size: 12px; }
      .actions { position: sticky; top: 0; display: flex; justify-content: flex-end; gap: 10px; padding: 12px 0; background: #eef3f8; }
      button { border: 0; border-radius: 12px; background: #2563eb; color: white; padding: 10px 14px; font-weight: 700; cursor: pointer; }
      @media print { .actions { display: none; } main { max-width: none; padding: 20px; } }
    </style>
  </head>
  <body>
    <main>
      <div class="actions"><button onclick="window.print()">Save / Print Full Snapshot</button></div>
      <header>
        <h1>PayFix AI Conversation</h1>
        <p>${escapeHtml(new Date().toLocaleString())}</p>
      </header>
      ${body}
    </main>
  </body>
</html>`);
    snapshotWindow.document.close();
    setAgentStatus("Conversation snapshot opened.");
  }

  async function ensureLocalAgentProjectRoot() {
    const root = connectedProjectPath || projectPath.trim();
    if (!root) throw new Error("No project path is connected in the UI.");

    const response = await fetch("/api/local-agent/set-root", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root }),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "Could not connect the local agent to this project.");

    setProjectPath(data.root);
    setConnectedProjectPath(data.root);
    return data.root as string;
  }

  async function scanDevices() {
    setDeviceLabOpen(true);
    setDeviceLabLoading(true);
    setAgentStatus("Scanning local payment devices...");

    try {
      const response = await fetch("/api/local-agent/device/scan");
      const data = await response.json();
      setDeviceScanResult(data);

      if (!data.ok) {
        throw new Error(data.error || "Device scan failed.");
      }

      setAgentStatus(
        `Device scan complete: ${(data.comPorts || []).length} COM, ${
          ((data.usbDevices || []).length + (data.hidDevices || []).length)
        } USB/HID connected payment device(s).`,
      );
    } catch (err: unknown) {
      setDeviceScanResult({ ok: false, error: errorMessage(err) });
      setAgentStatus(`Device scan failed: ${errorMessage(err)}`);
    } finally {
      setDeviceLabLoading(false);
    }
  }

  async function inspectRunningApp() {
    setLiveInspectorOpen(true);
    setLiveInspectorLoading(true);
    setAgentStatus("Inspecting running localhost app...");

    try {
      const response = await fetch("/api/live-inspector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: liveInspectorUrl, projectRoot: connectedProjectPath || undefined }),
      });
      const data = (await response.json()) as LiveAppInspectionResult;
      setLiveInspectorResult(data);

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Live inspection failed.");
      }

      const issueCount = data.findings.filter((finding) => finding.severity !== "info").length;
      setLiveInspectorUrl(data.targetUrl);
      if (data.detectedProject?.root && data.detectedProject.root !== connectedProjectPath) {
        setProjectPath(data.detectedProject.root);
        setConnectedProjectPath(data.detectedProject.root);
        await fetch("/api/local-agent/set-root", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root: data.detectedProject.root }),
        }).catch(() => undefined);
      }
      setAgentStatus(
        data.detectedProject?.root
          ? `Live inspector linked ${data.detectedProject.packageName} and found ${issueCount} issue(s).`
          : issueCount
            ? `Live inspector found ${issueCount} issue(s) in ${data.targetUrl}.`
            : `Live inspector found no obvious runtime issues in ${data.targetUrl}.`,
      );
    } catch (err: unknown) {
      setLiveInspectorResult((current) => current || {
        ok: false,
        inspectedAt: new Date().toISOString(),
        targetUrl: liveInspectorUrl,
        detectedApps: [],
        consoleMessages: [],
        pageErrors: [],
        network: [],
        findings: [],
        error: errorMessage(err),
      });
      setAgentStatus(`Live inspector failed: ${errorMessage(err)}`);
    } finally {
      setLiveInspectorLoading(false);
    }
  }

  async function openProjectIq() {
    if (!connectedProjectPath) {
      setAgentStatus("Connect a project first, then open Project IQ.");
      return;
    }

    setProjectIqOpen(true);
    setProjectIqLoading(true);
    setAgentStatus("Loading project memory and map...");

    try {
      await ensureLocalAgentProjectRoot();
      const [memoryResponse, mapResponse, watchResponse, gitResponse] = await Promise.all([
        fetch("/api/local-agent/project/memory"),
        fetch("/api/local-agent/project/map"),
        fetch("/api/local-agent/project/watch/events"),
        fetch("/api/local-agent/project/git/status"),
      ]);
      const memoryData = (await memoryResponse.json()) as ProjectMemoryResult;
      const mapData = (await mapResponse.json()) as ProjectMapResult;
      const watchData = (await watchResponse.json()) as WatchModeResult;
      const gitData = (await gitResponse.json()) as GitStatusResult;

      setProjectMemory(memoryData);
      setProjectMap(mapData);
      setWatchModeResult(watchData);
      setGitStatusResult(gitData);

      if (!memoryData.ok) throw new Error(memoryData.error || "Project memory failed.");
      if (!mapData.ok) throw new Error(mapData.error || "Project map failed.");

      setAgentStatus(
        `Project IQ loaded: ${memoryData.framework || "project"} with ${memoryData.fileCount || 0} file(s).`,
      );
    } catch (err: unknown) {
      setAgentStatus(`Project IQ failed: ${errorMessage(err)}`);
    } finally {
      setProjectIqLoading(false);
    }
  }

  async function runSandboxRunner() {
    setProjectIqLoading(true);
    setAgentStatus("Running sandbox project checks...");

    try {
      await ensureLocalAgentProjectRoot();
      const response = await fetch("/api/local-agent/project/sandbox-runner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checks: ["typescript", "lint", "test", "build"] }),
      });
      const data = (await response.json()) as SandboxRunnerResult;
      setSandboxRunnerResult(data);
      setAgentStatus(data.ok ? "Sandbox runner passed." : `Sandbox runner found failures: ${data.error || "see Project IQ"}`);
    } catch (err: unknown) {
      setSandboxRunnerResult({ ok: false, error: errorMessage(err) });
      setAgentStatus(`Sandbox runner failed: ${errorMessage(err)}`);
    } finally {
      setProjectIqLoading(false);
    }
  }

  async function refreshGitStatus() {
    try {
      await ensureLocalAgentProjectRoot();
      const response = await fetch("/api/local-agent/project/git/status");
      setGitStatusResult((await response.json()) as GitStatusResult);
    } catch (err: unknown) {
      setGitStatusResult({ ok: false, error: errorMessage(err) });
    }
  }

  async function commitProjectChanges() {
    const message = window.prompt("Commit message for current project changes:");
    if (!message?.trim()) return;

    setProjectIqLoading(true);
    setAgentStatus("Creating Git commit...");

    try {
      await ensureLocalAgentProjectRoot();
      const response = await fetch("/api/local-agent/project/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Git commit failed.");
      setAgentStatus("Git commit created.");
      await refreshGitStatus();
    } catch (err: unknown) {
      setAgentStatus(`Git commit failed: ${errorMessage(err)}`);
    } finally {
      setProjectIqLoading(false);
    }
  }

  async function revertLastGitCommit() {
    const confirmed = window.confirm(
      "Create a new Git revert commit for the current HEAD? This does not reset or erase history.",
    );
    if (!confirmed) return;

    setProjectIqLoading(true);
    setAgentStatus("Creating Git revert commit...");

    try {
      await ensureLocalAgentProjectRoot();
      const response = await fetch("/api/local-agent/project/git/revert-last-commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Git revert failed.");
      setAgentStatus("Git revert commit created.");
      await refreshGitStatus();
    } catch (err: unknown) {
      setAgentStatus(`Git revert failed: ${errorMessage(err)}`);
    } finally {
      setProjectIqLoading(false);
    }
  }

  async function refreshWatchMode() {
    try {
      await ensureLocalAgentProjectRoot();
      const response = await fetch("/api/local-agent/project/watch/events");
      setWatchModeResult((await response.json()) as WatchModeResult);
    } catch (err: unknown) {
      setWatchModeResult({ ok: false, error: errorMessage(err) });
    }
  }

  async function clearWatchMode() {
    setProjectIqLoading(true);
    setAgentStatus("Clearing Watch state...");

    try {
      await ensureLocalAgentProjectRoot();
      const response = await fetch("/api/local-agent/project/watch/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Could not clear Watch state.");
      setWatchModeResult({ ok: true, watchers: [], events: [] });
      setWatchFilePath("");
      setAgentStatus(data.message || "Watch state cleared.");
    } catch (err: unknown) {
      setAgentStatus(`Clear Watch failed: ${errorMessage(err)}`);
    } finally {
      setProjectIqLoading(false);
    }
  }

  function downloadWatchSnapshot() {
    const lines = [
      "# PayFix Project IQ Watch Snapshot",
      "",
      `Project: ${connectedProjectPath || "Not connected"}`,
      `Captured: ${new Date().toLocaleString()}`,
      "",
      "## Watchers",
      ...(watchModeResult?.watchers?.length
        ? watchModeResult.watchers.map((watcher) => `- ${watcher.relative || watcher.file} started ${new Date(watcher.startedAt).toLocaleString()}`)
        : ["- None"]),
      "",
      "## Events",
      ...(watchModeResult?.events?.length
        ? watchModeResult.events.slice(0, 50).flatMap((event, index) => [
            `${index + 1}. ${event.relative || event.file}`,
            `   Type: ${event.eventType}`,
            `   Time: ${new Date(event.at).toLocaleString()}`,
            `   Diff: +${event.addedLines || 0} / -${event.removedLines || 0}`,
            event.analysis
              ? `   Analysis: ${event.analysis.title} (${event.analysis.confidence}% confidence, ${event.analysis.risk} risk)`
              : "   Analysis: None",
            event.analysis?.probableCause ? `   Cause: ${event.analysis.probableCause}` : "",
            event.analysis?.suggestedFix ? `   Suggested fix: ${event.analysis.suggestedFix}` : "",
            ...(event.issues || []).map((issue) => `   ${issue.severity.toUpperCase()}: ${issue.message}`),
            event.preview ? `   Preview:\n${event.preview}` : "",
            "",
          ])
        : ["- No watch events captured."]),
    ].filter((line) => line !== "");

    downloadTextFile(
      `payfix-watch-snapshot-${new Date().toISOString().slice(0, 10)}.md`,
      lines.join("\n"),
      "text/markdown",
    );
    setAgentStatus("Watch snapshot downloaded.");
  }

  async function startWatchMode(filePath = watchFilePath) {
    if (!filePath.trim()) {
      setAgentStatus("Choose a file from Project IQ or paste a full file path to watch.");
      return;
    }

    setProjectIqLoading(true);
    setAgentStatus("Starting watch mode...");

    try {
      await ensureLocalAgentProjectRoot();
      const response = await fetch("/api/local-agent/project/watch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: filePath }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Could not start watch mode.");
      setWatchFilePath(data.file || filePath);
      await refreshWatchMode();
      setAgentStatus(data.message || "Watch mode started.");
    } catch (err: unknown) {
      setAgentStatus(`Watch mode failed: ${errorMessage(err)}`);
    } finally {
      setProjectIqLoading(false);
    }
  }

  function openColorToolFromVisualTarget(target: LiveVisualTarget) {
    const backgroundLooksUseful =
      target.styles.backgroundColor &&
      target.styles.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      target.styles.backgroundColor !== "transparent";

    setCssSelector(target.selector || target.id || target.className.split(/\s+/)[0] || "");
    setCssProperty(backgroundLooksUseful ? "background-color" : "color");
    setCssColor(cssRgbToHex(backgroundLooksUseful ? target.styles.backgroundColor : target.styles.color));
    setCssFileName("globals.css");
    setSelectedCssFile("");
    setCssPreview("");
    setShowColorEditor(true);
    setAgentStatus("Color Tool opened from inspected element. Find the CSS file, preview, then apply.");
  }

  async function downloadDeviceSupportBundle() {
    setAgentStatus("Creating device support bundle...");

    try {
      const response = await fetch("/api/local-agent/device/support-bundle");
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Could not create support bundle.");

      downloadTextFile(
        `payfix-device-bundle-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(data, null, 2),
        "application/json",
      );
      setAgentStatus("Device support bundle downloaded.");
    } catch (err: unknown) {
      setAgentStatus(`Support bundle failed: ${errorMessage(err)}`);
    }
  }

  function resetColorTool() {
    setShowColorEditor(false);
    setCssFileName("");
    setCssSelector("");
    setCssProperty("color");
    setCssColor("#2563eb");
    setCssFileMatches([]);
    setSelectedCssFile("");
    setCssPreview("");
  }

  function resetRunner() {
    setShowRunner(false);
    setRunnerMode("js");
    setRunnerLanguage("javascript");
    setRunnerHtml("");
    setRunnerCss("");
    setRunnerJs("");
    setRunnerUnsupportedMessage("");
    setRunnerRefreshKey(0);
  }

  function resetApplyModal() {
    setShowApplyModal(false);
    setApplyFilePath("");
    setApplyMode("insert");
    setApplySearchContent("");
    setApplyNewContent("");
    setApplyDescription("");
    setApplyPatchSet([]);
    setApplyAllLoading(false);
    setDiffOldContent("");
    setDiffNewContent("");
    setApplyPreviewKey("");
  }

  async function installProposedDependency() {
    if (!dependencyProposal?.needed) return;

    setDependencyInstalling(true);
    setAgentStatus(`Installing ${dependencyProposal.packageName}...`);

    try {
      const response = await fetch("/api/local-agent/project/install-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageName: dependencyProposal.packageName,
          dev: dependencyProposal.devDependency,
        }),
      });
      const responseText = await response.text();
      let data: { ok?: boolean; error?: string; command?: string } = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          response.status === 404
            ? "The running local agent is old and does not have the install endpoint. Stop the process using port 7777, then restart payfix-agent."
            : `Local agent returned a non-JSON response: ${responseText.slice(0, 120)}`,
        );
      }

      if (!data.ok) {
        throw new Error(
          data.error ||
            (response.status === 404
              ? "The running local agent is old and does not have the install endpoint. Stop the process using port 7777, then restart payfix-agent."
              : "Package install failed."),
        );
      }

      const installMessage: ChatMessage = {
        role: "assistant",
        content: `Dependency installed.\n\nPackage: ${dependencyProposal.packageName}\nCommand: ${data.command}`,
      };
      const nextMessages = [...messages, installMessage];
      setMessages(nextMessages);
      saveActiveChat(nextMessages);
      setDependencyProposal(null);
      setAgentStatus(`Installed ${dependencyProposal.packageName}.`);
    } catch (err: unknown) {
      setAgentStatus(`Dependency install failed: ${errorMessage(err)}`);
    } finally {
      setDependencyInstalling(false);
    }
  }

  function loadAgentPatchIntoApplyModal(data: AgentApiResponse) {
    const patch = data.result?.patch;
    if (!(data.patchReady && patch && patch.mode !== "none" && data.preview?.ok)) {
      return false;
    }

    const apiPatchSet = data.result?.patchSet || data.patchSet || [];
    setApplyFilePath(patch.file);
    setApplyMode(patch.mode);
    setApplySearchContent(patch.search);
    setApplyNewContent(patch.replacement);
    setApplyDescription(
      [
        data.result?.findings?.length ? `Findings:\n${data.result.findings.map((finding) => `- ${finding}`).join("\n")}` : "",
        patch.explanation ? `Fix:\n${patch.explanation}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    setDiffOldContent(data.preview.oldContent || "");
    setDiffNewContent(data.preview.newContent || "");
    setApplyPatchSet(
      apiPatchSet.length > 1
        ? apiPatchSet.map((item) => ({
            fileCandidate: item.file,
            resolvedFile: item.file,
            mode: item.mode === "replace" ? "replace" : "insert",
            search: item.search,
            replacement: item.replacement,
          }))
        : [],
    );
    setApplyPreviewKey(
      makeApplyPreviewKey({
        file: patch.file,
        mode: patch.mode,
        search: patch.search,
        content: patch.replacement,
      }),
    );
    setShowApplyModal(true);
    return true;
  }

  function makeApplyPreviewKey({
    file,
    mode,
    search,
    content,
  }: {
    file: string;
    mode: "insert" | "replace" | "overwrite";
    search: string;
    content: string;
  }) {
    return JSON.stringify({
      file: file.trim(),
      mode,
      search,
      content,
    });
  }

  function currentApplyPreviewKey() {
    return makeApplyPreviewKey({
      file: applyFilePath,
      mode: applyMode,
      search: applySearchContent,
      content: applyNewContent,
    });
  }

  function invalidateApplyPreview() {
    setApplyPreviewKey("");
    setDiffOldContent("");
    setDiffNewContent("");
  }

  function appendAssistantStatusMessage(content: string) {
    const statusMessage: ChatMessage = {
      role: "assistant",
      content,
    };
    setMessages((currentMessages) => {
      const nextMessages = [...currentMessages, statusMessage];
      saveActiveChat(nextMessages);
      return nextMessages;
    });
  }

  function closeAgentSessionAndSave() {
    if (!agentSessionMessages.some((message) => message.role === "assistant")) {
      setAgentSessionOpen(false);
      return;
    }

    const firstUser = agentSessionMessages.find((message) => message.role === "user")?.content || "PayFix investigation";
    const lastAssistant = [...agentSessionMessages].reverse().find((message) => message.role === "assistant")?.content || "";
    const agentSummary: ChatMessage = {
      role: "assistant",
      isAgentSessionSummary: true,
      agentSessionMessages,
      content: `PAYFIX INVESTIGATION SAVED

Investigation question:
${firstUser.slice(0, 700)}

Latest investigation result:
${lastAssistant.slice(0, 1400)}

Reopen this saved investigation to continue the project review, upload more evidence, or ask PayFix to revise the fix.`,
    };

    setMessages((currentMessages) => {
      const existingIndex = currentMessages.findIndex(
        (message) =>
          message.isAgentSessionSummary &&
          message.agentSessionMessages?.[0]?.content === agentSessionMessages[0]?.content,
      );
      const nextMessages =
        existingIndex >= 0
          ? currentMessages.map((message, index) => (index === existingIndex ? agentSummary : message))
          : [...currentMessages, agentSummary];
      saveActiveChat(nextMessages);
      return nextMessages;
    });
    setAgentSessionOpen(false);
    setAgentStatus("PayFix investigation saved to this chat.");
  }

  function cancelApplyModal() {
    const fileName = applyFilePath.split(/[\\/]/).pop() || applyFilePath || "the selected file";
    setShowApplyModal(false);
    setAgentStatus("Patch canceled. No files were changed.");
    appendAssistantStatusMessage(
      `PATCH CANCELED\n\nNo files were changed. The preview for ${fileName} was closed without applying.`,
    );
  }

  function clearAttachments() {
    setLog("");
    setCode("");
    setProjectPath("");
    setConnectedProjectPath("");
    setProjectContext("");
    setProjectMatches([]);
    setLoadedProjectFiles([]);
    setComputerSearchResults("");
    setComputerSearchPreview("");
    setUploadedFiles([]);
    setSearchFolder("");
    setSearchFileName("");
    setSearchText("");
    setAgentStatus("Attachments cleared.");
  }

  function clearOneShotContextAfterSubmit() {
    setLog("");
    setCode("");
    setProjectContext("");
    setProjectMatches([]);
    setLoadedProjectFiles([]);
    setComputerSearchResults("");
    setComputerSearchPreview("");
    setUploadedFiles([]);
    setSearchFileName("");
    setSearchText("");
  }

  function saveChats(chats: SavedChat[]) {
    setSavedChats(chats);
    window.setTimeout(() => {
      localStorage.setItem("payfix_saved_chats", JSON.stringify(chats));
    }, 0);
  }

  function saveActiveChat(nextMessages: ChatMessage[]) {
    if (!nextMessages.length) {
      saveChats(savedChats.filter((chatItem) => chatItem.id !== activeChatId));
      return;
    }

    const firstUser = nextMessages.find((message) => message.role === "user")?.content || "New chat";
    const chat: SavedChat = {
      id: activeChatId,
      title: firstUser === "Analyze attached context." ? "Attached context analysis" : firstUser.slice(0, 60),
      createdAt: new Date().toLocaleString(),
      messages: nextMessages,
    };

    saveChats([chat, ...savedChats.filter((chatItem) => chatItem.id !== activeChatId)]);
  }

  function newChat() {
    localStorage.removeItem("payfix_active_draft");
    setActiveChatId(crypto.randomUUID());
    startTransition(() => {
      setMessages([]);
    });
    setQuestion("");
    clearAttachments();
    resetColorTool();
    resetRunner();
    resetApplyModal();
    setDependencyProposal(null);
    setAgentStatus("New chat started.");
  }

  function openSavedChat(chat: SavedChat) {
    setActiveChatId(chat.id);
    startTransition(() => {
      setMessages(chat.messages);
    });
    setAgentStatus(`Opened: ${chat.title}`);
  }

  function editUserMessage(messageIndex: number) {
    const message = messages[messageIndex];
    if (!message || message.role !== "user") return;

    const retainedMessages = messages.slice(0, messageIndex);
    setEditSnapshot({
      messages,
      question,
      log,
      code,
      projectPath,
      connectedProjectPath,
      projectContext,
      computerSearchResults,
      computerSearchPreview,
      searchFolder,
      searchFileName,
      searchText,
      uploadedFiles,
    });
    setMessages(retainedMessages);
    setQuestion(message.content);
    setLog(message.attachedLog || "");
    setCode(message.attachedCode || "");
    setUploadedFiles(message.attachedUploads || []);
    setPendingQuestion("");
    setPendingUploads([]);
    setLoading(false);
    setAgentLoading(false);
    setTimelineLoading(false);
    setDependencyProposal(null);
    resetApplyModal();
    setAgentStatus("Editing message. Add text, screenshots, or files, then send again.");
    saveActiveChat(retainedMessages);
    localStorage.setItem(
      "payfix_active_draft",
      JSON.stringify({
        question: message.content,
        log: message.attachedLog || "",
        code: message.attachedCode || "",
        projectPath,
        connectedProjectPath,
        projectContext,
        searchFolder,
        searchFileName,
        searchText,
        computerSearchResults,
        computerSearchPreview,
        uploadedFiles: message.attachedUploads || [],
        messages: retainedMessages,
        activeChatId,
      }),
    );
  }

  function cancelEditMessage() {
    if (!editSnapshot) return;

    setMessages(editSnapshot.messages);
    setQuestion(editSnapshot.question);
    setLog(editSnapshot.log);
    setCode(editSnapshot.code);
    setProjectPath(editSnapshot.projectPath);
    setConnectedProjectPath(editSnapshot.connectedProjectPath);
    setProjectContext(editSnapshot.projectContext);
    setComputerSearchResults(editSnapshot.computerSearchResults);
    setComputerSearchPreview(editSnapshot.computerSearchPreview);
    setSearchFolder(editSnapshot.searchFolder);
    setSearchFileName(editSnapshot.searchFileName);
    setSearchText(editSnapshot.searchText);
    setUploadedFiles(editSnapshot.uploadedFiles);
    setPendingQuestion("");
    setPendingUploads([]);
    setLoading(false);
    setAgentLoading(false);
    setTimelineLoading(false);
    setEditSnapshot(null);
    saveActiveChat(editSnapshot.messages);
    setAgentStatus("Edit canceled.");
  }

  function deleteSavedChat(id: string) {
    saveChats(savedChats.filter((chat) => chat.id !== id));

    if (activeChatId === id) {
      setActiveChatId(crypto.randomUUID());
      setMessages([]);
      setQuestion("");
      clearAttachments();
      setAgentStatus("Deleted current chat.");
    }

    setChatToDelete(null);
  }

  async function connectProject() {
    const trimmedProjectPath = projectPath.trim();

    if (!trimmedProjectPath) {
      setAgentStatus("Enter a project path before connecting.");
      return;
    }

    try {
      const res = await fetch("/api/local-agent/set-root", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: trimmedProjectPath }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setProjectPath(data.root);
      setConnectedProjectPath(data.root);
      setAgentStatus(`Connected: ${data.root}`);
    } catch (err: unknown) {
      setConnectedProjectPath("");
      setProjectContext("");
      setProjectMatches([]);
      setLoadedProjectFiles([]);
      setAgentStatus(`Failed: ${errorMessage(err)}`);
    }
  }

  function updateProjectPath(value: string) {
    setProjectPath(value);

    if (connectedProjectPath && value.trim() !== connectedProjectPath) {
      setConnectedProjectPath("");
      setProjectContext("");
      setProjectMatches([]);
      setLoadedProjectFiles([]);
    }
  }

  async function searchComputer() {
    try {
      const res = await fetch("/api/local-agent/computer/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root: searchFolder || "C:\\Users\\mekstein",
          fileName: searchFileName || "",
          query: searchText || "",
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      const rawResults = JSON.stringify(data.results, null, 2);
      const previewResults = data.results
        .map((result: ComputerSearchResult) => {
          const shortText = typeof result.text === "string" ? result.text.slice(0, 350) : "";
          return `TYPE: ${result.type}\nFILE: ${result.file}\nLINE: ${result.line}\nPREVIEW:\n${shortText}${
            (result.text?.length || 0) > 350 ? "\n...[hidden from UI but sent to AI]" : ""
          }`;
        })
        .join("\n\n");

      setComputerSearchResults(rawResults);
      setComputerSearchPreview(previewResults || `No results found. Searched ${data.searchedFiles} files.`);
      setAgentStatus(`Computer search complete: ${data.results.length} result(s). Full content attached for AI.`);
    } catch (err: unknown) {
      setAgentStatus(`Computer search failed: ${errorMessage(err)}`);
    }
  }

  async function loadProjectContext() {
    if (!connectedProjectPath) {
      setAgentStatus("Connect a valid project path before using project files.");
      return;
    }

    try {
      const res = await fetch("/api/local-agent/project/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      const context = data.matches
        .map((match: ProjectMatch) => `FILE: ${match.file}\nLINE: ${match.line}\nCODE: ${match.text}`)
        .join("\n\n");
      setProjectContext(context || "No matching project context found.");
      setProjectMatches(data.matches || []);
      setAgentStatus(`Loaded ${data.matches.length} matching lines from project.`);
    } catch (err: unknown) {
      setAgentStatus(`Failed: ${errorMessage(err)}`);
    }
  }

  async function loadFileList() {
    try {
      const res = await fetch("/api/local-agent/files");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      return data.files
        .map((item: ProjectFileListItem) => {
          if (typeof item === "string") return `FILE: ${item}`;

          return `FILE: ${item.file}
PROCESSABLE_BY_AGENT: ${item.readable ? "yes" : "no"}
TEXT_SEARCHABLE: ${item.textSearchable ? "yes" : "no"}
MIME: ${item.mime || "unknown"}
SIZE: ${item.size || 0} bytes`;
        })
        .join("\n");
    } catch {
      return "";
    }
  }

  async function ensureLocalAgentRoot(pathToConnect: string) {
    const trimmed = pathToConnect.trim();
    if (!trimmed) throw new Error("No project path is connected.");

    const res = await fetch("/api/local-agent/set-root", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: trimmed }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Could not reconnect local agent to project.");
    setConnectedProjectPath(data.root);
    setProjectPath(data.root);
    return data.root as string;
  }

  async function loadRelevantProjectFiles(projectQuery: string) {
    if (!connectedProjectPath) {
      return {
        files: [] as ProjectFileContent[],
        fileContent: "",
        fileCount: 0,
      };
    }

    const readRes = await fetch("/api/local-agent/project/read-relevant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: projectQuery }),
    });
    const readData: ProjectReadResponse = await readRes.json();
    if (!readData.ok) throw new Error(readData.error || "Could not load project files.");

    const files = readData.files || [];
    setLoadedProjectFiles(files);

    return {
      files,
      fileCount: readData.filesRead || files.length || 0,
      fileContent: files
        .map((file: ProjectFileContent) => {
          if (file.kind === "text") {
            return `FILE: ${file.file}\nTYPE: text\nCONTENT:\n${file.content || ""}`;
          }

          return `FILE: ${file.file}\nTYPE: ${file.kind || "unknown"}\nMIME: ${file.mime || "unknown"}\nSIZE: ${
            file.size || 0
          } bytes\nENCODING: ${file.encoding || "none"}\n${file.note ? `NOTE: ${file.note}\n` : ""}${
            file.base64 ? "BINARY CONTENT INCLUDED STRUCTURED IN projectFiles PAYLOAD." : "NO BINARY CONTENT INCLUDED."
          }`;
        })
        .join("\n\n"),
    };
  }

  async function handleUpload(files: FileList | null) {
    if (!files) return;

    const loaded: UploadedFile[] = [];
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith("image/");
      loaded.push({
        name: file.name,
        type: file.type || "unknown",
        size: file.size,
        content: await readBrowserFile(file, isImage),
        isImage,
      });
    }

    setUploadedFiles((prev) => [...prev, ...loaded]);
    setAgentStatus(`${loaded.length} file(s) uploaded and attached for AI.`);
  }

  async function handleAgentSessionUpload(files: FileList | null) {
    if (!files) return;

    const loaded: UploadedFile[] = [];
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith("image/");
      loaded.push({
        name: file.name,
        type: file.type || "unknown",
        size: file.size,
        content: await readBrowserFile(file, isImage),
        isImage,
      });
    }

    setAgentSessionUploads((prev) => [...prev, ...loaded]);
    setAgentStatus(`${loaded.length} file(s) added to Agent workspace.`);
  }

  function removeAgentSessionUpload(index: number) {
    setAgentSessionUploads((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  function removeUpload(index: number) {
    setUploadedFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  async function findCssFile() {
    if (!connectedProjectPath) {
      setAgentStatus("Connect a project path first before finding CSS files.");
      return;
    }

    if (!cssFileName.trim()) {
      setAgentStatus("Enter a CSS file name first, like globals.css.");
      return;
    }

    try {
      const res = await fetch("/api/local-agent/project/find-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: cssFileName }),
      });

      const data = await res.json();
      if (!data.ok) {
        setAgentStatus(data.error || "Could not find CSS file.");
        return;
      }

      setCssFileMatches(data.matches || []);
      if (data.matches?.length === 1) {
        setSelectedCssFile(data.matches[0]);
        setAgentStatus(`Found 1 file: ${data.matches[0]}`);
      } else {
        setAgentStatus(`Found ${data.matches.length} matching file(s).`);
      }
    } catch (err: unknown) {
      setAgentStatus(errorMessage(err, "Find CSS file failed."));
    }
  }

  async function previewCssColor() {
    try {
      const data = await requestCssColor(false);
      if (!data.ok) {
        setAgentStatus(data.error);
        return;
      }

      setCssPreview(data.preview);
      setAgentStatus(data.message || "Preview ready.");
    } catch (err: unknown) {
      setAgentStatus(errorMessage(err, "Preview failed."));
    }
  }

  async function applyCssColor() {
    try {
      const data = await requestCssColor(true);
      if (!data.ok) {
        setAgentStatus(data.error || "Failed to apply CSS color.");
        return;
      }

      setAgentStatus(data.message || "CSS color applied successfully.");
      setCssPreview(data.preview || "");
    } catch (err: unknown) {
      setAgentStatus(errorMessage(err, "Apply CSS color failed."));
    }
  }

  async function requestCssColor(apply: boolean) {
    const res = await fetch("/api/local-agent/project/apply-css-color", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: selectedCssFile,
        selector: cssSelector,
        property: cssProperty,
        color: cssColor,
        apply,
      }),
    });
    return res.json();
  }

  async function previewFileChange() {
    try {
      const data = await requestFileChange(false);
      if (!data.ok) {
        setAgentStatus(data.error || "Failed loading preview.");
        return;
      }

      setDiffOldContent(data.oldContent || "");
      setDiffNewContent(data.newContent || "");
      setApplyPreviewKey(currentApplyPreviewKey());
      setAgentStatus("Preview loaded. Review before applying.");
    } catch (err: unknown) {
      setAgentStatus(errorMessage(err, "Preview failed."));
    }
  }

  async function applyFileChange() {
    try {
      if (applyPreviewKey !== currentApplyPreviewKey()) {
        setAgentStatus("Preview the current diff before applying. The change inputs were edited after preview.");
        return;
      }

      const data = await requestFileChange(true);
      if (!data.ok) {
        setAgentStatus(data.error || "Failed applying changes.");
        return;
      }

      if (data.rollback?.id) {
        setLastRollback(data.rollback as RollbackSnapshot);
      }
      setShowApplyModal(false);
      setAgentStatus("Changes applied. Re-reading file and validating fix...");
      appendAssistantStatusMessage(`PATCH APPLIED\n\nUpdated ${applyFilePath}. PayFix is re-reading and validating the change.`);
      await validateAppliedFileChange();
    } catch (err: unknown) {
      setAgentStatus(errorMessage(err, "Apply failed."));
    }
  }

  async function runPostApplySandboxChecks() {
    if (!connectedProjectPath) {
      return "Sandbox checks were not run because no project is connected.";
    }

    try {
      await ensureLocalAgentProjectRoot();
      const sandboxRes = await fetch("/api/local-agent/project/sandbox-runner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checks: ["typescript", "lint", "test", "build"] }),
      });
      const sandboxData = (await sandboxRes.json()) as SandboxRunnerResult;
      setSandboxRunnerResult(sandboxData);

      if (sandboxData.ok) {
        return "Sandbox checks passed or were safely skipped.";
      }

      const commandSummary =
        sandboxData.commands
          ?.map((command) => `${command.ok ? "PASS" : "FAIL"} ${command.command}`)
          .join("\n") || sandboxData.error || "see Project IQ.";
      return `Sandbox checks found failures:\n${commandSummary}`;
    } catch (err: unknown) {
      return `Sandbox checks could not run: ${errorMessage(err)}`;
    }
  }

  async function rereadAppliedFiles(files: string[]) {
    const uniqueFiles = [...new Set(files.filter(Boolean))];
    const results = await Promise.all(
      uniqueFiles.map(async (file) => {
        const readRes = await fetch("/api/local-agent/project/read-file-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file }),
        });
        const readData = await readRes.json();
        if (!readData.ok) {
          return { file, ok: false, summary: readData.error || "Could not re-read file." };
        }

        const kind = readData.file?.kind || "unknown";
        const size = readData.file?.size || 0;
        const lineCount =
          readData.file?.kind === "text" && typeof readData.file?.content === "string"
            ? readData.file.content.split(/\r?\n/).length
            : 0;

        return {
          file,
          ok: true,
          summary: kind === "text" ? `${lineCount} line(s), ${size} byte(s)` : `${kind}, ${size} byte(s)`,
        };
      }),
    );

    return results;
  }

  async function applyAllFileChanges() {
    const uniquePatchSet = applyPatchSet.filter(
      (item, index, items) =>
        item.resolvedFile &&
        items.findIndex(
          (candidate) =>
            candidate.resolvedFile === item.resolvedFile &&
            candidate.mode === item.mode &&
            candidate.search === item.search &&
            candidate.replacement === item.replacement,
        ) === index,
    );

    if (uniquePatchSet.length < 2) {
      await applyFileChange();
      return;
    }

    setApplyAllLoading(true);
    setAgentStatus(`Previewing ${uniquePatchSet.length} file changes...`);

    try {
      const previews = await Promise.all(
        uniquePatchSet.map(async (item) => {
          const data = await requestFileChangeWithValues({
            apply: false,
            file: item.resolvedFile,
            mode: item.mode,
            search: item.search,
            content: item.replacement,
          });

          if (!data.ok) {
            throw new Error(`${item.resolvedFile}: ${data.error || "Preview failed."}`);
          }

          return data;
        }),
      );

      for (const item of uniquePatchSet) {
        const applyResult = await requestFileChangeWithValues({
            apply: true,
            file: item.resolvedFile,
            mode: item.mode,
            search: item.search,
            content: item.replacement,
        });

        if (!applyResult.ok) {
          throw new Error(`${item.resolvedFile}: ${applyResult.error || "Apply failed."}`);
        }
        if (applyResult.rollback?.id) {
          setLastRollback(applyResult.rollback as RollbackSnapshot);
        }
      }

      setDiffOldContent(previews.map((preview) => `FILE: ${preview.file}\n\n${preview.oldContent || ""}`).join("\n\n---\n\n"));
      setDiffNewContent(previews.map((preview) => `FILE: ${preview.file}\n\n${preview.newContent || ""}`).join("\n\n---\n\n"));
      setShowApplyModal(false);
      setAgentStatus(`Applied ${uniquePatchSet.length} file changes. Re-reading and validating...`);
      const rereadResults = await rereadAppliedFiles(uniquePatchSet.map((item) => item.resolvedFile));
      const sandboxSummary = await runPostApplySandboxChecks();
      appendAssistantStatusMessage(
        `PATCH APPLIED\n\nUpdated ${uniquePatchSet.length} file(s):\n${uniquePatchSet
          .map((item) => `- ${item.resolvedFile}`)
          .join("\n")}\n\nRE-READ CHECK\n${rereadResults
          .map((result) => `- ${result.ok ? "PASS" : "FAIL"} ${result.file}: ${result.summary}`)
          .join("\n")}\n\nSANDBOX CHECKS\n\n${sandboxSummary}`,
      );
      setAgentStatus("All changes applied, re-read, and validated.");
    } catch (err: unknown) {
      setAgentStatus(`Apply all failed before writing all changes: ${errorMessage(err)}`);
    } finally {
      setApplyAllLoading(false);
    }
  }

  async function validateAppliedFileChange() {
    try {
      const readRes = await fetch("/api/local-agent/project/read-file-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: applyFilePath }),
      });
      const readData = await readRes.json();
      if (!readData.ok) throw new Error(readData.error || "Could not re-read updated file.");

      const updatedContent =
        readData.file?.kind === "text"
          ? readData.file.content || ""
          : `Non-text file updated. Kind: ${readData.file?.kind || "unknown"}, MIME: ${readData.file?.mime || "unknown"}`;

      const validateRes = await fetch("/api/validate-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question || [...messages].reverse().find((message) => message.role === "user")?.content || "",
          file: applyFilePath,
          appliedChange: applyNewContent,
          updatedContent,
        }),
      });
      const validateData = await validateRes.json();
      if (!validateData.ok) throw new Error(validateData.error || "Validation failed.");

      const sandboxSummary = await runPostApplySandboxChecks();

      appendAssistantStatusMessage(`PATCH VALIDATION\n\n${validateData.result}\n\nSANDBOX CHECKS\n\n${sandboxSummary}`);
      setAgentStatus("Changes applied and validated.");
    } catch (err: unknown) {
      setAgentStatus(`Changes applied, but validation failed: ${errorMessage(err)}`);
    }
  }

  async function rollbackLastAppliedChange() {
    if (!lastRollback) return;

    setRollbackLoading(true);
    setAgentStatus(`Rolling back ${lastRollback.relative || lastRollback.file}...`);

    try {
      const response = await fetch("/api/local-agent/project/rollback/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lastRollback.id }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Rollback failed.");

      appendAssistantStatusMessage(`PATCH ROLLED BACK\n\n${data.message || `Restored ${lastRollback.relative || lastRollback.file}.`}`);
      setLastRollback(null);
      setAgentStatus(data.message || "Rollback complete.");
    } catch (err: unknown) {
      setAgentStatus(`Rollback failed: ${errorMessage(err)}`);
    } finally {
      setRollbackLoading(false);
    }
  }

  async function requestFileChange(apply: boolean) {
    return requestFileChangeWithValues({
      apply,
      file: applyFilePath,
      mode: applyMode,
      search: applySearchContent,
      content: applyNewContent,
    });
  }

  async function requestFileChangeWithValues({
    apply,
    file,
    mode,
    search,
    content,
  }: {
    apply: boolean;
    file: string;
    mode: "insert" | "replace" | "overwrite";
    search: string;
    content: string;
  }) {
    const res = await fetch("/api/local-agent/project/preview-write-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file,
        mode,
        search,
        content,
        apply,
      }),
    });
    return res.json();
  }

  function isLikelyApplyFilePath(value: string) {
    const clean = value.trim().replace(/^["'`]|["'`]$/g, "");
    if (!clean) return false;
    if (/[.?!]\s/.test(clean)) return false;

    return (
      /^[A-Za-z]:[\\/].+\.[A-Za-z0-9]+$/.test(clean) ||
      /^(?:\.{1,2}[\\/])?(?:[\w .-]+[\\/])*[\w .-]+\.(?:ts|tsx|js|jsx|css|scss|html|json|cs|txt|md)$/i.test(clean)
    );
  }

  function parseApplyBlocks(content: string, fullMessage: string) {
    const clickedCode = content.trim();
    const replaceSections = parseReplaceSections(fullMessage);
    const matchingReplaceSection =
      replaceSections.find((match) => match[2]?.trim() === clickedCode || match[3]?.trim() === clickedCode) ||
      replaceSections[0];

    const fencedBlocks = [...fullMessage.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
    const clickedBlock = fencedBlocks.find((match) => match[1]?.trim() === clickedCode);
    const textBeforeClickedBlock =
      clickedBlock && typeof clickedBlock.index === "number" ? fullMessage.slice(0, clickedBlock.index) : fullMessage;
    const nearestFileBeforeClickedBlock = [...textBeforeClickedBlock.matchAll(/^FILE:\s*`?([^\n`]+)`?\s*$/gim)].pop();
    const nearestInsertBeforeClickedBlock = [
      ...textBeforeClickedBlock.matchAll(/(?:INSERT|ADD|APPEND)\s+(?:INTO|TO)\s+FILE:\s*`?([^\n`]+)`?/gim),
    ].pop();

    const fallbackFileMatch =
      fullMessage.match(/^FILE:\s*`?([^\n`]+)`?\s*$/im) ||
      fullMessage.match(/([A-Za-z]:[\\/][^\n`'")]+\.[A-Za-z0-9]+)/) ||
      fullMessage.match(/\b((?:[\w .-]+[\\/])*[\w .-]+\.(?:ts|tsx|js|jsx|css|scss|html|json|cs|txt|md))\b/i);

    const replaceFileCandidate = matchingReplaceSection?.[1] || "";
    const insertFileCandidate =
      nearestInsertBeforeClickedBlock?.[1] || nearestFileBeforeClickedBlock?.[1] || fallbackFileMatch?.[1] || "";
    const isClickedReplacePatch = Boolean(
      matchingReplaceSection &&
        (matchingReplaceSection[2]?.trim() === clickedCode || matchingReplaceSection[3]?.trim() === clickedCode),
    );
    const isReplace = isClickedReplacePatch;
    const fileCandidate = (isReplace ? replaceFileCandidate : insertFileCandidate)
      .trim()
      .replace(/^["'`]|["'`]$/g, "");
    const isInsert = !isReplace && Boolean(fileCandidate && clickedCode);
    const canApply = Boolean((isReplace || isInsert) && isLikelyApplyFilePath(fileCandidate));

    return {
      canApply,
      fileCandidate,
      mode: isReplace ? ("replace" as const) : ("insert" as const),
      search: isReplace ? matchingReplaceSection?.[2]?.trim() || "" : "",
      replacement: isReplace ? matchingReplaceSection?.[3]?.trim() || clickedCode : clickedCode,
    };
  }

  function parseReplaceSections(fullMessage: string) {
    return [
      ...fullMessage.matchAll(
        /FILE:\s*`?([^\n`]+)`?[\s\S]*?REPLACE THIS:\s*```[^\n]*\n([\s\S]*?)```\s*WITH THIS:\s*```[^\n]*\n([\s\S]*?)```/gi,
      ),
    ];
  }

  function parseApplyPatchSet(fullMessage: string) {
    return parseReplaceSections(fullMessage)
      .map((match) => ({
        fileCandidate: (match[1] || "").trim().replace(/^["'`]|["'`]$/g, ""),
        resolvedFile: "",
        mode: "replace" as const,
        search: match[2]?.trim() || "",
        replacement: match[3]?.trim() || "",
      }))
      .filter((item) => item.fileCandidate && item.search && item.replacement && isLikelyApplyFilePath(item.fileCandidate));
  }

  async function resolveApplyFilePath(candidate: string) {
    const clean = candidate.trim();
    if (!clean) return "";
    if (/^[A-Za-z]:[\\/]/.test(clean)) return clean;

    const normalizedCandidate = clean.replace(/\//g, "\\");
    if (connectedProjectPath && normalizedCandidate.includes("\\")) {
      return `${connectedProjectPath.replace(/[\\/]+$/, "")}\\${normalizedCandidate.replace(/^[\\/]+/, "")}`;
    }

    if (connectedProjectPath) {
      try {
        const res = await fetch("/api/local-agent/project/find-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: clean.split(/[\\/]/).pop() || clean }),
        });
        const data = await res.json();
        if (data.ok && data.matches?.length) {
          return data.matches[0];
        }
      } catch {
        return clean;
      }
    }

    return clean;
  }

  async function openApplyModal(content: string, fullMessage: string) {
    const parsed = parseApplyBlocks(content, fullMessage);
    const parsedPatchSet = parseApplyPatchSet(fullMessage);

    if (!parsed.canApply) {
      setAgentStatus(
        "Apply needs a real file path plus either exact REPLACE THIS / WITH THIS blocks or an INSERT INTO FILE instruction.",
      );
      return;
    }

    const resolvedFile = await resolveApplyFilePath(parsed.fileCandidate);
    const resolvedPatchSet = (
      await Promise.all(
        parsedPatchSet.map(async (item) => ({
          ...item,
          resolvedFile: await resolveApplyFilePath(item.fileCandidate),
        })),
      )
    ).filter((item) => item.resolvedFile && isLikelyApplyFilePath(item.resolvedFile));

    if (!resolvedFile || !isLikelyApplyFilePath(resolvedFile)) {
      setAgentStatus("Apply could not resolve a safe project file path for this patch.");
      return;
    }

    setApplyMode(parsed.mode);
    setApplySearchContent(parsed.search);
    setApplyNewContent(parsed.replacement);
    setApplyFilePath(resolvedFile);
    setApplyDescription("");
    setApplyPatchSet(
      resolvedPatchSet.some((item) => item.resolvedFile === resolvedFile)
        ? resolvedPatchSet
        : [
            ...resolvedPatchSet,
            {
              fileCandidate: parsed.fileCandidate,
              resolvedFile,
              mode: parsed.mode,
              search: parsed.search,
              replacement: parsed.replacement,
            },
          ],
    );
    setDiffOldContent("");
    setDiffNewContent("");
    setApplyPreviewKey("");
    setShowApplyModal(true);

    if (resolvedFile) {
      try {
        const data = await requestFileChangeWithValues({
          apply: false,
          file: resolvedFile,
          mode: parsed.mode,
          search: parsed.search,
          content: parsed.replacement,
        });

        if (data.ok) {
          setDiffOldContent(data.oldContent || "");
          setDiffNewContent(data.newContent || "");
          setApplyPreviewKey(
            makeApplyPreviewKey({
              file: resolvedFile,
              mode: parsed.mode,
              search: parsed.search,
              content: parsed.replacement,
            }),
          );
          setAgentStatus("Preview loaded. Review before applying.");
        } else {
          setAgentStatus(data.error || "Failed loading preview.");
        }
      } catch (err: unknown) {
        setAgentStatus(errorMessage(err, "Preview failed."));
      }
    }
  }

  function openRunnerFromCode(codeString: string, language: string) {
    const lang = (language || "text").toLowerCase();
    resetRunner();
    setRunnerLanguage(lang);

    if (lang === "html" || codeString.includes("<html") || codeString.includes("<body") || codeString.includes("<script")) {
      const parts = splitFullHtml(codeString);
      setRunnerMode("html");
      setRunnerHtml(parts.html || "<div>HTML Preview</div>");
      setRunnerCss(parts.css);
      setRunnerJs(parts.js);
      setShowRunner(true);
      return;
    }

    if (lang === "css") {
      setRunnerMode("css");
      setRunnerHtml(`<div class="preview-box">CSS Preview</div>\n<button class="btn">Button Preview</button>`);
      setRunnerCss(codeString);
      setRunnerJs("");
      setShowRunner(true);
      return;
    }

    if (["js", "javascript", "ts", "typescript"].includes(lang)) {
      setRunnerMode("js");
      setRunnerHtml(`<div id="app">JavaScript Output</div>`);
      setRunnerCss("");
      setRunnerJs(codeString);
      setShowRunner(true);
      return;
    }

    setRunnerMode("unsupported");
    setRunnerHtml("");
    setRunnerCss("");
    setRunnerJs(codeString);
    setRunnerUnsupportedMessage(unsupportedInstructions(lang, codeString));
    setShowRunner(true);
  }

  async function analyze(options: { referencedUploads?: UploadedFile[] } = {}) {
    const isReplyMode = messages.length > 0;
    if (isReplyMode && !question.trim()) {
      setAgentStatus("Please type a message before sending.");
      return;
    }

    if (!canSend) return;
    const resolvedUploads = resolveReferencedUploads(options.referencedUploads);
    if (resolvedUploads === null) return;

    const submittedQuestion = question;
    const submittedLog = log;
    const submittedCode = code;
    const submittedUploadedFiles = resolvedUploads;
    const submittedComputerSearchResults = computerSearchResults;
    const submittedProjectContext = projectContext;
    const submittedConnectedProjectPath = connectedProjectPath;

    setPendingQuestion(submittedQuestion);
    setPendingUploads(submittedUploadedFiles);
    setQuestion("");
    clearOneShotContextAfterSubmit();
    setLoading(true);

    const userContent =
      submittedQuestion.trim() ||
      (submittedLog.trim() ? "Analyze this payment log / error." : "") ||
      (submittedCode.trim() ? "Analyze this code." : "") ||
      (submittedUploadedFiles.length ? "Analyze uploaded file(s)." : "") ||
      (submittedComputerSearchResults ? "Analyze attached computer search." : "") ||
      (submittedConnectedProjectPath ? "Analyze the connected project files." : "") ||
      "Analyze attached context.";

    const decodeSource = [submittedQuestion, submittedLog, submittedCode, submittedComputerSearchResults]
      .filter(Boolean)
      .join("\n\n");
    if (wantsDecode(userContent) || wantsDecode(decodeSource)) {
      const decoded = decodePastedStrings(decodeSource || userContent);

      if (decoded.files.length) {
        const userMessage: ChatMessage = {
          role: "user",
          content: userContent,
          attachedLog: submittedLog,
          attachedCode: submittedCode,
          attachedUploads: submittedUploadedFiles,
        };
        const updatedMessages = [...messages, userMessage];
        const finalMessages: ChatMessage[] = [
          ...updatedMessages,
          {
            role: "assistant",
            content: `Decoded ${decoded.files.length} item(s).\n\n${decoded.summary.map((item) => `- ${item}`).join("\n")}`,
            generatedFiles: decoded.files,
          },
        ];

        setMessages(finalMessages);
        saveActiveChat(finalMessages);
        setEditSnapshot(null);
        setAgentStatus(`Decoded ${decoded.files.length} encoded item(s).`);
        setLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
        return;
      }
    }

    const conversionTarget = imageConversionTarget(userContent);
    if (conversionTarget && submittedUploadedFiles.some((file) => file.isImage)) {
      const userMessage: ChatMessage = {
        role: "user",
        content: userContent,
        attachedLog: submittedLog,
        attachedCode: submittedCode,
        attachedUploads: submittedUploadedFiles,
      };
      const updatedMessages = [...messages, userMessage];
      setMessages([...updatedMessages, { role: "assistant", content: `Converting image to ${conversionTarget.label}...` }]);

      try {
        const generatedFiles = await convertImagesForChat(submittedUploadedFiles, conversionTarget);
        const fileList = generatedFiles.map((file) => `- ${file.name}`).join("\n");
        const finalMessages: ChatMessage[] = [
          ...updatedMessages,
          {
            role: "assistant",
            content: `Done. I converted the image${generatedFiles.length === 1 ? "" : "s"} to ${
              conversionTarget.label
            } and attached the downloadable file${generatedFiles.length === 1 ? "" : "s"} below.\n\n${fileList}`,
            generatedFiles,
          },
        ];

        setMessages(finalMessages);
        saveActiveChat(finalMessages);
        setEditSnapshot(null);
        setAgentStatus(`Converted ${generatedFiles.length} image(s) to ${conversionTarget.label}.`);
      } catch (err: unknown) {
        const finalMessages: ChatMessage[] = [
          ...updatedMessages,
          { role: "assistant", content: `I could not convert that image: ${errorMessage(err)}` },
        ];
        setMessages(finalMessages);
        saveActiveChat(finalMessages);
        setEditSnapshot(null);
        setAgentStatus(`Image conversion failed: ${errorMessage(err)}`);
      } finally {
        setLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return;
    }

    const projectFilesForApi: ProjectFileContent[] = [];
    const liveProjectContext = submittedProjectContext;
    let projectFileList = "";
    if (submittedConnectedProjectPath) {
      try {
        await ensureLocalAgentRoot(submittedConnectedProjectPath);
        projectFileList = await loadFileList();
        setAgentStatus("Project file list loaded. AI is choosing files to inspect...");
      } catch (err: unknown) {
        setAgentStatus(`Project reconnect warning: ${errorMessage(err)}`);
      }
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: userContent,
      attachedLog: submittedLog,
      attachedCode: submittedCode,
      attachedUploads: submittedUploadedFiles,
    };
    const updatedMessages = [...messages, userMessage];
    setMessages([...updatedMessages, { role: "assistant", content: "Thinking..." }]);

    try {
      if (projectFileList) {
        setAgentStatus("AI is inspecting selected files...");
      } else {
        setAgentStatus("AI is analyzing your message...");
      }

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userContent,
          log: submittedLog,
          code: `${submittedCode}

PROJECT PATH:
${submittedConnectedProjectPath}

PROJECT FILE LIST:
${projectFileList || "No project files were listed by the local agent."}

PROJECT CONTEXT:
${liveProjectContext || "No preloaded project context. In agentic mode, AI must select files from PROJECT FILE LIST."}

COMPUTER SEARCH RESULTS:
${submittedComputerSearchResults}`,
          uploadedFiles: submittedUploadedFiles,
          projectFiles: projectFilesForApi,
          projectFileList,
          agenticProject: Boolean(submittedConnectedProjectPath && projectFileList),
          history: updatedMessages,
        }),
      });

      const data = await response.json();
      if (data.toolResults?.projectFilesLoaded?.length) {
        setAgentStatus(
          `AI inspected ${data.toolResults.projectFilesLoaded.length} selected file(s): ${data.toolResults.projectFilesLoaded
            .map((file: string) => file.split(/[\\/]/).pop())
            .join(", ")}`,
        );
      }
      const finalMessages: ChatMessage[] = [
        ...updatedMessages,
        { role: "assistant", content: data.result || "No result returned." },
      ];
      setMessages(finalMessages);
      saveActiveChat(finalMessages);
      setEditSnapshot(null);
    } catch {
      setMessages([...updatedMessages, { role: "assistant", content: "Something went wrong." }]);
    }

    setLoading(false);
    setPendingQuestion("");
    setPendingUploads([]);
  }

  async function runAgentPromptInSession({
    userContent,
    submittedLog,
    submittedCode,
    submittedUploadedFiles,
    submittedComputerSearchResults,
    resetSession,
  }: {
    userContent: string;
    submittedLog: string;
    submittedCode: string;
    submittedUploadedFiles: UploadedFile[];
    submittedComputerSearchResults: string;
    resetSession: boolean;
  }) {
    const userMessage: ChatMessage = {
      role: "user",
      content: userContent,
      attachedLog: submittedLog,
      attachedCode: submittedCode,
      attachedUploads: submittedUploadedFiles,
    };
    const baseSessionMessages = resetSession ? [userMessage] : [...agentSessionMessages, userMessage];
    setAgentSessionMessages([
      ...baseSessionMessages,
      {
        role: "assistant",
        content: connectedProjectPath
          ? "PayFix Agent is investigating: indexing the project, selecting files, reading evidence, and preparing a reviewable fix..."
          : "PayFix Agent is investigating evidence: reading uploads, logs, screenshots, and pasted context...",
      },
    ]);

    try {
      let projectFileList = "";
      if (connectedProjectPath) {
        setAgentStatus("PayFix Agent is connecting to the selected project...");
        await ensureLocalAgentRoot(connectedProjectPath);

        projectFileList = await loadFileList();
        if (!projectFileList.trim()) {
          throw new Error("Could not load the project file list from the local agent.");
        }

        setAgentStatus("PayFix Agent is choosing exact files to inspect...");
      } else {
        setAgentStatus("PayFix Agent is investigating attached evidence without project file access...");
      }

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userContent,
          history: `${recentConversationForAgent()}\n\nAGENT SESSION:\n${baseSessionMessages
            .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
            .join("\n\n")}`,
          memory: compressedAgentMemory(),
          log: submittedLog,
          code: submittedCode,
          computerSearchResults: submittedComputerSearchResults,
          uploadedFiles: submittedUploadedFiles,
          projectFileList,
        }),
      });

      const data: AgentApiResponse = await response.json();
      if (!data.ok) throw new Error(data.error || "Agent run failed.");

      if (data.dependencyProposal?.needed && data.dependencyProposal.packageName) {
        setDependencyProposal(data.dependencyProposal);
      }

      const inspectedNames = data.filesRead?.map((file) => file.name).join(", ");
      setAgentStatus(
        !connectedProjectPath
          ? "Evidence investigation complete. Connect a project to inspect or patch code."
          : data.patchReady
          ? `Project investigation complete. Patch verified after inspecting: ${inspectedNames || "selected files"}`
          : data.warning
            ? `Project investigation complete without a safe Apply preview: ${data.warning}`
            : "Project investigation complete. See the response for inspected evidence and next steps.",
      );

      const finalSessionMessages: ChatMessage[] = [
        ...baseSessionMessages,
        { role: "assistant", content: data.markdown || "PayFix investigation finished without a response." },
      ];
      setAgentSessionMessages(finalSessionMessages);
      setEditSnapshot(null);

      loadAgentPatchIntoApplyModal(data);
    } catch (err: unknown) {
      const finalSessionMessages: ChatMessage[] = [
        ...baseSessionMessages,
        { role: "assistant", content: `PayFix investigation failed: ${errorMessage(err)}` },
      ];
      setAgentSessionMessages(finalSessionMessages);
      setEditSnapshot(null);
      setAgentStatus(`PayFix investigation failed: ${errorMessage(err)}`);
      throw err;
    }
  }

  async function runAgent() {
    const isReplyMode = messages.length > 0;
    if (isReplyMode && !question.trim() && !log.trim() && !code.trim() && uploadedFiles.length === 0) {
      setAgentStatus("Please type a message or attach evidence before starting an investigation.");
      return;
    }

    if (!canSend) return;

    const submittedQuestion = question;
    const submittedLog = log;
    const submittedCode = code;
    const submittedUploadedFiles = uploadedFiles;
    const submittedComputerSearchResults = computerSearchResults;
    const userContent =
      submittedQuestion.trim() ||
      (submittedLog.trim() ? "Investigate this payment log / error." : "") ||
      (submittedCode.trim() ? "Investigate this code." : "") ||
      (submittedUploadedFiles.length ? "Investigate uploaded file(s)." : "") ||
      (submittedComputerSearchResults ? "Investigate attached computer search." : "") ||
      "Investigate the connected project.";

    resetApplyModal();
    setAgentSessionOpen(true);
    setAgentSessionMessages([]);
    setAgentSessionUploads(submittedUploadedFiles);
    setPendingQuestion(submittedQuestion);
    setPendingUploads(submittedUploadedFiles);
    setQuestion("");
    clearOneShotContextAfterSubmit();
    setLoading(true);
    setAgentLoading(true);
    setDependencyProposal(null);
    setAgentStatus(connectedProjectPath ? "PayFix Agent is indexing project files..." : "PayFix Agent is preparing an evidence investigation...");

    try {
      await runAgentPromptInSession({
        userContent,
        submittedLog,
        submittedCode,
        submittedUploadedFiles,
        submittedComputerSearchResults,
        resetSession: true,
      });
    } catch {
      // runAgentPromptInSession already updates the visible Agent session.
    } finally {
      setLoading(false);
      setAgentLoading(false);
      setPendingQuestion("");
      setPendingUploads([]);
    }
  }

  async function runAgentSessionFollowUp(prompt: string) {
    setAgentLoading(true);
    setAgentStatus(connectedProjectPath ? "PayFix Agent is continuing the project investigation..." : "PayFix Agent is continuing the evidence investigation...");

    try {
      await runAgentPromptInSession({
        userContent: prompt,
        submittedLog: "",
        submittedCode: "",
        submittedUploadedFiles: agentSessionUploads,
        submittedComputerSearchResults: "",
        resetSession: false,
      });
    } catch {
      // runAgentPromptInSession already updates the visible Agent session.
    } finally {
      setAgentLoading(false);
    }
  }

  async function runApplyAgentFollowUp(prompt: string) {
    if (!connectedProjectPath) {
      setAgentStatus("Patch investigation needs a connected project.");
      return;
    }

    const patchContext = `CURRENT PATCH REVIEW CONTEXT
Target file: ${applyFilePath || "none"}
Mode: ${applyMode}
Current search block:
${applySearchContent || "(none)"}

Current proposed content:
${applyNewContent || "(none)"}

Current findings:
${applyDescription || "(none)"}

User follow-up:
${prompt}`;

    const userMessage: ChatMessage = {
      role: "user",
      content: `Patch follow-up: ${prompt}`,
    };
    const baseMessages = [...messages, userMessage];

    setApplyAgentFollowUpLoading(true);
    setAgentStatus("PayFix Agent is revising the patch investigation with your follow-up...");
    setMessages([...baseMessages, { role: "assistant", content: "PayFix Agent is revising the current patch investigation..." }]);

    try {
      await ensureLocalAgentRoot(connectedProjectPath);
      const projectFileList = await loadFileList();
      if (!projectFileList.trim()) {
        throw new Error("Could not load the project file list from the local agent.");
      }

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: patchContext,
          history: `${recentConversationForAgent()}\n\n${patchContext}`,
          memory: compressedAgentMemory(),
          log,
          code,
          computerSearchResults,
          uploadedFiles,
          projectFileList,
        }),
      });

      const data: AgentApiResponse = await response.json();
      if (!data.ok) throw new Error(data.error || "Patch investigation follow-up failed.");

      if (data.dependencyProposal?.needed && data.dependencyProposal.packageName) {
        setDependencyProposal(data.dependencyProposal);
      }

      const finalMessages: ChatMessage[] = [
        ...baseMessages,
        { role: "assistant", content: data.markdown || "Patch investigation follow-up finished without a response." },
      ];
      setMessages(finalMessages);
      saveActiveChat(finalMessages);

      const openedPatch = loadAgentPatchIntoApplyModal(data);
      const inspectedNames = data.filesRead?.map((file) => file.name).join(", ");
      setAgentStatus(
        openedPatch
          ? `Patch investigation revised after inspecting: ${inspectedNames || "selected files"}`
          : data.warning
            ? `Patch investigation follow-up finished without a safe preview: ${data.warning}`
            : "Patch investigation follow-up complete. See the response for details.",
      );
    } catch (err: unknown) {
      const finalMessages: ChatMessage[] = [
        ...baseMessages,
        { role: "assistant", content: `Patch investigation follow-up failed: ${errorMessage(err)}` },
      ];
      setMessages(finalMessages);
      saveActiveChat(finalMessages);
      setAgentStatus(`Patch investigation follow-up failed: ${errorMessage(err)}`);
    } finally {
      setApplyAgentFollowUpLoading(false);
    }
  }

  function formatTimelineChatSummary(timeline: PaymentTimelineResult, emvOnly: boolean) {
    const rootCause = timeline.rootCauseAnalysis
      ? `\n\nROOT CAUSE\n${timeline.rootCauseAnalysis.title}\n${timeline.rootCauseAnalysis.detail}\nConfidence: ${Math.round(
          timeline.rootCauseAnalysis.confidence * 100,
        )}%`
      : "";
    const findings = timeline.investigationFindings?.length
      ? `\n\nWHAT TO LOOK AT\n${timeline.investigationFindings
          .slice(0, 5)
          .map((finding) => `- ${finding.title}: ${finding.detail} Evidence: ${finding.evidence}`)
          .join("\n")}`
      : "";
    const nextSteps = timeline.recommendedNextSteps.length
      ? `\n\nNEXT STEPS\n${timeline.recommendedNextSteps.slice(0, 4).map((step) => `- ${step}`).join("\n")}`
      : "";

    return `${emvOnly ? "EMV/TLV TROUBLESHOOTING OPENED" : "PAYMENT TIMELINE OPENED"}

${timeline.summary}${rootCause}${findings}${nextSteps}`;
  }

  async function runTimelineSource(source: TimelineSourceCandidate, clearCurrentDraft: boolean) {
    const submittedQuestion = source.question;
    const submittedLog = source.log;
    const submittedCode = source.code;
    const submittedUploadedFiles = source.uploadedFiles;
    const submittedComputerSearchResults = source.computerSearchResults;
    const submittedConnectedProjectPath = source.connectedProjectPath;
    const shouldUseSavedSearchContext = Boolean(submittedComputerSearchResults);
    const shouldUseProjectContext = source.useProjectContext && Boolean(submittedConnectedProjectPath);
    setTimelineLoading(true);
    if (clearCurrentDraft) {
      setQuestion("");
      setLog("");
      setCode("");
      setUploadedFiles([]);
    }
    setAgentStatus("Building payment trace timeline...");

    const userContent =
      submittedQuestion.trim() ||
      (submittedLog.trim() ? "Build a payment trace timeline from this payment log / error." : "") ||
      (submittedCode.trim() ? "Build a payment trace timeline from this code." : "") ||
      (submittedUploadedFiles.length ? "Build a payment trace timeline from uploaded file(s)." : "") ||
      (shouldUseSavedSearchContext ? "Build a payment trace timeline from attached computer search." : "") ||
      (shouldUseProjectContext ? "Build a payment trace timeline from the connected project files." : "") ||
      "Build a payment trace timeline from attached context.";

    const projectQuery = submittedQuestion.trim() || userContent;
    let projectFilesForApi: ProjectFileContent[] = loadedProjectFiles;
    let fullProjectFiles = "";
    let projectFileList = "";
    let liveProjectContext = projectContext;

    if (shouldUseProjectContext) {
      try {
        const projectLoad = await loadRelevantProjectFiles(projectQuery);
        projectFilesForApi = projectLoad.files;
        fullProjectFiles = projectLoad.fileContent;
        projectFileList = await loadFileList();

        const ctxRes = await fetch("/api/local-agent/project/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: projectQuery }),
        });
        const ctxData = await ctxRes.json();
        if (ctxData.ok) {
          liveProjectContext = ctxData.matches
            .map((match: ProjectMatch) => `FILE: ${match.file}\nLINE: ${match.line}\nCODE: ${match.text}`)
            .join("\n\n");
          setProjectContext(liveProjectContext);
          setProjectMatches(ctxData.matches || []);
        }
      } catch (err: unknown) {
        setAgentStatus(`Timeline project context warning: ${errorMessage(err)}`);
      }
    }

    try {
      const response = await fetch("/api/timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userContent,
          log: submittedLog,
          code: `${submittedCode}

PROJECT PATH:
${shouldUseProjectContext ? submittedConnectedProjectPath : "Not included for this timeline run."}

PROJECT FILE LIST:
${shouldUseProjectContext ? projectFileList || "No project files were listed by the local agent." : "Not included because current draft/log/code was used as the timeline source."}

PROJECT CONTEXT:
${shouldUseProjectContext ? liveProjectContext || "No keyword line matches." : "Not included because current draft/log/code was used as the timeline source."}

PROJECT FULL FILE CONTENT:
${shouldUseProjectContext ? fullProjectFiles || "No project file content was loaded by the local agent." : "Not included because current draft/log/code was used as the timeline source."}`,
          computerSearchResults: shouldUseSavedSearchContext ? submittedComputerSearchResults : "",
          uploadedFiles: submittedUploadedFiles,
          projectFiles: shouldUseProjectContext ? projectFilesForApi : [],
        }),
      });

      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Timeline build failed.");

      setTimelineResult({
        ...data.timeline,
        sourceEvidence: submittedUploadedFiles,
      });
      setTimelineOpen(true);
      if (clearCurrentDraft) {
        const assistantContent = formatTimelineChatSummary(data.timeline, Boolean(data.emvOnly));
        const finalMessages: ChatMessage[] = [
          ...messages,
          {
            role: "user",
            content: userContent,
            attachedLog: submittedLog,
            attachedCode: submittedCode,
            attachedUploads: submittedUploadedFiles,
          },
          { role: "assistant", content: assistantContent },
        ];
        setMessages(finalMessages);
        saveActiveChat(finalMessages);
      }
      setAgentStatus(
        data.emvOnly
          ? "Timeline opened EMV/TLV troubleshooting for this device evidence."
          : `Timeline built: ${data.timeline.events.length} event(s), ${data.timeline.anomalies.length} anomaly(s).`,
      );
    } catch (err: unknown) {
      setAgentStatus(`Timeline failed: ${errorMessage(err)}`);
    } finally {
      setTimelineLoading(false);
    }
  }

  async function buildTimeline() {
    if (!canBuildTimeline) {
      setAgentStatus("No payment trace source found. Paste payment logs, webhook payloads, gateway responses, EMV/TLV, or device logs first.");
      return;
    }

    if (!hasFreshTimelineInput) {
      if (!timelineSourceCandidates.length) {
        setAgentStatus("No payment trace source found in this chat. Timeline needs logs, webhook payloads, gateway responses, EMV/TLV, or device evidence.");
        return;
      }

      setTimelineSourcePickerOpen(true);
      setAgentStatus("Choose which previous source to build the timeline from.");
      return;
    }

    const currentTimelineSource = {
      id: "current-draft",
      title: "Current Draft",
      description: "Current question, logs, code, and uploads.",
      question,
      log,
      code,
      uploadedFiles,
      computerSearchResults: "",
      connectedProjectPath: "",
      useProjectContext: false,
    };

    if (!timelineSourceLooksTraceable(currentTimelineSource)) {
      setAgentStatus(
        "No payment trace source found in the current draft. Timeline is for payment logs, webhook payloads, gateway responses, EMV/TLV, or device evidence.",
      );
      return;
    }

    await runTimelineSource(
      currentTimelineSource,
      true,
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[#eef3f8] text-slate-950">
      <div className="grid h-screen grid-cols-[1fr_220px]">
        <section className="flex h-screen min-h-0 flex-col overflow-hidden">
          <header className="relative z-[120] shrink-0 overflow-visible border-b border-slate-200/80 bg-white/95 px-6 py-3 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold tracking-tight">Debug Console</h2>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold uppercase text-blue-600">
                    Workspace
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  Search files, attach logs/images, connect projects, then ask PayFix.
                </p>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAboutOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                  title="What PayFix can do"
                >
                  <HelpCircle size={16} />
                  About
                </button>
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                  title="How to use PayFix"
                >
                  <HelpCircle size={16} />
                  Help
                </button>
                <div ref={toolsMenuRef} className="relative z-[130]">
                  <button
                    type="button"
                    onClick={() => setToolsOpen((open) => !open)}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                    title="Open PayFix tools"
                  >
                    <Wrench size={16} />
                    Tools
                    <ChevronDown size={14} />
                  </button>

                  {toolsOpen && (
                    <div className="absolute right-0 top-11 z-[140] w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-950/25">
                      {[
                        {
                          label: "EMV Decoder",
                          description: "Decode TLV/EMV tags, signals, outcomes, and terminal evidence.",
                          icon: CreditCard,
                          action: openEmvDecoderFromCurrentContext,
                        },
                        {
                          label: "Webhook Lab",
                          description: "Replay gateway webhooks, test signatures, and compare payloads to logs.",
                          icon: Webhook,
                          action: () => setWebhookLabOpen(true),
                        },
                        {
                          label: "Device Lab",
                          description: "Inspect connected payment devices, COM/IP reachability, and capture output.",
                          icon: Usb,
                          action: scanDevices,
                        },
                        {
                          label: "Inspect Localhost",
                          description: "Screenshot a running app and inspect DOM, console, network, and layout issues.",
                          icon: Search,
                          action: inspectRunningApp,
                        },
                        {
                          label: "Project IQ",
                          description: "Open project memory, clickable map, sandbox checks, and watch mode.",
                          icon: BrainCircuit,
                          action: openProjectIq,
                          disabled: !connectedProjectPath,
                        },
                      ].map((tool) => {
                        const Icon = tool.icon;
                        return (
                          <button
                            key={tool.label}
                            type="button"
                            onClick={() => {
                              if (tool.disabled) return;
                              setToolsOpen(false);
                              tool.action();
                            }}
                            disabled={tool.disabled}
                            title={tool.description}
                            className="group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-50"
                          >
                            <span
                              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition group-hover:bg-white ${
                                tool.disabled ? "bg-slate-100 text-slate-400" : "bg-blue-50 text-blue-600"
                              }`}
                            >
                              <Icon size={16} />
                            </span>
                            <span className="min-w-0">
                              <span className={`block text-sm font-bold ${tool.disabled ? "text-slate-500" : "text-slate-800"}`}>
                                {tool.label}
                              </span>
                              <span className="mt-0.5 block text-xs font-medium leading-5 text-slate-500">
                                {tool.disabled ? "Connect a project first to use this tool." : tool.description}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {lastRollback && (
                  <button
                    type="button"
                    onClick={rollbackLastAppliedChange}
                    disabled={rollbackLoading}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-800 shadow-sm transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                    title={`Restore ${lastRollback.relative || lastRollback.file} to the version before the last Apply`}
                  >
                    <RotateCcw size={16} />
                    {rollbackLoading ? "Rolling back..." : "Rollback"}
                  </button>
                )}

              </div>
            </div>
          </header>

          {agentStatus && (
            <div className="pointer-events-none fixed right-[236px] top-20 z-[110] max-w-[520px]">
              {(() => {
                const tone = statusTone(agentStatus);

                return (
                  <div
                    className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-3 py-2.5 text-sm font-semibold shadow-2xl backdrop-blur ${tone.shell}`}
                    role="status"
                  >
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
                    <button
                      type="button"
                      onClick={() => {
                        if (!connectedProjectPath) return;
                        setProjectPreviewReference(null);
                        setProjectPreviewOpen(true);
                      }}
                      disabled={!connectedProjectPath}
                      className={`min-w-0 flex-1 text-left leading-5 disabled:cursor-default ${connectedProjectPath ? tone.hover : ""}`}
                      title={connectedProjectPath ? "Open project details" : undefined}
                    >
                      {agentStatus}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAgentStatus("")}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/70 text-slate-600 transition hover:bg-white hover:text-slate-950"
                      title="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })()}
            </div>
          )}

          <Composer
            hasConversation={hasConversation}
            hasAttachment={hasAttachment}
            canSend={canSend}
            canBuildTimeline={canBuildTimeline}
            loading={loading}
            timelineLoading={timelineLoading}
            agentLoading={agentLoading}
            question={question}
            setQuestion={setQuestion}
            log={log}
            setLog={setLog}
            code={code}
            setCode={setCode}
            searchFolder={searchFolder}
            setSearchFolder={setSearchFolder}
            searchFileName={searchFileName}
            setSearchFileName={setSearchFileName}
            searchText={searchText}
            setSearchText={setSearchText}
            computerSearchResults={computerSearchResults}
            projectPath={projectPath}
            connectedProjectPath={connectedProjectPath}
            setProjectPath={updateProjectPath}
            uploadedFiles={uploadedFiles}
            uploadPreview={uploadPreview}
            pendingQuestion={pendingQuestion}
            pendingUploads={pendingUploads}
            isEditingMessage={Boolean(editSnapshot)}
            activeAttachTab={activeAttachTab}
            setActiveAttachTab={setActiveAttachTab}
            searchComputer={searchComputer}
            connectProject={connectProject}
            handleUpload={handleUpload}
            removeUpload={removeUpload}
            clearAttachments={clearAttachments}
            cancelEditMessage={cancelEditMessage}
            loadProjectContext={loadProjectContext}
            analyze={analyze}
            runAgent={runAgent}
            buildTimeline={buildTimeline}
            openColorTool={() => setShowColorEditor(true)}
            openAttachmentPreview={() => setAttachmentPreviewOpen(true)}
            openProjectPreview={() => {
              setProjectPreviewReference(null);
              setProjectPreviewOpen(true);
            }}
            openConversationSnapshot={openConversationSnapshot}
          >
            {hasConversation && (
              <ChatMessages
                messages={messages}
                copiedKey={copiedKey}
                setCopiedKey={setCopiedKey}
                openRunnerFromCode={openRunnerFromCode}
                openApplyModalWithContent={openApplyModal}
                projectPath={connectedProjectPath}
                computerSearchResults={computerSearchResults}
                uploadedFiles={uploadedFiles}
                log={log}
                code={code}
                chatEndRef={chatEndRef}
                onOpenCodeLog={setCodeLogPreview}
                onEditMessage={editUserMessage}
                onOpenAttachmentPreview={() => setAttachmentPreviewOpen(true)}
                onOpenProjectPreview={() => {
                  setProjectPreviewReference(null);
                  setProjectPreviewOpen(true);
                }}
                onOpenFileReference={(reference) => {
                  setProjectPreviewReference(reference);
                  setProjectPreviewOpen(true);
                }}
                onOpenAgentSession={(sessionMessages) => {
                  setAgentSessionMessages(sessionMessages);
                  const sessionUploads = sessionMessages.flatMap((message) => message.attachedUploads || []);
                  setAgentSessionUploads(sessionUploads);
                  setAgentSessionOpen(true);
                  setAgentStatus("PayFix investigation reopened.");
                }}
              />
            )}
          </Composer>
        </section>

        <Sidebar
          savedChats={savedChats}
          onNewChat={newChat}
          onOpenChat={openSavedChat}
          onDeleteRequest={setChatToDelete}
        />
      </div>

      {imagePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6">
          <div className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-lg font-bold">
                  <ImageIcon size={20} className="text-blue-600" />
                  Which image do you mean?
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Select one previous image and PayFix will send your message with that image attached.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImagePickerOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid max-h-[65vh] grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2">
              {conversationImages.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setImagePickerOpen(false);
                    void analyze({ referencedUploads: [item.file] });
                  }}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:shadow-md"
                >
                  <div className="relative h-44 bg-slate-950">
                    <Image
                      src={item.file.content}
                      alt={item.file.name}
                      fill
                      unoptimized
                      className="object-contain p-2"
                    />
                  </div>
                  <div className="p-4">
                    <div className="font-semibold text-slate-950">
                      Image {index + 1}: {item.file.name}
                    </div>
                    <div className="mt-1 text-xs font-medium text-slate-500">
                      From message {item.messageNumber} - {Math.round(item.file.size / 1024)} KB
                    </div>
                    <div className="mt-3 line-clamp-2 text-sm text-slate-600">
                      {item.prompt}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {timelineSourcePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6">
          <div className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-lg font-bold">
                  <FileText size={20} className="text-blue-600" />
                  What should Timeline trace?
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Select a previous log, upload, message, or project source to rebuild the payment timeline.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTimelineSourcePickerOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid max-h-[65vh] grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2">
              {timelineSourceCandidates.map((candidate) => {
                const preview = [
                  candidate.question,
                  candidate.log,
                  candidate.code,
                  candidate.uploadedFiles
                    .filter((file) => !file.isImage)
                    .map((file) => `${file.name}\n${file.content.slice(0, 350)}`)
                    .join("\n\n"),
                  candidate.computerSearchResults,
                  candidate.connectedProjectPath,
                ]
                  .filter(Boolean)
                  .join("\n\n")
                  .slice(0, 700);

                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => {
                      setTimelineSourcePickerOpen(false);
                      void runTimelineSource(candidate, false);
                    }}
                    className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-950">{candidate.title}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">{candidate.description}</div>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 group-hover:bg-white">
                        Trace
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {candidate.uploadedFiles.map((file, index) => (
                        <span
                          key={`${candidate.id}-${file.name}-${index}`}
                          className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700"
                        >
                          {file.isImage ? "Image" : "File"}: {file.name}
                        </span>
                      ))}
                      {candidate.useProjectContext && (
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">
                          Project
                        </span>
                      )}
                    </div>

                    <pre className="mt-3 line-clamp-6 whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-xs leading-5 text-green-200">
                      {preview || "No preview text available."}
                    </pre>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {dependencyProposal?.needed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-indigo-600">Agent Dependency Check</div>
                <h3 className="mt-1 text-xl font-bold text-slate-950">Missing package detected</h3>
              </div>
              <button
                type="button"
                onClick={() => setDependencyProposal(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
                title="Dismiss"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-bold text-slate-500">Package</div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-950">{dependencyProposal.packageName}</div>
              <div className="mt-2 inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
                {dependencyProposal.devDependency ? "devDependency" : "dependency"}
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-700">{dependencyProposal.reason}</p>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setDependencyProposal(null)}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2 font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={installProposedDependency}
                disabled={dependencyInstalling}
                className="rounded-xl bg-indigo-600 px-5 py-2 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {dependencyInstalling ? "Installing..." : "Install Package"}
              </button>
            </div>
          </div>
        </div>
      )}

      {chatToDelete && (
        <DeleteChatModal chat={chatToDelete} onCancel={() => setChatToDelete(null)} onDelete={deleteSavedChat} />
      )}

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {webhookLabOpen && (
        <WebhookLabModal
          onClose={() => setWebhookLabOpen(false)}
          conversationText={webhookLabConversationText()}
          hasConnectedProject={Boolean(connectedProjectPath)}
        />
      )}

      {deviceLabOpen && (
        <DeviceLabModal
          result={deviceScanResult}
          loading={deviceLabLoading}
          onClose={() => setDeviceLabOpen(false)}
          onRefresh={scanDevices}
          onDownloadBundle={downloadDeviceSupportBundle}
        />
      )}

      {liveInspectorOpen && (
        <LiveInspectorModal
          result={liveInspectorResult}
          loading={liveInspectorLoading}
          targetUrl={liveInspectorUrl}
          setTargetUrl={setLiveInspectorUrl}
          onEditVisualTarget={openColorToolFromVisualTarget}
          onInspect={inspectRunningApp}
          onClose={() => setLiveInspectorOpen(false)}
        />
      )}

      {emvDecodeResult && <EmvDecoderModal result={emvDecodeResult} onClose={() => setEmvDecodeResult(null)} />}

      {showRunner && (
        <RunnerModal
          runnerMode={runnerMode}
          runnerLanguage={runnerLanguage}
          runnerHtml={runnerHtml}
          setRunnerHtml={setRunnerHtml}
          runnerCss={runnerCss}
          setRunnerCss={setRunnerCss}
          runnerJs={runnerJs}
          setRunnerJs={setRunnerJs}
          runnerUnsupportedMessage={runnerUnsupportedMessage}
          runnerRefreshKey={runnerRefreshKey}
          refreshRunner={() => setRunnerRefreshKey((value) => value + 1)}
          runnerSrcDoc={runnerSrcDoc}
          onClose={resetRunner}
        />
      )}

      {showApplyModal && (
        <ApplyChangesModal
          description={applyDescription}
          patchSetFiles={applyPatchSet.map((item) => item.resolvedFile)}
          applyAllLoading={applyAllLoading}
          agentFollowUpLoading={applyAgentFollowUpLoading}
          applyFilePath={applyFilePath}
          setApplyFilePath={(value) => {
            setApplyFilePath(value);
            invalidateApplyPreview();
          }}
          applyMode={applyMode}
          setApplyMode={(value) => {
            setApplyMode(value);
            invalidateApplyPreview();
          }}
          applySearchContent={applySearchContent}
          setApplySearchContent={(value) => {
            setApplySearchContent(value);
            invalidateApplyPreview();
          }}
          applyNewContent={applyNewContent}
          setApplyNewContent={(value) => {
            setApplyNewContent(value);
            invalidateApplyPreview();
          }}
          diffOldContent={diffOldContent}
          diffNewContent={diffNewContent}
          canApply={Boolean(applyPreviewKey && applyPreviewKey === currentApplyPreviewKey())}
          onClose={cancelApplyModal}
          onPreview={previewFileChange}
          onApply={applyFileChange}
          onApplyAll={applyAllFileChanges}
          onAgentFollowUp={runApplyAgentFollowUp}
        />
      )}

      {agentSessionOpen && (
        <AgentSessionModal
          messages={agentSessionMessages}
          loading={agentLoading}
          status={agentStatus}
          connectedProjectPath={connectedProjectPath}
          uploads={agentSessionUploads}
          onClose={closeAgentSessionAndSave}
          onSend={runAgentSessionFollowUp}
          onUpload={handleAgentSessionUpload}
          onRemoveUpload={removeAgentSessionUpload}
        />
      )}

      {showColorEditor && (
        <ColorToolModal
          cssFileName={cssFileName}
          setCssFileName={setCssFileName}
          cssSelector={cssSelector}
          setCssSelector={setCssSelector}
          cssProperty={cssProperty}
          setCssProperty={setCssProperty}
          cssColor={cssColor}
          setCssColor={setCssColor}
          cssFileMatches={cssFileMatches}
          selectedCssFile={selectedCssFile}
          setSelectedCssFile={setSelectedCssFile}
          cssPreview={cssPreview}
          onClose={() => setShowColorEditor(false)}
          onFindCssFile={findCssFile}
          onPreviewCssColor={previewCssColor}
          onApplyCssColor={applyCssColor}
        />
      )}

      {attachmentPreviewOpen && (
        <AttachmentPreviewModal
          searchFileName={searchFileName}
          computerSearchResults={computerSearchResults}
          onClose={() => setAttachmentPreviewOpen(false)}
        />
      )}

      {projectPreviewOpen && (
        <ProjectPreviewModal
          projectPath={connectedProjectPath}
          projectFiles={loadedProjectFiles}
          projectMatches={projectMatches}
          initialFileReference={projectPreviewReference}
          onClose={() => setProjectPreviewOpen(false)}
        />
      )}

      {projectIqOpen && (
        <div className="fixed inset-0 z-[240] flex items-start justify-center bg-slate-950/70 p-4">
          <div className="flex max-h-[calc(100vh-32px)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-600">
                  <BrainCircuit size={16} />
                  Project IQ
                </div>
                <h3 className="mt-1 text-2xl font-bold text-slate-950">Project Memory, Map, Runner, Watch</h3>
                <p className="mt-1 break-all text-sm text-slate-500">{connectedProjectPath}</p>
              </div>

              <button
                type="button"
                onClick={() => setProjectIqOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-6">
              <div className="mb-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={openProjectIq}
                  disabled={projectIqLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:bg-slate-300"
                >
                  <BrainCircuit size={16} />
                  Refresh IQ
                </button>
                <button
                  type="button"
                  onClick={runSandboxRunner}
                  disabled={projectIqLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:bg-slate-300"
                >
                  <PlayCircle size={16} />
                  Run Sandbox Checks
                </button>
                <button
                  type="button"
                  onClick={refreshWatchMode}
                  disabled={projectIqLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <Radio size={16} />
                  Refresh Watch
                </button>
                <button
                  type="button"
                  onClick={clearWatchMode}
                  disabled={projectIqLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-sm font-bold text-rose-700 shadow-sm transition hover:bg-rose-50"
                >
                  <X size={16} />
                  Clear Watch
                </button>
                <button
                  type="button"
                  onClick={downloadWatchSnapshot}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-blue-50"
                >
                  <FileText size={16} />
                  Watch Snapshot
                </button>
              </div>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
                <aside className="space-y-5">
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-blue-600">Smart Watch</div>
                        <h4 className="mt-1 font-bold text-slate-950">Regression Alerts</h4>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          smartWatchAlerts.some((alert) => alert.severity === "error")
                            ? "bg-rose-50 text-rose-700"
                            : smartWatchAlerts.length
                              ? "bg-amber-50 text-amber-700"
                              : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {smartWatchAlerts.length ? `${smartWatchAlerts.length} alert(s)` : "Clean"}
                      </span>
                    </div>

                    <div className="mt-4 space-y-2">
                      {smartWatchAlerts.length ? (
                        smartWatchAlerts.map((alert, index) => (
                          <div
                            key={`${alert.title}-${index}`}
                            className={`rounded-xl border p-3 text-xs ${
                              alert.severity === "error"
                                ? "border-rose-200 bg-rose-50 text-rose-950"
                                : "border-amber-200 bg-amber-50 text-amber-950"
                            }`}
                          >
                            <div className="font-black">{alert.title}</div>
                            <div className="mt-1 break-words leading-5">{alert.detail}</div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm leading-6 text-slate-500">
                          Watch files, run sandbox checks, and inspect localhost to correlate regressions here.
                        </p>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={runSandboxRunner}
                        disabled={projectIqLoading}
                        className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:bg-slate-300"
                      >
                        Validate
                      </button>
                      <button
                        type="button"
                        onClick={inspectRunningApp}
                        disabled={projectIqLoading}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-blue-50"
                      >
                        Inspect App
                      </button>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Memory</div>
                    {projectMemory?.ok ? (
                      <>
                        <h4 className="mt-2 text-lg font-bold text-slate-950">{projectMemory.packageName}</h4>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{projectMemory.framework}</span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                            {projectMemory.packageManager}
                          </span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                            {projectMemory.fileCount} files
                          </span>
                        </div>
                        {projectMemory.capabilities?.length ? (
                          <div className="mt-4">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Payment signals</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {projectMemory.capabilities.map((capability) => (
                                <span
                                  key={capability}
                                  className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700"
                                >
                                  {capability}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {projectMemory.grouped && (
                          <div className="mt-4 grid grid-cols-2 gap-2">
                            {Object.entries(projectMemory.grouped).map(([group, count]) => (
                              <div key={group} className="rounded-xl bg-slate-50 p-3">
                                <div className="text-xs font-bold uppercase text-slate-400">{group}</div>
                                <div className="mt-1 text-lg font-black text-slate-950">{count}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-rose-700">{projectMemory?.error || "Project memory not loaded yet."}</p>
                    )}
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Watch Mode</div>
                    <input
                      value={watchFilePath}
                      onChange={(event) => setWatchFilePath(event.target.value)}
                      placeholder="Full file path to watch"
                      className="mt-3 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => startWatchMode()}
                      disabled={projectIqLoading}
                      className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:bg-slate-300"
                    >
                      <Radio size={16} />
                      Watch File
                    </button>
                    <div className="mt-4 space-y-2">
                      {watchModeResult?.watchers?.map((watcher) => (
                        <div key={watcher.id} className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs">
                          <div className="font-bold text-indigo-950">{watcher.relative}</div>
                          <div className="mt-1 text-indigo-700">Started {new Date(watcher.startedAt).toLocaleTimeString()}</div>
                        </div>
                      ))}
                      {watchModeResult?.events?.slice(0, 6).map((event, index) => (
                        <div
                          key={event.eventId || `${event.watcherId || event.id || event.file}-${event.at}-${index}`}
                          className={`rounded-xl border p-3 text-xs ${
                            event.changed
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-slate-200 bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-bold text-slate-900">{event.eventType}</div>
                            <span className="rounded-full bg-white px-2 py-1 font-bold text-slate-600">
                              +{event.addedLines || 0} / -{event.removedLines || 0}
                            </span>
                          </div>
                          <div className="mt-1 break-all text-slate-500">{event.relative || event.file}</div>
                          {event.analysis && (
                            <div
                              className={`mt-3 rounded-xl border p-3 ${
                                event.analysis.risk === "high"
                                  ? "border-rose-200 bg-rose-50"
                                  : event.analysis.risk === "medium"
                                    ? "border-amber-200 bg-amber-50"
                                    : "border-emerald-200 bg-emerald-50"
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-black text-slate-950">{event.analysis.title}</span>
                                <span className="rounded-full bg-white px-2 py-1 font-bold text-slate-700">
                                  {event.analysis.confidence}% confidence
                                </span>
                                <span className="rounded-full bg-white px-2 py-1 font-bold text-slate-700">
                                  {event.analysis.risk} risk
                                </span>
                              </div>
                              <div className="mt-2 leading-5 text-slate-700">{event.analysis.probableCause}</div>
                              <div className="mt-2 font-semibold text-slate-900">{event.analysis.suggestedFix}</div>
                              {event.analysis.evidence?.length ? (
                                <div className="mt-2 space-y-1">
                                  {event.analysis.evidence.slice(0, 4).map((item, evidenceIndex) => (
                                    <div key={`${event.eventId || event.at}-evidence-${evidenceIndex}`} className="text-slate-600">
                                      {item}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {event.analysis.validation?.length ? (
                                <div className="mt-2 rounded-lg bg-white/75 p-2 font-semibold text-slate-700">
                                  Next: {event.analysis.validation.slice(0, 2).join(" ")}
                                </div>
                              ) : null}
                            </div>
                          )}
                          {event.preview && (
                            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-2 text-[11px] leading-4 text-green-200">
                              {event.preview}
                            </pre>
                          )}
                          {event.issues?.length ? (
                            <div className="mt-2 space-y-1">
                              {event.issues.slice(0, 4).map((issue, issueIndex) => (
                                <div
                                  key={`${event.eventId || event.at}-issue-${issueIndex}`}
                                  className={`rounded-lg px-2 py-1 font-semibold ${
                                    issue.severity === "error"
                                      ? "bg-rose-100 text-rose-800"
                                      : issue.severity === "warning"
                                        ? "bg-amber-100 text-amber-800"
                                        : "bg-blue-100 text-blue-800"
                                  }`}
                                >
                                  {issue.severity.toUpperCase()}: {issue.message}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-2 text-[11px] font-semibold text-slate-400">
                            {new Date(event.at).toLocaleTimeString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </aside>

                <main className="space-y-5">
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Sandbox Runner</div>
                        <h4 className="mt-1 font-bold text-slate-950">TypeScript, lint, tests, build</h4>
                      </div>
                      {sandboxRunnerResult && (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            sandboxRunnerResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {sandboxRunnerResult.ok ? "PASS" : "FAIL"}
                        </span>
                      )}
                    </div>
                    <div className="mt-4 space-y-3">
                      {sandboxRunnerResult?.commands?.map((command) => (
                        <article
                          key={command.command}
                          className={`rounded-xl border p-3 ${
                            command.ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"
                          }`}
                        >
                          <div className="font-mono text-xs font-bold text-slate-900">{command.command}</div>
                          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs leading-5 text-green-200">
                            {command.output || "(no output)"}
                          </pre>
                        </article>
                      ))}
                      {sandboxRunnerResult?.skipped?.map((item) => (
                        <div key={item} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          {item}
                        </div>
                      ))}
                      {!sandboxRunnerResult && (
                        <p className="text-sm text-slate-500">Run sandbox checks before applying risky code changes.</p>
                      )}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Git Safety</div>
                        <h4 className="mt-1 font-bold text-slate-950">
                          {gitStatusResult?.ok ? `Branch ${gitStatusResult.branch || "unknown"}` : "Repository status"}
                        </h4>
                      </div>
                      {gitStatusResult?.ok && (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            gitStatusResult.dirty ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {gitStatusResult.dirty ? `${gitStatusResult.changedFiles?.length || 0} changed` : "Clean"}
                        </span>
                      )}
                    </div>
                    <div className="mt-4 space-y-2">
                      {gitStatusResult?.ok ? (
                        <>
                          {(gitStatusResult.changedFiles || []).slice(0, 12).map((file) => (
                            <div key={`${file.status}-${file.file}`} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                              <span className="rounded-full bg-white px-2 py-1 font-black text-slate-600">{file.status}</span>
                              <span className="break-all font-mono text-slate-700">{file.file}</span>
                            </div>
                          ))}
                          {!gitStatusResult.changedFiles?.length && (
                            <p className="text-sm text-slate-500">No Git changes detected.</p>
                          )}
                          {gitStatusResult.diffStat && (
                            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-xs leading-5 text-green-200">
                              {gitStatusResult.diffStat}
                            </pre>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-amber-700">
                          {gitStatusResult?.error || "Git status has not been loaded yet."}
                        </p>
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={refreshGitStatus}
                        disabled={projectIqLoading}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        Refresh Git
                      </button>
                      <button
                        type="button"
                        onClick={commitProjectChanges}
                        disabled={projectIqLoading || !gitStatusResult?.ok || !gitStatusResult.dirty}
                        className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:bg-slate-300"
                      >
                        Commit Changes
                      </button>
                      <button
                        type="button"
                        onClick={revertLastGitCommit}
                        disabled={projectIqLoading || !gitStatusResult?.ok}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        Revert Last Commit
                      </button>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-400">AI Project Map</div>
                    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {Object.entries(projectMap?.grouped || {}).map(([group, files]) => (
                        <div key={group} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <h4 className="font-bold capitalize text-slate-950">{group}</h4>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600">
                              {files.length}
                            </span>
                          </div>
                          <div className="max-h-64 space-y-2 overflow-auto">
                            {files.slice(0, 40).map((file) => (
                              <button
                                key={file.file}
                                type="button"
                                onClick={() => {
                                  setProjectPreviewReference({ file: file.file, line: 1 });
                                  setProjectPreviewOpen(true);
                                }}
                                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs transition hover:border-blue-300 hover:bg-blue-50"
                              >
                                <div className="truncate font-mono font-bold text-slate-800">{file.relative}</div>
                                {file.imports.length ? (
                                  <div className="mt-1 truncate text-slate-500">
                                    imports: {file.imports.slice(0, 4).join(", ")}
                                  </div>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </main>
              </div>
            </div>
          </div>
        </div>
      )}

      {codeLogPreview && (
        <CodeLogPreviewModal
          log={codeLogPreview.log}
          code={codeLogPreview.code}
          onClose={() => setCodeLogPreview(null)}
        />
      )}

      {timelineOpen && timelineResult && (
        <TimelineModal timeline={timelineResult} onClose={() => setTimelineOpen(false)} />
      )}
    </main>
  );
}
