import express from "express";
import cors from "cors";
import fg from "fast-glob";
import { watch, type FSWatcher } from "fs";
import fs from "fs/promises";
import path from "path";
import os from "os";
import net from "net";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { pathToFileURL } from "url";

const app = express();
const PORT = 7777;
const execFileAsync = promisify(execFile);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "50mb" }));

let allowedRoot = "";
const activeWatchers = new Map<string, { file: string; watcher: FSWatcher; startedAt: string }>();
const watchSnapshots = new Map<string, string>();
const watchTimers = new Map<string, NodeJS.Timeout>();
const watchLastSignatures = new Map<string, string>();
const watchEvents: Array<{
  eventId: string;
  watcherId: string;
  file: string;
  relative: string;
  eventType: string;
  at: string;
  addedLines: number;
  removedLines: number;
  changed: boolean;
  preview: string;
  issues: Array<{ severity: "error" | "warning" | "info"; message: string; line?: number }>;
  analysis?: WatchAnalysis;
}> = [];
type WatchIssue = { severity: "error" | "warning" | "info"; message: string; line?: number };
type WatchAnalysis = {
  title: string;
  confidence: number;
  risk: "low" | "medium" | "high";
  evidence: string[];
  probableCause: string;
  suggestedFix: string;
  validation: string[];
};

function clearWatchState() {
  for (const watcher of activeWatchers.values()) {
    watcher.watcher.close();
  }
  activeWatchers.clear();
  watchSnapshots.clear();
  watchLastSignatures.clear();
  for (const timer of watchTimers.values()) {
    clearTimeout(timer);
  }
  watchTimers.clear();
  watchEvents.splice(0, watchEvents.length);
}
const rollbackSnapshots = new Map<
  string,
  { id: string; file: string; relative: string; previousContent: string; fileExisted: boolean; createdAt: string; reason: string }
>();
type CaptureConnection =
  | { kind: "tcp"; socket: net.Socket }
  | { kind: "serial"; port: { close: (callback?: (error?: Error | null) => void) => void; write?: (data: string | Buffer) => void } };
type DeviceCaptureEvent = {
  id: string;
  at: string;
  direction: "in" | "out" | "status" | "error";
  rawHex: string;
  ascii: string;
  redacted: string;
  analysis: {
    kind: string;
    summary: string;
    findings: string[];
    sensitiveDataRedacted: boolean;
  };
};
type DeviceCaptureSession = {
  id: string;
  mode: "tcp" | "serial";
  label: string;
  startedAt: string;
  status: "connecting" | "connected" | "closed" | "error";
  error?: string;
  connection: CaptureConnection;
  events: DeviceCaptureEvent[];
};
const captureSessions = new Map<string, DeviceCaptureSession>();

type VendorPackManifest = {
  id: string;
  vendor: string;
  models: string[];
  connectionTypes: Array<"serial" | "tcp" | "hid" | "keyboard">;
  actions: {
    id: string;
    label: string;
    description: string;
    requiresAdapter: boolean;
  }[];
  sdkRequired: boolean;
  notes: string[];
};

const vendorPacks: VendorPackManifest[] = [
  {
    id: "idtech",
    vendor: "ID TECH",
    models: ["VP3300", "Augusta", "UniPay", "SREDKey", "Spectrum Pro"],
    connectionTypes: ["serial", "hid", "keyboard"],
    sdkRequired: true,
    actions: [
      {
        id: "start-card-read",
        label: "Start Card Read",
        description: "Prompt the reader for tap/swipe/insert using the installed ID TECH adapter.",
        requiresAdapter: true,
      },
      {
        id: "get-device-info",
        label: "Get Device Info",
        description: "Read device identity/firmware where the adapter supports it.",
        requiresAdapter: true,
      },
    ],
    notes: [
      "Many ID TECH devices expose encrypted HID/serial payloads and require SDK commands for controlled card reads.",
      "Keyboard-wedge mode, if enabled on the reader, can be captured without the SDK.",
    ],
  },
  {
    id: "verifone",
    vendor: "Verifone",
    models: ["VX", "MX", "P200", "P400", "e285", "M400"],
    connectionTypes: ["tcp", "serial"],
    sdkRequired: true,
    actions: [
      {
        id: "start-sale",
        label: "Start Sale",
        description: "Start a sale/payment prompt through a Verifone adapter.",
        requiresAdapter: true,
      },
      {
        id: "get-terminal-status",
        label: "Get Terminal Status",
        description: "Query terminal status through a Verifone adapter.",
        requiresAdapter: true,
      },
    ],
    notes: ["Verifone integrations are protocol/estate specific. The adapter must wrap your approved SDK/protocol."],
  },
  {
    id: "ingenico",
    vendor: "Ingenico",
    models: ["Lane", "iPP", "iSC", "Move", "Desk"],
    connectionTypes: ["tcp", "serial"],
    sdkRequired: true,
    actions: [
      {
        id: "start-sale",
        label: "Start Sale",
        description: "Start a sale/payment prompt through an Ingenico adapter.",
        requiresAdapter: true,
      },
      {
        id: "get-terminal-status",
        label: "Get Terminal Status",
        description: "Query terminal status through an Ingenico adapter.",
        requiresAdapter: true,
      },
    ],
    notes: ["Ingenico command sets vary by processor estate and SDK. Add the estate-specific adapter locally."],
  },
  {
    id: "pax",
    vendor: "PAX",
    models: ["A35", "A60", "A80", "A920", "S300"],
    connectionTypes: ["tcp", "serial"],
    sdkRequired: true,
    actions: [
      {
        id: "start-sale",
        label: "Start Sale",
        description: "Start a PAX payment request through an installed adapter.",
        requiresAdapter: true,
      },
      {
        id: "get-terminal-status",
        label: "Get Terminal Status",
        description: "Query PAX device status through an installed adapter.",
        requiresAdapter: true,
      },
    ],
    notes: ["PAX integrations often use processor-specific ECR protocols. The pack needs your protocol profile."],
  },
  {
    id: "dejavoo",
    vendor: "Dejavoo",
    models: ["Z-series", "Q-series", "P-series"],
    connectionTypes: ["tcp", "serial"],
    sdkRequired: true,
    actions: [
      {
        id: "start-sale",
        label: "Start Sale",
        description: "Start a Dejavoo payment request through an installed adapter.",
        requiresAdapter: true,
      },
      {
        id: "get-terminal-status",
        label: "Get Terminal Status",
        description: "Query Dejavoo terminal status through an installed adapter.",
        requiresAdapter: true,
      },
    ],
    notes: ["Dejavoo command details depend on the gateway/processor profile configured on the terminal."],
  },
];

type TextSearchResult = {
  type?: "filename" | "content";
  file: string;
  line: number;
  text: string;
};

type ProjectMatch = {
  file: string;
  line: number;
  text: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected local agent error.";
}

const projectFileGlobs = [
  "**/*.{ts,tsx,js,jsx,cjs,mjs,html,htm,css,scss,sass,json,jsonc,txt,log,md,xml,config,cs,csproj,sln,py,java,php,rb,go,rs,vb,sql,yml,yaml,env,ini,ps1,bat,cmd,sh}",
];

const projectIgnoreGlobs = [
  "!**/node_modules/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/.next/**",
  "!**/bin/**",
  "!**/obj/**",
  "!**/.git/**",
  "!**/vendor/**",
  "!**/coverage/**",
];

async function listProjectFiles() {
  if (!allowedRoot) throw new Error("No project folder selected.");

  return fg([...projectFileGlobs, ...projectIgnoreGlobs], {
    cwd: allowedRoot,
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
  });
}

async function listAllProjectFiles() {
  if (!allowedRoot) throw new Error("No project folder selected.");

  return fg(["**/*", ...projectIgnoreGlobs], {
    cwd: allowedRoot,
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
  });
}

function fileMime(file: string) {
  const ext = path.extname(file).toLowerCase();

  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".log": "text/plain",
    ".md": "text/markdown",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".scss": "text/x-scss",
    ".sass": "text/x-sass",
    ".js": "text/javascript",
    ".jsx": "text/javascript",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".json": "application/json",
    ".jsonc": "application/json",
    ".xml": "application/xml",
    ".php": "application/x-httpd-php",
    ".cs": "text/x-csharp",
    ".py": "text/x-python",
    ".yml": "application/yaml",
    ".yaml": "application/yaml",
    ".mp3": "audio/mpeg",
    ".mpeg": "audio/mpeg",
    ".mpga": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };

  return map[ext] || "application/octet-stream";
}

function isAudioFile(file: string) {
  return [".mp3", ".mpeg", ".mpga", ".m4a", ".mp4", ".wav", ".webm", ".ogg", ".flac"].includes(
    path.extname(file).toLowerCase()
  );
}

function isImageFile(file: string) {
  return [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(path.extname(file).toLowerCase());
}

function looksText(buffer: Buffer) {
  if (!buffer.length) return true;

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;

  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious++;
  }

  return suspicious / sample.length < 0.05;
}

async function readFileForAi(file: string) {
  const stat = await fs.stat(file);
  const buffer = await fs.readFile(file);
  const mime = fileMime(file);
  const extension = path.extname(file).toLowerCase();
  const maxBinaryBytes = 25 * 1024 * 1024;

  if ((isAudioFile(file) || isImageFile(file)) && buffer.length <= maxBinaryBytes) {
    return {
      file,
      extension,
      mime,
      size: stat.size,
      kind: isAudioFile(file) ? "audio" : "image",
      encoding: "base64",
      base64: buffer.toString("base64"),
    };
  }

  if (looksText(buffer)) {
    return {
      file,
      extension,
      mime,
      size: stat.size,
      kind: "text",
      content: buffer.toString("utf8").slice(0, 30000),
    };
  }

  return {
    file,
    extension,
    mime,
    size: stat.size,
    kind: "binary",
    encoding: "base64-preview",
    base64: buffer.subarray(0, Math.min(buffer.length, 16384)).toString("base64"),
    note:
      buffer.length > maxBinaryBytes
        ? "Binary file is too large to inline completely. Included a base64 preview only."
        : "Binary file type is not directly interpretable. Included a base64 preview.",
  };
}

async function readWatchSnapshot(file: string) {
  try {
    const buffer = await fs.readFile(file);
    if (!looksText(buffer)) {
      return `[binary file, ${buffer.length} bytes]`;
    }

    return buffer.toString("utf8");
  } catch (err: unknown) {
    return `[unreadable: ${errorMessage(err)}]`;
  }
}

function summarizeTextChange(previous: string, current: string) {
  if (previous === current) {
    return {
      addedLines: 0,
      removedLines: 0,
      changed: false,
      preview: "File watcher event fired, but file content did not change.",
    };
  }

  const previousLines = previous.split(/\r?\n/);
  const currentLines = current.split(/\r?\n/);
  const previousCounts = new Map<string, number>();
  const currentCounts = new Map<string, number>();

  for (const line of previousLines) previousCounts.set(line, (previousCounts.get(line) || 0) + 1);
  for (const line of currentLines) currentCounts.set(line, (currentCounts.get(line) || 0) + 1);

  const addedExamples: string[] = [];
  const removedExamples: string[] = [];
  let addedLines = 0;
  let removedLines = 0;

  for (const [line, count] of currentCounts) {
    const delta = count - (previousCounts.get(line) || 0);
    if (delta > 0) {
      addedLines += delta;
      if (line.trim() && addedExamples.length < 4) addedExamples.push(`+ ${line.slice(0, 180)}`);
    }
  }

  for (const [line, count] of previousCounts) {
    const delta = count - (currentCounts.get(line) || 0);
    if (delta > 0) {
      removedLines += delta;
      if (line.trim() && removedExamples.length < 4) removedExamples.push(`- ${line.slice(0, 180)}`);
    }
  }

  return {
    addedLines,
    removedLines,
    changed: true,
    preview: [...removedExamples, ...addedExamples].join("\n") || "File content changed.",
  };
}

function lineNumberForIndex(content: string, index: number) {
  return content.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function stripCodeForDelimiterScan(content: string) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (match) => " ".repeat(match.length))
    .replace(/\/\/.*$/gm, (match) => " ".repeat(match.length))
    .replace(/\/(?![/*])(?:\\.|\[[^\]\r\n]*(?:\\.[^\]\r\n]*)*\]|[^/\\\r\n])+\/[dgimsuvy]*/g, (match) => " ".repeat(match.length))
    .replace(/@?"(?:\\.|""|[^"\\])*"/g, (match) => " ".repeat(match.length))
    .replace(/'(?:\\.|[^'\\])'/g, (match) => " ".repeat(match.length))
    .replace(/`(?:\\.|[^`\\])*`/g, (match) => " ".repeat(match.length));
}

function diagnoseDelimiterBalance(content: string, languageLabel: string): WatchIssue[] {
  const issues: WatchIssue[] = [];
  const scrubbed = stripCodeForDelimiterScan(content);
  const pairs: Array<{ open: string; close: string; label: string }> = [
    { open: "(", close: ")", label: "parenthesis" },
    { open: "{", close: "}", label: "brace" },
    { open: "[", close: "]", label: "bracket" },
  ];

  for (const pair of pairs) {
    const stack: number[] = [];
    for (let index = 0; index < scrubbed.length; index += 1) {
      const char = scrubbed[index];
      if (char === pair.open) {
        stack.push(index);
      } else if (char === pair.close) {
        if (!stack.length) {
          issues.push({
            severity: "error",
            line: lineNumberForIndex(content, index),
            message: `Unexpected "${pair.close}" in ${languageLabel}; no matching "${pair.open}" was found.`,
          });
          break;
        }
        stack.pop();
      }
    }

    if (stack.length) {
      const index = stack[stack.length - 1];
      issues.push({
        severity: "error",
        line: lineNumberForIndex(content, index),
        message: `Missing "${pair.close}" for "${pair.open}" opened in ${languageLabel}.`,
      });
    }
  }

  return issues;
}

function diagnoseCStyleControlStatementParens(content: string, languageLabel: string): WatchIssue[] {
  const issues: WatchIssue[] = [];
  const lines = content.split(/\r?\n/);
  const controlPattern = /^\s*(if|while|for|foreach|switch|using|lock|catch)\s*\(/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(controlPattern);
    if (!match) continue;

    const nearby = lines.slice(index, Math.min(lines.length, index + 4)).join("\n");
    const scannedNearby = stripCodeForDelimiterScan(nearby);
    const braceIndex = scannedNearby.indexOf("{");
    const terminatorIndex = scannedNearby.search(/[;{]/);
    if (braceIndex < 0 || (terminatorIndex >= 0 && terminatorIndex !== braceIndex)) continue;

    const scanned = scannedNearby.slice(0, braceIndex);
    const openCount = (scanned.match(/\(/g) || []).length;
    const closeCount = (scanned.match(/\)/g) || []).length;

    if (openCount > closeCount) {
      const condition = scanned
        .slice(scanned.indexOf("(") + 1)
        .replace(/\s+/g, " ")
        .trim();
      const expected = condition ? `${match[1]} (${condition})` : `${match[1]} (...)`;
      issues.push({
        severity: "error",
        line: index + 1,
        message: `Line ${index + 1}: missing closing ")" after \`${condition || "condition"}\` in ${languageLabel} ${match[1]} statement. Expected \`${expected}\` before the block starts.`,
      });
    }
  }

  return issues;
}

