import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import Image from "next/image";
import { ArrowLeft, Bot, Check, ChevronDown, FileText, FolderOpen, Loader2, Pencil, RotateCcw, Send, Upload, X } from "lucide-react";

import type { ChatMessage, UploadedFile } from "../../lib/payfixTypes";

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

type AgentSessionModalProps = {
  messages: ChatMessage[];
  loading: boolean;
  status: string;
  connectedProjectPath: string;
  initialDraft?: string;
  setupOpenRevision?: number;
  uploads: UploadedFile[];
  dependencyProposal?: DependencyProposal | null;
  dependencyInstalling?: boolean;
  onClose: () => void;
  onSend: (prompt: string) => boolean | Promise<boolean>;
  onSendToRegularChat: (prompt: string) => void | Promise<void>;
  onConnectProjectPath: (path: string) => boolean | Promise<boolean>;
  onUpload: (files: FileList | null) => void | Promise<void>;
  onRemoveUpload: (index: number) => void;
  onEditMessage: (index: number) => void;
  onCancelEdit?: () => void;
  canApplyVerifiedPatch: boolean;
  onApplyVerifiedPatch: () => void;
  onInstallDependency: () => void;
  onRunValidation: () => void;
  rollbackTarget?: {
    file: string;
    relative: string;
  } | null;
  rollbackLoading?: boolean;
  onRollbackLastApply?: () => void;
};

type FolderBrowserTarget = "project" | "sdk";

type FolderBrowserEntry = {
  name: string;
  path: string;
  modifiedAt: string;
};

type FolderBrowserState = {
  open: boolean;
  target: FolderBrowserTarget;
  title: string;
  currentPath: string;
  parentPath: string;
  roots: string[];
  folders: FolderBrowserEntry[];
  selectedPath: string;
  selectedPaths: string[];
  query: string;
  sort: "recent" | "name";
  loading: boolean;
  error: string;
};

function formatFolderModified(value: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function roleLabel(role: ChatMessage["role"]) {
  return role === "user" ? "You" : "PayFix Investigator";
}

function promptForUploadedEvidence(files: UploadedFile[]) {
  if (!files.length) return "";

  const imageCount = files.filter((file) => file.isImage).length;
  const nonImageCount = files.length - imageCount;

  if (imageCount && !nonImageCount) {
    return imageCount === 1
      ? "Review the attached screenshot/image and tell me what it shows, what looks wrong, and the exact next step."
      : "Review the attached screenshots/images together and tell me what they show, what looks wrong, and the exact next step.";
  }

  if (!imageCount) {
    return files.length === 1
      ? "Review the attached file and tell me the important findings, likely cause, and exact next step."
      : "Review the attached files together and tell me the important findings, likely cause, and exact next step.";
  }

  return "Review the attached screenshots and files together, connect the evidence, and tell me the important findings and exact next step.";
}

function isAgentWorkingMessage(content: string) {
  return /^(Agent is running|PayFix is reading|PayFix Agent is|PayFix Agent|Reviewing the screenshots|Answering your focused follow-up|Checking the current build error|Checking the connected project error|Running |Choosing |Reading |Following |Reasoning |Scanning |Evidence-only mode|Investigating evidence|Previewing |Dry-running |Applying |Installing |Validating |Preparing |Prepared |Checked |Connecting |Loading |Loaded |Selecting |Inspecting |SDK folder|Feeding |Checking |Toolchain |Project investigation|Agent completed|Agent timed out)/i.test(
    content,
  );
}

function isDirectFocusedAnswerContent(content: string) {
  const normalized = compactAgentDisplayText(content);
  return /^(Direct answer:|Answer:|Short answer:|Yes[,. ]|No[,. ]|That blank field|What goes in that blank|What this error means|This is not an app-code problem|This is not a code issue|Use one of these|Do this now|The important part|Most likely|For now|Temporary workaround|\*\*What goes in that blank|\*\*What this error really means)/i.test(
    normalized,
  );
}

function isStaleGenericResultAfterFocusedAnswer(content: string) {
  const normalized = compactAgentDisplayText(content);
  return (
    /(AGENT INVESTIGATION COMPLETE|Needs attention|Log comparison|PayFix found a blocker|Validation command failed|No automatic patch is ready)/i.test(
      normalized,
    ) &&
    /(No automatic patch|Validation command failed|No concrete bug|compared the uploaded evidence|confidence was too low|Validation not run)/i.test(
      normalized,
    )
  );
}

function asksToRunReferencedCommandsText(content: string) {
  const normalized = compactAgentDisplayText(content);
  if (!normalized || normalized.length > 360) return false;

  const asksRun = /\b(can you|could you|please|go ahead|run|rerun|execute|try|check|confirm|verify|validate|do)\b/i.test(normalized);
  const referencesExplicitCommand =
    /\b(those|these|them|that|it|the)\s+(commands?|checks?|steps?|validation|build|tests?)\b/i.test(normalized);
  const referencesPriorAction =
    /\b(those|these|them|that|it)\b/i.test(normalized) && /\b(for me|to confirm|again|now|please)\b/i.test(normalized);

  return asksRun && (referencesExplicitCommand || referencesPriorAction);
}

function isPlainFocusedQuestionText(content: string) {
  const normalized = compactAgentDisplayText(content);
  if (!normalized || normalized.length > 520) return false;
  if (asksToRunReferencedCommandsText(normalized)) return false;
  if (/\b(fix|patch|apply|run|rerun|validate|build|test|install|wire|create|delete|move|update|change)\b/i.test(normalized)) {
    return false;
  }

  return (
    /\?/.test(normalized) ||
    /\b(where exactly|what exactly|how exactly|which option|what do i click|what am i entering|what do i enter|i don'?t see|do not see|not seeing|is this right|does this look|why is|what is)\b/i.test(
      normalized,
    )
  );
}

function shouldSuppressGenericActionButtonsForTurn(request: string, response: string) {
  const normalizedResponse = compactAgentDisplayText(response);
  if (!request.trim()) return false;
  if (asksToRunReferencedCommandsText(request)) return true;
  if (isPlainFocusedQuestionText(request)) return true;
  if (/^(?:COMMAND CHECK|TRUST CHECK|MAVEN LOCAL FALLBACK|ENVIRONMENT BLOCKER|PATCH APPLIED|PROJECT CREATED)/i.test(normalizedResponse)) {
    return false;
  }
  if (/Log comparison|Evidence review|No concrete bug was proven|compared the uploaded evidence/i.test(normalizedResponse)) {
    return !/\b(compare|logs?|evidence|baseline|working|failing|root cause|analy[sz]e)\b/i.test(request);
  }

  return false;
}

function visibleAgentMessageItems(messages: ChatMessage[]) {
  const visible: { message: ChatMessage; index: number }[] = [];

  messages.forEach((message, index) => {
    const previousVisible = visible.at(-1)?.message;
    if (
      message.role === "assistant" &&
      previousVisible?.role === "assistant" &&
      isDirectFocusedAnswerContent(previousVisible.content) &&
      isStaleGenericResultAfterFocusedAnswer(message.content)
    ) {
      return;
    }

    visible.push({ message, index });
  });

  return visible;
}

type AgentAction = {
  label: string;
  prompt: string;
  displayPrompt?: string;
  kind?: "applyVerifiedPatch" | "installDependency" | "runValidation";
};

const PROJECT_STACK_OPTIONS = ["Next.js app", "Vite React app", "Static HTML app"];
const IDE_TARGET_OPTIONS = [
  "Auto-detect from project",
  "Android Studio",
  "Visual Studio",
  "VS Code",
  "IntelliJ IDEA",
  "Rider",
  "Eclipse",
  "Xcode",
  "Plain folder/repo",
];

type AgentMessageView = {
  title: string;
  summary: string;
  tone: "neutral" | "success" | "warning";
  sections: { label: string; body: string }[];
};

type ScreenshotReviewItem = {
  label: string;
  what: string;
  verdict: string;
  next: string;
};

function stripBulletPrefix(value: string) {
  return value.replace(/^[-*]\s*/, "").trim();
}

function compactAgentDisplayText(value: string) {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSection(content: string, headings: string[]) {
  for (const heading of headings) {
    const pattern = new RegExp(`(?:^|\\n)${heading}:?\\s*\\n([\\s\\S]*?)(?=\\n\\n[A-Z][A-Z /]+:?\\n|\\n\\n[A-Z][A-Za-z ]+:\\n|\\n\\nConfidence:|$)`, "i");
    const match = content.match(pattern)?.[1]?.trim();
    if (match) return match;
  }

  return "";
}

function cleanAgentLines(value: string, maxLines = 6) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^AGENT INVESTIGATION COMPLETE$/i.test(line))
    .slice(0, maxLines)
    .join("\n");
}

function cleanEnvironmentCheckLines(value: string, maxLines = 4) {
  const seen = new Set<string>();
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((line) =>
      /\b(FAIL|PASS|PKIX|certificate_unknown|SSL handshake|Could not resolve|Could not GET|Could not HEAD|repo\.maven|maven\.google|dl\.google|JAVA_HOME|gradlew\.bat|gradle)\b/i.test(
        line,
      ),
    )
    .slice(0, maxLines)
    .join("\n");
}

function extractAppliedPatchBlock(content: string, heading: string) {
  const match = new RegExp(`(?:^|\\n)${heading}\\s*\\n([\\s\\S]*?)(?=\\n\\n(?:NEXT STEPS|UNDO|CHANGED LINES|VALIDATION|SANDBOX CHECKS)\\s*\\n|$)`, "i").exec(content);
  return match?.[1]?.trim() || "";
}

function cleanEvidenceLines(value: string, maxLines = 12) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join("\n");
}

