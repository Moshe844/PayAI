import OpenAI from "openai";

import { decodeEmvTlv, looksLikeEmvTlv } from "../../lib/emvTlv";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const AGENT_REASONING_MODEL = process.env.PAYFIX_AGENT_MODEL || "gpt-5-mini";
const AGENT_FAST_MODEL = process.env.PAYFIX_AGENT_FAST_MODEL || "gpt-5-mini";

type UploadedFilePayload = {
  name: string;
  type: string;
  size?: number;
  content?: string;
  isImage?: boolean;
};

type ProjectFilePayload = {
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

type FileSelectionResult = {
  selectedFiles: string[];
  rationale: string;
};

type AgentPatch = {
  mode: "replace" | "insert" | "none";
  file: string;
  search: string;
  replacement: string;
  language: string;
  explanation: string;
};

type DependencyProposal = {
  needed: boolean;
  packageName: string;
  devDependency: boolean;
  reason: string;
};

type AgentResult = {
  answer: string;
  inspectedFiles: string[];
  findings: string[];
  rootCause: {
    status: "found" | "not_found" | "not_applicable";
    title: string;
    confidence: number;
    why: string;
    evidence: string[];
    exactReferences: string[];
  };
  investigation: {
    filesScanned: string[];
    filesIgnored: string[];
    searchTermsUsed: string[];
    selectionReason: string;
  };
  patch: AgentPatch;
  patchConfidence: {
    confidence: number;
    risk: "low" | "medium" | "high";
    filesAffected: number;
    reason: string;
  };
  patchSet?: AgentPatch[];
  dependencyProposal: DependencyProposal;
  validationPlan: string[];
  confidence: number;
};

type AgentLoopStep = {
  step: string;
  status: "done" | "skipped" | "blocked";
  detail: string;
};

type PreviewResult = {
  ok?: boolean;
  oldContent?: string;
  newContent?: string;
  error?: string;
};

type ValidationResult = {
  ok?: boolean;
  skipped?: boolean | string[];
  restored?: boolean;
  commands?: {
    ok: boolean;
    command: string;
    output: string;
  }[];
  error?: string;
};

type GroundingEvidence = {
  file: string;
  line: number;
  text: string;
  reason: string;
};

type PackageInfo = {
  ok?: boolean;
  hasPackageJson?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type StructuralScanResult = {
  ok?: boolean;
  root?: string;
  scannedFiles?: number;
  issueCount?: number;
  issues?: {
    file: string;
    relative: string;
    severity: "error" | "warning" | "info";
    line?: number;
    message: string;
    code?: string;
  }[];
  error?: string;
};

function normalizePath(filePath: string) {
  return String(filePath || "").replace(/\//g, "\\");
}

function baseName(filePath: string) {
  return normalizePath(filePath).split("\\").pop() || filePath;
}

function directoryName(filePath: string) {
  const normalized = normalizePath(filePath);
  return normalized.slice(0, normalized.lastIndexOf("\\"));
}

function tokenizeForEvidence(text: string) {
  return [
    ...new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9_$.-]{4,}/g)
        ?.filter(
          (word) =>
            ![
              "this",
              "that",
              "with",
              "from",
              "have",
              "should",
              "would",
              "could",
              "file",
              "code",
              "change",
              "update",
              "please",
              "agent",
              "project",
            ].includes(word),
        ) || [],
    ),
  ].slice(0, 80);
}

