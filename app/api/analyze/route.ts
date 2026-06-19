import OpenAI, { toFile } from "openai";

import { PAYFIX_BEST_ANSWER_STANDARD, PAYFIX_REVISION_STANDARD } from "../lib/answerQuality";
import { payfixResponseConfig } from "../lib/modelRouting";

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
  return /url|link|website|docs|documentation|guide|template|sample|download|where can i find|current|latest|official|api|sdk|developer portal|pax|paxstore|broadpos|poslink|cardpointe|cardconnect|browser policy|chrome|chromium|cors|private network access|\bpna\b|local network access|mixed content|certificate|tls|browser flag|managed policy|devtools/i.test(
    question,
  );
}

function webSearchTools(enabled: boolean) {
  return enabled ? [{ type: "web_search_preview" as const }] : [];
}

type UrlEvidence = {
  url: string;
  finalUrl: string;
  ok: boolean;
  rendered?: boolean;
  status?: number;
  contentType?: string;
  title?: string;
  text?: string;
  links?: { text: string; href: string }[];
  childPages?: UrlEvidence[];
  error?: string;
};

function extractHttpUrls(text: string) {
  const urls = new Set<string>();
  const matches = text.match(/https?:\/\/[^\s<>"')\]}]+/gi) || [];

  for (const match of matches) {
    const cleaned = match.replace(/[.,;:!?`]+$/g, "");
    try {
      const url = new URL(cleaned);
      if (url.protocol === "http:" || url.protocol === "https:") urls.add(url.toString());
    } catch {
      // Ignore malformed URLs; the model can still answer from text/search.
    }
  }

  return [...urls].slice(0, 4);
}

function isBlockedUrlTarget(url: URL) {
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;

  return false;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function absoluteHref(href: string, baseUrl: string) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function extractPageLinks(html: string, baseUrl: string) {
  const links: { text: string; href: string }[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) && links.length < 80) {
    const href = absoluteHref(decodeHtmlEntities(match[1] || "").trim(), baseUrl);
    const text = decodeHtmlEntities((match[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const key = `${text}|${href}`.toLowerCase();
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || seen.has(key)) continue;
    seen.add(key);
    links.push({ text: text || href, href });
  }

  return links;
}

function mergeLinks(left: { text: string; href: string }[] = [], right: { text: string; href: string }[] = []) {
  const seen = new Set<string>();
  return [...left, ...right].filter((link) => {
    const key = `${link.text}|${link.href}`.toLowerCase();
    if (!link.href || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resourceLinkScore(link: { text: string; href: string }, sourceUrl: string) {
  let score = 0;
  const haystack = `${link.text} ${link.href}`.toLowerCase();
  const sourceHost = new URL(sourceUrl).hostname.toLowerCase();

  if (/download|sdk|resource|doc|developer|api|sample|github|aar|jar|apk|zip|pdf|manual|guide|poslink|broadpos|paxstore/i.test(haystack)) score += 8;
  if (/poslink|sdk|download|resource/i.test(link.text)) score += 8;
  if (/\.(zip|pdf|apk|aar|jar|docx?|xlsx?)($|[?#])/i.test(link.href)) score += 12;

  try {
    const linkUrl = new URL(link.href);
    if (linkUrl.hostname.toLowerCase() === sourceHost) score += 4;
  } catch {
    score -= 20;
  }

  return score;
}

function resourceLinksForFollowup(links: { text: string; href: string }[], sourceUrl: string) {
  const sourceHost = new URL(sourceUrl).hostname.toLowerCase();

  return links
    .map((link) => ({ link, score: resourceLinkScore(link, sourceUrl) }))
    .filter(({ link, score }) => {
      if (score < 8) return false;
      try {
        const linkUrl = new URL(link.href);
        if (isBlockedUrlTarget(linkUrl)) return false;
        return linkUrl.hostname.toLowerCase() === sourceHost || score >= 16;
      } catch {
        return false;
      }
    })
    .sort((left, right) => right.score - left.score)
    .map(({ link }) => link)
    .slice(0, 8);
}

async function renderUrlEvidence(url: string): Promise<UrlEvidence | null> {
  let browser: Awaited<ReturnType<(typeof import("playwright"))["chromium"]["launch"]>> | null = null;

  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1200 },
      userAgent: "PayFixAI/1.0 (+https://payfix.local)",
    });
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 18000,
    });

    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch {
      // Some docs portals keep long-lived requests open; DOM content is still useful.
    }

    const data = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
        text: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
        href: (anchor as HTMLAnchorElement).href,
      }));

      return {
        title: document.title || "",
        text: (document.body?.innerText || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
        links: anchors,
      };
    });

    const finalUrl = page.url();
    await context.close();

    return {
      url,
      finalUrl,
      ok: response?.ok() ?? true,
      rendered: true,
      status: response?.status(),
      contentType: response?.headers()["content-type"] || "browser-rendered",
      title: data.title,
      text: data.text.slice(0, 22000),
      links: mergeLinks(data.links, []),
      error: "",
    };
  } catch (error: unknown) {
    return {
      url,
      finalUrl: url,
      ok: false,
      rendered: false,
      error:
        error instanceof Error && /Executable doesn't exist|browserType.launch|playwright install/i.test(error.message)
          ? "Browser rendering is not available until Playwright Chromium is installed. Run: npx.cmd playwright install chromium"
          : error instanceof Error
            ? error.message
            : "Browser rendering failed.",
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function htmlToPlainText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(h[1-6]|p|li|div|section|article|tr|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function extractPageTitle(html: string) {
  return decodeHtmlEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "");
}

async function fetchUrlEvidence(url: string): Promise<UrlEvidence> {
  try {
    const parsed = new URL(url);
    if (isBlockedUrlTarget(parsed)) {
      return {
        url,
        finalUrl: url,
        ok: false,
        error: "Skipped local/private URL for safety. Paste the page content or use the local-agent/project tools for local resources.",
      };
    }

    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": "PayFixAI/1.0 (+https://payfix.local)",
        Accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const rawText = (await response.text()).slice(0, 900000);
    const isHtml = /html|xml/i.test(contentType) || /<html|<a\b|<title/i.test(rawText);
    const title = isHtml ? extractPageTitle(rawText) : "";
    const links = isHtml ? extractPageLinks(rawText, response.url) : [];
    const text = (isHtml ? htmlToPlainText(rawText) : rawText).slice(0, 18000);

    const fetched: UrlEvidence = {
      url,
      finalUrl: response.url,
      ok: response.ok,
      status: response.status,
      contentType,
      title,
      text,
      links,
      error: response.ok ? "" : `HTTP ${response.status}`,
    };

    const rendered = await renderUrlEvidence(response.url).catch(() => null);
    if (rendered?.ok || rendered?.text || rendered?.links?.length) {
      fetched.rendered = true;
      fetched.finalUrl = rendered.finalUrl || fetched.finalUrl;
      fetched.title = rendered.title || fetched.title;
      fetched.text = rendered.text && rendered.text.length > (fetched.text || "").length ? rendered.text : fetched.text;
      fetched.links = mergeLinks(fetched.links, rendered.links);
    } else if (rendered?.error) {
      fetched.error = fetched.error ? `${fetched.error}; Browser render: ${rendered.error}` : `Browser render: ${rendered.error}`;
    }

    const followLinks = resourceLinksForFollowup(fetched.links || [], fetched.finalUrl);
    const childPages = await Promise.all(
      followLinks.map(async (link) => {
        const renderedChild = await renderUrlEvidence(link.href).catch(() => null);
        if (renderedChild) {
          renderedChild.url = link.href;
          renderedChild.title = renderedChild.title || link.text;
          renderedChild.text = renderedChild.text?.slice(0, 9000) || "";
          renderedChild.links = (renderedChild.links || []).slice(0, 50);
          return renderedChild;
        }

        return {
          url: link.href,
          finalUrl: link.href,
          ok: false,
          title: link.text,
          error: "Could not render linked resource page.",
        } satisfies UrlEvidence;
      }),
    );

    fetched.childPages = childPages.filter((page) => page.ok || page.text || page.links?.length).slice(0, 8);

    return fetched;
  } catch (error: unknown) {
    return {
      url,
      finalUrl: url,
      ok: false,
      error: error instanceof Error ? error.message : "Could not fetch URL.",
    };
  }
}

async function fetchUrlEvidenceForQuestion(question: string) {
  const urls = extractHttpUrls(question);
  if (!urls.length) return [];
  return Promise.all(urls.map(fetchUrlEvidence));
}

function formatUrlEvidence(results: UrlEvidence[]) {
  if (!results.length) return "No pasted public URLs were fetched.";

  const formatLinks = (links: { text: string; href: string }[] = []) =>
    links
      .filter((link) => /download|sdk|resource|doc|developer|api|sample|github|aar|jar|apk|zip|pdf|manual|guide|poslink|broadpos|paxstore/i.test(`${link.text} ${link.href}`))
      .slice(0, 40)
      .map((link) => `- ${link.text}: ${link.href}`)
      .join("\n");

  return results
    .map((result, index) => {
      const usefulLinks = formatLinks(result.links);
      const childPages = (result.childPages || [])
        .map((child, childIndex) => {
          const childLinks = formatLinks(child.links);

          return `FOLLOWED RESOURCE PAGE ${index + 1}.${childIndex + 1}
Source URL: ${child.url}
Final URL: ${child.finalUrl}
Status: ${child.ok ? "OK" : "FAILED"}${child.status ? ` (${child.status})` : ""}
Title: ${child.title || "Not found"}
Error: ${child.error || "None"}

Important links/files found on followed page:
${childLinks || "No download/SDK/doc/resource-looking links found on followed page."}

Followed page text:
${child.text || "No text extracted."}`;
        })
        .join("\n\n");

      return `URL ${index + 1}: ${result.url}
Final URL: ${result.finalUrl}
Status: ${result.ok ? "OK" : "FAILED"}${result.status ? ` (${result.status})` : ""}
Rendered in browser: ${result.rendered ? "yes" : "no"}
Content-Type: ${result.contentType || "unknown"}
Title: ${result.title || "Not found"}
Error: ${result.error || "None"}

Important links found on page:
${usefulLinks || "No download/SDK/doc/resource-looking links found in fetched HTML."}

Fetched page text:
${result.text || "No text extracted."}

Followed resource pages:
${childPages || "No resource-looking links were followed."}`;
    })
    .join("\n\n---\n\n");
}

function isLikelyAuthenticatedOrJsOnlyPage(result: UrlEvidence) {
  const text = `${result.title || ""}\n${result.text || ""}\n${result.error || ""}`.toLowerCase();
  const linkCount = result.links?.length || 0;
  const childCount = result.childPages?.length || 0;

  return (
    /sign\s*in|log\s*in|login|register|registration|unauthorized|forbidden|enable javascript|doesn'?t work properly without javascript|requires javascript|access denied|session expired/.test(
      text,
    ) ||
    (!result.ok && /401|403|unauthorized|forbidden/i.test(result.error || "")) ||
    (linkCount === 0 && childCount === 0 && /resources|developer|portal|sdk|download/i.test(`${result.url} ${result.finalUrl}`))
  );
}

function summarizeUrlAccessLimits(results: UrlEvidence[]) {
  const limited = results.filter(isLikelyAuthenticatedOrJsOnlyPage);
  if (!limited.length) return "";

  return limited
    .map((result) => {
      const combined = `${result.title || ""} ${result.text || ""} ${result.error || ""}`;
      const reason = /javascript/i.test(combined)
        ? "the page is a JavaScript portal and the server reader did not expose the SDK/download list"
        : /sign\s*in|log\s*in|login|register|registration|unauthorized|forbidden|access denied/i.test(combined)
          ? "the page appears to require a logged-in browser session"
          : "no concrete download/resource links were visible to the server reader";

      return `- ${result.url}: ${reason}.`;
    })
    .join("\n");
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

function isBuildGuideQuestion(question: string) {
  return /\b(how (?:do|to) i build|where do i go from here|step by step|instructions?|build an app|android studio|files to create|code snippets?|implementation guide)\b/i.test(
    question,
  );
}

function ensureBuildGuideAgentHandoff(text: string, question: string) {
  if (!isBuildGuideQuestion(question) || /\bAgent handoff\b|\bAgent can build\b|\bRun Agent\b/i.test(text)) return text;

  return `${text.trim()}

Agent handoff:
If you want PayFix to create the full project instead of only giving instructions, click "Build full app with Agent" below or Run Agent. Agent will ask for the target parent path and folder name if no project is connected, then create the files, add dependency placeholders/vendor SDK notes, write the README setup steps, and run the available validation/build checks.`;
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
  width?: number;
  height?: number;
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

type EvidenceSignal = {
  source: string;
  line: number;
  severity: "critical" | "warning" | "info";
  title: string;
  text: string;
};

function compactLine(value: string, max = 260) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function collectEvidenceLines(label: string, text: string) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line, index) => ({ source: label, line: index + 1, text: line.trim() }))
    .filter((entry) => entry.text);
}

function scanPaymentEvidence({
  log,
  code,
  uploadedFiles,
}: {
  log: string;
  code: string;
  uploadedFiles: UploadedFilePayload[];
}) {
  const entries = [
    ...collectEvidenceLines("payment-log", log),
    ...collectEvidenceLines("pasted-context", code),
    ...uploadedFiles
      .filter((file) => !file.isImage && String(file.content || "").trim())
      .flatMap((file) => collectEvidenceLines(`uploaded-file-${file.name}`, String(file.content || ""))),
  ];
  const patterns: Array<{ pattern: RegExp; severity: EvidenceSignal["severity"]; title: string }> = [
    { pattern: /same key has already been added|duplicate key|key:\s*95|dictionary/i, severity: "critical", title: "Duplicate EMV/tag dictionary key exception" },
    { pattern: /DroidIDTechUSBService|IDTechUSBManager|CardReaderServiceErrorEventHandler|Android_MsrCardRead_GenericError/i, severity: "critical", title: "IDTech/Cardknox reader SDK error" },
    { pattern: /ExecuteHttpRequestAsync|rest error|Parsing:\s*form url encoded|xResult=|xStatus=|xErrorCode=|xRefNum=/i, severity: "critical", title: "Gateway/API request or response signal" },
    { pattern: /Access-Control-Allow-Private-Network|Private Network Access|PNA|Provisional headers are shown|ERR_CERT|CORS|preflight|OPTIONS/i, severity: "critical", title: "Browser CORS/PNA/TLS signal" },
    { pattern: /\b(declined|approved|failure|failed|timeout|exception|invalid|unauthorized|forbidden|blocked|error)\b/i, severity: "warning", title: "Explicit status/error line" },
    { pattern: /\b(9F27|9F26|9F10|9F36|9F37|9F39|95=|Tag 95|DF8129|8A|ARQC|AAC|TC|TLV|EMV)\b/i, severity: "info", title: "EMV/TLV payment signal" },
  ];
  const signals: EvidenceSignal[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    for (const item of patterns) {
      if (!item.pattern.test(entry.text)) continue;
      const key = `${item.title}:${entry.source}:${entry.line}:${entry.text.slice(0, 160)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      signals.push({
        source: entry.source,
        line: entry.line,
        severity: item.severity,
        title: item.title,
        text: compactLine(entry.text),
      });
      break;
    }
  }

  return signals.slice(0, 30);
}

function formatEvidenceSignals(signals: EvidenceSignal[]) {
  if (!signals.length) return "No deterministic high-signal lines found.";
  return signals
    .slice(0, 16)
    .map((signal) => `- [${signal.severity.toUpperCase()}] ${signal.title} (${signal.source}:${signal.line}) ${signal.text}`)
    .join("\n");
}

function sanitizeLocalDiagnosticLinks(text: string) {
  return text
    .replace(
      /\[(?:Open Link|[^\]\n]{1,80})\]\(((?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|localenv\.com|localemv\.com|[^)\s]*\.local|[^)\s]*\.lan|192\.168\.[^)\s]+|10\.[^)\s]+|172\.(?:1[6-9]|2\d|3[01])\.[^)\s]+)[^)]*)\)/gi,
      (_match, url: string) => `\`${String(url).replace(/`+$/g, "")}\``,
    )
    .replace(/\n?\[Open Link\]\(([^)]*)\)\s*$/gi, (_match, url: string) => {
      const cleaned = String(url).replace(/`+$/g, "");
      return /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|localenv\.com|localemv\.com|[^/\s]+\.local|[^/\s]+\.lan|192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(cleaned)
        ? `\n\`${cleaned}\``
        : "";
    });
}