function renderInlineCode(text: string) {
  return text.split(/(`[^`\n]+`)/g).map((part, index) => {
    if (/^`[^`\n]+`$/.test(part)) {
      return (
        <code key={`${part}-${index}`} className="rounded-md bg-slate-800 px-1.5 py-0.5 font-mono text-[0.92em] text-cyan-100">
          {part.slice(1, -1)}
        </code>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function isHeadingLine(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed)) return true;
  if (/^(Direct answer|Answer|Short answer|Best temporary move|Recommended|Other workable bypass|Avoid|Verify|Evidence|Do this now|Why it matters|Next step|Choose one|What changed|What PayFix did|What was wrong|What to do next):?$/i.test(trimmed)) return true;
  return /^[A-Z][A-Za-z0-9 /&().-]{2,}:$/.test(trimmed);
}

function renderTextLine(line: string, key: string) {
  const cleaned = line.replace(/^#{1,6}\s+/, "").replace(/^\*\*([^*]+)\*\*:?\s*$/, "$1");
  if (isHeadingLine(line)) {
    return (
      <p key={key} className="pt-1 font-black text-slate-950">
        {renderInlineCode(cleaned.replace(/:$/, ""))}
      </p>
    );
  }

  const leadingLabel = line.match(/^(Answer|Direct answer|Short answer|Evidence|Do this|Do this now|Verify|Result|Why|Why it matters|Next|Next step|Bottom line|Use when|What changes|What I see|What it means|What to do|What PayFix tried|What PayFix checked|Can PayFix patch now)\s*:\s*(.+)$/i);
  if (leadingLabel) {
    return (
      <p key={key}>
        <strong className="font-black text-slate-950">{leadingLabel[1]}: </strong>
        {renderInlineCode(leadingLabel[2] || "")}
      </p>
    );
  }

  return <p key={key}>{renderInlineCode(line)}</p>;
}

function AgentFreeformResponse({ content }: { content: string }) {
  const segments = compactAgentDisplayText(content).split(/(```[\s\S]*?```)/g).filter(Boolean);

  return (
    <div className="space-y-4 text-[16px] font-medium leading-7 text-slate-900">
      {segments.map((segment, segmentIndex) => {
        const codeMatch = segment.match(/^```(\w+)?\n?([\s\S]*?)```$/);
        if (codeMatch) {
          return (
            <pre
              key={`code-${segmentIndex}`}
              className="overflow-auto rounded-2xl bg-slate-950 p-4 font-mono text-[13.5px] leading-6 text-slate-100 ring-1 ring-white/10"
            >
              {codeMatch[2].trim()}
            </pre>
          );
        }

        return segment
          .split(/\n{2,}/)
          .map((block, blockIndex) => {
            const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            const key = `text-${segmentIndex}-${blockIndex}`;
            if (!lines.length) return null;

            if (lines.every((line) => /^[-*]\s+/.test(line))) {
              return (
                <ul key={key} className="list-disc space-y-2 pl-5">
                  {lines.map((line, lineIndex) => (
                    <li key={`${key}-${lineIndex}`}>{renderInlineCode(line.replace(/^[-*]\s+/, ""))}</li>
                  ))}
                </ul>
              );
            }

            if (lines.every((line) => /^\d+\.\s+/.test(line))) {
              return (
                <ol key={key} className="list-decimal space-y-2 pl-5">
                  {lines.map((line, lineIndex) => (
                    <li key={`${key}-${lineIndex}`}>{renderInlineCode(line.replace(/^\d+\.\s+/, ""))}</li>
                  ))}
                </ol>
              );
            }

            if (lines.length > 1) {
              return (
                <div key={key} className="space-y-2">
                  {lines.map((line, lineIndex) => (
                    renderTextLine(line, `${key}-${lineIndex}`)
                  ))}
                </div>
              );
            }

            return renderTextLine(lines[0], key);
          });
      })}
    </div>
  );
}

function extractEvidenceSection(content: string, heading: string) {
  const headingMatch = new RegExp(`(?:^|\\n)${heading}:\\s*\\n`, "i").exec(content);
  if (!headingMatch) return "";

  const start = (headingMatch.index || 0) + headingMatch[0].length;
  const nextHeadings = ["Issues", "Most likely cause", "Evidence references", "Main takeaway", "Patch", "Next", "Inspected", "Confidence"];
  const end = nextHeadings
    .filter((item) => item.toLowerCase() !== heading.toLowerCase())
    .map((item) => {
      const index = content.slice(start).search(new RegExp(`\\n\\n${item}:\\s*\\n`, "i"));
      return index >= 0 ? start + index : -1;
    })
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  return content.slice(start, end || undefined).trim();
}

function parseEvidenceComparison(body: string) {
  const normalizedBody = compactAgentDisplayText(body);
  const section = (heading: string, stops: string[]) => {
    const startMatch = new RegExp(`(?:^|\\n)${heading}:\\s*\\n`, "i").exec(normalizedBody);
    if (!startMatch) return "";

    const start = (startMatch.index || 0) + startMatch[0].length;
    const relativeEnd = stops
      .map((stop) => normalizedBody.slice(start).search(new RegExp(`\\n\\n${stop}:\\s*\\n`, "i")))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];

    return normalizedBody.slice(start, relativeEnd >= 0 ? start + relativeEnd : undefined).trim();
  };

  const stops = [
    "Working / baseline log",
    "Failing / suspect log",
    "Source counts",
    "Top suspect-only differences",
    "First meaningful divergence",
    "Main takeaway",
    "Other uploaded evidence",
  ];
  const working = section("Working / baseline log", stops.filter((item) => item !== "Working / baseline log"));
  const failing = section("Failing / suspect log", stops.filter((item) => item !== "Failing / suspect log"));
  const sourceCounts = section("Source counts", stops.filter((item) => item !== "Source counts"));
  const topDifferences = section("Top suspect-only differences", stops.filter((item) => item !== "Top suspect-only differences"));
  const divergence = section("First meaningful divergence", stops.filter((item) => item !== "First meaningful divergence"));
  const takeaway = section("Main takeaway", stops.filter((item) => item !== "Main takeaway"));
  const other = section("Other uploaded evidence", stops.filter((item) => item !== "Other uploaded evidence"));

  return { working, failing, sourceCounts, topDifferences, divergence, takeaway, other };
}

function extractScreenshotReviewField(block: string, fieldPattern: string) {
  const fieldNames =
    "What it shows|What I see|Visible setting|Screenshot shows|Correct or suspicious[^:]*|Verdict|Assessment|Exact next step|Next step|What to do next";
  const match = new RegExp(
    `(?:^|\\n)\\s*-?\\s*(?:${fieldPattern})\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*-?\\s*(?:${fieldNames})\\s*:|$)`,
    "i",
  ).exec(block);

  return (match?.[1] || "")
    .replace(/^\s*[-*]\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseScreenshotReview(content: string): ScreenshotReviewItem[] {
  const normalized = compactAgentDisplayText(content);
  if (!/(?:^|\n)(?:Image|Screenshot)\s+\d+/i.test(normalized)) return [];
  if (!/What it shows|What I see|Visible setting|Screenshot shows|Correct or suspicious|Verdict|Assessment|Exact next step|Next step/i.test(normalized)) return [];

  const matches = [...normalized.matchAll(/(?:^|\n)((?:Image|Screenshot)\s+\d+[^\n]*)/gi)];
  return matches
    .map((match, index) => {
      const start = (match.index || 0) + (match[0].startsWith("\n") ? 1 : 0);
      const end = index + 1 < matches.length ? matches[index + 1].index || normalized.length : normalized.length;
      const block = normalized.slice(start, end).trim();
      const label = match[1].trim();
      const body = block.slice(label.length).trim();
      const what = extractScreenshotReviewField(body, "What it shows|What I see|Visible setting|Screenshot shows");
      const verdict = extractScreenshotReviewField(body, "Correct or suspicious[^:]*|Verdict|Assessment");
      const next = extractScreenshotReviewField(body, "Exact next step|Next step|What to do next");

      return {
        label,
        what,
        verdict,
        next,
      };
    })
    .filter((item) => item.what || item.verdict || item.next);
}

function formatScreenshotReviewBody(item: ScreenshotReviewItem) {
  return [
    item.what ? `What I see\n${item.what}` : "",
    item.verdict ? `Verdict\n${item.verdict}` : "",
    item.next ? `Next step\n${item.next}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function uploadRole(file: UploadedFile) {
  const text = `${file.name}\n${file.content.slice(0, 1400)}`.toLowerCase();
  if (/\b(approved|approval|success|visa|baseline|working|passed)\b/.test(text)) return "working";
  if (/\b(master|mastercard|\bmc\b|declin|fail|error|exception|suspect|broken|not[-\s]?working)\b/.test(text)) return "failing";
  return "other";
}

function salientUploadLines(file: UploadedFile) {
  if (file.isImage || !file.content.trim()) return [];

  const lines = file.content
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((entry) =>
      /\b(key|dictionary|map|duplicate|already|same|exception|error|failed|failure|invalid|declined|approved|xResult|xStatus|response|parse|parsing|tlv|9F27|DF8129|8A)\b/i.test(
        entry.text,
      ),
    );

  const scored = lines.map((entry) => {
    const text = entry.text.toLowerCase();
    const keyCollision =
      /\b(key|dictionary|map|hash|item|entry|tag|tlv)\b/i.test(entry.text) &&
      /\b(duplicate|already|same|exists?|contains?|collision|conflict)\b/i.test(entry.text);
    const exception = /\b(exception|error|failed|failure|invalid|rejected|refused)\b/i.test(entry.text);
    const approval = /\b(xResult=A|xStatus=Approved|approved|authcode)\b/i.test(entry.text);
    const score = keyCollision ? 0 : exception ? 1 : /declin/.test(text) ? 2 : approval ? 5 : 6;
    const label = keyCollision
      ? "Data/key collision"
      : exception
        ? "SDK/app exception"
        : /declin/.test(text)
          ? "Decline signal"
          : approval
            ? "Approval signal"
            : "Related signal";

    return {
      ...entry,
      score,
      label,
      clean: entry.text
        .replace(
          /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+-\d+\s+\S+\s+\S+\s+[A-Z]\s+/,
          "",
        )
        .replace(/^\d{2}:\d{2}:\d{2}\.\d+:\s*/, "")
        .replace(/\s+-\s+at\s+[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .slice(0, 150),
    };
  });

  return scored
    .sort((left, right) => left.score - right.score || left.line - right.line)
    .slice(0, 4)
    .map((entry, index) => `${index + 1}. ${entry.label}\n   Evidence: ${file.name}:${entry.line}\n   ${entry.clean}`);
}

function fallbackComparisonFromUploads(files: UploadedFile[]) {
  const textFiles = files.filter((file) => !file.isImage && file.content.trim());
  if (textFiles.length < 2) return "";

  const working = textFiles.filter((file) => uploadRole(file) === "working");
  const failing = textFiles.filter((file) => uploadRole(file) === "failing");
  const other = textFiles.filter((file) => uploadRole(file) === "other");
  const left = working.length ? working : textFiles.slice(0, 1);
  const right = failing.length ? failing : textFiles.filter((file) => !left.includes(file)).slice(0, 1);

  const formatGroup = (group: UploadedFile[], empty: string) =>
    group
      .map((file) => {
        const signals = salientUploadLines(file);
        return [`- ${file.name}`, signals.length ? signals.join("\n") : `1. ${empty}`].join("\n");
      })
      .join("\n");

  return [
    `Working / baseline log:\n${formatGroup(left, "No strong failure signal found; this log is mainly the comparison baseline.") || "- Not identified"}`,
    `Failing / suspect log:\n${formatGroup(right, "No strong suspect-only signal found in visible uploaded content.") || "- Not identified"}`,
    other.length ? `Other uploaded evidence:\n${formatGroup(other, "Context evidence.")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function EvidenceComparisonSection({ body }: { body: string }) {
  const comparison = parseEvidenceComparison(body);

  if (!comparison.working && !comparison.failing && !comparison.topDifferences) {
    return <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] font-semibold leading-5">{compactAgentDisplayText(body)}</pre>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-emerald-700">Working / baseline</div>
        <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] font-bold leading-5 text-emerald-950">
          {compactAgentDisplayText(comparison.working || "No baseline log was identified.")}
        </pre>
      </div>
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
        <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-rose-700">Failing / suspect</div>
        <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] font-bold leading-5 text-rose-950">
          {compactAgentDisplayText(comparison.failing || "No suspect log was identified.")}
        </pre>
      </div>
      {comparison.topDifferences && (
        <div className="rounded-xl border border-rose-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-rose-700">
            Most important failing-only signals
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] font-bold leading-5 text-rose-950">
            {compactAgentDisplayText(comparison.topDifferences)}
          </pre>
        </div>
      )}
      {comparison.divergence && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 lg:col-span-2">
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-blue-700">
            First meaningful divergence
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] font-semibold leading-5 text-blue-950">
            {compactAgentDisplayText(comparison.divergence)}
          </pre>
        </div>
      )}
      {comparison.takeaway && (
        <div className="rounded-xl border border-amber-200 bg-amber-100/80 p-4 lg:col-span-2">
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-amber-800">
            Main takeaway
          </div>
          <div className="text-[15px] font-black leading-6 text-amber-950">{compactAgentDisplayText(comparison.takeaway)}</div>
        </div>
      )}
      {comparison.sourceCounts && (
        <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 lg:col-span-2">
          <summary className="cursor-pointer text-[11px] font-black uppercase tracking-wide text-slate-600">
            Source counts
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs font-semibold leading-5 text-slate-700">
            {compactAgentDisplayText(comparison.sourceCounts)}
          </pre>
        </details>
      )}
      {comparison.other && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 lg:col-span-2">
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Other evidence</div>
          <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] font-semibold leading-5 text-slate-800">
            {compactAgentDisplayText(comparison.other)}
          </pre>
        </div>
      )}
    </div>
  );
}

