"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Activity,
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
  ShieldAlert,
  Square,
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
import { asksCommandLocationHelp, asksContextualClarificationFollowUp, asksGradleTrustCheck, asksToExplainQuotedChoices, asksToRunReferencedCommands, classifyAgentFollowUpIntent, hasTerminalCommandOutput, selectedPreviousOption } from "./lib/agentIntent";
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
  agentSessionOpen?: boolean;
  agentSessionMessages?: ChatMessage[];
  agentSessionUploads?: UploadedFile[];
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

type BrowserCapture = {
  id: string;
  capturedAt: string;
  url: string;
  title: string;
  text: string;
  links?: { text: string; href: string }[];
  meta?: {
    userAgent?: string;
    selectionText?: string;
  };
};

type SdkInspectionResponse = {
  ok?: boolean;
  root?: string;
  totalFiles?: number;
  importantFiles?: {
    file: string;
    relative: string;
    size: number;
    mime: string;
    role: string;
  }[];
  readableFiles?: {
    file: string;
    relative: string;
    size: number;
    mime: string;
    role: string;
    content?: string;
  }[];
  error?: string;
};

type CreateProjectResponse = {
  ok: boolean;
  path?: string;
  folderName?: string;
  files?: string[];
  runCommands?: string[];
  markdown?: string;
  error?: string;
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

type PortManagerResult = {
  ok: boolean;
  currentRoot?: string | null;
  ports?: {
    port: number;
    localAddresses?: string[];
    devServerLikely?: boolean;
    currentAgent?: boolean;
    processes?: {
      processId?: number;
      name?: string;
      executablePath?: string;
      commandLine?: string;
    }[];
    projectCandidates?: {
      root: string;
      packageName?: string;
      framework?: string;
      confidence?: number;
      reason?: string;
      processHint?: string;
    }[];
  }[];
  error?: string;
};

type ToolchainDoctorItem = {
  id: string;
  label: string;
  detected: boolean;
  available: boolean;
  requiredCommands: string[];
  availableCommands: string[];
  missingCommands: string[];
  version?: string;
  installHint: string;
  installCommand?: string;
  installUrl?: string;
};

type ToolchainDoctorResult = {
  ok: boolean;
  root?: string;
  detectedLanguages?: string[];
  items?: ToolchainDoctorItem[];
  missing?: ToolchainDoctorItem[];
  unavailableValidation?: string[];
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

type WatchEvent = NonNullable<WatchModeResult["events"]>[number];

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
  mode: "replace" | "insert" | "delete" | "none";
  file: string;
  search: string;
  replacement: string;
  language: string;
  explanation: string;
};

type ApplyPatchSetItem = {
  fileCandidate: string;
  resolvedFile: string;
  mode: "insert" | "replace" | "overwrite" | "delete";
  search: string;
  replacement: string;
};

type DependencyProposal = {
  needed: boolean;
  packageName: string;
  packageNames?: string[];
  ecosystem?: "node" | "python" | "dotnet" | "rust" | "go" | "php" | "ruby" | "java" | "manual";
  installCommand?: string;
  installable?: boolean;
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
  selectedFiles?: string[];
  loopSteps?: {
    step: string;
    status: "done" | "skipped" | "blocked";
    detail: string;
  }[];
};

type AgentProgressResponse = {
  ok: boolean;
  progress?: {
    message: string;
    step: string;
    at: string;
  } | null;
};

type AgentIntentApiResponse = {
  ok: boolean;
  route?: ReturnType<typeof classifyAgentFollowUpIntent>["route"];
  reason?: string;
  useImages?: boolean;
  shouldRunProjectValidation?: boolean;
  error?: string;
};

function isAgentApiResponse(value: unknown): value is AgentApiResponse {
  return Boolean(value && typeof value === "object" && "patchReady" in value && "result" in value);
}

function primaryAgentPatch(data?: AgentApiResponse | null) {
  if (!data?.patchReady) return null;

  const directPatch = data.result?.patch;
  if (directPatch && directPatch.mode !== "none") return directPatch;

  const patchSet = data.result?.patchSet || data.patchSet || [];
  return patchSet.find((item) => item.mode !== "none") || null;
}

function agentResponseHasApplyablePatch(data?: AgentApiResponse | null) {
  const patch = primaryAgentPatch(data);
  return Boolean(data?.patchReady && patch?.file);
}

function titleFromChatMessages(nextMessages: ChatMessage[]) {
  const directUser = nextMessages.find((message) => message.role === "user" && message.content.trim())?.content.trim();
  const agentUser = nextMessages
    .flatMap((message) => message.agentSessionMessages || [])
    .find((message) => message.role === "user" && message.content.trim())?.content.trim();
  const source = directUser || agentUser || "PayFix investigation";

  if (source === "Analyze attached context.") return "Attached context analysis";
  if (/^(new chat|payfix investigation)$/i.test(source)) {
    const assistantHint =
      nextMessages
        .flatMap((message) => [message, ...(message.agentSessionMessages || [])])
        .find((message) => message.role === "assistant" && message.content.trim())?.content.trim() || source;
    const firstLine = assistantHint.split(/\r?\n/).find((line) => line.trim() && !/^payfix investigation saved$/i.test(line.trim()));
    return (firstLine || source).replace(/^request:\s*/i, "").slice(0, 60);
  }

  return source.slice(0, 60);
}

function normalizeSavedChatTitle(chat: SavedChat) {
  const withActivity = chat.lastActivityAt ? chat : { ...chat, lastActivityAt: chat.createdAt };
  if (!/^(new chat|payfix investigation)$/i.test(withActivity.title.trim())) return withActivity;

  const recoveredTitle = titleFromChatMessages(withActivity.messages || []);
  return recoveredTitle && recoveredTitle !== withActivity.title ? { ...withActivity, title: recoveredTitle } : withActivity;
}

function isAgentWorkspaceStatusMessage(message: ChatMessage) {
  return (
    message.role === "assistant" &&
    /Dependency installed|PATCH APPLIED BY AGENT|PATCH VALIDATION|PATCH ROLLED BACK/i.test(message.content)
  );
}

function isWorkingAssistantMessage(content: string) {
  return /^(Agent is running|PayFix is reading|PayFix Agent is|PayFix Agent|Reviewing the screenshots|Answering your focused follow-up|Checking the current build error|Checking the connected project error|Running |Choosing |Reading |Following |Reasoning |Scanning |Evidence-only mode|Investigating evidence|Previewing |Dry-running |Applying |Installing |Validating |Preparing |Prepared |Checked |Connecting |Loading |Loaded |Selecting |Inspecting |SDK folder|Feeding |Checking |Toolchain |Project investigation)/i.test(
    content,
  );
}

function isStaleGenericAgentContext(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  return (
    /\b(Log comparison|Needs attention|AGENT INVESTIGATION COMPLETE)\b/i.test(normalized) &&
    /\b(compared the uploaded evidence|highlighted suspect-only|uploaded evidence|No concrete bug was proven|No automatic patch is ready|confidence was too low|Validation not run|PayFix found a blocker but does not have a safe patch)\b/i.test(
      normalized,
    )
  );
}

function latestActionableAssistantContext(messages: ChatMessage[]) {
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          message.content.trim() &&
          !isWorkingAssistantMessage(message.content) &&
          !isStaleGenericAgentContext(message.content),
      )?.content || ""
  );
}

function formatRecentAgentContext(messages: ChatMessage[], limit: number, maxChars: number) {
  return [...messages]
    .filter((message) => message.content.trim())
    .reverse()
    .slice(0, limit)
    .reverse()
    .map((message) => `${message.role.toUpperCase()}: ${message.content.slice(0, maxChars)}`)
    .join("\n\n");
}

function recoverAgentTrailForMessages(messages: ChatMessage[], agentTrail: ChatMessage[]) {
  if (!agentTrail.some((message) => message.role === "assistant")) return messages;

  let changed = false;
  const recovered = messages.map((message) => {
    if (!isAgentWorkspaceStatusMessage(message) || message.agentSessionMessages?.length) return message;

    changed = true;
    return {
      ...message,
      agentSessionMessages: [...agentTrail, message],
    };
  });

  return changed ? recovered : messages;
}

function statusTone(message: string) {
  if (/failed|error|blocked|could not|no .*found|invalid/i.test(message)) {
    return {
      dot: "bg-amber-400",
      shell: "border-amber-500/30 bg-amber-500/10 text-amber-100 shadow-lg shadow-black/30",
      hover: "hover:bg-amber-500/15",
    };
  }

  if (/success|connected|loaded|applied|complete|ready|found no obvious/i.test(message)) {
    return {
      dot: "bg-emerald-400",
      shell: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100 shadow-lg shadow-black/30",
      hover: "hover:bg-emerald-500/15",
    };
  }

  return {
    dot: "bg-sky-400",
    shell: "border-sky-500/30 bg-sky-500/10 text-sky-100 shadow-lg shadow-black/30",
    hover: "hover:bg-sky-500/15",
  };
}

type RollbackSnapshot = {
  id: string;
  file: string;
  relative: string;
  createdAt: string;
  reason: string;
  fileExisted?: boolean;
};

type AppliedPatchNotice = {
  key: string;
  files: string[];
  validationLabel: string;
  appliedAt: string;
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

type ImageEditPlan = {
  mode: "canvas" | "resize";
  target: ImageConversionTarget;
  label: string;
  suffix: string;
  aspectRatio?: number;
  maxSide?: number;
  mask?: "circle";
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

function agentRunErrorMessage(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return "Agent timed out after 3 minutes. Try a narrower request, or ask PayFix to inspect one specific file/workflow first.";
  }

  return errorMessage(error);
}

function trimStoredFile(file: UploadedFile): UploadedFile {
  const isHeavyImage = file.isImage || /^data:image\//i.test(file.content);
  if (!isHeavyImage && file.content.length <= 250_000) return file;

  return {
    ...file,
    content: "",
  };
}

function imageDimensionsFromDataUrl(dataUrl: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

function trimStoredGeneratedFile(file: GeneratedFile): GeneratedFile {
  const isHeavyImage = /^data:image\//i.test(file.content);
  if (!isHeavyImage && file.content.length <= 250_000) return file;

  return {
    ...file,
    content: "",
  };
}

function trimStoredMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    attachedUploads: message.attachedUploads?.map(trimStoredFile),
    generatedFiles: message.generatedFiles?.map(trimStoredGeneratedFile),
    agentSessionMessages: message.agentSessionMessages?.map(trimStoredMessage),
  };
}

function trimSavedChatForStorage(chat: SavedChat): SavedChat {
  return {
    ...chat,
    messages: chat.messages.map(trimStoredMessage),
  };
}

function trimDraftForStorage(draft: DraftState): DraftState {
  return {
    ...draft,
    uploadedFiles: draft.uploadedFiles?.map(trimStoredFile),
    messages: draft.messages?.map(trimStoredMessage),
    agentSessionMessages: draft.agentSessionMessages?.map(trimStoredMessage),
    agentSessionUploads: draft.agentSessionUploads?.map(trimStoredFile),
  };
}

function safeSetJsonStorage(key: string, value: unknown, fallback?: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    if (fallback === undefined) return false;

    try {
      localStorage.setItem(key, JSON.stringify(fallback));
      return true;
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {
        // Storage can be unavailable or full; keep the app running either way.
      }
      return false;
    }
  }
}

async function fetchAgentWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 180000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
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

function splitOptionList(value: string) {
  return value
    .replace(/\band\/or\b/gi, ",")
    .replace(/\bor\b/gi, ",")
    .split(/[,;/|]+/)
    .map((item) => item.replace(/\([^)]*\)/g, "").trim())
    .filter((item) => item.length >= 3 && item.length <= 64)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function extractQuickReplyOptions(content: string) {
  const text = content.trim();
  const labeledChoices = [...text.matchAll(/(?:^|\n)\s*([A-E])[\).:\s-]+([\s\S]+?)(?=\n\s*[A-E][\).:\s-]+|\n\s*$)/gi)]
    .map((match) => {
      const letter = (match[1] || "").toUpperCase();
      const option = (match[2] || "")
        .split(/\r?\n/)[0]
        .replace(/\s+/g, " ")
        .trim();
      if (!letter || option.length < 3 || option.length > 120) return "";
      return `${letter}. ${option}`;
    })
    .filter(Boolean);
  if (/\bChoose one\b/i.test(text) && labeledChoices.length) {
    return labeledChoices.slice(0, 5);
  }

  const asksForChoice =
    /\b(quick questions|pick all|pick one|choose|confirm|select|which option|before I|answer these|tell me which)\b/i.test(text) ||
    /(?:^|\n)\s*(?:primary users?|key features|features|preferred complexity|brand colors?|options?)\s*:/i.test(text);
  const looksLikeFinalAnswer = /^(yes|no|found|done|i['’]ve|the logs show|here['’]s|payfix|agent investigation complete|requested change|found the issue)\b/i.test(text);
  const hasDirectQuestion = /\?/.test(text) || /\b(reply with|tell me|choose|select|confirm|pick)\b/i.test(text);
  if (!text || !asksForChoice || !hasDirectQuestion || looksLikeFinalAnswer) return [];

  const options: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const primaryUsers = line.match(/primary users?\s*:\s*(.+)$/i)?.[1];
    if (primaryUsers) {
      splitOptionList(primaryUsers).forEach((item) => options.push(`Primary user: ${item}`));
    }

    const keyFeatures = line.match(/(?:key features|features).*?:\s*(.+)$/i)?.[1];
    if (keyFeatures) {
      splitOptionList(keyFeatures).forEach((item) => options.push(`Include: ${item}`));
    }

    const complexity = line.match(/(?:preferred )?complexity\s*:\s*(.+)$/i)?.[1];
    if (complexity) {
      splitOptionList(complexity).forEach((item) => options.push(`Complexity: ${item}`));
    }
  }

  return options
    .map((option) => option.replace(/\s+/g, " ").trim())
    .filter((option, index, list) => list.findIndex((item) => item.toLowerCase() === option.toLowerCase()) === index)
    .slice(0, 14);
}

function quickReplyIntent(text: string): "sketch" | "visual" | "log" | "project" | "code" | "image" | "payment" | "unknown" {
  if (/\b(sketch|wireframe|mockup|dashboard|website|app map|draw|diagram|single-page|admin ui|brand colors|palette)\b/i.test(text)) {
    return "sketch";
  }

  if (/\b(visual fix|contrast|overflow|spacing|css|selector|style|readability|layout defect)\b/i.test(text)) {
    return "visual";
  }

  if (/\b(logs?|gateway response|declin|approved|cardknox|idtech|sdk|timeout|exception|error|mc|mastercard|visa)\b/i.test(text)) {
    return "log";
  }

  if (/\b(payment trace|emv|tlv|9f27|9f26|tag 95|tag 8a|arqc|aac|card reader|terminal|transaction)\b/i.test(text)) {
    return "payment";
  }

  if (/\b(project|repo|file|folder|patch|apply|validate|install|dependency|build|lint|test|component)\b/i.test(text)) {
    return "project";
  }

  if (/\b(code|typescript|javascript|tsx|jsx|python|class|function|import|compile)\b/i.test(text)) {
    return "code";
  }

  if (/\b(image|screenshot|photo|picture|png|jpg|jpeg|webp)\b/i.test(text)) {
    return "image";
  }

  return "unknown";
}