function buildGroundingEvidence({
  question,
  result,
  projectFiles,
}: {
  question: string;
  result: AgentResult;
  projectFiles: ProjectFilePayload[];
}) {
  const tokens = tokenizeForEvidence(`${question}\n${result.findings.join("\n")}\n${result.patch.explanation}`);
  const evidence: GroundingEvidence[] = [];

  for (const file of projectFiles) {
    if (file.kind !== "text" || !file.content) continue;

    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const normalizedLine = line.toLowerCase();
      const score = tokens.filter((token) => normalizedLine.includes(token)).length;
      if (!score) return;

      evidence.push({
        file: file.file,
        line: index + 1,
        text: line.trim().slice(0, 220),
        reason: `${score} request/finding term${score === 1 ? "" : "s"} matched this line.`,
      });
    });
  }

  if (result.patch.mode !== "none" && result.patch.search.trim()) {
    const patchFile = projectFiles.find(
      (file) => normalizePath(file.file).toLowerCase() === normalizePath(result.patch.file).toLowerCase(),
    );
    const line = patchFile?.content?.split(result.patch.search)[0]?.split(/\r?\n/).length;
    if (patchFile && line) {
      evidence.unshift({
        file: patchFile.file,
        line,
        text: result.patch.search.split(/\r?\n/).find((item) => item.trim())?.trim().slice(0, 220) || "Exact patch target.",
        reason: "Exact patch search block starts here.",
      });
    }
  }

  const seen = new Set<string>();
  return evidence
    .filter((item) => {
      const key = `${normalizePath(item.file).toLowerCase()}:${item.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function defaultTrustFields({
  question,
  selection,
  projectFiles,
  result,
}: {
  question: string;
  selection: FileSelectionResult;
  projectFiles: ProjectFilePayload[];
  result: Partial<AgentResult>;
}) {
  const inspected = projectFiles.map((file) => normalizePath(file.file));
  const evidence = buildGroundingEvidence({
    question,
    result: {
      answer: result.answer || "",
      inspectedFiles: inspected,
      findings: result.findings || [],
      rootCause: result.rootCause || {
        status: "not_found",
        title: "",
        confidence: 0,
        why: "",
        evidence: [],
        exactReferences: [],
      },
      investigation: result.investigation || {
        filesScanned: inspected,
        filesIgnored: [],
        searchTermsUsed: [],
        selectionReason: "",
      },
      patch: result.patch || {
        mode: "none",
        file: "",
        search: "",
        replacement: "",
        language: "text",
        explanation: "",
      },
      patchConfidence: result.patchConfidence || {
        confidence: 0,
        risk: "high",
        filesAffected: 0,
        reason: "",
      },
      dependencyProposal: result.dependencyProposal || {
        needed: false,
        packageName: "",
        devDependency: false,
        reason: "",
      },
      validationPlan: result.validationPlan || [],
      confidence: result.confidence || 0,
    },
    projectFiles,
  });
  const exactReferences = evidence.slice(0, 4).map((item) => `${normalizePath(item.file)}:${item.line}`);
  const patchMode = result.patch?.mode || "none";
  const confidence = Number.isFinite(result.confidence) ? Number(result.confidence) : 0;

  return {
    rootCause: result.rootCause || {
      status: asksForCodeWork(question) && evidence.length ? "found" : "not_found",
      title: evidence.length ? "Evidence found in inspected files" : "No exact root cause proven",
      confidence: evidence.length ? Math.max(0.72, Math.min(confidence || 0.72, 0.92)) : Math.min(confidence || 0.45, 0.65),
      why: evidence.length
        ? "The conclusion is grounded in exact inspected file lines listed below."
        : "The inspected files did not provide enough exact evidence to prove a root cause.",
      evidence: evidence.slice(0, 4).map((item) => `${normalizePath(item.file)}:${item.line} ${item.text}`),
      exactReferences,
    },
    investigation: result.investigation || {
      filesScanned: inspected,
      filesIgnored: [],
      searchTermsUsed: tokenizeForEvidence(question).slice(0, 10),
      selectionReason: selection.rationale || "Files were selected by the file-selection step.",
    },
    patchConfidence: result.patchConfidence || {
      confidence: patchMode === "none" ? 0 : Math.max(0, Math.min(confidence, 1)),
      risk: patchMode === "replace" && result.patch?.search && result.patch?.replacement ? "low" : patchMode === "insert" ? "medium" : "high",
      filesAffected: result.patchSet?.length || (patchMode === "none" ? 0 : 1),
      reason:
        patchMode === "none"
          ? "No safe patch was prepared."
          : "Patch was generated from inspected file content and must pass preview/validation before Apply opens.",
    },
  };
}

function parseProjectFileList(projectFileList: string) {
  return projectFileList
    .split(/\r?\n/)
    .map((line) => line.match(/^FILE:\s*(.+)$/)?.[1]?.trim())
    .filter((file): file is string => Boolean(file));
}

function resolveFilesFromProjectList(files: string[], projectFileList: string) {
  const candidates = parseProjectFileList(projectFileList);

  return files.map((file) => {
    const normalized = normalizePath(file).toLowerCase();
    const name = baseName(file).toLowerCase();

    return (
      candidates.find((candidate) => normalizePath(candidate).toLowerCase() === normalized) ||
      candidates.find((candidate) => baseName(candidate).toLowerCase() === name) ||
      file
    );
  });
}

function findExplicitlyMentionedFiles(text: string, projectFileList: string) {
  const candidates = parseProjectFileList(projectFileList);
  const normalizedText = normalizePath(text).toLowerCase();
  const mentionedNames = new Set(
    [...text.matchAll(/(?:^|[\s"'`(])([\w .()[\]-]+\.(?:tsx?|jsx?|css|scss|json|html|md|xml|cs|php|py|java|txt|log|config|csproj|sln))(?:$|[\s"'`),.])/gi)]
      .map((match) => normalizePath(match[1] || "").toLowerCase())
      .filter(Boolean),
  );

  return candidates.filter((file) => {
    const normalized = normalizePath(file).toLowerCase();
    const name = baseName(file).toLowerCase();
    return normalizedText.includes(normalized) || mentionedNames.has(name) || mentionedNames.has(normalized);
  });
}

function findWorkflowRelevantFiles(text: string, projectFileList: string) {
  const candidates = parseProjectFileList(projectFileList);
  const normalizedText = text.toLowerCase();
  const requestedFiles: string[] = [];

  if (
    /\b(refresh|reload|browser refresh|stay(?:ing)? in (?:the )?chat|open(?:ed)? chat|new chat|saved chats?|active chat|chat id|localstorage|sessionstorage|draft)\b/i.test(
      normalizedText,
    )
  ) {
    requestedFiles.push(
      ...candidates.filter((file) =>
        /(^|[\\/])app[\\/]page\.tsx$/i.test(normalizePath(file)) ||
        /(^|[\\/])page\.tsx$/i.test(normalizePath(file)) ||
        /(^|[\\/])Sidebar\.tsx$/i.test(normalizePath(file)) ||
        /(^|[\\/])ChatMessages\.tsx$/i.test(normalizePath(file)),
      ),
    );
  }

  const seen = new Set<string>();
  return requestedFiles.filter((file) => {
    const key = normalizePath(file).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findBehaviorAuditFiles(projectFileList: string) {
  const candidates = parseProjectFileList(projectFileList);
  const priority = [
    /(^|[\\/])app[\\/]page\.tsx$/i,
    /(^|[\\/])app[\\/]layout\.tsx$/i,
    /(^|[\\/])Composer\.tsx$/i,
    /(^|[\\/])ChatMessages\.tsx$/i,
    /(^|[\\/])Sidebar\.tsx$/i,
    /(^|[\\/])ApplyChangesModal\.tsx$/i,
    /(^|[\\/])AgentSessionModal\.tsx$/i,
    /(^|[\\/])route\.ts$/i,
    /(^|[\\/])server\.ts$/i,
    /(^|[\\/])globals\.css$/i,
  ];

  return candidates
    .filter((file) => priority.some((pattern) => pattern.test(normalizePath(file))))
    .sort((a, b) => {
      const aIndex = priority.findIndex((pattern) => pattern.test(normalizePath(a)));
      const bIndex = priority.findIndex((pattern) => pattern.test(normalizePath(b)));
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    })
    .slice(0, 8);
}

function parseDiagnosticIssues(projectDiagnostics: ValidationResult | null | undefined) {
  const output = (projectDiagnostics?.commands || []).map((command) => command.output || "").join("\n");
  if (!output.trim()) return [];

  const absoluteIssues = [...output.matchAll(/([A-Za-z]:[^\r\n()[\]]+\.(?:cs|ts|tsx|js|jsx|html|css|json))\((\d+),(\d+)\):\s*(error|warning)\s+([A-Z]+\d+):\s*([^\r\n\[]+)/gi)]
    .map((match) => ({
      file: normalizePath(match[1] || ""),
      line: Number(match[2] || 0),
      column: Number(match[3] || 0),
      severity: (match[4] || "error").toLowerCase(),
      code: match[5] || "",
      message: (match[6] || "").trim(),
    }))
    .filter((issue) => issue.file && issue.line > 0);

  const relativeIssues = [...output.matchAll(/(?:^|\n)([^\r\n()[\]]+\.(?:cs|ts|tsx|js|jsx|html|css|json))\((\d+),(\d+)\):\s*(error|warning)\s+([A-Z]+\d+):\s*([^\r\n\[]+)/gi)]
    .map((match) => ({
      file: normalizePath(match[1] || ""),
      line: Number(match[2] || 0),
      column: Number(match[3] || 0),
      severity: (match[4] || "error").toLowerCase(),
      code: match[5] || "",
      message: (match[6] || "").trim(),
    }))
    .filter((issue) => issue.file && issue.line > 0);

  const seen = new Set<string>();
  return [...absoluteIssues, ...relativeIssues].filter((issue) => {
    const key = `${issue.file.toLowerCase()}:${issue.line}:${issue.column}:${issue.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterStructuralScanToDiagnostics(
  structuralScan: StructuralScanResult | null,
  diagnosticIssues: ReturnType<typeof parseDiagnosticIssues>,
) {
  if (!structuralScan?.issues?.length || !diagnosticIssues.length) return structuralScan;

  const diagnosticKeys = new Set(
    diagnosticIssues.map((issue) => `${normalizePath(issue.file).toLowerCase()}:${issue.line}`),
  );
  const diagnosticFiles = new Set(diagnosticIssues.map((issue) => normalizePath(issue.file).toLowerCase()));
  const issues = structuralScan.issues.filter((issue) => {
    const file = normalizePath(issue.file).toLowerCase();
    return diagnosticKeys.has(`${file}:${issue.line || 0}`) || diagnosticFiles.has(file);
  });

  return {
    ...structuralScan,
    issueCount: issues.length,
    issues,
  };
}

function resolveRelativeImport(importer: string, specifier: string, candidateFiles: string[]) {
  if (!specifier.startsWith(".")) return "";

  const importerDir = directoryName(importer);
  const base = normalizePath(`${importerDir}\\${specifier}`);
  const normalizedBase = base.toLowerCase();
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".json", "\\index.ts", "\\index.tsx", "\\index.js", "\\index.jsx"];

  return (
    candidateFiles.find((file) =>
      extensions.some((extension) => normalizePath(file).toLowerCase() === `${normalizedBase}${extension}`),
    ) || ""
  );
}

function findRelatedImportedFiles(projectFiles: ProjectFilePayload[], projectFileList: string) {
  const candidateFiles = parseProjectFileList(projectFileList);
  const related = new Set<string>();

  for (const file of projectFiles) {
    if (file.kind !== "text" || !file.content) continue;

    const importMatches = file.content.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g);

    for (const match of importMatches) {
      const resolved = resolveRelativeImport(file.file, match[1] || "", candidateFiles);
      if (resolved) related.add(resolved);
    }
  }

  return [...related];
}

function findProjectConfigFiles(projectFileList: string) {
  const candidateFiles = parseProjectFileList(projectFileList);
  const configPatterns = [
    /(^|\\)package\.json$/i,
    /(^|\\)(package-lock|pnpm-lock|yarn)\.yaml$/i,
    /(^|\\)package-lock\.json$/i,
    /(^|\\)yarn\.lock$/i,
    /(^|\\)pnpm-lock\.yaml$/i,
    /(^|\\)tsconfig\.json$/i,
    /(^|\\)jsconfig\.json$/i,
    /(^|\\)next\.config\.(js|mjs|ts)$/i,
    /(^|\\)vite\.config\.(js|mjs|ts)$/i,
    /(^|\\)eslint\.config\.(js|mjs|ts)$/i,
    /(^|\\)\.eslintrc(\.json|\.js|\.cjs)?$/i,
  ];

  return candidateFiles.filter((file) => configPatterns.some((pattern) => pattern.test(normalizePath(file)))).slice(0, 8);
}

function packageNameFromSpecifier(specifier: string) {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return "";
  }

  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
}

function findExternalImportReferences(projectFiles: ProjectFilePayload[]) {
  const imports: Array<{ packageName: string; file: string }> = [];

  for (const file of projectFiles) {
    if (file.kind !== "text" || !file.content) continue;

    const matches = file.content.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|require\(["']([^"']+)["']\)/g);

    for (const match of matches) {
      const packageName = packageNameFromSpecifier(match[1] || match[2] || "");
      if (packageName) imports.push({ packageName, file: normalizePath(file.file) });
    }
  }

  return imports;
}

function importBelongsToNestedPackage(file: string) {
  return /[\\/]payfix-agent[\\/]|[\\/]agent-test-project[\\/]/i.test(normalizePath(file));
}

function summarizeUploadedFiles(files: UploadedFilePayload[]) {
  return files
    .map((file, index) => {
      if (file.isImage) {
        return `UPLOADED IMAGE ${index + 1}: ${file.name}
REFERENCE LABEL: Image ${index + 1}: ${file.name}
ACTUAL FILE NAME: ${file.name}
ACTUAL MIME TYPE: ${file.type}
SIZE: ${file.size || 0} bytes
ORDER: This is image part ${index + 1} in the current request.
NOTE: Image content was provided to the model separately.
IMPORTANT: This metadata describes the uploaded file. Text visible inside the screenshot may mention other filenames or formats; do not confuse screenshot text with the uploaded file format.`;
      }

      return `UPLOADED FILE ${index + 1}: ${file.name}
REFERENCE LABEL: File ${index + 1}: ${file.name}
TYPE: ${file.type}
SIZE: ${file.size || 0} bytes
CONTENT:
${String(file.content || "").slice(0, 20000)}`;
    })
    .join("\n\n");
}

function summarizeProjectFiles(files: ProjectFilePayload[]) {
  return files
    .map((file) => {
      if (file.kind === "text") {
        return `PROJECT FILE:
FILE: ${normalizePath(file.file)}
MIME: ${file.mime || "text/plain"}
SIZE: ${file.size || 0} bytes
CONTENT:
${String(file.content || "").slice(0, 50000)}`;
      }

      return `PROJECT FILE:
FILE: ${normalizePath(file.file)}
KIND: ${file.kind || "binary"}
MIME: ${file.mime || "unknown"}
SIZE: ${file.size || 0} bytes
NOTE: ${file.note || "This file is not plain text; patching is not available for it."}`;
    })
    .join("\n\n");
}

function imageParts(uploadedFiles: UploadedFilePayload[]) {
  return uploadedFiles
    .filter((file) => file.isImage && file.content)
    .slice(0, 8)
    .map((file) => ({
      type: "input_image" as const,
      image_url: file.content || "",
      detail: "high" as const,
    }));
}

function safeJsonParse<T>(text: string, fallback: T) {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return fallback;
      }
    }

    return fallback;
  }
}

function asksForCodeWork(text: string) {
  return /fix|change|update|edit|apply|patch|code|component|file|bug|error|broken|implement|add|remove|refactor|style|css|tsx|jsx|route|server/i.test(
    text,
  );
}

function numberedEvidence(label: string, value: string, maxChars = 50000) {
  const lines = value.trim().split(/\r?\n/);
  if (!lines.length || !value.trim()) return "";

  return `${label}:\n${lines
    .map((line, index) => `${label.toLowerCase().replace(/\s+/g, "-")}:${index + 1} ${line}`)
    .join("\n")
    .slice(0, maxChars)}`;
}

function hasEvidenceOnlyText({
  log,
  code,
  computerSearchResults,
  uploadedFiles,
}: {
  log: string;
  code: string;
  computerSearchResults: string;
  uploadedFiles: UploadedFilePayload[];
}) {
  return Boolean(
    log.trim() ||
      code.trim() ||
      computerSearchResults.trim() ||
      uploadedFiles.some((file) => !file.isImage && String(file.content || "").trim()),
  );
}

type EvidenceOnlyReview = {
  answer: string;
  findings: string[];
  status: "found" | "not_found" | "not_applicable";
  title: string;
  confidence: number;
  why: string;
  evidence: string[];
  exactReferences: string[];
  nextSteps: string[];
};

async function reviewEvidenceOnlyContext({
  question,
  log,
  code,
  computerSearchResults,
  uploadedFiles,
}: {
  question: string;
  log: string;
  code: string;
  computerSearchResults: string;
  uploadedFiles: UploadedFilePayload[];
}): Promise<AgentResult | null> {
  if (!hasEvidenceOnlyText({ log, code, computerSearchResults, uploadedFiles })) return null;

  const uploadEvidence = uploadedFiles
    .filter((file) => !file.isImage && String(file.content || "").trim())
    .slice(0, 6)
    .map((file) => numberedEvidence(`uploaded-file-${file.name}`, String(file.content || ""), 18000))
    .filter(Boolean)
    .join("\n\n");
  const evidenceBody = [
    numberedEvidence("pasted-code", code),
    numberedEvidence("pasted-log", log, 25000),
    numberedEvidence("computer-search-results", computerSearchResults, 25000),
    uploadEvidence,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  try {
    const response = await openai.responses.create({
      model: AGENT_REASONING_MODEL,
      max_output_tokens: 2200,
      text: {
        format: {
          type: "json_schema",
          name: "payfix_evidence_only_review",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              answer: { type: "string" },
              findings: {
                type: "array",
                items: { type: "string" },
              },
              status: { type: "string", enum: ["found", "not_found", "not_applicable"] },
              title: { type: "string" },
              confidence: { type: "number" },
              why: { type: "string" },
              evidence: {
                type: "array",
                items: { type: "string" },
              },
              exactReferences: {
                type: "array",
                items: { type: "string" },
              },
              nextSteps: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["answer", "findings", "status", "title", "confidence", "why", "evidence", "exactReferences", "nextSteps"],
          },
          strict: true,
        },
      },
      input: [
        {
          role: "system",
          content: `You are PayFix Agent in evidence-only mode.
Analyze the pasted code/log/upload evidence directly. Do not say you need pasted code when pasted code is present.
Use only the evidence provided. If the pasted code is incomplete, say exactly what cannot be proven.
Return concrete bugs, risks, and likely fixes when evidence supports them.
Use references exactly like pasted-code:42, pasted-log:8, computer-search-results:3, or uploaded-file-name:12.
Do not prepare an Apply patch, do not claim validation ran, and do not invent neighboring files.`,
        },
        {
          role: "user",
          content: `USER ASKED:
${question || "Review the pasted evidence."}

EVIDENCE:
${evidenceBody.slice(0, 90000)}`,
        },
      ],
    });

    const review = safeJsonParse<EvidenceOnlyReview>(response.output_text || "", {
      answer: "",
      findings: [],
      status: "not_found",
      title: "No evidence-only finding returned",
      confidence: 0.45,
      why: "The evidence-only review did not return a structured diagnosis.",
      evidence: [],
      exactReferences: [],
      nextSteps: [],
    });

    if (!review.answer && !review.findings.length) return null;

    const codeLines = code.trim().split(/\r?\n/).filter(Boolean);
    const logLines = log.trim().split(/\r?\n/).filter(Boolean);
    const uploadedTextFiles = uploadedFiles.filter((file) => !file.isImage && String(file.content || "").trim());
    const inspected = [
      code.trim() ? `Pasted code (${codeLines.length} line${codeLines.length === 1 ? "" : "s"})` : "",
      log.trim() ? `Pasted log (${logLines.length} line${logLines.length === 1 ? "" : "s"})` : "",
      computerSearchResults.trim() ? "Computer search results" : "",
      ...uploadedTextFiles.map((file) => `Uploaded file: ${file.name}`),
    ].filter(Boolean);
    const confidence = Math.max(0.25, Math.min(0.95, review.confidence > 1 ? review.confidence / 100 : review.confidence));

    return {
      answer:
        `${review.answer}\n\nNote: I can diagnose this pasted evidence, but I cannot safely Apply or validate a file change until a project path is connected.`,
      inspectedFiles: inspected,
      findings: review.findings.length ? review.findings : [review.answer],
      rootCause: {
        status: review.status,
        title: review.title,
        confidence,
        why: review.why,
        evidence: review.evidence.slice(0, 8),
        exactReferences: review.exactReferences.slice(0, 12),
      },
      investigation: {
        filesScanned: inspected,
        filesIgnored: ["Project files were not inspected because no project path/file list was connected."],
        searchTermsUsed: tokenizeForEvidence(`${question}\n${log}\n${code}`).slice(0, 10),
        selectionReason: "Evidence-only Agent mode reviewed pasted code/log/upload context directly.",
      },
      patch: {
        mode: "none",
        file: "",
        search: "",
        replacement: "",
        language: "text",
        explanation: "Connect a project path to turn this diagnosis into a safe Apply preview.",
      },
      patchConfidence: {
        confidence: 0,
        risk: "high",
        filesAffected: 0,
        reason: "No project file was connected, so Apply cannot safely target a real file.",
      },
      dependencyProposal: {
        needed: false,
        packageName: "",
        devDependency: false,
        reason: "No project dependencies were inspected.",
      },
      validationPlan: review.nextSteps.length
        ? review.nextSteps
        : ["Connect the project path for exact file inspection, Apply preview, and validation."],
      confidence,
    };
  } catch {
    return null;
  }
}

function evidenceOnlyFallback({
  question,
  log,
  code,
  computerSearchResults,
  uploadedFiles,
}: {
  question: string;
  log: string;
  code: string;
  computerSearchResults: string;
  uploadedFiles: UploadedFilePayload[];
}): AgentResult {
  const textEvidence = [
    question,
    log,
    code,
    computerSearchResults,
    uploadedFiles.filter((file) => !file.isImage).map((file) => `${file.name}\n${file.content || ""}`).join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  if (looksLikeEmvTlv(textEvidence)) {
    const decoded = decodeEmvTlv(textEvidence);
    const findings = [
      decoded.summary,
      ...(decoded.troubleshootingFindings || []).map((finding) => `${finding.title}: ${finding.detail} Evidence: ${finding.evidence}`),
      ...decoded.limitations,
    ];

    return {
      answer:
        "I investigated the uploaded EMV/TLV evidence without a connected project. I can troubleshoot the transaction evidence, but I cannot inspect or patch project code until a project path is connected.",
      inspectedFiles: [],
      findings,
      rootCause: {
        status: decoded.troubleshootingFindings?.some((finding) => finding.severity === "critical") ? "found" : "not_found",
        title: decoded.troubleshootingFindings?.[0]?.title || "EMV/TLV evidence decoded",
        confidence: decoded.troubleshootingFindings?.some((finding) => finding.severity === "critical") ? 0.88 : 0.72,
        why: decoded.troubleshootingFindings?.[0]?.detail || decoded.summary,
        evidence: findings.slice(0, 6),
        exactReferences: [],
      },
      investigation: {
        filesScanned: [],
        filesIgnored: ["Project files were not inspected because no project path/file list was connected."],
        searchTermsUsed: ["EMV TLV", "9F27", "DF8129", "95", "8A", "host response"],
        selectionReason: "Evidence-only Agent mode used uploaded/log text instead of project files.",
      },
      patch: {
        mode: "none",
        file: "",
        search: "",
        replacement: "",
        language: "text",
        explanation: "Evidence-only mode cannot prepare code patches without a connected project.",
      },
      patchConfidence: {
        confidence: 0,
        risk: "high",
        filesAffected: 0,
        reason: "No project files were available for safe patching.",
      },
      dependencyProposal: {
        needed: false,
        packageName: "",
        devDependency: false,
        reason: "No project dependencies were inspected.",
      },
      validationPlan: [
        "Attach the matching gateway/host response log for this same transaction.",
        "Look for ISO response code, auth response/tag 8A, amount, currency, and terminal/kernel outcome.",
        "Connect a project path if you want Agent to inspect or patch code.",
      ],
      confidence: 0.78,
    };
  }

  const codeLines = code.trim().split(/\r?\n/).filter(Boolean);
  const logLines = log.trim().split(/\r?\n/).filter(Boolean);
  const uploadedTextFiles = uploadedFiles.filter((file) => !file.isImage && String(file.content || "").trim());
  const evidenceLabels = [
    code.trim() ? `Pasted code (${codeLines.length} line${codeLines.length === 1 ? "" : "s"})` : "",
    log.trim() ? `Pasted log (${logLines.length} line${logLines.length === 1 ? "" : "s"})` : "",
    computerSearchResults.trim() ? "Computer search results" : "",
    uploadedTextFiles.length ? `${uploadedTextFiles.length} uploaded text file${uploadedTextFiles.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  if (evidenceLabels.length) {
    const codeEvidence = codeLines.slice(0, 6).map((line, index) => `pasted-code:${index + 1} ${line.trim().slice(0, 180)}`);
    const logEvidence = logLines.slice(0, 4).map((line, index) => `pasted-log:${index + 1} ${line.trim().slice(0, 180)}`);
    const uploadEvidence = uploadedTextFiles.slice(0, 3).map((file) => `uploaded-file:${file.name} ${String(file.content || "").trim().slice(0, 180)}`);
    const evidence = [...codeEvidence, ...logEvidence, ...uploadEvidence].slice(0, 8);

    return {
      answer:
        "I reviewed the pasted context in evidence-only mode. Because no project path is connected, I can reason about the pasted code/logs, but I cannot safely inspect neighboring files, prepare an Apply patch, or run validation until a project is connected.",
      inspectedFiles: evidenceLabels,
      findings: evidence.length
        ? [`Agent received and reviewed: ${evidenceLabels.join(", ")}.`, "No project files were available, so findings are limited to the pasted evidence shown below."]
        : [`Agent received and reviewed: ${evidenceLabels.join(", ")}.`],
      rootCause: {
        status: "not_found",
        title: "Pasted evidence reviewed; no project-level proof available",
        confidence: 0.62,
        why:
          "The Agent had pasted context to inspect, but no connected project files or validation runner. It should not claim an exact project bug or patch without file access.",
        evidence,
        exactReferences: evidence.map((item) => item.split(" ")[0]),
      },
      investigation: {
        filesScanned: evidenceLabels,
        filesIgnored: ["Project files were not inspected because no project path/file list was connected."],
        searchTermsUsed: tokenizeForEvidence(`${question}\n${log}\n${code}`).slice(0, 10),
        selectionReason: "Evidence-only Agent mode used pasted code/log/upload context directly.",
      },
      patch: {
        mode: "none",
        file: "",
        search: "",
        replacement: "",
        language: "text",
        explanation: "Evidence-only mode cannot prepare safe file patches without a connected project path.",
      },
      patchConfidence: {
        confidence: 0,
        risk: "high",
        filesAffected: 0,
        reason: "No project file was connected, so Apply cannot safely target a real file.",
      },
      dependencyProposal: {
        needed: false,
        packageName: "",
        devDependency: false,
        reason: "No project dependencies were inspected.",
      },
      validationPlan: [
        "Connect the project path if you want exact neighboring-file inspection and Apply.",
        "Or upload/paste the specific complete file and ask for a review of that pasted code only.",
      ],
      confidence: 0.62,
    };
  }

  return {
    answer:
      "I can run in evidence-only mode without a connected project. I reviewed the attached context, but I need payment logs, gateway responses, EMV/TLV, HAR/network data, screenshots, or pasted code to make a grounded finding.",
    inspectedFiles: [],
    findings: ["No connected project was available, and the attached evidence did not prove a specific bug or payment root cause."],
    rootCause: {
      status: "not_found",
      title: "No proven issue from evidence-only context",
      confidence: 0.5,
      why: "Agent did not have project files and the provided evidence was not specific enough to prove a cause.",
      evidence: [],
      exactReferences: [],
    },
    investigation: {
      filesScanned: [],
      filesIgnored: ["Project files were not inspected because no project path/file list was connected."],
      searchTermsUsed: tokenizeForEvidence(`${question}\n${log}\n${code}`).slice(0, 10),
      selectionReason: "Evidence-only Agent mode.",
    },
    patch: {
      mode: "none",
      file: "",
      search: "",
      replacement: "",
      language: "text",
      explanation: "Evidence-only mode cannot prepare code patches without a connected project.",
    },
    patchConfidence: {
      confidence: 0,
      risk: "high",
      filesAffected: 0,
      reason: "No project files were available for safe patching.",
    },
    dependencyProposal: {
      needed: false,
      packageName: "",
      devDependency: false,
      reason: "No project dependencies were inspected.",
    },
    validationPlan: ["Attach more evidence, or connect a project path for full file inspection and patching."],
    confidence: 0.5,
  };
}

function asksForStructuralScan(text: string) {
  return /\b(missing|unclosed|unmatched|unexpected|find|scan|look\s+for|syntax|compile|compiler|build)\b[\s\S]{0,80}(?:\)|\}|\]|\(|\{|\[|quote|quotes|brace|braces|paren|parenthes|bracket|semicolon)|(?:\)|\}|\]|\(|\{|\[|quote|quotes|brace|braces|paren|parenthes|bracket|semicolon)[\s\S]{0,80}\b(missing|unclosed|unmatched|unexpected|find|scan|syntax|compile|compiler|build)\b/i.test(
    text,
  );
}

function asksForBehaviorAudit(text: string) {
  const wantsBugs =
    /\b(bugs?|glitches?|regressions?|weird|lag|slow|freeze|frozen|stuck|wrong|broken|not\s+working|issues?|problems?|look\s+through|take\s+a\s+look|project\s+health|deeper\s+(?:project\s+)?(?:health\s+)?investigation|scan\s+(?:my|the)\s+(?:project|app|website|code))\b/i.test(
      text,
    );
  const websiteContext = /\b(website|app|application|ui|ux|page|chat|composer|modal|sidebar|button|message|project|code|repo|files?)\b/i.test(
    text,
  );
  const explicitSyntax = asksForStructuralScan(text);

  return wantsBugs && websiteContext && !explicitSyntax;
}

function asksForProjectHealthScan(text: string) {
  if (asksForStructuralScan(text)) return true;

  const problemRequest =
    /\b(bugs?|errors?|issues?|problems?|broken|not\s+working|failing|failed|failure|crash(?:es|ing)?|exception|compile|compiler|build|syntax|diagnose|debug|what'?s\s+wrong|take\s+a\s+look|look\s+through|look\s+at|check\s+(?:my|the)|scan\s+(?:my|the))\b/i.test(
      text,
    );
  const projectContext = /\b(code|project|repo|app|application|file|files|source|build|compiler|errors?|issues?)\b/i.test(
    text,
  );
  const isPureFeatureRequest =
    /\b(add|create|make|build\s+me|implement|update|change|style|design|new|button|form|page|component)\b/i.test(text) &&
    !/\b(bugs?|errors?|issues?|problems?|broken|not\s+working|failing|failed|failure|crash(?:es|ing)?|exception|syntax|compile|compiler|what'?s\s+wrong|diagnose|debug)\b/i.test(
      text,
    );

  return problemRequest && projectContext && !isPureFeatureRequest;
}

async function answerImageOnlyQuestion({
  question,
  uploadedFiles,
}: {
  question: string;
  uploadedFiles: UploadedFilePayload[];
}) {
  const uploadedSummary = summarizeUploadedFiles(uploadedFiles);

  const response = await openai.responses.create({
    model: "gpt-4.1",
    max_output_tokens: 900,
    input: [
      {
        role: "system",
        content: `You are PayFix AI. Answer image/screenshot questions accurately.

Rules:
- Preserve actual uploaded filenames and MIME types from UPLOADED FILES.
- When multiple images are uploaded, refer to them by REFERENCE LABEL, for example "Image 1: checkout.png". The uploaded image parts are provided in the same order as UPLOADED FILES.
- If the image is a screenshot, say it is a screenshot and summarize the UI/text visible in it.
- Do not confuse text inside the screenshot with the uploaded file's actual name or format.
- If screenshot text says "file.svg" but metadata says "image.png" / image/png, say the screenshot contains text referring to file.svg, but the uploaded file is image.png.
- Do not inspect project files or claim a code issue unless the user asks for a code change.`,
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `USER REQUEST:
${question}

UPLOADED FILES:
${uploadedSummary}`,
          },
          ...imageParts(uploadedFiles),
        ],
      },
    ],
  });

  return response.output_text?.trim() || "I could not determine what is shown in the image.";
}

async function selectFiles({
  question,
  history,
  memory,
  log,
  code,
  computerSearchResults,
  projectFileList,
}: {
  question: string;
  history: string;
  memory: string;
  log: string;
  code: string;
  computerSearchResults: string;
  projectFileList: string;
}) {
  const response = await openai.responses.create({
    model: AGENT_FAST_MODEL,
    max_output_tokens: 800,
    text: {
      format: {
        type: "json_schema",
        name: "payfix_agent_file_selection",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            selectedFiles: {
              type: "array",
              maxItems: 6,
              items: { type: "string" },
            },
            rationale: { type: "string" },
          },
          required: ["selectedFiles", "rationale"],
        },
        strict: true,
      },
    },
    input: [
      {
        role: "system",
        content: `You are PayFix Agent's file picker.

Pick the smallest set of exact project files needed to answer the request or create a patch.
Return only files that appear in PROJECT FILE LIST. Prefer source, config, API route, component, server, and style files.
If the user asks for an edit, include the file where the edit most likely belongs and any nearby dependency file needed to verify it.
If the user or recent conversation names a file exactly, select that file first.
If multiple files share a similar name, select the most exact path match and explain the ambiguity in rationale.
For refresh, reload, saved chat, active chat, localStorage/sessionStorage, draft restore, or "opens new chat instead of current chat" bugs, select the state owner / route entry file first, especially app/page.tsx or page.tsx, before presentational components.
If the latest request is vague, such as "do it", "fix it", "complete it", or "can you do it for me", resolve what "it" means from RECENT CONVERSATION before selecting files.`,
      },
      {
        role: "user",
        content: `USER REQUEST:
${question}

RECENT CONVERSATION:
${history || "No recent conversation."}

COMPRESSED PROJECT MEMORY:
${memory || "No compressed memory."}

PAYMENT LOG:
${log || "No log."}

RELATED CODE:
${code.slice(0, 12000) || "No pasted code."}

COMPUTER SEARCH:
${computerSearchResults.slice(0, 12000) || "No computer search."}

PROJECT FILE LIST:
${projectFileList.slice(0, 35000)}`,
      },
    ],
  });

  return safeJsonParse<FileSelectionResult>(response.output_text || "", {
    selectedFiles: [],
    rationale: "The model did not return valid file selection JSON.",
  });
}

async function readSelectedProjectFiles(files: string[]) {
  if (!files.length) return [];

  const response = await fetch("http://localhost:7777/project/read-selected", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });

  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "Could not read selected project files.");

  return (data.files || []) as ProjectFilePayload[];
}

async function previewPatch(patch: AgentPatch) {
  if (patch.mode === "none") return null;

  const response = await fetch("http://localhost:7777/project/preview-write-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: patch.file,
      mode: patch.mode,
      search: patch.search,
      content: patch.replacement,
      apply: false,
    }),
  });

  return (await response.json()) as PreviewResult;
}