function likelyHasBaselineAndFailingEvidence(uploadedFiles: UploadedFilePayload[], text: string) {
  const names = uploadedFiles.filter((file) => !file.isImage).map((file) => file.name.toLowerCase()).join(" ");
  return (
    /(working|baseline|approved|success|visa)/i.test(names) &&
    /(failing|declined|failed|master|mastercard|mc)/i.test(names)
  ) || /\b(compare|working|baseline|approved).+\b(failing|declined|failed)\b/i.test(text);
}

function shouldReviseAnswer({
  answer,
  question,
  signals,
  uploadedFiles,
}: {
  answer: string;
  question: string;
  signals: EvidenceSignal[];
  uploadedFiles: UploadedFilePayload[];
}) {
  const asksForDiagnosis = /\b(why|root cause|what(?:'s| is) wrong|analy[sz]e|investigate|compare|sticking out|reason|failing|declin|error|logs?)\b/i.test(question);
  if (!asksForDiagnosis) return false;

  const lower = answer.toLowerCase();
  const evidenceText = `${question}\n${signals.map((signal) => signal.text).join("\n")}`;
  const firefoxAlreadyShowsPna =
    /firefox[\s\S]{0,500}access-control-allow-private-network\s*:\s*true/i.test(evidenceText) ||
    /access-control-allow-private-network\s*:\s*true[\s\S]{0,500}firefox/i.test(evidenceText);
  const contradictsPresentPnaHeader =
    firefoxAlreadyShowsPna &&
    (/(?:most likely root cause|root cause|bottom line)[\s\S]{0,260}(?:missing|lacks|does not include|not getting a valid response that includes|add)\s+[\s\S]{0,140}access-control-allow-private-network/i.test(answer) ||
      /make sure your server(?:'s)? preflight[\s\S]{0,220}access-control-allow-private-network/i.test(answer));
  const generic =
    /\b(check the logs|need more context|could be many things|try again|hard to say|not enough information|provide more details)\b/i.test(answer) ||
    answer.length < 450;
  const missingShape =
    !/\b(root cause|most likely|likely issue|main issue|bottom line)\b/i.test(answer) ||
    !/\b(evidence|because|line|shows|signals?)\b/i.test(answer) ||
    !/\b(next step|fix|do this|change|verify|check)\b/i.test(answer);
  const missedCriticalSignal = signals.some(
    (signal) =>
      signal.severity === "critical" &&
      !lower.includes(signal.title.toLowerCase().slice(0, 18)) &&
      !lower.includes(signal.text.toLowerCase().slice(0, 45)),
  );
  const needsComparison = likelyHasBaselineAndFailingEvidence(uploadedFiles, question) && !/\b(working|baseline|approved|failing|declined|difference|divergence)\b/i.test(answer);
  const asksForBuildGuide = /\b(how (?:do|to) i build|where do i go from here|step by step|instructions?|build an app|android studio|files to create|code snippets?)\b/i.test(
    question,
  );
  const asksForDownloadOrDocs = /\b(download|docs?|documentation|developer portal|resources|sdk|api|official|url|link)\b/i.test(question);
  const weakBuildGuide =
    asksForBuildGuide &&
    (!/\b(Android Studio|File\s*->|build\.gradle|AndroidManifest|MainActivity|app\/src\/main|code snippet|test checklist|next milestone)\b/i.test(
      answer,
    ) ||
      !/build\.gradle/i.test(answer) ||
      !/\bAgent\b/i.test(answer) ||
      (asksForDownloadOrDocs && !/https?:\/\//i.test(answer)));

  return generic || missingShape || missedCriticalSignal || needsComparison || contradictsPresentPnaHeader || weakBuildGuide;
}

async function reviseWeakAnswer({
  systemText,
  userText,
  imageParts,
  firstAnswer,
  evidenceSignals,
  hasImageEvidence,
  needsWebSearch,
}: {
  systemText: string;
  userText: string;
  imageParts: ReturnType<typeof buildImageParts>;
  firstAnswer: string;
  evidenceSignals: EvidenceSignal[];
  hasImageEvidence: boolean;
  needsWebSearch: boolean;
}) {
  const response = await openai.responses.create({
    ...payfixResponseConfig(hasImageEvidence ? "imageAnalysis" : "regularChat"),
    max_output_tokens: hasImageEvidence ? 4200 : 3000,
    tools: webSearchTools(needsWebSearch),
    input: [
      {
        role: "system" as const,
        content: `${systemText}

QUALITY REVISION MODE:
${PAYFIX_BEST_ANSWER_STANDARD}
${PAYFIX_REVISION_STANDARD}
- The previous answer was too generic, missed deterministic evidence, or did not clearly separate root cause, evidence, fix, and next step.
- Rewrite the answer from scratch.
- Start with one plain-English direct answer. Do not force the exact label "Bottom line" unless it is genuinely the clearest wording.
- Then use short natural sections when helpful, such as What is happening, Evidence, Do this, and Verify.
- If comparing working vs failing evidence, clearly label Working/baseline and Failing/suspect.
- Discuss deterministic critical lines before generic timeout/noise lines.
- If new evidence proves the first suspected fix is already present, do not repeat that fix as the root cause. Move to the next most likely blocker: browser permission, cache/site data, TLS trust, mixed-content, policy, stale local service, proxy, or route mismatch.
- If Firefox evidence already shows Access-Control-Allow-Private-Network: true, do not make "missing Access-Control-Allow-Private-Network" the main cause. The better answer is that Chrome is blocking before accepting the response because of Chrome-specific permission/cache/TLS/policy/stale-service/URL mismatch, unless Chrome's OPTIONS response proves the header is missing.
- Treat user typos as context clues, not blockers. If the surrounding evidence strongly indicates a known product/protocol/vendor term, use the likely intended term and preserve exact evidence values separately.
- If web search is enabled, use it only to verify current platform/vendor behavior. Do not let web results override the user's uploaded evidence; use them to explain why the evidence behaves that way.
- If the user asked for build instructions, rewrite as a concrete implementation guide with exact IDE actions, files, code snippets, verification, and next milestone.
- If the user asked for downloads, SDKs, docs, developer portals, or resources and web search is enabled, include verified URLs for each official resource you rely on. If a download requires login or cannot be verified, say that directly and link the official portal/docs page instead.
- If URL ACCESS LIMITS says the download list was hidden behind login/JavaScript or no concrete files were visible, do not guess exact SDK filenames. Ask for the logged-in browser page/folder URL, visible file list, or screenshot.
- For Android build guides, explicitly name app/build.gradle.kts or app/build.gradle, AndroidManifest.xml, and MainActivity.kt/MainActivity.java.
- Include a short "Agent handoff" section saying Agent can create the full project, files, dependencies/placeholders, README, and validation after the user connects a project or provides target parent path and folder name.
- Keep it concise but complete.`,
      },
      {
        role: "user" as const,
        content: [
          {
            type: "input_text" as const,
            text: `${userText}

DETERMINISTIC EVIDENCE SIGNALS:
${formatEvidenceSignals(evidenceSignals)}

PREVIOUS WEAK ANSWER:
${firstAnswer}`,
          },
          ...imageParts,
        ],
      },
    ],
  });

  return response.output_text?.trim() || firstAnswer;
}

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
      (f, index) => {
        const dimensions = f.width && f.height ? `${f.width}x${f.height}` : "unknown";
        const megapixels = f.width && f.height ? `${((f.width * f.height) / 1_000_000).toFixed(2)} MP` : "unknown";

        return `UPLOADED IMAGE ${index + 1}:
REFERENCE LABEL: Image ${index + 1}: ${f.name}
ACTUAL FILE NAME: ${f.name}
ACTUAL MIME TYPE: ${f.type || "unknown"}
SIZE: ${f.size || 0} bytes
DIMENSIONS: ${dimensions}
MEGAPIXELS: ${megapixels}
ORDER: This is image part ${index + 1} in the current request.
IMPORTANT: This metadata describes the uploaded file. Text visible inside the screenshot may mention other filenames or formats; do not confuse screenshot text with the uploaded file format.`;
      }
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
    ...payfixResponseConfig("agentSelector", {
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
    }),
    temperature: 0,
    max_output_tokens: 700,
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
    const hasImageEvidence = imageParts.length > 0;
    const evidenceSignals = scanPaymentEvidence({ log, code, uploadedFiles });
    const urlEvidence = await fetchUrlEvidenceForQuestion(question);
    const urlEvidenceText = formatUrlEvidence(urlEvidence);
    const urlAccessLimits = summarizeUrlAccessLimits(urlEvidence);

    const projectTextFiles = projectFiles.filter((file) => file.kind === "text");
    const projectFileNames = projectFiles.map((file) => normalizeFilePath(file.file));

    const needsWebSearch = likelyNeedsWeb(question) || urlEvidence.length > 0;
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
      fetchedUrlCount: urlEvidence.length,
      fetchedUrls: urlEvidence.map((result) => ({
        url: result.url,
        finalUrl: result.finalUrl,
        ok: result.ok,
        rendered: Boolean(result.rendered),
        status: result.status,
        title: result.title,
        linkCount: result.links?.length || 0,
        followedResourcePageCount: result.childPages?.length || 0,
        error: result.error || "",
      })),
      evidenceSignalCount: evidenceSignals.length,
      criticalEvidenceSignalCount: evidenceSignals.filter((signal) => signal.severity === "critical").length,
    };

    const systemText = `
You are PayFix AI, a senior debugging assistant for payment integrations, EMV devices, gateway errors, logs, codebases, screenshots, and technical documentation.

${PAYFIX_BEST_ANSWER_STANDARD}
${PAYFIX_REVISION_STANDARD}

GENERAL BEHAVIOR:
- Be concise, technical, and direct.
- Answer the user's exact question first.
- If the latest user message is very short or referential, resolve it from the recent conversation before answering. Examples: yes, no, ok, run, check, confirm, verify, fix, apply, continue, again, retry, same, more, next, explain, why, where, which, how, what, this, that, these, those, them, it, here, show, open, send, download, install, build, test, sync, validate, stop, wait, cancel.
- For a short follow-up, do not restart the whole topic. Identify what prior answer/attachment/action it refers to, then answer that narrow thing.
- If a short follow-up could refer to multiple recent things, ask one concise clarifying question instead of guessing or analyzing old attachments.
- If the answer is yes/no, start with yes/no.
- Do not guess when data is missing.
- For diagnosis/debugging questions, start with one direct sentence that answers the user. Then use short natural sections when helpful, such as What is happening, Evidence, Do this, and Verify. Do not force the exact label "Bottom line" on every answer.
- If evidence is insufficient, say exactly what is missing and still give the best next diagnostic step.
- Before finalizing, silently self-check: Did I answer the actual user question? Did I use attached files/screenshots/logs? Did I separate working/baseline evidence from failing evidence when both exist? Did I avoid generic advice when direct evidence exists?
- If the user misspells a product, service, route, or acronym, infer the likely intended term only when context makes it clear, and do not make the typo the user's problem. Example: a Cardknox local reader context may imply BBPOS/localemv even when typed loosely.

WEB / DOCUMENTATION RULES:
- Use web search only when the user requests documentation, SDKs, APIs, downloads, official links, current website instructions, vendor resources, or current platform/browser/security-policy behavior.
- If the user pastes a public URL, PayFix will provide URL PAGE EVIDENCE from the fetched page. Use that exact page text and link list before generic web-search knowledge.
- If the user asks what to download from a URL, list the specific visible resources/download/doc links found in URL PAGE EVIDENCE and FOLLOWED RESOURCE PAGE evidence. If the fetched page uses clickable categories like POSLink/POSLink 2/folders, rely on the followed resource pages to identify the exact download/doc/file choices.
- If URL ACCESS LIMITS says the page is login-gated, JavaScript-only, or did not expose concrete download links, do not invent exact SDK/file names and do not add a "what to expect after login" list. Say clearly that PayFix could not see the authenticated download list yet.
- If the user asks for "exactly what to download" and URL ACCESS LIMITS is present, the answer should be only: what could not be seen, why, and the exact browser/session evidence needed next. Do not provide likely categories as if they were confirmed.
- For logged-in portals, give this next action: open the URL in the browser where the user is signed in, click the relevant SDK/category such as POSLink/POSLink 2, then paste the opened folder/page URL, copy the visible file list, or attach a screenshot. After that, PayFix can name exactly what to download.
- If the user provides screenshots or captured browser evidence showing SDK/download folders/files, answer from the visible evidence with this clear structure:
  1. "Navigate there": exact visible path/click sequence, such as Resources -> SDK -> POSLink -> Java/Android.
  2. "Download these": exact visible folder/file names when readable, grouped as Required, Recommended sample/docs, Optional/only-if-needed, and Skip for this project.
  3. "Start with this sample": name the closest sample/example folder or say which visible sample is missing.
  4. "After download/extract": exact next local folder to give Agent, and what Agent will add to the Android Studio project.
- For SDK screenshots, do not bury the answer in paragraphs. Use a compact checklist/table-like bullet layout and say when text is not readable.
- If browser rendering or followed pages are unavailable, say exactly what could not be read and give the best next step, such as pasting the opened folder page URL or screenshot.
- For Chrome/Chromium, CORS, Private Network Access, Local Network Access, mixed content, TLS/certificate, browser flag, or managed-policy questions, use web search to verify current browser behavior when available.
- Use web results as supporting context. The user's uploaded screenshots/logs remain the primary evidence.
- Only use verified URLs from search results.
- Never fabricate links.
- Never reconstruct URLs from memory.
- If no valid official URL is found, respond: "I could not verify an official URL."
- URL format must be markdown only:
  [Page Title](https://example.com)
- Do not convert localhost, local device, private-network, debug, or pasted diagnostic URLs into promotional "Open Link" links. Show them as inline code unless the user explicitly asks for a clickable link.

LOCAL PROJECT RULES:
- Always prioritize provided local context, uploaded files, logs, screenshots, and structured project files.
- Uploaded images are first-class user input. Read them as carefully as if the user had typed the visible text, layout, objects, colors, dimensions, and state into the chat.
- When images are present, inspect the actual pixels before answering. Use the uploaded metadata only for identity, file type, size, and dimensions.
- For screenshots, perform a full visual pass: visible text/OCR, active page or app state, selected controls, errors, disabled/enabled buttons, overlays/modals, layout, alignment, spacing, colors, contrast, truncation, clipping, scroll position, suspicious UI states, and any evidence relevant to the user's question.
- For diagrams, receipts, terminals, device screens, payment UI, logs captured in screenshots, or code screenshots, transcribe important visible text exactly enough to ground the answer, then interpret it.
- If multiple images are present, compare them explicitly when useful and say which image each observation came from.
- If the user asks broadly to analyze a screenshot/image, give a structured answer with: what it shows, important visible text, likely issues or risks, exact evidence, and concrete next actions.
- If the image quality blocks certainty, say what is unreadable and what would improve the read. Do not pretend small/blurry text is clear.
- For uploaded images, preserve the actual uploaded filename and MIME type from UPLOADED IMAGE METADATA.
- When multiple images are uploaded, refer to them by their REFERENCE LABEL, for example "Image 1: checkout.png". The uploaded image parts are provided in the same order as UPLOADED IMAGE METADATA.
- If an uploaded image is a screenshot of the app/chat, describe it as a screenshot first and read the UI/text inside it as screenshot content.
- Do not say the uploaded image is SVG/PDF/etc. unless the uploaded image metadata says that is its MIME type or file extension.
- If text inside a screenshot mentions another filename, for example "file.svg", treat that as text shown inside the screenshot, not as the uploaded file name.
- If the user asks whether an image has a property, for example "does this look square?", answer from the visual evidence directly.
- If the user asks to edit/convert/crop/resize an uploaded image, explain exactly what edit is needed. Do not invent a new image unless the user explicitly asks to generate a new one.
- If the user uploads only an image with no text, identify what it appears to be, read any visible text, and suggest the most likely useful next actions.
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

BUILD / IMPLEMENTATION GUIDE RULES:
- When the user asks how to build an app, integration, SDK flow, POS/device flow, or asks for clearer step-by-step instructions, switch from terse debugging mode to a practical build guide.
- Start with: "Here is the exact path I would take."
- Include ordered phases with concrete UI/tool actions, for example "Android Studio -> File -> New -> New Project", "File -> Open", "Tools -> SDK Manager", "app/build.gradle.kts", "AndroidManifest.xml", and the package/file path to create.
- Give a minimal runnable skeleton when useful: file tree, Gradle dependencies/placeholders, manifest permissions, app/src/main/java/.../MainActivity.kt, Kotlin/Java class snippets, network/client snippet, config constants, and where each snippet goes.
- If vendor SDK/API names are not verified in the provided context or web results, label them as placeholders and tell the user exactly where to replace them after downloading the vendor SDK/docs.
- For payment/device apps, include: developer account/docs step, sample app first, device/debug setup, SDK dependency/import step, permissions, transaction flow, tokenization flow, backend boundary, test checklist, and production/security checklist.
- Include a "Official downloads/docs" section with verified URLs for vendor portals, SDK docs/download locations, sample apps, and API docs when available. Do not invent exact download URLs; say "download after login from..." if that is the reliable path.
- Include an "Agent handoff" section explaining that if the user wants the full project generated, they should run Agent/connect or provide a target parent path and folder name. The Agent should create files, install dependencies/placeholders, write README setup steps, and run validation, while Regular Chat remains for planning and instructions.
- Do not just say "create a project" or "integrate the SDK"; say exactly what screen/menu/file/action the developer should use next.
- End with the next smallest milestone the developer should complete before adding more features.

PAYMENT / CARDKNOX / IDTECH LOG RULES:
- Logs are first-class evidence. Scan all uploaded/pasted logs for explicit exception, error, timeout, declined, approved, xResult/xStatus/xError, gateway response, HTTP parse, SDK event, TLV/EMV, and stack-trace lines.
- When multiple logs are present, compare working/baseline vs failing/suspect side by side. Name which file is which if filenames indicate it.
- Prioritize host/gateway/API request and response lines, SDK exceptions, and first meaningful divergence over generic Android noise.
- For Cardknox/IDTech logs, treat "An item with the same key has already been added. Key: 95", DroidIDTechUSBService, IDTechUSBManager, CardReaderServiceErrorEventHandler, ExecuteHttpRequestAsync, form-url-encoded parsing, xResult/xStatus/xErrorCode, and rest error lines as high-signal.
- For Chrome "Provisional headers are shown" to a local/private-network endpoint, consider TLS trust, Local Network Access / Private Network Access permission, and missing Access-Control-Allow-Private-Network on the OPTIONS preflight before blaming server response headers alone.
- If Firefox shows the required CORS/PNA headers but Chrome shows no response headers, update the diagnosis: Chrome likely blocked before accepting the response because of site permission, cached failed permission/site data, TLS trust, mixed content, managed Chrome policy, stale local service, service worker/proxy, or a different URL/route. Do not keep saying "add Access-Control-Allow-Private-Network" unless the Chrome OPTIONS response proves it is missing.
- Do not say "Firefox is more permissive" as the main explanation when Firefox is being used as proof that the server returns the headers. Frame Firefox as evidence that the server-side header fix is probably present; then focus Chrome investigation on Local Network Access permission, site data/cache, insecure-content permission, certificate trust, managed policy, stale BBPOS/localemv service, service worker/proxy, or exact URL mismatch.
- For browser screenshots, transcribe exact visible URL schemes/hosts. If evidence conflicts, such as localenv vs localemv or HTTP vs HTTPS, call out the mismatch as a verification item instead of assuming one value is correct.
- For Chrome local/private-network issues, the first verify step should be: inspect the Chrome OPTIONS entry and confirm status plus Access-Control-Allow-Origin, Access-Control-Allow-Headers, Access-Control-Allow-Methods, and Access-Control-Allow-Private-Network. If those are present, next check Chrome local network permission at chrome://settings/content/localNetwork, site data/cache, insecure-content permission, cert trust, service restart, and managed policy.
- Treat SELinux/property_service/resource-close warnings as secondary unless they correlate directly with the failing transaction.
- EMV/TLV decode is only one signal. Do not let TLV details hide explicit SDK/API exceptions.
- Use DETERMINISTIC EVIDENCE SIGNALS as a checklist. If a critical signal is listed, either explain it or explicitly say why it is benign.

RESPONSE STYLE:
- Minimal but precise.
- Avoid generic troubleshooting steps unless the user did not provide enough context.
- Prefer actionable fixes over theory.
- For ordinary diagnostic answers, target 8-12 readable lines total.
- Do not include long setup procedures unless the user asks for exact steps, commands, build instructions, or a from-scratch implementation path. When they do ask, be detailed and concrete.
- Prefer 3 short sections with natural labels such as Answer, Evidence, and Do this.
- Use at most 3 bullets per section unless the user asks for exhaustive detail.
- For commands, provide one clean code block, not line-by-line prose around every header.
`;

    const userText = `
LATEST USER REQUEST:
${question}

REQUEST / EVIDENCE BOUNDARY:
- The LATEST USER REQUEST above is the active task.
- The sections below are supporting evidence only.
- If the user says they already did/tried/confirmed a step, do not repeat that same step as the main answer. Diagnose what remains true after that step.

PAYMENT LOG:
${log || "No payment log provided."}

RELATED CODE / COMPUTER SEARCH RESULTS / PROJECT CONTEXT:
${code || "No code/search/project context provided."}

URL PAGE EVIDENCE:
${urlEvidenceText}

URL ACCESS LIMITS:
${urlAccessLimits || "No authenticated/JavaScript-only URL access limits detected."}

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

DETERMINISTIC EVIDENCE SIGNALS:
${formatEvidenceSignals(evidenceSignals)}

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
      ...payfixResponseConfig(hasImageEvidence ? "imageAnalysis" : "regularChat"),
      max_output_tokens: hasImageEvidence ? 4200 : 2800,
      tools: webSearchTools(needsWebSearch),
      input,
    });

    const firstText = response.output_text?.trim() || "No result returned.";
    const revisedText = shouldReviseAnswer({
      answer: firstText,
      question,
      signals: evidenceSignals,
      uploadedFiles,
    })
      ? await reviseWeakAnswer({
          systemText,
          userText,
          imageParts,
          firstAnswer: firstText,
          evidenceSignals,
          hasImageEvidence,
          needsWebSearch,
        })
      : firstText;
    const finalText = sanitizeLocalDiagnosticLinks(ensureBuildGuideAgentHandoff(normalizeChangeRequestResponse(revisedText, question), question));

    return Response.json({
      result: finalText,
      toolResults,
      quality: {
        revised: revisedText !== firstText,
        evidenceSignalCount: evidenceSignals.length,
        criticalEvidenceSignalCount: evidenceSignals.filter((signal) => signal.severity === "critical").length,
      },
    });
  } catch (error: unknown) {
    console.error(error);

    return Response.json({
      result: error instanceof Error ? error.message : "Failed to analyze.",
    });
  }
}