function intentsCompatible(left: ReturnType<typeof quickReplyIntent>, right: ReturnType<typeof quickReplyIntent>) {
  if (left === "unknown" || right === "unknown") return false;
  if (left === right) return true;
  if ((left === "log" && right === "payment") || (left === "payment" && right === "log")) return true;
  if ((left === "visual" && right === "project") || (left === "project" && right === "visual")) return true;
  if ((left === "code" && right === "project") || (left === "project" && right === "code")) return true;
  if ((left === "sketch" && right === "image") || (left === "image" && right === "sketch")) return true;
  return false;
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [selectedQuickReplies, setSelectedQuickReplies] = useState<string[]>([]);
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
  const [lastImportedBrowserCaptureId, setLastImportedBrowserCaptureId] = useState("");
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
  const [agentSessionFreshUploads, setAgentSessionFreshUploads] = useState<UploadedFile[]>([]);
  const [agentSessionInitialDraft, setAgentSessionInitialDraft] = useState("");
  const [agentSessionSetupRevision, setAgentSessionSetupRevision] = useState(0);
  const [agentSessionEditSnapshot, setAgentSessionEditSnapshot] = useState<{
    messages: ChatMessage[];
    uploads: UploadedFile[];
    status: string;
  } | null>(null);
  const [recentAgentFiles, setRecentAgentFiles] = useState<string[]>([]);
  const [lastVerifiedAgentPatch, setLastVerifiedAgentPatch] = useState<AgentApiResponse | null>(null);
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
  const agentSessionRunSeqRef = useRef(0);
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
  const [applyMode, setApplyMode] = useState<"insert" | "replace" | "overwrite" | "delete">("insert");
  const [applySearchContent, setApplySearchContent] = useState("");
  const [applyNewContent, setApplyNewContent] = useState("");
  const [applyDescription, setApplyDescription] = useState("");
  const [applyPatchSet, setApplyPatchSet] = useState<ApplyPatchSetItem[]>([]);
  const [applyAllLoading, setApplyAllLoading] = useState(false);
  const [applyAgentFollowUpLoading, setApplyAgentFollowUpLoading] = useState(false);
  const [lastRollback, setLastRollback] = useState<RollbackSnapshot | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackOptionsOpen, setRollbackOptionsOpen] = useState(false);
  const [rollbackSnapshots, setRollbackSnapshots] = useState<RollbackSnapshot[]>([]);
  const [selectedRollbackIds, setSelectedRollbackIds] = useState<string[]>([]);
  const [showAllRollbackSnapshots, setShowAllRollbackSnapshots] = useState(false);
  const [expandedRollbackFiles, setExpandedRollbackFiles] = useState<string[]>([]);
  const [dependencyProposal, setDependencyProposal] = useState<DependencyProposal | null>(null);
  const [dependencyConfirmOpen, setDependencyConfirmOpen] = useState(false);
  const [dependencyInstalling, setDependencyInstalling] = useState(false);
  const [diffOldContent, setDiffOldContent] = useState("");
  const [diffNewContent, setDiffNewContent] = useState("");
  const [applyPreviewKey, setApplyPreviewKey] = useState("");
  const [appliedPatchKeys, setAppliedPatchKeys] = useState<string[]>([]);
  const [appliedPatchNotice, setAppliedPatchNotice] = useState<AppliedPatchNotice | null>(null);
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
  const [portManagerResult, setPortManagerResult] = useState<PortManagerResult | null>(null);
  const [toolchainDoctorResult, setToolchainDoctorResult] = useState<ToolchainDoctorResult | null>(null);
  const [watchModeResult, setWatchModeResult] = useState<WatchModeResult | null>(null);
  const [watchFilePath, setWatchFilePath] = useState("");
  const [liveCaptureEnabled, setLiveCaptureEnabled] = useState(false);
  const [dismissedLiveCaptureEventKey, setDismissedLiveCaptureEventKey] = useState("");
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
    if (!connectedProjectPath) {
      setRollbackSnapshots([]);
      setLastRollback(null);
      return;
    }

    let canceled = false;
    const refreshTimer = window.setTimeout(async () => {
      try {
        const snapshots = await loadRollbackSnapshots();
        if (canceled) return;
        setRollbackSnapshots(snapshots);
        setLastRollback(snapshots[0] || null);
      } catch {
        if (!canceled) {
          setRollbackSnapshots([]);
          setLastRollback(null);
        }
      }
    }, 300);

    return () => {
      canceled = true;
      window.clearTimeout(refreshTimer);
    };
  }, [connectedProjectPath, messages.length]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const savedRaw: SavedChat[] = JSON.parse(localStorage.getItem("payfix_saved_chats") || "[]") || [];
        const saved = savedRaw.map(normalizeSavedChatTitle);
        const draft: DraftState = JSON.parse(localStorage.getItem("payfix_active_draft") || "{}") || {};
        const lastConnectedProject = localStorage.getItem("payfix_last_connected_project") || "";
        const draftActiveChatId = draft.activeChatId || "";
        const activeSavedChat = draftActiveChatId
          ? saved.find((chat: SavedChat) => chat.id === draftActiveChatId)
          : null;

        setSavedChats(saved);
        if (JSON.stringify(savedRaw) !== JSON.stringify(saved)) {
          safeSetJsonStorage("payfix_saved_chats", saved.map(trimSavedChatForStorage), []);
        }
        setQuestion(draft.question || "");
        setLog(draft.log || "");
        setCode(draft.code || "");
        setProjectPath(draft.projectPath || activeSavedChat?.projectPath || activeSavedChat?.connectedProjectPath || lastConnectedProject || "");
        setConnectedProjectPath(draft.connectedProjectPath || activeSavedChat?.connectedProjectPath || "");
        setProjectContext(draft.projectContext || activeSavedChat?.projectContext || "");
        setSearchFolder(draft.searchFolder || activeSavedChat?.searchFolder || "");
        setSearchFileName(draft.searchFileName || activeSavedChat?.searchFileName || "");
        setSearchText(draft.searchText || activeSavedChat?.searchText || "");
        setComputerSearchResults(draft.computerSearchResults || activeSavedChat?.computerSearchResults || "");
        setComputerSearchPreview(draft.computerSearchPreview || activeSavedChat?.computerSearchPreview || "");
        const restoredAgentSessionMessages = draft.agentSessionMessages || [];
        const restoredMessages = recoverAgentTrailForMessages(draft.messages || activeSavedChat?.messages || [], restoredAgentSessionMessages);

        setUploadedFiles(draft.uploadedFiles || []);
        setMessages(restoredMessages);
        setAgentSessionMessages(restoredAgentSessionMessages);
        setAgentSessionOpen(Boolean(draft.agentSessionOpen && draft.agentSessionMessages?.length));
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
      const draft: DraftState = {
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
        messages,
        activeChatId,
        agentSessionOpen,
        agentSessionMessages,
        agentSessionUploads,
      };
      safeSetJsonStorage("payfix_active_draft", draft, trimDraftForStorage(draft));
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
    messages,
    activeChatId,
    agentSessionOpen,
    agentSessionMessages,
    agentSessionUploads,
  ]);

  useEffect(() => {
    if (!agentStatus || loading || agentLoading || timelineLoading || dependencyInstalling) return;

    const clearStatusTimer = window.setTimeout(() => {
      setAgentStatus("");
    }, /failed|error|blocked|could not/i.test(agentStatus) ? 6500 : 3500);

    return () => window.clearTimeout(clearStatusTimer);
  }, [agentStatus, loading, agentLoading, timelineLoading, dependencyInstalling]);

  useEffect(() => {
    if (!connectedProjectPath) return;
    localStorage.setItem("payfix_last_connected_project", connectedProjectPath);
    void fetch("/api/local-agent/set-root", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: connectedProjectPath }),
    }).catch(() => undefined);
  }, [connectedProjectPath]);

  useEffect(() => {
    if (!liveCaptureEnabled || !connectedProjectPath) return;

    let canceled = false;
    const pollLiveCapture = async () => {
      try {
        const response = await fetch("/api/local-agent/project/watch/events", { cache: "no-store" });
        const data = (await response.json()) as WatchModeResult;
        if (!canceled) setWatchModeResult(data);
      } catch (err: unknown) {
        if (!canceled) {
          setLiveCaptureEnabled(false);
          setAgentStatus(`Live Capture paused: ${errorMessage(err)}`);
        }
      }
    };

    const pollTimer = window.setInterval(pollLiveCapture, 4000);
    void pollLiveCapture();

    return () => {
      canceled = true;
      window.clearInterval(pollTimer);
    };
  }, [connectedProjectPath, liveCaptureEnabled]);

  const hasConversation = messages.length > 0;
  const hasAttachment =
    Boolean(computerSearchResults) ||
    uploadedFiles.length > 0 ||
    Boolean(connectedProjectPath) ||
    Boolean(projectContext) ||
    Boolean(log.trim()) ||
    Boolean(code.trim());
  const canSend = Boolean(question.trim() || selectedQuickReplies.length) || hasAttachment;
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
  const quickReplyOptions = useMemo(() => {
    const latestAssistant = messages.at(-1);
    if (
      latestAssistant?.role !== "assistant" ||
      /^(Thinking|Generating image|Editing the uploaded image|Converting image|PayFix Agent is|Agent is running)/i.test(latestAssistant.content)
    ) {
      return [];
    }

    const options = extractQuickReplyOptions(latestAssistant?.content || "");
    if (!options.length) return [];

    const currentDraftContext = [
      question,
      log,
      code,
      uploadedFiles.map((file) => file.name).join(" "),
      computerSearchResults ? "computer search evidence" : "",
      connectedProjectPath ? "connected project" : "",
    ]
      .filter(Boolean)
      .join("\n");
    const currentIntent = quickReplyIntent(currentDraftContext);
    const assistantIntent = quickReplyIntent(latestAssistant?.content || "");

    if (question.trim() && currentIntent === "unknown") return [];
    if (currentDraftContext.trim() && !intentsCompatible(currentIntent, assistantIntent)) return [];

    return options;
  }, [code, computerSearchResults, connectedProjectPath, log, messages, question, uploadedFiles]);

  useEffect(() => {
    setSelectedQuickReplies((current) => current.filter((reply) => quickReplyOptions.includes(reply)));
  }, [quickReplyOptions]);
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
  const liveCaptureEvent = useMemo(() => {
    if (!liveCaptureEnabled) return null;

    return (
      [...(watchModeResult?.events || [])]
        .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
        .find((event) => {
        const eventKey = watchEventKey(event);
        const hasRiskyAnalysis = Boolean(event.analysis && event.analysis.risk !== "low");
        const hasBlockingIssue = Boolean(event.issues?.some((issue) => issue.severity !== "info"));

        return eventKey !== dismissedLiveCaptureEventKey && (hasRiskyAnalysis || hasBlockingIssue);
        }) || null
    );
  }, [dismissedLiveCaptureEventKey, liveCaptureEnabled, watchModeResult]);
  useEffect(() => {
    if (!liveCaptureEvent) return;

    const target = liveCaptureEvent.relative || liveCaptureEvent.file;
    const title = liveCaptureEvent.analysis?.title || liveCaptureEvent.issues?.[0]?.message || "possible breakage";
    setAgentStatus(`Live Capture flagged ${target}: ${title}`);
  }, [liveCaptureEvent]);
  const canBuildTimeline = hasFreshTimelineInput || hasConversation || timelineSourceCandidates.length > 0;
  const runnerSrcDoc = useMemo(
    () => buildRunnerSrcDoc(runnerHtml, runnerCss, runnerJs),
    [runnerHtml, runnerCss, runnerJs],
  );
  const rollbackGroups = useMemo(() => {
    const groups = new Map<string, { key: string; file: string; snapshots: RollbackSnapshot[] }>();

    rollbackSnapshots.forEach((snapshot) => {
      const file = snapshot.relative || snapshot.file;
      const key = file.toLowerCase();
      const group = groups.get(key) || { key, file, snapshots: [] };
      group.snapshots.push(snapshot);
      groups.set(key, group);
    });

    return [...groups.values()].map((group) => ({
      ...group,
      snapshots: group.snapshots.sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    }));
  }, [rollbackSnapshots]);
  const visibleRollbackGroups = useMemo(
    () => (showAllRollbackSnapshots ? rollbackGroups : rollbackGroups.slice(0, 8)),
    [rollbackGroups, showAllRollbackSnapshots],
  );
  const visibleRollbackSnapshots = useMemo(
    () =>
      visibleRollbackGroups.flatMap((group) => [
        group.snapshots[0],
        ...(expandedRollbackFiles.includes(group.key) ? group.snapshots.slice(1) : []),
      ]).filter(Boolean),
    [expandedRollbackFiles, visibleRollbackGroups],
  );

  function questionReferencesImage(text: string) {
    return /\b(screenshot|screen shot|image|picture|photo|attached image|uploaded image|jpg|jpeg|png|webp)\b/i.test(
      text,
    );
  }

  function isRegularChatOnlyAgentRequest(
    text: string,
    files: UploadedFile[],
    context: { log?: string; code?: string; computerSearchResults?: string; previousAssistant?: string } = {},
  ) {
    const normalized = text.trim();
    const hasFiles = files.length > 0;
    const hasImages = files.some((file) => file.isImage);
    const hasTextEvidence = files.some((file) => !file.isImage);
    const hasPastedEvidence = Boolean(context.log?.trim() || context.code?.trim() || context.computerSearchResults?.trim());
    const asksToReadOrExplain =
      /^(what|why|how|can you|could you|please|tell me|describe|read|look|view|analy[sz]e|investigate|check|compare|explain|summari[sz]e|do you see|is there|are there)\b/i.test(
        normalized,
      ) ||
      /\b(what is|what's|look at|view|read|analy[sz]e|investigate|compare|explain|summari[sz]e|describe|see anything|sticking out|root cause|reason why)\b/i.test(
        normalized,
      ) ||
      /\b(whats wrong|what's wrong|what is wrong|wrong with|why(?:'s| is)? .*?(?:failing|blocked|not working|broken|wrong))\b/i.test(
        normalized,
      );
    const asksForProjectWork =
      /\b(apply|patch|change|modify|edit|update|create|generate|write|add|remove|delete|rename|refactor|fix the project|fix code|full project|codebase|project files?|source files?|folder|install|dependency|package|run tests?|validate|lint|build|typecheck|compile|visual fix|css|component|local app|localhost)\b/i.test(
        normalized,
      ) ||
      isSketchProjectCreationRequest(normalized);
    const asksForSpecializedTool = /\b(payment trace|trace payment|timeline|emv decoder|decode tlv|device lab|webhook lab|visual fix)\b/i.test(
      normalized,
    );
    const looksLikeGeneralQuestion =
      /^(what|why|how|who|when|where|can you|could you|please|tell me|explain|summari[sz]e)\b/i.test(normalized) ||
      /\?$/.test(normalized);
    const isContextualFollowUp = asksContextualClarificationFollowUp(normalized, context.previousAssistant || "");
    const evidenceOnly =
      hasFiles ||
      hasImages ||
      hasTextEvidence ||
      hasPastedEvidence ||
      questionReferencesImage(normalized) ||
      /\b(logs?|har|gateway response|screenshot|image|photo|picture|tlv|emv|receipt|payload|json|csv|txt|code snippet|pasted code)\b/i.test(normalized);

    const uploadOnlyFallback = /^investigate uploaded file\(s\)\.?$/i.test(normalized) && hasFiles;

    const regularEvidenceRequest =
      (uploadOnlyFallback || (evidenceOnly && asksToReadOrExplain) || (hasPastedEvidence && !asksForProjectWork)) &&
      !asksForProjectWork &&
      !asksForSpecializedTool;
    const regularGeneralQuestion =
      looksLikeGeneralQuestion &&
      !isContextualFollowUp &&
      !evidenceOnly &&
      !asksForProjectWork &&
      !asksForSpecializedTool;

    return regularEvidenceRequest || regularGeneralQuestion;
  }

  function regularChatRedirectMessage(prompt: string, files: UploadedFile[]) {
    const fileText = files.length
      ? `\n\nAttached evidence stays available: ${files.map((file) => file.name).join(", ")}`
      : "";

    return `This belongs in Regular Chat, not Agent mode.

Regular Chat is the right place for reading, explaining, comparing, or summarizing logs, screenshots, uploaded images, gateway responses, TLV/EMV evidence, and general questions.

Use Agent mode when you want PayFix to change files, inspect a connected project, prepare/apply a patch, install dependencies, run validation, create a new project, or launch Visual Fix against real project code. If the question is random or not related to the current project/action, ask it in Regular Chat.

Send this in Regular Chat:
${prompt}${fileText}`;
  }

  function watchEventKey(event: WatchEvent) {
    return event.eventId || `${event.watcherId || event.id || event.file}-${event.at}`;
  }

  function resolveProjectFilePath(file: string) {
    const clean = file.trim();
    if (!clean || /^[A-Za-z]:[\\/]/.test(clean)) return clean;

    return connectedProjectPath
      ? `${connectedProjectPath.replace(/[\\/]+$/, "")}\\${clean.replace(/^[\\/]+/, "").replace(/\//g, "\\")}`
      : clean;
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

  function isImageEditRequest(text: string) {
    const normalized = text.trim();
    const hasEditAction =
      /\b(make|turn|convert|export|save|send|return|change|crop|resize|upscale|enlarge|format|download|give me)\b/i.test(
        normalized,
      ) || /^(resize|upscale|crop|convert|format)\b/i.test(normalized);
    const looksLikeQuestion =
      /[?？]\s*$/.test(normalized) ||
      /^(does|do|is|are|was|were|can|could|should|would|what|why|how|where|tell me|describe|read|analyze|check)\b/i.test(
        normalized,
      );

    return hasEditAction && !(looksLikeQuestion && !/\b(make|turn|convert|export|save|change|crop|resize|upscale|enlarge|format)\b/i.test(normalized));
  }

  function imageOutputTarget(text: string, labelPrefix: string): ImageConversionTarget {
    if (/\b(jpe?g|jpg)\b/i.test(text)) {
      return { extension: "jpg", mime: "image/jpeg", label: `${labelPrefix} JPG` };
    }

    if (/\bwebp\b/i.test(text)) {
      return { extension: "webp", mime: "image/webp", label: `${labelPrefix} WebP` };
    }

    return { extension: "png", mime: "image/png", label: `${labelPrefix} PNG` };
  }

  function imageEditPlan(text: string): ImageEditPlan | null {
    if (!isImageEditRequest(text)) return null;

    const normalized = text.trim();
    const explicitSize = normalized.match(/\b(\d{2,5})\s*[x×]\s*(\d{2,5})\b/i);
    const explicitAspect = normalized.match(/\b(\d{1,3})\s*:\s*(\d{1,3})\b/);
    const mask = /\b(circle|circular|round|rounded avatar|avatar)\b/i.test(normalized) ? "circle" : undefined;
    const maxSide = resizedMaxSide(normalized);

    if (explicitSize) {
      const width = Number(explicitSize[1]);
      const height = Number(explicitSize[2]);
      const label = `${width}x${height}`;
      return {
        mode: "canvas",
        target: imageOutputTarget(normalized, label),
        label,
        suffix: label,
        aspectRatio: width / height,
        maxSide: Math.max(width, height),
        mask,
      };
    }

    if (explicitAspect) {
      const width = Number(explicitAspect[1]);
      const height = Number(explicitAspect[2]);
      const label = `${width}:${height}`;
      return {
        mode: "canvas",
        target: imageOutputTarget(normalized, label),
        label,
        suffix: `${width}-${height}`,
        aspectRatio: width / height,
        maxSide,
        mask,
      };
    }

    if (/\b(square|squared|one[-\s]?to[-\s]?one|logo tile|app icon|icon size|favicon)\b/i.test(normalized)) {
      const label = mask ? "round" : "square";
      return {
        mode: "canvas",
        target: imageOutputTarget(normalized, label),
        label,
        suffix: label,
        aspectRatio: 1,
        maxSide: squareOutputSide(normalized),
        mask,
      };
    }

    if (/\b(wide|banner|landscape|hero|cover)\b/i.test(normalized)) {
      return {
        mode: "canvas",
        target: imageOutputTarget(normalized, "wide"),
        label: "wide",
        suffix: "wide",
        aspectRatio: 16 / 9,
        maxSide,
        mask,
      };
    }

    if (/\b(portrait|vertical|story|mobile|phone)\b/i.test(normalized)) {
      return {
        mode: "canvas",
        target: imageOutputTarget(normalized, "portrait"),
        label: "portrait",
        suffix: "portrait",
        aspectRatio: 9 / 16,
        maxSide,
        mask,
      };
    }

    if (mask) {
      return {
        mode: "canvas",
        target: imageOutputTarget(normalized, "round"),
        label: "round",
        suffix: "round",
        aspectRatio: 1,
        maxSide,
        mask,
      };
    }

    if (/\b(resize|upscale|enlarge|larger|bigger|massive|huge|high[-\s]?res|hi[-\s]?res|4k|4096)\b/i.test(normalized)) {
      return {
        mode: "resize",
        target: imageOutputTarget(normalized, "resized"),
        label: "resized",
        suffix: "resized",
        maxSide,
      };
    }

    return null;
  }

  function isImageGenerationRequest(text: string) {
    const asksForGuidance =
      /\b(step by step|instructions?|where do i go|where to start|how to build|how do i build|what do i need|roadmap|plan|guide|explain|tell me|from here|next steps?|developer portal|resources|api docs?|documentation|integrat(?:e|ion)|implementation guidance)\b/i.test(
        text,
      );
    const explicitlyRequestsVisualAsset =
      /\b(generate|create|make|draw|sketch|design|produce|give me|download|draft|render)\b/i.test(text) &&
      /\b(image|picture|logo|icon|favicon|illustration|wireframe|mockup|prototype|diagram|flowchart|architecture diagram|uml|erd|entity relationship|blueprint|app map|site map|sitemap|program map|system map|screen map|user flow|ux flow|visual sketch|downloadable asset)\b/i.test(
        text,
      );
    const wantsVisualPlan =
      /\b(sketch|draw|visualize|wireframe|mockup|map out|blueprint|diagram|design)\b/i.test(text) &&
      /\b(website|dashboard|app|application|program|screen|page|ui|ux|interface|layout|flow|map|inventory|shop|saas|admin|portal|system)\b/i.test(text);

    return (
      !asksForGuidance &&
      (wantsVisualPlan || explicitlyRequestsVisualAsset) &&
      !/\b(convert|export|change format|to jpg|to jpeg|to png|to webp|resize|upscale|enlarge|crop)\b/i.test(text)
    );
  }

  function isReferenceImageEditRequest(text: string) {
    return (
      /\b(improve|enhance|polish|clean up|cleanup|professional|premium|make .*better|better|refine|redesign|rework|modernize|sharpen|vector|crisp|upgrade|fix logo|edit logo|edit image)\b/i.test(
        text,
      ) &&
      /\b(logo|image|picture|photo|icon|brand|mark|uploaded|attached|this)\b/i.test(text) &&
      !/\b(convert|export|change format|to jpg|to jpeg|to png|to webp|resize|crop|square)\b/i.test(text)
    );
  }

  function isImageGenerationFollowUp(text: string) {
    const previousAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.content || "";
    return (
      /\b(surprise|surprise me|you choose|pick one|whatever you think|make it nice|ugly|better|redo|regenerate|try again|massive|larger|bigger|premium|luxury)\b/i.test(text) &&
      /\b(logo|image|png|svg|jpg|jpeg|webp|favicon|monogram|downloadable|wireframe|mockup|prototype|diagram|flowchart|architecture|uml|erd|blueprint|dashboard|website|sketch|app map|user flow)\b/i.test(previousAssistant)
    );
  }

  function dedupeUploadedFiles(files: UploadedFile[]) {
    const seen = new Set<string>();

    return files.filter((file) => {
      const key = `${file.name}:${file.type}:${file.size}:${file.content.slice(0, 120)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function chatEvidenceUploads() {
    return dedupeUploadedFiles(messages.flatMap((message) => message.attachedUploads || []));
  }

  function mergePersistentEvidenceUploads(currentUploads: UploadedFile[]) {
    const currentHasImages = currentUploads.some((file) => file.isImage);
    const priorUploads = chatEvidenceUploads().filter((file) => !file.isImage || currentHasImages);
    return dedupeUploadedFiles([...priorUploads, ...currentUploads]);
  }

  function promptReferencesVisualEvidence(text: string) {
    const withoutWindowsPaths = text.replace(/[A-Za-z]:\\[^\s]+/g, " ");
    return /\b(image|images|screenshot|screenshots|screen shot|picture|photo|attached|attachment|upload|uploads|visible|looks|look at|shown|showing|see this|see these|these screenshots|those screenshots|this screenshot|that screenshot|above screenshot|settings page|dropdown|menu|options|what is it using|which is it using)\b/i.test(
      withoutWindowsPaths,
    );
  }

  function promptExplicitlyRequestsSavedEvidence(text: string) {
    const withoutWindowsPaths = text.replace(/[A-Za-z]:\\[^\s]+/g, " ");
    return /\b(previous|prior|older|old|saved|first|earlier|all|both|compare|logs?|files?|attachments?|uploads?|evidence|browser capture|captured page|uploaded file|attached file|attached screenshot|attached image|the screenshot|the image|the file|the log|these screenshots|those files|source evidence)\b/i.test(
      withoutWindowsPaths,
    );
  }

  function scopedAgentSessionUploadsForPrompt(prompt: string, files: UploadedFile[]) {
    const wantsVisualEvidence = promptReferencesVisualEvidence(prompt);
    if (wantsVisualEvidence) return dedupeUploadedFiles(files);
    return dedupeUploadedFiles(files.filter((file) => !file.isImage));
  }

  function activeAgentSessionUploadsForRun(prompt = "") {
    const wantsOlderEvidence = !hasBuildErrorEvidence(prompt) && promptExplicitlyRequestsSavedEvidence(prompt);
    if (agentSessionFreshUploads.length && !wantsOlderEvidence) {
      return dedupeUploadedFiles(agentSessionFreshUploads);
    }

    const isProjectBuilderSession = agentSessionMessages.some((message) => /^PROJECT CREATION BRIEF:/i.test(message.content));
    const wantsProjectBuilderImage =
      promptReferencesVisualEvidence(prompt) ||
      /\b(sketch|design|wireframe|mockup|generated image|from image|from screenshot|create project from|build app from|turn this into|turn the sketch|use this design)\b/i.test(
        prompt,
      );
    if (isProjectBuilderSession) {
      return wantsProjectBuilderImage ? dedupeUploadedFiles(agentSessionUploads.filter((file) => file.isImage)) : [];
    }

    if (!agentSessionFreshUploads.length && !wantsOlderEvidence) {
      const previousAssistant = latestActionableAssistantContext(agentSessionMessages);
      const scopedIntent = classifyAgentFollowUpIntent({
        prompt,
        hasImages: false,
        hasProject: Boolean(connectedProjectPath),
        isPaxAndroidBuiltSession: isPaxAndroidBuiltSession(),
        previousAssistant,
      });
      const shouldAvoidStaleEvidence =
        scopedIntent.route === "focused-follow-up" ||
        scopedIntent.route === "build-error" ||
        scopedIntent.route === "project-error" ||
        scopedIntent.route === "exact-next-steps" ||
        asksToRunReferencedCommands(prompt) ||
        asksCommandLocationHelp(prompt);

      if (shouldAvoidStaleEvidence) return [];
    }

    return scopedAgentSessionUploadsForPrompt(prompt, mergePersistentEvidenceUploads(agentSessionUploads));
  }

  async function classifyAgentFollowUpTurn({
    prompt,
    submittedUploadedFiles,
    previousAssistant,
  }: {
    prompt: string;
    submittedUploadedFiles: UploadedFile[];
    previousAssistant: string;
  }) {
    const fallback = classifyAgentFollowUpIntent({
      prompt,
      hasImages: submittedUploadedFiles.some((file) => file.isImage),
      hasProject: Boolean(connectedProjectPath),
      isPaxAndroidBuiltSession: isPaxAndroidBuiltSession(),
      previousAssistant,
    });

    try {
      const recentConversation = agentSessionMessages
        .slice(-8)
        .map((message) => {
          const uploads = message.attachedUploads?.length
            ? `\nAttachments: ${message.attachedUploads.map((file) => `${file.isImage ? "image" : "file"}:${file.name}`).join(", ")}`
            : "";
          return `${message.role.toUpperCase()}: ${message.content.slice(0, 1200)}${uploads}`;
        })
        .join("\n\n");
      const uploadSummary = submittedUploadedFiles
        .map((file, index) => `${index + 1}. ${file.isImage ? "image" : "file"} ${file.name} (${file.type || "unknown"}, ${file.size} bytes)`)
        .join("\n");
      const response = await fetch("/api/agent/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          hasImages: submittedUploadedFiles.some((file) => file.isImage),
          hasProject: Boolean(connectedProjectPath),
          isPaxAndroidBuiltSession: isPaxAndroidBuiltSession(),
          previousAssistant,
          recentConversation,
          uploadSummary,
        }),
      });
      const data: AgentIntentApiResponse = await response.json();
      if (!response.ok || !data.ok || !data.route) throw new Error(data.error || "Intent router failed.");

      if (
        (fallback.route === "build-error" || fallback.route === "project-error") &&
        data.route !== "build-error" &&
        data.route !== "project-error"
      ) {
        return {
          ...fallback,
          useImages: submittedUploadedFiles.some((file) => file.isImage),
          shouldRunProjectValidation: true,
        };
      }

      if (
        fallback.route === "screenshot-review" &&
        data.route !== "build-error" &&
        data.route !== "project-error"
      ) {
        return {
          ...fallback,
          useImages: submittedUploadedFiles.some((file) => file.isImage),
          shouldRunProjectValidation: false,
        };
      }

      if (
        fallback.route === "focused-follow-up" &&
        data.route !== "build-error" &&
        data.route !== "project-error"
      ) {
        return {
          ...fallback,
          useImages: submittedUploadedFiles.some((file) => file.isImage),
          shouldRunProjectValidation: false,
        };
      }

      return {
        route: data.route,
        reason: data.reason || "Classified by PayFix Agent router.",
        useImages: Boolean(data.useImages),
        shouldRunProjectValidation: Boolean(data.shouldRunProjectValidation),
      };
    } catch {
      return {
        ...fallback,
        useImages: submittedUploadedFiles.some((file) => file.isImage),
        shouldRunProjectValidation: fallback.route === "build-error" || fallback.route === "project-error" || fallback.route === "generic",
      };
    }
  }

  function wantsDecode(text: string) {
    return /\b(decode|encoded|base64|base64url|hex|url encoded|jwt|token)\b/i.test(text);
  }

  function isSpreadsheetEditRequest(text: string) {
    return /\b(excel|spreadsheet|xlsx|xls|csv)\b/i.test(text) && /\b(update|edit|change|modify|write|fix|add|delete|remove)\b/i.test(text);
  }

  function looksLikeSourceCode(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return true;

    if (/^[\[{]/.test(trimmed)) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch {
        // Keep checking for JavaScript/CSS/object literal style code below.
      }
    }

    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const codeKeywordPattern =
      /\b(function|const|let|var|class|interface|type|enum|import|export|return|if|else|for|while|switch|case|try|catch|async|await|public|private|protected|namespace|using|def|from|select|update|insert|delete|create|where|join|bool|BOOL|NSString|NSInteger|NSError|void|int|string|boolean)\b/i;
    const syntaxPattern =
      /(^\s*(#include|#import|@interface|@implementation|[-+]\s*\(|<\/?[a-z][\s\S]*?>)|=>|::|->|\/\/|\/\*|\*\/|[{}[\]();=<>])/i;

    const codeLikeLines = lines.filter((line) => codeKeywordPattern.test(line) || syntaxPattern.test(line)).length;
    const symbolCount = (trimmed.match(/[{}[\]();=<>]/g) || []).length;
    const hasNaturalSentence =
      /[.!?]\s+[A-Z]/.test(trimmed) || /\b(please|can you|how do i|what is|explain|issue|problem|error message)\b/i.test(trimmed);

    if (codeLikeLines >= 2) return true;
    if (codeLikeLines === 1 && (symbolCount >= 2 || lines.length === 1)) return true;
    if (symbolCount >= 4 && !hasNaturalSentence) return true;

    return false;
  }

  function validateCodeBoxBeforeSubmit(value: string) {
    if (looksLikeSourceCode(value)) return true;

    setAgentStatus("Invalid code: the Code box only accepts source code. Move notes or questions to the message box.");
    return false;
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

  function basename(file: string) {
    return file.split(/[\\/]/).pop() || file || "selected file";
  }

  function validationLabelForFile(file: string) {
    const clean = file.toLowerCase();
    if (/\.(ts|tsx)$/i.test(clean)) return "TypeScript type check + lint";
    if (/\.(js|jsx|mjs|cjs)$/i.test(clean)) return "JavaScript linting";
    if (/\.(cs|csproj|sln)$/i.test(clean)) return "C# build + code analysis";
    if (/\.(java|gradle|kt|kts)$/i.test(clean)) return /\.java$/i.test(clean) ? "Java compile + static analysis" : "Kotlin/Java build + lint";
    if (/\.(cc|cpp|cxx|hpp|hh|hxx)$/i.test(clean)) return "C++ compile + static analysis";
    if (/\.(c|h)$/i.test(clean)) return "C compile + static analysis";
    if (/\.py$/i.test(clean)) return "Python type checking + linting";
    if (/\.go$/i.test(clean)) return "Go build + vet + lint";
    if (/\.rs$/i.test(clean)) return "Rust check + Clippy";
    if (/\.swift$/i.test(clean)) return "Swift build + lint";
    if (/\.(php|phtml)$/i.test(clean)) return "PHP static analysis + lint";
    if (/\.(rb|rake)$/i.test(clean)) return "Ruby linting + static analysis";
    if (/\.dart$/i.test(clean)) return "Dart/Flutter analyze";
    if (/\.scala$/i.test(clean)) return "Scala compile + static analysis";
    if (/\.mm$/i.test(clean)) return "Objective-C build + static analysis";
    if (/\.(ex|exs)$/i.test(clean)) return "Elixir compile + Dialyzer";
    if (/\.(hs|lhs)$/i.test(clean)) return "Haskell build + lint";
    if (/\.lua$/i.test(clean)) return "Lua linting";
    if (/\.(pl|pm|t)$/i.test(clean)) return "Perl syntax check + lint";
    if (/\.r$/i.test(clean)) return "R package check / lint";
    if (/\.m$/i.test(clean)) return "Objective-C or MATLAB static analysis";
    if (/\.(css|scss|sass|less)$/i.test(clean)) return "style lint + project checks";
    if (/\.(html|htm)$/i.test(clean)) return "HTML validation + project checks";
    return "project diagnostics";
  }

  function applyStatusForFiles(files: string[]) {
    const uniqueLabels = [...new Set(files.filter(Boolean).map(validationLabelForFile))];
    const fileLabel = files.length === 1 ? basename(files[0]) : `${files.length} files`;
    return `Applying patch to ${fileLabel} and running ${uniqueLabels.slice(0, 3).join(", ") || "project diagnostics"}...`;
  }

  function summarizeChangedLines(oldContent: string, newContent: string) {
    const oldLines = oldContent.split(/\r?\n/);
    const newLines = newContent.split(/\r?\n/);
    let start = 0;

    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
      start += 1;
    }

    let oldEnd = oldLines.length - 1;
    let newEnd = newLines.length - 1;
    while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
      oldEnd -= 1;
      newEnd -= 1;
    }

    if (start > oldEnd && start > newEnd) {
      return "No changed lines detected in preview.";
    }

    const newStartLine = start + 1;
    const newEndLine = Math.max(newStartLine, newEnd + 1);
    const oldStartLine = start + 1;
    const oldEndLine = Math.max(oldStartLine, oldEnd + 1);
    const newSnippet = newLines.slice(start, newEnd + 1).slice(0, 8);

    return [
      `Lines ${newStartLine}${newEndLine !== newStartLine ? `-${newEndLine}` : ""} updated`,
      oldEnd >= start ? `(replaced previous line${oldEndLine !== oldStartLine ? `s ${oldStartLine}-${oldEndLine}` : ` ${oldStartLine}`})` : "(inserted)",
      newSnippet.length
        ? `New code:\n${newSnippet.map((line, index) => `${newStartLine + index}: ${line}`).join("\n")}`
        : "New code: (empty block)",
    ].join("\n");
  }

  function summarizePreviewChanges(previews: Array<{ file?: string; oldContent?: string; newContent?: string }>) {
    if (!previews.length) return "- No preview diff was available.";

    return previews
      .map((preview) => {
        const file = preview.file || "unknown file";
        return `- ${file}\n${summarizeChangedLines(preview.oldContent || "", preview.newContent || "")
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}`;
      })
      .join("\n");
  }

  function agentWorkingMessageForPrompt(prompt: string, hasProject: boolean) {
    if (/explain .*root cause|root cause/i.test(prompt)) {
      return "PayFix Agent is explaining the root cause: separating failing evidence from baseline evidence and filtering out generic noise...";
    }

    if (/compare .*logs?|side by side|first divergence|suspect-only/i.test(prompt)) {
      return "PayFix Agent is comparing failing vs working evidence: aligning logs, finding the first divergence, and ranking suspect-only signals...";
    }

    if (/payment trace|trace timeline|timeline/i.test(prompt)) {
      return "PayFix Agent is building the payment trace: device read, SDK event, app request, gateway response, and final decision...";
    }

    if (/visual fix|contrast|spacing|overflow|css|style/i.test(prompt) && hasProject) {
      return "PayFix Agent is preparing a visual fix: inspecting UI evidence, finding style files, and building a reviewable patch...";
    }

    if (/\b(build|create|generate)\b[\s\S]{0,120}\b(full app|full project|runnable project|from scratch|android studio|visual studio|xcode|vs code)\b/i.test(prompt)) {
      return hasProject
        ? "PayFix Agent is building the project: reading SDK/artifact folders, selecting source files, adding required files, installing safe dependencies, and validating..."
        : "PayFix Agent is preparing the project build request. Connect or create a project folder so it can write files, install dependencies, and validate.";
    }

    if (/apply|patch|change|update|fix/i.test(prompt)) {
      return hasProject
        ? "PayFix Agent is preparing the requested code change, checking exact files, and building a reviewable patch..."
        : "PayFix Agent is reviewing the requested change against attached evidence...";
    }

    if (/validate|lint|type|build|compile|test|check|error|warning/i.test(prompt)) {
      return "PayFix Agent is running validation-focused investigation and collecting warnings, errors, and next steps...";
    }

    if (/audit|deeper|inspect|why|wrong|bug|risk/i.test(prompt)) {
      return "PayFix Agent is auditing behavior, reading relevant files, and separating proven issues from guesses...";
    }

    if (/install|dependency|package/i.test(prompt)) {
      return "PayFix Agent is checking dependency usage, package files, and validation requirements...";
    }

    return hasProject
      ? "PayFix Agent is investigating: indexing the project, selecting files, reading evidence, and preparing a reviewable result..."
      : "PayFix Agent is investigating evidence: reading uploads, logs, screenshots, and pasted context...";
  }

  function shouldUseProjectForAgentRun({
    userContent,
    submittedLog,
    submittedCode,
    submittedUploadedFiles,
    submittedComputerSearchResults,
  }: {
    userContent: string;
    submittedLog: string;
    submittedCode: string;
    submittedUploadedFiles: UploadedFile[];
    submittedComputerSearchResults: string;
  }) {
    if (!connectedProjectPath) return false;

    const text = userContent.toLowerCase();
    const wantsProjectWork =
      /\b(project|code|file|folder|repo|component|page|route|api|css|style|build|compile|lint|test|fix|patch|change|update|implement|create|install|dependency|localhost|app)\b/i.test(
        text,
      );
    if (wantsProjectWork) return true;

    const hasOnlyImageUploads =
      submittedUploadedFiles.length > 0 && submittedUploadedFiles.every((file) => file.isImage);
    if (hasOnlyImageUploads) return false;

    const hasStandaloneEvidence =
      Boolean(submittedLog.trim() || submittedCode.trim() || submittedComputerSearchResults.trim()) ||
      submittedUploadedFiles.some(
        (file) =>
          !file.isImage ||
          /\.(?:txt|log|har|json|xml|csv|tsv|yaml|yml|emv|tlv)$/i.test(file.name) ||
          /\b(?:log|trace|gateway|response|cardknox|processor|webhook|receipt|statement)\b/i.test(file.name),
      );

    if (hasStandaloneEvidence) return false;

    return true;
  }

  function replaceLatestAgentWorkingMessage(content: string, progress?: NonNullable<AgentProgressResponse["progress"]>) {
    setAgentSessionMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (!lastMessage || lastMessage.role !== "assistant") return currentMessages;
      if (!/^(Agent is running|PayFix Agent is|PayFix Agent received|Running project|Running |Choosing |Reading |Following local|Reasoning |Reasoning over|Scanning |Evidence-only mode|Investigating evidence|The main reasoning|Previewing the patch|Temporarily applying|Preparing |Prepared |Checked |Connecting |Loading |Loaded |Selecting |Inspecting |SDK folder|Feeding |Checking |Toolchain |Project investigation|Agent completed|Agent timed out)/i.test(lastMessage.content)) {
        return currentMessages;
      }

      return [
        ...currentMessages.slice(0, -1),
        {
          ...lastMessage,
          content,
          agentProgress: progress
            ? [
                ...(lastMessage.agentProgress || []).filter(
                  (item) => !(item.step === progress.step && item.message === progress.message),
                ),
                progress,
              ].slice(-14)
            : lastMessage.agentProgress,
        },
      ];
    });
  }

  function userWantsManualPatchReview(text: string) {
    return /\b(prepare (?:a )?patch|patch (?:file|preview|only)|preview|review before|show me (?:the )?patch|do not apply|don't apply|don't write|do not write|ask (?:me )?before|let me apply|manual apply|apply button|how can|how would|what (?:are|would)|options?|suggest(?:ion)?s?|could we|would it)\b/i.test(
      text,
    );
  }

  function shouldAutoApplyAgentPatch(text: string) {
    if (userWantsManualPatchReview(text)) return false;

    return /\b(do it|do this|do that|for me|make|change|update|fix|implement|add|remove|improve|redesign|restyle|style|clean up|build|create|apply)\b/i.test(
      text,
    );
  }

  function shouldAutoInstallAgentDependencies(text: string) {
    if (userWantsManualPatchReview(text)) return false;

    return /\b(build|create|generate|full app|full project|runnable project|from scratch|install dependencies|setup dependencies|add dependencies|make it run|run validation|compile|android studio|visual studio|vs code|xcode|gradle|maven|npm|pip|go mod|dotnet)\b/i.test(
      text,
    );
  }

  function isPaxAndroidBuildRequest(text: string) {
    return /\b(pax|a920|a80|poslink|broadpos|paxstore)\b/i.test(text) &&
      /\b(build|create|generate|full app|full project|runnable|go ahead|for me|android studio|android)\b/i.test(text);
  }

  function isReferentialAgentCommand(text: string) {
    const trimmed = text.trim();
    return (
      trimmed.length < 320 &&
      /\b(so|these|those|this|that|now what|what now|where exactly|what exactly|how exactly|please clarify|clarify|what do i click|where do i click|which option|what about|how about|do it|do this|do that|for me|go ahead|make it happen|yes|yep|ok(?:ay)?|apply it|implement it|fix it)\b/i.test(
        trimmed,
      )
    );
  }

  function buildEffectiveAgentRequest({
    userContent,
    priorSessionMessages,
    uploadedFilesForRun,
  }: {
    userContent: string;
    priorSessionMessages: ChatMessage[];
    uploadedFilesForRun: UploadedFile[];
  }) {
    const previousAssistant =
      [...priorSessionMessages].reverse().find((message) => message.role === "assistant")?.content || "";
    const previousUser = [...priorSessionMessages].reverse().find((message) => message.role === "user")?.content || "";
    const hasImageEvidence = uploadedFilesForRun.some((file) => file.isImage);
    const screenshotInstruction =
      hasImageEvidence
        ? `\n\nCURRENT UPLOADED SCREENSHOT/EVIDENCE HANDLING:
The uploaded image(s) are part of the user's current message. Read them before answering.
If the user's message is short or referential, such as "so", "these", "what about this", resolve it against the latest conversation plus the newly attached screenshots.
Do not say no screenshot/image was provided when image uploads are present.
If this is a UI/code-change request with a connected project, use the screenshot to choose likely source/style files. If this is an IDE/build/settings screenshot, answer the visible workflow/error question directly.`
        : "";

    if (!isReferentialAgentCommand(userContent) || !previousAssistant.trim()) {
      return `${userContent}${screenshotInstruction}`;
    }

    return `CURRENT USER COMMAND:
${userContent}

RESOLVED ACTIVE TASK:
The user is asking a follow-up about the previous Agent recommendation/request, not starting from scratch.
If the current command asks to do/apply/build/fix something, carry out the prior actionable recommendation.
If it asks "what now", "where exactly", "please clarify", "what do I click", or similar, clarify the exact prior step and give the narrow next action.

PREVIOUS USER REQUEST:
${previousUser.slice(0, 1600) || "(none)"}

PREVIOUS AGENT RECOMMENDATION:
${previousAssistant.slice(0, 3500)}
${screenshotInstruction}`;
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

  function squareOutputSide(text: string) {
    const explicit = text.match(/\b(512|1024|1200|1536|2048|3000|4096)\s*(?:px|pixels)?\b/i)?.[1];
    if (explicit) return Number(explicit);
    if (/\b(massive|huge|very large|4096|4k)\b/i.test(text)) return 4096;
    if (/\b(large|big|high[-\s]?res|hi[-\s]?res|retina)\b/i.test(text)) return 2048;
    return 1024;
  }

  function resizedMaxSide(text: string) {
    const explicit = text.match(/\b(512|1024|1200|1536|2048|3000|4096)\s*(?:px|pixels)?\b/i)?.[1];
    if (explicit) return Number(explicit);
    if (/\b(massive|huge|4096|4k)\b/i.test(text)) return 4096;
    if (/\b(large|big|larger|bigger|high[-\s]?res|hi[-\s]?res|retina)\b/i.test(text)) return 2048;
    return 1024;
  }

  function drawImageWithOptionalMask(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    x: number,
    y: number,
    width: number,
    height: number,
    mask?: ImageEditPlan["mask"],
  ) {
    if (!mask) {
      context.drawImage(image, x, y, width, height);
      return;
    }

    context.save();
    if (mask === "circle") {
      const diameter = Math.min(width, height);
      context.beginPath();
      context.arc(x + width / 2, y + height / 2, diameter / 2, 0, Math.PI * 2);
      context.clip();
    }
    context.drawImage(image, x, y, width, height);
    context.restore();
  }

  async function editImage(file: UploadedFile, plan: ImageEditPlan): Promise<GeneratedFile> {
    const image = await loadImageElement(file.content);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = document.createElement("canvas");

    if (plan.mode === "canvas") {
      const ratio = plan.aspectRatio || width / height || 1;
      const maxSide = Math.max(width, height, plan.maxSide || 1024);
      if (ratio >= 1) {
        canvas.width = maxSide;
        canvas.height = Math.round(maxSide / ratio);
      } else {
        canvas.height = maxSide;
        canvas.width = Math.round(maxSide * ratio);
      }
    } else {
      const maxSide = Math.max(width, height, plan.maxSide || 1024);
      const scale = maxSide / Math.max(width, height);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    }

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Image editing is not available in this browser.");
    }

    if (plan.target.mime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }

    const scale =
      plan.mode === "canvas"
        ? Math.min(canvas.width / width, canvas.height / height)
        : canvas.width / width;
    const drawWidth = Math.round(width * scale);
    const drawHeight = Math.round(height * scale);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    drawImageWithOptionalMask(
      context,
      image,
      Math.round((canvas.width - drawWidth) / 2),
      Math.round((canvas.height - drawHeight) / 2),
      drawWidth,
      drawHeight,
      plan.mask,
    );

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error(`Could not export ${plan.target.label}.`));
          }
        },
        plan.target.mime,
        plan.target.mime === "image/jpeg" ? 0.92 : undefined,
      );
    });

    const baseName = file.name.replace(/\.[^/.\\]+$/, "") || "image";
    return {
      name: `${baseName}-${plan.suffix}.${plan.target.extension}`,
      type: plan.target.mime,
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

  async function editImagesForChat(files: UploadedFile[], plan: ImageEditPlan) {
    const images = files.filter((file) => file.isImage && file.content);
    if (!images.length) {
      throw new Error("No image was available to edit.");
    }

    return Promise.all(images.map((file) => editImage(file, plan)));
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

  function isSketchProjectCreationRequest(text: string) {
    return /^CREATE PROJECT FROM GENERATED SKETCH\b/i.test(text.trim());
  }

  function projectCreationField(text: string, label: string) {
    const pattern = new RegExp(`${label}:\\s*\\n([\\s\\S]*?)(?=\\n\\n[A-Z][A-Za-z ]+:|\\n\\nRequirements:|$)`, "i");
    return text.match(pattern)?.[1]?.trim() || "";
  }

  function parseSketchProjectCreationRequest(text: string) {
    const rawFolderName = projectCreationField(text, "Folder name");
    return {
      parentPath: projectCreationField(text, "Target parent path"),
      folderName: /^\(auto-generate/i.test(rawFolderName) ? "" : rawFolderName,
      stack: projectCreationField(text, "Preferred stack") || "Next.js app",
    };
  }

  function currentProjectCreationBrief(messagesToSearch: ChatMessage[]) {
    const brief = [...messagesToSearch].reverse().find((message) => /^PROJECT CREATION BRIEF:/i.test(message.content));
    return brief?.content || "";
  }

  function latestGeneratedProjectPath(messagesToSearch: ChatMessage[]) {
    const created = [...messagesToSearch].reverse().find((message) => /\bPROJECT CREATED\b/i.test(message.content) && /\bPath:\s*\n/i.test(message.content));
    const explicitPath = created?.content.match(/Path:\s*\n([^\r\n]+)/i)?.[1]?.trim();
    if (explicitPath) return explicitPath;

    const request = [...messagesToSearch].reverse().find((message) => isSketchProjectCreationRequest(message.content));
    if (!request) return "";
    const parsed = parseSketchProjectCreationRequest(request.content);
    if (!parsed.parentPath || !parsed.folderName) return "";
    return `${parsed.parentPath.replace(/[\\/]+$/, "")}\\${parsed.folderName}`;
  }

  function asksToAddMissingJs(text: string) {
    return /\b(missing|add|include|create|need|where(?:'s| is)?)\b[\s\S]{0,80}\b(js|javascript|app\.js)\b/i.test(text) ||
      /\b(js|javascript|app\.js)\b[\s\S]{0,80}\b(missing|add|include|create|need)\b/i.test(text);
  }

  function asksToDeleteGeneratedProject(text: string) {
    const normalized = normalizedProjectCommand(text);
    const hasDeleteIntent = fuzzyProjectCommandToken(normalized, "delete") || /\b(clean up|trash|remove)\b/.test(normalized);
    const hasTargetIntent = /\b(it|this|that|generated|created|project|app|folder|directory)\b/.test(normalized);
    return hasDeleteIntent && hasTargetIntent;
  }

  function isPaxAndroidBuiltSession(messagesToCheck = agentSessionMessages) {
    return messagesToCheck.some((message) => message.role === "assistant" && /^PAX ANDROID APP BUILT/i.test(message.content));
  }

  function latestPaxAndroidBuildReport(messagesToCheck = agentSessionMessages) {
    return [...messagesToCheck].reverse().find((message) => message.role === "assistant" && /^PAX ANDROID APP BUILT/i.test(message.content))?.content || "";
  }

  function userSaysErrorsAreGone(text: string) {
    return /\b(no errors?|no more errors?|errors? (?:are )?gone|sync passed|build passed|it works|all good|fixed now|wow[, ]+no errors?)\b/i.test(text);
  }

  function hasBuildErrorEvidence(text: string) {
    return /\b(Configuration cache|Could not resolve|debugRuntimeClasspath|processDebugNavigationResources|Gradle|BUILD FAILED|CONFIGURE FAILED|PKIX path building failed|SSL handshake|certificate_unknown|Could not GET|Could not HEAD|Maven|repo\.maven|stacktrace|exception|error writing value|failed)\b/i.test(
      text,
    );
  }

  function asksForIdeWorkflowScreenshot(text: string, files: UploadedFile[]) {
    const hasScreenshot = files.some((file) => file.isImage) || questionReferencesImage(text);
    if (!hasScreenshot) return false;
    if (hasBuildErrorEvidence(text)) return false;

    const asksAboutVisibleUi = /\b(these|those|this|that|options?|menu|button|dropdown|what do i click|which one|i see|not seeing|can't find|cannot find|where is|under build|under file|under run)\b/i.test(
      text,
    );
    const mentionsIdeWorkflow = /\b(build|run|sync|make project|rebuild|apk|bundle|debug|release|deploy|install|device|emulator|android studio|visual studio|vs code|xcode|intellij|rider|eclipse|ide)\b/i.test(
      text,
    );
    const wantsVisualPatch = /\b(visual fix|fix ui|style|css|contrast|spacing|overflow|move|left side|right side|patch|change the project|make it look)\b/i.test(
      text,
    );

    return asksAboutVisibleUi && mentionsIdeWorkflow && !wantsVisualPatch;
  }

  function sdkArtifactsFromProjectFileList(fileList: string) {
    return fileList
      .split(/\r?\n/)
      .map((line) => line.match(/^FILE:\s*(.+)$/i)?.[1]?.trim() || "")
      .filter((file) => /(^|[\\/])app[\\/]libs[\\/].+\.(?:aar|jar)$/i.test(file))
      .filter((file, index, files) => files.findIndex((item) => item.toLowerCase() === file.toLowerCase()) === index)
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 30);
  }

  function paxAndroidExactNextStepsMessage(
    buildReport: string,
    options: { latestValidation?: string; userSaysNoErrors?: boolean; liveSdkArtifacts?: string[] } = {},
  ) {
    const projectMatch = buildReport.match(/Project:\n([^\n]+)/i)?.[1]?.trim() || connectedProjectPath || "the connected Android project";
    const namespace = buildReport.match(/Package\/namespace:\n([^\n]+)/i)?.[1]?.trim() || "the generated package";
    const copiedArtifactsBlock = buildReport.match(/SDK artifacts copied into app\/libs:\n([\s\S]*?)\n\nWhat PayFix wired:/i)?.[1]?.trim() || "";
    const liveSdkArtifacts = options.liveSdkArtifacts || [];
    const savedSdkArtifacts = copiedArtifactsBlock && !/No AAR\/JAR files/i.test(copiedArtifactsBlock)
      ? copiedArtifactsBlock
          .split(/\r?\n/)
          .map((line) => line.replace(/^-\s*/, "").trim())
          .filter(Boolean)
      : [];
    const sdkArtifacts = liveSdkArtifacts.length ? liveSdkArtifacts : savedSdkArtifacts;
    const latestValidation = options.latestValidation || "";
    const liveValidationPassed =
      /Sandbox checks passed|PASS .*gradlew|BUILD SUCCESSFUL/i.test(latestValidation) &&
      !/\bFAIL\b|BUILD FAILED|Could not resolve|PKIX|SSL handshake/i.test(latestValidation);
    const liveValidationFailed = /\bFAIL\b|BUILD FAILED|Could not resolve|PKIX|SSL handshake|Sandbox checks found failures/i.test(latestValidation);
    const userReportsClean = Boolean(options.userSaysNoErrors);
    const buildFailed =
      !userReportsClean &&
      (liveValidationFailed || (!latestValidation && /Sandbox checks found failures|FAIL .*gradlew|Build failed with an exception|Plugin \[id:/i.test(buildReport)));
    const pluginFailure =
      latestValidation.match(/Plugin \[id:[^\n]+/i)?.[0]?.trim() ||
      latestValidation.match(/Settings file '[^']+settings\.gradle(?:\.kts)?' line: \d+/i)?.[0]?.trim() ||
      latestValidation.match(/PKIX path building failed|SSL handshake exception|Could not resolve [^\r\n]+/i)?.[0]?.trim() ||
      (!latestValidation && buildReport.match(/Plugin \[id:[^\n]+/i)?.[0]?.trim()) ||
      (!latestValidation && buildReport.match(/Settings file '[^']+settings\.gradle(?:\.kts)?' line: \d+/i)?.[0]?.trim()) ||
      "";
    const successIntro =
      userReportsClean || liveValidationPassed
        ? "Nice, that means you are past the previous Gradle blocker. Here is the clean next path."
        : "";

    return `EXACT NEXT STEPS FOR THIS PAX ANDROID APP

${successIntro ? `${successIntro}\n\n` : ""}Project PayFix changed:
${projectMatch}

Generated namespace:
${namespace}

Current status:
${buildFailed ? `Do not try to run this on the PAX device yet. The project still has a build/sync failure${pluginFailure ? `:\n${pluginFailure}` : "."}` : userReportsClean && liveValidationFailed ? `Android Studio appears clean from your report. PayFix local validation still sees a machine/network validation issue (${pluginFailure || "see validation output"}), so continue in Android Studio and send PayFix the next real IDE/device error if one appears.` : "No known build/sync blocker is active from the latest context. Continue with build, install, and device testing."}

1. Open the exact project in Android Studio
- Android Studio -> File -> Open
- Select this folder:
  ${projectMatch}
- Wait until Android Studio finishes indexing.

2. Sync Gradle
- Click "Sync Now" if Android Studio shows the banner.
- Or use File -> Sync Project with Gradle Files.
- If sync fails, click "Fix build failure" in PayFix or send the first red Gradle error. PayFix should patch the project, not just explain it.

3. Confirm SDK libraries are present
- In Android Studio Project view, open:
  app/libs
- Expected:
  POSLink/PAX SDK files such as PAX_POSLinkAndroid_*.aar, POSLink_*.jar, and helper jars.
- Current project status:
${sdkArtifacts.length ? sdkArtifacts.map((file) => `  - ${file}`).join("\n") : "  No SDK .aar/.jar files were found in the current project file list. Add/select the extracted POSLink/PAX SDK folder, then ask PayFix to wire SDK artifacts again."}

4. Build the app
- Top menu -> Build -> Make Project.
- If it fails, send the first error block here and say "fix this build error".

5. Run it on the PAX device
- Connect the PAX A920/A80 device with USB debugging enabled.
- Select the device from the Android Studio device dropdown.
- Click Run.

6. Finish the real payment bridge
- Open PaymentServiceBridge.
- PayFix created the bridge file and copied SDK artifacts, but the exact POSLink/BroadPOS call depends on the vendor sample/docs inside your SDK.
- If you want PayFix to finish that part, send: "wire the actual POSLink payment call from the SDK samples" and keep the SDK folders attached. PayFix will inspect readable samples/AIDL/docs and patch the bridge.

If anything turns red, do not manually hunt through files. Paste the first error or screenshot and ask "fix this"; PayFix should run validation and patch the exact file.`;
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
      const [memoryResponse, mapResponse, watchResponse, gitResponse, portResponse, toolchainResponse] = await Promise.all([
        fetch("/api/local-agent/project/memory"),
        fetch("/api/local-agent/project/map"),
        fetch("/api/local-agent/project/watch/events"),
        fetch("/api/local-agent/project/git/status"),
        fetch("/api/local-agent/system/ports/list"),
        fetch("/api/local-agent/project/toolchain"),
      ]);
      const memoryData = (await memoryResponse.json()) as ProjectMemoryResult;
      const mapData = (await mapResponse.json()) as ProjectMapResult;
      const watchData = (await watchResponse.json()) as WatchModeResult;
      const gitData = (await gitResponse.json()) as GitStatusResult;
      const portData = (await portResponse.json()) as PortManagerResult;
      const toolchainData = (await toolchainResponse.json()) as ToolchainDoctorResult;

      setProjectMemory(memoryData);
      setProjectMap(mapData);
      setWatchModeResult(watchData);
      setGitStatusResult(gitData);
      setPortManagerResult(portData);
      setToolchainDoctorResult(toolchainData);

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

  async function refreshPorts() {
    setProjectIqLoading(true);
    setAgentStatus("Scanning listening localhost ports...");

    try {
      const response = await fetch("/api/local-agent/system/ports/list", { cache: "no-store" });
      const data = (await response.json()) as PortManagerResult;
      setPortManagerResult(data);
      if (!data.ok) throw new Error(data.error || "Port scan failed.");

      const devCount = (data.ports || []).filter((port) => port.devServerLikely).length;
      setAgentStatus(`Port scan complete: ${(data.ports || []).length} listening port(s), ${devCount} likely dev server(s).`);
    } catch (err: unknown) {
      setAgentStatus(`Port scan failed: ${errorMessage(err)}`);
    } finally {
      setProjectIqLoading(false);
    }
  }

  async function refreshToolchainDoctor() {
    setProjectIqLoading(true);
    setAgentStatus("Checking project toolchain...");

    try {
      await ensureLocalAgentProjectRoot();
      const response = await fetch("/api/local-agent/project/toolchain", { cache: "no-store" });
      const data = (await response.json()) as ToolchainDoctorResult;
      setToolchainDoctorResult(data);
      if (!data.ok) {
        setAgentStatus("");
        return;
      }

      const missingCount = data.missing?.length || 0;
      setAgentStatus(
        missingCount
          ? `Toolchain Doctor found ${missingCount} missing validator/toolchain item(s).`
          : "Toolchain Doctor found the detected project toolchains available.",
      );
    } catch (err: unknown) {
      setToolchainDoctorResult({ ok: false, error: errorMessage(err) });
      setAgentStatus("");
    } finally {
      setProjectIqLoading(false);
    }
  }

  async function stopPort(port: number) {
    setProjectIqLoading(true);
    setAgentStatus(`Stopping dev server on port ${port}...`);

    try {
      const response = await fetch("/api/local-agent/system/ports/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || `Could not stop port ${port}.`);
      setAgentStatus(`Stopped port ${port}.`);
      await refreshPorts();
    } catch (err: unknown) {
      setAgentStatus(`Stop port failed: ${errorMessage(err)}`);
    } finally {
      setProjectIqLoading(false);
    }
  }

  async function restartPort(port: number) {
    setProjectIqLoading(true);
    setAgentStatus(`Restarting connected project on port ${port}...`);

    try {
      await ensureLocalAgentProjectRoot();
      const response = await fetch("/api/local-agent/system/ports/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || `Could not restart port ${port}.`);
      setAgentStatus(`Restarted ${data.started?.script || "dev server"} on port ${port}.`);
      window.setTimeout(() => {
        void refreshPorts();
      }, 1200);
    } catch (err: unknown) {
      setAgentStatus(`Restart port failed: ${errorMessage(err)}`);
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

  async function startLiveCapture() {
    if (!connectedProjectPath) {
      setAgentStatus("Connect a project first, then start Live Capture.");
      return;
    }

    setProjectIqOpen(true);
    setProjectIqLoading(true);
    setAgentStatus("Starting Live Capture...");

    try {
      await ensureLocalAgentProjectRoot();

      const gitResponse = await fetch("/api/local-agent/project/git/status");
      const gitData = (await gitResponse.json()) as GitStatusResult;
      setGitStatusResult(gitData);

      const currentWatchers = watchModeResult?.watchers || [];
      const typedFile = watchFilePath.trim();
      const changedFile = gitData.ok ? gitData.changedFiles?.find((file) => Boolean(file.file))?.file || "" : "";
      const fileToWatch = typedFile || (currentWatchers.length ? "" : resolveProjectFilePath(changedFile));

      if (!currentWatchers.length && fileToWatch) {
        const watchResponse = await fetch("/api/local-agent/project/watch/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: fileToWatch }),
        });
        const watchData = await watchResponse.json();
        if (!watchData.ok) throw new Error(watchData.error || "Could not start file watch.");
        setWatchFilePath(watchData.file || fileToWatch);
      }

      if (!currentWatchers.length && !fileToWatch) {
        setAgentStatus("Live Capture needs a file to watch. Paste a full file path or make a Git change first.");
        return;
      }

      const eventsResponse = await fetch("/api/local-agent/project/watch/events", { cache: "no-store" });
      setWatchModeResult((await eventsResponse.json()) as WatchModeResult);
      setLiveCaptureEnabled(true);
      setDismissedLiveCaptureEventKey("");
      setAgentStatus("Live Capture is watching saved code changes.");
    } catch (err: unknown) {
      setLiveCaptureEnabled(false);
      setAgentStatus(`Live Capture failed: ${errorMessage(err)}`);
    } finally {
      setProjectIqLoading(false);
    }
  }

  async function openAgentFromWatchEvent(event: WatchEvent) {
    const issueSummary = (event.issues || [])
      .filter((issue) => issue.severity !== "info")
      .map((issue) => `- ${issue.severity.toUpperCase()}: ${issue.message}`)
      .join("\n");
    const analysisSummary = event.analysis
      ? `Title: ${event.analysis.title}
Risk: ${event.analysis.risk}
Confidence: ${event.analysis.confidence}%
Probable cause: ${event.analysis.probableCause}
Suggested fix: ${event.analysis.suggestedFix}
Evidence:
${event.analysis.evidence.map((item) => `- ${item}`).join("\n")}
Validation:
${event.analysis.validation.map((item) => `- ${item}`).join("\n")}`
      : "No structured analysis was attached to this event.";
    const prompt = `Live Capture flagged a risky code change while I was coding.

File: ${event.file}
Relative: ${event.relative || "unknown"}
Event: ${event.eventType}
Changed lines: +${event.addedLines || 0} / -${event.removedLines || 0}
Time: ${event.at}

WATCH ANALYSIS
${analysisSummary}

WATCH ISSUES
${issueSummary || "None"}

RECENT FILE PREVIEW
${event.preview || "(No preview captured.)"}

Please inspect the exact project file and neighboring code. Decide whether this is invalid code, wrongly placed code, broken logic, or a false positive. If there is a real issue, produce a safe patch preview with the corrected code and validation steps.`;

    setAgentSessionOpen(true);
    setAgentSessionMessages([]);
    setAgentSessionUploads([]);
    setAgentSessionFreshUploads([]);
    setAgentLoading(true);
    setAgentStatus("PayFix Agent is investigating the Live Capture event...");

    try {
      await runAgentPromptInSession({
        userContent: prompt,
        submittedLog: "",
        submittedCode: event.preview || "",
        submittedUploadedFiles: [],
        submittedComputerSearchResults: "",
        resetSession: true,
      });
      setDismissedLiveCaptureEventKey(watchEventKey(event));
    } catch {
      // runAgentPromptInSession already writes the failure into the Agent session.
    } finally {
      setAgentLoading(false);
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
    setAgentStatus("Visual Fix opened from inspected element. Find the CSS file manually or run the Agent for a real patch.");
  }

  function runVisualFixAgent(visualPrompt = "") {
    const targetDetails = [
      visualPrompt.trim() ? `User-described visual issue:\n${visualPrompt.trim()}` : "",
      cssSelector ? `Selector: ${cssSelector}` : "",
      selectedCssFile ? `Matched CSS file: ${selectedCssFile}` : cssFileName ? `CSS file hint: ${cssFileName}` : "",
      cssProperty ? `CSS property focus: ${cssProperty}` : "",
      cssColor ? `Candidate color: ${cssColor}` : "",
      cssPreview ? `Current manual preview:\n${cssPreview.slice(0, 2200)}` : "",
      uploadedFiles.length
        ? `Attached visual evidence:\n${uploadedFiles.map((file, index) => `- ${file.isImage ? "Image" : "File"} ${index + 1}: ${file.name}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    setShowColorEditor(false);
    void startAgentFromActionPrompt(`Visual Fix Agent request:
Inspect the connected project UI styling and prepare a reviewable patch for the visible issue. Focus on contrast, readability, spacing, overflow, hover/focus states, and whether text is legible in the current PayFix theme.

${targetDetails || "No visual issue was typed. Ask the user for a screenshot or a short description if the project evidence is not enough."}

Do not just pick a color. Find the exact component/CSS source, explain the visual issue, prepare a safe patch preview, and recommend the validation/screenshot check.`);
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

  function dependencyPackageNames(proposal: DependencyProposal | null) {
    if (!proposal) return [];

    const rawNames = proposal.packageNames?.length ? proposal.packageNames : [proposal.packageName];
    return [
      ...new Set(
        rawNames
          .flatMap((item) => String(item || "").split(/[,\s]+/))
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  }

  function requestInstallProposedDependency() {
    if (!dependencyProposal?.needed) return;

    const packageNames = dependencyPackageNames(dependencyProposal);
    if (!packageNames.length) return;
    if (dependencyProposal.installable === false) {
      setAgentStatus(dependencyProposal.installCommand || "PayFix found missing dependencies, but automatic install is not safe for this ecosystem.");
      return;
    }

    setDependencyConfirmOpen(true);
  }

  async function installProposedDependency() {
    if (!dependencyProposal?.needed) return;

    const packageNames = dependencyPackageNames(dependencyProposal);
    const packageLabel = packageNames.join(", ");
    if (!packageNames.length) return;

    setDependencyConfirmOpen(false);
    setDependencyInstalling(true);
    setAgentStatus(`Installing ${packageLabel}...`);

    try {
      const response = await fetch("/api/local-agent/project/install-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageName: packageNames[0],
          packageNames,
          ecosystem: dependencyProposal.ecosystem || "node",
          dev: dependencyProposal.devDependency,
        }),
      });
      const responseText = await response.text();
      let data: {
        ok?: boolean;
        error?: string;
        command?: string;
        packageNames?: string[];
        ecosystem?: string;
        initialized?: boolean;
        bootstrapCommands?: { command: string; ok: boolean; output: string }[];
        metadataUpdated?: boolean;
        metadataFile?: string;
        metadataAdded?: string[];
      } = {};

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

      setAgentStatus(`Installed ${data.packageNames?.join(", ") || packageLabel}. Running validation...`);
      const validationSummary = await runPostApplySandboxChecks();
      const bootstrapSummary = data.initialized
        ? `\nProject metadata initialized first:\n${(data.bootstrapCommands || [])
            .map((command) => `- ${command.ok ? "PASS" : "FAIL"} ${command.command}`)
            .join("\n")}\n`
        : "";
      const metadataSummary = data.metadataUpdated
        ? `\nProject metadata updated: ${data.metadataFile}\nAdded: ${(data.metadataAdded || []).join(", ")}\n`
        : "";
      const installMessage: ChatMessage = {
        role: "assistant",
        content: `Dependency installed.\n\nPackage${packageNames.length === 1 ? "" : "s"}: ${
          data.packageNames?.join(", ") || packageLabel
        }\nCommand: ${data.command}${bootstrapSummary}${metadataSummary}\nVALIDATION\n${validationSummary}`,
      };
      if (agentSessionOpen) {
        setAgentSessionMessages((current) => [...current, installMessage]);
      }
      const nextMessages = [...messages, installMessage];
      setMessages(nextMessages);
      saveActiveChat(nextMessages);
      setDependencyProposal(null);
      setAgentStatus(
        /Sandbox checks found failures|FAIL/i.test(validationSummary)
          ? "Dependencies installed, but validation still found failures. Use the Fix validation failure button."
          : `Installed ${data.packageNames?.join(", ") || packageLabel} and validation passed or was safely skipped.`,
      );
    } catch (err: unknown) {
      setAgentStatus(`Dependency install failed: ${errorMessage(err)}`);
    } finally {
      setDependencyInstalling(false);
    }
  }

  async function autoInstallAgentDependencyProposal(proposal: DependencyProposal | undefined, prompt: string) {
    if (!connectedProjectPath || !proposal?.needed || !shouldAutoInstallAgentDependencies(prompt)) return null;

    const packageNames = dependencyPackageNames(proposal);
    const packageLabel = packageNames.join(", ");
    if (!packageNames.length) return null;

    if (proposal.installable === false) {
      const manualMessage: ChatMessage = {
        role: "assistant",
        content: `DEPENDENCY INSTALL NEEDS REVIEW\n\nPayFix detected missing dependencies, but automatic install is not safe for this ecosystem or package mapping.\n\nPackage(s): ${packageLabel}\nInstall command:\n${proposal.installCommand || "See the project package manager config."}\n\nReason:\n${proposal.reason}`,
      };
      setAgentStatus("Dependency install needs manual review.");
      return manualMessage;
    }

    setDependencyInstalling(true);
    setAgentStatus(`Installing detected project dependencies: ${packageLabel}...`);

    try {
      await ensureLocalAgentProjectRoot();
      const response = await fetch("/api/local-agent/project/install-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageName: packageNames[0],
          packageNames,
          ecosystem: proposal.ecosystem || "node",
          dev: proposal.devDependency,
        }),
      });
      const responseText = await response.text();
      let data: {
        ok?: boolean;
        error?: string;
        command?: string;
        packageNames?: string[];
        ecosystem?: string;
        initialized?: boolean;
        bootstrapCommands?: { command: string; ok: boolean; output: string }[];
        metadataUpdated?: boolean;
        metadataFile?: string;
        metadataAdded?: string[];
      } = {};

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
        throw new Error(data.error || "Package install failed.");
      }

      setAgentStatus(`Installed ${data.packageNames?.join(", ") || packageLabel}. Running validation...`);
      const validationSummary = await runPostApplySandboxChecks();
      const bootstrapSummary = data.initialized
        ? `\n\nProject metadata initialized first:\n${(data.bootstrapCommands || [])
            .map((command) => `- ${command.ok ? "PASS" : "FAIL"} ${command.command}`)
            .join("\n")}`
        : "";
      const metadataSummary = data.metadataUpdated
        ? `\n\nProject metadata updated: ${data.metadataFile}\nAdded: ${(data.metadataAdded || []).join(", ")}`
        : "";

      setDependencyProposal(null);
      setAgentStatus(
        /Sandbox checks found failures|FAIL/i.test(validationSummary)
          ? "Dependencies installed, but validation still found failures."
          : `Installed ${data.packageNames?.join(", ") || packageLabel} and validation passed or was safely skipped.`,
      );

      return {
        role: "assistant" as const,
        content: `DEPENDENCIES INSTALLED BY AGENT\n\nPackage${packageNames.length === 1 ? "" : "s"}: ${
          data.packageNames?.join(", ") || packageLabel
        }\nEcosystem: ${data.ecosystem || proposal.ecosystem || "node"}\nCommand: ${data.command}${bootstrapSummary}${metadataSummary}\n\nReason:\n${proposal.reason}\n\nVALIDATION\n${validationSummary}`,
      };
    } catch (error: unknown) {
      setAgentStatus(`Dependency install failed: ${errorMessage(error)}`);
      return {
        role: "assistant" as const,
        content: `DEPENDENCY INSTALL FAILED\n\nPackage${packageNames.length === 1 ? "" : "s"}: ${packageLabel}\nReason:\n${proposal.reason}\n\nError:\n${errorMessage(error)}`,
      };
    } finally {
      setDependencyInstalling(false);
    }
  }

  function loadAgentPatchIntoApplyModal(data: AgentApiResponse) {
    const patch = primaryAgentPatch(data);
    const preview = data.preview;
    if (!agentResponseHasApplyablePatch(data) || !patch || patch.mode === "none" || !preview?.ok) {
      return false;
    }
    const patchMode = patch.mode === "delete" ? "delete" : patch.mode === "replace" ? "replace" : "insert";

    setLastVerifiedAgentPatch(data);
    const apiPatchSet = data.result?.patchSet || data.patchSet || [];
    const nextApplyKey = makeApplyPreviewKey({
      file: patch.file,
      mode: patchMode,
      search: patch.search,
      content: patch.replacement,
    });

    if (appliedPatchKeys.includes(nextApplyKey)) {
      setAgentStatus(`Patch for ${basename(patch.file)} was already applied. No Apply preview reopened.`);
      return false;
    }

    setApplyFilePath(patch.file);
    setApplyMode(patchMode);
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
    setDiffOldContent(preview.oldContent || "");
    setDiffNewContent(preview.newContent || "");
    setApplyPatchSet(
      apiPatchSet.length > 1
        ? apiPatchSet.map((item) => ({
            fileCandidate: item.file,
            resolvedFile: item.file,
            mode: item.mode === "delete" ? "delete" : item.mode === "replace" ? "replace" : "insert",
            search: item.search,
            replacement: item.replacement,
          }))
        : [],
    );
    setApplyPreviewKey(nextApplyKey);
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
    mode: "insert" | "replace" | "overwrite" | "delete";
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

  function markPatchApplied(files: string[], key = currentApplyPreviewKey()) {
    const cleanFiles = files.filter(Boolean);
    const validationLabel = [...new Set(cleanFiles.map(validationLabelForFile))].slice(0, 3).join(", ") || "project diagnostics";

    setAppliedPatchKeys((current) => (current.includes(key) ? current : [...current, key]));
    setAppliedPatchNotice({
      key,
      files: cleanFiles,
      validationLabel,
      appliedAt: new Date().toLocaleString(),
    });
  }

  function rememberRollbackSnapshot(snapshot: RollbackSnapshot) {
    setLastRollback(snapshot);
    setRollbackSnapshots((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== snapshot.id);
      return [snapshot, ...withoutDuplicate].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );
    });
  }

  function invalidateApplyPreview() {
    setApplyPreviewKey("");
    setDiffOldContent("");
    setDiffNewContent("");
  }

  function appendAssistantStatusMessage(content: string) {
    const shouldAttachAgentTrail =
      agentSessionMessages.some((message) => message.role === "assistant") &&
      /Dependency installed|PATCH APPLIED BY AGENT|PATCH VALIDATION|PATCH ROLLED BACK/i.test(content);
    const statusMessage: ChatMessage = {
      role: "assistant",
      content,
      agentSessionMessages: shouldAttachAgentTrail
        ? [...agentSessionMessages, { role: "assistant", content }]
        : undefined,
    };
    setMessages((currentMessages) => {
      const nextMessages = [...currentMessages, statusMessage];
      saveActiveChat(nextMessages);
      return nextMessages;
    });
  }

  function latestApplyableAgentPatch(messagesToSearch = agentSessionMessages) {
    if (agentResponseHasApplyablePatch(lastVerifiedAgentPatch)) return lastVerifiedAgentPatch;

    const latestPatch = [...messagesToSearch]
      .reverse()
      .map((message) => message.agentPatchData)
      .find(isAgentApiResponse);

    return agentResponseHasApplyablePatch(latestPatch) ? latestPatch : null;
  }

  function closeAgentSessionAndSave() {
    setAgentSessionInitialDraft("");

    if (!agentSessionMessages.some((message) => message.role === "assistant")) {
      setAgentSessionOpen(false);
      return;
    }

    const firstUser = agentSessionMessages.find((message) => message.role === "user")?.content || "PayFix investigation";
    const lastAssistant = [...agentSessionMessages].reverse().find((message) => message.role === "assistant")?.content || "";
    const appliedFiles = appliedPatchNotice?.files || [];
    const appliedSummary = appliedPatchNotice
      ? `Agent result saved. Patch already applied at ${appliedPatchNotice.appliedAt}.

${appliedFiles.length ? `File${appliedFiles.length === 1 ? "" : "s"}: ${appliedFiles.map((file) => basename(file)).join(", ")}` : "Files: already applied"}
Checks: ${appliedPatchNotice.validationLabel}
Undo: available from the applied patch message.`
      : "";
    const agentSummary: ChatMessage = {
      role: "assistant",
      isAgentSessionSummary: true,
      patchAlreadyApplied: Boolean(appliedPatchNotice),
      agentSessionMessages,
      agentPatchData: !appliedPatchNotice ? latestApplyableAgentPatch() || undefined : undefined,
      content: appliedSummary
        ? appliedSummary
        : `PAYFIX INVESTIGATION SAVED

Investigation question:
${firstUser.slice(0, 700)}

Latest investigation result:
${lastAssistant.slice(0, 1400)}

Full investigation trail saved:
${agentSessionMessages.length} message(s). Reopen Investigation restores the full agent workspace, not only this summary.

Reopen this saved investigation to continue the project review, upload more evidence, or apply/revise the fix.`,
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
    setShowApplyModal(false);
    setAppliedPatchNotice(null);
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
      safeSetJsonStorage("payfix_saved_chats", chats, chats.map(trimSavedChatForStorage));
    }, 0);
  }

  function saveActiveChat(nextMessages: ChatMessage[]) {
    if (!nextMessages.length) {
      saveChats(savedChats.filter((chatItem) => chatItem.id !== activeChatId));
      return;
    }

    const existingChat = savedChats.find((chatItem) => chatItem.id === activeChatId);
    const now = new Date().toISOString();
    const chat: SavedChat = {
      id: activeChatId,
      title: titleFromChatMessages(nextMessages),
      createdAt: existingChat?.createdAt || now,
      lastActivityAt: now,
      messages: nextMessages,
      projectPath,
      connectedProjectPath,
      projectContext,
      computerSearchResults,
      computerSearchPreview,
      searchFolder,
      searchFileName,
      searchText,
      lastConnectedAt: connectedProjectPath ? new Date().toISOString() : undefined,
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
    setSelectedQuickReplies([]);
    setLog("");
    setCode("");
    setProjectContext("");
    setProjectMatches([]);
    setLoadedProjectFiles([]);
    setComputerSearchResults("");
    setComputerSearchPreview("");
    setUploadedFiles([]);
    setSearchFolder("");
    setSearchFileName("");
    setSearchText("");
    setProjectPath("");
    setConnectedProjectPath("");
    localStorage.removeItem("payfix_last_connected_project");
    resetColorTool();
    resetRunner();
    resetApplyModal();
    setAppliedPatchKeys([]);
    setAppliedPatchNotice(null);
    setLastVerifiedAgentPatch(null);
    setDependencyProposal(null);
    setAgentStatus("New chat started. Project disconnected.");
  }

  function openSavedChat(chat: SavedChat) {
    if (chat.id === activeChatId) {
      return;
    }

    setActiveChatId(chat.id);
    setSelectedQuickReplies([]);
    startTransition(() => {
      setMessages(chat.messages);
    });
    setProjectPath(chat.projectPath || chat.connectedProjectPath || "");
    setConnectedProjectPath(chat.connectedProjectPath || "");
    setProjectContext(chat.projectContext || "");
    setComputerSearchResults(chat.computerSearchResults || "");
    setComputerSearchPreview(chat.computerSearchPreview || "");
    setSearchFolder(chat.searchFolder || "");
    setSearchFileName(chat.searchFileName || "");
    setSearchText(chat.searchText || "");
    setLoadedProjectFiles([]);
    setProjectMatches([]);

    if (chat.connectedProjectPath) {
      void fetch("/api/local-agent/set-root", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: chat.connectedProjectPath }),
      }).catch(() => undefined);
    }

    setAgentStatus(chat.connectedProjectPath ? `Opened: ${chat.title} with project connected.` : `Opened: ${chat.title}`);
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
    setSelectedQuickReplies([]);
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
    const draft: DraftState = {
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
    };
    safeSetJsonStorage("payfix_active_draft", draft, trimDraftForStorage(draft));
  }

  function cancelEditMessage() {
    if (!editSnapshot) return;

    setMessages(editSnapshot.messages);
    setQuestion(editSnapshot.question);
    setSelectedQuickReplies([]);
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
      setSelectedQuickReplies([]);
      clearAttachments();
      setAgentStatus("Deleted current chat.");
    }

    setChatToDelete(null);
  }

  async function connectProjectPath(path: string) {
    const trimmedProjectPath = path.trim();

    if (!trimmedProjectPath) {
      setAgentStatus("Enter a project path before connecting.");
      return false;
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
      return true;
    } catch (err: unknown) {
      setConnectedProjectPath("");
      setProjectContext("");
      setProjectMatches([]);
      setLoadedProjectFiles([]);
      setAgentStatus(`Failed: ${errorMessage(err)}`);
      return false;
    }
  }

  async function connectProject() {
    await connectProjectPath(projectPath);
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

  function normalizedProjectCommand(text: string) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\\/:._-]+/g, " ")
      .replace(/\b(delte|dlete|deltee|dleete|deltet|deltete|delet|deleet|deleete|dellete)\b/g, "delete")
      .replace(/\b(foler|foldr|fodler|foleder|flder)\b/g, "folder")
      .replace(/\b(sub folders|sub-folders)\b/g, "subfolders")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sdkPathsFromAgentPrompt(text: string) {
    const block =
      text.match(/Vendor SDK \/ local artifacts folders:\s*\n([\s\S]*?)(?:\n\n|$)/i)?.[1] ||
      text.match(/Vendor SDK \/ local artifacts folder:\s*([^\r\n]+)/i)?.[1] ||
      text.match(/SDK folders?:\s*\n([\s\S]*?)(?:\n\n|$)/i)?.[1] ||
      text.match(/SDK folder:\s*([^\r\n]+)/i)?.[1] ||
      "";

    return Array.from(
      new Set(
        block
          .split(/\r?\n|[;|]/)
          .map((line) => line.replace(/^[-*]\s*/, "").trim())
          .filter(Boolean),
      ),
    ).slice(0, 6);
  }

  function formatSdkInspection(data: SdkInspectionResponse, index = 1) {
    if (!data.ok) return "";

    const important = (data.importantFiles || [])
      .slice(0, 60)
      .map((file) => `- ${file.relative} (${file.role}, ${file.mime}, ${file.size} bytes)`)
      .join("\n");
    const readable = (data.readableFiles || [])
      .filter((file) => file.content?.trim())
      .slice(0, 16)
      .map(
        (file) => `FILE: ${file.relative}
ROLE: ${file.role}
MIME: ${file.mime}
SIZE: ${file.size} bytes
CONTENT:
${(file.content || "").slice(0, 12000)}`,
      )
      .join("\n\n---\n\n");

    return `VENDOR SDK / LOCAL ARTIFACTS INSPECTION ${index}
Root: ${data.root || "unknown"}
Total files found: ${data.totalFiles || 0}

Important SDK files/artifacts:
${important || "No important SDK artifacts detected."}

Readable SDK docs/source/config:
${readable || "No readable SDK docs/source/config were extracted."}`;
  }

  async function inspectSdkFolderForAgent(prompt: string) {
    const sdkPaths = sdkPathsFromAgentPrompt(prompt);
    if (!sdkPaths.length) return "";

    setAgentStatus(`Inspecting ${sdkPaths.length} extracted SDK/artifacts folder(s)...`);
    const inspections: string[] = [];

    for (const [index, sdkPath] of sdkPaths.entries()) {
      try {
        const response = await fetch("/api/local-agent/sdk/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root: sdkPath }),
        });
        const data = (await response.json()) as SdkInspectionResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Could not inspect SDK folder.");
        }
        inspections.push(formatSdkInspection(data, index + 1));
      } catch (error: unknown) {
        inspections.push(`VENDOR SDK / LOCAL ARTIFACTS INSPECTION ${index + 1}
Path: ${sdkPath}
Status: Could not inspect this SDK folder.
Error: ${errorMessage(error)}

If this is a zip, extract it first and paste the extracted folder path.`);
      }
    }

    return inspections.filter(Boolean).join("\n\n====================\n\n");
  }

  function fuzzyProjectCommandToken(text: string, type: "delete" | "folder") {
    const tokens = normalizedProjectCommand(text).split(" ").filter(Boolean);

    return tokens.some((token) => {
      if (type === "delete") {
        return (
          /^(delete|remove|erase|purge|cleanup)$/.test(token) ||
          (token.length >= 4 && token.length <= 10 && /^d/.test(token) && token.includes("l") && token.includes("t"))
        );
      }

      return (
        /^(folder|folders|subfolder|subfolders|directory|directories|dir|tree|project)$/.test(token) ||
        (token.length >= 4 && token.length <= 12 && /^fo/.test(token) && token.includes("l") && token.includes("r"))
      );
    });
  }

  function isProjectFolderDeleteRequest(text: string) {
    if (hasBuildErrorEvidence(text)) return false;
    const normalized = normalizedProjectCommand(text);
    const hasDeleteIntent =
      /\b(delete|remove|erase|purge|trash)\b/.test(normalized) ||
      /\b(clean up|cleanup)\b[\s\S]{0,80}\b(folder|directory|project|from disk)\b/.test(normalized);
    const hasFolderIntent =
      /\b(this|that|current|connected|generated|created|empty)?\s*(folder|folders|subfolder|subfolders|directory|directories|dir|tree|project)\b/.test(
        normalized,
      ) ||
      /\bfrom disk\b/.test(normalized);

    return hasDeleteIntent && hasFolderIntent;
  }

  function isProjectDisconnectRequest(text: string) {
    if (hasBuildErrorEvidence(text)) return false;
    const normalized = normalizedProjectCommand(text);
    return /\b(disconnect|detach|unattach|clear)\b.*\b(project|folder|payfix)\b/.test(normalized);
  }

  function shouldDeleteProjectFolderNow(text: string) {
    const normalized = normalizedProjectCommand(text);
    return isProjectFolderDeleteRequest(text) && !/\b(preview|review|prepare|show me|explain)\b/.test(normalized);
  }

  function shouldForceDeleteProjectFolder(text: string) {
    const normalized = normalizedProjectCommand(text);
    return isProjectFolderDeleteRequest(text) && /\b(force|bypass|busy|locked|try anyway|even if windows)\b/.test(normalized);
  }

  async function handleEmptyProjectFolderDeleteRequest(prompt: string) {
    if (isProjectDisconnectRequest(prompt)) {
      setConnectedProjectPath("");
      setProjectPath("");
      setProjectContext("");
      setComputerSearchResults("");
      setComputerSearchPreview("");
      setLoadedProjectFiles([]);
      setProjectMatches([]);
      setProjectMemory(null);
      setProjectMap(null);
      return `PROJECT DISCONNECTED\n\nPayFix cleared the connected project. No files were deleted.`;
    }

    const apply = shouldDeleteProjectFolderNow(prompt);
    const force = shouldForceDeleteProjectFolder(prompt);
    const response = await fetch("/api/local-agent/project/delete-root", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply, force }),
    });
    const data = (await response.json()) as {
      ok?: boolean;
      error?: string;
      root?: string;
      applied?: boolean;
      message?: string;
      code?: string;
      detail?: string;
      canForce?: boolean;
      fileCount?: number;
      directoryCount?: number;
      remaining?: string[];
    };
    if (!data.ok) {
      if (data.code === "busy" || /EBUSY|busy|locked|resource/i.test(`${data.error || ""}\n${data.detail || ""}`)) {
        return `PROJECT FOLDER BUSY

The operating system says the connected project folder is busy or locked, so PayFix did not delete it.

Folder:
${data.root || connectedProjectPath}
${data.detail ? `\nDetails:\n${data.detail}\n` : ""}
Next:
- Use Retry delete folder after closing Explorer, VS Code tabs, terminals, or running servers that are inside this folder.
- Use Force disk delete if you want PayFix to retry deleting the actual folder from disk.
- Use Disconnect only if you only want to detach this project from PayFix without deleting it from VS Code or disk.`;
      }

      if (data.code === "not_empty" || /not empty|still contains files/i.test(data.error || "")) {
        const remainingExamples = (data.remaining || []).slice(0, 6).map((file) => `- ${file}`).join("\n");
        return `PROJECT FOLDER NOT EMPTY

PayFix cannot delete the folder yet because it still contains ${data.fileCount || "some"} file(s) and ${data.directoryCount || 0} folder(s).
${remainingExamples ? `\nFiles still inside:\n${remainingExamples}\n` : ""}

Next:
- Use Delete files from disk to create a reviewable delete preview for the files still inside.
- After those files are deleted, use Delete folder from disk.
- Use Disconnect only if you only want to detach this project from PayFix without deleting it from VS Code or disk.`;
      }

      throw new Error(data.error || "Could not inspect the connected project folder.");
    }

    if (data.applied) {
      setConnectedProjectPath("");
      setProjectPath("");
      setProjectContext("");
      setComputerSearchResults("");
      setComputerSearchPreview("");
      setLoadedProjectFiles([]);
      setProjectMatches([]);
      setProjectMemory(null);
      setProjectMap(null);
    }

    return data.applied
      ? `PROJECT FOLDER DELETED\n\nDeleted the empty connected folder tree:\n${data.root}\n\nProject connection was cleared.`
      : `EMPTY PROJECT FOLDER\n\nThe connected project has no files left${data.directoryCount ? `, only ${data.directoryCount} empty folder(s)` : ""}. PayFix can delete the actual folder tree from disk.\n\nFolder:\n${data.root}\n\nNext:\n- Use Delete folder from disk if you want PayFix to remove it from VS Code/disk now.
- Use Disconnect only if you only want PayFix to stop tracking it.`;
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
      const content = await readBrowserFile(file, isImage);
      const dimensions = isImage ? await imageDimensionsFromDataUrl(content) : null;
      loaded.push({
        name: file.name,
        type: file.type || "unknown",
        size: file.size,
        content,
        isImage,
        width: dimensions?.width,
        height: dimensions?.height,
      });
    }

    setUploadedFiles((prev) => dedupeUploadedFiles([...prev, ...loaded]));
    setAgentStatus(
      `${loaded.length} file(s) uploaded and attached for AI${
        loaded.some((file) => file.isImage) ? " with original-detail image analysis enabled" : ""
      }.`,
    );
  }

  async function importBrowserCapture() {
    try {
      const response = await fetch("/api/browser-capture", { cache: "no-store" });
      const data = (await response.json()) as { ok?: boolean; captures?: BrowserCapture[]; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not read browser captures.");
      }

      const capture = data.captures?.[0];
      if (!capture) {
        setAgentStatus(
          "No shared page found yet. Open the logged-in page, click the PayFix Page Capture extension, then click Import shared page.",
        );
        return;
      }

      if (capture.id === lastImportedBrowserCaptureId) {
        setAgentStatus("That browser page capture is already attached.");
        return;
      }

      const host = (() => {
        try {
          return new URL(capture.url).hostname.replace(/[^a-z0-9.-]+/gi, "-");
        } catch {
          return "page";
        }
      })();
      const links = (capture.links || [])
        .slice(0, 250)
        .map((link, index) => `${index + 1}. ${link.text || "(no text)"}\n   ${link.href}`)
        .join("\n");
      const content = [
        "PAYFIX LOGGED-IN BROWSER PAGE CAPTURE",
        `Captured at: ${capture.capturedAt}`,
        `Title: ${capture.title || "(untitled)"}`,
        `URL: ${capture.url}`,
        capture.meta?.selectionText ? `Selected text:\n${capture.meta.selectionText}` : "",
        "Visible page text:",
        capture.text || "(No visible text captured.)",
        links ? `\nVisible links:\n${links}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const attachedCapture: UploadedFile = {
        name: `browser-capture-${host}.txt`,
        type: "text/plain",
        size: content.length,
        content,
        isImage: false,
      };

      setUploadedFiles((prev) => dedupeUploadedFiles([attachedCapture, ...prev]));
      setLastImportedBrowserCaptureId(capture.id);
      setAgentStatus(`Attached logged-in browser page: ${capture.title || capture.url}`);
    } catch (error: unknown) {
      setAgentStatus(error instanceof Error ? error.message : "Could not import browser capture.");
    }
  }

  async function handleAgentSessionUpload(files: FileList | null) {
    if (!files) return;

    const loaded: UploadedFile[] = [];
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith("image/");
      const content = await readBrowserFile(file, isImage);
      const dimensions = isImage ? await imageDimensionsFromDataUrl(content) : null;
      loaded.push({
        name: file.name,
        type: file.type || "unknown",
        size: file.size,
        content,
        isImage,
        width: dimensions?.width,
        height: dimensions?.height,
      });
    }

    setAgentSessionUploads((prev) => dedupeUploadedFiles([...prev, ...loaded]));
    setAgentSessionFreshUploads((prev) => dedupeUploadedFiles([...prev, ...loaded]));
    setAgentStatus(`${loaded.length} file(s) added to Agent workspace.`);
  }

  function removeAgentSessionUpload(index: number) {
    const removedFromFresh = agentSessionFreshUploads[index];
    setAgentSessionUploads((prev) => {
      const removed = removedFromFresh || prev[index];
      if (removed) {
        setAgentSessionFreshUploads((fresh) =>
          fresh.filter(
            (file) =>
              !(
                file.name === removed.name &&
                file.type === removed.type &&
                file.size === removed.size &&
                file.content.slice(0, 120) === removed.content.slice(0, 120)
              ),
          ),
        );
      }
      if (!removedFromFresh) return prev.filter((_, itemIndex) => itemIndex !== index);
      return prev.filter(
        (file) =>
          !(
            file.name === removedFromFresh.name &&
            file.type === removedFromFresh.type &&
            file.size === removedFromFresh.size &&
            file.content.slice(0, 120) === removedFromFresh.content.slice(0, 120)
          ),
      );
    });
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

      setAgentStatus(applyStatusForFiles([applyFilePath]));
      const data = await requestFileChange(true);
      if (!data.ok) {
        setAgentStatus(data.error || "Failed applying changes.");
        return;
      }

      if (data.rollback?.id) {
        rememberRollbackSnapshot(data.rollback as RollbackSnapshot);
      }
      const appliedKey = currentApplyPreviewKey();
      const changedLineSummary = summarizePreviewChanges([
        {
          file: applyFilePath,
          oldContent: diffOldContent,
          newContent: diffNewContent,
        },
      ]);
      markPatchApplied([applyFilePath], appliedKey);
      setShowApplyModal(false);
      if (applyMode === "delete") {
        setAgentStatus(`Deleted ${basename(applyFilePath)}. Running project checks...`);
        const sandboxSummary = await runPostApplySandboxChecks();
        appendAssistantStatusMessage(
          `FILE DELETED\n\nDeleted ${applyFilePath}.\n\nUNDO\nA rollback snapshot was saved, so Undo can restore this file.\n\nSANDBOX CHECKS\n\n${sandboxSummary}`,
        );
      } else {
        setAgentStatus(`Patch applied to ${basename(applyFilePath)}. Running ${validationLabelForFile(applyFilePath)} checks...`);
        appendAssistantStatusMessage(
          `PATCH APPLIED\n\nUpdated ${applyFilePath}.\n\nCHANGED LINES\n${changedLineSummary}\n\nVALIDATION NOW RUNNING\n${validationLabelForFile(
            applyFilePath,
          )} checks plus project diagnostics where available.`,
        );
        await validateAppliedFileChange();
      }
    } catch (err: unknown) {
      setAgentStatus(errorMessage(err, "Apply failed."));
    }
  }

  function summarizeFailedCommandOutput(output: string) {
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const important = lines.filter((line) =>
      /error|failed|cannot|missing|not found|syntax|type|TS\d+|ESLint|Build failed|Module not found|Traceback|Exception/i.test(line),
    );

    return (important.length ? important : lines).slice(0, 10).join("\n  ");
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
        body: JSON.stringify({ checks: ["check", "typescript", "lint", "test", "build"] }),
      });
      const sandboxData = (await sandboxRes.json()) as SandboxRunnerResult;
      setSandboxRunnerResult(sandboxData);

      if (sandboxData.ok) {
        return "Sandbox checks passed or were safely skipped.";
      }

      const commandSummary =
        sandboxData.commands
          ?.map((command) => {
            const output = command.ok ? "" : summarizeFailedCommandOutput(command.output || "");
            const outputBlock = output ? `\n  ${output}` : "";
            return `${command.ok ? "PASS" : "FAIL"} ${command.command}${outputBlock}`;
          })
          .join("\n") || sandboxData.error || "see Project IQ.";
      const failedCommands = sandboxData.commands?.filter((command) => !command.ok).map((command) => command.command).join(", ");
      if (isGradleSslTrustBlocker(commandSummary)) {
        return `VALIDATION ATTEMPTED

Commands PayFix tried:
${sandboxData.commands?.map((command) => `- ${command.ok ? "PASS" : "FAIL"} ${command.command}`).join("\n") || "- Project diagnostics"}

Result:
Gradle is still blocked before app code can compile because the Java runtime used by Gradle does not trust the HTTPS certificate chain for Maven/Google dependency downloads.

Evidence:
${compactValidationEvidence(commandSummary)}

What this means:
- PayFix did try to run the build/test diagnostics.
- This is an environment/JDK truststore/proxy problem, not a source-code bug in the Android app.
- PayFix cannot safely patch Java source files to fix this.

Next action:
- Import the corporate/root certificate into the exact JBR/JDK Gradle uses, or use a local/offline Maven artifact fallback if you cannot change certificates yet.`;
      }
      return `Sandbox checks found failures${failedCommands ? ` in ${failedCommands}` : ""}:\n${commandSummary}\n\nNEXT ACTION\nUse Fix validation failure so PayFix can inspect exact files, patch the issue, and rerun validation.`;
    } catch (err: unknown) {
      return `Sandbox checks could not run: ${errorMessage(err)}`;
    }
  }

  function isGradleSslTrustBlocker(text: string) {
    return /\b(PKIX path building failed|certificate_unknown|SSL handshake|Could not GET|Could not HEAD|repo\.maven\.apache\.org|repo\.maven|maven\.google|dl\.google\.com)\b/i.test(text);
  }

  function isMavenLocalFallbackRequest(text: string) {
    const trimmed = text.trim();
    if (asksToExplainQuotedChoices(trimmed)) return false;

    return (
      /^\s*(?:prepare|run|start|do|use|apply|go ahead|continue)\b[\s\S]{0,120}\b(mavenLocal\(\)|maven local|local[-\s]?artifact|local artifacts?|offline fallback|offline Maven|local Maven|file-based repo|file based repo|dependency download blocker)\b/i.test(
        trimmed,
      ) ||
      (/^\s*(?:option\s*)?C\b/i.test(trimmed) && /\b(maven|offline|artifact|local)\b/i.test(trimmed)) ||
      /\b(prepare|run|start|do|use|apply|go ahead|continue)\b[\s\S]{0,80}\b(mavenLocal\(\)|maven local|offline fallback|local Maven)\b/i.test(
        trimmed,
      )
    );
  }

  async function gradleTrustCheckMessage() {
    if (!connectedProjectPath) {
      return `TRUST CHECK NOT RUN

I understood this as a request to run the Gradle/JDK certificate trust check.

PayFix cannot run it yet because no project folder is connected in this Agent workspace.

Next:
A. Connect the project folder, then run the trust check again.
B. If the project is connected but this still appears, restart payfix-agent and reopen the investigation.`;
    }

    await ensureLocalAgentRoot(connectedProjectPath);
    const sandboxSummary = await runPostApplySandboxChecks();
    const stillBlocked = isGradleSslTrustBlocker(sandboxSummary);

    return `TRUST CHECK RUN

I treated your request as: run the connected-project checks for the Gradle/JDK certificate blocker.
I did not compare logs and I did not replay app setup steps.

Project:
${connectedProjectPath}

What PayFix ran:
${compactValidationEvidence(sandboxSummary)}

Result:
${stillBlocked
  ? "The blocker is still present. Gradle is still failing before Android code compiles because the Java runtime used by Gradle does not trust the certificate chain returned while downloading Maven/Google dependencies."
  : "The previous Gradle/JDK certificate blocker did not appear in this validation output. If another error appeared, that is now the next blocker to fix."}

What this means:
${stillBlocked
  ? "If the URLs are already whitelisted, whitelisting was not enough. The next useful check is the exact JBR/JDK truststore Gradle is using, or a local/offline Maven fallback if the certificate cannot be fixed quickly."
  : "Move to the next visible build/sync error and ask PayFix to fix that specific blocker."}

Do next:
A. Prepare cert fix: attach the corporate/root CA file or give its path, then PayFix can produce the exact keytool command for the JBR/JDK Gradle uses.
B. Prepare offline fallback: attach/select the folder containing the required .pom/.jar/.aar files so PayFix can inspect and patch safely.
C. Re-run validation after either fix so the next real project error can surface.`;
  }

  function projectFilesFromFileList(fileList: string) {
    return fileList
      .split(/\r?\n/)
      .map((line) => line.match(/^FILE:\s*(.+)$/i)?.[1]?.trim() || "")
      .filter(Boolean);
  }

  type MavenCoordinate = {
    group: string;
    artifact: string;
    version: string;
  };

  function parseMissingMavenCoordinates(text: string) {
    const coordinates: MavenCoordinate[] = [];
    const seen = new Set<string>();
    for (const match of text.matchAll(/\bCould not resolve\s+([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.+-]+)/g)) {
      const coordinate = { group: match[1], artifact: match[2], version: match[3] };
      const key = `${coordinate.group}:${coordinate.artifact}:${coordinate.version}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        coordinates.push(coordinate);
      }
    }
    return coordinates.slice(0, 12);
  }

  function expectedMavenArtifactNames(coordinate: MavenCoordinate) {
    const base = `${coordinate.artifact}-${coordinate.version}`;
    return [`${base}.pom`, `${base}.jar`, `${base}.aar`];
  }

  function expectedMavenRepositoryPath(coordinate: MavenCoordinate, extension: "pom" | "jar" | "aar") {
    const groupPath = coordinate.group.replace(/\./g, "/");
    return `${groupPath}/${coordinate.artifact}/${coordinate.version}/${coordinate.artifact}-${coordinate.version}.${extension}`;
  }

  function matchingLocalArtifacts(coordinate: MavenCoordinate, files: string[]) {
    const expectedNames = expectedMavenArtifactNames(coordinate).map((name) => name.toLowerCase());
    const expectedPathParts = ["pom", "jar", "aar"].map((extension) =>
      expectedMavenRepositoryPath(coordinate, extension as "pom" | "jar" | "aar").replace(/\//g, "\\").toLowerCase(),
    );

    return files.filter((file) => {
      const normalized = file.replace(/\//g, "\\").toLowerCase();
      const name = normalized.split("\\").pop() || normalized;
      return expectedNames.includes(name) || expectedPathParts.some((part) => normalized.endsWith(part));
    });
  }

  async function readProjectTextFile(file: string) {
    const res = await fetch("/api/local-agent/project/read-file-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file }),
    });
    const data = await res.json();
    if (!data.ok || data.file?.kind !== "text") return "";
    return String(data.file.content || "");
  }

  async function mavenLocalFallbackMessage(prompt: string, recentAssistantContext = "") {
    if (!connectedProjectPath) {
      return `MAVEN LOCAL FALLBACK CHECK

I understood this as a request to prepare an offline/local Maven dependency workaround.

I cannot inspect or patch it yet because no project folder is connected in this Agent workspace.

Next:
A. Connect the project folder, then run Prepare offline fallback again.
B. Attach/select the folder that contains the downloaded .pom/.jar/.aar files.
C. Use the cert/truststore fix instead if you have the corporate root certificate.`;
    }

    await ensureLocalAgentRoot(connectedProjectPath);
    const [fileList, sandboxSummary] = await Promise.all([loadFileList(), runPostApplySandboxChecks()]);
    const projectFiles = projectFilesFromFileList(fileList);
    const buildFiles = projectFiles.filter((file) => /(^|[\\/])(settings\.gradle(?:\.kts)?|build\.gradle(?:\.kts)?|gradle\.properties)$/i.test(file));
    const localArtifacts = projectFiles.filter((file) => /\.(?:pom|jar|aar)$/i.test(file));
    const coordinates = parseMissingMavenCoordinates([prompt, recentAssistantContext, sandboxSummary].join("\n\n"));
    const settingsFile = buildFiles.find((file) => /(^|[\\/])settings\.gradle(?:\.kts)?$/i.test(file));
    const rootBuildFile = buildFiles.find((file) => /(^|[\\/])build\.gradle(?:\.kts)?$/i.test(file) && !/[\\/]app[\\/]/i.test(file));
    const appBuildFile = buildFiles.find((file) => /(^|[\\/]app[\\/])build\.gradle(?:\.kts)?$/i.test(file));
    const buildSnippets = (
      await Promise.all(
        [settingsFile, rootBuildFile, appBuildFile]
          .filter(Boolean)
          .map(async (file) => ({ file: file || "", content: await readProjectTextFile(file || "") })),
      )
    ).filter((item) => item.file);
    const alreadyUsesMavenLocal = buildSnippets.some((item) => /\bmavenLocal\s*\(/.test(item.content));
    const coordinateLines = coordinates.length
      ? coordinates
          .map((coordinate) => {
            const matches = matchingLocalArtifacts(coordinate, localArtifacts);
            const found = matches.length ? `found: ${matches.slice(0, 3).join(", ")}` : "not found locally";
            return `- ${coordinate.group}:${coordinate.artifact}:${coordinate.version} (${found})
  Need: ${expectedMavenRepositoryPath(coordinate, "pom")}
  Need one binary: ${expectedMavenRepositoryPath(coordinate, "jar")} or ${expectedMavenRepositoryPath(coordinate, "aar")}`;
          })
          .join("\n")
      : "- I could not parse exact missing Maven coordinates from the current validation output. Attach/paste the latest full Gradle dependency-resolution error so PayFix can list exact files.";
    const allCoordinatesSatisfied =
      coordinates.length > 0 &&
      coordinates.every((coordinate) => {
        const matches = matchingLocalArtifacts(coordinate, localArtifacts);
        const hasPom = matches.some((file) => /\.pom$/i.test(file));
        const hasBinary = matches.some((file) => /\.(?:jar|aar)$/i.test(file));
        return hasPom && hasBinary;
      });
    const canPatchNow = allCoordinatesSatisfied || alreadyUsesMavenLocal;

    return `MAVEN LOCAL FALLBACK CHECK

I checked this as a dependency-download workaround, not as an Android source-code bug.

What I checked:
- Connected project: ${connectedProjectPath}
- Validation/build status: ${isGradleSslTrustBlocker(sandboxSummary) ? "still blocked by Gradle/JDK SSL trust while downloading dependencies" : "validation ran; see result below"}
- Build config files seen: ${buildFiles.slice(0, 5).join(", ") || "none found"}
- Local artifact files seen in the project: ${localArtifacts.length ? `${localArtifacts.length} .pom/.jar/.aar file(s)` : "none"}
- mavenLocal() already present: ${alreadyUsesMavenLocal ? "yes" : "no"}

Can PayFix patch the fallback now?
${canPatchNow ? "Maybe. PayFix found enough signal to add/prefer a local repository path, but validation may still need a real local Maven layout." : "Not safely yet. A Maven/local fallback only works if the missing Maven coordinates exist locally with matching .pom plus .jar/.aar files."}

Missing or required artifacts from the current blocker:
${coordinateLines}

What to do next:
A. Attach/select the folder that contains these Maven artifacts, then run Prepare offline fallback again.
B. If the files are already somewhere on disk, add that folder in the Agent setup as a Vendor SDK / local artifacts folder.
C. Use the certificate fix instead if you can get the corporate/root CA, because that fixes dependency downloads without manually mirroring artifacts.

Validation snapshot:
${compactValidationEvidence(sandboxSummary)}`;
  }

  function compactValidationEvidence(text: string) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /\b(FAIL|PKIX|certificate_unknown|SSL handshake|Could not resolve|Could not GET|Could not HEAD|repo\.maven|maven\.google|dl\.google|JAVA_HOME|gradlew\.bat|gradle)\b/i.test(line))
      .slice(0, 10)
      .map((line) => `- ${line.replace(/^[-*]\s+/, "")}`)
      .join("\n") || "- Gradle dependency resolution failed with a Java SSL trust error.";
  }

  function shouldReturnEnvironmentBlockerInsteadOfPatch(prompt: string, sandboxSummary: string) {
    if (!isGradleSslTrustBlocker(sandboxSummary)) return false;
    if (/\b(mavenLocal|maven local|local fallback|local artifacts?|copy local|offline fallback|patch repository|maven \{ url|file-based repository)\b/i.test(prompt)) {
      return false;
    }

    return /\b(fix|investigate|build|validation|validate|why|error|errors|failed|failing|failure|gradle|sync)\b/i.test(prompt);
  }

  function completedStepContextForEnvironmentBlocker(prompt: string) {
    const normalized = prompt.toLowerCase();
    const completedSignals: string[] = [];

    if (
      /\b(?:already|did|done|confirmed|tried|set up|setup)\b[\s\S]{0,160}\b(?:whitelist(?:ed|ing)?|allowlist(?:ed|ing)?|allowed|unblocked)\b/i.test(prompt) ||
      /\b(?:whitelist(?:ed|ing)?|allowlist(?:ed|ing)?|allowed|unblocked)\b[\s\S]{0,160}\b(?:already|done|confirmed|tried)\b/i.test(prompt)
    ) {
      completedSignals.push(
        "You already whitelisted the repository URLs, so PayFix should stop treating this as a URL allowlist problem. The remaining blocker is likely Java/JBR certificate trust, a proxy certificate chain, Gradle using a different JDK than the one you fixed, or missing local Maven artifacts.",
      );
    }

    if (/\b(?:already|did|done|confirmed|tried|imported|added)\b[\s\S]{0,140}\b(?:cert|certificate|root ca|truststore|cacerts)\b/i.test(prompt)) {
      completedSignals.push(
        "You said the certificate/trust step was already attempted. The next useful check is whether the cert landed in the exact JDK/JBR Gradle is using, whether the alias exists, and whether intermediate/proxy certs are still missing.",
      );
    }

    if (/\b(?:already|did|done|confirmed|tried|selected|pointed|set)\b[\s\S]{0,140}\b(?:jdk|jbr|java_home|java home|gradle jvm)\b/i.test(prompt)) {
      completedSignals.push(
        "You said the JDK/JBR path was already selected or found. The next useful check is to run validation with that runtime and confirm the failure still names the same PKIX/certificate chain.",
      );
    }

    if (/\b(?:already|did|done|confirmed|tried|attached|selected|added)\b[\s\S]{0,140}\b(?:sdk|artifact|jar|aar|pom|mavenlocal|maven local|offline)\b/i.test(prompt)) {
      completedSignals.push(
        "You said local SDK/artifact files are already present. The next useful check is whether the exact missing Maven coordinates have matching .pom/.jar/.aar files and whether the build files point to them.",
      );
    }

    if (!completedSignals.length && /\b(?:already|did|done|confirmed|tried)\b/i.test(normalized)) {
      completedSignals.push(
        "Your latest message says a previous step was already attempted. PayFix should treat that as current evidence and move to the next remaining blocker instead of repeating the same step.",
      );
    }

    return completedSignals.length
      ? `\nWhat your latest note changes:\n${completedSignals.map((item) => `- ${item}`).join("\n")}\n`
      : "";
  }

  function extractCommandFromPrompt(text: string) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const commandLine = lines.find((line) =>
      /^(?:\.\\gradlew(?:\.bat)?|\.\/gradlew|gradlew(?:\.bat)?|npm|pnpm|yarn|mvn|dotnet|cargo|pytest|python(?:\.exe)?|go|composer|bundle)\b/i.test(
        line,
      ),
    );
    return commandLine || lines.find((line) => /\b(?:gradlew(?:\.bat)?|npm|pnpm|yarn|mvn|dotnet|cargo|pytest|python(?:\.exe)?|go test)\b/i.test(line)) || "";
  }

  function commandLocationHelpMessage(prompt: string) {
    const command = extractCommandFromPrompt(prompt);
    const projectRoot = connectedProjectPath || "the project root folder";
    const commandName = command.match(/^(?:\.\\|\.\/)?([^\s]+)/)?.[1]?.toLowerCase() || "";
    const isWrapperCommand = /gradlew(?:\.bat)?/i.test(commandName);
    const rootHint = isWrapperCommand
      ? "the folder that contains `gradlew.bat` / `gradlew`"
      : "the root folder of the project that owns this command";

    return `COMMAND LOCATION

Run it from:
${connectedProjectPath ? `\`${projectRoot}\`` : rootHint}

Command:
\`${command || "the command you pasted"}\`

Exact steps:
1. Open a terminal.
2. Change into ${connectedProjectPath ? "the connected project folder" : rootHint}:
   \`cd "${projectRoot}"\`
3. Run:
   \`${command || "paste the command here"}\`

Why:
${isWrapperCommand
  ? "`gradlew.bat` is a project-local Gradle wrapper, so Windows only finds it when your terminal is inside the project folder that contains that file."
  : "Most project commands expect to run from the folder that contains the build/config files, so relative paths and local tool wrappers resolve correctly."}

If it fails:
Paste the first red error block from that terminal.`;
  }

  function gradleEnvironmentBlockerMessage(prompt: string, sandboxSummary: string) {
    return `ENVIRONMENT BLOCKER: GRADLE CERTIFICATE TRUST

Request:
${prompt}

${completedStepContextForEnvironmentBlocker(prompt)}

What PayFix tried:
${compactValidationEvidence(sandboxSummary)}

What this means:
Gradle is still failing before Android code can compile. If the URLs are already whitelisted, the remaining likely blocker is that the JBR/JDK running Gradle does not trust the certificate chain returned by your network/proxy when Gradle downloads from Maven/Google repositories.

Can PayFix fix this by editing project source files?
No. Not safely. This is not an app-code error. The build is blocked at dependency download time.

Useful next Agent actions:
A. Run a trust check: re-run supported project validation/build checks and show the exact command output.
B. Prepare a certificate fix: use the exact JBR/JDK path and attached corporate/root CA certificate file to produce the right keytool command.
C. Prepare an offline Maven fallback: inspect selected artifact folders for required .pom/.jar/.aar files and patch repository order only if safe.
D. Re-run validation after either environment fix so the next real project error can surface.

What still needs approval/manual input:
- Writing to the JBR truststore under Program Files may need admin permission.
- Importing a certificate requires the actual corporate/root CA file.
- PayFix should not fake these steps; it should either run supported local-agent validation or tell you exactly what permission/file is missing.

Bottom line:
PayFix did try the build. Since dependency download is still failing with PKIX/certificate errors, the next useful move is to verify the exact Gradle JDK truststore or use local/offline dependency supply, then validate again.`;
  }

  async function runAgentSessionValidation() {
    if (!connectedProjectPath) {
      setAgentStatus("Connect a project before running validation.");
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: "Run validation",
    };
    const workingMessage: ChatMessage = {
      role: "assistant",
      content: "Running language-aware project validation checks...",
    };

    setAgentLoading(true);
    setAgentStatus("Running project validation checks...");
    setAgentSessionMessages((current) => [...current, userMessage, workingMessage]);

    try {
      const sandboxSummary = await runPostApplySandboxChecks();
      const resultMessage: ChatMessage = {
        role: "assistant",
        content: `VALIDATION RESULT\n\n${sandboxSummary}`,
      };

      setAgentSessionMessages((current) => [...current.filter((message) => message !== workingMessage), resultMessage]);
      setAgentStatus("Project validation finished.");
    } catch (err: unknown) {
      const message = errorMessage(err, "Validation failed.");
      setAgentSessionMessages((current) => [
        ...current.filter((entry) => entry !== workingMessage),
        { role: "assistant", content: `VALIDATION FAILED\n\n${message}` },
      ]);
      setAgentStatus(`Validation failed: ${message}`);
    } finally {
      setAgentLoading(false);
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
    setAgentStatus(`Previewing ${uniquePatchSet.length} file changes before apply...`);

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

      setAgentStatus(applyStatusForFiles(uniquePatchSet.map((item) => item.resolvedFile)));

      for (const item of uniquePatchSet) {
        const applyResult = await requestFileChangeWithValues({
            apply: true,
            file: item.resolvedFile,
            mode: item.mode,
            search: item.search,
            content: item.replacement,
            reason: applyDescription || `Apply ${basename(item.resolvedFile)} change`,
        });

        if (!applyResult.ok) {
          throw new Error(`${item.resolvedFile}: ${applyResult.error || "Apply failed."}`);
        }
        if (applyResult.rollback?.id) {
          rememberRollbackSnapshot(applyResult.rollback as RollbackSnapshot);
        }
      }

      setDiffOldContent(previews.map((preview) => `FILE: ${preview.file}\n\n${preview.oldContent || ""}`).join("\n\n---\n\n"));
      setDiffNewContent(previews.map((preview) => `FILE: ${preview.file}\n\n${preview.newContent || ""}`).join("\n\n---\n\n"));
      markPatchApplied(
        uniquePatchSet.map((item) => item.resolvedFile),
        JSON.stringify(uniquePatchSet.map((item) => ({
          file: item.resolvedFile,
          mode: item.mode,
          search: item.search,
          content: item.replacement,
        }))),
      );
      setShowApplyModal(false);
      setAgentStatus(`Applied ${uniquePatchSet.length} file changes. Running language checks and project diagnostics...`);
      const rereadResults = await rereadAppliedFiles(uniquePatchSet.map((item) => item.resolvedFile));
      const sandboxSummary = await runPostApplySandboxChecks();
      const changedLineSummary = summarizePreviewChanges(previews);
      appendAssistantStatusMessage(
        `PATCH APPLIED\n\nUpdated ${uniquePatchSet.length} file(s):\n${uniquePatchSet
          .map((item) => `- ${item.resolvedFile}`)
          .join("\n")}\n\nCHANGED LINES\n${changedLineSummary}\n\nRE-READ CHECK\n${rereadResults
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

  async function autoApplyAgentPatch(data: AgentApiResponse, prompt: string) {
    const patch = primaryAgentPatch(data);
    if (!agentResponseHasApplyablePatch(data) || !patch) {
      return false;
    }

    const apiPatchSet = data.result?.patchSet || data.patchSet || [];
    const primaryPatchItem = {
      file: patch.file,
      mode: patch.mode === "delete" ? ("delete" as const) : patch.mode === "replace" ? ("replace" as const) : ("insert" as const),
      search: patch.search,
      content: patch.replacement,
      reason: patch.explanation || `Apply ${basename(patch.file)} change`,
    };
    const patchItems = [
      primaryPatchItem,
      ...apiPatchSet
        .filter((item) => item.mode !== "none")
        .map((item) => ({
          file: item.file,
          mode: item.mode === "delete" ? ("delete" as const) : item.mode === "replace" ? ("replace" as const) : ("insert" as const),
          search: item.search,
          content: item.replacement,
          reason: item.explanation || `Apply ${basename(item.file)} change`,
        })),
    ];

    const safePatchItems = patchItems
      .filter((item) => item.file && (item.mode === "delete" || item.content))
      .filter(
        (item, index, items) =>
          items.findIndex(
            (candidate) =>
              candidate.file === item.file &&
              candidate.mode === item.mode &&
              candidate.search === item.search &&
              candidate.content === item.content,
          ) === index,
      );
    if (!safePatchItems.length) return false;

    setLastRollback(null);
    setShowApplyModal(false);
    setAgentStatus(applyStatusForFiles(safePatchItems.map((item) => item.file)));

    const previewResults: Array<{
      ok: boolean;
      file: string;
      oldContent?: string;
      newContent?: string;
      error?: string;
    }> = [];
    const previewedPatchItems: typeof safePatchItems = [];
    const skippedPatchItems: string[] = [];
    const alreadyAppliedPatchItems: string[] = [];
    let primaryPreviewed = false;
    for (const item of safePatchItems) {
      const preview = await requestFileChangeWithValues({
        apply: false,
        file: item.file,
        mode: item.mode,
        search: item.search,
        content: item.content,
        reason: item.reason,
      });

      if (!preview.ok) {
        const readRes = await fetch("/api/local-agent/project/read-file-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: item.file }),
        }).catch(() => null);
        const readData = readRes ? await readRes.json().catch(() => null) : null;
        const currentContent =
          readData?.ok && readData.file?.kind === "text" && typeof readData.file.content === "string"
            ? readData.file.content
            : "";
        const alreadyApplied =
          item.mode !== "delete" &&
          item.content.trim() &&
          currentContent.includes(item.content.trim()) &&
          (!item.search.trim() || !currentContent.includes(item.search));

        if (alreadyApplied) {
          alreadyAppliedPatchItems.push(item.file);
          if (
            item.file === primaryPatchItem.file &&
            item.mode === primaryPatchItem.mode &&
            item.search === primaryPatchItem.search &&
            item.content === primaryPatchItem.content
          ) {
            primaryPreviewed = true;
          }
          continue;
        }

        skippedPatchItems.push(`${item.file}: ${preview.error || "Preview failed."}`);
        continue;
      }
      previewResults.push(preview);
      previewedPatchItems.push(item);
      if (
        item.file === primaryPatchItem.file &&
        item.mode === primaryPatchItem.mode &&
        item.search === primaryPatchItem.search &&
        item.content === primaryPatchItem.content
      ) {
        primaryPreviewed = true;
      }
    }

    if (!previewedPatchItems.length) {
      if (primaryPreviewed && alreadyAppliedPatchItems.length) {
        appendAssistantStatusMessage(
          `PATCH ALREADY APPLIED\n\nThe current verified patch is already present on disk.\n\nFile(s):\n${alreadyAppliedPatchItems
            .map((file) => `- ${file}`)
            .join("\n")}`,
        );
        setAgentStatus("Patch was already applied. No file write needed.");
        return true;
      }

      throw new Error(skippedPatchItems.join("\n") || "No patch item could be previewed safely.");
    }
    if (!primaryPreviewed) {
      throw new Error(
        `The current verified patch for ${primaryPatchItem.file} could not be previewed. Stale patch items were not applied.${
          skippedPatchItems.length ? `\n${skippedPatchItems.join("\n")}` : ""
        }`,
      );
    }

    let rollbackSaved = false;
    for (const item of previewedPatchItems) {
      const applyResult = await requestFileChangeWithValues({
        apply: true,
        file: item.file,
        mode: item.mode,
        search: item.search,
        content: item.content,
        reason: item.reason,
      });

      if (!applyResult.ok) {
        throw new Error(`${item.file}: ${applyResult.error || "Apply failed."}`);
      }

      if (applyResult.rollback?.id) {
        rememberRollbackSnapshot(applyResult.rollback as RollbackSnapshot);
        rollbackSaved = true;
      }
    }

    setDiffOldContent(previewResults.map((preview) => `FILE: ${preview.file}\n\n${preview.oldContent || ""}`).join("\n\n---\n\n"));
    setDiffNewContent(previewResults.map((preview) => `FILE: ${preview.file}\n\n${preview.newContent || ""}`).join("\n\n---\n\n"));
    markPatchApplied(
      previewedPatchItems.map((item) => item.file),
      JSON.stringify(previewedPatchItems),
    );

    const deletedFiles = previewedPatchItems.filter((item) => item.mode === "delete").map((item) => item.file);
    const changedFiles = previewedPatchItems.filter((item) => item.mode !== "delete").map((item) => item.file);
    const rereadResults = [
      ...deletedFiles.map((file) => ({ file, ok: true, summary: "deleted; rollback snapshot saved" })),
      ...(await rereadAppliedFiles(changedFiles)),
    ];
    const sandboxSummary = await runPostApplySandboxChecks();
    const changedLineSummary = summarizePreviewChanges(previewResults);
    const validationLabel = [...new Set(previewedPatchItems.map((item) => item.mode === "delete" ? "Project validation" : validationLabelForFile(item.file)))]
      .slice(0, 3)
      .join(", ");
    const actionLabel = previewedPatchItems.every((item) => item.mode === "delete") ? "Deleted" : "Updated";
    const skippedBlock = skippedPatchItems.length
      ? `\n\nSKIPPED STALE PATCH ITEMS\n${skippedPatchItems.map((item) => `- ${item}`).join("\n")}`
      : "";

    appendAssistantStatusMessage(
      `PATCH APPLIED BY AGENT\n\nRequest:\n${prompt}\n\n${actionLabel} ${previewedPatchItems.length} file(s):\n${previewedPatchItems
        .map((item) => `- ${item.file}`)
        .join("\n")}\n\nCHANGED LINES\n${changedLineSummary}\n\nVALIDATION\n${validationLabel || "Project diagnostics"} checks were run where available.\n\nRE-READ CHECK\n${rereadResults
        .map((result) => `- ${result.ok ? "PASS" : "FAIL"} ${result.file}: ${result.summary}`)
        .join("\n")}${skippedBlock}\n\nUNDO\n${rollbackSaved ? "Rollback snapshot saved." : "No rollback snapshot was returned for this apply."}\n\nSANDBOX CHECKS\n\n${sandboxSummary}`,
    );
    setAgentStatus(
      rollbackSaved
        ? `Agent applied ${previewedPatchItems.length} verified file change(s). Undo is available.`
        : `Agent applied ${previewedPatchItems.length} verified file change(s). No rollback snapshot was returned.`,
    );
    return true;
  }

  async function applyLastVerifiedAgentPatch() {
    const patchData = latestApplyableAgentPatch();
    if (!patchData) {
      setAgentStatus("No verified Agent patch is ready to apply.");
      return;
    }

    const prompt =
      "Apply the verified patch from the current Agent result, then run the right project validation checks and keep Undo available.";
    const userMessage: ChatMessage = {
      role: "user",
      content: "Apply verified patch",
    };
    const workingMessage: ChatMessage = {
      role: "assistant",
      content: "PayFix Agent is applying the verified patch, saving rollback data, and running validation checks...",
    };

    setAgentLoading(true);
    setAgentStatus("Applying the verified Agent patch...");
    setAgentSessionMessages((current) => [...current, userMessage, workingMessage]);

    try {
      const applied = await autoApplyAgentPatch(patchData, prompt);
      if (!applied) {
        throw new Error("The saved Agent result no longer has a verified patch preview to apply.");
      }

      setLastVerifiedAgentPatch(null);
      setAgentSessionMessages((current) => [
        ...current.slice(0, -1).map((message) =>
          message.role === "assistant" &&
          /Patch preview is ready|Patch prepared:|prepared .*patch|Review\/apply the prepared patch/i.test(message.content)
            ? {
                ...message,
                patchAlreadyApplied: true,
                agentPatchData: undefined,
                content: "PATCH ALREADY APPLIED\n\nThis prepared patch was applied. Pending Apply actions are closed.",
              }
            : message,
        ),
        {
          role: "assistant",
          content:
            "PATCH APPLIED BY AGENT\n\nApplied the verified patch and ran available validation checks. Undo is available if rollback data was returned.",
        },
      ]);
    } catch (err: unknown) {
      const message = agentRunErrorMessage(err);
      setAgentStatus(`Agent apply failed: ${message}`);
      setAgentSessionMessages((current) => [
        ...current.slice(0, -1),
        {
          role: "assistant",
          content: `AUTO-APPLY BLOCKED\n\nPayFix did not write the patch because applying it failed safely:\n${message}`,
        },
      ]);
    } finally {
      setAgentLoading(false);
    }
  }

  async function fixKnownGradleFoojayFailure(prompt: string) {
    if (!connectedProjectPath) return false;

    const diagnostics = await runPostApplySandboxChecks();
    if (!/org\.gradle\.toolchains\.foojay-resolver-convention|foojay-resolver-convention/i.test(diagnostics)) {
      return false;
    }

    const readRes = await fetch("/api/local-agent/project/read-file-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "settings.gradle.kts" }),
    });
    const readData = await readRes.json();
    const currentContent =
      readData?.ok && readData.file?.kind === "text" && typeof readData.file.content === "string"
        ? readData.file.content
        : "";
    if (!currentContent.trim()) return false;

    const exactBlock = `plugins {\n    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"\n}`;
    const updatedContent = currentContent.includes(exactBlock)
      ? currentContent.replace(exactBlock, "").replace(/\n{3,}/g, "\n\n")
      : currentContent.replace(
          /\n?plugins\s*\{\s*id\("org\.gradle\.toolchains\.foojay-resolver-convention"\)\s+version\s+"[^"]+"\s*\}\s*/i,
          "\n",
        );
    if (updatedContent === currentContent) return false;

    const preview = await requestFileChangeWithValues({
      apply: false,
      file: "settings.gradle.kts",
      mode: "replace",
      search: currentContent,
      content: updatedContent,
      reason: "Remove unresolved Foojay toolchain resolver plugin that blocks Gradle sync.",
    });
    if (!preview.ok) {
      throw new Error(preview.error || "Could not preview settings.gradle.kts fix.");
    }

    const applyResult = await requestFileChangeWithValues({
      apply: true,
      file: "settings.gradle.kts",
      mode: "replace",
      search: currentContent,
      content: updatedContent,
      reason: "Remove unresolved Foojay toolchain resolver plugin that blocks Gradle sync.",
    });
    if (!applyResult.ok) {
      throw new Error(applyResult.error || "Could not apply settings.gradle.kts fix.");
    }
    if (applyResult.rollback?.id) {
      rememberRollbackSnapshot(applyResult.rollback as RollbackSnapshot);
    }

    const sandboxSummary = await runPostApplySandboxChecks();
    const changedLineSummary = summarizePreviewChanges([
      {
        file: "settings.gradle.kts",
        oldContent: preview.oldContent || currentContent,
        newContent: preview.newContent || updatedContent,
      },
    ]);

    setAgentSessionMessages((current) => {
      const latest = current.at(-1);
      const withoutWorking =
        latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;

      return [
        ...withoutWorking,
        {
          role: "assistant",
          content: `PATCH APPLIED BY AGENT

Request:
${prompt}

Updated 1 file:
- settings.gradle.kts

What PayFix fixed:
- Removed the unresolved Gradle Foojay toolchain resolver plugin block.
- This was blocking Gradle sync/build before the app module could compile.

CHANGED LINES
${changedLineSummary}

VALIDATION
PayFix reran project diagnostics after applying the fix.

SANDBOX CHECKS

${sandboxSummary}

NEXT STEPS
1. In Android Studio, click File -> Sync Project with Gradle Files.
2. If sync passes, click Build -> Make Project.
3. If a new red error appears, send that exact error back. PayFix should continue from this applied patch, not rebuild the app from scratch.

UNDO
${applyResult.rollback?.id ? "Rollback snapshot saved." : "No rollback snapshot was returned for this apply."}`,
        },
      ];
    });
    setAgentStatus("Applied the Gradle settings fix and reran validation.");
    return true;
  }

  function gradleSslNetworkAnswer(prompt: string) {
    if (!/PKIX path building failed|SSL handshake|certificate_unknown|Could not GET|Could not HEAD|repo\.maven\.apache\.org|Could not resolve/i.test(prompt)) {
      return "";
    }
    if (isAgentExecutionActionPrompt(prompt)) {
      return "";
    }

    const hosts = Array.from(new Set((prompt.match(/https?:\/\/([^/\s'"]+)/gi) || []).map((url) => {
      try {
        return new URL(url).host;
      } catch {
        return url.replace(/^https?:\/\//i, "").split("/")[0];
      }
    }))).filter(Boolean);
    const dependencies = Array.from(
      new Set((prompt.match(/Could not resolve\s+([A-Za-z0-9_.:-]+)\./g) || []).map((match) => match.replace(/^Could not resolve\s+/i, "").replace(/\.$/, ""))),
    );
    const hostList = hosts.length ? hosts.map((host) => `- ${host}`).join("\n") : "- repo.maven.apache.org";
    const dependencyList = dependencies.length ? dependencies.map((item) => `- ${item}`).join("\n") : "- Maven/Gradle dependencies from the runtime classpath";

    return `GRADLE NETWORK / CERTIFICATE BLOCKER

Yes, this looks like something that may need to be allowed/trusted, but the main issue is not your app code.

Most likely cause:
Gradle is trying to download dependencies from Maven Central, but the Java runtime used by Android Studio/Gradle does not trust the HTTPS certificate chain it is receiving. That usually means one of these:
- corporate proxy / SSL inspection is intercepting Maven traffic
- antivirus/firewall is intercepting HTTPS
- company root certificate is missing from the Android Studio JBR/JDK truststore
- network blocks Maven Central

Evidence from your error:
- Gradle fails on :app:debugRuntimeClasspath
- It cannot resolve dependencies such as:
${dependencyList}
- The failing host(s):
${hostList}
- The actual root error is:
  PKIX path building failed / certificate_unknown / SSL handshake exception

What to whitelist / allow:
- https://repo.maven.apache.org/maven2/
- If your Gradle files use it, also allow https://dl.google.com/dl/android/maven2/
- If a company proxy is required, configure Gradle/Android Studio to use that proxy.

What to fix:
1. Open this URL in the same machine/browser:
   https://repo.maven.apache.org/maven2/org/jetbrains/annotations/23.0.0/annotations-23.0.0.pom
   Expected: you should see/download the POM, with no certificate warning.

2. In Android Studio:
   File -> Settings -> Appearance & Behavior -> System Settings -> HTTP Proxy
   Confirm whether your company needs a proxy.

3. Find which Java Gradle is using:
   Android Studio -> Settings -> Build, Execution, Deployment -> Build Tools -> Gradle -> Gradle JDK
   If it uses Android Studio JBR, the company/root CA must be trusted by that JBR/JDK.

4. If your company uses SSL inspection:
   Ask IT for the corporate root CA certificate, then import it into the JDK truststore used by Gradle/Android Studio.

5. Rerun:
   File -> Sync Project with Gradle Files

What PayFix can do next:
- If you paste the Gradle JDK path or a screenshot of Gradle JDK settings, PayFix can give the exact Windows keytool command to import the certificate.
- If Maven opens fine in Chrome but Gradle still fails, PayFix should inspect Gradle proxy/JDK settings next.

Bottom line:
This is a machine/network trust problem around Maven Central, not a missing app source file.`;
  }

  function isAgentExecutionActionPrompt(prompt: string) {
    return /^(Investigate and fix|Fix |Prepare |Patch |Apply |Install |Run |Check |Wire |Create |Add |Delete |Retry )/i.test(prompt.trim()) ||
      /\b(do not just repeat|do not replay|apply safe|safe patch|patch the connected|run validation|report exactly what changed|use the failure output|inspect the exact affected files)\b/i.test(
        prompt,
      );
  }

  async function validateAppliedFileChange() {
    try {
      setAgentStatus(`Re-reading ${basename(applyFilePath)} and running ${validationLabelForFile(applyFilePath)} checks...`);
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

      setAgentStatus(`Patch reasoning complete. Running project sandbox checks after ${validationLabelForFile(applyFilePath)}...`);
      const sandboxSummary = await runPostApplySandboxChecks();

      appendAssistantStatusMessage(`PATCH VALIDATION\n\n${validateData.result}\n\nSANDBOX CHECKS\n\n${sandboxSummary}`);
      setAgentStatus(`Changes applied and validated with ${validationLabelForFile(applyFilePath)} checks.`);
    } catch (err: unknown) {
      setAgentStatus(`Changes applied, but validation failed: ${errorMessage(err)}`);
    }
  }

  async function loadRollbackSnapshots() {
    const response = await fetch("/api/local-agent/project/rollback/list", { cache: "no-store" });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "Could not load rollback snapshots.");

    const snapshots = (data.snapshots || []) as RollbackSnapshot[];
    setRollbackSnapshots(snapshots);
    setLastRollback(snapshots[0] || null);
    return snapshots;
  }

  async function openRollbackOptions() {
    setRollbackLoading(true);
    setAgentStatus("Loading Undo options...");

    try {
      const snapshots = await loadRollbackSnapshots();
      if (!snapshots.length) {
        setAgentStatus("No rollback snapshots are available.");
        return;
      }

      setSelectedRollbackIds(lastRollback?.id ? [lastRollback.id] : [snapshots[0].id]);
      setShowAllRollbackSnapshots(false);
      setExpandedRollbackFiles([]);
      setRollbackOptionsOpen(true);
      setAgentStatus("Choose which PayFix changes to undo.");
    } catch (err: unknown) {
      setAgentStatus(`Could not load Undo options: ${errorMessage(err)}`);
    } finally {
      setRollbackLoading(false);
    }
  }

  function latestRollbackBatchIds(snapshots = rollbackSnapshots) {
    const latest = snapshots[0];
    if (!latest) return [];

    const latestTime = new Date(latest.createdAt).getTime();
    return snapshots
      .filter((snapshot) => Math.abs(new Date(snapshot.createdAt).getTime() - latestTime) <= 4000)
      .map((snapshot) => snapshot.id);
  }

  function rollbackSnapshotReason(snapshot: RollbackSnapshot, isNewest: boolean) {
    if (snapshot.reason && !/^Apply file change$/i.test(snapshot.reason)) {
      return snapshot.reason;
    }

    const file = snapshot.relative || snapshot.file;
    if (snapshot.fileExisted === false) {
      return `PayFix created ${file}. Undo will delete that created file.`;
    }

    return isNewest
      ? `Latest snapshot for ${file}. The exact issue/fix reason was not stored for this older Apply.`
      : `Older snapshot for ${file}. The exact issue/fix reason was not stored for this older Apply.`;
  }

  async function applyRollbackSnapshots(ids = selectedRollbackIds) {
    if (!ids.length) return;

    setRollbackLoading(true);
    setAgentStatus(`Rolling back ${ids.length} snapshot${ids.length === 1 ? "" : "s"}...`);

    const restored: string[] = [];
    const failed: string[] = [];

    try {
      for (const id of ids) {
        const snapshot = rollbackSnapshots.find((item) => item.id === id);
        const response = await fetch("/api/local-agent/project/rollback/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await response.json();

        if (data.ok) {
          restored.push(data.message || `Restored ${snapshot?.relative || snapshot?.file || id}.`);
        } else {
          failed.push(`${snapshot?.relative || snapshot?.file || id}: ${data.error || "Rollback failed."}`);
        }
      }

      appendAssistantStatusMessage(
        `PATCH ROLLED BACK\n\n${restored.length ? restored.map((item) => `- ${item}`).join("\n") : "No files restored."}${
          failed.length ? `\n\nFAILED\n${failed.map((item) => `- ${item}`).join("\n")}` : ""
        }`,
      );

      const remaining = await loadRollbackSnapshots().catch(() => []);
      setSelectedRollbackIds([]);
      setRollbackOptionsOpen(false);
      setAgentStatus(
        failed.length
          ? `Rollback completed with ${failed.length} failure${failed.length === 1 ? "" : "s"}.`
          : `Rolled back ${restored.length} change${restored.length === 1 ? "" : "s"}.`,
      );
      setLastRollback(remaining[0] || null);
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
      reason: applyDescription || `Apply ${basename(applyFilePath)} change`,
    });
  }

  async function requestFileChangeWithValues({
    apply,
    file,
    mode,
    search,
    content,
    reason,
  }: {
    apply: boolean;
    file: string;
    mode: "insert" | "replace" | "overwrite" | "delete";
    search: string;
    content: string;
    reason?: string;
  }) {
    const body = JSON.stringify({
      file,
      mode,
      search,
      content,
      apply,
      reason,
    });
    const requestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    };

    async function parseApplyResponse(response: Response, source: string) {
      const responseText = await response.text();
      try {
        return responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          `${source} returned non-JSON (${response.status}). ${responseText
            .replace(/\s+/g, " ")
            .slice(0, 180)}`,
        );
      }
    }

    const endpoint = mode === "delete" ? "/project/delete-file" : "/project/preview-write-file";

    try {
      const res = await fetch(`/api/local-agent${endpoint}`, requestInit);
      return await parseApplyResponse(res, "Local agent proxy");
    } catch (err: unknown) {
      if (!/non-JSON|Unexpected token|DOCTYPE|404|500/i.test(errorMessage(err))) {
        throw err;
      }

      const directRes = await fetch(`http://localhost:7777${endpoint}`, requestInit);
      return parseApplyResponse(directRes, "Local agent direct endpoint");
    }
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

    const resolvedApplyKey = makeApplyPreviewKey({
      file: resolvedFile,
      mode: parsed.mode,
      search: parsed.search,
      content: parsed.replacement,
    });

    if (appliedPatchKeys.includes(resolvedApplyKey)) {
      setAgentStatus(`That patch was already applied to ${basename(resolvedFile)}. No second Apply is needed.`);
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
            resolvedApplyKey,
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

  function questionWithSelectedQuickReplies() {
    const typed = question.trim();
    if (!selectedQuickReplies.length) return question;

    const selected = `Selected confirmations:\n${selectedQuickReplies.map((reply) => `- ${reply}`).join("\n")}`;
    return typed ? `${typed}\n\n${selected}` : selected;
  }

  async function analyze(
    options: {
      referencedUploads?: UploadedFile[];
      overrideQuestion?: string;
      overrideUploads?: UploadedFile[];
    } = {},
  ) {
    const activeQuestion = options.overrideQuestion ?? question;
    const hasOverride = options.overrideQuestion !== undefined || options.overrideUploads !== undefined;
    const isReplyMode = messages.length > 0;
    if (
      isReplyMode &&
      !activeQuestion.trim() &&
      selectedQuickReplies.length === 0 &&
      !log.trim() &&
      !code.trim() &&
      (options.overrideUploads || uploadedFiles).length === 0 &&
      !computerSearchResults &&
      !connectedProjectPath
    ) {
      setAgentStatus("Please type a message or attach a file/image before sending.");
      return;
    }

    if (!hasOverride && !canSend) return;
    if (!validateCodeBoxBeforeSubmit(code)) return;
    const resolvedUploads = options.overrideUploads || resolveReferencedUploads(options.referencedUploads);
    if (resolvedUploads === null) return;

    const submittedQuestion = options.overrideQuestion ?? questionWithSelectedQuickReplies();
    const submittedLog = log;
    const submittedCode = code;
    const submittedUploadedFiles = mergePersistentEvidenceUploads(resolvedUploads);
    const submittedComputerSearchResults = computerSearchResults;
    const submittedProjectContext = projectContext;
    const submittedConnectedProjectPath = connectedProjectPath;

    setPendingQuestion(submittedQuestion);
    setPendingUploads(submittedUploadedFiles);
    setQuestion("");
    setSelectedQuickReplies([]);
    clearOneShotContextAfterSubmit();
    setLoading(true);

    const userContent =
      submittedQuestion.trim() ||
      (submittedLog.trim() ? "Analyze this payment log / error." : "") ||
      (submittedCode.trim() ? "Analyze this code." : "") ||
      (submittedUploadedFiles.some((file) => file.isImage) ? "Analyze the uploaded image(s)." : "") ||
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

    if (isSpreadsheetEditRequest(userContent)) {
      const spreadsheetUploads = submittedUploadedFiles.filter((file) =>
        /\.(xlsx?|csv)$/i.test(file.name) || /spreadsheet|excel|csv/i.test(file.type),
      );
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
          content: spreadsheetUploads.length
            ? "I can accept spreadsheet uploads now, but direct Excel/XLSX editing is not wired yet. The right next feature is a safe spreadsheet editor that previews cell/sheet changes and returns an updated downloadable workbook."
            : "Attach the Excel/CSV file first. PayFix can accept spreadsheet uploads now, but direct XLSX editing still needs the safe spreadsheet editor before it can return an updated workbook.",
        },
      ];
      setMessages(finalMessages);
      saveActiveChat(finalMessages);
      setLoading(false);
      setPendingQuestion("");
      setPendingUploads([]);
      return;
    }

    const editPlan = imageEditPlan(userContent);
    if (editPlan && submittedUploadedFiles.some((file) => file.isImage)) {
      const userMessage: ChatMessage = {
        role: "user",
        content: userContent,
        attachedLog: submittedLog,
        attachedCode: submittedCode,
        attachedUploads: submittedUploadedFiles,
      };
      const updatedMessages = [...messages, userMessage];
      setMessages([...updatedMessages, { role: "assistant", content: `Editing the uploaded image as ${editPlan.target.label}...` }]);

      try {
        const generatedFiles = await editImagesForChat(submittedUploadedFiles, editPlan);
        const fileList = generatedFiles.map((file) => `- ${file.name}`).join("\n");
        const finalMessages: ChatMessage[] = [
          ...updatedMessages,
          {
            role: "assistant",
            content: `Done. I kept the uploaded image and exported ${editPlan.target.label}.\n\n${fileList}`,
            generatedFiles,
          },
        ];

        setMessages(finalMessages);
        saveActiveChat(finalMessages);
        setEditSnapshot(null);
        setAgentStatus(`Created ${generatedFiles.length} ${editPlan.target.label} file(s).`);
      } catch (err: unknown) {
        const finalMessages: ChatMessage[] = [
          ...updatedMessages,
          { role: "assistant", content: `I could not edit that image: ${errorMessage(err)}` },
        ];
        setMessages(finalMessages);
        saveActiveChat(finalMessages);
        setEditSnapshot(null);
        setAgentStatus(`Image edit failed: ${errorMessage(err)}`);
      } finally {
        setLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return;
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

    if (
      isImageGenerationRequest(userContent) ||
      isImageGenerationFollowUp(userContent) ||
      (submittedUploadedFiles.some((file) => file.isImage) && isReferenceImageEditRequest(userContent))
    ) {
      const userMessage: ChatMessage = {
        role: "user",
        content: userContent,
        attachedLog: submittedLog,
        attachedCode: submittedCode,
        attachedUploads: submittedUploadedFiles,
      };
      const updatedMessages = [...messages, userMessage];
      setMessages([...updatedMessages, { role: "assistant", content: "Generating image..." }]);
      setAgentStatus("Generating downloadable image asset...");

      try {
        const generationPrompt = isImageGenerationFollowUp(userContent)
          ? `${[...messages].reverse().find((message) => message.role === "assistant")?.content || ""}\n\nUser chose: ${userContent}. Generate the finished downloadable asset now.`
          : userContent;
        const referenceImages = submittedUploadedFiles.filter((file) => file.isImage && file.content);
        const shouldEditReference = referenceImages.length > 0 && isReferenceImageEditRequest(userContent);
        const response = await fetch("/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: generationPrompt,
            mode: shouldEditReference ? "edit" : "generate",
            inputImages: shouldEditReference ? referenceImages : [],
          }),
        });
        const data = (await response.json()) as { ok?: boolean; error?: string; files?: GeneratedFile[]; revisedPrompt?: string };
        if (!data.ok || !data.files?.length) throw new Error(data.error || "No image was generated.");

        const finalMessages: ChatMessage[] = [
          ...updatedMessages,
          {
            role: "assistant",
            content: `${shouldEditReference ? "Done. I edited the uploaded image using it as the source reference." : "Done. I generated a downloadable image asset."}\n\n${data.files.map((file) => `- ${file.name}`).join("\n")}`,
            generatedFiles: data.files,
          },
        ];
        setMessages(finalMessages);
        saveActiveChat(finalMessages);
        setEditSnapshot(null);
        setAgentStatus(`Generated ${data.files.length} image asset(s).`);
      } catch (err: unknown) {
        const finalMessages: ChatMessage[] = [
          ...updatedMessages,
          { role: "assistant", content: `Image generation failed: ${errorMessage(err)}` },
        ];
        setMessages(finalMessages);
        saveActiveChat(finalMessages);
        setAgentStatus(`Image generation failed: ${errorMessage(err)}`);
      } finally {
        setLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return;
    }

    if (submittedConnectedProjectPath && (isProjectFolderDeleteRequest(userContent) || isProjectDisconnectRequest(userContent))) {
      const userMessage: ChatMessage = {
        role: "user",
        content: userContent,
        attachedLog: submittedLog,
        attachedCode: submittedCode,
        attachedUploads: submittedUploadedFiles,
      };
      const updatedMessages = [...messages, userMessage];

      try {
        if (!isProjectDisconnectRequest(userContent)) await ensureLocalAgentRoot(submittedConnectedProjectPath);
        const cleanupMessage = await handleEmptyProjectFolderDeleteRequest(userContent);
        const finalMessages: ChatMessage[] = [...updatedMessages, { role: "assistant", content: cleanupMessage }];
        setMessages(finalMessages);
        saveActiveChat(finalMessages);
        setEditSnapshot(null);
        setAgentStatus(
          /^PROJECT FOLDER DELETED/i.test(cleanupMessage)
            ? "Deleted the connected project folder from disk."
            : /^PROJECT FOLDER NOT EMPTY/i.test(cleanupMessage)
              ? "Folder still contains files. Choose what to delete next."
              : /^PROJECT FOLDER BUSY/i.test(cleanupMessage)
                ? "Folder is busy or locked. Choose retry, force delete, or disconnect."
                : /^PROJECT DISCONNECTED/i.test(cleanupMessage)
                  ? "Disconnected the project from PayFix."
                  : "The project folder is empty. Use Delete folder from disk if you want it removed.",
        );
      } catch (err: unknown) {
        const finalMessages: ChatMessage[] = [
          ...updatedMessages,
          { role: "assistant", content: `Folder cleanup failed: ${errorMessage(err)}` },
        ];
        setMessages(finalMessages);
        saveActiveChat(finalMessages);
        setAgentStatus(`Folder cleanup failed: ${errorMessage(err)}`);
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
    reuseCurrentSessionTurn = false,
  }: {
    userContent: string;
    submittedLog: string;
    submittedCode: string;
    submittedUploadedFiles: UploadedFile[];
    submittedComputerSearchResults: string;
    resetSession: boolean;
    reuseCurrentSessionTurn?: boolean;
  }) {
    setAgentSessionEditSnapshot(null);
    const runSeq = ++agentSessionRunSeqRef.current;
    const isCurrentRun = () => agentSessionRunSeqRef.current === runSeq;
    const setAgentSessionMessagesForRun: typeof setAgentSessionMessages = (value) => {
      if (!isCurrentRun()) return;
      setAgentSessionMessages(value);
    };
    const priorSessionMessages = resetSession ? [] : agentSessionMessages;
    const preferredFilesForRun = resetSession ? [] : recentAgentFiles;
    const effectiveUserContent = buildEffectiveAgentRequest({
      userContent,
      priorSessionMessages,
      uploadedFilesForRun: submittedUploadedFiles,
    });
    const hasPriorPaxAndroidBuild = isPaxAndroidBuiltSession(priorSessionMessages);
    const isExplicitFreshPaxBuild =
      isPaxAndroidBuildRequest(effectiveUserContent) &&
      !hasPriorPaxAndroidBuild &&
      !/\b(fix|error|failed|failing|failure|validate|validation|what next|how exactly|next steps?|sync|compile|test|rerun|again|continue)\b/i.test(
        userContent,
      );
    const useConnectedProjectForRun = shouldUseProjectForAgentRun({
      userContent,
      submittedLog,
      submittedCode,
      submittedUploadedFiles,
      submittedComputerSearchResults,
    });
    const userMessage: ChatMessage = {
      role: "user",
      content: userContent,
      attachedLog: submittedLog,
      attachedCode: submittedCode,
      attachedUploads: submittedUploadedFiles,
    };
    const shouldReuseVisibleTurn = reuseCurrentSessionTurn && !resetSession;
    const baseSessionMessages = (() => {
      if (resetSession) return [userMessage];
      if (!shouldReuseVisibleTurn) return [...agentSessionMessages, userMessage];

      const withoutWorking =
        agentSessionMessages.at(-1)?.role === "assistant" && isWorkingAssistantMessage(agentSessionMessages.at(-1)?.content || "")
          ? agentSessionMessages.slice(0, -1)
          : agentSessionMessages;
      const latest = withoutWorking.at(-1);
      if (latest?.role === "user" && latest.content === userContent) {
        return withoutWorking.map((message, index) =>
          index === withoutWorking.length - 1
            ? {
                ...message,
                attachedLog: submittedLog,
                attachedCode: submittedCode,
                attachedUploads: submittedUploadedFiles,
              }
            : message,
        );
      }

      return [...withoutWorking, userMessage];
    })();
    setShowApplyModal(false);
    setAgentSessionMessagesForRun([
      ...baseSessionMessages,
      {
        role: "assistant",
        content: agentWorkingMessageForPrompt(userContent, useConnectedProjectForRun),
        agentProgress: [
          {
            step: "start",
            message: useConnectedProjectForRun
              ? "Preparing the Agent run and checking the connected project setup..."
              : "Preparing the Agent run and checking the attached evidence...",
            at: new Date().toISOString(),
          },
        ],
      },
    ]);

    const runId = crypto.randomUUID();
    let progressTimer: number | null = null;
    const emitLocalProgress = (step: string, message: string) => {
      if (!isCurrentRun()) return;
      setAgentStatus(message);
      replaceLatestAgentWorkingMessage(message, {
        step,
        message,
        at: new Date().toISOString(),
      });
    };

    try {
      if (isSketchProjectCreationRequest(userContent)) {
        const projectRequest = parseSketchProjectCreationRequest(userContent);
        setAgentStatus("Creating project folder and files from the sketch...");
        setAgentSessionMessagesForRun([
          ...baseSessionMessages,
          {
            role: "assistant",
            content: "Creating the project folder, starter files, and run instructions...",
          },
        ]);

        const response = await fetch("/api/create-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...projectRequest,
            prompt: userContent,
            sourceMessage: currentProjectCreationBrief(priorSessionMessages),
          }),
        });
        const data = (await response.json()) as CreateProjectResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Project creation failed.");
        }

        const finalSessionMessages: ChatMessage[] = [
          ...baseSessionMessages,
          {
            role: "assistant",
            content:
              data.markdown ||
              `PROJECT CREATED\n\nPath:\n${data.path || projectRequest.parentPath}\n\nFiles created:\n${(data.files || [])
                .map((file) => `- ${file}`)
                .join("\n")}`,
          },
        ];
        setAgentSessionMessagesForRun(finalSessionMessages);
        setAgentStatus(`Project created: ${data.path || data.folderName || "new project"}`);
        setEditSnapshot(null);
        return;
      }

      if (asksForIdeWorkflowScreenshot(userContent, submittedUploadedFiles)) {
        const workflowScreenshots = submittedUploadedFiles.filter((file) => file.isImage);
        emitLocalProgress("read-screenshot", "Reading the IDE/menu screenshot and matching the visible options to your question...");

        const response = await fetchAgentWithTimeout("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId,
            question: `${effectiveUserContent}

WORKFLOW SCREENSHOT TASK:
Answer this as an IDE/menu navigation question, not as Visual Fix and not as a code patch.
Read the uploaded screenshot carefully. Start by naming the visible menu/options you can actually see.
If "Make Project" or another expected option is not visible, say that plainly.
Give the exact visible option to click now, plus only safe fallbacks such as IDE search or a keyboard shortcut.`,
            history: `CURRENT AGENT REQUEST - USE THIS AS THE ACTIVE TASK:
${effectiveUserContent}

This request is a workflow screenshot question. Do not inspect project files or prepare a patch.`,
            memory: "",
            log: "",
            code: "",
            computerSearchResults: "",
            sdkInspectionContext: "",
            uploadedFiles: workflowScreenshots,
            projectFileList: "",
            preferredFiles: [],
          }),
        });
        const data: AgentApiResponse = await response.json();
        if (!data.ok) throw new Error(data.error || "Agent screenshot workflow read failed.");

        setAgentStatus("Answered the IDE/menu screenshot from visible evidence.");
        setAgentSessionMessagesForRun([
          ...baseSessionMessages,
          {
            role: "assistant",
            content: data.markdown || "I could not read the IDE/menu screenshot clearly enough to answer.",
          },
        ]);
        setEditSnapshot(null);
        return;
      }

      let projectFileList = "";
      if (useConnectedProjectForRun) {
        const disconnectRequested = isProjectDisconnectRequest(userContent);
        if (isProjectFolderDeleteRequest(userContent) || disconnectRequested) {
          if (!disconnectRequested) await ensureLocalAgentRoot(connectedProjectPath);
          const cleanupMessage = await handleEmptyProjectFolderDeleteRequest(userContent);
          const finalSessionMessages: ChatMessage[] = [...baseSessionMessages, { role: "assistant", content: cleanupMessage }];
          setAgentSessionMessagesForRun(finalSessionMessages);
          setAgentStatus(
            /^PROJECT FOLDER DELETED/i.test(cleanupMessage)
              ? "Deleted the empty connected project folder."
              : /^PROJECT FOLDER NOT EMPTY/i.test(cleanupMessage)
                ? "Folder still contains files. Choose what to delete next."
                : /^PROJECT FOLDER BUSY/i.test(cleanupMessage)
                  ? "Folder is busy or locked. Choose retry, force delete, or disconnect."
                  : /^PROJECT DISCONNECTED/i.test(cleanupMessage)
                    ? "Disconnected the project from PayFix."
                    : "The project folder is empty. Use the delete-folder action if you want it removed.",
          );
          return;
        }

        emitLocalProgress("connect-project", "Connecting to the selected project folder through the local agent...");
        await ensureLocalAgentRoot(connectedProjectPath);

        emitLocalProgress("load-files", "Loading the project file inventory so PayFix can choose exact files...");
        projectFileList = await loadFileList();
        if (!projectFileList.trim()) {
          throw new Error("Could not load the project file list from the local agent.");
        }

        const fileCount = projectFileList.split(/\r?\n/).filter(Boolean).length;
        emitLocalProgress("file-inventory", `Loaded ${fileCount} project file(s). Selecting the relevant build/source files...`);
      } else {
        emitLocalProgress("evidence-only", agentWorkingMessageForPrompt(userContent, false));
      }

      let projectPreflightContext = "";
      if (useConnectedProjectForRun && shouldAutoInstallAgentDependencies(effectiveUserContent)) {
        emitLocalProgress("check-toolchain", "Checking detected build system, available validators, and missing toolchain/dependency clues...");
        try {
          const toolchainResponse = await fetch("/api/local-agent/project/toolchain", { cache: "no-store" });
          const toolchainData = await toolchainResponse.json();
          projectPreflightContext = `PROJECT PREFLIGHT / TOOLCHAIN SNAPSHOT:\n${JSON.stringify(toolchainData, null, 2).slice(0, 9000)}`;
          emitLocalProgress(
            "toolchain-summary",
            toolchainData?.ok
              ? "Toolchain snapshot loaded. PayFix will use it to choose install/build/validation steps."
              : `Toolchain snapshot returned a warning: ${toolchainData?.error || "unknown issue"}`,
          );
        } catch (err: unknown) {
          projectPreflightContext = `PROJECT PREFLIGHT / TOOLCHAIN SNAPSHOT:\nCould not load toolchain snapshot: ${errorMessage(err)}`;
          emitLocalProgress("toolchain-warning", `Toolchain snapshot could not be loaded: ${errorMessage(err)}`);
        }
      }

      if (/vendor sdk|local artifacts|sdk folders?|poslink|paxstore|PROJECT SETUP CONTEXT/i.test(effectiveUserContent)) {
        emitLocalProgress("inspect-sdk", "Inspecting selected SDK/artifact folders for AAR/JAR/AIDL files, samples, docs, and Gradle hints...");
      }
      const sdkInspectionContext = await inspectSdkFolderForAgent(effectiveUserContent);
      if (sdkInspectionContext) {
        emitLocalProgress("sdk-summary", "SDK folder inspection finished. Feeding discovered libraries/docs/samples into the Agent run...");
      }
      const agentComputerSearchResults = [submittedComputerSearchResults, projectPreflightContext, sdkInspectionContext].filter(Boolean).join("\n\n");

      if (useConnectedProjectForRun && isExplicitFreshPaxBuild) {
        const sdkRoots = sdkPathsFromAgentPrompt(effectiveUserContent);
        emitLocalProgress("build-files", "Building the PAX Android app files, copying SDK artifacts, and updating Gradle...");
        const buildResponse = await fetch("/api/local-agent/project/build-pax-android", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: effectiveUserContent,
            sdkRoots,
          }),
        });
        const buildData = await buildResponse.json();
        if (!buildResponse.ok || !buildData.ok) {
          throw new Error(buildData.error || "PAX Android build failed.");
        }

        emitLocalProgress("validate", "Running project diagnostics after generating the PAX Android app files...");
        const sandboxSummary = await runPostApplySandboxChecks();
        const filesChanged = Array.isArray(buildData.filesChanged) ? buildData.filesChanged : [];
        const copiedArtifacts = Array.isArray(buildData.copiedArtifacts) ? buildData.copiedArtifacts : [];
        const finalSessionMessages: ChatMessage[] = [
          ...baseSessionMessages,
          {
            role: "assistant",
            content: `PAX ANDROID APP BUILT\n\nPayFix created/updated the connected Android project instead of only inspecting it.\n\nProject:\n${buildData.projectRoot}\n\nPackage/namespace:\n${buildData.namespace}\n\nFiles created or updated:\n${filesChanged.map((file: string) => `- ${file}`).join("\n") || "- No files reported."}\n\nSDK artifacts copied into app/libs:\n${copiedArtifacts.map((file: string) => `- ${file}`).join("\n") || "- No AAR/JAR files were found in the selected SDK folders."}\n\nWhat PayFix wired:\n- MainActivity starter checkout screen\n- PaymentServiceBridge placeholder tied to detected SDK artifacts\n- Gradle app/libs dependency loading for .aar/.jar files\n- AndroidManifest fallback if missing\n\nWhat you do next in Android Studio:\n1. Click Sync Gradle.\n2. Build the app module.\n3. Run it on the PAX A-series device.\n4. Open PaymentServiceBridge and replace the placeholder with the exact POSLink/BroadPOS Intent or AIDL call from the copied vendor sample/docs.\n\nValidation / diagnostics:\n${sandboxSummary}`,
          },
        ];
        setAgentSessionMessagesForRun(finalSessionMessages);
        setEditSnapshot(null);
        setAgentStatus("PAX Android app files created. Review the build report and sync Gradle in Android Studio.");
        return;
      }

      progressTimer = window.setInterval(async () => {
        try {
          if (!isCurrentRun()) return;
          const progressResponse = await fetch(`/api/agent?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
          const progressData = (await progressResponse.json()) as AgentProgressResponse;
          if (!isCurrentRun()) return;
          if (!progressData.ok || !progressData.progress?.message) return;
          setAgentStatus(progressData.progress.message);
          if (progressData.progress.step === "failed") return;
          replaceLatestAgentWorkingMessage(progressData.progress.message, progressData.progress);
        } catch {
          // Progress polling should never fail the Agent run.
        }
      }, 900);

      const response = await fetchAgentWithTimeout("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          question: effectiveUserContent,
          history: `CURRENT AGENT REQUEST - USE THIS AS THE ACTIVE TASK:
${effectiveUserContent}

Older chat/session context is background only. Do not continue an older patch if it conflicts with the current request.

RECENT CHAT:
${recentConversationForAgent()}

AGENT SESSION:
${baseSessionMessages
            .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
            .join("\n\n")}`,
          memory: compressedAgentMemory(),
          log: submittedLog,
          code: `${submittedCode}

EFFECTIVE ACTIVE REQUEST:
${effectiveUserContent}`,
          computerSearchResults: agentComputerSearchResults,
          sdkInspectionContext,
          uploadedFiles: submittedUploadedFiles,
          projectFileList,
          preferredFiles: preferredFilesForRun,
        }),
      });

      const data: AgentApiResponse = await response.json();
      if (!data.ok) throw new Error(data.error || "Agent run failed.");
      if (!isCurrentRun()) return;

      if (data.dependencyProposal?.needed && data.dependencyProposal.packageName) {
        setDependencyProposal(data.dependencyProposal);
      }
      if (data.filesRead?.length) {
        setRecentAgentFiles(data.filesRead.map((file) => file.file));
      } else if (data.selectedFiles?.length) {
        setRecentAgentFiles(data.selectedFiles);
      }

      const inspectedNames = data.filesRead?.map((file) => file.name).join(", ");
      setAgentStatus(
        !useConnectedProjectForRun
          ? "Evidence investigation complete. Connect a project to inspect or patch code."
          : data.patchReady
          ? `Project investigation complete. Patch verified after inspecting: ${inspectedNames || "selected files"}`
          : data.warning
            ? `Project investigation complete without a safe Apply preview: ${data.warning}`
            : "Project investigation complete. See the response for inspected evidence and next steps.",
      );

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: data.markdown || "PayFix investigation finished without a response.",
        agentPatchData: agentResponseHasApplyablePatch(data) ? data : undefined,
      };
      let finalSessionMessages: ChatMessage[] = [...baseSessionMessages, assistantMessage];
      setAgentSessionMessagesForRun(finalSessionMessages);
      setEditSnapshot(null);
      if (agentResponseHasApplyablePatch(data)) {
        setApplyPatchSet([]);
        setApplyPreviewKey("");
        setLastVerifiedAgentPatch(data);
      } else {
        setLastVerifiedAgentPatch(null);
      }

      if (useConnectedProjectForRun && shouldAutoApplyAgentPatch(effectiveUserContent)) {
        try {
          const applied = await autoApplyAgentPatch(data, userContent);
          if (applied) {
            const installMessage = await autoInstallAgentDependencyProposal(data.dependencyProposal, effectiveUserContent);
            finalSessionMessages = [
              ...finalSessionMessages,
              {
                role: "assistant",
                content:
                  "PATCH APPLIED BY AGENT\n\nPayFix applied the verified patch for your current request and ran the available checks. If a rollback snapshot was returned, Undo is available from the applied patch message.",
              },
              ...(installMessage ? [installMessage] : []),
            ];
            setAgentSessionMessagesForRun(finalSessionMessages);
            return;
          }
        } catch (err: unknown) {
          const message = agentRunErrorMessage(err);
          setAgentStatus(`Agent auto-apply failed: ${message}`);
          finalSessionMessages = [
            ...finalSessionMessages,
            {
              role: "assistant",
              content: `AUTO-APPLY BLOCKED\n\nPayFix prepared a patch, but applying it failed safely before completion:\n${message}\n\nThe patch was not written. Ask PayFix to revise the patch or inspect the failure details.`,
            },
          ];
          setAgentSessionMessagesForRun(finalSessionMessages);
        }
      }

      if (data.patchReady) {
        setShowApplyModal(false);
        setAgentStatus(
          shouldAutoApplyAgentPatch(userContent)
            ? "Agent prepared a patch, but it was not auto-applied. Use the Agent action prompts to continue."
            : "Agent prepared a patch. Use the Agent action prompts to explain, revise, or apply it.",
        );
      }

      if (!data.patchReady) {
        const installMessage = await autoInstallAgentDependencyProposal(data.dependencyProposal, effectiveUserContent);
        if (installMessage) {
          finalSessionMessages = [...finalSessionMessages, installMessage];
          setAgentSessionMessagesForRun(finalSessionMessages);
        }
      }
    } catch (err: unknown) {
      const message = agentRunErrorMessage(err);
      const finalSessionMessages: ChatMessage[] = [
        ...baseSessionMessages,
        { role: "assistant", content: `PayFix investigation failed: ${message}` },
      ];
      setAgentSessionMessagesForRun(finalSessionMessages);
      setEditSnapshot(null);
      setAgentStatus(`PayFix investigation failed: ${message}`);
      throw err;
    } finally {
      if (progressTimer) {
        window.clearInterval(progressTimer);
      }
    }
  }

  async function runAgent() {
    const isReplyMode = messages.length > 0;
    if (isReplyMode && !question.trim() && selectedQuickReplies.length === 0 && !log.trim() && !code.trim() && uploadedFiles.length === 0) {
      setAgentStatus("Please type a message or attach evidence before starting an investigation.");
      return;
    }

    if (!canSend) return;
    if (!validateCodeBoxBeforeSubmit(code)) return;

    const submittedQuestion = questionWithSelectedQuickReplies();
    const submittedLog = log;
    const submittedCode = code;
    const submittedUploadedFiles = mergePersistentEvidenceUploads(uploadedFiles);
    const submittedComputerSearchResults = computerSearchResults;
    setAgentSessionInitialDraft("");
    const userContent =
      submittedQuestion.trim() ||
      (submittedLog.trim() ? "Investigate this payment log / error." : "") ||
      (submittedCode.trim() ? "Investigate this code." : "") ||
      (submittedUploadedFiles.length ? "Investigate uploaded file(s)." : "") ||
      (submittedComputerSearchResults ? "Investigate attached computer search." : "") ||
      "Investigate the connected project.";

    if (
      isRegularChatOnlyAgentRequest(userContent, submittedUploadedFiles, {
        log: submittedLog,
        code: submittedCode,
        computerSearchResults: submittedComputerSearchResults,
      })
    ) {
      const redirectMessage = regularChatRedirectMessage(userContent, submittedUploadedFiles);
      setAgentSessionOpen(true);
      setAgentSessionMessages([
        {
          role: "assistant",
          content: redirectMessage,
        },
      ]);
      setAgentSessionUploads(submittedUploadedFiles);
      setAgentSessionFreshUploads([]);
      setAgentStatus("This request is better handled in Regular Chat.");
      setQuestion("");
      setSelectedQuickReplies([]);
      clearOneShotContextAfterSubmit();
      return;
    }

    const useConnectedProjectForRun = shouldUseProjectForAgentRun({
      userContent,
      submittedLog,
      submittedCode,
      submittedUploadedFiles,
      submittedComputerSearchResults,
    });

    resetApplyModal();
    setAppliedPatchNotice(null);
    setAgentSessionOpen(true);
    setAgentSessionMessages([]);
    setAgentSessionUploads(submittedUploadedFiles);
    setAgentSessionFreshUploads([]);
    setRecentAgentFiles([]);
    setLastVerifiedAgentPatch(null);
    setPendingQuestion(submittedQuestion);
    setPendingUploads(submittedUploadedFiles);
    setQuestion("");
    setSelectedQuickReplies([]);
    clearOneShotContextAfterSubmit();
    setLoading(true);
    setAgentLoading(true);
    setDependencyProposal(null);
    setAgentStatus(
      useConnectedProjectForRun
        ? "PayFix Agent is indexing project files..."
        : "PayFix Agent is preparing an evidence investigation...",
    );

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
    agentSessionRunSeqRef.current += 1;
    setAgentLoading(true);
    resetApplyModal();
    setAppliedPatchNotice(null);
    let submittedUploadedFiles = activeAgentSessionUploadsForRun(prompt);
    const hasFreshImageUploads = agentSessionFreshUploads.some((file) => file.isImage);
    if (agentSessionFreshUploads.length && !submittedUploadedFiles.some((file) => file.isImage)) {
      const scopedFreshUploads = scopedAgentSessionUploadsForPrompt(prompt, agentSessionFreshUploads);
      if (scopedFreshUploads.length !== agentSessionFreshUploads.length) {
        setAgentSessionFreshUploads(scopedFreshUploads);
      }
    }
    const isProjectBuilderSession = agentSessionMessages.some((message) => /^PROJECT CREATION BRIEF:/i.test(message.content));
    const flattenedMainContext = messages.flatMap((message) => [message, ...(message.agentSessionMessages || [])]);
    const intentContextMessages = [
      ...flattenedMainContext.slice(-30),
      ...agentSessionMessages,
      ...(agentSessionEditSnapshot?.messages || []),
    ];
    const latestVisibleAssistantForIntent = latestActionableAssistantContext(agentSessionMessages);
    const previousAssistantForIntent = latestVisibleAssistantForIntent || latestActionableAssistantContext(intentContextMessages);
    const showImmediateWorkingTurn = (message: string, attachedUploads = submittedUploadedFiles) => {
      const userMessage: ChatMessage = {
        role: "user",
        content: prompt,
        attachedUploads,
      };
      const workingMessage: ChatMessage = {
        role: "assistant",
        content: message,
        agentProgress: [
          {
            step: "start",
            message,
            at: new Date().toISOString(),
          },
        ],
      };
      setAgentSessionMessages((current) => {
        const latest = current.at(-1);
        const previous = current.at(-2);
        const latestIsReplaceableWorkingTurn =
          latest?.role === "assistant" && (isWorkingAssistantMessage(latest.content) || Boolean(latest.agentProgress?.length));
        if (
          latestIsReplaceableWorkingTurn &&
          previous?.role === "user" &&
          previous.content === prompt
        ) {
          return [
            ...current.slice(0, -2),
            { ...previous, attachedUploads },
            workingMessage,
          ];
        }

        return [...current, userMessage, workingMessage];
      });
    };
    showImmediateWorkingTurn("PayFix is reading your latest request and attached evidence...");

    const fallbackIntent = classifyAgentFollowUpIntent({
      prompt,
      hasImages: submittedUploadedFiles.some((file) => file.isImage),
      hasProject: Boolean(connectedProjectPath),
      isPaxAndroidBuiltSession: isPaxAndroidBuiltSession(),
      previousAssistant: previousAssistantForIntent,
    });
    const followUpIntent = await classifyAgentFollowUpTurn({
      prompt,
      submittedUploadedFiles,
      previousAssistant: previousAssistantForIntent,
    });
    if (!followUpIntent.useImages && submittedUploadedFiles.some((file) => file.isImage) && !hasFreshImageUploads) {
      submittedUploadedFiles = submittedUploadedFiles.filter((file) => !file.isImage);
      showImmediateWorkingTurn("PayFix is reading your latest request...", submittedUploadedFiles);
    }
    if (fallbackIntent.route !== followUpIntent.route) {
      setAgentStatus(`PayFix routed this turn as ${followUpIntent.route}: ${followUpIntent.reason}`);
    }

    if (asksCommandLocationHelp(prompt)) {
      showImmediateWorkingTurn("Answering where to run the pasted command...");
      setAgentStatus("Explaining the correct project folder for the pasted command.");

      setAgentSessionMessages((current) => {
        const latest = current.at(-1);
        const withoutWorking =
          latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
        return [...withoutWorking, { role: "assistant", content: commandLocationHelpMessage(prompt) }];
      });
      setAgentSessionFreshUploads([]);
      setAgentLoading(false);
      setPendingQuestion("");
      setPendingUploads([]);
      return true;
    }

    if (hasTerminalCommandOutput(prompt)) {
      showImmediateWorkingTurn("Reading the latest terminal output as the current blocker...");
      setAgentStatus("Diagnosing the fresh terminal output before using older project context...");

      try {
        const previousContext = formatRecentAgentContext(intentContextMessages, 10, 1600);
        const response = await fetchAgentWithTimeout("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: `The user pasted fresh terminal/IDE/build output. Treat CURRENT USER OUTPUT as the source of truth.
Do not replay older validation, uploaded logs, previous app setup steps, or stale suggestions unless they directly explain the new output.
Diagnose the first/current blocker visible in the current output, then give the exact next step to try.
Treat successful lines in CURRENT USER OUTPUT as already proven. Do not ask the user to rerun those same checks unless the output is incomplete.
If a later command in CURRENT USER OUTPUT exits silently or behaves differently, focus on that command and give the smallest diagnostic step for that silent/different behavior.
If the current output supersedes a previous error, say that plainly.
If the fix is an environment command, show where to run it and how to verify it.
If PayFix can run a connected-project validation/check, say exactly what it can run and what still requires user/admin permission.
Keep the answer compact and conversational.

CURRENT USER OUTPUT:
${prompt}

RECENT AGENT CONTEXT, SECONDARY ONLY:
${previousContext}`,
            history: previousContext,
            memory: "",
            log: "",
            code: prompt,
            computerSearchResults: "",
            sdkInspectionContext: "",
            uploadedFiles: [],
            projectFileList: "",
            preferredFiles: [],
            forceFocusedAnswer: true,
          }),
        });
        const data: AgentApiResponse = await response.json();
        if (!data.ok) throw new Error(data.error || "Could not diagnose that terminal output.");
        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [...withoutWorking, { role: "assistant", content: data.markdown || "I could not diagnose that terminal output clearly yet." }];
        });
        setAgentStatus("Answered from the latest terminal output.");
      } catch (err: unknown) {
        const message = errorMessage(err);
        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [...withoutWorking, { role: "assistant", content: `I understood this as fresh terminal output, but could not diagnose it yet:\n\n${message}` }];
        });
        setAgentStatus(`Could not diagnose terminal output: ${message}`);
      } finally {
        setAgentSessionFreshUploads([]);
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (asksToRunReferencedCommands(prompt)) {
      showImmediateWorkingTurn("Running the referenced project checks through the local agent...");
      setAgentStatus("Running supported project validation/checks through the local agent...");

      try {
        if (!connectedProjectPath) {
          throw new Error("No project folder is connected to this Agent session.");
        }

        await ensureLocalAgentRoot(connectedProjectPath);
        const fileList = await loadFileList();
        const fileCount = fileList.split(/\r?\n/).filter(Boolean).length;
        const sandboxSummary = await runPostApplySandboxChecks();
        const inferredCommand =
          previousAssistantForIntent.match(/(?:^|\n)\s*((?:"[^"]*gradlew(?:\.bat)?[^"]*"|\.\/gradlew|gradlew(?:\.bat)?|npm|pnpm|yarn|mvn|dotnet|cargo|pytest|go test)[^\n]*)/i)?.[1]?.trim() ||
          previousAssistantForIntent.match(/\b((?:gradlew(?:\.bat)?|\.\/gradlew)[^\n]*)/i)?.[1]?.trim() ||
          "the previous validation/build checks";

        const answer = `COMMAND CHECK RUN

I treated your message as a request to run/check the previous commands, not as uploaded evidence.

Connected project:
\`${connectedProjectPath}\`

Project inventory:
- Loaded ${fileCount || 0} project file(s) from the local agent.

Referenced command/check:
\`${inferredCommand}\`

What PayFix ran:
- Supported connected-project validation/build/test checks through the local agent.

Result:
${sandboxSummary}

Note:
- PayFix can run supported project validation through the local agent.
- Admin/system certificate commands such as writing to a JBR/JDK truststore may still require your approval, a certificate file, or an elevated prompt.`;

        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [...withoutWorking, { role: "assistant", content: answer }];
        });
        setAgentStatus("Ran the referenced project checks through the local agent.");
      } catch (err: unknown) {
        const message = errorMessage(err);
        const answer = `COMMAND CHECK NOT RUN

I understood your request as: run/check the commands from the previous answer.

PayFix could not run them yet:
${message}

What to do:
1. Confirm the project folder is connected in this Agent workspace.
2. Restart payfix-agent if the project is connected but file loading still fails.
3. Send the same request again.

I did not treat the attachment as a log comparison.`;

        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [...withoutWorking, { role: "assistant", content: answer }];
        });
        setAgentStatus(`Could not run referenced checks: ${message}`);
      } finally {
        setAgentSessionFreshUploads([]);
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (asksGradleTrustCheck(prompt)) {
      showImmediateWorkingTurn("Running the Gradle/JDK trust check through the connected project...");
      setAgentStatus("Running local validation to confirm whether the Gradle/JDK certificate blocker is still present...");

      try {
        const answer = await gradleTrustCheckMessage();
        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [...withoutWorking, { role: "assistant", content: answer }];
        });
        setAgentStatus("Trust check finished.");
      } catch (err: unknown) {
        const message = errorMessage(err);
        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [
            ...withoutWorking,
            {
              role: "assistant",
              content: `TRUST CHECK NOT RUN

I understood this as a Gradle/JDK trust-check request, but PayFix could not complete the local check.

Reason:
${message}

Next:
A. Reconnect the project folder and run the trust check again.
B. Restart payfix-agent if the project is connected but local checks fail to start.
C. Paste the latest Gradle output if local validation is unavailable.`,
            },
          ];
        });
        setAgentStatus(`Trust check failed: ${message}`);
      } finally {
        setAgentSessionFreshUploads([]);
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (isMavenLocalFallbackRequest(prompt)) {
      showImmediateWorkingTurn("Checking the connected project and local artifacts for a Maven/offline fallback...");
      setAgentStatus("Inspecting missing Maven coordinates and available local artifact files...");

      try {
        const answer = await mavenLocalFallbackMessage(prompt, previousAssistantForIntent);
        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [...withoutWorking, { role: "assistant", content: answer }];
        });
        setAgentStatus("Prepared the Maven/local artifact fallback check.");
      } catch (err: unknown) {
        const message = errorMessage(err);
        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [
            ...withoutWorking,
            {
              role: "assistant",
              content: `MAVEN LOCAL FALLBACK CHECK FAILED

I understood this as a Maven/local artifact fallback request, but PayFix could not inspect enough local state yet.

Reason:
${message}

Next:
A. Reconnect the project folder and run Prepare offline fallback again.
B. Attach/select the local artifact folder that contains .pom/.jar/.aar files.
C. Use the certificate trust fix instead if you have the corporate/root CA file.`,
            },
          ];
        });
        setAgentStatus(`Could not prepare Maven/local fallback: ${message}`);
      } finally {
        setAgentSessionFreshUploads([]);
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (followUpIntent.route === "screenshot-review") {
      const screenshotFiles = submittedUploadedFiles.filter((file) => file.isImage);
      showImmediateWorkingTurn("Looking at your screenshot in context...");
      setAgentStatus("Reading the screenshot against your latest question and recent Agent context...");

      try {
        const previousContext = formatRecentAgentContext(intentContextMessages, 10, 1400);
        const response = await fetchAgentWithTimeout("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: `The user attached screenshot evidence for the latest follow-up.
Current user note: "${prompt}"

Use the screenshots as the current evidence and answer the user's latest question in the context of the recent Agent conversation below.
Do not compare logs. Do not inspect source files. Do not prepare a patch. Do not say no screenshot was provided.
Do not write a generic "Evidence review". Talk to the user directly.
For each screenshot:
- say what setting/page it appears to show
- say what it proves or does not prove for the user's latest question
- say the exact next step, without repeating checks the screenshot/output already proves
If the screenshots show Android Studio HTTP Proxy or Gradle JDK settings, tell the user whether each setting looks correct for the previous Gradle SSL/PKIX/Maven Central issue.
If the screenshot is about a command producing no output, focus on why that command may be silent and what one diagnostic command should be run next.

RECENT AGENT CONTEXT:
${previousContext}`,
            history: previousContext,
            memory: "",
            log: "",
            code: "",
            computerSearchResults: "",
            sdkInspectionContext: "",
            uploadedFiles: screenshotFiles,
            projectFileList: "",
            preferredFiles: [],
            forceImageAnswer: true,
          }),
        });
        const data: AgentApiResponse = await response.json();
        if (!data.ok) throw new Error(data.error || "Could not analyze the screenshots.");
        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [...withoutWorking, { role: "assistant", content: data.markdown || "I could not read the screenshots clearly enough to answer." }];
        });
        setAgentStatus("Answered the screenshot follow-up.");
        setAgentSessionFreshUploads([]);
      } catch (err: unknown) {
        const message = errorMessage(err);
        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [...withoutWorking, { role: "assistant", content: `Could not analyze those screenshots yet:\n\n${message}` }];
        });
        setAgentStatus(`Could not analyze screenshot follow-up: ${message}`);
      } finally {
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (followUpIntent.route === "focused-follow-up") {
      showImmediateWorkingTurn("Answering your focused follow-up from the current Agent context...");
      setAgentStatus("Answering the current focused question without replaying the whole project checklist...");

      try {
        const focusedImageUploads = submittedUploadedFiles.filter((file) => file.isImage);
        const backgroundTextUploads = submittedUploadedFiles
          .filter((file) => !file.isImage && file.content.trim())
          .slice(0, 4)
          .map((file) => `--- ${file.name} ---\n${file.content.slice(0, 2200)}`)
          .join("\n\n");
        const previousContext = formatRecentAgentContext(intentContextMessages, 12, 1800);
        const selectedOption = selectedPreviousOption(prompt, previousAssistantForIntent);
        const focusedQuestion = selectedOption
          ? `The user replied "${prompt}" to select a labeled option from the previous answer.

SELECTED OPTION:
${selectedOption.letter}. ${selectedOption.option}

Answer/action ONLY this selected option. Do not reinterpret ${selectedOption.letter} using older context. Do not switch to another option.`
          : `Answer the user's focused follow-up question directly.
Current user question: "${prompt}"`;
        const response = await fetchAgentWithTimeout("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: `${focusedQuestion}

Use the recent Agent context and attached evidence below. Do not replay the full project next-step checklist unless the user explicitly asks for next steps.
If image evidence is attached, use the screenshot as the source of truth. Do not claim a field, dropdown, or menu is visible unless it is actually visible in the screenshot.
If the user asks "where exactly" or "what do I click" and the expected control is not visible, say "I do not see that control in this screenshot" and give the best visible alternative or the exact next screenshot needed.
If the user asks for a bypass, workaround, or temporary way around the current error, answer that workaround question only. Explain what can be bypassed, what cannot, the safest temporary option, and how to verify it.
If the user asks PayFix to do a Maven/Gradle local-artifact workaround, do not just give manual commands. Say whether PayFix can patch repository order now, whether artifact files/folders are needed, and offer the exact next Agent action.
If the user asks PayFix to run/check/confirm previously mentioned commands but there is no connected project available in RECENT AGENT CONTEXT, do not analyze uploads/logs. Say that PayFix needs the project folder connected before it can run commands, name the command you believe they mean from context if visible, and tell them the exact one-step action to connect/reopen the project.
If the user replies with only a label such as A, B, C, "option A", etc., interpret it as selecting the matching labeled choice from the recent Agent context. State which exact option text was selected, then continue that answer/action. Do not reinterpret the label from older context.
If the user asks about a specific field, option, button, setting, screen, message, or UI element:
- name the thing you think they mean
- answer what it is, why it appears, or exactly what value/action belongs there
- say when to leave it blank, choose auto/default, or avoid touching it
- keep it short and concrete
If you offer optional next actions, do not write "If you want, I can". Only offer choices when useful. Use as many labeled choices as the situation needs:
Choose one:
A. <specific action>
B. <specific action>
C. <specific action, if needed>
Never end with a dangling unfinished "if", "or", "and", or partial bullet.

BACKGROUND TEXT ATTACHMENTS, IF ANY:
${backgroundTextUploads || "No text attachment is needed for this focused follow-up."}

RECENT AGENT CONTEXT:
${previousContext}`,
            history: previousContext,
            memory: "",
            log: "",
            code: "",
            computerSearchResults: "",
            sdkInspectionContext: "",
            uploadedFiles: focusedImageUploads,
            projectFileList: "",
            preferredFiles: [],
            forceImageAnswer: focusedImageUploads.length > 0,
            forceFocusedAnswer: focusedImageUploads.length === 0,
            selectedOption: selectedOption || null,
          }),
        });
        const data: AgentApiResponse = await response.json();
        if (!data.ok) throw new Error(data.error || "Could not answer that follow-up.");
        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [...withoutWorking, { role: "assistant", content: data.markdown || "I could not answer that focused question clearly yet." }];
        });
        setAgentStatus("Answered the focused follow-up.");
        setAgentSessionFreshUploads([]);
      } catch (err: unknown) {
        const message = errorMessage(err);
        setAgentSessionMessages((current) => {
          const latest = current.at(-1);
          const withoutWorking =
            latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
          return [...withoutWorking, { role: "assistant", content: `Could not answer that focused question yet:\n\n${message}` }];
        });
        setAgentStatus(`Could not answer focused follow-up: ${message}`);
      } finally {
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (followUpIntent.route === "build-error") {
      showImmediateWorkingTurn("Checking the current build error, running validation, and preparing the next safe fix...");
      setAgentStatus("Running project validation first, then PayFix will patch the exact Android files.");

      try {
        const fixedKnownGradleIssue = await fixKnownGradleFoojayFailure(prompt);
        if (fixedKnownGradleIssue) {
          setAgentSessionFreshUploads([]);
          return true;
        }

        const sslNetworkAnswer = gradleSslNetworkAnswer(prompt);
        if (sslNetworkAnswer) {
          setAgentSessionMessages((current) => {
            const latest = current.at(-1);
            const withoutWorking =
              latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
            return [...withoutWorking, { role: "assistant", content: sslNetworkAnswer }];
          });
          setAgentStatus("Identified Gradle SSL/Maven network blocker.");
          setAgentSessionFreshUploads([]);
          return true;
        }

        const sandboxSummary = await runPostApplySandboxChecks();
        if (shouldReturnEnvironmentBlockerInsteadOfPatch(prompt, sandboxSummary)) {
          setAgentSessionMessages((current) => {
            const latest = current.at(-1);
            const withoutWorking =
              latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
            return [...withoutWorking, { role: "assistant", content: gradleEnvironmentBlockerMessage(prompt, sandboxSummary) }];
          });
          setAgentStatus("Gradle validation is blocked by Java certificate trust, not app source code.");
          setAgentSessionFreshUploads([]);
          return true;
        }
        await runAgentPromptInSession({
          userContent: prompt,
          submittedLog: "",
          submittedCode: "",
          submittedUploadedFiles,
          submittedComputerSearchResults: `PAX ANDROID FOLLOW-UP VALIDATION OUTPUT:
${sandboxSummary}

The user is continuing after PayFix generated a PAX Android app. Treat this as a real build-fix request, not a fresh evidence investigation. Use the validation output, the connected project, and the generated app context to patch exact files. If the user pasted an Android Studio/Gradle/runtime error, prioritize that error. End with exactly what changed and exactly what to do next in Android Studio.`,
          resetSession: false,
          reuseCurrentSessionTurn: true,
        });
        setAgentSessionFreshUploads([]);
      } catch (err: unknown) {
        const message = errorMessage(err);
        setAgentSessionMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: `Could not continue the PAX Android fix yet:\n\n${message}\n\nPaste the first Android Studio/Gradle error block or screenshot and PayFix will patch from that evidence.`,
          },
        ]);
        setAgentStatus(`Could not continue PAX Android fix: ${message}`);
      } finally {
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (followUpIntent.route === "project-error") {
      showImmediateWorkingTurn("Checking the connected project error and looking for the exact file/config to fix...");
      setAgentStatus("Checking the connected project for IDE/build errors before preparing a fix...");

      try {
        const fixedKnownGradleIssue = await fixKnownGradleFoojayFailure(prompt);
        if (fixedKnownGradleIssue) {
          setAgentSessionFreshUploads([]);
          return true;
        }

        const sslNetworkAnswer = gradleSslNetworkAnswer(prompt);
        if (sslNetworkAnswer) {
          setAgentSessionMessages((current) => {
            const latest = current.at(-1);
            const withoutWorking =
              latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
            return [...withoutWorking, { role: "assistant", content: sslNetworkAnswer }];
          });
          setAgentStatus("Identified Gradle SSL/Maven network blocker.");
          setAgentSessionFreshUploads([]);
          return true;
        }

        const sandboxSummary = await runPostApplySandboxChecks();
        if (shouldReturnEnvironmentBlockerInsteadOfPatch(prompt, sandboxSummary)) {
          setAgentSessionMessages((current) => {
            const latest = current.at(-1);
            const withoutWorking =
              latest?.role === "assistant" && isWorkingAssistantMessage(latest.content) ? current.slice(0, -1) : current;
            return [...withoutWorking, { role: "assistant", content: gradleEnvironmentBlockerMessage(prompt, sandboxSummary) }];
          });
          setAgentStatus("Project validation is blocked by Java certificate trust, not source code.");
          setAgentSessionFreshUploads([]);
          return true;
        }
        await runAgentPromptInSession({
          userContent: prompt,
          submittedLog: "",
          submittedCode: "",
          submittedUploadedFiles,
          submittedComputerSearchResults: `PROJECT ERROR FOLLOW-UP VALIDATION OUTPUT:
${sandboxSummary}

The user is asking PayFix to find or fix an IDE/build/runtime error in the connected project. Treat screenshots, pasted error text, and this validation output as active evidence. This can be any IDE or platform: VS Code, Visual Studio, Android Studio, IntelliJ/Rider, Eclipse, Xcode, Gradle, npm, .NET, Python, Java, Kotlin, Rust, Go, PHP, Ruby, Flutter, or another folder-based project.

Required behavior:
- Identify the exact failing tool/command and exact likely file(s).
- If safe, prepare a patch instead of only explaining.
- If not safe, name the exact missing evidence or missing tool.
- After the fix, give exact next steps in the relevant IDE/build tool.`,
          resetSession: false,
          reuseCurrentSessionTurn: true,
        });
        setAgentSessionFreshUploads([]);
      } catch (err: unknown) {
        const message = errorMessage(err);
        setAgentSessionMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: `Could not run the project error loop yet:\n\n${message}\n\nPaste the first IDE/build error block or attach a screenshot, and PayFix will inspect the connected project and patch from that evidence.`,
          },
        ]);
        setAgentStatus(`Could not run project error loop: ${message}`);
      } finally {
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (isPaxAndroidBuiltSession() && followUpIntent.route === "exact-next-steps") {
      const userMessage: ChatMessage = {
        role: "user",
        content: prompt,
        attachedUploads: submittedUploadedFiles,
      };
      const buildReport = latestPaxAndroidBuildReport();
      let latestValidation = "";
      let liveSdkArtifacts: string[] = [];
      if (connectedProjectPath) {
        setAgentStatus("Checking the current project state before giving next steps...");
        latestValidation = await runPostApplySandboxChecks();
        const fileList = await loadFileList();
        liveSdkArtifacts = sdkArtifactsFromProjectFileList(fileList);
      }
      setAgentSessionMessages((current) => [
        ...current,
        userMessage,
        {
          role: "assistant",
          content: paxAndroidExactNextStepsMessage(buildReport, {
            latestValidation,
            userSaysNoErrors: userSaysErrorsAreGone(prompt),
            liveSdkArtifacts,
          }),
        },
      ]);
      setAgentStatus("Explained the exact Android Studio next steps for this generated PAX app.");
      setAgentLoading(false);
      setPendingQuestion("");
      setPendingUploads([]);
      return true;
    }

    if (connectedProjectPath && followUpIntent.route === "exact-next-steps") {
      setAgentStatus("Preparing exact project-specific next steps from the connected project context...");

      try {
        await runAgentPromptInSession({
          userContent: prompt,
          submittedLog: "",
          submittedCode: "",
          submittedUploadedFiles,
          submittedComputerSearchResults: `EXACT NEXT STEPS FOLLOW-UP:
The user is asking what to do next after the current Agent/project work. Continue from the current conversation and connected project.

Required behavior:
- Give concrete IDE/build-tool steps, not vague advice.
- Include exact menu paths when the IDE is known from the project or user message.
- Include exact files/folders to open.
- Include expected result after each major step.
- Include what error/screenshot/output to send back if a step fails.
- If a validation/build error is present in recent conversation, prioritize fixing that blocker first.`,
          resetSession: false,
        });
        setAgentSessionFreshUploads([]);
      } catch (err: unknown) {
        const message = errorMessage(err);
        setAgentSessionMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: `Could not prepare exact next steps yet:\n\n${message}\n\nReconnect the project or paste the latest IDE/build screen, then ask again.`,
          },
        ]);
        setAgentStatus(`Could not prepare exact next steps: ${message}`);
      } finally {
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (isProjectBuilderSession && asksToDeleteGeneratedProject(prompt)) {
      const userMessage: ChatMessage = {
        role: "user",
        content: prompt,
        attachedUploads: submittedUploadedFiles,
      };
      setAgentSessionMessages((current) => [
        ...current,
        userMessage,
        { role: "assistant", content: "Deleting the generated project folder PayFix created in this builder session..." },
      ]);
      setAgentStatus("Deleting the generated project folder...");

      try {
        const targetPath = latestGeneratedProjectPath(agentSessionMessages);
        if (!targetPath) {
          throw new Error("I could not find the generated project path in this builder session.");
        }

        const response = await fetch("/api/create-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "deleteGeneratedProject",
            targetPath,
            allowLegacyPayfixProject: true,
          }),
        });
        const data = (await response.json()) as CreateProjectResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Could not delete the generated project.");
        }

        if (connectedProjectPath && connectedProjectPath.toLowerCase() === targetPath.toLowerCase()) {
          setConnectedProjectPath("");
          setProjectPath("");
          setProjectContext("");
          setLoadedProjectFiles([]);
          setProjectMatches([]);
          setProjectMemory(null);
          setProjectMap(null);
        }

        setAgentSessionMessages((current) => [
          ...current.filter((message) => message.content !== "Deleting the generated project folder PayFix created in this builder session..."),
          {
            role: "assistant",
            content: data.markdown || `GENERATED PROJECT DELETED\n\nDeleted folder:\n${targetPath}`,
          },
        ]);
        setAgentStatus("Generated project folder deleted.");
      } catch (err: unknown) {
        const message = errorMessage(err);
        setAgentSessionMessages((current) => [
          ...current.filter((item) => item.content !== "Deleting the generated project folder PayFix created in this builder session..."),
          { role: "assistant", content: `Could not delete the generated project: ${message}` },
        ]);
        setAgentStatus(`Could not delete generated project: ${message}`);
      } finally {
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (isProjectBuilderSession && asksToAddMissingJs(prompt)) {
      const userMessage: ChatMessage = {
        role: "user",
        content: prompt,
        attachedUploads: submittedUploadedFiles,
      };
      setAgentSessionMessages((current) => [
        ...current,
        userMessage,
        { role: "assistant", content: "Adding the missing static JavaScript file to the generated project..." },
      ]);
      setAgentStatus("Adding app.js to the generated static project...");

      try {
        const targetPath = latestGeneratedProjectPath(agentSessionMessages);
        if (!targetPath) {
          throw new Error("I could not find the generated project path in this builder session.");
        }

        const response = await fetch("/api/create-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ensureStaticJs",
            targetPath,
            sourceMessage: currentProjectCreationBrief(agentSessionMessages),
          }),
        });
        const data = (await response.json()) as CreateProjectResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Could not add app.js.");
        }

        setAgentSessionMessages((current) => [
          ...current.filter((message) => message.content !== "Adding the missing static JavaScript file to the generated project..."),
          {
            role: "assistant",
            content: data.markdown || `STATIC JS ADDED\n\nPath:\n${targetPath}\n\nFiles updated:\n- app.js\n- index.html`,
          },
        ]);
        setAgentStatus("Added app.js to the generated static project.");
      } catch (err: unknown) {
        const message = errorMessage(err);
        setAgentSessionMessages((current) => [
          ...current.filter((item) => item.content !== "Adding the missing static JavaScript file to the generated project..."),
          { role: "assistant", content: `Could not add the missing JavaScript file: ${message}` },
        ]);
        setAgentStatus(`Could not add app.js: ${message}`);
      } finally {
        setAgentLoading(false);
        setPendingQuestion("");
        setPendingUploads([]);
      }

      return true;
    }

    if (isRegularChatOnlyAgentRequest(prompt, submittedUploadedFiles, { previousAssistant: previousAssistantForIntent })) {
      const redirectMessage = regularChatRedirectMessage(prompt, submittedUploadedFiles);
      setAgentSessionMessages((current) => [...current, { role: "assistant", content: redirectMessage }]);
      setAgentStatus("This belongs in Regular Chat. Agent mode is reserved for project work, patches, validation, installs, and generated apps.");
      setAgentLoading(false);
      return false;
    }

    setPendingQuestion(prompt);
    setPendingUploads(submittedUploadedFiles);
    showImmediateWorkingTurn(agentWorkingMessageForPrompt(prompt, Boolean(connectedProjectPath)));
    setAgentStatus(agentWorkingMessageForPrompt(prompt, Boolean(connectedProjectPath)));

    try {
      await runAgentPromptInSession({
        userContent: prompt,
        submittedLog: "",
        submittedCode: "",
        submittedUploadedFiles,
        submittedComputerSearchResults: "",
        resetSession: false,
        reuseCurrentSessionTurn: true,
      });
      setAgentSessionFreshUploads([]);
    } catch {
      // runAgentPromptInSession already updates the visible Agent session.
    } finally {
      setAgentLoading(false);
      setPendingQuestion("");
      setPendingUploads([]);
    }

    return true;
  }

  async function sendAgentRedirectToRegularChat(prompt: string) {
    const submittedUploadedFiles = activeAgentSessionUploadsForRun(prompt);
    setAgentSessionOpen(false);
    setAgentStatus("Sending redirected Agent question to Regular Chat...");

    await analyze({
      overrideQuestion: prompt,
      overrideUploads: submittedUploadedFiles,
    });
  }

  function agentPromptNeedsProjectBeforeRun(prompt: string) {
    return /\b(create|build|generate)\b[\s\S]{0,80}\b(full runnable project|full project|project from the previous build guide|folder\/files|folder and files)\b/i.test(
      prompt,
    );
  }

  async function startAgentFromActionPrompt(prompt: string) {
    setAgentSessionOpen(true);
    setAgentSessionMessages([]);
    setAgentSessionUploads([]);
    setAgentSessionFreshUploads([]);
    setRecentAgentFiles([]);
    setLastVerifiedAgentPatch(null);
    setDependencyProposal(null);

    if (agentPromptNeedsProjectBeforeRun(prompt)) {
      setAgentSessionInitialDraft(prompt);
      setAgentSessionSetupRevision((value) => value + 1);
      setAgentLoading(false);
      setAgentStatus(
        connectedProjectPath
          ? "Confirm the project and SDK folders, then click Continue Investigation."
          : "Connect a project folder first, then click Continue Investigation.",
      );
      setAgentSessionMessages([
        {
          role: "assistant",
          content:
            "Project and SDK setup required before Agent builds files.\n\nConfirm the project/root folder, add any extracted SDK or local artifact folders, choose the IDE/build target if needed, then click Continue Investigation. PayFix works with VS Code, Visual Studio, Android Studio, IntelliJ/Rider, Eclipse, Xcode exports, and plain repo folders.",
        },
      ]);
      return;
    }

    setAgentSessionInitialDraft("");
    setAgentLoading(true);
    setAgentStatus(agentWorkingMessageForPrompt(prompt, Boolean(connectedProjectPath)));

    try {
      await runAgentPromptInSession({
        userContent: prompt,
        submittedLog: log,
        submittedCode: code,
        submittedUploadedFiles: mergePersistentEvidenceUploads(uploadedFiles),
        submittedComputerSearchResults: computerSearchResults,
        resetSession: true,
      });
    } catch {
      // runAgentPromptInSession already updates the visible Agent session.
    } finally {
      setAgentLoading(false);
    }
  }

  function startAgentFromGeneratedFile(file: GeneratedFile, sourceMessage: string) {
    const designUpload: UploadedFile = {
      name: file.name,
      type: file.type,
      size: file.size,
      content: file.content,
      isImage: /^image\//i.test(file.type),
    };
    const setupPrompt = `PROJECT CREATION BRIEF:
The user wants to turn this generated visual plan/sketch into a real app/program from scratch.

Generated file: ${file.name}

Source assistant context:
${sourceMessage.slice(0, 2500)}

When the user replies, ask for or confirm:
- target parent path
- new folder name
- app type/stack if ambiguous

Then create the folder, files, and runnable program in that location. Prefer the connected project path as the parent if it is available and the user agrees.`;

    setAgentSessionOpen(true);
    setAgentSessionUploads([designUpload]);
    setAgentSessionFreshUploads([designUpload]);
    setAgentSessionMessages([
      {
        role: "user",
        content: setupPrompt,
        attachedUploads: [designUpload],
      },
      {
        role: "assistant",
        content:
          "I can turn this sketch into a real project. Send the target parent path and folder name, plus any preferred stack. Example: `C:\\Users\\mekstein\\source\\repos`, folder `checkout-map-demo`, Next.js app`.",
      },
    ]);
    setRecentAgentFiles([]);
    setLastVerifiedAgentPatch(null);
    setDependencyProposal(null);
    setAgentStatus("Agent workspace opened. Provide the target path and folder name to generate the project.");
  }

  function editAgentSessionMessage(messageIndex: number) {
    const message = agentSessionMessages[messageIndex];
    if (!message || message.role !== "user") return;

    setAgentSessionEditSnapshot({
      messages: agentSessionMessages,
      uploads: agentSessionUploads,
      status: agentStatus,
    });
    setAgentSessionMessages(agentSessionMessages.slice(0, messageIndex));
    setAgentSessionUploads(dedupeUploadedFiles(message.attachedUploads || []));
    setAgentSessionFreshUploads(dedupeUploadedFiles(message.attachedUploads || []));
    setAgentLoading(false);
    resetApplyModal();
    setAppliedPatchNotice(null);
    setAgentStatus("Editing Agent message. The later investigation responses were cleared.");
  }

  function cancelAgentSessionEdit() {
    if (!agentSessionEditSnapshot) return;

    setAgentSessionMessages(agentSessionEditSnapshot.messages);
    setAgentSessionUploads(agentSessionEditSnapshot.uploads);
    setAgentSessionFreshUploads([]);
    setAgentStatus(agentSessionEditSnapshot.status || "Agent edit canceled.");
    setAgentSessionEditSnapshot(null);
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
    setAgentStatus(agentWorkingMessageForPrompt(prompt, true));
    setMessages([...baseMessages, { role: "assistant", content: agentWorkingMessageForPrompt(prompt, true) }]);

    try {
      const disconnectRequested = isProjectDisconnectRequest(prompt);
      if (isProjectFolderDeleteRequest(prompt) || disconnectRequested) {
        if (!disconnectRequested) await ensureLocalAgentRoot(connectedProjectPath);
        const cleanupMessage = await handleEmptyProjectFolderDeleteRequest(prompt);
        const finalMessages = [...baseMessages, { role: "assistant" as const, content: cleanupMessage }];
        setMessages(finalMessages);
        saveActiveChat(finalMessages);
        setAgentStatus(
          /^PROJECT FOLDER DELETED/i.test(cleanupMessage)
            ? "Deleted the empty connected project folder."
            : /^PROJECT FOLDER NOT EMPTY/i.test(cleanupMessage)
              ? "Folder still contains files. Choose what to delete next."
              : /^PROJECT FOLDER BUSY/i.test(cleanupMessage)
                ? "Folder is busy or locked. Choose retry, force delete, or disconnect."
                : /^PROJECT DISCONNECTED/i.test(cleanupMessage)
                  ? "Disconnected the project from PayFix."
                  : "The project folder is empty. Use the delete-folder action if you want it removed.",
        );
        return;
      }

      await ensureLocalAgentRoot(connectedProjectPath);
      const projectFileList = await loadFileList();
      if (!projectFileList.trim()) {
        throw new Error("Could not load the project file list from the local agent.");
      }

      const response = await fetchAgentWithTimeout("/api/agent", {
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
      const message = agentRunErrorMessage(err);
      const finalMessages: ChatMessage[] = [
        ...baseMessages,
        { role: "assistant", content: `Patch investigation follow-up failed: ${message}` },
      ];
      setMessages(finalMessages);
      saveActiveChat(finalMessages);
      setAgentStatus(`Patch investigation follow-up failed: ${message}`);
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

    return `${emvOnly ? "EMV/TLV TROUBLESHOOTING OPENED" : "PAYMENT TRACE OPENED"}

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
    setAgentStatus("Building Payment Trace: device read, EMV/TLV, SDK event, app request, gateway response, final decision...");

    const userContent =
      submittedQuestion.trim() ||
      (submittedLog.trim() ? "Build a Payment Trace from this payment log / error." : "") ||
      (submittedCode.trim() ? "Build a Payment Trace from this code." : "") ||
      (submittedUploadedFiles.length ? "Build a Payment Trace from uploaded file(s)." : "") ||
      (shouldUseSavedSearchContext ? "Build a Payment Trace from attached computer search." : "") ||
      (shouldUseProjectContext ? "Build a Payment Trace from the connected project files." : "") ||
      "Build a Payment Trace from attached context.";

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
          ? "Payment Trace opened EMV/TLV troubleshooting for this device evidence."
          : `Payment Trace built: ${data.timeline.events.length} event(s), ${data.timeline.anomalies.length} anomaly(s).`,
      );
    } catch (err: unknown) {
      setAgentStatus(`Payment Trace failed: ${errorMessage(err)}`);
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

    if (!validateCodeBoxBeforeSubmit(code)) return;

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
    <main className="pf-shell h-screen overflow-hidden text-[var(--pf-text)]">
      <div className="grid h-screen grid-cols-[288px_minmax(0,1fr)]">
        <Sidebar
          savedChats={savedChats}
          onNewChat={newChat}
          onOpenChat={openSavedChat}
          onDeleteRequest={setChatToDelete}
        />

        <section className="flex h-screen min-h-0 flex-col overflow-hidden">
          <header className="relative z-[120] shrink-0 overflow-visible border-b border-[var(--pf-border)] bg-[var(--pf-bg-elevated)]/80 px-5 py-2.5 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold tracking-tight">Debug Console</h2>
                  <span className="pf-badge pf-badge-live">Workspace</span>
                  {connectedProjectPath ? (
                    <span className="pf-badge max-w-[220px] truncate border-violet-500/25 bg-violet-500/10 text-violet-300" title={connectedProjectPath}>
                      {connectedProjectPath.split("\\").pop() || "Project"}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--pf-text-muted)]">
                  Attach context · connect a repo · trace payments · run the agent
                </p>
              </div>

              <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAboutOpen(true)}
                  className="pf-btn-ghost h-8 px-3 text-xs"
                  title="What PayFix can do"
                >
                  <HelpCircle size={15} />
                  About
                </button>
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  className="pf-btn-ghost h-8 px-3 text-xs"
                  title="How to use PayFix"
                >
                  <HelpCircle size={15} />
                  Help
                </button>
                <div ref={toolsMenuRef} className="relative z-[130]">
                  <button
                    type="button"
                    onClick={() => setToolsOpen((open) => !open)}
                    className="pf-btn-ghost h-8 px-3 text-xs"
                    title="Open PayFix tools"
                  >
                    <Wrench size={15} />
                    Tools
                    <ChevronDown size={13} />
                  </button>

                  {toolsOpen && (
                    <div className="pf-panel absolute right-0 top-10 z-[140] w-80 overflow-hidden p-2">
                      {[
                        {
                          title: "Manage Project",
                          tools: [
                            {
                              label: "Project IQ",
                              description: "Validate, inspect runtime ports, view Git state, and map project files.",
                              icon: BrainCircuit,
                              action: openProjectIq,
                              disabled: !connectedProjectPath,
                            },
                          ],
                        },
                        {
                          title: "Inspect App",
                          tools: [
                            {
                              label: "Inspect Localhost",
                              description: "Screenshot a running app and inspect DOM, console, network, and layout issues.",
                              icon: Search,
                              action: inspectRunningApp,
                            },
                          ],
                        },
                        {
                          title: "Payment Tools",
                          tools: [
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
                          ],
                        },
                      ].map((group) => (
                        <div key={group.title} className="py-1">
                          <div className="px-3 pb-1 pt-2 pf-section-label">
                            {group.title}
                          </div>
                          {group.tools.map((tool) => {
                            const Icon = tool.icon;
                            const disabled = "disabled" in tool ? tool.disabled : false;
                            return (
                              <button
                                key={tool.label}
                                type="button"
                                onClick={() => {
                                  if (disabled) return;
                                  setToolsOpen(false);
                                  tool.action();
                                }}
                                disabled={disabled}
                                title={tool.description}
                                className="group flex w-full items-start gap-3 rounded-[var(--pf-radius-sm)] px-3 py-2.5 text-left transition hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span
                                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
                                    disabled ? "bg-white/5 text-[var(--pf-text-faint)]" : "bg-sky-500/15 text-sky-400 group-hover:bg-sky-500/25"
                                  }`}
                                >
                                  <Icon size={16} />
                                </span>
                                <span className="min-w-0">
                                  <span className={`block text-sm font-semibold ${disabled ? "text-[var(--pf-text-faint)]" : "text-[var(--pf-text)]"}`}>
                                    {tool.label}
                                  </span>
                                  <span className="mt-0.5 block text-xs font-medium leading-5 text-[var(--pf-text-muted)]">
                                    {disabled ? "Connect a project first to use this tool." : tool.description}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {lastRollback && (
                  <button
                    type="button"
                    onClick={openRollbackOptions}
                    disabled={rollbackLoading}
                    className="pf-btn-ghost h-8 border-amber-500/30 bg-amber-500/10 px-3 text-xs text-amber-300 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                    title="Choose which PayFix rollback snapshot to restore"
                  >
                    <RotateCcw size={15} />
                    {rollbackLoading ? "Loading..." : "Undo"}
                  </button>
                )}

              </div>
            </div>
          </header>

          {agentStatus && (
            <div className="pointer-events-none fixed left-[304px] top-16 z-[110] max-w-[520px]">
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

          {liveCaptureEvent && (
            <div className="pointer-events-none fixed bottom-28 left-[304px] z-[150] w-[min(520px,calc(100vw-330px))]">
              <div className="pointer-events-auto overflow-hidden rounded-[var(--pf-radius)] border border-amber-500/30 bg-[var(--pf-surface)] shadow-2xl">
                <div className="flex items-start gap-3 bg-amber-500/10 px-4 py-3 text-amber-100">
                  <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black">Live Capture flagged this save</div>
                    <div className="mt-1 break-all text-xs font-semibold text-amber-800">
                      {liveCaptureEvent.relative || liveCaptureEvent.file}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDismissedLiveCaptureEventKey(watchEventKey(liveCaptureEvent))}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/70 text-amber-700 transition hover:bg-white"
                    title="Dismiss Live Capture alert"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="px-4 py-3">
                  <div className="text-sm font-bold text-slate-950">
                    {liveCaptureEvent.analysis?.title || liveCaptureEvent.issues?.[0]?.message || "Possible regression"}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {liveCaptureEvent.analysis?.probableCause ||
                      liveCaptureEvent.issues?.find((issue) => issue.severity !== "info")?.message ||
                      "PayFix noticed a risky watched-file change."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openAgentFromWatchEvent(liveCaptureEvent)}
                      disabled={agentLoading}
                      className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black text-white transition hover:bg-blue-500 disabled:bg-slate-300"
                    >
                      <BrainCircuit size={15} />
                      Open Agent Fix
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProjectIqOpen(true);
                        void refreshWatchMode();
                      }}
                      className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                    >
                      <Activity size={15} />
                      View in IQ
                    </button>
                  </div>
                </div>
              </div>
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
            quickReplyOptions={quickReplyOptions}
            selectedQuickReplies={selectedQuickReplies}
            toggleQuickReply={(value) =>
              setSelectedQuickReplies((current) =>
                current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
              )
            }
            clearSelectedQuickReplies={() => setSelectedQuickReplies([])}
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
            importBrowserCapture={importBrowserCapture}
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
                rollbackTarget={lastRollback}
                rollbackLoading={rollbackLoading}
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
                onOpenAgentSession={(sessionMessages, summaryMessage) => {
                  setAgentSessionMessages(sessionMessages);
                  const sessionUploads = sessionMessages.flatMap((message) => message.attachedUploads || []);
                  setAgentSessionUploads(dedupeUploadedFiles(sessionUploads));
                  setAgentSessionFreshUploads([]);
                  const restoredPatch = isAgentApiResponse(summaryMessage?.agentPatchData)
                    ? summaryMessage.agentPatchData
                    : null;
                  setLastVerifiedAgentPatch(restoredPatch);
                  setAgentSessionOpen(true);
                  setAgentStatus(
                    restoredPatch?.patchReady
                      ? "PayFix investigation reopened with a pending verified patch."
                      : "PayFix investigation reopened.",
                  );
                }}
                onStartAgentPrompt={startAgentFromActionPrompt}
                onCreateCodeFromGeneratedFile={startAgentFromGeneratedFile}
                onRollbackLastApply={openRollbackOptions}
              />
            )}
          </Composer>
        </section>
      </div>

      {rollbackOptionsOpen && (
        <div className="fixed inset-0 z-[360] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="flex max-h-[calc(100vh-48px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-amber-600">Undo options</div>
                <h3 className="mt-1 text-2xl font-bold text-slate-950">Restore PayFix changes</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Choose one file snapshot or select multiple recent snapshots to roll back together.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRollbackOptionsOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => rollbackSnapshots[0] && setSelectedRollbackIds([rollbackSnapshots[0].id])}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-100"
                >
                  Select latest
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRollbackIds(latestRollbackBatchIds())}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-100"
                >
                  Select latest batch
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedRollbackIds(
                      visibleRollbackSnapshots.map((snapshot) => snapshot.id),
                    )
                  }
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-100"
                >
                  Select visible
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRollbackIds([])}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-100"
                >
                  Clear
                </button>
              </div>

              <div className="space-y-3">
                {visibleRollbackGroups.map((group) => {
                  const expanded = expandedRollbackFiles.includes(group.key);
                  const latestSnapshot = group.snapshots[0];
                  if (!latestSnapshot) return null;
                  const checked = selectedRollbackIds.includes(latestSnapshot.id);

                  return (
                    <div key={group.key} className="space-y-2">
                      <label
                        className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                          checked
                            ? "border-amber-300 bg-amber-50 shadow-sm"
                            : "border-slate-200 bg-white hover:border-amber-200 hover:bg-amber-50/50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedRollbackIds((current) =>
                              event.target.checked
                                ? [...current, latestSnapshot.id]
                                : current.filter((id) => id !== latestSnapshot.id),
                            );
                          }}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="break-all font-mono text-sm font-black text-slate-950">
                            {latestSnapshot.relative || latestSnapshot.file}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                            <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
                              {latestSnapshot.fileExisted === false ? "Delete created file" : "Restore previous content"}
                            </span>
                            <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
                              {new Date(latestSnapshot.createdAt).toLocaleString()}
                            </span>
                            {group.snapshots.length > 1 && (
                              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 ring-1 ring-amber-200">
                                {group.snapshots.length - 1} older
                              </span>
                            )}
                          </div>
                          <div className="mt-3 rounded-xl bg-white/70 p-3 text-sm leading-6 text-slate-700 ring-1 ring-slate-200">
                            <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">
                              What this undo affects
                            </div>
                            {rollbackSnapshotReason(latestSnapshot, true)}
                          </div>
                        </div>
                      </label>

                      {expanded && (
                        <div className="ml-7 space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
                          {group.snapshots.slice(1).map((snapshot) => {
                            const olderChecked = selectedRollbackIds.includes(snapshot.id);

                            return (
                              <label
                                key={snapshot.id}
                                className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 transition ${
                                  olderChecked ? "bg-amber-50 ring-1 ring-amber-200" : "bg-slate-50 hover:bg-slate-100"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={olderChecked}
                                  onChange={(event) => {
                                    setSelectedRollbackIds((current) =>
                                      event.target.checked
                                        ? [...current, snapshot.id]
                                        : current.filter((id) => id !== snapshot.id),
                                    );
                                  }}
                                  className="mt-1 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                                    <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
                                      Older version
                                    </span>
                                    <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
                                      {new Date(snapshot.createdAt).toLocaleString()}
                                    </span>
                                    <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
                                      {snapshot.fileExisted === false ? "Delete created file" : "Restore previous content"}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-sm leading-6 text-slate-600">
                                    {rollbackSnapshotReason(snapshot, false)}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {group.snapshots.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedRollbackFiles((current) =>
                              current.includes(group.key)
                                ? current.filter((key) => key !== group.key)
                                : [...current, group.key],
                            )
                          }
                          className="ml-7 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-amber-300 hover:bg-amber-50"
                        >
                          {expanded ? "Hide older versions" : `Show ${group.snapshots.length - 1} older version(s)`}
                        </button>
                      )}
                    </div>
                  );
                })}

                {rollbackGroups.length > 8 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAllRollbackSnapshots((value) => !value);
                      setExpandedRollbackFiles([]);
                    }}
                    className="w-full rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm font-black text-slate-600 transition hover:border-amber-300 hover:bg-amber-50"
                  >
                    {showAllRollbackSnapshots
                      ? "Show recent snapshots only"
                      : `Show ${rollbackGroups.length - 8} older file(s)`}
                  </button>
                )}

                {!rollbackSnapshots.length && (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm font-semibold text-slate-500">
                    No PayFix rollback snapshots are available.
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
              <div className="text-sm font-semibold text-slate-500">
                {selectedRollbackIds.length} selected
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setRollbackOptionsOpen(false)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => applyRollbackSnapshots()}
                  disabled={!selectedRollbackIds.length || rollbackLoading}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <RotateCcw size={16} />
                  {rollbackLoading ? "Restoring..." : "Restore selected"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                  What should Payment Trace inspect?
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Select a previous log, upload, message, or project source to rebuild the payment-specific trace.
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
            {(() => {
              const packageNames = dependencyPackageNames(dependencyProposal);
              const packageLabel = packageNames.join(", ");

              return (
                <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-indigo-600">Agent Dependency Check</div>
                <h3 className="mt-1 text-xl font-bold text-slate-950">
                  Missing package{packageNames.length === 1 ? "" : "s"} detected
                </h3>
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
              <div className="text-sm font-bold text-slate-500">
                Package{packageNames.length === 1 ? "" : "s"}
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-950">{packageLabel}</div>
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
                onClick={requestInstallProposedDependency}
                disabled={dependencyInstalling || dependencyProposal.installable === false}
                className="rounded-xl bg-indigo-600 px-5 py-2 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                title={dependencyProposal.installable === false ? dependencyProposal.installCommand : undefined}
              >
                {dependencyProposal.installable === false
                  ? "Manual Install"
                  : dependencyInstalling
                    ? "Installing..."
                    : packageNames.length === 1
                      ? "Install Package"
                      : "Install All"}
              </button>
            </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {dependencyConfirmOpen && dependencyProposal?.needed && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200">
            <div className="border-b border-slate-200 bg-gradient-to-br from-white to-indigo-50 px-6 py-5">
              <div className="text-xs font-black uppercase tracking-wide text-indigo-600">Confirm Dependency Install</div>
              <h3 className="mt-1 text-xl font-black text-slate-950">Install missing packages?</h3>
              <p className="mt-1 break-all text-sm text-slate-500">{connectedProjectPath || "Connected project"}</p>
            </div>

            {(() => {
              const packageNames = dependencyPackageNames(dependencyProposal);
              const packageLabel = packageNames.join(", ");
              const installCommand =
                dependencyProposal.installCommand ||
                `${dependencyProposal.ecosystem === "node" || !dependencyProposal.ecosystem ? "npm install" : "Install"} ${packageLabel}`;

              return (
                <div className="p-6">
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                    <div className="text-xs font-black uppercase tracking-wide text-indigo-700">
                      Package{packageNames.length === 1 ? "" : "s"}
                    </div>
                    <div className="mt-2 break-words font-mono text-sm font-black text-slate-950">{packageLabel}</div>
                    <div className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">
                      {dependencyProposal.ecosystem || "node"} / {dependencyProposal.devDependency ? "devDependency" : "dependency"}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-100">
                    <div className="font-black uppercase tracking-wide text-slate-400">Command</div>
                    <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-emerald-200">{installCommand}</pre>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-600">
                    PayFix will run this through the local agent in the connected project. This can update package files and
                    lockfiles.
                  </p>

                  <div className="mt-5 flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setDependencyConfirmOpen(false)}
                      className="rounded-xl border border-slate-200 bg-white px-5 py-2 font-bold text-slate-700 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={installProposedDependency}
                      disabled={dependencyInstalling}
                      className="rounded-xl bg-indigo-600 px-5 py-2 font-black text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {dependencyInstalling ? "Installing..." : packageNames.length === 1 ? "Install Package" : "Install All"}
                    </button>
                  </div>
                </div>
              );
            })()}
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
          key={`agent-session-${agentSessionSetupRevision}`}
          messages={agentSessionMessages}
          loading={agentLoading}
          status={agentStatus}
          connectedProjectPath={connectedProjectPath}
          initialDraft={agentSessionInitialDraft}
          setupOpenRevision={agentSessionSetupRevision}
          uploads={agentSessionFreshUploads}
          dependencyProposal={dependencyProposal}
          dependencyInstalling={dependencyInstalling}
          rollbackTarget={lastRollback}
          rollbackLoading={rollbackLoading}
          onClose={closeAgentSessionAndSave}
          onSend={runAgentSessionFollowUp}
          onSendToRegularChat={sendAgentRedirectToRegularChat}
          onConnectProjectPath={connectProjectPath}
          onUpload={handleAgentSessionUpload}
          onRemoveUpload={removeAgentSessionUpload}
          onEditMessage={editAgentSessionMessage}
          onCancelEdit={cancelAgentSessionEdit}
          canApplyVerifiedPatch={Boolean(latestApplyableAgentPatch())}
          onApplyVerifiedPatch={applyLastVerifiedAgentPatch}
          onInstallDependency={requestInstallProposedDependency}
          onRunValidation={runAgentSessionValidation}
          onRollbackLastApply={openRollbackOptions}
        />
      )}

      {showColorEditor && (
        <ColorToolModal
          uploadedFiles={uploadedFiles}
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
          onRunVisualFixAgent={runVisualFixAgent}
          onUploadEvidence={handleUpload}
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
                  Manage Project
                </div>
                <h3 className="mt-1 text-2xl font-bold text-slate-950">Fix, Validate, Inspect, Manage</h3>
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
              <div className="mb-5 grid gap-3 xl:grid-cols-[1fr_auto]">
                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-wide text-slate-400">
                    Core Workflow
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={runAgent}
                      disabled={agentLoading || projectIqLoading || (!canSend && !connectedProjectPath)}
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:bg-slate-300"
                    >
                      <BrainCircuit size={16} />
                      Fix Code
                    </button>
                    <button
                      type="button"
                      onClick={runSandboxRunner}
                      disabled={projectIqLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:bg-slate-300"
                    >
                      <PlayCircle size={16} />
                      Validate
                    </button>
                    <button
                      type="button"
                      onClick={inspectRunningApp}
                      disabled={projectIqLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-blue-50"
                    >
                      <Search size={16} />
                      Inspect App
                    </button>
                    <button
                      type="button"
                      onClick={refreshToolchainDoctor}
                      disabled={projectIqLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-blue-50"
                    >
                      <Wrench size={16} />
                      Toolchain Doctor
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-wide text-slate-400">
                    Project Controls
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                    <button
                      type="button"
                      onClick={openProjectIq}
                      disabled={projectIqLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-blue-50 disabled:bg-slate-100"
                    >
                      <BrainCircuit size={16} />
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={refreshPorts}
                      disabled={projectIqLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-blue-50"
                    >
                      <Activity size={16} />
                      Ports
                    </button>
                    <button
                      type="button"
                      onClick={liveCaptureEnabled ? () => setLiveCaptureEnabled(false) : startLiveCapture}
                      disabled={projectIqLoading}
                      className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold shadow-sm transition disabled:bg-slate-300 ${
                        liveCaptureEnabled
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "bg-indigo-600 text-white hover:bg-indigo-500"
                      }`}
                    >
                      <Activity size={16} />
                      {liveCaptureEnabled ? "Live Capture On" : "Live Capture"}
                    </button>
                    <button
                      type="button"
                      onClick={refreshWatchMode}
                      disabled={projectIqLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    >
                      <Radio size={16} />
                      Watch
                    </button>
                    <button
                      type="button"
                      onClick={downloadWatchSnapshot}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-blue-50"
                    >
                      <FileText size={16} />
                      Snapshot
                    </button>
                    <button
                      type="button"
                      onClick={clearWatchMode}
                      disabled={projectIqLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-sm font-bold text-rose-700 shadow-sm transition hover:bg-rose-50"
                    >
                      <X size={16} />
                      Clear
                    </button>
                  </div>
                </div>
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

                    <div
                      className={`mt-4 rounded-2xl border p-3 ${
                        liveCaptureEnabled
                          ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-black uppercase tracking-wide">
                            {liveCaptureEnabled ? "Live Capture Active" : "Live Capture"}
                          </div>
                          <p className="mt-1 text-xs leading-5">
                            Polls watched saves and flags invalid code, misplaced edits, risky logic, and broken checks.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={liveCaptureEnabled ? () => setLiveCaptureEnabled(false) : startLiveCapture}
                          disabled={projectIqLoading}
                          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black transition disabled:bg-slate-200 ${
                            liveCaptureEnabled
                              ? "bg-white text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
                              : "bg-slate-950 text-white hover:bg-slate-800"
                          }`}
                        >
                          {liveCaptureEnabled ? "Pause" : "Start"}
                        </button>
                      </div>
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
                          {(event.analysis?.risk && event.analysis.risk !== "low") ||
                          event.issues?.some((issue) => issue.severity !== "info") ? (
                            <button
                              type="button"
                              onClick={() => openAgentFromWatchEvent(event)}
                              disabled={agentLoading}
                              className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-black text-white transition hover:bg-blue-500 disabled:bg-slate-300"
                            >
                              <BrainCircuit size={14} />
                              Open Agent Fix
                            </button>
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
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Toolchain Doctor</div>
                        <h4 className="mt-1 font-bold text-slate-950">Project language validators</h4>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          toolchainDoctorResult?.ok
                            ? toolchainDoctorResult.missing?.length
                              ? "bg-amber-50 text-amber-700"
                              : "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {toolchainDoctorResult?.ok
                          ? toolchainDoctorResult.missing?.length
                            ? `${toolchainDoctorResult.missing.length} missing`
                            : "Ready"
                          : "Not checked"}
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      {toolchainDoctorResult?.items?.length ? (
                        toolchainDoctorResult.items.map((item) => (
                          <article
                            key={item.id}
                            className={`rounded-xl border p-3 ${
                              item.available ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-bold text-slate-950">{item.label}</span>
                                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-black text-slate-600">
                                    {item.available ? "available" : "missing tools"}
                                  </span>
                                </div>
                                <div className="mt-2 text-xs font-semibold text-slate-700">
                                  Required: {item.requiredCommands.join(", ")}
                                </div>
                                {item.version ? (
                                  <div className="mt-1 break-all font-mono text-[11px] text-slate-600">{item.version}</div>
                                ) : null}
                                {!item.available ? (
                                  <p className="mt-2 text-xs leading-5 text-amber-900">{item.installHint}</p>
                                ) : null}
                              </div>

                              {!item.available && item.installCommand ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    void navigator.clipboard?.writeText(item.installCommand || "");
                                    setCopiedKey(`toolchain-${item.id}`);
                                    setAgentStatus(`Copied install command for ${item.label}. Run it in an elevated terminal if needed.`);
                                  }}
                                  className="shrink-0 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800"
                                  title={item.installUrl || item.installHint}
                                >
                                  {copiedKey === `toolchain-${item.id}` ? "Copied" : "Copy Install"}
                                </button>
                              ) : null}
                            </div>
                          </article>
                        ))
                      ) : toolchainDoctorResult?.ok ? (
                        <p className="text-sm text-slate-500">
                          No language-specific project files were detected yet.
                        </p>
                      ) : (
                        <p className="text-sm text-amber-700">
                          {toolchainDoctorResult?.error
                            ? "Toolchain Doctor is unavailable. Restart payfix-agent, then run this check again."
                            : "Run Toolchain Doctor to check required validators."}
                        </p>
                      )}
                    </div>
                  </section>

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
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Runtime Ports</div>
                        <h4 className="mt-1 font-bold text-slate-950">Local servers and listeners</h4>
                      </div>
                      <button
                        type="button"
                        onClick={refreshPorts}
                        disabled={projectIqLoading}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-blue-50 disabled:bg-slate-100"
                      >
                        Refresh
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {portManagerResult?.ports?.length ? (
                        portManagerResult.ports
                          .slice(0, 12)
                          .map((port) => {
                            const primaryProcess = port.processes?.[0];
                            const candidate = port.projectCandidates?.[0];
                            const canControl = Boolean(port.devServerLikely && !port.currentAgent);

                            return (
                              <article
                                key={`${port.port}-${primaryProcess?.processId || "unknown"}`}
                                className={`rounded-xl border p-3 ${
                                  port.currentAgent
                                    ? "border-blue-200 bg-blue-50"
                                    : port.devServerLikely
                                      ? "border-emerald-200 bg-emerald-50"
                                      : "border-slate-200 bg-slate-50"
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-mono text-sm font-black text-slate-950">:{port.port}</span>
                                      <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-600">
                                        {port.currentAgent ? "PayFix Agent" : port.devServerLikely ? "Dev server" : "Listener"}
                                      </span>
                                      {primaryProcess?.processId ? (
                                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-500">
                                          PID {primaryProcess.processId}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="mt-2 truncate text-xs font-semibold text-slate-700">
                                      {primaryProcess?.name || "Unknown process"}
                                    </div>
                                    <div className="mt-1 break-all text-[11px] leading-4 text-slate-500">
                                      {candidate?.root || primaryProcess?.commandLine || primaryProcess?.executablePath || "No command line available."}
                                    </div>
                                  </div>

                                  {canControl ? (
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => stopPort(port.port)}
                                        disabled={projectIqLoading}
                                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:bg-slate-100"
                                      >
                                        <Square size={13} />
                                        Stop
                                      </button>
                                      {connectedProjectPath ? (
                                        <button
                                          type="button"
                                          onClick={() => restartPort(port.port)}
                                          disabled={projectIqLoading}
                                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-black text-white transition hover:bg-slate-800 disabled:bg-slate-300"
                                        >
                                          <PlayCircle size={13} />
                                          Restart
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </article>
                            );
                          })
                      ) : portManagerResult?.ok ? (
                        <p className="text-sm text-slate-500">No dev-server-like listening ports were found.</p>
                      ) : (
                        <p className="text-sm text-amber-700">
                          {portManagerResult?.error || "Run Scan Ports to inspect local listeners."}
                        </p>
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