async function validatePatch(patch: AgentPatch) {
  if (patch.mode === "none") return null;

  const response = await fetch("http://localhost:7777/project/validate-file-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: patch.file,
      mode: patch.mode,
      search: patch.search,
      content: patch.replacement,
    }),
  });

  return (await response.json()) as ValidationResult;
}

async function repairPatchAfterValidation({
  question,
  projectSummary,
  failedPatch,
  validation,
}: {
  question: string;
  projectSummary: string;
  failedPatch: AgentPatch;
  validation: ValidationResult;
}) {
  const validationOutput =
    validation.commands
      ?.map((command) => `${command.ok ? "PASS" : "FAIL"} ${command.command}\n${command.output || ""}`)
      .join("\n\n") ||
    validation.error ||
    "Validation failed without command output.";

  const response = await openai.responses.create({
    model: AGENT_REASONING_MODEL,
    max_output_tokens: 1800,
    text: {
      format: {
        type: "json_schema",
        name: "payfix_agent_patch_repair",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["replace", "insert", "none"] },
            file: { type: "string" },
            search: { type: "string" },
            replacement: { type: "string" },
            language: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["mode", "file", "search", "replacement", "language", "explanation"],
        },
        strict: true,
      },
    },
    input: [
      {
        role: "system",
        content: `You repair one failed PayFix patch attempt.
Return only a safe patch.
Use mode "replace" only when search is an exact substring from PROJECT FILES.
Use mode "insert" only for new files or clear append-only fixes.
Use mode "none" if the validation failure cannot be repaired from inspected files.
Do not invent APIs or files.`,
      },
      {
        role: "user",
        content: `USER REQUEST:
${question}

FAILED PATCH:
FILE: ${failedPatch.file}
MODE: ${failedPatch.mode}
SEARCH:
${failedPatch.search}

REPLACEMENT:
${failedPatch.replacement}

VALIDATION OUTPUT:
${validationOutput.slice(0, 12000)}

PROJECT FILES:
${projectSummary.slice(0, 60000)}`,
      },
    ],
  });

  return safeJsonParse<AgentPatch>(response.output_text || "", {
    mode: "none",
    file: "",
    search: "",
    replacement: "",
    language: "text",
    explanation: "Patch repair did not return valid JSON.",
  });
}

async function readProjectDiagnostics() {
  try {
    const response = await fetch("http://localhost:7777/project/diagnostics");
    return (await response.json()) as ValidationResult;
  } catch {
    return null;
  }
}

async function readPackageInfo() {
  try {
    const response = await fetch("http://localhost:7777/project/package-info");
    return (await response.json()) as PackageInfo;
  } catch {
    return null;
  }
}

async function readStructuralScan() {
  try {
    const response = await fetch("http://localhost:7777/project/structural-scan?limit=120");
    return (await response.json()) as StructuralScanResult;
  } catch {
    return null;
  }
}