function dedupeWatchIssues(issues: WatchIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.line || ""}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const htmlVoidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const svgSelfClosingTags = new Set([
  "animate",
  "circle",
  "ellipse",
  "feblend",
  "fecolormatrix",
  "fecomponenttransfer",
  "fecomposite",
  "feconvolvematrix",
  "fediffuselighting",
  "fedisplacementmap",
  "fedistantlight",
  "fedropshadow",
  "feflood",
  "fefunca",
  "fefuncb",
  "fefuncg",
  "fefuncr",
  "fegaussianblur",
  "feimage",
  "femerge",
  "femergenode",
  "femorphology",
  "feoffset",
  "fepointlight",
  "fespecularlighting",
  "fespotlight",
  "fetile",
  "feturbulence",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "stop",
  "use",
]);

function diagnoseHtmlSelfClosingNonVoidTags(content: string): WatchIssue[] {
  const issues: WatchIssue[] = [];

  for (const match of content.matchAll(/<([a-z][a-z0-9:-]*)(?:\s[^<>]*)?\/>/gi)) {
    const tag = match[1].toLowerCase();
    if (htmlVoidTags.has(tag) || svgSelfClosingTags.has(tag)) continue;

    const line = lineNumberForIndex(content, match.index || 0);
    const snippet = match[0].replace(/\s+/g, " ").slice(0, 120);
    issues.push({
      severity: "warning",
      line,
      message: `Line ${line}: suspicious self-closing <${tag} /> tag. HTML treats ${snippet} as an opening <${tag}> tag; use <${tag}></${tag}> instead.`,
    });
  }

  return issues;
}

