import OpenAI, { toFile } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function extractXMagstripe(text: string) {
  const match = text.match(/"xMagstripe"\s*:\s*"([^"]+)"/i);
  return match?.[1] || "";
}

function hexToAscii(hex: string) {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, "");
  let out = "";

  for (let i = 0; i < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code >= 32 && code <= 126) out += String.fromCharCode(code);
  }

  return out;
}

function detectCardBrand(text: string) {
  if (/A000000004/i.test(text)) return "Mastercard";
  if (/A000000003/i.test(text)) return "Visa";
  if (/A000000025/i.test(text)) return "American Express";
  if (/A000000065/i.test(text)) return "JCB";
  if (/A000000152/i.test(text)) return "Discover";
  return "Unknown";
}

function detectEntryMode(text: string) {
  const match = text.match(/9F3901([0-9A-Fa-f]{2})/);
  const value = match?.[1]?.toUpperCase();

  if (!value) return "Unknown";

  const modes: Record<string, string> = {
    "05": "Chip insert / contact EMV",
    "07": "Contactless EMV / tap",
    "80": "Fallback swipe",
    "90": "Magstripe swipe",
  };

  return modes[value] || `Unknown entry mode: ${value}`;
}

function likelyNeedsWeb(question: string) {
  return /url|link|website|docs|documentation|guide|template|sample|download|where can i find|current|latest|official|api|sdk/i.test(
    question
  );
}

function isRequestedChange(question: string) {
  return /\b(add|append|build|change|create|design|generate|include|insert|make|modify|new|refactor|replace|style|update)\b/i.test(
    question
  );
}

function isProblemReport(question: string) {
  const normalized = question.replace(/\bnot\s+(an?\s+)?issue\b/gi, "");

  return /\b(broken|bug|crash|declin(?:e|ed|ing)|does\s+not\s+work|doesn't\s+work|error|exception|fail(?:ed|ing|s)?|fix|hidden|incorrect|invalid|issue|messed\s+up|not\s+working|problem|stuck|timeout|wrong)\b/i.test(
    normalized
  );
}

function normalizeChangeRequestResponse(text: string, question: string) {
  if (!isRequestedChange(question) || isProblemReport(question)) return text;

  return text
    .replace(/^FOUND THE ISSUE:/i, "REQUESTED CHANGE:")
    .replace(/\nFOUND THE ISSUE:/gi, "\nREQUESTED CHANGE:")
    .replace(/\bWHY THIS FIXES IT:/gi, "WHAT THIS CHANGES:");
}

function fileNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).pop() || "project-file";
}