function verifyPatchAgainstFiles(patch: AgentPatch, projectFiles: ProjectFilePayload[]) {
  if (patch.mode === "none") return { ok: false, reason: "No patch was requested." };

  const matchingFile = projectFiles.find(
    (file) => normalizePath(file.file).toLowerCase() === normalizePath(patch.file).toLowerCase(),
  );

  if (!matchingFile) {
    const looksLikeNewProjectFile = !pathLooksAbsolute(patch.file) && /\.[a-z0-9]{1,8}$/i.test(patch.file);
    if (patch.mode === "insert" && looksLikeNewProjectFile && patch.replacement.trim()) {
      return { ok: true, reason: "Patch creates a new project file." };
    }

    return { ok: false, reason: "Patch target was not one of the files the agent inspected." };
  }

  if (matchingFile.kind !== "text" || typeof matchingFile.content !== "string") {
    return { ok: false, reason: "Patch target is not a text file." };
  }

  if (!patch.replacement.trim()) {
    return { ok: false, reason: "Patch replacement is empty." };
  }

  if (patch.replacement.length > 150000) {
    return { ok: false, reason: "Patch replacement is too large for automatic Apply." };
  }

  if (patch.mode === "insert") {
    if (matchingFile.content.includes(patch.replacement.trim())) {
      return { ok: false, reason: "Patch insertion is already present in the file." };
    }

    return { ok: true, reason: "" };
  }

  if (patch.mode !== "replace") {
    return { ok: false, reason: "Unsupported patch mode." };
  }

  if (patch.search.trim().length < 40) {
    return { ok: false, reason: "The exact code to replace is too small to apply safely." };
  }

  if (patch.search === patch.replacement) {
    return { ok: false, reason: "Patch replacement is identical to the current code." };
  }

  if (patch.mode === "replace" && !matchingFile.content.includes(patch.search)) {
    return { ok: false, reason: "The exact code to replace was not found in the inspected file." };
  }

  return { ok: true, reason: "" };
}

function pathLooksAbsolute(filePath: string) {
  return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith("/") || filePath.startsWith("\\\\");
}

function isCompletionRequest(question: string, history: string) {
  return /\b(add|append|insert|complete|finish|continue|cut off|cut-off|truncated|missing ending|missing code|at the end|end of file|do it for me|can you do it|fix it|implement it|the script|script\.js)\b/i.test(
    `${question}\n${history}`,
  );
}

function isFeatureRequest(text: string) {
  return /\b(add|create|make|build|implement|update|change|style|design|new|button|form|page|component)\b/i.test(text) &&
    !/\b(bug|error|broken|fail|issue|fix|crash|exception|not working)\b/i.test(text);
}

function normalizeAnswerTone(answer: string, question: string) {
  if (!isFeatureRequest(question)) return answer;

  return answer
    .replace(/\bFOUND THE ISSUE:\s*/gi, "REQUESTED CHANGE: ")
    .replace(/\bFOUND ISSUE:\s*/gi, "REQUESTED CHANGE: ")
    .replace(/\bWHY THIS FIXES IT:\s*/gi, "WHAT THIS CHANGES: ");
}

function collapsedWithMap(value: string) {
  let collapsed = "";
  const map: number[] = [];
  let inWhitespace = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (/\s/.test(char)) {
      if (!inWhitespace) {
        collapsed += " ";
        map.push(index);
        inWhitespace = true;
      }
      continue;
    }

    collapsed += char;
    map.push(index);
    inWhitespace = false;
  }

  return { collapsed, map };
}

function findWhitespaceInsensitiveSubstring(haystack: string, needle: string) {
  const normalizedHaystack = collapsedWithMap(haystack);
  const normalizedNeedle = collapsedWithMap(needle);
  const matchIndex = normalizedHaystack.collapsed.indexOf(normalizedNeedle.collapsed.trim());

  if (matchIndex < 0) return "";

  const start = normalizedHaystack.map[matchIndex] ?? -1;
  const endMapIndex = matchIndex + normalizedNeedle.collapsed.trim().length - 1;
  const end = (normalizedHaystack.map[endMapIndex] ?? -1) + 1;

  if (start < 0 || end <= start) return "";

  return haystack.slice(start, end);
}

function exactProjectFileForPatch(patch: AgentPatch, projectFiles: ProjectFilePayload[]) {
  return projectFiles.find(
    (file) => normalizePath(file.file).toLowerCase() === normalizePath(patch.file).toLowerCase(),
  );
}

function suffixPrefixOverlap(left: string, right: string) {
  const max = Math.min(left.length, right.length, 20000);

  for (let length = max; length >= 20; length -= 1) {
    if (left.slice(-length) === right.slice(0, length)) {
      return length;
    }
  }

  return 0;
}

function repairCompletionPatch(
  patch: AgentPatch,
  projectFiles: ProjectFilePayload[],
  question: string,
  history: string,
): AgentPatch {
  if (patch.mode !== "replace") return patch;

  const matchingFile = exactProjectFileForPatch(patch, projectFiles);
  if (!matchingFile || matchingFile.kind !== "text" || typeof matchingFile.content !== "string") return patch;
  if (matchingFile.content.includes(patch.search)) return patch;

  const exactWhitespaceMatch = findWhitespaceInsensitiveSubstring(matchingFile.content, patch.search);
  if (exactWhitespaceMatch) {
    return {
      ...patch,
      search: exactWhitespaceMatch,
      explanation: `${patch.explanation}\n\nAdjusted the replace search to the exact text found in the inspected file.`,
    };
  }

  if (!isCompletionRequest(question, history)) return patch;

  const oldContent = matchingFile.content;
  const proposed = patch.replacement.trim();
  if (!proposed) return patch;

  const overlap = suffixPrefixOverlap(oldContent, proposed);
  const insertContent = overlap ? proposed.slice(overlap).trimStart() : proposed;
  if (!insertContent || oldContent.includes(insertContent.trim())) return patch;

  if (!overlap && proposed.length > Math.max(5000, oldContent.length * 0.8)) {
    return patch;
  }

  return {
    ...patch,
    mode: "insert",
    search: "",
    replacement: insertContent,
    explanation: `${patch.explanation}\n\nConverted to a safe insert/append patch because the exact replace block was not found but the request is an add/complete/append style change.`,
  };
}

function buildSimpleHtmlAddFallback({
  question,
  projectFiles,
}: {
  question: string;
  projectFiles: ProjectFilePayload[];
}): AgentResult | null {
  const htmlFile =
    projectFiles.find(
      (file) =>
        file.kind === "text" &&
        typeof file.content === "string" &&
        /\.(html?|xhtml)$/i.test(file.file) &&
        /<body[\s>]/i.test(file.content),
    ) ||
    projectFiles.find(
      (file) => file.kind === "text" && typeof file.content === "string" && /\.(html?|xhtml)$/i.test(file.file),
    );

  if (!htmlFile) return null;

  const wantsButton = /\b(button|click|clicking)\b/i.test(question);
  const wantsPinkBox = /\bpink\s+box\b/i.test(question) || (/\bpink\b/i.test(question) && /\bbox|message|panel/i.test(question));
  const wantsAdd = /\b(add|create|insert|make|include)\b/i.test(question);

  if (!wantsButton || !wantsAdd) return null;

  const snippet = `\n<!-- PayFix preview: added interactive button -->\n<style>\n  .payfix-added-action {\n    margin-top: 16px;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    border: 0;\n    border-radius: 10px;\n    background: #ec4899;\n    color: #ffffff;\n    font: 700 15px/1.2 Arial, sans-serif;\n    padding: 12px 18px;\n    cursor: pointer;\n    box-shadow: 0 8px 18px rgba(236, 72, 153, 0.22);\n  }\n\n  .payfix-added-box {\n    display: none;\n    margin-top: 12px;\n    max-width: 420px;\n    border: 1px solid #f9a8d4;\n    border-radius: 14px;\n    background: #fce7f3;\n    color: #831843;\n    padding: 14px 16px;\n    font: 600 15px/1.5 Arial, sans-serif;\n    box-shadow: 0 10px 24px rgba(236, 72, 153, 0.16);\n  }\n\n  .payfix-added-box.is-visible {\n    display: block;\n  }\n</style>\n<button class="payfix-added-action" type="button" id="payfixShowPinkBox">Show Pink Box</button>\n<div class="payfix-added-box" id="payfixPinkBox">Here is your nice pink box.</div>\n<script>\n  (function () {\n    var button = document.getElementById("payfixShowPinkBox");\n    var box = document.getElementById("payfixPinkBox");\n    if (!button || !box) return;\n\n    button.addEventListener("click", function () {\n      box.classList.toggle("is-visible");\n    });\n  })();\n</script>\n`;

  if (htmlFile.content?.includes("payfixShowPinkBox")) {
    return null;
  }

  return {
    answer: wantsPinkBox
      ? "I prepared a preview that adds a button and a styled pink box underneath it. Clicking the button toggles the box."
      : "I prepared a preview that adds the requested button.",
    inspectedFiles: [normalizePath(htmlFile.file)],
    findings: [
      `Prepared an insert-only HTML snippet for ${normalizePath(htmlFile.file)}.`,
      "The preview appends scoped CSS, a button, a pink box, and a small click handler without replacing the current file.",
    ],
    rootCause: {
      status: "not_applicable",
      title: "Feature request",
      confidence: 0.9,
      why: "The user requested a new UI behavior, not a bug investigation.",
      evidence: [`${normalizePath(htmlFile.file)} was inspected and can accept an appended snippet.`],
      exactReferences: [],
    },
    investigation: {
      filesScanned: [normalizePath(htmlFile.file)],
      filesIgnored: [],
      searchTermsUsed: ["button", "pink", "box", "html"],
      selectionReason: "The request asked for an HTML button and the inspected HTML file contains the page body.",
    },
    patch: {
      mode: "insert",
      file: normalizePath(htmlFile.file),
      search: "",
      replacement: snippet,
      language: "html",
      explanation:
        "Prepared a safe insert patch that adds scoped CSS, a button, a pink box below it, and a click handler. Nothing is written unless you apply the preview.",
    },
    patchConfidence: {
      confidence: 0.88,
      risk: "medium",
      filesAffected: 1,
      reason: "Insert-only HTML preview avoids deleting existing code, but still needs browser verification.",
    },
    dependencyProposal: {
      needed: false,
      packageName: "",
      devDependency: false,
      reason: "No dependency is needed for a plain HTML/CSS/JS snippet.",
    },
    validationPlan: [
      `Open ${normalizePath(htmlFile.file)} in a browser.`,
      "Click the new button.",
      "Confirm the pink box appears underneath it and the existing page still works.",
    ],
    confidence: 0.88,
  };
}

function buildSignupFormFilesFallback(question: string, history: string): AgentResult | null {
  const combined = `${history}\n${question}`;
  const asksForSignup = /\bsign\s*up|signup|registration|register\b/i.test(combined);
  const asksForFormHtml = /\bform\.html\b/i.test(combined) || /\bfomr\.html\b/i.test(combined);
  const asksForFormCss = /\bform\.css\b/i.test(combined);
  const saysNoIndexLink = /\b(no|don't|do not)\s+add\s+(a\s+)?link\b/i.test(question);

  if (!asksForSignup || !asksForFormHtml || !asksForFormCss) return null;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign Up</title>
  <link rel="stylesheet" href="form.css">
</head>
<body>
  <main class="signup-page">
    <section class="signup-card" aria-labelledby="signup-title">
      <p class="eyebrow">Create account</p>
      <h1 id="signup-title">Sign up for updates</h1>
      <p class="intro">Join in a minute. No clutter, just a clean form ready to connect to your backend.</p>

      <form class="signup-form" action="#" method="post">
        <label>
          Full name
          <input type="text" name="fullName" autocomplete="name" placeholder="Miriam Green" required>
        </label>

        <label>
          Email address
          <input type="email" name="email" autocomplete="email" placeholder="miriam@example.com" required>
        </label>

        <label>
          Password
          <input type="password" name="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required>
        </label>

        <label class="terms">
          <input type="checkbox" name="terms" required>
          <span>I agree to receive account updates and product emails.</span>
        </label>

        <button type="submit">Create account</button>
      </form>
    </section>
  </main>
</body>
</html>
`;

  const css = `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f5f7fb;
  color: #101828;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

.signup-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  background:
    radial-gradient(circle at top left, rgba(37, 99, 235, 0.14), transparent 30%),
    linear-gradient(135deg, #f8fbff 0%, #eef4ff 100%);
}

.signup-card {
  width: min(100%, 460px);
  border: 1px solid #dbe5f5;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.92);
  padding: 34px;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.14);
}

.eyebrow {
  margin: 0 0 10px;
  color: #2563eb;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: clamp(28px, 5vw, 40px);
  line-height: 1.05;
}

.intro {
  margin: 14px 0 26px;
  color: #526070;
  line-height: 1.6;
}

.signup-form {
  display: grid;
  gap: 16px;
}

label {
  display: grid;
  gap: 8px;
  color: #344054;
  font-size: 14px;
  font-weight: 700;
}

input {
  width: 100%;
  border: 1px solid #c8d5e8;
  border-radius: 12px;
  padding: 13px 14px;
  color: #101828;
  font: inherit;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.14);
}

.terms {
  grid-template-columns: 18px 1fr;
  align-items: start;
  gap: 10px;
  color: #526070;
  font-weight: 600;
}

.terms input {
  margin-top: 2px;
  accent-color: #2563eb;
}

button {
  margin-top: 4px;
  border: 0;
  border-radius: 12px;
  background: #2563eb;
  color: #ffffff;
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  padding: 14px 18px;
  box-shadow: 0 12px 26px rgba(37, 99, 235, 0.25);
}