async function diagnoseWatchedFile(file: string, content: string): Promise<WatchIssue[]> {
  const issues: WatchIssue[] = [];
  const extension = path.extname(file).toLowerCase();

  if (content.startsWith("[binary file")) {
    issues.push({ severity: "info", message: "Binary file changed. Text diagnostics were skipped." });
    return issues;
  }

  if (extension === ".html" || extension === ".htm") {
    const idCounts = new Map<string, number>();
    for (const match of content.matchAll(/\sid=["']([^"']+)["']/gi)) {
      idCounts.set(match[1], (idCounts.get(match[1]) || 0) + 1);
    }
    for (const [id, count] of idCounts) {
      if (count > 1) issues.push({ severity: "error", message: `Duplicate id "${id}" appears ${count} times.` });
    }

    const appearsToBeFullHtmlDocument = /<html[\s>]/i.test(content) || /<body[\s>]/i.test(content) || /<!doctype/i.test(content);

    if (appearsToBeFullHtmlDocument && !/<!doctype\s+html>/i.test(content)) {
      issues.push({ severity: "warning", message: "Missing <!DOCTYPE html>." });
    }
    if (appearsToBeFullHtmlDocument && !/<html[\s>]/i.test(content)) {
      issues.push({ severity: "warning", message: "Missing <html> element." });
    }
    if (appearsToBeFullHtmlDocument && !/<body[\s>]/i.test(content)) {
      issues.push({ severity: "warning", message: "Missing <body> element." });
    }

    for (const match of content.matchAll(/<p\b[^>]*>([\s\S]*?)(?=<\/?(?:form|label|input|button|section|div|main|h[1-6])\b)/gi)) {
      const paragraphBody = match[1] || "";
      const fullMatch = match[0] || "";
      if (!/<\/p>/i.test(paragraphBody) && !/<\/p>/i.test(fullMatch)) {
        const line = lineNumberForIndex(content, match.index || 0);
        issues.push({
          severity: "error",
          line,
          message: `Line ${line}: <p> starts before another form/layout element but is not closed with </p>.`,
        });
        break;
      }
    }

    issues.push(...diagnoseHtmlSelfClosingNonVoidTags(content));

    const stack: string[] = [];
    for (const match of content.matchAll(/<\/?([a-z][a-z0-9-]*)(?:\s[^>]*)?>/gi)) {
      const full = match[0];
      const tag = match[1].toLowerCase();
      if (htmlVoidTags.has(tag) || full.endsWith("/>") || full.startsWith("<!")) continue;
      if (!full.startsWith("</")) {
        stack.push(tag);
        continue;
      }
      const last = stack.pop();
      if (last !== tag) {
        issues.push({ severity: "error", message: `Possible tag mismatch: expected </${last || "none"}> but found </${tag}>.` });
        break;
      }
    }
    if (stack.length) {
      issues.push({ severity: "error", message: `Possible unclosed tag: <${stack[stack.length - 1]}>.` });
    }

    for (const match of content.matchAll(/<link[^>]+href=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gi)) {
      const href = match[1].replace(/\?.*$/, "");
      if (/^(https?:)?\/\//i.test(href) || href.startsWith("/") || href.startsWith("#")) continue;
      const cssPath = path.resolve(path.dirname(file), href);
      if (!(await fileExists(cssPath))) {
        issues.push({ severity: "error", message: `Linked stylesheet was not found: ${href}.` });
      }
    }
  }

  if (extension === ".css") {
    const openCount = (content.match(/\{/g) || []).length;
    const closeCount = (content.match(/\}/g) || []).length;
    if (openCount !== closeCount) {
      issues.push({ severity: "error", message: `CSS brace mismatch: ${openCount} "{" and ${closeCount} "}".` });
    }
  }

  if ([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".cs", ".java", ".php", ".go", ".rs", ".cpp", ".c", ".h"].includes(extension)) {
    const languageLabel =
      extension === ".cs"
        ? "C#"
        : extension === ".ts" || extension === ".tsx"
          ? "TypeScript"
          : extension === ".js" || extension === ".jsx" || extension === ".cjs" || extension === ".mjs"
            ? "JavaScript"
            : extension.slice(1).toUpperCase();
    const preciseParenIssues = diagnoseCStyleControlStatementParens(content, languageLabel);
    issues.push(...preciseParenIssues);
    if (!preciseParenIssues.length) {
      issues.push(...diagnoseDelimiterBalance(content, languageLabel));
    }
  }

  if (!issues.length) {
    issues.push({ severity: "info", message: "No obvious structural issues detected in this file." });
  }

  return dedupeWatchIssues(issues).slice(0, 8);
}

function validationForFile(file: string) {
  const extension = path.extname(file).toLowerCase();
  const checks: string[] = [];

  if ([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs"].includes(extension)) {
    checks.push("Run TypeScript or build validation for syntax/import regressions.");
  }
  if ([".cs", ".csproj", ".sln"].includes(extension)) {
    checks.push("Run dotnet build to catch C# syntax, missing references, and project errors.");
  }
  if ([".ts", ".tsx", ".js", ".jsx"].includes(extension)) {
    checks.push("Run lint to catch unsafe hooks, unused imports, and style regressions.");
  }
  if ([".html", ".htm", ".css", ".scss", ".sass", ".tsx", ".jsx"].includes(extension)) {
    checks.push("Inspect localhost visually for layout overflow, clipped buttons, or console errors.");
  }
  if (/webhook|payment|gateway|cardknox|stripe|authorize|emv|device/i.test(file)) {
    checks.push("Replay a payment/webhook/device scenario that touches this file.");
  }

  return checks.length ? checks : ["Re-run the behavior that this file controls."];
}

function lineText(content: string, lineNumber?: number) {
  if (!lineNumber || lineNumber < 1) return "";
  return content.split(/\r?\n/)[lineNumber - 1]?.trim().slice(0, 260) || "";
}

async function scanProjectStructuralIssues(limit = 80) {
  if (!allowedRoot) throw new Error("No project folder selected.");

  const files = await listProjectFiles();
  const sourceFiles = files.filter((file) =>
    /\.(ts|tsx|js|jsx|cjs|mjs|cs|java|php|go|rs|cpp|c|h|html|htm|css|scss|sass)$/i.test(file),
  );
  const issues: Array<{
    file: string;
    relative: string;
    severity: WatchIssue["severity"];
    line?: number;
    message: string;
    code?: string;
  }> = [];

  for (const file of sourceFiles.slice(0, 1200)) {
    if (issues.length >= limit) break;

    const content = await readWatchSnapshot(file);
    if (content.startsWith("[binary file") || content.startsWith("[unreadable:")) continue;

    const fileIssues = (await diagnoseWatchedFile(file, content)).filter((issue) => issue.severity !== "info");
    for (const issue of fileIssues) {
      issues.push({
        file,
        relative: relativeProjectPath(file),
        severity: issue.severity,
        line: issue.line,
        message: issue.message,
        code: lineText(content, issue.line),
      });
      if (issues.length >= limit) break;
    }
  }

  return {
    ok: true,
    root: allowedRoot,
    scannedFiles: sourceFiles.length,
    issueCount: issues.length,
    issues,
  };
}

function analyzeWatchedChange(file: string, change: ReturnType<typeof summarizeTextChange>, issues: WatchIssue[]): WatchAnalysis {
  const relative = relativeProjectPath(file);
  const realIssues = issues.filter((issue) => issue.severity !== "info");
  const hasErrors = realIssues.some((issue) => issue.severity === "error");
  const changedLineCount = (change.addedLines || 0) + (change.removedLines || 0);
  const risk: WatchAnalysis["risk"] = hasErrors ? "high" : changedLineCount > 35 ? "medium" : realIssues.length ? "medium" : "low";
  const confidence = hasErrors ? 94 : realIssues.length ? 82 : change.changed ? 68 : 45;
  const evidence = [
    `${relative} changed at ${new Date().toLocaleTimeString()}.`,
    `Diff size: +${change.addedLines || 0} / -${change.removedLines || 0} line(s).`,
    ...realIssues.slice(0, 4).map((issue) => `${issue.severity.toUpperCase()}${issue.line ? ` line ${issue.line}` : ""}: ${issue.message}`),
  ];

  let title = "File changed";
  let probableCause = "The watched file changed. No structural breakage was detected by lightweight checks.";
  let suggestedFix = "If this change was intentional, validate the affected workflow. If behavior changed unexpectedly, compare the previewed diff.";

  if (hasErrors) {
    title = "Likely regression detected";
    probableCause = realIssues.find((issue) => issue.severity === "error")?.message || "A structural error was detected after the file changed.";
    suggestedFix = "Fix the reported line or restore the removed structure, then run sandbox checks and inspect localhost.";
  } else if (realIssues.length) {
    title = "Potential regression warning";
    probableCause = realIssues[0].message;
    suggestedFix = "Review the warning, then run validation before trusting the change.";
  } else if (changedLineCount > 35) {
    title = "Large change detected";
    probableCause = "The file changed substantially, so the risk is higher even though lightweight checks did not find a syntax issue.";
    suggestedFix = "Run sandbox validation and inspect the local app before continuing.";
  }

  return {
    title,
    confidence,
    risk,
    evidence,
    probableCause,
    suggestedFix,
    validation: validationForFile(file),
  };
}

function compactWatchEventsForUi() {
  const seen = new Set<string>();

  return watchEvents.filter((event) => {
    const realIssues = event.issues.filter((issue) => issue.severity !== "info");
    const issueSignature = realIssues
      .map((issue) => `${issue.severity}:${issue.line || ""}:${issue.message}`)
      .join("|");
    const signature = `${event.watcherId}:${event.relative}:${event.eventType}:${event.changed}:${issueSignature}:${event.preview}`;

    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function safePath(filePath: string) {
  if (!allowedRoot) {
    throw new Error("No project folder selected.");
  }

  const normalizedInput = String(filePath || "").trim();
  if (!normalizedInput) throw new Error("Missing file path.");

  const resolved = path.isAbsolute(normalizedInput)
    ? path.resolve(normalizedInput)
    : path.resolve(allowedRoot, normalizedInput);
  const rootWithSeparator = allowedRoot.endsWith(path.sep) ? allowedRoot : `${allowedRoot}${path.sep}`;
  const normalizedResolved = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const normalizedRoot = process.platform === "win32" ? allowedRoot.toLowerCase() : allowedRoot;
  const normalizedRootWithSeparator =
    process.platform === "win32" ? rootWithSeparator.toLowerCase() : rootWithSeparator;

  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(normalizedRootWithSeparator)) {
    throw new Error("Blocked: file is outside selected project folder.");
  }

  return resolved;
}

function relativeProjectPath(file: string) {
  if (!allowedRoot) return file;
  return path.relative(allowedRoot, file) || path.basename(file);
}

function classifyProjectFile(file: string) {
  const relative = relativeProjectPath(file).replace(/\\/g, "/");
  const ext = path.extname(file).toLowerCase();

  if (/^(app|pages|src|components)\//.test(relative) && /\.(tsx|jsx|ts|js|html)$/i.test(file)) return "frontend";
  if (/api|route\.(ts|js)|server\.(ts|js)|controller|webhook/i.test(relative)) return "api";
  if (/payfix-agent|agent|server\.(ts|js)/i.test(relative)) return "agent";
  if ([".css", ".scss", ".sass"].includes(ext) || /tailwind|globals/i.test(relative)) return "styles";
  if (/test|spec|__tests__/i.test(relative)) return "tests";
  if (/package\.json|tsconfig|next\.config|vite\.config|eslint|\.env|lock/i.test(relative)) return "config";
  return "other";
}

function extractImportsFromText(content: string) {
  const imports = new Set<string>();
  const patterns = [
    /import\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
    /export\s+[^'"]+\s+from\s+["']([^"']+)["']/g,
    /require\(["']([^"']+)["']\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      imports.add(match[1]);
    }
  }

  return [...imports].slice(0, 80);
}

async function readPackageJsonSafe() {
  if (!allowedRoot) return null;
  const packageJsonPath = path.join(allowedRoot, "package.json");
  if (!(await fileExists(packageJsonPath))) return null;

  try {
    return JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectPaymentCapabilities(text: string) {
  const capabilities: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/\bcardknox|xcommand|xresult|xamount\b/i, "Cardknox gateway"],
    [/\bstripe|paymentintent|checkout\.session|stripe-signature\b/i, "Stripe"],
    [/\bauthorize\.net|x_login|x_tran_key|aim\b/i, "Authorize.Net"],
    [/\bemv|tlv|9f26|9f27|5f2a|iad\b/i, "EMV/TLV"],
    [/\bewic|wic|ebt|apl|xremainingbalanceebtw\b/i, "eWIC/EBT"],
    [/\bvp3300|id tech|idtech|verifone|ingenico|pax|dejavoo\b/i, "payment terminal/device"],
    [/\bwebhook|signature|hmac|replay\b/i, "webhooks"],
    [/\b3ds|three[- ]?domain|challenge|iframe|acs\b/i, "3DS / challenge flow"],
  ];

  for (const [pattern, label] of checks) {
    if (pattern.test(text)) capabilities.push(label);
  }

  return [...new Set(capabilities)];
}

async function projectFingerprint() {
  if (!allowedRoot) throw new Error("No project folder selected.");

  const packageJson = await readPackageJsonSafe();
  const allFiles = await listAllProjectFiles();
  const textFiles = await listProjectFiles();
  const sampleFiles = textFiles.slice(0, 80);
  const sampledText: string[] = [];

  for (const file of sampleFiles) {
    try {
      sampledText.push((await fs.readFile(file, "utf8")).slice(0, 8000));
    } catch {
      // Ignore unreadable project files.
    }
  }

  const deps = packageJson
    ? {
        ...((packageJson.dependencies as Record<string, string>) || {}),
        ...((packageJson.devDependencies as Record<string, string>) || {}),
      }
    : {};
  const framework = packageJson ? frameworkFromPackageJson(packageJson) : "Unknown";
  const grouped = allFiles.reduce<Record<string, number>>((acc, file) => {
    const group = classifyProjectFile(file);
    acc[group] = (acc[group] || 0) + 1;
    return acc;
  }, {});
  const combinedText = `${JSON.stringify(packageJson || {})}\n${sampledText.join("\n")}`;

  return {
    ok: true,
    root: allowedRoot,
    packageName: String(packageJson?.name || path.basename(allowedRoot)),
    framework,
    packageManager: await detectPackageManager(allowedRoot),
    fileCount: allFiles.length,
    textFileCount: textFiles.length,
    grouped,
    dependencies: Object.keys(deps).sort(),
    capabilities: detectPaymentCapabilities(combinedText),
    importantFiles: allFiles
      .filter((file) => ["frontend", "api", "agent", "styles", "config", "tests"].includes(classifyProjectFile(file)))
      .slice(0, 120)
      .map((file) => ({
        file,
        relative: relativeProjectPath(file),
        group: classifyProjectFile(file),
      })),
  };
}

function buildUpdatedContent({
  oldContent,
  newContent,
  searchContent,
  mode,
  allowOverwrite,
}: {
  oldContent: string;
  newContent: string;
  searchContent: string;
  mode: string;
  allowOverwrite?: boolean;
}) {
  if (!newContent) throw new Error("Missing new content.");

  if (mode === "replace") {
    if (!searchContent) throw new Error("Missing exact code to replace.");
    if (!oldContent.includes(searchContent)) {
      throw new Error("Could not find the exact code to replace in the selected file.");
    }

    return oldContent.replace(searchContent, newContent);
  }

  if (mode === "overwrite") {
    if (!allowOverwrite) {
      throw new Error("Overwrite mode is disabled. Use replace mode with exact current code instead.");
    }

    return newContent;
  }

  if (oldContent.includes(newContent.trim())) {
    return oldContent;
  }

  if (!oldContent.trim()) {
    return newContent.trimEnd() + "\n";
  }

  if (/<\/body>/i.test(oldContent) && /<script|document\.|window\.|addEventListener|createElement/i.test(newContent)) {
    return oldContent.replace(/<\/body>/i, `${newContent.trim()}\n\n</body>`);
  }

  return `${oldContent.trimEnd()}\n\n${newContent.trim()}\n`;
}

async function runProjectCommand(command: string, args: string[]) {
  const displayCommand = [command, ...args]
    .map((part) => (/[\s"]/g.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part))
    .join(" ");

  try {
    const result = await execFileAsync(command, args, {
      cwd: allowedRoot,
      timeout: 45000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      shell: false,
    });

    return {
      ok: true,
      command: displayCommand,
      output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
    };
  } catch (err: unknown) {
    const maybe = err as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    return {
      ok: false,
      command: displayCommand,
      output: `${maybe.stdout || ""}${maybe.stderr || ""}${maybe.message || ""}`.trim(),
    };
  }
}

async function runGitCommand(args: string[]) {
  if (!allowedRoot) throw new Error("No project folder selected.");
  return runProjectCommand("git", args);
}

async function findDotnetTarget() {
  const dotnetFiles = await fg(["*.sln", "**/*.csproj", ...projectIgnoreGlobs], {
    cwd: allowedRoot,
    absolute: false,
    onlyFiles: true,
    suppressErrors: true,
  });

  return dotnetFiles.find((file) => /\.sln$/i.test(file)) || dotnetFiles[0] || "";
}

async function runPowerShellJson(script: string) {
  if (process.platform !== "win32") {
    return {
      ok: false,
      error: "Device Lab currently supports Windows diagnostics only.",
    };
  }

  const result = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      timeout: 30000,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
    }
  );

  return JSON.parse(result.stdout || "{}");
}

function testTcpPort(host: string, port: number, timeoutMs = 1800) {
  return new Promise<{ port: number; open: boolean; error: string }>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (open: boolean, error = "") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port, open, error });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (error) => finish(false, error.message));
    socket.connect(port, host);
  });
}

function luhnLooksValid(value: string) {
  let sum = 0;
  let doubleDigit = false;

  for (let i = value.length - 1; i >= 0; i--) {
    let digit = Number(value[i]);
    if (!Number.isFinite(digit)) return false;
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

function maskPan(pan: string) {
  if (pan.length < 10) return pan;
  return `${pan.slice(0, 6)}${"*".repeat(Math.max(0, pan.length - 10))}${pan.slice(-4)}`;
}

function redactSensitivePaymentData(input: string) {
  let sensitiveDataRedacted = false;
  const redacted = input.replace(/\b\d{13,19}\b/g, (candidate) => {
    if (!luhnLooksValid(candidate)) return candidate;
    sensitiveDataRedacted = true;
    return maskPan(candidate);
  });

  return {
    redacted: redacted
      .replace(/(%B)(\d{13,19})(\^)/g, (_match, prefix, pan, suffix) => {
        sensitiveDataRedacted = true;
        return `${prefix}${maskPan(pan)}${suffix}`;
      })
      .replace(/(;)(\d{13,19})(=)/g, (_match, prefix, pan, suffix) => {
        sensitiveDataRedacted = true;
        return `${prefix}${maskPan(pan)}${suffix}`;
      }),
    sensitiveDataRedacted,
  };
}

function parseSimpleTlv(hex: string) {
  const clean = hex.replace(/[^a-f0-9]/gi, "").toUpperCase();
  const tags: Array<{ tag: string; length: number; value: string }> = [];
  let cursor = 0;

  while (cursor + 4 <= clean.length && tags.length < 40) {
    let tag = clean.slice(cursor, cursor + 2);
    cursor += 2;

    if ((parseInt(tag, 16) & 0x1f) === 0x1f && cursor + 2 <= clean.length) {
      tag += clean.slice(cursor, cursor + 2);
      cursor += 2;
      while (cursor + 2 <= clean.length && parseInt(tag.slice(-2), 16) & 0x80) {
        tag += clean.slice(cursor, cursor + 2);
        cursor += 2;
      }
    }

    if (cursor + 2 > clean.length) break;
    let length = parseInt(clean.slice(cursor, cursor + 2), 16);
    cursor += 2;

    if (length & 0x80) {
      const bytes = length & 0x7f;
      if (cursor + bytes * 2 > clean.length) break;
      length = parseInt(clean.slice(cursor, cursor + bytes * 2), 16);
      cursor += bytes * 2;
    }

    const valueLength = length * 2;
    if (!Number.isFinite(length) || cursor + valueLength > clean.length) break;
    tags.push({ tag, length, value: clean.slice(cursor, cursor + valueLength) });
    cursor += valueLength;
  }

  return tags;
}

function analyzeCapturePayload(buffer: Buffer) {
  const rawHex = buffer.toString("hex").toUpperCase();
  const ascii = buffer.toString("utf8").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ".");
  const redactResult = redactSensitivePaymentData(ascii);
  const findings: string[] = [];
  let kind = "raw";

  if (/%B\d{6}/.test(ascii) || /;\d{6}/.test(ascii)) {
    kind = "msr-track";
    findings.push("Magstripe track-looking data detected. PAN was masked where present.");
  }

  const tlvTags = parseSimpleTlv(rawHex);
  const emvTags = tlvTags.filter((entry) => /^(9F|5F|82|84|95|9A|9C|9B|8A|57|5A)/.test(entry.tag));
  if (emvTags.length >= 2) {
    kind = kind === "raw" ? "emv-tlv" : `${kind}+emv`;
    findings.push(`EMV/TLV-looking data detected: ${emvTags.slice(0, 10).map((entry) => entry.tag).join(", ")}.`);
  }

  if (/APPROV|DECLIN|ERROR|TIMEOUT|SUCCESS|FAIL|RETURN_CODE|xResult|xStatus/i.test(ascii)) {
    kind = kind === "raw" ? "status-response" : `${kind}+status`;
    findings.push("Terminal/status response text detected.");
  }

  if (!findings.length) {
    findings.push("Captured raw device bytes. Attach vendor protocol details or logs for deeper decoding.");
  }

  return {
    rawHex,
    ascii,
    redacted: redactResult.redacted,
    analysis: {
      kind,
      summary:
        kind === "raw"
          ? "Raw device payload captured."
          : `Captured ${kind} payload from payment device connection.`,
      findings,
      sensitiveDataRedacted: redactResult.sensitiveDataRedacted,
    },
  };
}

function recordCaptureEvent(session: DeviceCaptureSession, direction: DeviceCaptureEvent["direction"], payload: Buffer | string) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  if (direction === "status" || direction === "error") {
    const ascii = buffer.toString("utf8");
    const rawHex = buffer.toString("hex").toUpperCase();
    const event: DeviceCaptureEvent = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      direction,
      rawHex,
      ascii,
      redacted: ascii,
      analysis: {
        kind: direction,
        summary: direction === "status" ? ascii : `Device capture error: ${ascii}`,
        findings:
          direction === "status"
            ? [
                "Connection status event. This is not card data.",
                "If no input events appear, the reader may require a vendor SDK/protocol command or may be a keyboard-wedge/HID device instead of serial output.",
              ]
            : [ascii],
        sensitiveDataRedacted: false,
      },
    };
    session.events.unshift(event);
    if (session.events.length > 200) session.events.pop();
    return event;
  }

  const analyzed = analyzeCapturePayload(buffer);
  const event: DeviceCaptureEvent = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    direction,
    ...analyzed,
  };
  session.events.unshift(event);
  if (session.events.length > 200) session.events.pop();
  return event;
}

function publicCaptureSession(session: DeviceCaptureSession) {
  return {
    id: session.id,
    mode: session.mode,
    label: session.label,
    startedAt: session.startedAt,
    status: session.status,
    error: session.error || "",
    eventCount: session.events.length,
    latestEvent: session.events[0] || null,
  };
}

async function loadSerialPortConstructor() {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<Record<string, unknown>>;
    const imported = await dynamicImport("serialport");
    return imported.SerialPort as
      | (new (options: {
          path: string;
          baudRate: number;
          autoOpen?: boolean;
        }) => {
          open: (callback: (error?: Error | null) => void) => void;
          close: (callback?: (error?: Error | null) => void) => void;
          write: (data: string | Buffer) => void;
          on: (event: string, callback: (...args: unknown[]) => void) => void;
        })
      | undefined;
  } catch {
    return undefined;
  }
}

function vendorAdapterPath(packId: string) {
  if (!/^[a-z0-9-]+$/i.test(packId)) throw new Error("Invalid vendor pack id.");
  return path.join(process.cwd(), "vendor-packs", `${packId}.cjs`);
}