function normalizeFilePath(filePath: string) {
  return String(filePath || "").replace(/\//g, "\\");
}

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

type UploadedFilePayload = {
  name: string;
  type: string;
  size?: number;
  content?: string;
  isImage?: boolean;
};

type HistoryMessage = {
  role?: string;
  content?: string;
  attachedUploads?: UploadedFilePayload[];
};

type FileSelectionResult = {
  selectedFiles: string[];
  rationale: string;
};

async function transcribeProjectAudio(projectFiles: ProjectFilePayload[]) {
  const audioFiles = projectFiles.filter(
    (file) => file.kind === "audio" && file.base64
  );

  const transcriptions = await Promise.all(
    audioFiles.slice(0, 5).map(async (file) => {
      try {
        const uploadable = await toFile(
          Buffer.from(file.base64 || "", "base64"),
          fileNameFromPath(file.file),
          {
            type: file.mime || "audio/mpeg",
          }
        );

        const transcription = await openai.audio.transcriptions.create({
          file: uploadable,
          model: "gpt-4o-mini-transcribe",
        });

        return `AUDIO FILE: ${file.file}
MIME: ${file.mime || "unknown"}
SIZE: ${file.size || 0} bytes
TRANSCRIPTION:
${transcription.text || "[No speech transcribed.]"}`;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Audio transcription failed.";

        return `AUDIO FILE: ${file.file}
MIME: ${file.mime || "unknown"}
SIZE: ${file.size || 0} bytes
TRANSCRIPTION ERROR:
${message}`;
      }
    })
  );

  return transcriptions.join("\n\n");
}

function summarizeProjectFiles(projectFiles: ProjectFilePayload[]) {
  return projectFiles
    .map((file) => {
      const normalizedPath = normalizeFilePath(file.file);

      if (file.kind === "text") {
        return `PROJECT TEXT FILE:
FILE: ${normalizedPath}
MIME: ${file.mime || "text/plain"}
SIZE: ${file.size || 0} bytes
CONTENT:
${String(file.content || "").slice(0, 50000)}`;
      }

      return `PROJECT ${String(file.kind || "binary").toUpperCase()} FILE:
FILE: ${normalizedPath}
MIME: ${file.mime || "unknown"}
SIZE: ${file.size || 0} bytes
ENCODING: ${file.encoding || "none"}
${file.note ? `NOTE: ${file.note}` : ""}`;
    })
    .join("\n\n");
}

function summarizeUploadedText(uploadedFiles: UploadedFilePayload[]) {
  return uploadedFiles
    .filter((f) => !f.isImage)
    .map(
      (f) =>
        `UPLOADED FILE:
FILE: ${f.name}
TYPE: ${f.type}
CONTENT:
${String(f.content || "").slice(0, 50000)}`
    )
    .join("\n\n");
}

function summarizeUploadedImages(uploadedFiles: UploadedFilePayload[]) {
  return uploadedFiles
    .filter((f) => f.isImage)
    .map(
      (f, index) =>
        `UPLOADED IMAGE ${index + 1}:
REFERENCE LABEL: Image ${index + 1}: ${f.name}
ACTUAL FILE NAME: ${f.name}
ACTUAL MIME TYPE: ${f.type || "unknown"}
SIZE: ${f.size || 0} bytes
ORDER: This is image part ${index + 1} in the current request.
IMPORTANT: This metadata describes the uploaded file. Text visible inside the screenshot may mention other filenames or formats; do not confuse screenshot text with the uploaded file format.`
    )
    .join("\n\n");
}

function summarizeHistoryAttachments(message: HistoryMessage) {
  const uploads = Array.isArray(message.attachedUploads)
    ? message.attachedUploads
    : [];

  if (uploads.length === 0) {
    return "";
  }

  const summary = uploads
    .map((file, index) => {
      const label = file.isImage
        ? `Image ${index + 1}: ${file.name}`
        : `File ${index + 1}: ${file.name}`;

      return `- ${label} (${file.type || "unknown"}, ${file.size || 0} bytes)`;
    })
    .join("\n");

  return `\n\nATTACHMENTS SENT WITH THIS MESSAGE:\n${summary}`;
}

function buildImageParts(uploadedFiles: UploadedFilePayload[], projectFiles: ProjectFilePayload[]) {
  const uploadedImageParts = uploadedFiles
    .filter((f) => f.isImage && f.content)
    .slice(0, 10)
    .map((f) => ({
      type: "input_image" as const,
      image_url: f.content || "",
      detail: "high" as const,
    }));

  const projectImageParts = projectFiles
    .filter((f) => f.kind === "image" && f.base64 && f.mime)
    .slice(0, 10)
    .map((f) => ({
      type: "input_image" as const,
      image_url: `data:${f.mime};base64,${f.base64}`,
      detail: "high" as const,
    }));

  return [...uploadedImageParts, ...projectImageParts];
}

async function selectProjectFilesForInspection({
  question,
  log,
  code,
  projectFileList,
}: {
  question: string;
  log: string;
  code: string;
  projectFileList: string;
}) {
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    max_output_tokens: 700,
    text: {
      format: {
        type: "json_schema",
        name: "payfix_file_selection",
        description: "Select the smallest set of local project files needed to answer or patch a payment/debugging question.",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            selectedFiles: {
              type: "array",
              maxItems: 5,
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
        content: `You are the file selection step in PayFix AI's local coding agent.

Select ONLY files from PROJECT FILE LIST that are likely needed to answer the user's request or create an exact patch.

Rules:
- Return absolute file paths exactly as shown in PROJECT FILE LIST.
- Prefer source/config/template files over generated assets.
- Choose the smallest useful set, usually 1-4 files.
- If the user asks about UI behavior, include the component/page/CSS files likely responsible.
- If the user asks about payment gateway behavior, include route/controller/service/config/webhook files likely responsible.
- Do not select files that are not present in PROJECT FILE LIST.`,
      },
      {
        role: "user",
        content: `USER REQUEST:
${question}

PAYMENT LOG:
${log || "No log provided."}

VISIBLE CONTEXT:
${code.slice(0, 16000) || "No existing context."}

PROJECT FILE LIST:
${projectFileList.slice(0, 25000)}`,
      },
    ],
  });

  return JSON.parse(response.output_text || "{}") as FileSelectionResult;
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

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const question = String(body.question || "");
    const log = String(body.log || "");
    const code = String(body.code || "");
    const history: HistoryMessage[] = Array.isArray(body.history) ? body.history : [];
    const uploadedFiles: UploadedFilePayload[] = Array.isArray(body.uploadedFiles)
      ? body.uploadedFiles
      : [];
    let projectFiles: ProjectFilePayload[] = Array.isArray(body.projectFiles)
      ? body.projectFiles
      : [];
    const projectFileList = String(body.projectFileList || "");
    const agenticProject = Boolean(body.agenticProject);
    let agentFileSelection: FileSelectionResult | null = null;
    let agentReadWarning = "";

    if (agenticProject && projectFileList) {
      try {
        agentFileSelection = await selectProjectFilesForInspection({
          question,
          log,
          code,
          projectFileList,
        });
        projectFiles = await readSelectedProjectFiles((agentFileSelection.selectedFiles || []).slice(0, 5));
      } catch (error: unknown) {
        agentReadWarning = error instanceof Error ? error.message : "Agent file selection/read failed.";
      }
    }

    const xMagstripe = extractXMagstripe(log);
    const combined = `${question}\n\n${log}\n\n${code}\n\n${xMagstripe}`;

    const uploadedText = summarizeUploadedText(uploadedFiles);
    const uploadedImageSummary = summarizeUploadedImages(uploadedFiles);
    const projectAudioTranscripts = await transcribeProjectAudio(projectFiles);
    const projectFileSummary = summarizeProjectFiles(projectFiles);
    const imageParts = buildImageParts(uploadedFiles, projectFiles);

    const projectTextFiles = projectFiles.filter((file) => file.kind === "text");
    const projectFileNames = projectFiles.map((file) => normalizeFilePath(file.file));

    const needsWebSearch = likelyNeedsWeb(question);
    const toolResults = {
      cardBrand: detectCardBrand(combined),
      entryMode: detectEntryMode(combined),
      asciiDecoded: hexToAscii(xMagstripe || combined).slice(0, 1500),
      hasXMagstripe: Boolean(xMagstripe),
      uploadedFileCount: uploadedFiles.length,
      projectFileCount: projectFiles.length,
      projectTextFileCount: projectTextFiles.length,
      projectAudioFileCount: projectFiles.filter((file) => file.kind === "audio")
        .length,
      projectImageFileCount: projectFiles.filter((file) => file.kind === "image")
        .length,
      projectFilesLoaded: projectFileNames,
      agenticProject,
      agentSelectedFiles: agentFileSelection?.selectedFiles || [],
      agentSelectionRationale: agentFileSelection?.rationale || "",
      agentReadWarning,
      webSearchRecommended: needsWebSearch,
    };

    const systemText = `
You are PayFix AI, a senior debugging assistant for payment integrations, EMV devices, gateway errors, logs, codebases, screenshots, and technical documentation.

GENERAL BEHAVIOR:
- Be concise, technical, and direct.
- Answer the user's exact question first.
- If the answer is yes/no, start with yes/no.
- Do not guess when data is missing.

WEB / DOCUMENTATION RULES:
- Use web search only when the user requests documentation, SDKs, APIs, downloads, official links, current website instructions, or vendor resources.
- Only use verified URLs from search results.
- Never fabricate links.
- Never reconstruct URLs from memory.
- If no valid official URL is found, respond: "I could not verify an official URL."
- URL format must be markdown only:
  [Page Title](https://example.com)

LOCAL PROJECT RULES:
- Always prioritize provided local context, uploaded files, logs, screenshots, and structured project files.
- For uploaded images, preserve the actual uploaded filename and MIME type from UPLOADED IMAGE METADATA.
- When multiple images are uploaded, refer to them by their REFERENCE LABEL, for example "Image 1: checkout.png". The uploaded image parts are provided in the same order as UPLOADED IMAGE METADATA.
- If an uploaded image is a screenshot of the app/chat, describe it as a screenshot first and read the UI/text inside it as screenshot content.
- Do not say the uploaded image is SVG/PDF/etc. unless the uploaded image metadata says that is its MIME type or file extension.
- If text inside a screenshot mentions another filename, for example "file.svg", treat that as text shown inside the screenshot, not as the uploaded file name.
- If STRUCTURED PROJECT FILES includes file content, you MUST inspect that content directly.
- Never say "provide the file" when file content appears in STRUCTURED PROJECT FILES.
- In agentic project mode, you are seeing only files selected by the file-selection step and read by the backend. Do not refer to unselected file contents.
- Do not claim you looked at a file unless that exact file path appears in STRUCTURED PROJECT FILES.
- Do not invent components, props, methods, variables, CSS classes, selectors, configs, APIs, or file names.
- Only mention code that exists in the provided file content.
- If no structured project file content was loaded, do not produce FILE / REPLACE THIS / WITH THIS patch blocks.
- If the user asks for a code or styling fix but project files are missing, say you need the project connected or the exact file loaded before producing an applyable patch.
- Do not use placeholder paths like "your component file", "main chat container", "App.css", or prose descriptions as FILE values.
- If the exact needed file is missing, say exactly which file is missing.
- Reference exact file paths and exact existing code when possible.

CODE FIX RULES:
- Never give generic layout/programming advice when project files are provided.
- When the user asks what is wrong in code, inspect actual loaded file content and identify the exact code causing it.
- When the user reports a bug/error/failure, use "FOUND THE ISSUE".
- When the user asks for a feature, UI adjustment, refactor, or requested update, use "REQUESTED CHANGE" instead.
- If the user asks to add/create/update/change something, that is a requested change even when the current file does not contain it yet.
- Do not describe a missing requested feature as an issue.
- When suggesting code changes, use this exact format:

FOUND THE ISSUE or REQUESTED CHANGE:
<short exact explanation>

FILE:
<full file path>

REPLACE THIS:
\`\`\`tsx
<exact existing code copied from provided file content>
\`\`\`

WITH THIS:
\`\`\`tsx
<replacement code>
\`\`\`

WHAT THIS CHANGES:
<short explanation of the requested change>

- If the replacement language is not TSX, use the correct language tag.
- Do not write "WHY THIS FIXES IT" for feature/add/update requests. Use "WHAT THIS CHANGES".
- Use "WHY THIS FIXES IT" only when the user reported a bug, error, failure, broken layout, or something that needs fixing.
- REPLACE THIS must be exact code that appears in the provided file content.
- WITH THIS must be valid replacement code.
- If you cannot find exact code, say:
  "I could not find the exact code in the loaded project files."

APPLY BUTTON COMPATIBILITY:
- Always include FILE: before code fixes.
- Always provide one primary replacement block first.
- For edits to existing files, prefer REPLACE THIS / WITH THIS using exact copied code from STRUCTURED PROJECT FILES.
- For new insertions where no exact block should be replaced, say INSERT INTO FILE and describe the insertion location in text, then provide the code block. The Apply button will use insert mode.
- If the target file is empty or the request is to add/append new CSS/script/code, do not invent a blank "existing content" block. Use INSERT INTO FILE instead.
- Never use placeholder comments like "/* existing content */" as REPLACE THIS. REPLACE THIS must be real current file text.
- Do not include vague snippets for Apply.
- Do not return comments like "find the container and change it" as the replacement.
- Only provide Apply-compatible blocks when STRUCTURED PROJECT FILES contains the exact target file content.

CODE OUTPUT RULES:
- Always use fenced code blocks with language tags.
- Keep code formatting clean.

TECHNICAL ACCURACY RULES:
- Never hallucinate APIs, SDK methods, configuration fields, or project structure.
- If uncertain, clearly say what is missing.
- Prefer grounded explanations based only on provided context.

RESPONSE STYLE:
- Minimal but precise.
- Avoid generic troubleshooting steps unless the user did not provide enough context.
- Prefer actionable fixes over theory.
`;

    const userText = `
LATEST USER REQUEST:
${question}

PAYMENT LOG:
${log || "No payment log provided."}

RELATED CODE / COMPUTER SEARCH RESULTS / PROJECT CONTEXT:
${code || "No code/search/project context provided."}

AGENT FILE SELECTION:
Mode: ${agenticProject ? "enabled" : "disabled"}
Selected files:
${agentFileSelection?.selectedFiles?.length ? agentFileSelection.selectedFiles.map((file) => `- ${file}`).join("\n") : "No agent-selected files."}
Selection rationale:
${agentFileSelection?.rationale || "No file-selection rationale."}
Read warning:
${agentReadWarning || "None"}

STRUCTURED PROJECT FILES:
${projectFileSummary || "No structured project files provided."}

PROJECT AUDIO TRANSCRIPTIONS:
${projectAudioTranscripts || "No project audio files transcribed."}

UPLOADED TEXT FILES:
${uploadedText || "No uploaded text files."}

UPLOADED IMAGE METADATA:
${uploadedImageSummary || "No uploaded images."}

AUTOMATED TOOL RESULTS:
${JSON.stringify(toolResults, null, 2)}
`;

    const historyInput = history.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: `${String(m.content || "")}${summarizeHistoryAttachments(m)}`,
    }));

    const input = [
      {
        role: "system" as const,
        content: systemText,
      },
      ...historyInput,
      {
        role: "user" as const,
        content: [
          {
            type: "input_text" as const,
            text: userText,
          },
          ...imageParts,
        ],
      },
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      
      max_output_tokens: 2800,
      tools: needsWebSearch
        ? [
            {
              type: "web_search_preview",
            },
          ]
        : [],
      input,
    });

    const finalText = normalizeChangeRequestResponse(response.output_text?.trim() || "No result returned.", question);

    return Response.json({
      result: finalText,
      toolResults,
    });
  } catch (error: unknown) {
    console.error(error);

    return Response.json({
      result: error instanceof Error ? error.message : "Failed to analyze.",
    });
  }
}