button:hover {
  background: #1d4ed8;
}
`;

  const patchSet: AgentPatch[] = [
    {
      mode: "insert",
      file: "form.html",
      search: "",
      replacement: html,
      language: "html",
      explanation: "Prepared a new form.html file with a responsive accessible sign-up form that links to form.css.",
    },
    {
      mode: "insert",
      file: "form.css",
      search: "",
      replacement: css,
      language: "css",
      explanation: "Prepared a new form.css file with clean responsive styling for the sign-up form.",
    },
  ];

  return {
    answer: `I prepared a two-file preview for ${saysNoIndexLink ? "the new standalone sign-up form without changing index.html" : "a new sign-up form"}.`,
    inspectedFiles: [],
    findings: [
      "Prepared form.html as a standalone sign-up page.",
      "Prepared form.css as the separate stylesheet.",
      "No index.html link was added.",
    ],
    rootCause: {
      status: "not_applicable",
      title: "New file request",
      confidence: 0.94,
      why: "The user asked to create new files, not diagnose an existing failure.",
      evidence: ["Requested filenames were form.html and form.css.", "No index.html link was requested."],
      exactReferences: [],
    },
    investigation: {
      filesScanned: [],
      filesIgnored: ["index.html"],
      searchTermsUsed: ["form.html", "form.css", "sign up", "no link"],
      selectionReason: "The request was to create standalone files, so no existing file content was required.",
    },
    patch: patchSet[0],
    patchSet,
    patchConfidence: {
      confidence: 0.92,
      risk: "low",
      filesAffected: 2,
      reason: "The preview creates two new standalone files and does not modify existing files.",
    },
    dependencyProposal: {
      needed: false,
      packageName: "",
      devDependency: false,
      reason: "Plain HTML/CSS files do not need dependencies.",
    },
    validationPlan: [
      "Apply all file changes from the Apply modal.",
      "Open form.html in a browser.",
      "Verify form.css loads and the layout is responsive.",
      "Submit empty fields to verify native required-field validation.",
    ],
    confidence: 0.92,
  };
}

function lineBlockPatchFromIssue(
  issue: NonNullable<StructuralScanResult["issues"]>[number],
  projectFiles: ProjectFilePayload[],
): AgentPatch | null {
  return lineBlockPatchFromIssues([issue], projectFiles);
}

function lineBlockPatchFromIssues(
  issues: NonNullable<StructuralScanResult["issues"]>,
  projectFiles: ProjectFilePayload[],
): AgentPatch | null {
  const patchableIssues = issues.filter((issue) => issue.line && /missing closing "\)" after `/i.test(issue.message));
  if (!patchableIssues.length) return null;

  const fileCounts = new Map<string, number>();
  for (const issue of patchableIssues) {
    const key = normalizePath(issue.file).toLowerCase();
    fileCounts.set(key, (fileCounts.get(key) || 0) + 1);
  }

  const [targetKey] = [...fileCounts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (!targetKey) return null;

  const targetFile = projectFiles.find((file) => normalizePath(file.file).toLowerCase() === targetKey) ||
    projectFiles.find((file) => baseName(file.file).toLowerCase() === baseName(targetKey).toLowerCase());
  if (!targetFile?.content || targetFile.kind !== "text") return null;

  const targetIssues = patchableIssues.filter(
    (issue) =>
      normalizePath(issue.file).toLowerCase() === targetKey ||
      baseName(issue.file).toLowerCase() === baseName(targetFile.file).toLowerCase(),
  );
  const lines = targetFile.content.split(/\r?\n/);
  const replacementByIndex = new Map<number, string>();

  for (const issue of targetIssues) {
    if (!issue.line) continue;
    const targetIndex = issue.line - 1;
    const originalLine = lines[targetIndex];
    if (typeof originalLine !== "string" || originalLine.includes(")")) continue;

    const replacementLine = originalLine.includes("{")
      ? originalLine.replace(/\s*\{/, ") {")
      : originalLine.replace(/(\s*)$/, ")$1");

    if (replacementLine !== originalLine) {
      replacementByIndex.set(targetIndex, replacementLine);
    }
  }

  if (!replacementByIndex.size) return null;

  const indexes = [...replacementByIndex.keys()].sort((a, b) => a - b);
  const start = Math.max(0, indexes[0] - 3);
  const end = Math.min(lines.length, indexes[indexes.length - 1] + 4);
  const searchLines = lines.slice(start, end);
  const replacementLines = searchLines.map((line, offset) => replacementByIndex.get(start + offset) || line);

  const search = searchLines.join("\n");
  const replacement = replacementLines.join("\n");
  if (!targetFile.content.includes(search) || search.length < 40) return null;

  const lineList = indexes.map((index) => index + 1).join(", ");

  return {
    mode: "replace",
    file: normalizePath(targetFile.file),
    search,
    replacement,
    language: targetFile.extension || "text",
    explanation: `Adds missing closing parenthesis characters on line(s) ${lineList} before the C# blocks start.`,
  };
}

function buildStructuralScanFallback(
  structuralScan: StructuralScanResult | null | undefined,
  projectFiles: ProjectFilePayload[] = [],
): AgentResult | null {
  const issues = structuralScan?.issues?.filter((issue) => issue.severity !== "info").slice(0, 12) || [];
  if (!issues.length) return null;

  const findings = issues.map(
    (issue) =>
      `${issue.relative || normalizePath(issue.file)}${issue.line ? `:${issue.line}` : ""} - ${issue.message}${issue.code ? ` Code: ${issue.code}` : ""}`,
  );
  const first = issues[0];
  const deterministicPatch =
    lineBlockPatchFromIssues(issues, projectFiles) ||
    issues.map((issue) => lineBlockPatchFromIssue(issue, projectFiles)).find((patch): patch is AgentPatch => Boolean(patch));

  return {
    answer: deterministicPatch
      ? `I ran a structural scan and found a fixable syntax issue. I prepared a safe patch preview for ${baseName(deterministicPatch.file)}. Review it before applying.`
      : `I ran a structural scan across the connected project and found ${issues.length} likely syntax/delimiter issue(s). The first issue is ${first.relative || normalizePath(first.file)}${first.line ? `:${first.line}` : ""}: ${first.message}`,
    inspectedFiles: [...new Set(issues.map((issue) => normalizePath(issue.file)))],
    findings,
    rootCause: {
      status: "found",
      title: "Structural syntax issue detected",
      confidence: 0.94,
      why: "The deterministic structural scanner found delimiter/tag issues in connected project files before model reasoning.",
      evidence: findings.slice(0, 6),
      exactReferences: issues
        .filter((issue) => issue.line)
        .slice(0, 6)
        .map((issue) => `${normalizePath(issue.file)}:${issue.line}`),
    },
    investigation: {
      filesScanned: [...new Set(issues.map((issue) => normalizePath(issue.file)))],
      filesIgnored: [],
      searchTermsUsed: ["missing delimiter", "structural scan", "syntax"],
      selectionReason: "A deterministic structural scan found syntax/delimiter issues and selected the affected files.",
    },
    patch: deterministicPatch || {
      mode: "none",
      file: "",
      search: "",
      replacement: "",
      language: "text",
      explanation: "No automatic patch was prepared because the structural scan report should be reviewed first.",
    },
    patchConfidence: {
      confidence: deterministicPatch ? 0.9 : 0,
      risk: deterministicPatch ? "low" : "high",
      filesAffected: deterministicPatch ? 1 : 0,
      reason: deterministicPatch
        ? "The scanner found a precise missing parenthesis on one source line and PayFix generated a narrow line-block replacement."
        : "Scanner found exact issue locations, but no patch was generated by the model.",
    },
    dependencyProposal: {
      needed: false,
      packageName: "",
      devDependency: false,
      reason: "This is a source syntax issue, not a dependency issue.",
    },
    validationPlan: deterministicPatch
      ? ["Review the Apply preview.", "Apply the patch if it matches the shown line.", "Run Sandbox Runner / build checks again."]
      : ["Fix the reported line(s).", "Run Sandbox Runner / build checks again.", "Re-run Watch Mode to confirm the structural scan is clean."],
    confidence: deterministicPatch ? 0.9 : 0.94,
  };
}

function buildProjectHealthFallback({
  projectFiles,
  projectDiagnostics,
  structuralScan,
}: {
  projectFiles: ProjectFilePayload[];
  projectDiagnostics: ValidationResult | null;
  structuralScan: StructuralScanResult | null;
}): AgentResult | null {
  if (!projectFiles.length && !projectDiagnostics?.commands?.length && !structuralScan?.issues?.length) return null;

  const failedCommands = (projectDiagnostics?.commands || []).filter((command) => !command.ok);
  const structuralIssues = structuralScan?.issues?.filter((issue) => issue.severity !== "info") || [];
  const meaningfulStructuralIssues = structuralIssues.filter(
    (issue) =>
      !/Missing <!DOCTYPE html>|Missing <html>|Missing <body>|tag appears incomplete|Possible tag mismatch|Possible unclosed tag/i.test(
        issue.message,
      ),
  );
  const findings = [
    ...meaningfulStructuralIssues.slice(0, 8).map(
      (issue) =>
        `${issue.relative || normalizePath(issue.file)}${issue.line ? `:${issue.line}` : ""} - ${issue.message}${issue.code ? ` Code: ${issue.code}` : ""}`,
    ),
    ...failedCommands.slice(0, 4).map((command) => {
      const output = command.output?.trim().split(/\r?\n/).slice(0, 6).join(" ") || "No command output.";
      return `Validation command failed: ${command.command}. ${output}`;
    }),
  ];

  const hasCodeEvidence =
    meaningfulStructuralIssues.length > 0 || failedCommands.some((command) => !/spawn EINVAL/i.test(command.output || ""));
  const diagnosticToolIssue = failedCommands.some((command) => /spawn EINVAL/i.test(command.output || ""));
  const title = meaningfulStructuralIssues.length
    ? "Project structural issues found"
    : failedCommands.length
      ? diagnosticToolIssue
        ? "Diagnostics runner issue, not proven source bug"
        : "Project validation failed"
      : "No proven project bug found";

  return {
    answer: meaningfulStructuralIssues.length
      ? `I inspected the connected project and found ${meaningfulStructuralIssues.length} source issue(s). Review the findings below.`
      : failedCommands.length
        ? diagnosticToolIssue
        ? "I inspected selected files, but the local validation command failed to start (`spawn EINVAL`). I cannot honestly claim source-code bugs from that output alone."
          : "I inspected selected files and project diagnostics failed. Review the validation findings below."
        : "I inspected selected files and did not find a proven bug from the available file content or diagnostics.",
    inspectedFiles: projectFiles.map((file) => normalizePath(file.file)),
    findings: findings.length ? findings : ["No concrete bug was proven from the inspected files."],
    rootCause: {
      status: hasCodeEvidence ? "found" : "not_found",
      title,
      confidence: hasCodeEvidence ? 0.78 : 0.62,
      why: meaningfulStructuralIssues.length
        ? "Deterministic structural scan found source-level evidence."
        : failedCommands.length
          ? "Project diagnostics produced command output, but no safe patch was proven."
          : "Files were inspected, but no exact failing line or validation error proved a bug.",
      evidence: findings.slice(0, 6),
      exactReferences: meaningfulStructuralIssues
        .filter((issue) => issue.line)
        .slice(0, 6)
        .map((issue) => `${normalizePath(issue.file)}:${issue.line}`),
    },
    investigation: {
      filesScanned: projectFiles.map((file) => normalizePath(file.file)),
      filesIgnored: [],
      searchTermsUsed: ["bugs", "project health", "diagnostics", "structural scan"],
      selectionReason: "Fallback project-health report generated from inspected files, diagnostics, and structural scan output.",
    },
    patch: {
      mode: "none",
      file: "",
      search: "",
      replacement: "",
      language: "text",
      explanation: "No safe patch was prepared because no exact code change was proven.",
    },
    patchConfidence: {
      confidence: 0,
      risk: "high",
      filesAffected: 0,
      reason: "No safe patch was proven from the inspected evidence.",
    },
    dependencyProposal: {
      needed: false,
      packageName: "",
      devDependency: false,
      reason: "No missing dependency was proven.",
    },
    validationPlan: ["Use the Agent follow-up box to ask for a deeper scan of a specific area.", "Run Project IQ sandbox checks after any patch."],
    confidence: hasCodeEvidence ? 0.78 : 0.62,
  };
}

function findLineNumber(content: string, index: number) {
  return content.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function buildBehaviorAuditFallback({
  projectFiles,
  projectDiagnostics,
}: {
  projectFiles: ProjectFilePayload[];
  projectDiagnostics: ValidationResult | null;
}): AgentResult | null {
  if (!projectFiles.length) return null;

  const risks: Array<{
    file: string;
    line: number;
    title: string;
    evidence: string;
    fix: string;
  }> = [];

  for (const file of projectFiles) {
    if (file.kind !== "text" || !file.content) continue;
    const content = file.content;
    const normalizedFile = normalizePath(file.file);

    for (const match of content.matchAll(/fetch\(([\s\S]{0,240}?)\)/g)) {
      const start = match.index || 0;
      const nearby = content.slice(start, start + 900);
      if (/\.json\(\)/.test(nearby) && !/response\.ok|\.ok\b|status\s*[<>=]/.test(nearby)) {
        risks.push({
          file: normalizedFile,
          line: findLineNumber(content, start),
          title: "Fetch response may be parsed without an HTTP status guard",
          evidence: nearby.split(/\r?\n/).slice(0, 5).join(" ").trim().slice(0, 260),
          fix: "Check response.ok/status before response.json(), and show a clear user-facing error when the request fails.",
        });
      }
    }

    for (const match of content.matchAll(/catch\s*\([^)]*\)\s*\{\s*\}/g)) {
      const start = match.index || 0;
      risks.push({
        file: normalizedFile,
        line: findLineNumber(content, start),
        title: "Empty catch block can hide real user-facing failures",
        evidence: match[0].slice(0, 180),
        fix: "At minimum log the error and surface a status message so failures do not silently disappear.",
      });
    }

    for (const match of content.matchAll(/localStorage\.(?:setItem|getItem|removeItem)|window\.localStorage\.(?:setItem|getItem|removeItem)/g)) {
      const start = match.index || 0;
      const before = content.slice(Math.max(0, start - 350), start);
      const after = content.slice(start, start + 350);
      if (!/try\s*\{[\s\S]{0,350}$/.test(before) && !/catch\s*\(/.test(after)) {
        risks.push({
          file: normalizedFile,
          line: findLineNumber(content, start),
          title: "localStorage access may throw without recovery",
          evidence: content.slice(start, start + 220).split(/\r?\n/).join(" ").trim(),
          fix: "Wrap storage access in a small safe helper so quota/private-mode JSON failures do not break the app.",
        });
      }
    }
  }

  const dedupedRisks = risks.filter((risk, index, list) => {
    const key = `${risk.file}:${risk.line}:${risk.title}`;
    return list.findIndex((item) => `${item.file}:${item.line}:${item.title}` === key) === index;
  }).slice(0, 8);
  const diagnosticToolFailures = (projectDiagnostics?.commands || []).filter(
    (command) => !command.ok && /spawn EINVAL/i.test(command.output || ""),
  );
  const inspectedFiles = projectFiles.map((file) => normalizePath(file.file));
  const findings = dedupedRisks.length
    ? dedupedRisks.map((risk) => `${risk.file}:${risk.line} - ${risk.title}. Evidence: ${risk.evidence}`)
    : [
        `Behavioral audit inspected ${projectFiles.length} file(s) and did not prove a website bug from exact source evidence.`,
        ...(diagnosticToolFailures.length
          ? ["Local diagnostics failed to start with spawn EINVAL; that is a runner/tooling issue, not proof of a source-code bug."]
          : []),
      ];

  return {
    answer: dedupedRisks.length
      ? `I ran a deeper behavioral website audit and found ${dedupedRisks.length} source-backed risk(s). I did not treat diagnostic runner failures as app bugs.`
      : "I ran a deeper behavioral website audit and did not find a proven app bug in the inspected files. The local diagnostics runner still failed to start, but that is separate from your source code.",
    inspectedFiles,
    findings,
    rootCause: {
      status: dedupedRisks.length ? "found" : "not_found",
      title: dedupedRisks.length ? "Behavioral source risks found" : "No proven behavioral source bug found",
      confidence: dedupedRisks.length ? 0.74 : 0.68,
      why: dedupedRisks.length
        ? "The audit found concrete code patterns that can produce user-visible failures, each tied to an exact inspected source line."
        : "The audit inspected workflow files but did not find exact source-line evidence strong enough to claim a bug.",
      evidence: findings.slice(0, 6),
      exactReferences: dedupedRisks.slice(0, 6).map((risk) => `${risk.file}:${risk.line}`),
    },
    investigation: {
      filesScanned: inspectedFiles,
      filesIgnored: [],
      searchTermsUsed: [
        "behavioral audit",
        "fetch response handling",
        "empty catch",
        "localStorage safety",
        "state persistence",
        "loading/error paths",
      ],
      selectionReason:
        "Deeper website audit fallback inspected selected app/workflow files and reported only source-backed risks, not scanner-only syntax guesses.",
    },
    patch: {
      mode: "none",
      file: "",
      search: "",
      replacement: "",
      language: "text",
      explanation: "No automatic patch was prepared because this audit report needs a chosen fix target.",
    },
    patchConfidence: {
      confidence: 0,
      risk: "high",
      filesAffected: 0,
      reason: "No single safe patch was chosen from the audit findings.",
    },
    dependencyProposal: {
      needed: false,
      packageName: "",
      devDependency: false,
      reason: "No missing dependency was proven.",
    },
    validationPlan: dedupedRisks.length
      ? [
          "Choose one risk to fix from the exact file:line references.",
          "Prepare a focused patch for that file only.",
          "Run TypeScript/lint/build checks after applying.",
        ]
      : ["Pick a specific workflow to audit next, such as refresh persistence, upload previews, Apply, or Agent popup flow."],
    confidence: dedupedRisks.length ? 0.74 : 0.68,
  };
}

function isSafeNpmPackageName(packageName: string) {
  return /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(packageName);
}

function inferDependencyProposalFromValidation(projectValidation: ValidationResult | null): DependencyProposal | null {
  const output = (projectValidation?.commands || [])
    .map((command) => command.output || "")
    .join("\n");

  if (!output.trim()) {
    return null;
  }

  const moduleMatch = output.match(/Cannot find module ['"]([^'"]+)['"]/i);
  if (moduleMatch?.[1]) {
    const packageName = moduleMatch[1].startsWith("@")
      ? moduleMatch[1].split("/").slice(0, 2).join("/")
      : moduleMatch[1].split("/")[0];

    if (packageName && !packageName.startsWith(".") && isSafeNpmPackageName(packageName)) {
      return {
        needed: true,
        packageName,
        devDependency: false,
        reason: `Project validation failed because TypeScript could not resolve module "${moduleMatch[1]}". Installing "${packageName}" should satisfy the missing runtime dependency.`,
      };
    }
  }

  const nodeTypesMatch = output.match(/Cannot find (?:name|module) ['"]?(process|Buffer|fs|path|crypto|node:[^'"\s]+)['"]?/i);
  if (nodeTypesMatch) {
    return {
      needed: true,
      packageName: "@types/node",
      devDependency: true,
      reason: `Project validation references Node APIs (${nodeTypesMatch[1]}), but Node type declarations are missing.`,
    };
  }

  return null;
}

function inferDependencyProposalFromImports(
  projectFiles: ProjectFilePayload[],
  packageInfo: PackageInfo | null,
): DependencyProposal | null {
  if (!packageInfo?.hasPackageJson) return null;

  const installed = new Set([
    ...Object.keys(packageInfo.dependencies || {}),
    ...Object.keys(packageInfo.devDependencies || {}),
  ]);
  const externalImportRefs = findExternalImportReferences(projectFiles);
  const externalImports = [...new Set(externalImportRefs.map((item) => item.packageName))];
  const builtIns = new Set([
    "fs",
    "path",
    "crypto",
    "os",
    "http",
    "https",
    "url",
    "util",
    "stream",
    "events",
    "child_process",
    "buffer",
  ]);

  const missing = externalImports.find((packageName) => {
    if (installed.has(packageName) || builtIns.has(packageName)) return false;

    const refs = externalImportRefs.filter((item) => item.packageName === packageName);
    if (refs.length && refs.every((ref) => importBelongsToNestedPackage(ref.file))) return false;

    return true;
  });

  if (!missing || !isSafeNpmPackageName(missing)) {
    return null;
  }

  return {
    needed: true,
    packageName: missing,
    devDependency: false,
    reason: `Inspected project files import "${missing}", but "${missing}" is not listed in package.json dependencies or devDependencies.`,
  };
}

function toMarkdown(
  result: AgentResult,
  selection: FileSelectionResult,
  loopSteps: AgentLoopStep[],
  previewReady: boolean,
  warning: string,
  projectValidation: ValidationResult | null,
  projectDiagnostics: ValidationResult | null,
  groundingEvidence: GroundingEvidence[],
) {
  const inspected =
    result.inspectedFiles.length > 0
      ? result.inspectedFiles.map((file) => `- ${file}`).join("\n")
      : selection.selectedFiles.map((file) => `- ${file}`).join("\n") || "- None";

  const findings = result.findings.length
    ? result.findings.map((finding) => `- ${finding}`).join("\n")
    : "- No concrete finding from inspected files.";
  const evidenceBlock = groundingEvidence.length
    ? groundingEvidence
        .map((item) => `- ${item.file}:${item.line} - ${item.text || item.reason}`)
        .join("\n")
    : result.rootCause.evidence?.some((item) => /^pasted-code:|^pasted-log:|^uploaded-file:/i.test(item))
      ? result.rootCause.evidence.map((item) => `- ${item}`).join("\n")
    : asksForCodeWork(result.answer)
      ? "- No exact source-line evidence was found in inspected text files. Treat this as lower confidence until a file is inspected."
      : "- No exact source-line evidence was needed for this response.";

  const validationPlan = result.validationPlan.length
    ? result.validationPlan.map((step) => `- ${step}`).join("\n")
    : result.patch.mode === "none"
      ? "- No patch was prepared, so no apply validation is needed."
      : "- Re-read the changed file after applying.";
  const answer =
    result.patch.mode === "none"
      ? result.answer
      : result.answer
          .replace(/\bI\s+(added|changed|updated|modified|replaced|inserted|created|implemented)\b/gi, "I prepared")
          .replace(/\bI\s+have\s+(added|changed|updated|modified|replaced|inserted|created|implemented)\b/gi, "I prepared")
          .replace(/\bThe patch will\b/gi, "The previewed patch would")
          .replace(/\bThis will\b/gi, "If applied, this will");
  const loopBlock = loopSteps.length
    ? loopSteps
        .map((step, index) => `${index + 1}. ${step.step}: ${step.status.toUpperCase()} - ${step.detail}`)
        .join("\n")
    : "No loop steps were recorded.";
  const rootCauseBlock = `Status: ${result.rootCause.status}
Title: ${result.rootCause.title || "No root cause title."}
Confidence: ${Math.round((result.rootCause.confidence || 0) * 100)}%
Why: ${result.rootCause.why || "No explanation returned."}
Evidence:
${
  result.rootCause.evidence?.length
    ? result.rootCause.evidence.map((item) => `- ${item}`).join("\n")
    : "- No model-provided root-cause evidence."
}
References:
${
  result.rootCause.exactReferences?.length
    ? result.rootCause.exactReferences.map((item) => `- ${item}`).join("\n")
    : "- No exact line references returned."
}`;
  const investigationBlock = `Files scanned:
${
  result.investigation.filesScanned?.length
    ? result.investigation.filesScanned.map((file) => `- ${file}`).join("\n")
    : "- None"
}

Files ignored:
${
  result.investigation.filesIgnored?.length
    ? result.investigation.filesIgnored.map((file) => `- ${file}`).join("\n")
    : "- None listed"
}

Search terms used:
${
  result.investigation.searchTermsUsed?.length
    ? result.investigation.searchTermsUsed.map((term) => `- ${term}`).join("\n")
    : "- None listed"
}

Selection reason:
${result.investigation.selectionReason || selection.rationale || "No selection reason returned."}`;
  const patchConfidenceBlock = `Confidence: ${Math.round((result.patchConfidence.confidence || 0) * 100)}%
Risk: ${result.patchConfidence.risk}
Files affected: ${result.patchConfidence.filesAffected}
Reason: ${result.patchConfidence.reason}`;

  const patchBlock =
    result.patch.mode === "none"
      ? `No automatic patch is ready. ${warning || result.patch.explanation}`
      : `Patch preview ${previewReady ? "is ready below in the Apply modal" : "was not opened"}.
Nothing has been written to disk yet. Apply or cancel in the modal to decide what happens.

FILE:
${result.patch.file}

MODE:
${result.patch.mode}

WHY:
${result.patch.explanation}`;

  const validationBlock = projectValidation
    ? projectValidation.skipped
      ? Array.isArray(projectValidation.skipped)
        ? projectValidation.skipped.join("\n")
        : "Project validation was skipped."
      : projectValidation.commands?.length
        ? projectValidation.commands
            .map((command) => {
              const output = command.output?.trim()
                ? `\n  ${command.output.trim().split(/\r?\n/).slice(0, 4).join("\n  ")}`
                : "";
              return `- ${command.ok ? "PASS" : "FAIL"} ${command.command}${output}`;
            })
            .join("\n")
        : "No validation commands were available."
    : "Patch validation did not run.";

  const dependencyBlock = result.dependencyProposal.needed
    ? `Package: ${result.dependencyProposal.packageName}
Type: ${result.dependencyProposal.devDependency ? "devDependency" : "dependency"}
Reason: ${result.dependencyProposal.reason}`
    : "No dependency install proposed.";

  const diagnosticsBlock = projectDiagnostics?.commands?.length
    ? projectDiagnostics.commands
        .map((command) => {
          const output = command.output?.trim()
            ? `\n  ${command.output.trim().split(/\r?\n/).slice(0, 4).join("\n  ")}`
            : "";
          return `- ${command.ok ? "PASS" : "FAIL"} ${command.command}${output}`;
        })
        .join("\n")
    : projectDiagnostics?.skipped
      ? Array.isArray(projectDiagnostics.skipped)
        ? projectDiagnostics.skipped.join("\n")
        : "Project diagnostics were skipped."
      : "Project diagnostics did not run.";
  const trustSummary = `Verdict: ${result.rootCause.status === "found" ? "Issue/risk found" : result.rootCause.status === "not_applicable" ? "Requested change" : "No proven issue"}
Confidence: ${Math.round(result.confidence * 100)}%
Files inspected: ${result.inspectedFiles.length || selection.selectedFiles.length || 0}
Patch: ${result.patch.mode === "none" ? "Not prepared" : previewReady ? "Preview ready" : "Blocked"}
Validation: ${
    projectValidation?.commands?.length
      ? projectValidation.commands.every((command) => command.ok)
        ? "Passed"
        : "Failed"
      : projectValidation?.skipped
        ? "Skipped"
        : "Not run"
  }`;

  return `AGENT INVESTIGATION COMPLETE

${answer}

TRUST SUMMARY
${trustSummary}

INVESTIGATION LOOP
${loopBlock}

ROOT CAUSE
${rootCauseBlock}

PATCH CONFIDENCE
${patchConfidenceBlock}

INVESTIGATION MODE
${investigationBlock}

FILES INSPECTED
${inspected}

GROUNDING EVIDENCE
${evidenceBlock}

FINDINGS
${findings}

PATCH REVIEW
${patchBlock}

PROJECT VALIDATION
${validationBlock}

PROJECT DIAGNOSTICS
${diagnosticsBlock}

DEPENDENCY PROPOSAL
${dependencyBlock}

VALIDATION PLAN
${validationPlan}

Confidence: ${Math.round(result.confidence * 100)}%`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const question = String(body.question || "");
    const history = String(body.history || "");
    const log = String(body.log || "");
    const code = String(body.code || "");
    const computerSearchResults = String(body.computerSearchResults || "");
    const projectFileList = String(body.projectFileList || "");
    const memory = String(body.memory || "");
    const uploadedFiles: UploadedFilePayload[] = Array.isArray(body.uploadedFiles) ? body.uploadedFiles : [];

    const hasProjectFileList = Boolean(projectFileList.trim());

    if (uploadedFiles.some((file) => file.isImage) && !asksForCodeWork(question)) {
      const imageAnswer = await answerImageOnlyQuestion({
        question,
        uploadedFiles,
      });

      return Response.json({
        ok: true,
        result: {
          answer: imageAnswer,
          inspectedFiles: [],
          findings: [],
          patch: {
            mode: "none",
            file: "",
            search: "",
            replacement: "",
            language: "text",
            explanation: "Image question answered without a code patch.",
          },
          dependencyProposal: {
            needed: false,
            packageName: "",
            devDependency: false,
            reason: "Image answer did not inspect project dependencies.",
          },
          validationPlan: [],
          confidence: 1,
        },
        markdown: imageAnswer,
        preview: null,
        projectValidation: null,
        selectedFiles: [],
        relatedFiles: [],
        filesRead: [],
        patchReady: false,
        warning: "Image question answered without inspecting project files.",
      });
    }

    const combinedRequest = `${question}\n${history}`;
    const shouldRunProjectHealthScan = hasProjectFileList && asksForProjectHealthScan(combinedRequest);
    const shouldRunBehaviorAudit = hasProjectFileList && asksForBehaviorAudit(combinedRequest);
    const projectDiagnostics = hasProjectFileList ? await readProjectDiagnostics() : null;
    const diagnosticIssues = parseDiagnosticIssues(projectDiagnostics);
    const shouldRunStructuralScan = shouldRunProjectHealthScan || asksForStructuralScan(combinedRequest) || diagnosticIssues.length > 0;
    const rawStructuralScan = hasProjectFileList && shouldRunStructuralScan ? await readStructuralScan() : null;
    const structuralScan = filterStructuralScanToDiagnostics(rawStructuralScan, diagnosticIssues);
    const diagnosticIssueFiles = resolveFilesFromProjectList(
      diagnosticIssues.map((issue) => issue.file),
      projectFileList,
    );
    const structuralIssueFiles =
      structuralScan?.ok && structuralScan.issues?.length
        ? resolveFilesFromProjectList(
            structuralScan.issues
            .filter((issue) => issue.severity !== "info")
              .map((issue) => issue.file),
            projectFileList,
          )
        : [];

    const selection = hasProjectFileList
      ? await selectFiles({
          question,
          history,
          memory,
          log,
          code,
          computerSearchResults,
          projectFileList,
        })
      : {
          selectedFiles: [],
          rationale: "No connected project file list was available; Agent is running in evidence-only mode.",
        };
    const deterministicFiles = findExplicitlyMentionedFiles(`${question}\n${history}\n${code}`, projectFileList);
    const workflowRelevantFiles = findWorkflowRelevantFiles(combinedRequest, projectFileList);
    const behaviorAuditFiles = shouldRunBehaviorAudit ? findBehaviorAuditFiles(projectFileList) : [];
    const selectedFileSet = new Set<string>();
    const selectedFiles = [
      ...diagnosticIssueFiles,
      ...structuralIssueFiles,
      ...deterministicFiles,
      ...workflowRelevantFiles,
      ...behaviorAuditFiles,
      ...selection.selectedFiles,
    ]
      .filter((file) => {
        const key = normalizePath(file).toLowerCase();
        if (selectedFileSet.has(key)) return false;
        selectedFileSet.add(key);
        return true;
      })
      .slice(0, 8);
    const loopSteps: AgentLoopStep[] = [
      {
        step: "search",
        status: "done",
        detail: !hasProjectFileList
          ? "No project file list was connected; using evidence-only investigation mode."
          : diagnosticIssueFiles.length
          ? `Ran project diagnostics, found ${diagnosticIssues.length} compiler issue(s), and selected ${selectedFiles.length} file(s).`
          : structuralIssueFiles.length
            ? `Ran structural scan across ${structuralScan?.scannedFiles || "project"} source file(s), found ${structuralScan?.issueCount || structuralIssueFiles.length} issue(s), and selected ${selectedFiles.length} file(s).`
          : behaviorAuditFiles.length
            ? `Started a behavioral website audit and selected ${selectedFiles.length} app/workflow file(s).`
          : deterministicFiles.length
            ? `Indexed project file list, included ${deterministicFiles.length} explicitly mentioned file(s), and selected ${selectedFiles.length} total file(s).`
          : workflowRelevantFiles.length
            ? `Indexed project file list, included ${workflowRelevantFiles.length} workflow-critical file(s), and selected ${selectedFiles.length} total file(s).`
          : `Indexed project file list and selected ${selectedFiles.length} likely file(s).`,
      },
    ];
    let projectFiles = hasProjectFileList ? await readSelectedProjectFiles(selectedFiles) : [];
    loopSteps.push({
      step: "read",
      status: projectFiles.length ? "done" : "blocked",
      detail: projectFiles.length
        ? `Read ${projectFiles.length} selected file(s) from the local project.`
        : !hasProjectFileList
          ? "No project files were requested because Agent is investigating uploaded/pasted evidence only."
        : "No selected files were readable.",
    });

    const configFiles = hasProjectFileList
      ? findProjectConfigFiles(projectFileList)
      .filter(
        (file) =>
          !selectedFiles.some((selected) => normalizePath(selected).toLowerCase() === normalizePath(file).toLowerCase()),
      )
      .slice(0, 6)
      : [];
    if (configFiles.length) {
      const configProjectFiles = await readSelectedProjectFiles(configFiles);
      projectFiles = [...projectFiles, ...configProjectFiles];
      loopSteps.push({
        step: "dependency graph",
        status: "done",
        detail: `Read project config/dependency files: ${configProjectFiles.map((file) => baseName(file.file)).join(", ")}.`,
      });
    } else {
      loopSteps.push({
        step: "dependency graph",
        status: "skipped",
        detail: "No package/config files were found in the project file list.",
      });
    }

    const relatedFiles = hasProjectFileList
      ? findRelatedImportedFiles(projectFiles, projectFileList)
      .filter(
        (file) =>
          ![...selectedFiles, ...configFiles].some(
            (selected) => normalizePath(selected).toLowerCase() === normalizePath(file).toLowerCase(),
          ),
      )
      .slice(0, 6)
      : [];

    if (relatedFiles.length) {
      const relatedProjectFiles = await readSelectedProjectFiles(relatedFiles);
      projectFiles = [...projectFiles, ...relatedProjectFiles];
      loopSteps.push({
        step: "automatic file reading",
        status: "done",
        detail: `Followed local imports and read ${relatedProjectFiles.length} related file(s).`,
      });
    } else {
      loopSteps.push({
        step: "automatic file reading",
        status: "skipped",
        detail: "No extra local imports were needed for this request.",
      });
    }

    const projectSummary = summarizeProjectFiles(projectFiles);
    const uploadedSummary = summarizeUploadedFiles(uploadedFiles);
    const packageInfo = hasProjectFileList ? await readPackageInfo() : null;
    const structuralSummary =
      structuralScan?.ok && structuralScan.issues?.length
        ? structuralScan.issues
            .filter((issue) => issue.severity !== "info")
            .slice(0, 30)
            .map(
              (issue) =>
                `${issue.severity.toUpperCase()} ${normalizePath(issue.file)}${issue.line ? `:${issue.line}` : ""} - ${issue.message}${issue.code ? `\n  ${issue.code}` : ""}`,
            )
            .join("\n")
        : structuralScan?.ok
          ? diagnosticIssues.length
            ? `Structural scan checked ${rawStructuralScan?.scannedFiles || 0} source file(s). Compiler diagnostics narrowed focus to ${diagnosticIssues.length} issue(s).`
            : `Structural scan checked ${structuralScan.scannedFiles || 0} source file(s) and found no obvious delimiter/tag issues.`
          : structuralScan?.error
            ? `Structural scan failed: ${structuralScan.error}`
            : "Structural scan did not run.";
    const diagnosticSummary = projectDiagnostics?.commands?.length
      ? projectDiagnostics.commands
          .map((command) => `${command.ok ? "PASS" : "FAIL"} ${command.command}\n${command.output || ""}`)
          .join("\n\n")
      : projectDiagnostics?.skipped
        ? Array.isArray(projectDiagnostics.skipped)
          ? projectDiagnostics.skipped.join("\n")
          : "Diagnostics skipped."
        : "No diagnostics were available.";
    const auditModeInstructions = shouldRunBehaviorAudit
      ? `BEHAVIORAL WEBSITE BUG AUDIT MODE:
- This request is asking for overlooked bugs/glitches in the website/project.
- Do not repeat a structural delimiter/bracket scan unless PROJECT DIAGNOSTICS proves a compile/syntax error.
- Inspect actual app behavior risks: state persistence, localStorage/sessionStorage restore, useEffect dependencies, stale closures, async loading states, fetch error handling, modal/composer layout, disabled button conditions, status/toast lifetime, and user workflow regressions.
- Report only proven risks grounded in inspected source lines. If a risk is only possible, label it "risk", not "root cause".
- If you cannot prove a bug from inspected files, say that clearly and explain what was inspected.
- If this is a deeper investigation follow-up, explicitly say what new areas were checked compared with the previous shallow scan.`
      : "STANDARD AGENT MODE.";

    const response = await openai.responses.create({
      model: AGENT_REASONING_MODEL,
      max_output_tokens: 3200,
      text: {
        format: {
          type: "json_schema",
          name: "payfix_agent_result",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              answer: { type: "string" },
              inspectedFiles: {
                type: "array",
                items: { type: "string" },
              },
              findings: {
                type: "array",
                items: { type: "string" },
              },
              rootCause: {
                type: "object",
                additionalProperties: false,
                properties: {
                  status: { type: "string", enum: ["found", "not_found", "not_applicable"] },
                  title: { type: "string" },
                  confidence: { type: "number" },
                  why: { type: "string" },
                  evidence: { type: "array", items: { type: "string" } },
                  exactReferences: { type: "array", items: { type: "string" } },
                },
                required: ["status", "title", "confidence", "why", "evidence", "exactReferences"],
              },
              investigation: {
                type: "object",
                additionalProperties: false,
                properties: {
                  filesScanned: { type: "array", items: { type: "string" } },
                  filesIgnored: { type: "array", items: { type: "string" } },
                  searchTermsUsed: { type: "array", items: { type: "string" } },
                  selectionReason: { type: "string" },
                },
                required: ["filesScanned", "filesIgnored", "searchTermsUsed", "selectionReason"],
              },
              patch: {
                type: "object",
                additionalProperties: false,
                properties: {
                  mode: { type: "string", enum: ["replace", "insert", "none"] },
                  file: { type: "string" },
                  search: { type: "string" },
                  replacement: { type: "string" },
                  language: { type: "string" },
                  explanation: { type: "string" },
                },
                required: ["mode", "file", "search", "replacement", "language", "explanation"],
              },
              patchConfidence: {
                type: "object",
                additionalProperties: false,
                properties: {
                  confidence: { type: "number" },
                  risk: { type: "string", enum: ["low", "medium", "high"] },
                  filesAffected: { type: "number" },
                  reason: { type: "string" },
                },
                required: ["confidence", "risk", "filesAffected", "reason"],
              },
              dependencyProposal: {
                type: "object",
                additionalProperties: false,
                properties: {
                  needed: { type: "boolean" },
                  packageName: { type: "string" },
                  devDependency: { type: "boolean" },
                  reason: { type: "string" },
                },
                required: ["needed", "packageName", "devDependency", "reason"],
              },
              validationPlan: {
                type: "array",
                items: { type: "string" },
              },
              confidence: { type: "number" },
            },
            required: [
              "answer",
              "inspectedFiles",
              "findings",
              "rootCause",
              "investigation",
              "patch",
              "patchConfidence",
              "dependencyProposal",
              "validationPlan",
              "confidence",
            ],
          },
          strict: true,
        },
      },
      input: [
        {
          role: "system",
          content: `You are PayFix Agent, a cautious coding agent for payment gateway projects.

Workflow:
1. Use only inspected file content, uploaded files, logs, and computer search.
2. Resolve vague references from RECENT CONVERSATION when the latest request says things like "do it", "fix it", "complete it", "that file", or "the script".
3. Decide whether a code patch is actually needed.
4. If a patch is needed, return one exact patch.

Trust rules:
- rootCause.status must be "found" only when exact inspected file content proves it.
- rootCause.evidence must quote or summarize exact inspected lines, STRUCTURAL SCAN output, validation output, uploaded logs, or screenshot evidence.
- rootCause.exactReferences must use "FullPath:line" or "relative/path:line" when source code evidence exists.
- If STRUCTURAL SCAN did not run, do not invent syntax/bracket errors.
- If STRUCTURAL SCAN lists errors but PROJECT DIAGNOSTICS has no matching compiler/build issue, treat them as low-confidence scanner signals, not proven source bugs.
- If PROJECT DIAGNOSTICS has compiler/build errors, treat those as stronger evidence than structural scan output. Do not ask the user to paste files already loaded in PROJECT FILES or listed in PROJECT DIAGNOSTICS.
- For missing delimiter reports, name the exact missing token and the exact line from STRUCTURAL SCAN or PROJECT FILES.
- If the request is a feature request rather than a bug, use rootCause.status="not_applicable".
- investigation.filesScanned must list inspected project files.
- investigation.filesIgnored should list obvious nearby/project files you did not inspect when they appeared unnecessary, or an empty array if unknown.
- investigation.searchTermsUsed should list the terms you used mentally to select files.
- patchConfidence must explain why the patch is safe or risky. Low risk requires exact replace text from inspected file content.
- Never inflate confidence. Use <=0.70 if exact source evidence is weak.

Image reasoning rules:
- Preserve the actual uploaded filename and MIME type from UPLOADED FILES.
- When multiple images are uploaded, refer to them by REFERENCE LABEL, for example "Image 1: checkout.png". The uploaded image parts are provided in the same order as UPLOADED FILES.
- If an uploaded image is a screenshot of the app/chat, describe it as a screenshot first and read the UI/text inside it as screenshot content.
- Do not say the uploaded image is SVG/PDF/etc. unless UPLOADED FILES says that is its actual MIME type or extension.
- If text inside a screenshot mentions another filename, for example "file.svg", treat that as text shown inside the screenshot, not as the uploaded file name.
- If the user asks "what is this image?", answer what the whole screenshot shows, not only the smallest icon inside it.

Patch rules:
- The agent never writes files directly. It only prepares a preview. In answer/findings/explanation, say "prepared", "would add", "would update", or "previewed"; never say "I added", "I changed", "I replaced", or imply the code was already written.
- For feature/add/update requests, do not say "FOUND THE ISSUE" or "WHY THIS FIXES IT". Use "REQUESTED CHANGE", "WHAT THIS CHANGES", or "IMPLEMENTATION NOTES".
- When you mention a file-specific fact, include a clickable source reference like "Composer.tsx:482" if that line exists in PROJECT FILES.
- Use mode "replace" for automatic patches.
- For replace, "search" MUST be an exact substring copied from PROJECT FILES.
- "replacement" must be the complete replacement for that exact substring.
- Use mode "insert" only when the requested fix is clearly to add/append missing code, complete a cut-off file at the end, or add a new snippet without deleting existing content.
- For insert, leave "search" empty and set "replacement" to only the code that should be appended/inserted, not the whole file.
- Prefer replace when exact existing code can be safely replaced. Prefer insert when the file is cut off at EOF and the safest fix is to append the missing closing code.
- If the user says a file is cut off/truncated or asks to complete script.js, use mode "insert" unless the exact incomplete tail is present and can be replaced safely.
- Use mode "none" if the needed file/content is missing or the requested change is not safe.
- Do not invent files, props, APIs, functions, or selectors.
- Inspect imported local types/helpers before using object fields or component props.
- For React code, do not add hooks inside loops, conditionals, callbacks, render maps, or nested functions. Hooks must be at the top level of a component or custom hook.
- Do not add fake markdown links, placeholder URLs, or fields that do not exist in inspected types.
- Do not claim validation passed; only provide a validation plan.
- If confidence would be below 0.72, return mode "none".
- confidence must be between 0 and 1.

Dependency rules:
- Only propose a dependency if inspected files or validation errors prove a package/module is missing.
- Do not propose installing packages for stylistic preferences.
- dependencyProposal.packageName must be a real npm package name such as "stripe", "@stripe/stripe-js", "axios", "zod", or "@types/node".
- Use dependencyProposal.needed=false if a code patch is enough or evidence is weak.
- Never claim a dependency was installed. Only propose it.

${auditModeInstructions}`,
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `USER REQUEST:
${question}

RECENT CONVERSATION:
${history || "No recent conversation."}

COMPRESSED PROJECT MEMORY:
${memory || "No compressed memory."}

PAYMENT LOG:
${log || "No log."}

PASTED RELATED CODE:
${code || "No pasted code."}

COMPUTER SEARCH:
${computerSearchResults || "No computer search."}

FILE SELECTION RATIONALE:
${selection.rationale}

PROJECT FILES:
${projectSummary || "No project files were read."}

PROJECT DIAGNOSTICS:
${diagnosticSummary}

            AGENT MODE:
${hasProjectFileList ? "Project-connected engineering mode. File inspection, patch preview, validation, and dependency proposals are allowed." : "Evidence-only investigation mode. No project files are connected, so do not propose file patches, dependency installs, or project validation. Analyze uploads/logs/screenshots/TLV/code text only."}

STRUCTURAL SCAN:
${structuralSummary}

UPLOADED FILES:
${uploadedSummary || "No uploaded files."}`,
            },
            ...imageParts(uploadedFiles),
          ],
        },
      ],
    });

    const emptyPatch: AgentPatch = {
      mode: "none",
      file: "",
      search: "",
      replacement: "",
      language: "text",
      explanation: "No verified patch was produced.",
    };
    let result = safeJsonParse<AgentResult>(response.output_text || "", {
      answer: "The agent could not return a structured result.",
      inspectedFiles: projectFiles.map((file) => file.file),
      findings: [],
      rootCause: {
        status: "not_found",
        title: "No structured root cause returned",
        confidence: 0,
        why: "The model response did not satisfy the required agent schema.",
        evidence: [],
        exactReferences: [],
      },
      investigation: {
        filesScanned: projectFiles.map((file) => normalizePath(file.file)),
        filesIgnored: [],
        searchTermsUsed: tokenizeForEvidence(question).slice(0, 10),
        selectionReason: selection.rationale || "The file-selection step completed, but reasoning did not return a valid schema.",
      },
      patch: emptyPatch,
      patchConfidence: {
        confidence: 0,
        risk: "high",
        filesAffected: 0,
        reason: "No verified patch was produced.",
      },
      dependencyProposal: {
        needed: false,
        packageName: "",
        devDependency: false,
        reason: "No dependency proposal was produced.",
      },
      validationPlan: [],
      confidence: 0,
    });

    const evidenceTextForFallback = [
      question,
      log,
      code,
      computerSearchResults,
      uploadedFiles.filter((file) => !file.isImage).map((file) => file.content || "").join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!hasProjectFileList && result.patch.mode !== "none") {
      result.patch = {
        mode: "none",
        file: "",
        search: "",
        replacement: "",
        language: "text",
        explanation: "Evidence-only mode cannot prepare file patches without a connected project.",
      };
      result.patchConfidence = {
        confidence: 0,
        risk: "high",
        filesAffected: 0,
        reason: "No connected project file list was available for safe patching.",
      };
    }

    const deterministicProjectHealthResult =
      shouldRunProjectHealthScan && structuralScan?.issues?.some((issue) => issue.severity !== "info")
        ? buildStructuralScanFallback(structuralScan, projectFiles)
        : shouldRunProjectHealthScan
          ? buildProjectHealthFallback({ projectFiles, projectDiagnostics, structuralScan })
          : null;

    if (
      deterministicProjectHealthResult &&
      (result.confidence < 0.85 ||
        result.rootCause.status !== "found" ||
        /could not return a structured result|need more information|paste the exact/i.test(result.answer))
    ) {
      result = deterministicProjectHealthResult;
      loopSteps.push({
        step: "evidence-first override",
        status: "done",
        detail: "Used deterministic diagnostics/structural scan evidence instead of a weak model answer.",
      });
    }

    if (result.patch.mode === "none") {
      const evidenceOnlyReview =
        !hasProjectFileList &&
        hasEvidenceOnlyText({ log, code, computerSearchResults, uploadedFiles }) &&
        !looksLikeEmvTlv(evidenceTextForFallback) &&
        (result.confidence < 0.72 ||
          result.rootCause.status !== "found" ||
          /need .*code|paste .*code|not enough information|no project files/i.test(result.answer))
          ? await reviewEvidenceOnlyContext({ question, log, code, computerSearchResults, uploadedFiles })
          : null;
      const fallbackResult =
        evidenceOnlyReview ||
        (!hasProjectFileList && (result.confidence < 0.6 || looksLikeEmvTlv(evidenceTextForFallback))
          ? evidenceOnlyFallback({ question, log, code, computerSearchResults, uploadedFiles })
          : null) ||
        (shouldRunBehaviorAudit ? buildBehaviorAuditFallback({ projectFiles, projectDiagnostics }) : null) ||
        (!shouldRunBehaviorAudit && structuralScan?.issues?.some((issue) => issue.severity !== "info")
          ? buildStructuralScanFallback(structuralScan, projectFiles)
          : null) ||
        (result.confidence === 0 && shouldRunProjectHealthScan && !shouldRunBehaviorAudit
          ? buildProjectHealthFallback({ projectFiles, projectDiagnostics, structuralScan })
          : null) ||
        buildSignupFormFilesFallback(question, history) ||
        (result.confidence === 0 ? buildSimpleHtmlAddFallback({ question, projectFiles }) : null);
      if (fallbackResult) {
        result = fallbackResult;
        loopSteps.push({
          step: "structured fallback",
          status: "done",
          detail: "Recovered with a deterministic safe file preview.",
        });
      }
    }

    const trustDefaults = defaultTrustFields({ question, selection, projectFiles, result });
    result.rootCause = result.rootCause || trustDefaults.rootCause;
    result.investigation = result.investigation || trustDefaults.investigation;
    result.patchConfidence = result.patchConfidence || trustDefaults.patchConfidence;
    result.investigation.filesScanned = result.investigation.filesScanned.length
      ? result.investigation.filesScanned.map(normalizePath)
      : projectFiles.map((file) => normalizePath(file.file));
    result.investigation.selectionReason = result.investigation.selectionReason || selection.rationale;
    result.rootCause.exactReferences = result.rootCause.exactReferences || [];
    result.rootCause.evidence = result.rootCause.evidence || [];

    result.inspectedFiles = projectFiles.map((file) => normalizePath(file.file));
    result.dependencyProposal = result.dependencyProposal || {
      needed: false,
      packageName: "",
      devDependency: false,
      reason: "No dependency proposal was produced.",
    };
    result.patch = repairCompletionPatch(result.patch, projectFiles, question, history);
    const preflightGroundingEvidence = buildGroundingEvidence({ question, result, projectFiles });
    const patchTargetsExistingFile = projectFiles.some(
      (file) => normalizePath(file.file).toLowerCase() === normalizePath(result.patch.file).toLowerCase(),
    );
    const patchCreatesNewRelativeFile =
      result.patch.mode === "insert" && !pathLooksAbsolute(result.patch.file) && /\.[a-z0-9]{1,8}$/i.test(result.patch.file);
    const shouldAttachGenericReferences = !(shouldRunBehaviorAudit && result.rootCause.status === "not_found");
    if (shouldAttachGenericReferences && !result.rootCause.exactReferences.length && preflightGroundingEvidence.length) {
      result.rootCause.exactReferences = preflightGroundingEvidence
        .slice(0, 4)
        .map((item) => `${normalizePath(item.file)}:${item.line}`);
    }
    if (shouldAttachGenericReferences && !result.rootCause.evidence.length && preflightGroundingEvidence.length) {
      result.rootCause.evidence = preflightGroundingEvidence
        .slice(0, 4)
        .map((item) => `${normalizePath(item.file)}:${item.line} ${item.text || item.reason}`);
    }
    loopSteps.push({
      step: "reason",
      status: "done",
      detail: `Produced structured findings with ${Math.round((Number(result.confidence) || 0) * 100)}% confidence.`,
    });

    let patchWarning = "";
    let preview: PreviewResult | null = null;
    let projectValidation: ValidationResult | null = null;
    const confidence = Number.isFinite(result.confidence) ? result.confidence : 0;
    const verification =
      confidence < 0.72
        ? { ok: false, reason: "Agent confidence was too low for automatic Apply." }
        : result.patch.mode !== "none" && patchTargetsExistingFile && !patchCreatesNewRelativeFile && !preflightGroundingEvidence.length
          ? { ok: false, reason: "Agent did not produce exact source-line evidence for the target file." }
        : verifyPatchAgainstFiles(result.patch, projectFiles);

    if (!verification.ok) {
      patchWarning = verification.reason;
      result.patch = {
        ...emptyPatch,
        explanation: patchWarning,
      };
      loopSteps.push({
        step: "patch",
        status: "blocked",
        detail: patchWarning,
      });
    } else {
      preview = await previewPatch(result.patch);

      if (!preview?.ok) {
        patchWarning = preview?.error || "Patch preview failed.";
        result.patch = {
          ...emptyPatch,
          explanation: patchWarning,
        };
        preview = null;
        loopSteps.push({
          step: "patch",
          status: "blocked",
          detail: patchWarning,
        });
      } else {
        loopSteps.push({
          step: "patch",
          status: "done",
          detail: "Generated a safe preview without writing to disk.",
        });
        projectValidation = await validatePatch(result.patch);

        if (!projectValidation?.ok) {
          loopSteps.push({
            step: "validate",
            status: "blocked",
            detail: projectValidation?.error || "Initial project validation failed.",
          });

          const repairedPatch = projectValidation
            ? await repairPatchAfterValidation({
                question,
                projectSummary,
                failedPatch: result.patch,
                validation: projectValidation,
              })
            : {
                mode: "none" as const,
                file: "",
                search: "",
                replacement: "",
                language: "text",
                explanation: "Project validation did not return a result.",
              };
          const repairedVerification = verifyPatchAgainstFiles(repairedPatch, projectFiles);
          if (repairedVerification.ok) {
            const repairedPreview = await previewPatch(repairedPatch);
            const repairedValidation = repairedPreview?.ok ? await validatePatch(repairedPatch) : null;
            if (repairedPreview?.ok && repairedValidation?.ok) {
              result.patch = repairedPatch;
              preview = repairedPreview;
              projectValidation = repairedValidation;
              result.patchConfidence = {
                confidence: Math.min(result.patchConfidence.confidence || 0.72, 0.82),
                risk: "medium",
                filesAffected: 1,
                reason: "The first patch failed validation. PayFix repaired it once and the repaired preview passed validation.",
              };
              loopSteps.push({
                step: "retry",
                status: "done",
                detail: "Repaired the patch after validation failure and re-ran validation successfully.",
              });
            } else {
              patchWarning = repairedValidation?.error || repairedPreview?.error || "Repaired patch did not pass validation.";
              result.patch = {
                ...emptyPatch,
                explanation: patchWarning,
              };
              preview = null;
              loopSteps.push({
                step: "retry",
                status: "blocked",
                detail: patchWarning,
              });
            }
          } else {
            patchWarning = repairedVerification.reason || projectValidation?.error || "Project validation failed.";
            result.patch = {
              ...emptyPatch,
              explanation: patchWarning,
            };
            preview = null;
            loopSteps.push({
              step: "retry",
              status: "blocked",
              detail: patchWarning,
            });
          }
        } else {
          loopSteps.push({
            step: "validate",
            status: projectValidation.skipped ? "skipped" : "done",
            detail: projectValidation.skipped
              ? "No package.json was found, so command validation was skipped."
              : "Temporarily applied patch, ran project validation, then restored the file.",
          });
        }
      }
    }

    const inferredDependency =
      inferDependencyProposalFromValidation(projectValidation) ||
      inferDependencyProposalFromValidation(projectDiagnostics) ||
      inferDependencyProposalFromImports(projectFiles, packageInfo);
    if (!result.dependencyProposal.needed && inferredDependency) {
      result.dependencyProposal = inferredDependency;
    }
    loopSteps.push({
      step: "dependency proposal",
      status: result.dependencyProposal.needed ? "done" : "skipped",
      detail: result.dependencyProposal.needed
        ? `${result.dependencyProposal.packageName}: ${result.dependencyProposal.reason}`
        : "No missing dependency was proven from imports or validation output.",
    });

    result.answer = normalizeAnswerTone(result.answer, question);
    result.findings = result.findings.map((finding) => normalizeAnswerTone(finding, question));
    result.patch.explanation = normalizeAnswerTone(result.patch.explanation, question);
    const groundingEvidence = buildGroundingEvidence({ question, result, projectFiles });

    const markdown = toMarkdown(
      result,
      selection,
      loopSteps,
      Boolean(preview?.ok),
      patchWarning,
      projectValidation,
      projectDiagnostics,
      groundingEvidence,
    );

    return Response.json({
      ok: true,
      result,
      markdown,
      preview,
      patchSet: result.patchSet || [],
      projectValidation,
      dependencyProposal: result.dependencyProposal,
      selectedFiles,
      relatedFiles,
      configFiles,
      loopSteps,
      groundingEvidence,
      filesRead: projectFiles.map((file) => ({
        file: normalizePath(file.file),
        name: baseName(file.file),
        kind: file.kind || "unknown",
        size: file.size || 0,
      })),
      patchReady: Boolean(preview?.ok && result.patch.mode !== "none"),
      warning: patchWarning,
    });
  } catch (error: unknown) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Agent run failed.",
      },
      { status: 500 },
    );
  }
}