function vendorConfigPath(packId: string) {
  if (!/^[a-z0-9-]+$/i.test(packId)) throw new Error("Invalid vendor pack id.");
  return path.join(process.cwd(), "vendor-packs", `${packId}.config.json`);
}

async function vendorConfigStatus(packId: string) {
  const configPath = vendorConfigPath(packId);
  if (!(await fileExists(configPath))) {
    return { configPath, configured: false, reason: "No bridge settings file yet." };
  }

  try {
    const config = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      sdkModule?: string;
      commands?: Record<string, { hex?: string; text?: string }>;
    };
    const hasSdk = Boolean(config.sdkModule && config.sdkModule.trim());
    const hasCommand = Object.values(config.commands || {}).some((command) =>
      Boolean((command.hex && command.hex.trim()) || (command.text && command.text.trim()))
    );

    return {
      configPath,
      configured: hasSdk || hasCommand,
      reason: hasSdk
        ? "SDK module configured."
        : hasCommand
          ? "Protocol command configured."
          : "Bridge settings exist but no SDK module or command bytes are set.",
    };
  } catch (error: unknown) {
    return { configPath, configured: false, reason: `Bridge settings JSON is invalid: ${errorMessage(error)}` };
  }
}

function vendorDefaultSettings(pack: VendorPackManifest) {
  return {
    timeoutMs: 10000,
    sdkModule: "",
    sdkMethods: Object.fromEntries(
      pack.actions.map((action) => [
        action.id,
        action.id.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
      ])
    ),
    commands: Object.fromEntries(
      pack.actions.map((action) => [
        action.id,
        {
          hex: "",
          text: "",
          encoding: "utf8",
          description: `Optional exact ${pack.vendor}-approved command for ${action.label}.`,
        },
      ])
    ),
  };
}

async function readVendorSettings(pack: VendorPackManifest) {
  const configPath = vendorConfigPath(pack.id);
  const defaults = vendorDefaultSettings(pack);

  if (!(await fileExists(configPath))) {
    return { ...defaults, configPath, exists: false };
  }

  const saved = JSON.parse(await fs.readFile(configPath, "utf8")) as Partial<ReturnType<typeof vendorDefaultSettings>>;
  const savedCommands = saved.commands || {};

  return {
    ...defaults,
    ...saved,
    commands: Object.fromEntries(
      Object.entries(defaults.commands).map(([actionId, command]) => [
        actionId,
        {
          ...command,
          ...(savedCommands as Record<string, Partial<typeof command>>)[actionId],
        },
      ])
    ),
    configPath,
    exists: true,
  };
}

function vendorAdapterTemplate(pack: VendorPackManifest) {
  const defaultActionId = pack.actions[0]?.id || "start-card-read";

  void defaultActionId;

  return `const { createVendorBridge } = require("./vendor-bridge-runtime.cjs");

exports.runAction = createVendorBridge({
  id: ${JSON.stringify(pack.id)},
  vendor: ${JSON.stringify(pack.vendor)},
});
`;
}

async function vendorPackStatus(pack: VendorPackManifest) {
  const adapterPath = vendorAdapterPath(pack.id);
  const installed = await fileExists(adapterPath);
  const configStatus = await vendorConfigStatus(pack.id);

  return {
    ...pack,
    adapterInstalled: installed,
    adapterConfigured: configStatus.configured,
    adapterPath,
    configPath: configStatus.configPath,
    configReason: configStatus.reason,
    status: installed
      ? configStatus.configured
        ? "ready"
        : "bridge-unconfigured"
      : pack.sdkRequired
        ? "adapter-required"
        : "ready",
  };
}

async function loadVendorAdapter(packId: string) {
  const adapterPath = vendorAdapterPath(packId);
  if (!(await fileExists(adapterPath))) {
    throw new Error(
      `PayFix PC-side vendor bridge is not installed. The terminal may already have the right firmware/files, but PayFix needs ${adapterPath} to call the approved vendor SDK/protocol from this computer.`
    );
  }

  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<Record<string, unknown>>;
  const adapter = await dynamicImport(`${pathToFileURL(adapterPath).href}?v=${Date.now()}`);

  const runAction = adapter.runAction || (adapter.default as { runAction?: unknown } | undefined)?.runAction;

  if (typeof runAction !== "function") {
    throw new Error(`Vendor adapter ${adapterPath} must export async function runAction(payload).`);
  }

  return runAction as (payload: Record<string, unknown>) => Promise<unknown>;
}