function ScreenshotReviewSection({ body }: { body: string }) {
  const parts = compactAgentDisplayText(body)
    .split(/\n\n(?=What I see|Verdict|Next step)/i)
    .map((part) => {
      const [heading, ...rest] = part.split(/\n/);
      return {
        heading: heading.trim(),
        body: rest.join("\n").trim(),
      };
    })
    .filter((part) => part.heading && part.body);

  if (!parts.length) {
    return <pre className="whitespace-pre-wrap break-words font-sans text-[14.5px] font-semibold leading-6 text-slate-900">{compactAgentDisplayText(body)}</pre>;
  }

  return (
    <div className="space-y-3">
      {parts.map((part) => {
        const isVerdict = /^Verdict$/i.test(part.heading);
        const isNext = /^Next step$/i.test(part.heading);
        return (
          <div
            key={part.heading}
            className={`rounded-xl border p-3 ${
              isNext
                ? "border-blue-200 bg-blue-50"
                : isVerdict
                  ? "border-amber-200 bg-amber-50"
                  : "border-slate-200 bg-slate-50"
            }`}
          >
            <div
              className={`mb-1 text-[11px] font-black uppercase tracking-wide ${
                isNext ? "text-blue-700" : isVerdict ? "text-amber-800" : "text-slate-500"
              }`}
            >
              {part.heading}
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans text-[14.5px] font-semibold leading-6 text-slate-950">
              {part.body}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function parentPathFromProjectPath(projectPath: string) {
  const trimmed = projectPath.trim().replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return index > 0 ? trimmed.slice(0, index) : "";
}

function summarizePatchChange(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map(stripBulletPrefix)
    .filter(Boolean)
    .filter((line) => !/^Patch preview is ready/i.test(line))
    .filter((line) => !/^REQUESTED CHANGE:/i.test(line))
    .filter((line) => !/^WHAT THIS CHANGES:/i.test(line))
    .filter((line) => !/^IMPLEMENTATION NOTES:/i.test(line));

  return lines.slice(0, 5).join("\n");
}

function fallbackFixSummaryFromFindings(findings: string) {
  const lines = findings
    .split(/\r?\n/)
    .map(stripBulletPrefix)
    .filter(Boolean);

  if (lines.some((line) => /no-require-imports|require\(\)|require\(\) style import/i.test(line))) {
    return "Convert CommonJS require imports in the affected file(s) to lint-safe imports, or adjust the file/config so lint can pass.";
  }

  if (lines.some((line) => /Cannot find module|Broken local import|not found/i.test(line))) {
    return "Update the broken import/path so it points to the file that actually exists.";
  }

  if (lines.some((line) => /start script|missing file/i.test(line))) {
    return "Update the project script so it starts the existing server entry file.";
  }

  return "";
}

function inlineMissingPackages(content: string) {
  const inline = content.match(/Missing package(?:s)? detected:\s*([^\n]+)/i)?.[1]?.trim();
  if (inline) return `- ${inline}`;

  const section = extractSection(content, ["Missing packages", "Missing dependencies"]);
  return section;
}

function regularChatRedirectPrompt(content: string) {
  return content.split("Send this in Regular Chat:")[1]?.replace(/\n\nAttached evidence stays available:[\s\S]*$/i, "").trim() || "";
}

function generatedProjectPathFromMessages(messages: ChatMessage[]) {
  const lifecycleMessage = [...messages]
    .reverse()
    .find((message) => /\b(PROJECT CREATED|GENERATED PROJECT DELETED)\b/i.test(message.content));
  if (!lifecycleMessage || /\bGENERATED PROJECT DELETED\b/i.test(lifecycleMessage.content)) return "";
  return lifecycleMessage.content.match(/Path:\s*\n([^\r\n]+)/i)?.[1]?.trim() || "";
}

function latestGeneratedProjectWasDeleted(messages: ChatMessage[]) {
  const lifecycleMessage = [...messages]
    .reverse()
    .find((message) => /\b(PROJECT CREATED|GENERATED PROJECT DELETED)\b/i.test(message.content));
  return Boolean(lifecycleMessage && /\bGENERATED PROJECT DELETED\b/i.test(lifecycleMessage.content));
}

function agentMessageView(content: string): AgentMessageView | null {
  if (/^ENVIRONMENT BLOCKER: GRADLE CERTIFICATE TRUST/i.test(content)) {
    const latestNoteChanges = cleanAgentLines(extractSection(content, ["What your latest note changes"]), 2);
    const checked = cleanEnvironmentCheckLines(extractSection(content, ["What PayFix tried"]), 4);
    const nextActions = cleanAgentLines(extractSection(content, ["Useful next Agent actions", "What PayFix can do next"]), 4);
    return {
      title: latestNoteChanges ? "Whitelisting was not enough" : "Environment blocker",
      summary: latestNoteChanges
        ? "PayFix heard the step you already completed and moved to the next real blocker."
        : "PayFix ran validation. Gradle is blocked by Java certificate trust before Android source code can compile.",
      tone: "warning",
      sections: [
        { label: "Answer", body: latestNoteChanges || cleanAgentLines(extractSection(content, ["What this means", "What is actually wrong"]), 3) },
        { label: "Checked", body: checked || "PayFix ran the connected project validation/build checks." },
        { label: "Why code patch is not enough", body: cleanAgentLines(extractSection(content, ["Can PayFix fix this by editing project source files"]), 2) },
        { label: "Do next", body: nextActions },
        { label: "Needs from you", body: cleanAgentLines(extractSection(content, ["What still needs approval/manual input"]), 3) },
      ].filter((section) => section.body),
    };
  }

  if (/^MAVEN LOCAL FALLBACK CHECK/i.test(content)) {
    return {
      title: "Maven/local fallback",
      summary: /Not safely yet/i.test(content)
        ? "PayFix checked whether an offline dependency workaround is possible. It needs the exact local Maven artifacts before patching."
        : "PayFix checked the project for a local Maven/offline artifact workaround.",
      tone: /Not safely yet|missing|not found|blocked|failed/i.test(content) ? "warning" : "neutral",
      sections: [
        { label: "What PayFix checked", body: cleanAgentLines(extractSection(content, ["What I checked"]), 6) },
        { label: "Can PayFix patch now?", body: cleanAgentLines(extractSection(content, ["Can PayFix patch the fallback now"]), 4) },
        { label: "Required artifacts", body: cleanAgentLines(extractSection(content, ["Missing or required artifacts from the current blocker"]), 10) },
        { label: "Do next", body: cleanAgentLines(extractSection(content, ["What to do next"]), 5) },
        { label: "Validation", body: cleanEnvironmentCheckLines(extractSection(content, ["Validation snapshot"]), 4) },
      ].filter((section) => section.body),
    };
  }

  if (/^TRUST CHECK (?:RUN|NOT RUN)/i.test(content)) {
    return {
      title: /^TRUST CHECK RUN/i.test(content) ? "Trust check run" : "Trust check not run",
      summary: /^TRUST CHECK RUN/i.test(content)
        ? "PayFix ran the connected-project validation checks for the Gradle/JDK certificate blocker."
        : "PayFix understood the trust-check request but could not run it yet.",
      tone: /still present|blocked|failed|not run|could not/i.test(content) ? "warning" : "neutral",
      sections: [
        { label: "Project", body: cleanAgentLines(extractSection(content, ["Project"]), 2) },
        { label: "What PayFix ran", body: cleanEnvironmentCheckLines(extractSection(content, ["What PayFix ran"]), 5) },
        { label: "Result", body: cleanAgentLines(extractSection(content, ["Result"]), 4) },
        { label: "What this means", body: cleanAgentLines(extractSection(content, ["What this means", "Reason"]), 4) },
        { label: "Do next", body: cleanAgentLines(extractSection(content, ["Do next", "Next"]), 5) },
      ].filter((section) => section.body),
    };
  }

  if (/^This belongs in Regular Chat, not Agent mode\./i.test(content)) {
    return {
      title: "Use Regular Chat",
      summary: "This is a read/explain/analyze request. Agent mode is reserved for project changes and heavy engineering actions.",
      tone: "neutral",
      sections: [
        { label: "Regular Chat handles", body: "Images, screenshots, logs, TLV/EMV evidence, gateway responses, uploaded files, comparisons, summaries, and root-cause explanations when no project change is requested." },
        { label: "Agent mode handles", body: "Connected-project inspection, file edits, patches, installs, validation, generated projects, Visual Fix patches, and multi-file codebase work." },
        { label: "Send this in Regular Chat", body: regularChatRedirectPrompt(content) },
      ].filter((section) => section.body),
    };
  }

  if (/^PATCH APPLIED BY AGENT/i.test(content)) {
    const sandboxChecks = cleanAgentLines(extractAppliedPatchBlock(content, "SANDBOX CHECKS"), 10);
    const nextSteps = cleanAgentLines(extractAppliedPatchBlock(content, "NEXT STEPS"), 6);
    return {
      title: "Patch applied",
      summary: sandboxChecks && /\bFAIL\b|BUILD FAILED|Could not resolve|SSL handshake|PKIX|failed/i.test(sandboxChecks)
        ? "PayFix wrote the change. Validation moved to the next blocker below."
        : "PayFix wrote the verified change and ran the available checks.",
      tone: "success",
      sections: [
        { label: "Changed", body: cleanAgentLines(extractSection(content, ["Updated \\d+ file\\(s\\)", "Deleted \\d+ file\\(s\\)", "CHANGED LINES"]), 8) },
        { label: "Validation result", body: sandboxChecks || cleanAgentLines(extractSection(content, ["VALIDATION", "SANDBOX CHECKS"]), 8) },
        { label: "Next steps", body: nextSteps },
      ].filter((section) => section.body),
    };
  }

  if (/^PATCH ROLLED BACK/i.test(content)) {
    return {
      title: "Patch rolled back",
      summary: cleanAgentLines(content.replace(/^PATCH ROLLED BACK/i, ""), 3) || "The last Agent patch was restored from rollback.",
      tone: "warning",
      sections: [],
    };
  }

  if (/^Dependency installed/i.test(content)) {
    return {
      title: "Dependencies installed",
      summary: cleanAgentLines(content.match(/Packages:\s*([^\n]+)/i)?.[1] || "Packages were installed.", 2),
      tone: "success",
      sections: [{ label: "Validation", body: cleanAgentLines(extractSection(content, ["VALIDATION", "SANDBOX CHECKS"]), 5) }].filter(
        (section) => section.body,
      ),
    };
  }

  const screenshotReview = parseScreenshotReview(content);
  if (screenshotReview.length) {
    return {
      title: "Screenshot check",
      summary: "PayFix reviewed the screenshots against your follow-up and separated what is visible, what it means, and what to do next.",
      tone: /suspicious|wrong|missing|failed|error|not trusted|PKIX|SSL/i.test(content) ? "warning" : "neutral",
      sections: screenshotReview.map((item) => ({
        label: item.label,
        body: formatScreenshotReviewBody(item),
      })),
    };
  }

  if (!/AGENT INVESTIGATION COMPLETE/i.test(content)) return null;

  const evidenceMode = /I've investigated the uploaded evidence|Found issues in uploaded evidence|Log comparison:|Evidence references:|evidence-only mode/i.test(content);
  if (evidenceMode) {
    const comparison = extractEvidenceSection(content, "Log comparison");
    const issues = cleanEvidenceLines(extractEvidenceSection(content, "Issues"), 12);
    const cause = cleanEvidenceLines(extractEvidenceSection(content, "Most likely cause"), 5);
    const references = cleanEvidenceLines(extractEvidenceSection(content, "Evidence references"), 10);
    const takeaway = cleanEvidenceLines(extractEvidenceSection(content, "Main takeaway"), 4);
    const next = cleanEvidenceLines(extractEvidenceSection(content, "Next"), 4);
    const inspected = cleanEvidenceLines(extractEvidenceSection(content, "Inspected"), 6);
    const evidenceSections = [
        { label: /Top suspect-only differences|First meaningful/i.test(comparison) ? "What sticks out in failing log" : "Side-by-side logs", body: comparison },
      { label: "Failing-log signals", body: issues },
      { label: "Most likely cause", body: cause },
      { label: "Evidence references", body: references },
      { label: "Main takeaway", body: takeaway },
      { label: "Next", body: next },
      { label: "Inspected", body: inspected },
    ].filter((section) => section.body);

    return {
      title: "Log comparison",
      summary:
        /root cause/i.test(content)
          ? "PayFix investigated your follow-up and separated likely cause from baseline evidence and secondary noise."
          : "PayFix compared the uploaded evidence and highlighted suspect-only differences from the failing log.",
      tone: /Data key collision|exception|failure|declin|suspect/i.test(content) ? "warning" : "neutral",
      sections: evidenceSections.length ? evidenceSections : [{ label: "Needs rerun", body: "This saved response did not include comparison details. Use Compare deeper to regenerate the evidence comparison." }],
    };
  }

  const missing = cleanAgentLines(inlineMissingPackages(content), 6);
  const findings = cleanAgentLines(extractSection(content, ["Issues found", "Findings", "Issues", "Checked"]), 8);
  const rawPatch = extractSection(content, ["Patch", "PATCH REVIEW"]);
  const patch = summarizePatchChange(rawPatch) || fallbackFixSummaryFromFindings(findings);
  const validation = cleanAgentLines(extractSection(content, ["Validation", "PROJECT VALIDATION"]), 5);
  const inspected = cleanAgentLines(extractSection(content, ["Inspected", "FILES INSPECTED"]), 3);
  const next = cleanAgentLines(extractSection(content, ["Next"]), 4);
  const hasDependencyBlock = /Dependencies needed|Missing package|Missing dependencies/i.test(content);
  const hasPatch = /Patch preview is ready|Use Apply verified patch|Patch:\s*\n- /i.test(content) && !/Patch:\s*-\s*None yet/i.test(content);
  const hasFailure = /\bFAIL\b|failed|blocked|No automatic patch/i.test(content);
  const summary =
    hasDependencyBlock && !hasPatch
      ? "Install the missing packages first. PayFix also found source/config issues to continue after validation."
      : hasPatch
      ? "PayFix found issues and prepared a reviewable patch. Use the Apply button below when it looks right."
      : hasFailure
        ? "PayFix found a blocker but does not have a safe patch yet. Use the next action below to continue."
        : "PayFix checked the project and summarized the result.";

  return {
    title: hasDependencyBlock && !hasPatch ? "Dependencies needed" : hasPatch ? "Patch ready" : hasFailure ? "Needs attention" : "Investigation complete",
    summary,
    tone: (hasDependencyBlock || hasFailure) && !hasPatch ? "warning" : hasPatch ? "success" : "neutral",
    sections: [
      { label: "Missing packages", body: missing },
      { label: "What was wrong", body: findings },
      { label: "What PayFix will change", body: patch },
      { label: "Validation", body: validation },
      { label: "Next", body: next },
      { label: "Inspected", body: inspected },
    ].filter((section) => section.body),
  };
}

function agentActionPrompts(content: string): AgentAction[] {
  const validationPlan = content.match(/VALIDATION PLAN\s+([\s\S]*?)(?:\n\nConfidence:|\n\n[A-Z][A-Z ]+\n|$)/)?.[1] || "";
  const patchReady =
    /Patch preview is ready|PATCH REVIEW\s+Patch preview|Patch prepared:|Patch:\s*\n-\s+\S+/i.test(content) &&
    !/No automatic patch is ready|Patch:\s*Not prepared|Patch: Not prepared|PATCH ALREADY APPLIED|PATCH APPLIED BY AGENT/i.test(
      content,
    );
  const dependency = content.match(/DEPENDENCY PROPOSAL\s+Package:\s*([^\n]+)/i)?.[1]?.trim();
  const actions: AgentAction[] = [];
  const evidenceMode = /I've investigated the uploaded evidence|Found issues in uploaded evidence|Log comparison:|Evidence references:|evidence-only mode/i.test(content);
  const hasUsefulEvidenceFollowUp =
    /\b(?:log comparison|baseline|working log|failing log|first divergence|root cause|suspect|exception|error|declin|approved|timeout|gateway|EMV|TLV|evidence references|confidence)\b/i.test(
      content,
    ) && !/^\s*(?:direct answer|answer)\s*:/i.test(content);

  if (/^PAX ANDROID APP BUILT/i.test(content)) {
    actions.push({
      label: "Exact next steps",
      prompt: "Show me exactly what to do next in Android Studio for this generated PAX app.",
    });
    actions.push({
      label: "Validate and fix",
      prompt: "Run validation now and fix any PAX Android build errors you find.",
    });
    actions.push({
      label: "Wire POSLink",
      prompt: "Inspect the SDK samples/docs and wire the actual POSLink/BroadPOS payment call in PaymentServiceBridge.",
    });
    return actions;
  }

  if (evidenceMode && hasUsefulEvidenceFollowUp) {
    actions.push({
      label: "Compare deeper",
      prompt:
        "Compare the uploaded logs side by side again as a fresh investigation. Focus only on suspect-only differences in the failing log, summarize the first divergence, separate baseline evidence from failing evidence, and keep raw log lines collapsed into short evidence references.",
    });
    actions.push({
      label: "Explain root cause",
      prompt:
        "Explain the most likely root cause from the uploaded logs in plain English as a fresh follow-up. Do not repeat the previous summary. Separate failing-log evidence from baseline/working-log evidence, explain why generic timeout/noise lines are secondary, and end with one concise bottom-line cause.",
    });
    return actions;
  }

  if (/PROJECT CREATED/i.test(content)) {
    if (/Static HTML app|Open index\.html|index\.html/i.test(content)) {
      actions.push({
        label: "Ensure app.js",
        prompt: "Add the missing app.js file to this generated static project and wire it into index.html.",
      });
    }
    actions.push({
      label: "Delete generated project",
      prompt: "Delete this generated project folder from disk.",
    });
    return actions;
  }

  if (/GENERATED PROJECT DELETED/i.test(content)) {
    return [];
  }

  if (/AUTO-APPLY BLOCKED/i.test(content)) {
    actions.push({
      label: "Retry apply",
      prompt:
        "Retry applying the verified patch from the current Agent result. If the apply endpoint fails again, inspect the apply endpoint response and explain the exact fix.",
    });
  }

  if (/EMPTY PROJECT FOLDER/i.test(content) && /Delete (?:empty )?folder|folder from disk|actual folder tree from disk/i.test(content)) {
    actions.push({
      label: "Delete folder from disk",
      prompt: "Delete the empty connected project folder now.",
    });
    actions.push({
      label: "Disconnect only",
      prompt: "Disconnect this project from PayFix without deleting anything else.",
    });
    return actions;
  }

  if (/PROJECT FOLDER BUSY/i.test(content)) {
    actions.push({
      label: "Retry disk delete",
      prompt: "Delete the empty connected project folder now.",
    });
    actions.push({
      label: "Force disk delete",
      prompt: "Force delete the empty connected project folder now, even if Windows reports it as busy or locked.",
    });
    actions.push({
      label: "Disconnect only",
      prompt: "Disconnect this project from PayFix without deleting anything else.",
    });
    return actions;
  }

  if (/PROJECT FOLDER NOT EMPTY/i.test(content)) {
    actions.push({
      label: "Delete files from disk",
      prompt: "Delete the remaining files in the connected project folder. Prepare a reviewable delete preview first.",
    });
    actions.push({
      label: "Delete folder from disk",
      prompt: "Delete the empty connected project folder now.",
    });
    actions.push({
      label: "Disconnect only",
      prompt: "Disconnect this project from PayFix without deleting anything else.",
    });
    return actions;
  }

  if (/PATCH APPLIED BY AGENT|PATCH APPLIED/i.test(content)) {
    actions.push({
      label: "Run validation",
      prompt:
        "Run the right validation checks for this project and language now. Keep it short and show only pass/fail plus exact errors.",
      kind: "runValidation",
    });
    actions.push({
      label: "Check remaining issues",
      prompt:
        "Check for remaining startup, lint, build, import, dependency, and stale-file issues. Prepare the next safe patch only if a concrete issue remains.",
    });
    return actions;
  }

  if (/Sandbox checks found failures|SANDBOX CHECKS[\s\S]*\bFAIL\b|PROJECT DIAGNOSTICS[\s\S]*\bFAIL\b|Validation:\s*[\s\S]*?\bFAIL\b/i.test(content)) {
    const failedCommand =
      content.match(/FAIL\s+([^\n]+)/i)?.[1]?.trim() ||
      content.match(/failures in ([^:\n]+)/i)?.[1]?.trim() ||
      "the failing validation command";
    actions.push({
      label: /build/i.test(failedCommand) ? "Fix build failure" : "Fix validation failure",
      prompt: `Investigate and fix ${failedCommand}. Use the failure output from the previous response, inspect the exact affected files, prepare a safe patch preview, and run validation again.`,
    });
    actions.push({
      label: "Explain failure",
      prompt: `Explain why ${failedCommand} failed, whether it is related to the last patch, and what exact file(s) need attention.`,
    });
  }

  if (/VALIDATION RESULT|SANDBOX CHECKS|PROJECT DIAGNOSTICS|build failed|compile failed|Configure failed|CONFIGURE FAILED/i.test(content)) {
    actions.push({
      label: "Check for more errors",
      prompt:
        "Check the connected project for remaining IDE, build, compile, dependency, lint, and runtime-startup errors. Run the right validation checks, inspect exact files, and prepare the next safe patch if a concrete issue remains.",
    });
    actions.push({
      label: "Exact next steps",
      prompt:
        "Tell me exactly what to do next in my IDE for this project. Include menu clicks, files to open, commands to run, expected result, and what screenshot/error to send back if it fails.",
    });
  }

  if (/mavenLocal\(\)|mvn install:install-file|local Maven repo|local Maven repository|manually installed artifacts|Maven-local workaround/i.test(content)) {
    actions.push({
      label: "Prepare Maven local fallback",
      displayPrompt: "Prepare Maven local fallback",
      prompt:
        "Prepare the Maven local fallback for the current Gradle blocker. Do not replay Android app setup steps. Patch the connected Gradle project to prefer mavenLocal() where safe, inspect attached/local artifact folders for the required .pom/.jar/.aar files, and tell me exactly what was changed or what artifact files are still missing before validation.",
    });
  }

  actions.push(...environmentBlockerActions(content, actions));

  const commandExecutionAction = projectCommandExecutionAction(content, actions);
  if (commandExecutionAction) {
    actions.push(commandExecutionAction);
  }

  const executionAction = actionableAgentExecutionAction(content, actions);
  if (executionAction) {
    actions.push(executionAction);
  }

  if (patchReady) {
    actions.push({
      label: "Apply verified patch",
      prompt:
        "Apply the verified patch for the current Agent result, then run the right project validation checks for this language and report the exact result plus undo details.",
      kind: "applyVerifiedPatch",
    });
    actions.push({
      label: "Run validation",
      prompt:
        "Run the right validation checks for this project and language, including type checking, linting, build, compile, or static analysis where available. Report warnings and errors with exact files.",
      kind: "runValidation",
    });
    actions.push({
      label: "Explain patch",
      prompt: "Review the patch preview and explain exactly what it will change, what risk it has, and how to validate it.",
    });
  }

  const shadeOptions = [...content.matchAll(/\b(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g)]
    .map((match) => match[0])
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 6);
  for (const shade of shadeOptions) {
    actions.push({
      label: `Use ${shade}`,
      prompt: `Update the current patch to use ${shade} for the relevant surface, then validate the focused file and show the changed lines.`,
    });
  }

  const suggestionSentence =
    content.match(/I can iterate to ([^.]+)\./i)?.[1] ||
    content.match(/(?:options?|try|choose|different lightness)[^.\n]*?((?:[a-z]+-\d{2,3}(?:\s*\/\s*|\s*,\s*|\s+or\s+)?)+)/i)?.[1] ||
    "";
  if (suggestionSentence && !shadeOptions.length) {
    suggestionSentence
      .split(/\s*\/\s*|\s*,\s*|\s+or\s+/i)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4)
      .forEach((option) => {
        actions.push({
          label: option.length > 22 ? option.slice(0, 22) : option,
          prompt: `Apply this suggested option to the current patch: ${option}. Validate the focused file and show changed lines.`,
        });
      });
  }

  if (dependency) {
    actions.push({
      label: "Handle dependency",
      prompt: `Install the missing package ${dependency} only if it is still required, then validate the project and report the exact result.`,
    });
  }

  actions.push(...labeledChoiceActions(content, actions));

  for (const match of validationPlan.matchAll(/^\s*-\s+(.+)$/gm)) {
    const action = match[1]?.trim();
    if (action && !/no patch was prepared/i.test(action)) {
      const isApplyAction = /^(?:review\/apply|apply)\b/i.test(action) && /patch|preview|source|config/i.test(action);
      const isValidationAction =
        /^(?:run\s+)?(?:project\s+)?(?:validation|checks?)\b/i.test(action) ||
        /^run\s+(?:npm|node|pnpm|yarn|dotnet|cargo|go|python|pytest|mvn|gradle|composer|bundle)\b/i.test(action);

      if (isApplyAction) {
        if (patchReady) {
          actions.push({
            label: "Apply verified patch",
            prompt:
              "Apply the verified patch for the current Agent result, then run the right project validation checks for this language and report the exact result plus undo details.",
            kind: "applyVerifiedPatch",
          });
        }
        continue;
      }

      if (isValidationAction) {
        actions.push({
          label: "Run validation",
          prompt:
            "Run the right validation checks for this project and language, including type checking, linting, build, compile, or static analysis where available. Report warnings and errors with exact files.",
          kind: "runValidation",
        });
        continue;
      }

      if (!/^(?:fix|investigate|explain)\b/i.test(action)) continue;
      actions.push({
        label: action.length > 38 ? `${action.slice(0, 35)}...` : action,
        prompt: action,
      });
    }
  }

  if (/No automatic patch is ready|No safe patch was prepared|No verified patch/i.test(content) && /FAIL|error|broken|blocked/i.test(content)) {
    actions.push({
      label: "Continue fixing",
      prompt:
        "Continue from the current failure. Use the latest validation output and inspected files, identify the next concrete blocker, prepare a safe patch preview if possible, and keep the answer short.",
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
    .slice(0, 3);
}

function contextPreview(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  const preview = lines.slice(0, 10).join("\n");
  return preview.length > 1200 ? `${preview.slice(0, 1200)}...` : preview;
}

function splitAgentUserContent(content: string) {
  const [request, setupContext = ""] = content.split(/\n\nPROJECT SETUP CONTEXT:\n/i);

  return {
    request: compactAgentDisplayText(request || content),
    setupContext: compactAgentDisplayText(setupContext),
  };
}

function requestPreviewForWorkingState(prompt: string) {
  const { request } = splitAgentUserContent(prompt);
  const firstParagraph = request.split(/\n\s*\n/)[0]?.trim() || request;
  return firstParagraph.length > 220 ? `${firstParagraph.slice(0, 220).trim()}...` : firstParagraph;
}

function hasActionableScriptOrPackageInstruction(content: string) {
  return (
    /```[\s\S]*?(?:npm|pnpm|yarn|mvn|gradle|gradlew|pip|python|dotnet|cargo|go\s+|composer|bundle|keytool|powershell|cmd|bash|sh|install|dependency|package|create file|add file|build\.gradle|package\.json)[\s\S]*?```/i.test(
      content,
    ) ||
    /^\s*(?:npm|pnpm|yarn|mvn|gradle|\.\/gradlew|gradlew\.bat|pip|python|dotnet|cargo|go|composer|bundle|keytool)\s+\S+/im.test(
      content,
    ) ||
    /\b(?:install|add|update|wire|copy|create)\b[\s\S]{0,120}\b(?:package|dependency|script|file|folder|artifact|SDK|jar|aar|pom|build\.gradle|package\.json|requirements\.txt|pyproject\.toml)\b/i.test(
      content,
    )
  );
}

function hasActionLabel(actions: AgentAction[], label: string) {
  return actions.some((action) => action.label.toLowerCase() === label.toLowerCase());
}

function labeledChoiceActions(content: string, actions: AgentAction[]): AgentAction[] {
  if (!/\bChoose one\b/i.test(content)) return [];

  const matches = [...content.matchAll(/(?:^|\n)\s*([A-E])[\).:\s-]+([\s\S]+?)(?=\n\s*[A-E][\).:\s-]+|\n\s*Show raw Agent message\b|$)/gi)];
  const choiceActions: AgentAction[] = [];

  for (const match of matches) {
      const letter = (match[1] || "").toUpperCase();
      const option = compactAgentDisplayText(match[2] || "")
        .split(/\n/)[0]
        .replace(/\s+/g, " ")
        .trim();
      if (!letter || option.length < 3) continue;

      const labelText = `${letter}. ${option}`;
      choiceActions.push({
        label: labelText.length > 36 ? `${labelText.slice(0, 33).trim()}...` : labelText,
        displayPrompt: labelText,
        prompt: letter,
      });
  }

  return choiceActions
    .filter((action) => !hasActionLabel(actions, action.label))
    .slice(0, 4);
}

function environmentBlockerActions(content: string, actions: AgentAction[]): AgentAction[] {
  const detectedActions: AgentAction[] = [];
  const hasGradleTrustBlocker =
    /\b(?:PKIX|certificate_unknown|SSL handshake|truststore|cacerts|JBR|JDK|Gradle(?:\s+\w+){0,4}\s+trust|repo\.maven|maven\.google|dl\.google|certificate chain)\b/i.test(
      content,
    ) && /\b(?:Gradle|Maven|dependency|dependencies|download|repository|repositories|validation|build)\b/i.test(content);
  const hasOfflineFallback =
    /\b(?:mavenLocal\(\)|maven local|offline fallback|offline artifact|local artifacts?|local Maven|\.pom|\.jar|\.aar|avoid remote downloads?|without network)\b/i.test(
      content,
    );

  if (hasGradleTrustBlocker && !hasActionLabel(actions, "Run trust check")) {
    detectedActions.push({
      label: "Run trust check",
      displayPrompt: "Run trust check",
      prompt:
        "Run the supported local checks for the current Gradle/JDK certificate blocker. Use the connected project and latest validation output. Verify which JDK/JBR Gradle is using if the local agent can detect it, check whether the truststore problem is still present, and report the exact commands tried plus the next concrete blocker. Do not compare logs or replay app setup steps.",
    });
  }

  if (hasGradleTrustBlocker && !hasActionLabel(actions, "Prepare cert fix")) {
    detectedActions.push({
      label: "Prepare cert fix",
      displayPrompt: "Prepare cert fix",
      prompt:
        "Prepare the safest certificate/JDK trust fix for the current Gradle dependency blocker. Use the latest validation evidence and connected project. If a certificate file is attached, produce the exact keytool command for the JDK/JBR Gradle uses; if no certificate file is attached, say exactly what file or admin permission is missing. Do not edit unrelated source files.",
    });
  }

  if ((hasGradleTrustBlocker || hasOfflineFallback) && !hasActionLabel(actions, "Prepare offline fallback")) {
    detectedActions.push({
      label: "Prepare offline fallback",
      displayPrompt: "Prepare offline fallback",
      prompt:
        "Prepare a Maven/local-artifact fallback for the current dependency download blocker. Inspect the connected build files and any attached or selected artifact folders for matching .pom/.jar/.aar files. Patch repository order only if safe and useful, list exact missing artifacts if not enough files are present, and run validation if a patch is applied.",
    });
  }

  return detectedActions;
}

function projectCommandExecutionAction(content: string, actions: AgentAction[]): AgentAction | null {
  if (hasActionLabel(actions, "Run Gradle validation") || hasActionLabel(actions, "Run project commands")) return null;

  if (/\b(?:gradlew(?:\.bat)?|gradle)\s+(?:--stop|build|test|check|assemble\w*|clean|dependencies|tasks)\b/i.test(content)) {
    return {
      label: "Run Gradle validation",
      displayPrompt: "Run Gradle validation",
      prompt:
        "Run the supported Gradle/build validation commands for the connected project through the local agent. Use the latest failure/output as context, do not replay setup instructions, report exactly which command(s) ran, exit status, important output, and whether the blocker is project code or environment/tooling.",
    };
  }

  if (/\b(?:npm|pnpm|yarn|mvn|dotnet|cargo|pytest|python -m|go test|composer|bundle)\s+(?:run\s+)?(?:test|build|check|lint|typecheck|install|restore|verify)\b/i.test(content)) {
    return {
      label: "Run project commands",
      displayPrompt: "Run project commands",
      prompt:
        "Run the supported project validation/build/test commands from the previous answer through the local agent. Inspect the project manager first, avoid unrelated commands, report commands, exit status, important output, and the next concrete fix if any command fails.",
    };
  }

  return null;
}

function actionableAgentExecutionAction(content: string, actions: AgentAction[]): AgentAction | null {
  if (!hasActionableScriptOrPackageInstruction(content)) return null;

  const lower = content.toLowerCase();
  const hasMavenLocalAction = hasActionLabel(actions, "Prepare Maven local fallback");

  if (/\b(keytool|cacerts|truststore|certificate|cert|company-root|corporate-root|root ca|pkix|ssl handshake)\b/i.test(content)) {
    if (hasActionLabel(actions, "Prepare cert fix")) return null;
    return {
      label: "Prepare cert fix",
      displayPrompt: "Prepare cert fix",
      prompt:
        "Prepare the certificate/JDK trust fix for the current Gradle SSL blocker. Use the connected project and latest evidence. Do not repeat a full app checklist. Identify the exact JDK/JBR Gradle is using, prepare the safest cert-import or proxy/whitelist steps, apply only safe project config such as disabling configuration cache if useful, run validation if possible, and clearly say what cannot be done without the certificate file or admin approval.",
    };
  }

  if (/\bmavenlocal\(\)|mvn install:install-file|local maven|local repository|local repo|manually installed artifacts?\b/i.test(content)) {
    return hasMavenLocalAction
      ? null
      : {
          label: "Prepare Maven local fallback",
          displayPrompt: "Prepare Maven local fallback",
          prompt:
            "Prepare the Maven local fallback for the current dependency/download blocker. Patch the connected build files to prefer mavenLocal() where safe, inspect available local artifact folders for matching .pom/.jar/.aar files, run validation if possible, and report exactly which artifacts are still missing.",
        };
  }

  if (/\b(--offline|offline build|gradle cache|cached artifacts?|avoid network|without network)\b/i.test(content)) {
    if (hasActionLabel(actions, "Prepare offline fallback")) return null;
    return {
      label: "Prepare offline fallback",
      displayPrompt: "Prepare offline fallback",
      prompt:
        "Prepare the offline/local-cache fallback for the current dependency blocker. Inspect the connected project and Gradle cache/artifact references that are available to the local agent, make only safe config changes, run the best validation available, and explain exactly what still requires missing cached artifacts or network access.",
    };
  }

  if (/\b(gradle\.properties|configuration-cache|repositories\s*\{|settings\.gradle|build\.gradle)\b/i.test(content)) {
    if (hasActionLabel(actions, "Patch build config")) return null;
    return {
      label: "Patch build config",
      displayPrompt: "Patch build config",
      prompt:
        "Apply the safe build-configuration changes from the previous answer to the connected project. Inspect the relevant Gradle/build files first, avoid unrelated rebuilds, show the changed lines, and run validation if possible.",
    };
  }

  if (/\b(install|add|update)\b/.test(lower) && /\b(package|dependency|dependencies|npm|pnpm|yarn|pip|dotnet|cargo|composer|bundle|go\s+get)\b/i.test(content)) {
    if (hasActionLabel(actions, "Install dependencies")) return null;
    return {
      label: "Install dependencies",
      displayPrompt: "Install dependencies",
      prompt:
        "Install or wire the dependencies described in the previous answer for the connected project. Inspect the project manager first, request/perform only the needed install steps, update lock/config files as appropriate, run validation, and report exact results.",
    };
  }

  if (/\b(create|add|copy|wire)\b/i.test(content) && /\b(file|folder|script|sdk|artifact|jar|aar|pom|bridge|source)\b/i.test(content)) {
    if (hasActionLabel(actions, "Apply file setup")) return null;
    return {
      label: "Apply file setup",
      displayPrompt: "Apply file setup",
      prompt:
        "Apply the file/setup work described in the previous answer to the connected project. Inspect the current tree first, create/copy/wire only the necessary files, keep a reviewable change summary, and run validation if possible.",
    };
  }

  if (hasActionLabel(actions, "Run with Agent")) return null;
  return {
    label: "Run with Agent",
    displayPrompt: "Run with Agent",
    prompt:
      "Carry out the actionable setup from the previous answer using the connected project. Do not just repeat the instructions. Inspect the project first, apply only safe file/config changes, run validation when possible, and report exactly what changed or what files/approval are still needed.",
  };
}

function workingCopyForPrompt(prompt: string, hasProject: boolean) {
  if (/explain .*root cause|root cause/i.test(prompt)) {
    return {
      message: "Explaining the root cause...",
      steps: ["Separate baseline", "Trace failure", "Write bottom line"],
    };
  }

  if (/compare .*logs?|side by side|first divergence|suspect-only/i.test(prompt)) {
    return {
      message: "Comparing failing vs working evidence...",
      steps: ["Align logs", "Find divergence", "Rank signals"],
    };
  }

  if (/payment trace|trace timeline|timeline/i.test(prompt)) {
    return {
      message: "Building payment trace...",
      steps: ["Device/SDK", "Gateway", "Final decision"],
    };
  }

  if (/build|create|generate|full app|full project|android studio|gradle|sdk|vendor|poslink|paxstore|from scratch/i.test(prompt)) {
    return {
      message: "Building the project plan...",
      steps: ["Inspect project", "Inspect SDKs", "Check dependencies", "Plan files", "Preview patch", "Validate"],
    };
  }

  if (/visual fix|contrast|spacing|overflow|css|style/i.test(prompt) && hasProject) {
    return {
      message: "Preparing visual fix investigation...",
      steps: ["Inspect UI", "Find CSS", "Preview patch"],
    };
  }

  if (/apply|patch|change|update|fix/i.test(prompt)) {
    return hasProject
      ? {
          message: "Preparing a code fix...",
          steps: ["Read files", "Build patch"],
        }
      : {
          message: "Reviewing the requested change...",
          steps: ["Read evidence", "Prepare answer"],
        };
  }

  if (/validate|lint|type|build|compile|test|check|error|warning/i.test(prompt)) {
    return {
      message: "Running validation...",
      steps: ["Run checks", "Read output"],
    };
  }

  if (/audit|deeper|inspect|why|wrong|bug|risk/i.test(prompt)) {
    return {
      message: "Auditing the project...",
      steps: ["Read files", "Find proof"],
    };
  }

  if (/install|dependency|package/i.test(prompt)) {
    return {
      message: "Checking dependencies...",
      steps: ["Read imports", "Check package"],
    };
  }

  return hasProject
    ? {
        message: "Investigating the project...",
        steps: ["Select files", "Read evidence"],
      }
    : {
        message: "Investigating evidence...",
        steps: ["Read evidence", "Prepare review"],
      };
}

function workingCopyForMessage(content: string) {
  const normalized = content.replace(/^PayFix Agent is\s+/i, "");

  if (/explaining .*root cause|root cause/i.test(normalized)) {
    return ["Separate evidence", "Explain cause", "Bottom line"];
  }

  if (/comparing|side-by-side|baseline|failing|divergence/i.test(normalized)) {
    return ["Align logs", "Find divergence", "Rank signals"];
  }

  if (/payment trace|trace timeline|timeline/i.test(normalized)) {
    return ["Device/SDK", "Gateway", "Final decision"];
  }

  if (/reusing|previously inspected|active target/i.test(normalized)) {
    return ["Use prior files", "Patch target"];
  }

  if (/diagnostics|warnings|errors/i.test(normalized)) {
    return ["Run checks", "Read output"];
  }

  if (/evidence-only|uploaded|pasted|logs?|declines?|response codes?|TLV|payment signals/i.test(normalized)) {
    return ["Scan logs", "Find signals", "Prepare review"];
  }

  if (/preparing a focused patch|focused patch|inspected file/i.test(normalized)) {
    return ["Create diff", "Validate"];
  }

  if (/previewing/i.test(normalized)) {
    return ["Build preview", "Compare diff"];
  }

  if (/dry-running|temporarily applying|validation/i.test(normalized)) {
    return ["Dry run", "Validate"];
  }

  if (/applying|patch|change|update|fix/i.test(normalized)) {
    return ["Read files", "Patch"];
  }

  if (/validation|diagnostic|warning|error|lint|type|build|compile|test|check/i.test(normalized)) {
    return ["Run checks", "Report"];
  }

  if (/audit|behavior|wrong|bug|risk/i.test(normalized)) {
    return ["Inspect", "List proof"];
  }

  if (/dependency|install|package/i.test(normalized)) {
    return ["Check imports", "Package"];
  }

  return ["Read evidence", "Prepare"];
}

export default function AgentSessionModal({
  messages,
  loading,
  status,
  connectedProjectPath,
  initialDraft = "",
  setupOpenRevision = 0,
  uploads,
  dependencyProposal,
  dependencyInstalling = false,
  onClose,
  onSend,
  onSendToRegularChat,
  onConnectProjectPath,
  onUpload,
  onRemoveUpload,
  onEditMessage,
  onCancelEdit,
  canApplyVerifiedPatch,
  onApplyVerifiedPatch,
  onInstallDependency,
  onRunValidation,
  rollbackTarget,
  rollbackLoading = false,
  onRollbackLastApply,
}: AgentSessionModalProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [expandedContexts, setExpandedContexts] = useState<Set<string>>(new Set());
  const [expandedAgentResponses, setExpandedAgentResponses] = useState<Set<number>>(new Set());
  const [pendingActionPrompt, setPendingActionPrompt] = useState("");
  const [pendingActionDisplayPrompt, setPendingActionDisplayPrompt] = useState("");
  const [editingMessage, setEditingMessage] = useState(false);
  const [setupPanelOpen, setSetupPanelOpen] = useState(Boolean(initialDraft || setupOpenRevision > 0));
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [sendingDraft, setSendingDraft] = useState(false);
  const [previewUpload, setPreviewUpload] = useState<UploadedFile | null>(null);
  const [agentProjectPath, setAgentProjectPath] = useState(connectedProjectPath);
  const [agentSdkPaths, setAgentSdkPaths] = useState("");
  const [agentIdeTarget, setAgentIdeTarget] = useState(IDE_TARGET_OPTIONS[0]);
  const [projectConnectError, setProjectConnectError] = useState("");
  const [sdkFolderError, setSdkFolderError] = useState("");
  const [projectConnecting, setProjectConnecting] = useState(false);
  const [folderBrowser, setFolderBrowser] = useState<FolderBrowserState>({
    open: false,
    target: "project",
    title: "Choose folder",
    currentPath: "",
    parentPath: "",
    roots: [],
    folders: [],
    selectedPath: "",
    selectedPaths: [],
    query: "",
    sort: "recent",
    loading: false,
    error: "",
  });
  const [builderParentPath, setBuilderParentPath] = useState(() => parentPathFromProjectPath(connectedProjectPath));
  const [builderFolderName, setBuilderFolderName] = useState("");
  const [builderStack, setBuilderStack] = useState(PROJECT_STACK_OPTIONS[0]);
  const [builderError, setBuilderError] = useState("");
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const agentEndRef = useRef<HTMLDivElement | null>(null);
  const agentScrollRef = useRef<HTMLDivElement | null>(null);
  const hasProject = Boolean(connectedProjectPath);
  const visibleMessages = useMemo(() => visibleAgentMessageItems(messages), [messages]);
  const isProjectBuilder = messages.some((message) => /^PROJECT CREATION BRIEF:/i.test(message.content));
  const generatedProjectPath = generatedProjectPathFromMessages(messages);
  const generatedProjectDeleted = latestGeneratedProjectWasDeleted(messages);
  const modeLabel = isProjectBuilder ? "Project builder" : hasProject ? "Engineering mode" : "Action mode";
  const title = isProjectBuilder ? "Create App From Sketch" : hasProject ? "Project Investigation" : "Agent Workspace";
  const visibleFolderEntries = folderBrowser.folders
    .filter((folder) => {
      const query = folderBrowser.query.trim().toLowerCase();
      return !query || folder.name.toLowerCase().includes(query) || folder.path.toLowerCase().includes(query);
    })
    .sort((left, right) => {
      if (folderBrowser.sort === "recent") {
        return new Date(right.modifiedAt || 0).getTime() - new Date(left.modifiedAt || 0).getTime();
      }
      return left.name.localeCompare(right.name);
    });
  const dependencyNames = dependencyProposal?.packageNames?.length
    ? dependencyProposal.packageNames
    : dependencyProposal?.packageName
      ? [dependencyProposal.packageName]
      : [];
  const dependencyLabel = dependencyNames.join(", ");
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  const latestAssistantAlreadyApplied = Boolean(
    latestAssistantMessage?.patchAlreadyApplied ||
      /PATCH APPLIED BY AGENT|PATCH ALREADY APPLIED|PayFix already wrote this change/i.test(latestAssistantMessage?.content || ""),
  );
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const latestUserContent = latestUserMessage ? splitAgentUserContent(latestUserMessage.content) : null;
  const latestUserUploads = latestUserMessage?.attachedUploads || [];
  const suppressEvidenceActionsForCommandFollowUp = latestAssistantMessage
    ? shouldSuppressGenericActionButtonsForTurn(latestUserContent?.request || "", latestAssistantMessage.content)
    : false;
  const bottomActions = latestAssistantMessage
    ? (suppressEvidenceActionsForCommandFollowUp ? [] : agentActionPrompts(latestAssistantMessage.content)).filter(
        (action) =>
          (action.kind !== "applyVerifiedPatch" || (canApplyVerifiedPatch && !latestAssistantAlreadyApplied)) &&
          (!latestAssistantAlreadyApplied || action.kind !== "installDependency"),
      )
    : [];
  const primaryBottomAction =
    bottomActions.find((action) => /apply|retry/i.test(action.label)) || bottomActions[0] || null;
  const previousMessageCountRef = useRef(messages.length);
  const latestMessage = messages.at(-1);
  const latestMessageScrollKey = `${messages.length}:${latestMessage?.role || ""}:${latestMessage?.content.slice(0, 160) || ""}`;
  const canSubmitDraft = Boolean(draft.trim() || uploads.length);

  useEffect(() => {
    if (!loading) setSendingDraft(false);
  }, [loading]);

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;
    if (messages.length < previousCount) return;

    const container = agentScrollRef.current;
    const scrollToLatest = () => {
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        return;
      }
      agentEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    };

    window.requestAnimationFrame(scrollToLatest);
    window.setTimeout(scrollToLatest, 120);
  }, [latestMessageScrollKey, messages.length]);

  function updateJumpToBottomVisibility() {
    const container = agentScrollRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowJumpToBottom(container.scrollTop > 120 && distanceFromBottom > 80);
  }

  function jumpToBottom() {
    agentEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  useEffect(() => {
    updateJumpToBottomVisibility();
  }, [messages.length, loading]);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return false;
    setUploadingFiles(true);
    try {
      await onUpload(files);
      return true;
    } finally {
      setUploadingFiles(false);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (event.clipboardData.files.length) {
      event.preventDefault();
      void uploadFiles(event.clipboardData.files);
    }
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDraggingFiles(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDraggingFiles(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDraggingFiles(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    setDraggingFiles(false);
    void uploadFiles(event.dataTransfer.files);
  }

  async function sendDraft() {
    const prompt = draft.trim() || promptForUploadedEvidence(uploads);
    if (!prompt || loading || uploadingFiles || sendingDraft) return;
    setSendingDraft(true);
    const setupLines = [
      agentIdeTarget && agentIdeTarget !== IDE_TARGET_OPTIONS[0] ? `Preferred IDE/build target: ${agentIdeTarget}` : "",
      agentSdkPaths.trim() ? `Vendor SDK / local artifacts folders:\n${agentSdkPaths.trim()}` : "",
    ].filter(Boolean);
    const promptWithSetup = setupLines.length
      ? `${prompt}\n\nPROJECT SETUP CONTEXT:\n${setupLines.map((line) => `- ${line}`).join("\n")}\n- If the project files reveal a different IDE/build system, prefer the detected project structure and explain the mismatch.`
      : prompt;
    setDraft("");
    setPendingActionPrompt(promptWithSetup);
    setPendingActionDisplayPrompt("");
    const accepted = await onSend(promptWithSetup);
    if (!accepted) {
      setPendingActionPrompt("");
      setPendingActionDisplayPrompt("");
      setSendingDraft(false);
    } else {
      setEditingMessage(false);
      setSetupPanelOpen(false);
    }
  }

  async function connectProjectFromModal() {
    const path = agentProjectPath.trim();
    if (!path || projectConnecting) {
      setProjectConnectError("Paste the project folder path first.");
      return;
    }

    setProjectConnectError("");
    setProjectConnecting(true);
    const connected = await onConnectProjectPath(path);
    setProjectConnecting(false);

    if (!connected) {
      setProjectConnectError("Could not connect that folder. Check the path and make sure the local agent is running.");
    }
  }

  async function loadFolderBrowser(target: FolderBrowserTarget, targetPath = "") {
    setFolderBrowser((current) => ({
      ...current,
      target,
      loading: true,
      error: "",
      ...(targetPath ? { currentPath: targetPath } : {}),
    }));

    try {
      const response = await fetch("/api/local-agent/app/browse-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath }),
      });
      const data = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            currentPath?: string;
            parentPath?: string;
            roots?: string[];
            folders?: FolderBrowserEntry[];
            error?: string;
          }
        | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not browse folders. Restart payfix-agent or paste the path manually.");
      }
      setFolderBrowser((current) => ({
        ...current,
        loading: false,
        error: "",
        currentPath: data.currentPath || targetPath,
        parentPath: data.parentPath || "",
        roots: data.roots || [],
        folders: data.folders || [],
        selectedPath: target === "project" ? data.currentPath || targetPath : "",
      }));
    } catch (error: unknown) {
      setFolderBrowser((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Could not browse folders.",
      }));
    }
  }

  function openFolderBrowser(target: FolderBrowserTarget) {
    const fallbackPath = target === "project" ? agentProjectPath.trim() : "";
    setProjectConnectError("");
    setSdkFolderError("");
    setFolderBrowser((current) => ({
      ...current,
      open: true,
      target,
      title: target === "project" ? "Choose project root folder" : "Choose SDK / artifacts folder",
      query: "",
      sort: "recent",
      selectedPath: fallbackPath,
      selectedPaths: target === "sdk" ? [] : [],
      error: "",
    }));
    void loadFolderBrowser(target, fallbackPath);
  }

  function closeFolderBrowser() {
    setFolderBrowser((current) => ({ ...current, open: false, error: "" }));
  }

  function useFolderBrowserSelection() {
    if (folderBrowser.target === "project") {
      const selectedPath = folderBrowser.selectedPath || folderBrowser.currentPath;
      if (!selectedPath) return;
      setAgentProjectPath(selectedPath);
      setProjectConnectError("");
    } else {
      const paths = folderBrowser.selectedPaths.length
        ? folderBrowser.selectedPaths
        : folderBrowser.selectedPath
          ? [folderBrowser.selectedPath]
          : [];
      if (!paths.length) return;
      setAgentSdkPaths((current) => {
        const existing = current
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        return [...new Set([...existing, ...paths])].join("\n");
      });
      setSdkFolderError("");
    }

    closeFolderBrowser();
  }

  function createProjectFromBuilder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parentPath = builderParentPath.trim();

    if (!parentPath) {
      setBuilderError("Add the target parent path first.");
      return;
    }

    const folderName = builderFolderName.trim();
    const prompt = `CREATE PROJECT FROM GENERATED SKETCH

Target parent path:
${parentPath}

Folder name:
${folderName || "(auto-generate a clean folder name from the sketch and app concept)"}

Preferred stack:
${builderStack}

Requirements:
- Create the folder under the target parent path.
- If folder name is blank, choose a clean kebab-case name.
- Create all files needed for a runnable app from scratch.
- Use the attached generated sketch/design image and source brief as the product direction.
- Return the exact path, files created, and run commands.
- Do not ask another setup question unless the target path is invalid or inaccessible.`;

    setBuilderError("");
    setPendingActionPrompt(prompt);
    setPendingActionDisplayPrompt("");
    void onSend(prompt);
  }

  async function runAction(action: AgentAction) {
    if (loading || dependencyInstalling) return;
    setPendingActionPrompt(action.prompt);
    setPendingActionDisplayPrompt(action.displayPrompt || action.label);

    if (action.kind === "applyVerifiedPatch") {
      onApplyVerifiedPatch();
      return;
    }

    if (action.kind === "installDependency") {
      onInstallDependency();
      return;
    }

    if (action.kind === "runValidation") {
      onRunValidation();
      return;
    }

    const accepted = await onSend(action.prompt);
    if (!accepted) {
      setPendingActionPrompt("");
      setPendingActionDisplayPrompt("");
    }
  }

  function editUserMessage(message: ChatMessage, index: number) {
    if (message.role !== "user" || loading) return;
    setDraft(message.content);
    setEditingMessage(true);
    setPendingActionPrompt("");
    setPendingActionDisplayPrompt("");
    onEditMessage(index);
  }

  function cancelEdit() {
    setDraft("");
    setEditingMessage(false);
    setPendingActionPrompt("");
    onCancelEdit?.();
  }

  return (
    <div className="fixed inset-0 z-[280] flex items-start justify-center bg-slate-950/65 p-5 backdrop-blur-sm">
      <div className="mt-3 flex h-[93vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-br from-white via-white to-blue-50 px-6 py-5">
          <button
            type="button"
            onClick={() => setSetupPanelOpen(true)}
            disabled={setupPanelOpen}
            className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
            title="Back to project and SDK setup"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-blue-600">
              <Bot size={16} />
                Investigation Workspace / {modeLabel}
              </div>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{title}</h2>
            <p className="mt-1 truncate text-sm text-slate-500">
              {connectedProjectPath || "Use Regular Chat for simple image/log reading. Use Agent for project work, generated apps, or specialized actions."}
            </p>
          </div>

          <button
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
            title="Close investigation workspace"
          >
            <X size={20} />
          </button>
        </div>

        <div className="border-b border-slate-200 bg-slate-50/90 px-6 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 ring-1 ring-blue-100">
              {connectedProjectPath ? "Reads exact files" : "Action-only"}
            </span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
              {connectedProjectPath ? "Validates before apply" : "Routes simple analysis to chat"}
            </span>
            <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-black text-purple-700 ring-1 ring-purple-100">
              {connectedProjectPath ? "Review required" : "No file writes"}
            </span>
            {status && <span className="ml-auto truncate text-xs font-bold text-slate-500">{status}</span>}
          </div>
        </div>

        <div
          ref={agentScrollRef}
          onScroll={updateJumpToBottomVisibility}
          className="relative min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f3f7fb_0%,#edf2f7_100%)] px-6 py-4"
        >
          <div className="space-y-3">
            {latestUserContent ? (
              <div className="rounded-2xl border border-sky-400/25 bg-slate-950 p-3 text-slate-100 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-sky-200">
                      <span className="h-2 w-2 rounded-full bg-sky-500" />
                      Latest request
                    </div>
                    <div className="max-h-20 overflow-hidden whitespace-pre-wrap break-words text-sm font-bold leading-5 text-slate-100">
                      {requestPreviewForWorkingState(latestUserContent.request)}
                    </div>
                  </div>
                  {latestUserUploads.length ? (
                    <div className="flex max-w-full flex-wrap justify-end gap-1.5">
                      {latestUserUploads.slice(0, 3).map((file, index) => (
                        <span
                          key={`${file.name}-${index}`}
                          className="inline-flex max-w-44 items-center gap-1.5 truncate rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-slate-100 ring-1 ring-white/10"
                          title={file.name}
                        >
                          <FileText size={12} />
                          <span className="truncate">{file.isImage ? "Image" : "File"} {index + 1}</span>
                        </span>
                      ))}
                      {latestUserUploads.length > 3 ? (
                        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-slate-100 ring-1 ring-white/10">
                          +{latestUserUploads.length - 3}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {setupPanelOpen && (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-blue-100/70">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-blue-700">
                      <FolderOpen size={15} />
                      Build setup
                    </div>
                    <div className="mt-1 text-lg font-black text-slate-950">
                      Tell PayFix where to build and which SDK folders it can inspect
                    </div>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                      Works with VS Code, Visual Studio, Android Studio, IntelliJ/Rider, Eclipse, Xcode exports, and plain folders.
                      Pick the project root, add any extracted SDK/artifact folders, then run the Agent.
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                    IDE-agnostic
                  </span>
                </div>
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3">
                    <div className="text-sm font-black text-slate-950">1. Project root</div>
                    <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-500">
                      Choose the folder that contains files like package.json, .sln, build.gradle, pom.xml, pyproject.toml, or src/.
                    </p>
                  </div>
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.2fr_0.8fr_auto]">
                  <label className="min-w-0">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">Root folder path</span>
                    <div className="flex gap-2">
                      <input
                        value={agentProjectPath}
                        onChange={(event) => {
                          setAgentProjectPath(event.target.value);
                          setProjectConnectError("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void connectProjectFromModal();
                          }
                        }}
                        placeholder="C:\\Users\\mekstein\\source\\repos\\my-app"
                        className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                      />
                      <button
                        type="button"
                        onClick={() => openFolderBrowser("project")}
                        disabled={projectConnecting}
                        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                        title="Browse project folders with search and modified dates"
                      >
                        <Upload size={16} />
                        Browse
                      </button>
                    </div>
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">Preferred IDE</span>
                    <select
                      value={agentIdeTarget}
                      onChange={(event) => setAgentIdeTarget(event.target.value)}
                      className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-black text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                    >
                      {IDE_TARGET_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void connectProjectFromModal()}
                    disabled={projectConnecting || !agentProjectPath.trim()}
                    className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300 lg:mt-5"
                  >
                    {projectConnecting ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                    {projectConnecting ? "Connecting..." : connectedProjectPath ? "Update folder" : "Connect folder"}
                  </button>
                </div>
                {projectConnectError && (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{projectConnectError}</div>
                )}
                </div>
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-slate-950">2. SDK / artifact folders</div>
                      <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-500">
                        Add one extracted SDK folder per line. PayFix will inspect docs, samples, AAR/JAR/AIDL files, and copy only what the project needs.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openFolderBrowser("sdk")}
                      className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                      title="Browse SDK folders with search and modified dates"
                    >
                      <Upload size={14} />
                      Add folder
                    </button>
                  </div>
                <label className="mt-3 block">
                  <span className="sr-only">
                    Vendor SDK / local artifacts folders (optional)
                  </span>
                  <textarea
                    value={agentSdkPaths}
                    onChange={(event) => {
                      setAgentSdkPaths(event.target.value);
                      setSdkFolderError("");
                    }}
                    placeholder={"One extracted folder per line:\nC:\\Users\\mekstein\\Downloads\\PAX-POSLink\nC:\\Users\\mekstein\\Downloads\\PAXSTORE-SDK\nC:\\vendor\\CardPointe-PosLink"}
                    rows={4}
                    className="w-full min-w-0 resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  />
                  <span className="mt-1 block text-xs font-semibold text-slate-500">
                    Use extracted SDK folders here, not zip files. Browse or add one path per line. Agent will inspect each folder for
                    AAR/JAR/AIDL/sample/docs, then copy/add only the needed libraries, folders, files, and setup notes.
                  </span>
                </label>
                {sdkFolderError && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">{sdkFolderError}</div>
                )}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
                  <div className="text-xs font-semibold leading-5 text-slate-600">
                    3. When this looks right, use the message box below and click Continue Investigation. PayFix will inspect the project and SDK folders before building or changing files.
                  </div>
                  <button
                    type="button"
                    onClick={() => setSetupPanelOpen(false)}
                    className="inline-flex h-9 items-center rounded-xl border border-blue-200 bg-white px-3 text-xs font-black text-blue-700 shadow-sm transition hover:bg-blue-50"
                  >
                    Hide setup
                  </button>
                </div>
              </div>
            )}

            {messages.length === 0 && (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
                <div className="text-lg font-black text-slate-950">
                  {hasProject
                    ? "Ask PayFix to investigate the connected project."
                    : "Agent mode is for engineering actions."}
                </div>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  {hasProject
                    ? "Use this for deeper debugging: build failures, suspicious behavior, patch requests, dependency issues, localhost inspection, and multi-file code changes."
                    : "Use Regular Chat to read screenshots, images, logs, TLV/EMV, gateway responses, or uploaded files. Use Agent when you need project files changed, validation run, dependencies installed, or a generated app created."}
                </p>
              </div>
            )}

            {visibleMessages.map(({ message, index }, visibleIndex) => (
              (() => {
                let view = message.role === "assistant" ? agentMessageView(message.content) : null;
                const previousUserMessage =
                  message.role === "assistant"
                    ? [...visibleMessages.slice(0, visibleIndex)].reverse().find((candidate) => candidate.message.role === "user")?.message
                    : null;
                const previousUserContent = previousUserMessage ? splitAgentUserContent(previousUserMessage.content) : null;
                const previousUserUploads =
                  previousUserMessage?.attachedUploads || [];
                if (view?.title === "Log comparison") {
                  const hasAnyImageUploads = previousUserUploads.some((file) => file.isImage);
                  const hasOnlyImageUploads = previousUserUploads.length > 0 && previousUserUploads.every((file) => file.isImage);
                  const previousUserRequest = previousUserContent?.request || "";
                  const hasCommandFollowUp = asksToRunReferencedCommandsText(previousUserRequest);
                  if (hasCommandFollowUp) {
                    view = {
                      title: "Command follow-up misrouted",
                      summary:
                        "This saved response is stale. Your request asked PayFix to run/check previous commands, but the old run treated the attachment as uploaded evidence.",
                      tone: "warning",
                      sections: [
                        {
                          label: "What should happen now",
                          body: connectedProjectPath
                            ? `PayFix should run validation/commands against the connected project, not compare logs.\n\nConnected project:\n${connectedProjectPath}\n\nSend the same request again after the latest restart.`
                            : "Connect the project folder in the Agent workspace, then send the same request again. PayFix needs the project connection before it can run commands.",
                        },
                      ],
                    };
                  }
                  const hasImageQuestion =
                    hasAnyImageUploads &&
                    Boolean(previousUserRequest) &&
                    /\b(what|where|which|custom|enter|click|screen|screenshot|image|settings|looks|good|right|wrong|this|these|those)\b/i.test(
                      previousUserRequest,
                    );
                  if (hasOnlyImageUploads || hasImageQuestion) {
                    view = {
                      ...view,
                      title: "Evidence review",
                      summary: "PayFix reviewed your current screenshots and follow-up context.",
                    };
                  }
                  const hasComparison = view.sections.some(
                    (section) => /side-by-side|what sticks out/i.test(section.label) && section.body.trim(),
                  );
                  const textUploads = previousUserUploads.filter((file) => !file.isImage);
                  const fallbackComparison = hasComparison || textUploads.length < 2 ? "" : fallbackComparisonFromUploads(textUploads);
                  if (fallbackComparison) {
                    view = {
                      ...view,
                      sections: [
                        { label: "Side-by-side logs", body: fallbackComparison },
                        ...view.sections.filter((section) => section.label !== "Side-by-side logs"),
                      ],
                    };
                  }
                  const hasUsefulEvidenceSection = view.sections.some(
                    (section) => !/^Inspected$/i.test(section.label) && section.body.trim(),
                  );
                  if (hasImageQuestion && !hasUsefulEvidenceSection) {
                    view = {
                      title: "Screenshot answer needed",
                      summary: "This was a screenshot follow-up, but the Agent returned a generic evidence summary instead of answering what is visible.",
                      tone: "warning",
                      sections: [
                        {
                          label: "What happened",
                          body:
                            "The current request included screenshot evidence, so PayFix should answer the visible UI question directly. Send the same screenshot follow-up again and it will now route through the screenshot reviewer instead of the log/evidence path.",
                        },
                      ],
                    };
                  }
                }
                const isProjectCreationBrief = message.role === "user" && /^PROJECT CREATION BRIEF:/i.test(message.content);
                const visibleUploads = isProjectBuilder
                  ? (message.attachedUploads || []).filter((file) => file.isImage)
                  : message.attachedUploads || [];
                const userContent = message.role === "user" ? splitAgentUserContent(message.content) : null;
                const nextMessage = messages[index + 1];
                const isActiveUserRequest =
                  message.role === "user" &&
                  loading &&
                  Boolean(nextMessage && nextMessage.role === "assistant" && isAgentWorkingMessage(nextMessage.content));
                const activeWorkingUploads =
                  message.role === "assistant" && isAgentWorkingMessage(message.content)
                    ? previousUserUploads
                    : [];
                const compactMessageText = compactAgentDisplayText(message.content);
                const responseLineCount = compactMessageText.split(/\r?\n/).filter(Boolean).length;
                const isLongAgentResponse =
                  message.role === "assistant" &&
                  !isAgentWorkingMessage(message.content) &&
                  !view &&
                  (compactMessageText.length > 1800 || responseLineCount > 22);
                const isAgentResponseExpanded = expandedAgentResponses.has(index);

                return (
              <article
                key={`${message.role}-${index}-${message.content.slice(0, 24)}`}
                className={`rounded-2xl p-3 shadow-sm ring-1 transition ${
                  message.role === "user"
                    ? isActiveUserRequest
                      ? "bg-[linear-gradient(135deg,rgba(14,165,233,0.2),rgba(15,23,42,0.98))] text-slate-50 ring-sky-300/45 shadow-sky-950/25"
                      : "bg-slate-950 text-slate-100 ring-sky-400/45"
                    : view?.tone === "success"
                      ? "border border-emerald-200 bg-white text-slate-950 ring-emerald-100"
                      : view?.tone === "warning"
                        ? "border border-amber-200 bg-white text-slate-950 ring-amber-100"
                        : "bg-white text-slate-950 ring-slate-200"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className={`text-xs font-black uppercase tracking-wide ${message.role === "user" ? "text-sky-200" : "text-slate-500"}`}>
                      {isActiveUserRequest ? "Current request" : roleLabel(message.role)}
                    </div>
                    {message.role === "user" && userContent?.setupContext ? (
                      <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-sky-100 ring-1 ring-white/10 sm:inline-flex">
                        Project context included
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {message.role === "user" && (
                      <button
                        type="button"
                        onClick={() => editUserMessage(message, index)}
                        disabled={loading}
                        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/10 px-2.5 text-[11px] font-black text-sky-100 shadow-sm ring-1 ring-white/10 transition hover:bg-sky-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        title="Edit this Agent message and clear the replies after it"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                    )}
                    {message.role === "assistant" && loading && visibleIndex === visibleMessages.length - 1 && (
                      <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                        <Loader2 size={13} className="animate-spin" />
                        Working
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className={`relative ${
                    isLongAgentResponse && !isAgentResponseExpanded
                      ? "max-h-[520px] overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-24 after:bg-gradient-to-t after:from-white after:to-transparent"
                      : ""
                  }`}
                >
                {message.role === "assistant" &&
                isAgentWorkingMessage(message.content) &&
                loading &&
                visibleIndex === visibleMessages.length - 1 ? (
                  <div className="overflow-hidden rounded-2xl bg-slate-950 text-slate-100 ring-1 ring-sky-400/20">
                    <div className="border-b border-white/10 bg-slate-900/80 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 text-sm font-black">
                          <Loader2 size={16} className="animate-spin text-blue-300" />
                          PayFix is working on this
                        </div>
                        <span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-black text-blue-100 ring-1 ring-blue-300/20">
                          Live
                        </span>
                      </div>
                      {pendingActionPrompt ? (
                        <div className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-[13px] font-semibold leading-5 text-slate-200 ring-1 ring-white/10">
                          {requestPreviewForWorkingState(pendingActionDisplayPrompt || pendingActionPrompt)}
                        </div>
                      ) : null}
                      {activeWorkingUploads.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {activeWorkingUploads.map((file, uploadIndex) => (
                            <span
                              key={`${file.name}-${uploadIndex}`}
                              className="inline-flex max-w-52 items-center gap-1.5 truncate rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-slate-100 ring-1 ring-white/10"
                              title={file.name}
                            >
                              <FileText size={12} />
                              <span className="truncate">
                                {file.isImage ? "Image" : "File"} {uploadIndex + 1}: {file.name}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="p-4">
                    <div className="flex items-center gap-3 text-[15px] font-black leading-6 text-slate-200">
                      <span className="h-2 w-2 rounded-full bg-blue-300 shadow-[0_0_18px_rgba(147,197,253,0.9)]" />
                      {message.content}
                    </div>
                    {message.agentProgress?.length ? (
                      <div className="mt-3 space-y-2">
                        {message.agentProgress.slice(-8).map((progress, progressIndex) => {
                          const isLatest = progressIndex === Math.min(message.agentProgress?.length || 0, 8) - 1;
                          return (
                            <div
                              key={`${progress.step}-${progress.at}-${progressIndex}`}
                              className={`flex items-start gap-3 rounded-xl px-3 py-2 text-xs ring-1 ${
                                isLatest
                                  ? "bg-blue-500/15 text-blue-100 ring-blue-400/30"
                                  : "bg-white/5 text-slate-300 ring-white/10"
                              }`}
                            >
                              <span
                                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                                  isLatest ? "bg-blue-300" : "bg-emerald-300"
                                }`}
                              />
                              <span className="min-w-0">
                                <span className="block font-black uppercase tracking-wide opacity-70">{progress.step}</span>
                                <span className="block text-[13.5px] font-semibold leading-5">{progress.message}</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-300 sm:grid-cols-3">
                        {workingCopyForMessage(message.content).map((step) => (
                          <span key={step} className="rounded-xl bg-white/5 px-3 py-2">{step}</span>
                        ))}
                      </div>
                    )}
                    </div>
                  </div>
                ) : view ? (
                  <div>
                    {previousUserContent ? (
                      <div className="mb-4 rounded-2xl border border-sky-300/20 bg-slate-950 px-4 py-3 text-slate-100 shadow-sm">
                        <div className="mb-1.5 text-xs font-black uppercase tracking-wide text-sky-200">Replying to your request</div>
                        <div className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[15.5px] font-semibold leading-6">
                          {requestPreviewForWorkingState(previousUserContent.request)}
                        </div>
                        {previousUserUploads.length ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {previousUserUploads.map((file, uploadIndex) => (
                              <span
                                key={`${file.name}-${uploadIndex}`}
                                className="inline-flex max-w-60 items-center gap-1.5 truncate rounded-full bg-white/10 px-3 py-1.5 text-xs font-black text-slate-100 ring-1 ring-white/10"
                                title={file.name}
                              >
                                <FileText size={12} />
                                <span className="truncate">
                                  {file.isImage ? "Image" : "File"} {uploadIndex + 1}: {file.name}
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[18px] font-black leading-6">{view.title}</div>
                        <p className="mt-1 max-w-3xl text-[14.5px] font-semibold leading-6 opacity-85">{view.summary}</p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          view.tone === "success"
                            ? "bg-emerald-100 text-emerald-800"
                            : view.tone === "warning"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {view.tone === "success" ? "Ready" : view.tone === "warning" ? "Check" : "Info"}
                      </span>
                    </div>

                    {view.sections.length > 0 && (
                      <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
                        {view.sections.map((section) => {
                          const body = compactAgentDisplayText(section.body);
                          const isScreenshotReview = /^(Image|Screenshot)\s+\d+/i.test(section.label);

                          return (
                            <div
                              key={section.label}
                              className={`rounded-xl bg-white/75 p-3 shadow-sm ring-1 ring-black/5 ${
                                /side-by-side|what sticks out|failing-log signals|main takeaway/i.test(section.label) || isScreenshotReview ? "md:col-span-2" : ""
                              }`}
                            >
                              <div className="mb-2 text-[11px] font-black uppercase tracking-wide opacity-60">{section.label}</div>
                              {/side-by-side/i.test(section.label) ? (
                                <EvidenceComparisonSection body={body} />
                              ) : isScreenshotReview ? (
                                <ScreenshotReviewSection body={body} />
                              ) : /main takeaway/i.test(section.label) ? (
                                <div className="rounded-xl border border-amber-200 bg-amber-100/70 p-3 text-[15px] font-black leading-6 text-amber-950">
                                  {body}
                                </div>
                              ) : (
                                <pre className="whitespace-pre-wrap break-words font-sans text-[14.5px] font-semibold leading-6">
                                  {body}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {view.title === "Use Regular Chat" ? (
                      <button
                        type="button"
                        onClick={() => {
                          const prompt = regularChatRedirectPrompt(message.content);
                          if (prompt) void onSendToRegularChat(prompt);
                        }}
                        disabled={loading || !regularChatRedirectPrompt(message.content)}
                        className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        <Send size={16} />
                        Send to Regular Chat
                      </button>
                    ) : null}

                    <details className="mt-3 rounded-xl bg-white/60 p-3 text-[13px] font-semibold ring-1 ring-black/5">
                      <summary className="cursor-pointer font-black">Show raw Agent message</summary>
                      <pre className="pf-raw-agent-log mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 font-mono text-xs leading-5">
                        {compactAgentDisplayText(message.content)}
                      </pre>
                    </details>
                  </div>
                ) : isProjectCreationBrief ? (
                  <div className="rounded-2xl border border-blue-200 bg-white/75 p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-black text-blue-950">Sketch is ready to become a real project</div>
                        <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-blue-800">
                          Use the builder below to pick the parent path, optionally name the folder, and generate a runnable app from the attached design.
                        </p>
                      </div>
                      <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white">
                        Build-ready
                      </span>
                    </div>
                  </div>
                ) : message.role === "user" && userContent ? (
                  <div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-[15.5px] font-semibold leading-6 text-slate-50">
                      {userContent.request}
                    </pre>
                    {userContent.setupContext ? (
                      <details className="mt-3 rounded-xl bg-white/5 p-3 text-[12px] font-semibold leading-5 text-slate-200 ring-1 ring-white/10">
                        <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-sky-100">
                          Project and SDK context sent with this request
                        </summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900/80 p-3 font-mono text-[11px] leading-5 text-slate-200">
                          {userContent.setupContext}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ) : (
                  <AgentFreeformResponse content={message.content} />
                )}
                </div>
                {isLongAgentResponse ? (
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedAgentResponses((current) => {
                        const next = new Set(current);
                        if (next.has(index)) {
                          next.delete(index);
                        } else {
                          next.add(index);
                        }
                        return next;
                      });
                    }}
                    className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-slate-950 px-3 text-xs font-black text-white shadow-sm ring-1 ring-slate-800 transition hover:bg-slate-800"
                  >
                    <ChevronDown
                      size={15}
                      className={`transition ${isAgentResponseExpanded ? "rotate-180" : ""}`}
                    />
                    {isAgentResponseExpanded ? "Collapse response" : "Show full response"}
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-200">
                      {responseLineCount} lines
                    </span>
                  </button>
                ) : null}
                {visibleUploads.length ? (
                  <div className="mt-3 space-y-3">
                    {visibleUploads.some((file) => file.isImage && file.content) ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {visibleUploads
                          .filter((file) => file.isImage && file.content)
                          .map((file, uploadIndex) => (
                            <button
                              key={`${file.name}-preview-${uploadIndex}`}
                              type="button"
                              onClick={() => setPreviewUpload(file)}
                              className={`group overflow-hidden rounded-2xl text-left shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-lg ${
                                message.role === "user"
                                  ? "bg-slate-900/80 ring-sky-300/25 hover:ring-sky-300/50"
                                  : "bg-white ring-slate-200 hover:ring-blue-300"
                              }`}
                              title={`Open ${file.name}`}
                            >
                              <div className="relative aspect-video bg-slate-950">
                                <Image
                                  src={file.content}
                                  alt={file.name}
                                  fill
                                  sizes="(max-width: 640px) 90vw, 360px"
                                  className="object-contain"
                                  unoptimized
                                />
                              </div>
                              <div
                                className={`flex items-center justify-between gap-2 px-3 py-2 text-xs font-black ${
                                  message.role === "user" ? "text-slate-100" : "text-slate-700"
                                }`}
                              >
                                <span className="truncate">Image {uploadIndex + 1}: {file.name}</span>
                                <span className="shrink-0 opacity-60">
                                  {file.width && file.height ? `${file.width}x${file.height}` : "Preview"}
                                </span>
                              </div>
                            </button>
                          ))}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                    {visibleUploads.map((file, uploadIndex) => (
                      <span
                        key={`${file.name}-${uploadIndex}`}
                        className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black shadow-sm ring-1 ${
                          message.role === "user"
                            ? "bg-white/10 text-slate-100 ring-white/10"
                            : "bg-white text-slate-700 ring-slate-200"
                        }`}
                      >
                        <FileText size={13} />
                        <span className="max-w-56 truncate">
                          {file.isImage ? "Image" : "File"} {uploadIndex + 1}: {file.name}
                        </span>
                      </span>
                    ))}
                    </div>
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
                {message.role === "assistant" &&
                /PATCH APPLIED BY AGENT|PATCH APPLIED/i.test(message.content) &&
                rollbackTarget &&
                onRollbackLastApply ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-amber-950">Undo available</div>
                        <div className="mt-1 break-all text-xs font-semibold text-amber-800">
                          Latest snapshot: {rollbackTarget.relative || rollbackTarget.file}. Open options to choose what to restore.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onRollbackLastApply}
                        disabled={rollbackLoading}
                        className="inline-flex h-9 items-center gap-2 rounded-xl bg-amber-600 px-3 text-xs font-black text-white shadow-sm transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {rollbackLoading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                        {rollbackLoading ? "Loading..." : "Undo options"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
                );
              })()
            ))}
            <div ref={agentEndRef} />
          </div>
          {showJumpToBottom ? (
            <button
              type="button"
              onClick={jumpToBottom}
              className="fixed bottom-36 right-16 z-[330] flex h-12 w-12 items-center justify-center rounded-full border border-sky-200/70 bg-white text-slate-950 shadow-2xl shadow-black/35 transition hover:-translate-y-0.5 hover:bg-sky-50 hover:text-sky-700"
              title="Jump to latest Agent message"
              aria-label="Jump to latest Agent message"
            >
              <ChevronDown size={24} strokeWidth={2.6} />
            </button>
          ) : null}
        </div>

        <div className="border-t border-slate-200 bg-white p-4">
          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative rounded-2xl bg-slate-950 p-3 shadow-xl shadow-slate-950/10 ring-1 transition ${
              draggingFiles ? "ring-blue-400 shadow-blue-950/30" : "ring-transparent"
            }`}
          >
            {draggingFiles && (
              <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-blue-300 bg-blue-950/80 text-sm font-black text-white backdrop-blur-sm">
                Drop files or screenshots into this Agent workspace
              </div>
            )}
            {isProjectBuilder && (
              <form
                onSubmit={createProjectFromBuilder}
                className="mb-3 rounded-2xl border border-cyan-300/30 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.22),transparent_34%),linear-gradient(135deg,rgba(37,99,235,0.34),rgba(15,23,42,0.86))] p-4 shadow-lg"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-wide text-cyan-100">Build from sketch</div>
                    <div className="mt-1 text-lg font-black text-white">Create the folder and runnable app</div>
                    {generatedProjectPath ? (
                      <div className="mt-2 break-all rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-cyan-50 ring-1 ring-white/10">
                        Current generated project: {generatedProjectPath}
                      </div>
                    ) : generatedProjectDeleted ? (
                      <div className="mt-2 rounded-xl bg-emerald-400/15 px-3 py-2 text-xs font-black text-emerald-100 ring-1 ring-emerald-300/30">
                        Last generated project was deleted. Create a new folder below when ready.
                      </div>
                    ) : null}
                  </div>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-cyan-100 ring-1 ring-white/10">
                    Folder name can be blank
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
                  <label className="block">
                    <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-200">
                      Target parent path
                    </span>
                    <input
                      value={builderParentPath}
                      onChange={(event) => {
                        setBuilderParentPath(event.target.value);
                        setBuilderError("");
                      }}
                      placeholder="C:\\Users\\mekstein\\source\\repos"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white px-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/30"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-200">
                      Folder name
                    </span>
                    <input
                      value={builderFolderName}
                      onChange={(event) => setBuilderFolderName(event.target.value)}
                      placeholder="Auto-generate if blank"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white px-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/30"
                    />
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {PROJECT_STACK_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setBuilderStack(option)}
                        className={`h-9 rounded-xl px-3 text-xs font-black transition ${
                          builderStack === option
                            ? "bg-cyan-300 text-slate-950"
                            : "bg-white/10 text-slate-100 ring-1 ring-white/10 hover:bg-white/20"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-blue-700 shadow-sm transition hover:bg-cyan-50 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    Create project
                  </button>
                </div>
                {builderError && <div className="mt-3 text-xs font-black text-rose-200">{builderError}</div>}
              </form>
            )}
            {(uploads.length > 0 || uploadingFiles) && !loading && (
              <div className="mb-3 flex flex-wrap gap-2">
                {uploadingFiles ? (
                  <span className="inline-flex items-center gap-2 rounded-xl bg-cyan-400/15 px-3 py-2 text-xs font-black text-cyan-100 ring-1 ring-cyan-300/30">
                    <Loader2 size={14} className="animate-spin" />
                    Reading upload...
                  </span>
                ) : null}
                {uploads.map((file, index) => (
                  <span
                    key={`${file.name}-${index}`}
                    className="inline-flex max-w-full items-center overflow-hidden rounded-xl bg-white/10 text-xs font-black text-slate-100 ring-1 ring-white/10"
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewUpload(file)}
                      className="inline-flex min-w-0 items-center gap-2 px-3 py-2 transition hover:bg-blue-500/25"
                      title={`Preview ${file.name}`}
                    >
                      <FileText size={14} className="shrink-0" />
                      <span className="max-w-44 truncate">{file.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveUpload(index)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center border-l border-white/10 text-slate-300 transition hover:bg-rose-500/30 hover:text-white"
                      title={`Remove ${file.name}`}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {dependencyProposal?.needed && dependencyNames.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2">
                <div className="min-w-0 text-xs font-bold leading-5 text-indigo-100">
                  Missing package{dependencyNames.length === 1 ? "" : "s"}: <span className="font-mono">{dependencyLabel}</span>
                  <span className="block truncate text-indigo-200">
                    {dependencyProposal.installable === false && dependencyProposal.installCommand
                      ? dependencyProposal.installCommand
                      : dependencyProposal.reason}
                  </span>
                </div>
                {dependencyProposal.installable === false ? (
                  <button
                    type="button"
                    onClick={() =>
                      runAction({
                        label: "Prepare manual install",
                        displayPrompt: "Prepare manual install",
                        prompt: `Prepare the manual dependency/artifact install for ${dependencyLabel}. Do not just repeat the command. Inspect the connected project, add any safe repository/config/file references, explain exactly what external file/tool/approval is still required, and run validation if possible.`,
                      })
                    }
                    disabled={loading || dependencyInstalling}
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-white/10 px-4 text-xs font-black text-indigo-100 ring-1 ring-white/10 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                    title={dependencyProposal.installCommand || dependencyProposal.reason}
                  >
                    <Send size={14} />
                    Prepare manual install
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      runAction({
                        label: dependencyNames.length === 1 ? `Install ${dependencyLabel}` : "Install all missing packages",
                        prompt: `Install ${dependencyLabel}`,
                        kind: "installDependency",
                      })
                    }
                    disabled={loading || dependencyInstalling}
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                    title={`Install ${dependencyLabel}`}
                  >
                    {dependencyInstalling ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {dependencyInstalling
                      ? "Installing..."
                      : dependencyNames.length === 1
                        ? `Install ${dependencyLabel}`
                        : "Install all"}
                  </button>
                )}
              </div>
            )}
            {bottomActions.length > 0 && (
              <div className="mb-3 rounded-2xl border border-blue-400/30 bg-blue-500/10 px-3 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-black uppercase tracking-wide text-blue-100">Recommended next step</div>
                  {loading && pendingActionPrompt && (
                    <div className="text-xs font-bold text-blue-200">
                      {workingCopyForPrompt(pendingActionDisplayPrompt || pendingActionPrompt, hasProject).message}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {bottomActions.map((action, index) => {
                    const isPendingAction = loading && pendingActionPrompt === action.prompt;
                    const isPrimary = action.prompt === primaryBottomAction?.prompt || index === 0;

                    return (
                      <button
                        key={action.prompt}
                        type="button"
                        onClick={() => runAction(action)}
                        disabled={loading}
                        className={`inline-flex h-9 items-center gap-2 rounded-xl px-4 text-xs font-black shadow-sm transition disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 ${
                          isPrimary
                            ? "bg-blue-600 text-white hover:bg-blue-500"
                            : "bg-white/10 text-blue-100 ring-1 ring-white/10 hover:bg-white/20"
                        }`}
                        title={action.prompt}
                      >
                        {isPendingAction ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendDraft();
                }
              }}
              placeholder="Ask for project changes, validation, installs, Visual Fix, or generated apps..."
              className="min-h-28 w-full resize-y rounded-2xl border border-white/10 bg-slate-900 p-4 text-[15px] leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
              style={{ color: "#f8fafc" }}
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-400">Enter sends. Shift+Enter adds a new line. Simple image/log analysis belongs in Regular Chat.</div>
              <div className="flex flex-wrap gap-2">
                {editingMessage && (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={loading}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-black text-slate-100 ring-1 ring-white/10 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    <X size={16} />
                    Cancel edit
                  </button>
                )}
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-black text-slate-100 ring-1 ring-white/10 transition hover:bg-slate-700">
                  {uploadingFiles ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {uploadingFiles ? "Reading..." : "Upload"}
                  <input
                    type="file"
                    multiple
                    disabled={uploadingFiles || loading}
                    className="hidden"
                    onChange={(event) => {
                      void uploadFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  onClick={sendDraft}
                  disabled={loading || uploadingFiles || sendingDraft || !canSubmitDraft}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {loading || uploadingFiles || sendingDraft ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  {uploadingFiles ? "Reading upload..." : sendingDraft ? "Sending..." : "Continue Investigation"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {folderBrowser.open && (
        <div className="fixed inset-0 z-[292] flex items-center justify-center bg-slate-950/55 p-5 backdrop-blur-sm">
          <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-slate-950 shadow-2xl ring-1 ring-cyan-400/30">
            <div className="flex items-start justify-between gap-4 border-b border-cyan-400/20 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950 px-5 py-4">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-wide text-cyan-300">PayFix Folder Browser</div>
                <h3 className="mt-1 text-xl font-black text-white">{folderBrowser.title}</h3>
                <p className="mt-1 truncate text-sm font-semibold text-slate-300">{folderBrowser.currentPath || "Loading folders..."}</p>
              </div>
              <button
                type="button"
                onClick={closeFolderBrowser}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-800 text-slate-100 transition hover:bg-slate-700"
                title="Close folder browser"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_1fr]">
              <aside className="border-b border-cyan-400/20 bg-slate-900 p-4 md:border-b-0 md:border-r">
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-cyan-200">Quick locations</div>
                <div className="space-y-2">
                  {folderBrowser.roots.map((root) => (
                    <button
                      key={root}
                      type="button"
                      onClick={() => void loadFolderBrowser(folderBrowser.target, root)}
                      className="w-full truncate rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-left text-xs font-bold text-slate-200 shadow-sm transition hover:border-cyan-400/60 hover:bg-cyan-950/50 hover:text-cyan-100"
                      title={root}
                    >
                      {root}
                    </button>
                  ))}
                </div>
              </aside>

              <section className="flex min-h-0 flex-col bg-slate-900 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => folderBrowser.parentPath && void loadFolderBrowser(folderBrowser.target, folderBrowser.parentPath)}
                    disabled={!folderBrowser.parentPath || folderBrowser.loading}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-black text-slate-100 shadow-sm transition hover:border-cyan-400/60 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ArrowLeft size={16} />
                    Up
                  </button>
                  <input
                    value={folderBrowser.query}
                    onChange={(event) => setFolderBrowser((current) => ({ ...current, query: event.target.value }))}
                    placeholder="Search folders..."
                    className="h-10 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                  />
                  <select
                    value={folderBrowser.sort}
                    onChange={(event) =>
                      setFolderBrowser((current) => ({ ...current, sort: event.target.value === "name" ? "name" : "recent" }))
                    }
                    className="h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-black text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                  >
                    <option value="recent">Newest first</option>
                    <option value="name">Name A-Z</option>
                  </select>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-950/30 px-3 py-2">
                  <div className="min-w-0 text-xs font-semibold text-cyan-100">
                    {folderBrowser.target === "sdk" ? `${folderBrowser.selectedPaths.length || (folderBrowser.selectedPath ? 1 : 0)} SDK folder selected` : "Selected:"}
                    <span className="ml-1 font-mono font-black text-white">
                      {folderBrowser.target === "sdk"
                        ? folderBrowser.selectedPaths.slice(0, 2).join(" | ") || folderBrowser.selectedPath || "None"
                        : folderBrowser.selectedPath || folderBrowser.currentPath || "None"}
                      {folderBrowser.target === "sdk" && folderBrowser.selectedPaths.length > 2 ? ` +${folderBrowser.selectedPaths.length - 2} more` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={useFolderBrowserSelection}
                    disabled={
                      folderBrowser.target === "sdk"
                        ? !folderBrowser.selectedPaths.length && !folderBrowser.selectedPath
                        : !folderBrowser.selectedPath && !folderBrowser.currentPath
                    }
                    className="inline-flex h-9 items-center gap-2 rounded-xl bg-cyan-500 px-4 text-xs font-black text-slate-950 shadow-sm transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    <FolderOpen size={14} />
                    {folderBrowser.target === "project" ? "Use as project root" : folderBrowser.selectedPaths.length > 1 ? "Add SDK folders" : "Add SDK folder"}
                  </button>
                </div>

                {folderBrowser.error && (
                  <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-950/30 px-3 py-2 text-sm font-bold text-rose-100">
                    {folderBrowser.error}
                  </div>
                )}

                <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-700 bg-slate-950">
                  {folderBrowser.loading ? (
                    <div className="flex h-48 items-center justify-center gap-2 text-sm font-black text-slate-300">
                      <Loader2 size={18} className="animate-spin" />
                      Loading folders...
                    </div>
                  ) : visibleFolderEntries.length ? (
                    <div className="divide-y divide-slate-800">
                      {visibleFolderEntries.map((folder) => {
                        const selected =
                          folderBrowser.target === "sdk"
                            ? folderBrowser.selectedPaths.includes(folder.path)
                            : folderBrowser.selectedPath === folder.path;
                        return (
                          <div
                            key={folder.path}
                            className={`grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 transition ${
                              selected ? "bg-cyan-500/15" : "hover:bg-slate-900"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setFolderBrowser((current) =>
                                  current.target === "sdk"
                                    ? {
                                        ...current,
                                        selectedPath: folder.path,
                                        selectedPaths: current.selectedPaths.includes(folder.path)
                                          ? current.selectedPaths.filter((item) => item !== folder.path)
                                          : [...current.selectedPaths, folder.path],
                                      }
                                    : { ...current, selectedPath: folder.path },
                                )
                              }
                              onDoubleClick={() => void loadFolderBrowser(folderBrowser.target, folder.path)}
                              className="flex min-w-0 items-start gap-3 text-left"
                              title={folderBrowser.target === "sdk" ? "Click to toggle. Double-click to open." : "Click to select. Double-click to open."}
                            >
                              {folderBrowser.target === "sdk" && (
                                <span
                                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-black ${
                                    selected ? "border-cyan-300 bg-cyan-400 text-slate-950" : "border-slate-600 bg-slate-900 text-transparent"
                                  }`}
                                  aria-hidden="true"
                                >
                                  <Check size={13} />
                                </span>
                              )}
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-black text-white">{folder.name}</span>
                                <span className="block truncate text-xs font-semibold text-slate-400">{folder.path}</span>
                              </span>
                            </button>
                            <div className="flex items-center gap-2">
                              <span className="hidden text-xs font-bold text-slate-400 sm:inline">{formatFolderModified(folder.modifiedAt)}</span>
                              <button
                                type="button"
                                onClick={() => void loadFolderBrowser(folderBrowser.target, folder.path)}
                                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-black text-slate-100 shadow-sm transition hover:border-cyan-400/60 hover:bg-cyan-950/50 hover:text-cyan-100"
                              >
                                Open
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-48 items-center justify-center text-sm font-bold text-slate-400">
                      No folders match this search.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
      {previewUpload && (
        <div className="fixed inset-0 z-[290] flex items-center justify-center bg-slate-950/75 p-6">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-wide text-blue-600">Agent Attachment Preview</div>
                <h3 className="truncate text-lg font-black text-slate-950">{previewUpload.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewUpload(null)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                title="Close attachment preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-5">
              {previewUpload.isImage ? (
                <div className="relative mx-auto h-[72vh] w-full max-w-4xl rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                  <Image
                    src={previewUpload.content}
                    alt={previewUpload.name}
                    fill
                    unoptimized
                    className="object-contain p-2"
                  />
                </div>
              ) : (
                <pre className="max-h-[72vh] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950 p-4 text-xs leading-5 text-emerald-100">
                  {previewUpload.content || "(No preview content available.)"}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