async function detectPackageManager(root: string) {
  if (await fileExists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(path.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

function safePackageName(name: string) {
  const trimmed = name.trim();

  if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(trimmed)) {
    throw new Error("Invalid package name.");
  }

  return trimmed;
}

async function fileExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function findNearestPackageRoot(startPath: string) {
  let current = path.resolve(startPath);

  try {
    const stat = await fs.stat(current);
    if (stat.isFile()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }

  for (let i = 0; i < 10; i++) {
    if (await fileExists(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return "";
}

function frameworkFromPackageJson(packageJson: Record<string, unknown>) {
  const deps = {
    ...((packageJson.dependencies as Record<string, unknown>) || {}),
    ...((packageJson.devDependencies as Record<string, unknown>) || {}),
  };

  if (deps.next) return "Next.js";
  if (deps.vite || deps["@vitejs/plugin-react"]) return "Vite";
  if (deps.react) return "React";
  if (deps["@angular/core"]) return "Angular";
  if (deps.vue) return "Vue";
  return "JavaScript";
}

function defaultPortsForFramework(framework: string) {
  if (framework === "Next.js") return [3000, 3001, 3002];
  if (framework === "Vite") return [5173, 5174];
  if (framework === "Angular") return [4200];
  return [];
}

async function packageRootInfo(root: string, port: number, reason: string, processHint = "") {
  const packageJsonPath = path.join(root, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const scripts = (packageJson.scripts as Record<string, string>) || {};
  const scriptsText = Object.values(scripts).join("\n");
  const framework = frameworkFromPackageJson(packageJson);
  const defaultPortMatch = defaultPortsForFramework(framework).includes(port);
  const scriptPortMatch = new RegExp(`(--port\\s+${port}|-p\\s+${port}|:${port}\\b|PORT\\s*=\\s*${port})`, "i").test(
    scriptsText
  );

  return {
    root,
    packageName: String(packageJson.name || path.basename(root)),
    framework,
    scripts,
    confidence: scriptPortMatch ? 96 : defaultPortMatch ? 82 : processHint ? 78 : 55,
    reason: scriptPortMatch
      ? `${reason}; package script references port ${port}`
      : defaultPortMatch
      ? `${reason}; ${framework} commonly serves this port`
      : reason,
    processHint,
  };
}

async function inferProjectRootsFromProcessClues(port: number, processes: { commandLine?: string; executablePath?: string }[]) {
  const pathMatches = new Set<string>();

  for (const processInfo of processes) {
    const text = `${processInfo.commandLine || ""} ${processInfo.executablePath || ""}`;
    for (const match of text.matchAll(/[A-Z]:\\(?:[^"'<>|]+?)(?=\s|$|")/gi)) {
      const matchedPath = match[0].trim();
      if (matchedPath.length > 3) pathMatches.add(matchedPath);
    }
  }

  const roots = new Map<string, Awaited<ReturnType<typeof packageRootInfo>>>();

  for (const matchedPath of pathMatches) {
    const root = await findNearestPackageRoot(matchedPath);
    if (!root || roots.has(root)) continue;
    roots.set(root, await packageRootInfo(root, port, "Matched project path from listening process command line", matchedPath));
  }

  return [...roots.values()];
}

async function scanLikelyProjectRoots(port: number) {
  const home = os.homedir();
  const bases = [
    allowedRoot,
    process.cwd(),
    path.join(home, "Documents"),
    path.join(home, "source", "repos"),
    path.join(home, "Downloads"),
  ].filter(Boolean);
  const uniqueBases = [...new Set(bases.map((base) => path.resolve(base)))];
  const roots = new Map<string, Awaited<ReturnType<typeof packageRootInfo>>>();

  for (const base of uniqueBases) {
    if (!(await fileExists(base))) continue;

    const packageFiles = await fg(["**/package.json", "!**/node_modules/**", "!**/.next/**", "!**/dist/**", "!**/build/**"], {
      cwd: base,
      absolute: true,
      onlyFiles: true,
      deep: 5,
      suppressErrors: true,
    });

    for (const packageFile of packageFiles.slice(0, 80)) {
      const root = path.dirname(packageFile);
      if (roots.has(root)) continue;

      try {
        const info = await packageRootInfo(root, port, "Matched package.json/framework clues near common project folders");
        if (info.confidence >= 80 || allowedRoot === root) roots.set(root, info);
      } catch {
        // Ignore invalid package.json files.
      }
    }
  }

  return [...roots.values()];
}

async function listeningProcessInfo(port: number) {
  if (process.platform !== "win32") {
    return {
      ok: false,
      error: "Port to project resolver currently supports Windows process inspection only.",
      port,
      processes: [],
    };
  }

  const script = String.raw`
$ErrorActionPreference = "SilentlyContinue"
$port = ${port}
$connections = @(Get-NetTCPConnection -LocalPort $port -State Listen)
$seen = @{}
$items = @()

foreach ($connection in $connections) {
  $pidValue = [int]$connection.OwningProcess
  $depth = 0
  while ($pidValue -gt 0 -and $depth -lt 8) {
    if (-not $seen.ContainsKey("$pidValue")) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue"
      if ($process) {
        $seen["$pidValue"] = $true
        $items += [pscustomobject]@{
          processId = $process.ProcessId
          parentProcessId = $process.ParentProcessId
          name = $process.Name
          executablePath = $process.ExecutablePath
          commandLine = $process.CommandLine
        }
        $pidValue = [int]$process.ParentProcessId
      } else {
        break
      }
    } else {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue"
      if ($process) { $pidValue = [int]$process.ParentProcessId } else { break }
    }
    $depth++
  }
}

[pscustomobject]@{
  ok = $true
  port = $port
  connectionCount = $connections.Count
  processes = @($items)
} | ConvertTo-Json -Depth 5
`;

  return runPowerShellJson(script);
}

app.post("/set-root", async (req, res) => {
  try {
    const requestedRoot =
      typeof req.body.root === "string" ? req.body.root.trim() : "";

    if (!requestedRoot) {
      throw new Error("Project path is required.");
    }

    const root = path.resolve(requestedRoot);
    await fs.access(root);
    const previousRoot = allowedRoot;
    allowedRoot = root;
    if (previousRoot && path.resolve(previousRoot) !== root) {
      clearWatchState();
    }
    res.json({ ok: true, root: allowedRoot });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.get("/status", (req, res) => {
  res.json({
    ok: true,
    agent: "PayFix Local Agent",
    root: allowedRoot || null,
  });
});

app.post("/app/resolve-project", async (req, res) => {
  try {
    const rawUrl = String(req.body.url || "").trim();
    const parsed = new URL(rawUrl || "http://localhost:3000");
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));

    if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      throw new Error("Project resolver only supports localhost URLs.");
    }

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("Could not determine localhost port.");
    }

    const processInfo = await listeningProcessInfo(port);
    const processCandidates = processInfo.ok
      ? await inferProjectRootsFromProcessClues(port, processInfo.processes || [])
      : [];
    const scannedCandidates = await scanLikelyProjectRoots(port);
    const byRoot = new Map<string, (typeof processCandidates)[number]>();

    for (const candidate of [...processCandidates, ...scannedCandidates]) {
      const existing = byRoot.get(candidate.root);
      if (!existing || candidate.confidence > existing.confidence) byRoot.set(candidate.root, candidate);
    }

    const candidates = [...byRoot.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 10);
    const best = candidates[0] || null;

    res.json({
      ok: true,
      url: rawUrl,
      port,
      resolved: Boolean(best && best.confidence >= 75),
      best,
      candidates,
      processInfo,
      currentRoot: allowedRoot || null,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.get("/files", async (req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const files = await listAllProjectFiles();
    const textSearchableFiles = new Set(await listProjectFiles());
    const fileStats = await Promise.all(
      files.slice(0, 500).map(async (file) => {
        const stat = await fs.stat(file);

        return {
          file,
          mime: fileMime(file),
          size: stat.size,
          readable: true,
          textSearchable: textSearchableFiles.has(file),
        };
      })
    );

    res.json({
      ok: true,
      count: files.length,
      readableCount: files.length,
      textSearchableCount: textSearchableFiles.size,
      files: fileStats,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/read-file", async (req, res) => {
  try {
    const file = safePath(req.body.file);
    const content = await fs.readFile(file, "utf8");

    const lines = content.split(/\r?\n/).map((text, i) => ({
      line: i + 1,
      text,
    }));

    res.json({
      ok: true,
      file,
      lines,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/project/read-file-ai", async (req, res) => {
  try {
    const file = safePath(req.body.file);
    const fileData = await readFileForAi(file);

    res.json({
      ok: true,
      file: fileData,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/project/read-selected", async (req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const requestedFiles = Array.isArray(req.body.files) ? req.body.files : [];
    const files = requestedFiles
      .map((file: unknown) => String(file || "").trim())
      .filter(Boolean)
      .slice(0, 12);

    if (!files.length) throw new Error("No files selected for reading.");

    const skippedFiles: Array<{ file: string; reason: string }> = [];
    const readFiles = (
      await Promise.all(
        files.map(async (file: string) => {
          try {
            const safeFile = safePath(file);
            if (!(await fileExists(safeFile))) {
              skippedFiles.push({
                file,
                reason: "File does not exist yet. It can still be created by an Apply preview.",
              });
              return null;
            }
            return readFileForAi(safeFile);
          } catch (err: unknown) {
            skippedFiles.push({ file, reason: errorMessage(err) });
            return null;
          }
        })
      )
    ).filter(Boolean);

    res.json({
      ok: true,
      root: allowedRoot,
      filesRead: readFiles.length,
      files: readFiles,
      skippedFiles,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/search", async (req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const query = String(req.body.query || "").toLowerCase();
    if (!query) throw new Error("Missing query.");

    const files = await listAllProjectFiles();

    const results: TextSearchResult[] = [];

    for (const file of files.slice(0, 1000)) {
      const content = await fs.readFile(file, "utf8").catch(() => "");
      const lines = content.split(/\r?\n/);

      lines.forEach((text, index) => {
        if (text.toLowerCase().includes(query)) {
          results.push({
            file,
            line: index + 1,
            text: text.trim(),
          });
        }
      });
    }

    res.json({
      ok: true,
      results: results.slice(0, 100),
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.get("/xlog/latest", async (req, res) => {
  try {
    const tempDir = process.env.TEMP || process.env.TMP || os.tmpdir();
    const xlogDir = path.join(tempDir, "xlog");

    const files = await fg(["**/*.{log,txt,json}"], {
      cwd: xlogDir,
      absolute: true,
      onlyFiles: true,
    });

    const sorted = await Promise.all(
      files.map(async (file) => {
        const stat = await fs.stat(file);
        return {
          file,
          modified: stat.mtimeMs,
        };
      })
    );

    sorted.sort((a, b) => b.modified - a.modified);

    const latest = sorted.slice(0, 5);

    const logs = await Promise.all(
      latest.map(async (item) => {
        const content = await fs.readFile(item.file, "utf8").catch(() => "");
        return {
          file: item.file,
          modified: new Date(item.modified).toISOString(),
          content: content.slice(-15000),
        };
      })
    );

    res.json({
      ok: true,
      tempDir,
      xlogDir,
      count: files.length,
      latest: logs,
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.post("/project/context", async (req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const question = String(req.body.question || "");
    const keywords = [
      ...question
        .split(/\s+/)
        .map((x) => x.replace(/[^a-zA-Z0-9_]/g, ""))
        .filter((x) => x.length >= 4),
      "xMagstripe",
      "xCommand",
      "gatewayjson",
      "fetch",
      "axios",
      "emv",
      "tlv",
    ];

    const files = await listAllProjectFiles();

    const matches: ProjectMatch[] = [];

    for (const file of files.slice(0, 1000)) {
      const content = await fs.readFile(file, "utf8").catch(() => "");
      const lines = content.split(/\r?\n/);

     const fileName = path.basename(file).toLowerCase();

const fileNameMatched = keywords.some((k) =>
  fileName.includes(k.toLowerCase())
);

if (fileNameMatched) {
  matches.push({
    file,
    line: 0,
    text: "[FILENAME MATCH]",
  });
}

lines.forEach((text, index) => {
  const lower = text.toLowerCase();

  if (keywords.some((k) => lower.includes(k.toLowerCase()))) {
    matches.push({
      file,
      line: index + 1,
      text: text.trim(),
    });
  }
});
    }

    const topMatches = matches.slice(0, 80);

    res.json({
      ok: true,
      root: allowedRoot,
      matchCount: matches.length,
      matches: topMatches,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/computer/search", async (req, res) => {
  try {
    const root = path.resolve(String(req.body.root || ""));
    const query = String(req.body.query || "").toLowerCase();
    const fileName = String(req.body.fileName || "").toLowerCase();

    if (!root) throw new Error("Missing root folder.");
    if (!query && !fileName) throw new Error("Missing search query or file name.");

    await fs.access(root);

    const files = await fg(
      [
        "**/*.{ts,tsx,js,jsx,cs,json,txt,log,md,html,css,config,xml,csproj,sln}",
        "!**/node_modules/**",
        "!**/dist/**",
        "!**/build/**",
        "!**/.next/**",
        "!**/bin/**",
        "!**/obj/**",
        "!**/AppData/**",
        "!**/Application Data/**",
        "!**/Local Settings/**",
        "!**/Cookies/**",
        "!**/Recent/**",
        "!**/SendTo/**",
        "!**/Start Menu/**",
        "!**/Templates/**",
        "!**/OneDrive/**",
      ],
      {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        dot: false,
        suppressErrors: true,
      }
    );

    const results: TextSearchResult[] = [];

    for (const file of files.slice(0, 5000)) {
      const base = path.basename(file).toLowerCase();

     if (fileName && base.includes(fileName)) {
        const content = await fs.readFile(file, "utf8").catch(() => "");

        results.push({
          type: "filename",
          file,
          line: 0,
          text: `[FILENAME MATCH]\n\nFILE CONTENT:\n${content.slice(0, 20000)}`,
        });
}

      if (query) {
        const content = await fs.readFile(file, "utf8").catch(() => "");
        const lines = content.split(/\r?\n/);

        lines.forEach((text, index) => {
          if (text.toLowerCase().includes(query)) {
            results.push({
              type: "content",
              file,
              line: index + 1,
              text: text.trim(),
            });
          }
        });
      }

      if (results.length >= 150) break;
    }

    res.json({
      ok: true,
      root,
      searchedFiles: files.length,
      results,
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.post("/project/read-relevant", async (req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const question = String(req.body.question || "").toLowerCase();

    const files = await listAllProjectFiles();

    const keywords = question
      .split(/\s+/)
      .map((x) => x.replace(/[^a-zA-Z0-9_.-]/g, ""))
      .filter((x) => x.length >= 4);

    const matches = files.filter((file) => {
      const name = file.toLowerCase();
      return keywords.some((k) => name.includes(k.toLowerCase()));
    });

    const targetFiles = matches.length ? matches.slice(0, 10) : files.slice(0, 10);

    const readFiles = await Promise.all(targetFiles.map((file) => readFileForAi(file)));

    res.json({
      ok: true,
      root: allowedRoot,
      filesRead: readFiles.length,
      files: readFiles,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/project/find-file", async (req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const fileName = String(req.body.fileName || "").toLowerCase();
    if (!fileName) throw new Error("Missing file name.");

    const files = await fg(
      [
        "**/*.{css,scss,html,js,jsx,ts,tsx,json,cs,txt,md}",
        "!**/node_modules/**",
        "!**/dist/**",
        "!**/build/**",
        "!**/.next/**",
        "!**/bin/**",
        "!**/obj/**",
      ],
      {
        cwd: allowedRoot,
        absolute: true,
        onlyFiles: true,
        suppressErrors: true,
      }
    );

    const matches = files.filter((file) =>
      path.basename(file).toLowerCase().includes(fileName)
    );

    res.json({
      ok: true,
      matches,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/project/apply-css-color", async (req, res) => {
  try {
    const file = safePath(req.body.file);
    const selector = String(req.body.selector || "").trim();
    const property = String(req.body.property || "color").trim();
    const color = String(req.body.color || "").trim();
    const apply = Boolean(req.body.apply);

    if (!selector) throw new Error("Missing selector.");
    if (!property) throw new Error("Missing CSS property.");
    if (!color) throw new Error("Missing color.");

    const original = await fs.readFile(file, "utf8");

    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const selectorRegex = new RegExp(
      `(${escapedSelector}\\s*\\{)([\\s\\S]*?)(\\})`,
      "m"
    );

    let selectorFound = false;
    let propertyFound = false;
    let oldValue = "";
    const newValue = color;

    let updated = original;

    if (selectorRegex.test(original)) {
      updated = original.replace(selectorRegex, (_full, open, body, close) => {
        selectorFound = true;

        const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const propertyRegex = new RegExp(
  `(^|\\n)(\\s*)(${escapedProperty}\\s*:\\s*)([^;]+)(;)`,
  "i"
);

if (propertyRegex.test(body)) {
  propertyFound = true;

  body = body.replace(
    propertyRegex,
    (
      _match: string,
      lineStart: string,
      indent: string,
      before: string,
      currentValue: string,
      semi: string
    ) => {
      oldValue = String(currentValue).trim();
      return `${lineStart}${indent}${before}${color}${semi}`;
    }
  );
} else {
  body = `${body.trimEnd()}\n  ${property}: ${color};\n`;
}
        

        return `${open}${body}${close}`;
      });
    } else {
      updated = `${original.trimEnd()}

${selector} {
  ${property}: ${color};
}
`;
    }

    if (apply) {
      await fs.writeFile(file, updated, "utf8");
    }

    res.json({
      ok: true,
      file,
      selector,
      property,
      selectorFound,
      propertyFound,
      oldValue: oldValue || null,
      newValue,
      applied: apply,
      message: apply
        ? `Applied ${property}: ${color} to ${selector}`
        : `Preview ready for ${property}: ${color} on ${selector}`,
      preview: updated.slice(0, 30000),
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.post("/project/write-file", async (req, res) => {
  try {
    const file = safePath(req.body.file);
    const content = String(req.body.content || "");
    const apply = Boolean(req.body.apply);

    const oldContent = await fs.readFile(file, "utf8").catch(() => "");

    if (apply) {
      await fs.writeFile(file, content, "utf8");
    }

    res.json({
      ok: true,
      file,
      applied: apply,
      oldPreview: oldContent.slice(0, 5000),
      newPreview: content.slice(0, 5000),
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/project/preview-write-file", async (req, res) => {
  try {
    const file = safePath(req.body.file);
    const newContent = String(req.body.content || "");
    const searchContent = String(req.body.search || "");
    const mode = String(req.body.mode || "insert");
    const apply = Boolean(req.body.apply);

    const fileExisted = await fileExists(file);
    const oldContent = fileExisted ? await fs.readFile(file, "utf8") : "";
    const updatedContent = buildUpdatedContent({
      oldContent,
      newContent,
      searchContent,
      mode,
      allowOverwrite: Boolean(req.body.allowOverwrite),
    });

    if (apply) {
      const rollbackId = crypto.randomUUID();
      const snapshot = {
        id: rollbackId,
        file,
        relative: relativeProjectPath(file),
        previousContent: oldContent,
        fileExisted,
        createdAt: new Date().toISOString(),
        reason: String(req.body.reason || "Apply file change"),
      };
      rollbackSnapshots.set(rollbackId, snapshot);
      if (rollbackSnapshots.size > 50) {
        const oldest = [...rollbackSnapshots.values()].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )[0];
        if (oldest) rollbackSnapshots.delete(oldest.id);
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, updatedContent, "utf8");
    }

    const latestRollback = apply
      ? [...rollbackSnapshots.values()]
          .filter((snapshot) => snapshot.file === file)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
      : null;

    res.json({
      ok: true,
      file,
      created: !fileExisted,
      mode,
      applied: apply,
      oldContent,
      newContent: updatedContent,
      rollback: latestRollback
        ? {
            id: latestRollback.id,
            file: latestRollback.file,
            relative: latestRollback.relative,
            fileExisted: latestRollback.fileExisted,
            createdAt: latestRollback.createdAt,
            reason: latestRollback.reason,
          }
        : null,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.get("/project/rollback/list", (_req, res) => {
  res.json({
    ok: true,
    snapshots: [...rollbackSnapshots.values()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((snapshot) => ({
        id: snapshot.id,
        file: snapshot.file,
        relative: snapshot.relative,
        fileExisted: snapshot.fileExisted,
        createdAt: snapshot.createdAt,
        reason: snapshot.reason,
      })),
  });
});

app.post("/project/rollback/apply", async (req, res) => {
  try {
    const id = String(req.body.id || "");
    const snapshot = rollbackSnapshots.get(id);
    if (!snapshot) throw new Error("Rollback snapshot was not found.");

    const file = safePath(snapshot.file);
    if (snapshot.fileExisted) {
      await fs.writeFile(file, snapshot.previousContent, "utf8");
    } else {
      await fs.unlink(file).catch(() => undefined);
    }
    rollbackSnapshots.delete(id);

    const message = snapshot.fileExisted
      ? `Restored ${relativeProjectPath(file)} from rollback snapshot.`
      : `Deleted newly created file ${relativeProjectPath(file)}.`;

    res.json({
      ok: true,
      restored: true,
      deleted: !snapshot.fileExisted,
      file,
      relative: relativeProjectPath(file),
      message,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.get("/project/git/status", async (_req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const inside = await runGitCommand(["rev-parse", "--is-inside-work-tree"]);
    if (!inside.ok || !/true/i.test(inside.output)) {
      throw new Error("Connected project is not inside a Git repository.");
    }

    const branch = await runGitCommand(["branch", "--show-current"]);
    const status = await runGitCommand(["status", "--short"]);
    const diffStat = await runGitCommand(["diff", "--stat"]);
    const changedFiles = status.output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        status: line.slice(0, 2).trim() || "modified",
        file: line.slice(3).trim() || line,
      }));

    res.json({
      ok: true,
      root: allowedRoot,
      branch: branch.output.trim() || "unknown",
      dirty: changedFiles.length > 0,
      changedFiles,
      diffStat: diffStat.output,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/project/git/commit", async (req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const message = String(req.body.message || "").trim();
    if (message.length < 6) throw new Error("Commit message is too short.");

    const inside = await runGitCommand(["rev-parse", "--is-inside-work-tree"]);
    if (!inside.ok || !/true/i.test(inside.output)) {
      throw new Error("Connected project is not inside a Git repository.");
    }

    const statusBefore = await runGitCommand(["status", "--short"]);
    if (!statusBefore.output.trim()) {
      throw new Error("No Git changes to commit.");
    }

    const add = await runGitCommand(["add", "--all"]);
    if (!add.ok) throw new Error(add.output || "git add failed.");

    const commit = await runGitCommand(["commit", "-m", message]);
    if (!commit.ok) throw new Error(commit.output || "git commit failed.");

    const statusAfter = await runGitCommand(["status", "--short"]);

    res.json({
      ok: true,
      message,
      output: commit.output,
      clean: !statusAfter.output.trim(),
      status: statusAfter.output,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/project/git/revert-last-commit", async (_req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const inside = await runGitCommand(["rev-parse", "--is-inside-work-tree"]);
    if (!inside.ok || !/true/i.test(inside.output)) {
      throw new Error("Connected project is not inside a Git repository.");
    }

    const head = await runGitCommand(["rev-parse", "--verify", "HEAD"]);
    if (!head.ok) throw new Error("No Git commit is available to revert.");

    const revert = await runGitCommand(["revert", "--no-edit", "HEAD"]);
    if (!revert.ok) throw new Error(revert.output || "git revert failed.");

    const statusAfter = await runGitCommand(["status", "--short"]);

    res.json({
      ok: true,
      output: revert.output,
      clean: !statusAfter.output.trim(),
      status: statusAfter.output,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/project/validate-file-change", async (req, res) => {
  let file = "";
  let oldContent = "";
  let fileExisted = false;
  let restored = false;

  try {
    file = safePath(req.body.file);
    const newContent = String(req.body.content || "");
    const searchContent = String(req.body.search || "");
    const mode = String(req.body.mode || "replace");

    fileExisted = await fileExists(file);
    oldContent = fileExisted ? await fs.readFile(file, "utf8") : "";
    const updatedContent = buildUpdatedContent({
      oldContent,
      newContent,
      searchContent,
      mode,
      allowOverwrite: Boolean(req.body.allowOverwrite),
    });

    if (updatedContent === oldContent) {
      throw new Error("Validation refused: proposed change does not modify the file.");
    }

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, updatedContent, "utf8");

    const commands: Awaited<ReturnType<typeof runProjectCommand>>[] = [];
    const packageJson = path.join(allowedRoot, "package.json");
    const hasPackageJson = await fileExists(packageJson);
    const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

    if (hasPackageJson) {
      commands.push(await runProjectCommand(npxCommand, ["tsc", "--noEmit"]));

      const relativeFile = path.relative(allowedRoot, file);
      if (/\.(ts|tsx|js|jsx)$/i.test(file)) {
        commands.push(await runProjectCommand(npxCommand, ["eslint", relativeFile]));
      }
    }

    const dotnetTarget = await findDotnetTarget();
    if (dotnetTarget && /\.(cs|csproj|config|json|xml)$/i.test(file)) {
      commands.push(await runProjectCommand("dotnet", ["build", dotnetTarget, "--nologo"]));
    }

    if (fileExisted) {
      await fs.writeFile(file, oldContent, "utf8");
    } else {
      await fs.unlink(file).catch(() => undefined);
    }
    restored = true;

    const failed = commands.filter((command) => !command.ok);

    res.json({
      ok: failed.length === 0,
      file,
      restored,
      skipped: !hasPackageJson,
      commands,
      error: failed.length
        ? `Validation failed: ${failed.map((command) => command.command).join(", ")}`
        : "",
    });
  } catch (err: unknown) {
    if (file && !restored) {
      if (fileExisted) {
        await fs.writeFile(file, oldContent, "utf8").catch(() => undefined);
      } else {
        await fs.unlink(file).catch(() => undefined);
      }
      restored = true;
    }

    res.status(400).json({
      ok: false,
      file,
      restored,
      error: errorMessage(err),
    });
  }
});

app.get("/project/diagnostics", async (_req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const packageJson = await readPackageJsonSafe();
    const scripts = ((packageJson?.scripts as Record<string, string>) || {});
    const hasPackageJson = Boolean(packageJson);
    const commands: Awaited<ReturnType<typeof runProjectCommand>>[] = [];
    const skipped: string[] = [];
    const dotnetTarget = await findDotnetTarget();

    if (hasPackageJson) {
      const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
      const packageManager = await detectPackageManager(allowedRoot);
      const pmCommand =
        process.platform === "win32"
          ? `${packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm"}.cmd`
          : packageManager === "pnpm"
            ? "pnpm"
            : packageManager === "yarn"
              ? "yarn"
              : "npm";

      if (await fileExists(path.join(allowedRoot, "tsconfig.json"))) {
        commands.push(await runProjectCommand(npxCommand, ["tsc", "--noEmit"]));
      } else {
        skipped.push("TypeScript diagnostics skipped: no tsconfig.json found.");
      }

      if (scripts.lint) {
        commands.push(await runProjectCommand(pmCommand, ["run", "lint"]));
      } else {
        skipped.push("Lint diagnostics skipped: package.json has no lint script.");
      }
    } else {
      skipped.push("npm/yarn/pnpm diagnostics skipped: no package.json found.");
    }

    if (dotnetTarget) {
      commands.push(await runProjectCommand("dotnet", ["build", dotnetTarget, "--nologo"]));
    } else {
      skipped.push("dotnet diagnostics skipped: no .sln or .csproj file found.");
    }

    const failed = commands.filter((command) => !command.ok);

    res.json({
      ok: failed.length === 0,
      skipped,
      commands,
      error: failed.length
        ? `Diagnostics failed: ${failed.map((command) => command.command).join(", ")}`
        : "",
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.get("/project/package-info", async (_req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const packageJsonPath = path.join(allowedRoot, "package.json");
    const hasPackageJson = await fileExists(packageJsonPath);

    if (!hasPackageJson) {
      res.json({
        ok: true,
        hasPackageJson: false,
        packageManager: "",
        dependencies: {},
        devDependencies: {},
      });
      return;
    }

    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

    res.json({
      ok: true,
      hasPackageJson: true,
      packageManager: await detectPackageManager(allowedRoot),
      dependencies: packageJson.dependencies || {},
      devDependencies: packageJson.devDependencies || {},
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.get("/project/memory", async (_req, res) => {
  try {
    const memory = await projectFingerprint();
    res.json(memory);
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.get("/project/map", async (_req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const files = await listProjectFiles();
    const grouped: Record<string, Array<{ file: string; relative: string; imports: string[] }>> = {
      frontend: [],
      api: [],
      agent: [],
      styles: [],
      tests: [],
      config: [],
      other: [],
    };
    const edges: Array<{ from: string; to: string }> = [];

    for (const file of files.slice(0, 450)) {
      const relative = relativeProjectPath(file);
      let imports: string[] = [];

      if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) {
        try {
          imports = extractImportsFromText((await fs.readFile(file, "utf8")).slice(0, 120000));
          for (const imported of imports) {
            edges.push({ from: relative, to: imported });
          }
        } catch {
          imports = [];
        }
      }

      grouped[classifyProjectFile(file)].push({
        file,
        relative,
        imports,
      });
    }

    res.json({
      ok: true,
      root: allowedRoot,
      generatedAt: new Date().toISOString(),
      grouped,
      edges: edges.slice(0, 1000),
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.post("/project/sandbox-runner", async (req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const requested = Array.isArray(req.body?.checks) ? req.body.checks.map(String) : [];
    const packageJson = await readPackageJsonSafe();
    const scripts = ((packageJson?.scripts as Record<string, string>) || {});
    const hasPackageJson = Boolean(packageJson);
    const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
    const packageManager = await detectPackageManager(allowedRoot);
    const pmCommand =
      process.platform === "win32"
        ? `${packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm"}.cmd`
        : packageManager === "pnpm"
          ? "pnpm"
          : packageManager === "yarn"
            ? "yarn"
            : "npm";
    const checks = requested.length ? requested : ["typescript", "lint", "test", "build"];
    const commands: Awaited<ReturnType<typeof runProjectCommand>>[] = [];
    const skipped: string[] = [];
    const dotnetFiles = await fg(["*.sln", "**/*.csproj", ...projectIgnoreGlobs], {
      cwd: allowedRoot,
      absolute: false,
      onlyFiles: true,
      suppressErrors: true,
    });
    const dotnetTarget = dotnetFiles.find((file) => /\.sln$/i.test(file)) || dotnetFiles[0] || "";

    if (!hasPackageJson) {
      skipped.push("No package.json found, so npm/yarn/pnpm checks were skipped.");
    }

    if (checks.includes("typescript")) {
      if (await fileExists(path.join(allowedRoot, "tsconfig.json"))) {
        commands.push(await runProjectCommand(npxCommand, ["tsc", "--noEmit"]));
      } else {
        skipped.push("TypeScript skipped: no tsconfig.json found.");
      }
    }

    if (hasPackageJson && checks.includes("lint")) {
      if (scripts.lint) {
        commands.push(await runProjectCommand(pmCommand, ["run", "lint"]));
      } else {
        skipped.push("Lint skipped: package.json has no lint script.");
      }
    }

    if (hasPackageJson && checks.includes("test")) {
      if (scripts.test && !/no test specified/i.test(scripts.test)) {
        commands.push(await runProjectCommand(pmCommand, ["run", "test"]));
      } else {
        skipped.push("Tests skipped: package.json has no real test script.");
      }
    }

    if (hasPackageJson && checks.includes("build")) {
      if (scripts.build) {
        commands.push(await runProjectCommand(pmCommand, ["run", "build"]));
      } else {
        skipped.push("Build skipped: package.json has no build script.");
      }
    }

    if (dotnetTarget && (checks.includes("build") || checks.includes("dotnet"))) {
      commands.push(await runProjectCommand("dotnet", ["build", dotnetTarget, "--nologo"]));
    } else if (!dotnetTarget && checks.includes("dotnet")) {
      skipped.push("dotnet skipped: no .sln or .csproj file found.");
    }

    if (dotnetTarget && checks.includes("test")) {
      const testProjects = dotnetFiles.filter((file) => /test/i.test(file) && /\.csproj$/i.test(file));
      if (testProjects.length) {
        for (const testProject of testProjects.slice(0, 3)) {
          commands.push(await runProjectCommand("dotnet", ["test", testProject, "--nologo", "--no-restore"]));
        }
      } else if (!hasPackageJson) {
        skipped.push("dotnet test skipped: no obvious test .csproj found.");
      }
    }

    const failed = commands.filter((command) => !command.ok);

    res.json({
      ok: failed.length === 0,
      root: allowedRoot,
      packageManager,
      commands,
      skipped,
      error: failed.length ? `Sandbox runner failed: ${failed.map((command) => command.command).join(", ")}` : "",
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.post("/project/watch/start", async (req, res) => {
  try {
    const file = safePath(String(req.body.file || ""));
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Watch mode currently watches a single file path.");

    const id = crypto.createHash("sha1").update(file).digest("hex").slice(0, 12);
    activeWatchers.get(id)?.watcher.close();
    for (let index = watchEvents.length - 1; index >= 0; index -= 1) {
      if (watchEvents[index].watcherId === id) watchEvents.splice(index, 1);
    }
    watchLastSignatures.delete(id);
    const initialSnapshot = await readWatchSnapshot(file);
    watchSnapshots.set(id, initialSnapshot);

    const watcher = watch(file, { persistent: false }, (eventType) => {
      const existingTimer = watchTimers.get(id);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(async () => {
        const previous = watchSnapshots.get(id) || "";
        const current = await readWatchSnapshot(file);
        const change = summarizeTextChange(previous, current);
        const issues = await diagnoseWatchedFile(file, current);
        const analysis = analyzeWatchedChange(file, change, issues);
        const signature = `${eventType}:${current}:${issues.map((issue) => issue.message).join("|")}`;

        watchTimers.delete(id);
        if (watchLastSignatures.get(id) === signature) return;

        watchSnapshots.set(id, current);
        watchLastSignatures.set(id, signature);

        watchEvents.unshift({
          eventId: crypto.randomUUID(),
          watcherId: id,
          file,
          relative: relativeProjectPath(file),
          eventType,
          at: new Date().toISOString(),
          ...change,
          issues,
          analysis,
        });

        if (watchEvents.length > 100) watchEvents.pop();
      }, 250);

      watchTimers.set(id, timer);
    });

    activeWatchers.set(id, {
      file,
      watcher,
      startedAt: new Date().toISOString(),
    });

    const initialChange = summarizeTextChange(initialSnapshot, initialSnapshot);
    const initialIssues = await diagnoseWatchedFile(file, initialSnapshot);
    const initialAnalysis = analyzeWatchedChange(file, initialChange, initialIssues);
    watchEvents.unshift({
      eventId: crypto.randomUUID(),
      watcherId: id,
      file,
      relative: relativeProjectPath(file),
      eventType: "initial scan",
      at: new Date().toISOString(),
      ...initialChange,
      issues: initialIssues,
      analysis: initialAnalysis,
    });
    if (watchEvents.length > 100) watchEvents.pop();

    res.json({
      ok: true,
      id,
      file,
      relative: relativeProjectPath(file),
      message: `Watching ${relativeProjectPath(file)} for changes.`,
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.post("/project/watch/stop", async (req, res) => {
  const id = String(req.body.id || "");
  const watcher = activeWatchers.get(id);
  watcher?.watcher.close();
  activeWatchers.delete(id);
  watchSnapshots.delete(id);
  watchLastSignatures.delete(id);
  const timer = watchTimers.get(id);
  if (timer) clearTimeout(timer);
  watchTimers.delete(id);

  res.json({
    ok: true,
    stopped: Boolean(watcher),
    id,
  });
});

app.post("/project/watch/clear", (_req, res) => {
  clearWatchState();

  res.json({
    ok: true,
    watchers: [],
    events: [],
    message: "Watch state cleared.",
  });
});

app.get("/project/structural-scan", async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 80)));
    res.json(await scanProjectStructuralIssues(limit));
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.get("/project/watch/events", (_req, res) => {
  res.json({
    ok: true,
    watchers: [...activeWatchers.entries()].map(([id, watcher]) => ({
      id,
      file: watcher.file,
      relative: relativeProjectPath(watcher.file),
      startedAt: watcher.startedAt,
    })),
    events: compactWatchEventsForUi(),
  });
});

app.post("/project/install-package", async (req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const packageName = safePackageName(String(req.body.packageName || ""));
    const dev = Boolean(req.body.dev);
    const packageManager = await detectPackageManager(allowedRoot);

    const commandName = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm";
    const command = process.platform === "win32" ? `${commandName}.cmd` : commandName;
    const args =
      packageManager === "yarn"
        ? ["add", ...(dev ? ["-D"] : []), packageName]
        : ["install", ...(dev ? ["-D"] : []), packageName];

    const result = await runProjectCommand(command, args);

    res.json({
      ok: result.ok,
      packageName,
      packageManager,
      command: result.command,
      output: result.output,
      error: result.ok ? "" : result.output || "Package install failed.",
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    root: allowedRoot,
    uptime: process.uptime(),
  });
});

app.get("/device/scan", async (_req, res) => {
  try {
    const script = String.raw`
$ErrorActionPreference = "SilentlyContinue"
$paymentPattern = "ID TECH|IDTECH|Verifone|Ingenico|PAX|Dejavoo|MagTek|Magstripe|BBPOS|Cardknox|SRED|MSR|EMV|PIN Pad|Pinpad|Card Reader|Credit Card|Payment|NFC|Contactless|ViVOpay|Augusta|SREDKey|VP[0-9]|UniPay|WisePad|Lane[ /-]?[0-9]|ISC[0-9]|VX[0-9]|MX[0-9]"
$paymentVidPattern = "VID_0ACD|VID_11CA|VID_0B00|VID_079B|VID_1FC9|VID_2FB8|VID_2D94|VID_05E0"

function Get-PayfixDeviceScore($device) {
  $text = (($device.FriendlyName, $device.Name, $device.Description, $device.Manufacturer, $device.InstanceId, $device.PNPDeviceID, $device.PNPClass, $device.Class) -join " ")
  $score = 0
  $reasons = @()
  if ($text -match $paymentPattern) { $score += 80; $reasons += "payment vendor/name match" }
  if ($text -match $paymentVidPattern) { $score += 55; $reasons += "known payment VID/PID hint" }
  if ($text -match "USB Serial|Virtual COM|Serial|COM\d+") { $score += 20; $reasons += "serial/COM interface" }
  if ($text -match "HIDClass|Human Interface") { $score += 15; $reasons += "HID interface" }
  if (($device.Status -and $device.Status -ne "OK") -or ($device.ConfigManagerErrorCode -and $device.ConfigManagerErrorCode -ne 0)) { $score += 10; $reasons += "driver/status issue" }
  [pscustomobject]@{ score = $score; reasons = $reasons }
}

function Test-PayfixPresentDevice($device) {
  if ($device.Problem -eq 45 -or $device.ConfigManagerErrorCode -eq 45) { return $false }
  if ($device.Status -eq "Unknown") { return $false }
  return $true
}

$pnpRaw = @(Get-PnpDevice | Select-Object Class,FriendlyName,InstanceId,Manufacturer,Status,Problem)
$serialRaw = @(Get-CimInstance Win32_SerialPort | Select-Object DeviceID,Name,Description,Manufacturer,PNPDeviceID,Status)
$usbRaw = @(Get-CimInstance Win32_PnPEntity |
  Where-Object { $_.PNPDeviceID -like "USB\*" -or $_.Name -match $paymentPattern -or $_.Manufacturer -match $paymentPattern } |
  Select-Object Name,Manufacturer,PNPClass,PNPDeviceID,Status,ConfigManagerErrorCode)
$hidRaw = @(Get-PnpDevice -Class HIDClass | Select-Object Class,FriendlyName,InstanceId,Manufacturer,Status,Problem)

$suspected = @()
foreach ($device in @($pnpRaw + $serialRaw + $usbRaw + $hidRaw)) {
  if (-not (Test-PayfixPresentDevice $device)) { continue }
  $scored = Get-PayfixDeviceScore $device
  if ($scored.score -ge 50) {
    $suspected += [pscustomobject]@{
      score = $scored.score
      reasons = @($scored.reasons)
      Class = $device.Class
      FriendlyName = $device.FriendlyName
      Name = $device.Name
      Description = $device.Description
      InstanceId = $device.InstanceId
      PNPDeviceID = $device.PNPDeviceID
      DeviceID = $device.DeviceID
      Manufacturer = $device.Manufacturer
      PNPClass = $device.PNPClass
      Status = $device.Status
      Problem = $device.Problem
      ConfigManagerErrorCode = $device.ConfigManagerErrorCode
    }
  }
}

$comPorts = @()
foreach ($device in $serialRaw) {
  if (-not (Test-PayfixPresentDevice $device)) { continue }
  $scored = Get-PayfixDeviceScore $device
  if ($scored.score -ge 20 -or $device.DeviceID -match "^COM\d+$") {
    $comPorts += [pscustomobject]@{
      score = $scored.score
      reasons = @($scored.reasons)
      DeviceID = $device.DeviceID
      Name = $device.Name
      Description = $device.Description
      Manufacturer = $device.Manufacturer
      PNPDeviceID = $device.PNPDeviceID
      Status = $device.Status
    }
  }
}

$usb = @()
foreach ($device in $usbRaw) {
  if (-not (Test-PayfixPresentDevice $device)) { continue }
  $scored = Get-PayfixDeviceScore $device
  if ($scored.score -ge 50) {
    $usb += [pscustomobject]@{
      score = $scored.score
      reasons = @($scored.reasons)
      Name = $device.Name
      Manufacturer = $device.Manufacturer
      PNPClass = $device.PNPClass
      PNPDeviceID = $device.PNPDeviceID
      Status = $device.Status
      ConfigManagerErrorCode = $device.ConfigManagerErrorCode
    }
  }
}

$hid = @()
foreach ($device in $hidRaw) {
  if (-not (Test-PayfixPresentDevice $device)) { continue }
  $scored = Get-PayfixDeviceScore $device
  if ($scored.score -ge 50) {
    $hid += [pscustomobject]@{
      score = $scored.score
      reasons = @($scored.reasons)
      Class = $device.Class
      FriendlyName = $device.FriendlyName
      InstanceId = $device.InstanceId
      Manufacturer = $device.Manufacturer
      Status = $device.Status
      Problem = $device.Problem
    }
  }
}

$issues = @()
foreach ($device in $suspected) {
  if ($device.Status -and $device.Status -ne "OK") {
    $issues += [pscustomobject]@{
      name = $device.FriendlyName
      class = $device.Class
      status = $device.Status
      problem = $device.Problem
      instanceId = $device.InstanceId
      hint = "Device Manager reports this device is not OK."
    }
  }
}

[pscustomobject]@{
  ok = $true
  scannedAt = (Get-Date).ToString("o")
  computerName = $env:COMPUTERNAME
  userName = $env:USERNAME
  platform = "Windows"
  suspectedPaymentDevices = @($suspected | Sort-Object score -Descending)
  comPorts = @($comPorts | Sort-Object score -Descending)
  usbDevices = @($usb)
  hidDevices = @($hid)
  hiddenNonPaymentDeviceCount = [math]::Max(0, ($pnpRaw.Count + $serialRaw.Count + $usbRaw.Count + $hidRaw.Count) - ($suspected.Count + $comPorts.Count + $usb.Count + $hid.Count))
  issues = @($issues)
  nextSafeActions = @(
    "Only likely payment readers are shown. If your reader is missing, check its vendor/model name and connection mode.",
    "If the device exposes a COM port, confirm the payment app uses the same COM number and baud rate.",
    "If status is not OK, open Device Manager and inspect the driver/provider/error code before applying fixes.",
    "Capture a transaction log or raw TLV/MSR output and attach it to PayFix for decoding."
  )
} | ConvertTo-Json -Depth 6
`;
    const data = await runPowerShellJson(script);
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(err) });
  }
});

app.get("/device/support-bundle", async (_req, res) => {
  try {
    const script = String.raw`
$ErrorActionPreference = "SilentlyContinue"
$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime
$computer = Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,TotalPhysicalMemory
$serial = Get-CimInstance Win32_SerialPort | Select-Object DeviceID,Name,Description,Manufacturer,PNPDeviceID,Status
$usbControllers = Get-CimInstance Win32_USBController | Select-Object Name,Manufacturer,Status,PNPDeviceID
$usbHubs = Get-CimInstance Win32_USBHub | Select-Object Name,DeviceID,Status
$events = Get-WinEvent -LogName System -MaxEvents 200 |
  Where-Object { $_.ProviderName -match "Kernel-PnP|UserPnp|DriverFrameworks|USB" -or $_.Message -match "USB|COM|serial|driver" } |
  Select-Object TimeCreated,ProviderName,Id,LevelDisplayName,Message

[pscustomobject]@{
  ok = $true
  createdAt = (Get-Date).ToString("o")
  os = $os
  computer = $computer
  comPorts = @($serial)
  usbControllers = @($usbControllers)
  usbHubs = @($usbHubs)
  recentUsbDriverEvents = @($events | Select-Object -First 50)
  note = "Read-only diagnostic bundle. Review for PCI-sensitive data before sharing externally."
} | ConvertTo-Json -Depth 6
`;
    const data = await runPowerShellJson(script);
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/device/probe-network", async (req, res) => {
  try {
    const host = String(req.body.host || "").trim();
    const requestedPorts: unknown[] = Array.isArray(req.body.ports) ? req.body.ports : [];
    const ports = (requestedPorts.length ? requestedPorts : [443, 80, 8080, 9000, 9100, 10009, 5015])
      .map((port: unknown) => Number(port))
      .filter((port: number) => Number.isInteger(port) && port > 0 && port < 65536)
      .slice(0, 12);

    if (!/^[a-z0-9.-]+$/i.test(host)) {
      throw new Error("Enter a valid hostname or IPv4 address.");
    }

    const results = await Promise.all(ports.map((port) => testTcpPort(host, port)));
    const openPorts = results.filter((result) => result.open).map((result) => result.port);

    res.json({
      ok: true,
      host,
      ports: results,
      openPorts,
      likelyNetworkTerminal: openPorts.length > 0,
      hints: openPorts.length
        ? [
            "At least one TCP port is reachable. Confirm the terminal model and expected integration port.",
            "If the payment app still cannot connect, check static IP, subnet, firewall rules, and vendor service settings.",
          ]
        : [
            "No tested ports responded. Confirm the terminal IP address, power/network link, subnet, and firewall.",
            "If this is a USB or serial reader, use the USB/COM scan instead of IP probe.",
          ],
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/device/capture/start", async (req, res) => {
  try {
    const mode = String(req.body.mode || "tcp") as "tcp" | "serial";
    const id = crypto.randomUUID();

    if (mode === "tcp") {
      const host = String(req.body.host || "").trim();
      const port = Number(req.body.port || 0);
      if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error("Enter a valid TCP host.");
      if (!Number.isInteger(port) || port <= 0 || port >= 65536) throw new Error("Enter a valid TCP port.");

      const socket = net.createConnection({ host, port });
      const session: DeviceCaptureSession = {
        id,
        mode,
        label: `${host}:${port}`,
        startedAt: new Date().toISOString(),
        status: "connecting",
        connection: { kind: "tcp", socket },
        events: [],
      };
      captureSessions.set(id, session);

      socket.on("connect", () => {
        session.status = "connected";
        recordCaptureEvent(session, "status", `Connected to ${host}:${port}`);
      });
      socket.on("data", (data) => recordCaptureEvent(session, "in", data));
      socket.on("error", (error) => {
        session.status = "error";
        session.error = error.message;
        recordCaptureEvent(session, "error", error.message);
      });
      socket.on("close", () => {
        session.status = "closed";
        recordCaptureEvent(session, "status", "Connection closed.");
      });

      res.json({ ok: true, session: publicCaptureSession(session) });
      return;
    }

    if (mode === "serial") {
      const serialPath = String(req.body.path || "").trim();
      const baudRate = Number(req.body.baudRate || 9600);
      if (!/^(COM\d+|\/dev\/[\w./-]+)$/i.test(serialPath)) {
        throw new Error("Enter a valid serial path, for example COM3.");
      }
      if (!Number.isInteger(baudRate) || baudRate < 300 || baudRate > 921600) {
        throw new Error("Enter a valid baud rate.");
      }

      const SerialPort = await loadSerialPortConstructor();
      if (!SerialPort) {
        throw new Error(
          "Serial capture requires the optional serialport package. Run `npm install serialport` in payfix-agent, then restart the local agent."
        );
      }

      const port = new SerialPort({ path: serialPath, baudRate, autoOpen: false });
      const session: DeviceCaptureSession = {
        id,
        mode,
        label: `${serialPath} @ ${baudRate}`,
        startedAt: new Date().toISOString(),
        status: "connecting",
        connection: { kind: "serial", port },
        events: [],
      };
      captureSessions.set(id, session);

      port.on("data", (data: unknown) => recordCaptureEvent(session, "in", Buffer.isBuffer(data) ? data : String(data)));
      port.on("error", (error: unknown) => {
        session.status = "error";
        session.error = error instanceof Error ? error.message : String(error);
        recordCaptureEvent(session, "error", session.error || "Serial error.");
      });
      port.on("close", () => {
        session.status = "closed";
        recordCaptureEvent(session, "status", "Serial port closed.");
      });

      await new Promise<void>((resolve, reject) => {
        port.open((error?: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          session.status = "connected";
          recordCaptureEvent(session, "status", `Opened ${serialPath} @ ${baudRate}.`);
          resolve();
        });
      });

      res.json({ ok: true, session: publicCaptureSession(session) });
      return;
    }

    throw new Error("Unsupported capture mode.");
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.get("/device/capture/sessions", (_req, res) => {
  res.json({
    ok: true,
    sessions: [...captureSessions.values()].map(publicCaptureSession),
  });
});

app.get("/device/capture/:id/events", (req, res) => {
  const session = captureSessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ ok: false, error: "Capture session not found." });
    return;
  }

  res.json({
    ok: true,
    session: publicCaptureSession(session),
    events: session.events,
  });
});

app.post("/device/capture/:id/send", (req, res) => {
  try {
    const session = captureSessions.get(req.params.id);
    if (!session) throw new Error("Capture session not found.");

    const payload = String(req.body.payload || "");
    const encoding = String(req.body.encoding || "text");
    const buffer =
      encoding === "hex" ? Buffer.from(payload.replace(/[^a-f0-9]/gi, ""), "hex") : Buffer.from(payload, "utf8");
    if (!buffer.length) throw new Error("No payload to send.");

    if (session.connection.kind === "tcp") {
      session.connection.socket.write(buffer);
    } else {
      session.connection.port.write?.(buffer);
    }

    const event = recordCaptureEvent(session, "out", buffer);
    res.json({ ok: true, event });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/device/capture/:id/stop", (req, res) => {
  const session = captureSessions.get(req.params.id);
  if (!session) {
    res.json({ ok: true, stopped: false });
    return;
  }

  if (session.connection.kind === "tcp") {
    session.connection.socket.destroy();
  } else {
    session.connection.port.close();
  }

  session.status = "closed";
  captureSessions.delete(req.params.id);
  res.json({ ok: true, stopped: true, session: publicCaptureSession(session) });
});

app.get("/device/vendor-packs", async (_req, res) => {
  try {
    res.json({
      ok: true,
      packs: await Promise.all(vendorPacks.map(vendorPackStatus)),
    });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/device/vendor-packs/:packId/create-template", async (req, res) => {
  try {
    const packId = String(req.params.packId || "");
    const pack = vendorPacks.find((candidate) => candidate.id === packId);
    if (!pack) throw new Error("Unknown vendor pack.");

    const adapterPath = vendorAdapterPath(pack.id);
    if (await fileExists(adapterPath)) {
      res.json({
        ok: true,
        alreadyExists: true,
        adapterPath,
        message: `${pack.vendor} PC bridge already exists. PayFix did not overwrite it.`,
        pack: await vendorPackStatus(pack),
      });
      return;
    }

    await fs.mkdir(path.dirname(adapterPath), { recursive: true });
    await fs.writeFile(adapterPath, vendorAdapterTemplate(pack), { flag: "wx" });

    res.json({
      ok: true,
      alreadyExists: false,
      adapterPath,
      message: `Created ${pack.vendor} PC bridge template. Edit it to call the real vendor SDK/protocol.`,
      pack: await vendorPackStatus(pack),
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.post("/device/vendor-packs/:packId/create-config", async (req, res) => {
  try {
    const packId = String(req.params.packId || "");
    const pack = vendorPacks.find((candidate) => candidate.id === packId);
    if (!pack) throw new Error("Unknown vendor pack.");

    const configPath = vendorConfigPath(pack.id);
    if (await fileExists(configPath)) {
      res.json({
        ok: true,
        alreadyExists: true,
        configPath,
        message: `${pack.vendor} bridge settings already exist. PayFix did not overwrite them.`,
        pack: await vendorPackStatus(pack),
      });
      return;
    }

    const examplePath = path.join(process.cwd(), "vendor-packs", `${pack.id}.config.example.json`);
    if (await fileExists(examplePath)) {
      await fs.copyFile(examplePath, configPath);
    } else {
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            timeoutMs: 10000,
            sdkModule: "",
            sdkMethods: Object.fromEntries(pack.actions.map((action) => [action.id, action.id])),
            commands: Object.fromEntries(
              pack.actions.map((action) => [
                action.id,
                {
                  hex: "",
                  description: `Optional exact ${pack.vendor}-approved command bytes for ${action.label}.`,
                },
              ])
            ),
          },
          null,
          2
        )
      );
    }

    res.json({
      ok: true,
      alreadyExists: false,
      configPath,
      message: `Created ${pack.vendor} bridge settings. Fill in sdkModule or command bytes before running actions.`,
      pack: await vendorPackStatus(pack),
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.get("/device/vendor-packs/:packId/settings", async (req, res) => {
  try {
    const packId = String(req.params.packId || "");
    const pack = vendorPacks.find((candidate) => candidate.id === packId);
    if (!pack) throw new Error("Unknown vendor pack.");

    res.json({
      ok: true,
      settings: await readVendorSettings(pack),
      pack: await vendorPackStatus(pack),
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.post("/device/vendor-packs/:packId/settings", async (req, res) => {
  try {
    const packId = String(req.params.packId || "");
    const pack = vendorPacks.find((candidate) => candidate.id === packId);
    if (!pack) throw new Error("Unknown vendor pack.");

    const defaults = vendorDefaultSettings(pack);
    const body = req.body || {};
    const sdkModule = String(body.sdkModule || "").trim();
    const timeoutMs = Math.max(1000, Math.min(120000, Number(body.timeoutMs || defaults.timeoutMs)));
    const inputCommands = (body.commands || {}) as Record<
      string,
      { hex?: string; text?: string; encoding?: string; description?: string }
    >;

    const settings = {
      ...defaults,
      timeoutMs,
      sdkModule,
      sdkMethods: {
        ...defaults.sdkMethods,
        ...(body.sdkMethods || {}),
      },
      commands: Object.fromEntries(
        pack.actions.map((action) => {
          const previous = defaults.commands[action.id];
          const incoming = inputCommands[action.id] || {};
          return [
            action.id,
            {
              ...previous,
              hex: String(incoming.hex || "").replace(/\s+/g, ""),
              text: String(incoming.text || ""),
              encoding: incoming.encoding === "ascii" ? "ascii" : "utf8",
              description: String(incoming.description || previous.description),
            },
          ];
        })
      ),
    };

    await fs.writeFile(vendorConfigPath(pack.id), JSON.stringify(settings, null, 2));

    res.json({
      ok: true,
      message: `${pack.vendor} bridge settings saved.`,
      settings: await readVendorSettings(pack),
      pack: await vendorPackStatus(pack),
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.post("/device/vendor-packs/:packId/run", async (req, res) => {
  try {
    const packId = String(req.params.packId || "");
    const pack = vendorPacks.find((candidate) => candidate.id === packId);
    if (!pack) throw new Error("Unknown vendor pack.");

    const actionId = String(req.body.actionId || "");
    const action = pack.actions.find((candidate) => candidate.id === actionId);
    if (!action) throw new Error("Unknown vendor pack action.");

    const captureSessionId = String(req.body.captureSessionId || "");
    const captureSession = captureSessionId ? captureSessions.get(captureSessionId) : undefined;
    const runAction = await loadVendorAdapter(pack.id);
    const result = await runAction({
      actionId,
      params: req.body.params || {},
      connection: req.body.connection || {},
      captureSession: captureSession
        ? {
            id: captureSession.id,
            mode: captureSession.mode,
            label: captureSession.label,
            status: captureSession.status,
          }
        : null,
      helpers: {
        note: "Adapters should never return full PAN, CVV, or unredacted track data. Return masked diagnostics only.",
      },
    });

    if (captureSession) {
      recordCaptureEvent(captureSession, "status", `Vendor action ${pack.vendor} / ${action.label} completed.`);
    }

    res.json({
      ok: true,
      pack: pack.id,
      vendor: pack.vendor,
      action,
      result,
      captureSession: captureSession ? publicCaptureSession(captureSession) : null,
    });
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: errorMessage(err),
    });
  }
});

app.post("/webhook/replay", async (req, res) => {
  try {
    const url = String(req.body.url || "").trim();
    const method = String(req.body.method || "POST").toUpperCase();
    const vendor = String(req.body.vendor || "generic").toLowerCase();
    const secret = String(req.body.secret || "");
    const signatureHeader = String(req.body.signatureHeader || "x-payfix-signature").trim();
    const rawPayload = String(req.body.payload || "{}");
    const headersInput = req.body.headers && typeof req.body.headers === "object" ? req.body.headers : {};

    if (!/^https?:\/\/(localhost|127\.0\.0\.1|[\w.-]+)(:\d+)?(\/.*)?$/i.test(url)) {
      throw new Error("Enter a valid http/https webhook URL.");
    }

    let parsedPayload: unknown = {};
    try {
      parsedPayload = JSON.parse(rawPayload);
    } catch {
      throw new Error("Webhook payload must be valid JSON.");
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "PayFix-Webhook-Lab/1.0",
    };

    for (const [key, value] of Object.entries(headersInput)) {
      if (/^[a-z0-9-]+$/i.test(key) && typeof value === "string") {
        headers[key] = value;
      }
    }

    if (secret) {
      const timestamp = Math.floor(Date.now() / 1000);

      if (vendor === "stripe") {
        const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawPayload}`).digest("hex");
        headers["stripe-signature"] = `t=${timestamp},v1=${signature}`;
      } else if (vendor === "authorize.net") {
        headers["x-anet-signature"] = `sha512=${crypto.createHmac("sha512", secret).update(rawPayload).digest("hex")}`;
      } else if (vendor === "square") {
        headers["x-square-hmacsha256-signature"] = crypto
          .createHmac("sha256", secret)
          .update(`${url}${rawPayload}`)
          .digest("base64");
      } else {
        headers[signatureHeader || "x-payfix-signature"] = crypto
          .createHmac("sha256", secret)
          .update(rawPayload)
          .digest("hex");
      }
    }

    const startedAt = Date.now();
    const response = await fetch(url, {
      method: ["POST", "PUT", "PATCH"].includes(method) ? method : "POST",
      headers,
      body: JSON.stringify(parsedPayload),
    });
    const body = await response.text();
    let responseJson: Record<string, unknown> | null = null;
    try {
      responseJson = JSON.parse(body) as Record<string, unknown>;
    } catch {
      responseJson = null;
    }
    const detectedVendor =
      responseJson && typeof responseJson.detected === "object" && responseJson.detected
        ? String((responseJson.detected as Record<string, unknown>).vendor || "")
        : "";
    const validationWarnings =
      vendor !== "generic" && detectedVendor && detectedVendor.toLowerCase() !== vendor
        ? [`Selected ${vendor}, but receiver detected ${detectedVendor} payload fields.`]
        : [];

    res.json({
      ok: response.ok,
      url,
      method,
      vendor,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - startedAt,
      requestHeaders: headers,
      requestPayload: parsedPayload,
      responseBody: body.slice(0, 20000),
      responseHeaders: Object.fromEntries(response.headers.entries()),
      detectedVendor,
      validationWarnings,
      hint: response.ok
        ? validationWarnings.length
          ? "Webhook endpoint accepted the replay, but vendor/payload mismatch was detected."
          : "Webhook endpoint accepted the replay."
        : "Webhook endpoint returned a non-2xx status. Inspect responseBody and server logs.",
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.get("/webhook/discover", async (_req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const files = await listProjectFiles();
    const routePattern = /webhook|callback|notification|ipn|listener|payment[-_ ]?event/i;
    const endpointPattern =
      /(app[\\/]+api[\\/][^\\/]+(?:[\\/][^\\/]+)*[\\/]route\.(ts|tsx|js|jsx)|pages[\\/]+api[\\/][^\\/]+\.(ts|js)|server\.(ts|js)|app\.(ts|js)|routes?[\\/][^\\/]+\.(ts|js))/i;
    const candidates = files.filter((file) => routePattern.test(file) || endpointPattern.test(file)).slice(0, 80);
    const endpoints: {
      file: string;
      route: string;
      confidence: number;
      evidence: string;
    }[] = [];

    for (const file of candidates) {
      const content = await fs.readFile(file, "utf8").catch(() => "");
      const relative = path.relative(allowedRoot, file);
      const normalized = relative.replace(/\\/g, "/");
      let route = "";
      let confidence = 0;
      const evidence: string[] = [];

      const appApiMatch = normalized.match(/^app\/api\/(.+)\/route\.(ts|tsx|js|jsx)$/i);
      const pagesApiMatch = normalized.match(/^pages\/api\/(.+)\.(ts|js)$/i);
      const expressMatch = content.match(/(?:app|router)\.(post|all)\(["'`]([^"'`]*(?:webhook|callback|notification|ipn)[^"'`]*)["'`]/i);

      if (appApiMatch?.[1]) {
        route = `/api/${appApiMatch[1].replace(/\/route$/i, "")}`;
        confidence += 70;
        evidence.push("Next app/api route file");
      }

      if (pagesApiMatch?.[1]) {
        route = `/api/${pagesApiMatch[1]}`;
        confidence += 70;
        evidence.push("Next pages/api route file");
      }

      if (expressMatch?.[2]) {
        route = expressMatch[2];
        confidence += 80;
        evidence.push(`Express ${expressMatch[1].toUpperCase()} route`);
      }

      if (routePattern.test(file)) {
        confidence += 20;
        evidence.push("webhook-like file path");
      }

      if (/stripe|cardknox|authorize|anet|square|adyen|paypal/i.test(content)) {
        confidence += 10;
        evidence.push("payment vendor keyword in file");
      }

      if (route) {
        endpoints.push({
          file,
          route,
          confidence: Math.min(confidence, 100),
          evidence: evidence.join(", "),
        });
      }
    }

    res.json({
      ok: true,
      root: allowedRoot,
      endpoints: endpoints.sort((a, b) => b.confidence - a.confidence).slice(0, 25),
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

const server = app.listen(PORT, () => {
  console.log(`PayFix Local Agent running at http://localhost:${PORT}`);
});
server.ref();

const keepAlive = setInterval(() => undefined, 60_000);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`PayFix Local Agent could not start: port ${PORT} is already in use.`);
  } else {
    console.error("PayFix Local Agent server error:", err);
  }
  process.exitCode = 1;
});

server.on("close", () => {
  clearInterval(keepAlive);
  console.log("PayFix Local Agent server closed.");
});

process.on("uncaughtException", (err) => {
  console.error("PayFix Local Agent uncaught exception:", err);
  process.exitCode = 1;
});

process.on("unhandledRejection", (reason) => {
  console.error("PayFix Local Agent unhandled rejection:", reason);
  process.exitCode = 1;
});
