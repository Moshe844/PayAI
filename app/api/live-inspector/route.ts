import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type {
  LiveAppConsoleEntry,
  LiveAppDomSnapshot,
  LiveAppFinding,
  LiveAppInspectionResult,
  LiveAppNetworkEntry,
  LiveAppRootCause,
  LiveAppDetectedProject,
} from "../../lib/payfixTypes";

export const runtime = "nodejs";

const candidatePorts = [3000, 3001, 3002, 3010, 5173, 5174, 8080, 4200, 5000, 8000];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".scss"]);
const ignoredDirs = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage"]);
const maxBodyCaptureChars = 12000;
const localAgentBase = "http://localhost:7777";

function isValidLocalUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function canConnect(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(350);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function detectLocalApps() {
  const checks = await Promise.all(candidatePorts.map(async (port) => ({ port, open: await canConnect(port) })));

  return checks.filter((check) => check.open).map((check) => ({ port: check.port, url: `http://localhost:${check.port}` }));
}

function addFinding(
  findings: LiveAppFinding[],
  severity: LiveAppFinding["severity"],
  title: string,
  detail: string,
  evidence: string,
  sourceHint?: string,
) {
  findings.push({
    id: `finding-${findings.length + 1}`,
    severity,
    title,
    detail,
    evidence,
    sourceHint,
  });
}

function stackSourceHint(text: string) {
  const match = text.match(/(?:webpack-internal:\/\/\/|\/|\\)?(app|src|pages)[/\\][^\s:)]+(?:\.tsx|\.ts|\.jsx|\.js|\.css)(?::\d+)?/i);
  return match?.[0]?.replace("webpack-internal:///", "").replace(/^[/\\]/, "").replaceAll("\\", "/");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

async function walkSourceFiles(dir: string, files: string[] = []) {
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkSourceFiles(fullPath, files);
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }

  return files;
}

function normalizeProjectPath(file: string, projectRoot: string) {
  return path.relative(projectRoot, file).replaceAll("\\", "/");
}

function resolveImport(fromFile: string, specifier: string) {
  if (!specifier.startsWith(".")) return "";
  const fromDir = path.dirname(fromFile);
  const base = path.resolve(fromDir, specifier);
  const candidates = [
    base,
    ...[...sourceExtensions].map((extension) => `${base}${extension}`),
    ...[...sourceExtensions].map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => sourceExtensions.has(path.extname(candidate))) || base;
}

async function buildImportGraph(projectRoot: string) {
  const roots = ["app", "src", "pages"].map((folder) => path.join(projectRoot, folder));
  const files = (await Promise.all(roots.map((root) => walkSourceFiles(root)))).flat();
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const graph = new Map<string, { imports: string[]; importedBy: string[] }>();

  for (const file of files) {
    const relative = normalizeProjectPath(file, projectRoot);
    const content = await fs.readFile(file, "utf8").catch(() => "");
    const imports = uniqueStrings(
      [...content.matchAll(/import\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']|export\s+[^'"]+\s+from\s+["']([^"']+)["']/g)]
        .map((match) => match[1] || match[2])
        .map((specifier) => resolveImport(file, specifier))
        .filter((resolved) => fileSet.has(path.resolve(resolved)))
        .map((resolved) => normalizeProjectPath(resolved, projectRoot)),
    );

    graph.set(relative, { imports, importedBy: [] });
  }

  for (const [file, entry] of graph) {
    for (const imported of entry.imports) {
      const importedEntry = graph.get(imported);
      if (importedEntry) importedEntry.importedBy.push(file);
    }
  }

  return graph;
}

async function resolveProjectForUrl(targetUrl: string, explicitProjectRoot?: string): Promise<LiveAppDetectedProject | undefined> {
  if (explicitProjectRoot) {
    try {
      const packageJson = JSON.parse(await fs.readFile(path.join(explicitProjectRoot, "package.json"), "utf8"));
      return {
        root: explicitProjectRoot,
        packageName: String(packageJson.name || path.basename(explicitProjectRoot)),
        framework: packageJson.dependencies?.next
          ? "Next.js"
          : packageJson.devDependencies?.vite || packageJson.dependencies?.vite
            ? "Vite"
            : "Project",
        confidence: 100,
        reason: "Project root was supplied by the connected PayFix project.",
      };
    } catch {
      return undefined;
    }
  }

  try {
    const response = await fetch(`${localAgentBase}/app/resolve-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl }),
      cache: "no-store",
    });
    const data = await response.json();
    const best = data.best;

    if (!response.ok || !data.ok || !best || !data.resolved) return undefined;

    return {
      root: best.root,
      packageName: best.packageName,
      framework: best.framework,
      confidence: best.confidence,
      reason: best.reason,
      processHint: best.processHint,
      candidates: data.candidates,
    };
  } catch {
    return undefined;
  }
}

function rootCauseFromEvidence(
  findings: LiveAppFinding[],
  consoleMessages: LiveAppConsoleEntry[],
  pageErrors: string[],
  network: LiveAppNetworkEntry[],
  dom: LiveAppDomSnapshot | undefined,
  graph: Map<string, { imports: string[]; importedBy: string[] }>,
): LiveAppRootCause | undefined {
  const evidenceText = [
    ...findings.map((finding) => `${finding.title}\n${finding.evidence}\n${finding.sourceHint || ""}`),
    ...consoleMessages.map((entry) => `${entry.text}\n${entry.location || ""}`),
    ...pageErrors,
  ].join("\n\n");
  const sourceHints = uniqueStrings(
    [stackSourceHint(evidenceText), ...findings.map((finding) => finding.sourceHint || "").map(stackSourceHint)]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replace(/:\d+(?::\d+)?$/, "")),
  );
  const failedNetwork = network.filter((entry) => entry.failure || (entry.status && entry.status >= 400));
  const overflow = dom?.overflowElements[0];
  const likelyFiles = sourceHints.map((hint) => {
    const graphEntry = graph.get(hint);
    return {
      file: hint,
      reason: "Referenced directly by console/page stack evidence.",
      imports: graphEntry?.imports.slice(0, 8),
      importedBy: graphEntry?.importedBy.slice(0, 8),
    };
  });

  if (failedNetwork.length) {
    return {
      title: "Network/API failure is the leading cause",
      confidence: sourceHints.length ? 86 : 78,
      why: `The inspector captured ${failedNetwork.length} failed or error-status request(s). These usually explain broken UI state faster than CSS or component inspection.`,
      likelyFiles,
      suggestedFix: "Open the failed request details, verify the route/path/method, then inspect the handler or client fetch code that produced it.",
    };
  }

  if (/hydration|server rendered text|did not match/i.test(evidenceText)) {
    return {
      title: "Hydration mismatch between server and client render",
      confidence: sourceHints.length ? 88 : 76,
      why: "React reported that server-rendered output differs from the client render. Typical causes are Date/Math.random/window-dependent rendering or locale formatting during SSR.",
      likelyFiles,
      suggestedFix: "Move browser-only values into useEffect/client state, or render a stable server snapshot before hydrating.",
    };
  }

  if (pageErrors.length || /maximum update depth|too many re-renders|state update/i.test(evidenceText)) {
    return {
      title: "Runtime render/state error",
      confidence: sourceHints.length ? 84 : 70,
      why: "The page threw a runtime error while loading. If this is a render loop, check effects and callbacks that update state during render or recreate dependencies every render.",
      likelyFiles,
      suggestedFix: "Use the stack hint to inspect the nearest component, then memoize unstable objects/functions or narrow useEffect dependencies.",
    };
  }

  if (overflow) {
    return {
      title: "Layout overflow from a wide DOM element",
      confidence: 72,
      why: `The inspector found an element wider than the viewport: ${overflow.tag}${overflow.id ? `#${overflow.id}` : ""}.`,
      likelyFiles,
      suggestedFix: "Find the component rendering that class/text and add min-w-0, max-w-full, overflow-hidden, break-words, or responsive wrapping as appropriate.",
    };
  }

  if (findings.some((finding) => finding.severity !== "info")) {
    return {
      title: "Inspector found issues, but no single source file is proven yet",
      confidence: 58,
      why: "There are warnings/errors, but the browser evidence did not include a strong component stack or route source.",
      likelyFiles,
      suggestedFix: "Use the finding evidence to ask Run Agent to inspect the likely route/component files.",
    };
  }

  return undefined;
}

function buildFindings(
  dom: LiveAppDomSnapshot | undefined,
  consoleMessages: LiveAppConsoleEntry[],
  pageErrors: string[],
  network: LiveAppNetworkEntry[],
) {
  const findings: LiveAppFinding[] = [];
  const consoleErrors = consoleMessages.filter((entry) => ["error", "warning"].includes(entry.type));
  const hydration = consoleMessages.find((entry) => /hydration|server rendered text|did not match/i.test(entry.text));
  const failedNetwork = network.filter((entry) => entry.failure || (entry.status && entry.status >= 400));
  const notFound = failedNetwork.filter((entry) => entry.status === 404);
  const serverErrors = failedNetwork.filter((entry) => entry.status && entry.status >= 500);

  if (hydration) {
    addFinding(
      findings,
      "critical",
      "React hydration mismatch detected",
      "The running app logged a hydration warning/error. This usually means server-rendered HTML differs from the client render.",
      hydration.text.slice(0, 700),
      stackSourceHint(hydration.text) || hydration.location,
    );
  }

  if (pageErrors.length) {
    addFinding(
      findings,
      "critical",
      "Runtime page error",
      "The browser page threw one or more uncaught errors while loading.",
      pageErrors.slice(0, 3).join("\n\n").slice(0, 900),
      stackSourceHint(pageErrors.join("\n")),
    );
  }

  if (serverErrors.length) {
    addFinding(
      findings,
      "critical",
      "Server/network 5xx response",
      "At least one request returned a server error while the app loaded.",
      serverErrors.map((entry) => `${entry.status} ${entry.method} ${entry.url}`).slice(0, 5).join("\n"),
    );
  }

  if (notFound.length) {
    addFinding(
      findings,
      "warning",
      "404 request detected",
      "The app requested a URL that does not exist. This often points to a broken API route, asset path, or hard-coded endpoint.",
      notFound.map((entry) => `${entry.status} ${entry.method} ${entry.url}`).slice(0, 5).join("\n"),
    );
  }

  if (failedNetwork.some((entry) => entry.failure)) {
    addFinding(
      findings,
      "warning",
      "Failed network request",
      "The browser reported at least one request failure.",
      failedNetwork
        .filter((entry) => entry.failure)
        .map((entry) => `${entry.method} ${entry.url}\n${entry.failure}`)
        .slice(0, 5)
        .join("\n\n"),
    );
  }

  if (dom?.horizontalOverflow || dom?.overflowElements.length) {
    const first = dom.overflowElements[0];
    addFinding(
      findings,
      "warning",
      "Horizontal overflow detected",
      "The document or one of its elements is wider than the viewport. This is a common cause of clipped layouts and sideways scrollbars.",
      first
        ? `${first.tag}${first.id ? `#${first.id}` : ""}${first.className ? `.${first.className.split(/\s+/).slice(0, 3).join(".")}` : ""} scrollWidth=${first.scrollWidth}, clientWidth=${first.clientWidth}, right=${first.right}, viewport=${first.viewportWidth}`
        : `documentWidth=${dom.documentWidth}, viewportWidth=${dom.viewportWidth}`,
    );
  }

  if (dom && dom.imagesWithoutAlt > 0) {
    addFinding(
      findings,
      "info",
      "Images missing alt text",
      "Some images do not have alt text. This may be fine for decorative images, but product/screenshots/status images should usually be labeled.",
      `${dom.imagesWithoutAlt} image(s) without alt text.`,
    );
  }

  if (consoleErrors.length && !hydration) {
    addFinding(
      findings,
      "warning",
      "Console warnings/errors",
      "The browser console reported warnings or errors during inspection.",
      consoleErrors.map((entry) => `[${entry.type}] ${entry.text}`).slice(0, 6).join("\n\n").slice(0, 1200),
      stackSourceHint(consoleErrors.map((entry) => entry.text).join("\n")),
    );
  }

  if (!findings.length) {
    addFinding(
      findings,
      "info",
      "No obvious live-app issues found",
      "The page loaded without uncaught runtime errors, hydration warnings, failed requests, or obvious horizontal overflow in this inspection pass.",
      "Live inspection completed successfully.",
    );
  }

  return findings;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = (await request.json().catch(() => ({}))) as { url?: string; projectRoot?: string };
  const detectedApps = await detectLocalApps();
  const targetUrl = body.url?.trim() || detectedApps[0]?.url || "http://localhost:3000";

  if (!isValidLocalUrl(targetUrl)) {
    return NextResponse.json(
      {
        ok: false,
        inspectedAt: new Date().toISOString(),
        targetUrl,
        detectedApps,
        consoleMessages: [],
        pageErrors: [],
        network: [],
        findings: [],
        error: "Live Inspector only accepts localhost or 127.0.0.1 URLs.",
      } satisfies LiveAppInspectionResult,
      { status: 400 },
    );
  }

  try {
    const detectedProject = await resolveProjectForUrl(targetUrl, body.projectRoot?.trim());
    const importGraphRoot = detectedProject?.root || /* turbopackIgnore: true */ process.cwd();
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    const consoleMessages: LiveAppConsoleEntry[] = [];
    const pageErrors: string[] = [];
    const network: LiveAppNetworkEntry[] = [];
    const requestEntries = new Map<object, LiveAppNetworkEntry>();
    const responseCaptureTasks: Promise<void>[] = [];

    page.on("console", (message) => {
      const location = message.location();
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location: location.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : undefined,
      });
    });

    page.on("pageerror", (error) => {
      pageErrors.push(error.stack || error.message);
    });

    page.on("request", (browserRequest) => {
      const entry: LiveAppNetworkEntry = {
        url: browserRequest.url(),
        method: browserRequest.method(),
        resourceType: browserRequest.resourceType(),
        requestHeaders: browserRequest.headers(),
        requestBody: browserRequest.postData()?.slice(0, maxBodyCaptureChars),
      };
      requestEntries.set(browserRequest, entry);
      network.push(entry);
    });

    page.on("response", (response) => {
      const entry = requestEntries.get(response.request());
      if (!entry) return;
      entry.status = response.status();
      entry.statusText = response.statusText();
      entry.responseHeaders = response.headers();
      entry.responseMimeType = response.headers()["content-type"] || "";

      if (/json|text|javascript|html|xml|plain/i.test(entry.responseMimeType)) {
        responseCaptureTasks.push(
          response
            .text()
            .then((text) => {
              entry.responseBody = text.slice(0, maxBodyCaptureChars);
            })
            .catch(() => {
              entry.responseBody = "[Response body could not be read]";
            }),
        );
      }
    });

    page.on("requestfailed", (browserRequest) => {
      const entry = requestEntries.get(browserRequest);
      if (!entry) return;
      entry.failure = browserRequest.failure()?.errorText || "Request failed.";
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    await Promise.allSettled(responseCaptureTasks);

    const dom = await page.evaluate(() => {
      const root = document.documentElement;
      const elements = Array.from(document.querySelectorAll<HTMLElement>("body *"));
      const stableSelector = (element: HTMLElement) => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const testId = element.getAttribute("data-testid") || element.getAttribute("data-test");
        if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
        const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).slice(0, 3) : [];
        const classSelector = classes.length ? `.${classes.map((className) => CSS.escape(className)).join(".")}` : "";
        return `${element.tagName.toLowerCase()}${classSelector}`;
      };
      const overflowElements = elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const hasOwnOverflow = element.scrollWidth > element.clientWidth + 2;
          const sitsOutsideViewport = rect.right > window.innerWidth + 2 || rect.left < -2;

          if (!hasOwnOverflow && !sitsOutsideViewport) return null;

          return {
            tag: element.tagName.toLowerCase(),
            id: element.id || "",
            className: typeof element.className === "string" ? element.className.slice(0, 160) : "",
            text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            right: Math.round(rect.right),
            viewportWidth: window.innerWidth,
            position: style.position,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 30);
      const visualTargets = elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width < 24 || rect.height < 16) return null;
          const style = window.getComputedStyle(element);

          return {
            selector: stableSelector(element),
            tag: element.tagName.toLowerCase(),
            id: element.id || "",
            className: typeof element.className === "string" ? element.className.slice(0, 220) : "",
            text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
            role: element.getAttribute("role") || "",
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            styles: {
              color: style.color,
              backgroundColor: style.backgroundColor,
              fontSize: style.fontSize,
              display: style.display,
              position: style.position,
            },
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
        .slice(0, 40);

      return {
        title: document.title || "",
        url: window.location.href,
        bodyText: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 3000),
        documentWidth: root.scrollWidth,
        viewportWidth: window.innerWidth,
        horizontalOverflow: root.scrollWidth > window.innerWidth + 2,
        forms: Array.from(document.forms)
          .map((form) => ({
            id: form.id || "",
            action: form.action || "",
            method: form.method || "get",
            fields: form.querySelectorAll("input, select, textarea, button").length,
          }))
          .slice(0, 20),
        buttons: Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
          .map((button) => ({
            text: (button.innerText || button.getAttribute("aria-label") || "").trim().slice(0, 80),
            id: button.id || "",
            type: button.type || "",
          }))
          .slice(0, 60),
        links: Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .map((link) => ({
            text: (link.innerText || link.getAttribute("aria-label") || "").trim().slice(0, 80),
            href: link.href,
          }))
          .slice(0, 60),
        imagesWithoutAlt: Array.from(document.images).filter((image) => !image.alt).length,
        overflowElements,
        visualTargets,
      };
    });

    const screenshotBuffer = await page.screenshot({ fullPage: true, type: "png" });
    await browser.close();
    const findings = buildFindings(dom, consoleMessages, pageErrors, network);
    const importGraph = await buildImportGraph(importGraphRoot);

    const result: LiveAppInspectionResult = {
      ok: true,
      inspectedAt: new Date().toISOString(),
      targetUrl,
      detectedApps,
      durationMs: Date.now() - startedAt,
      screenshotBase64: screenshotBuffer.toString("base64"),
      detectedProject,
      dom,
      consoleMessages: consoleMessages.slice(-120),
      pageErrors: pageErrors.slice(-40),
      network: network.slice(-200),
      findings,
      rootCause: rootCauseFromEvidence(findings, consoleMessages, pageErrors, network, dom, importGraph),
    };

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const setup =
      /Executable doesn't exist|browserType.launch|playwright install/i.test(message)
        ? ["Run: npx.cmd playwright install chromium", "Then click Inspect Running App again."]
        : undefined;

    return NextResponse.json(
      {
        ok: false,
        inspectedAt: new Date().toISOString(),
        targetUrl,
        detectedApps,
        consoleMessages: [],
        pageErrors: [],
        network: [],
        findings: [],
        error: message,
        setup,
      } satisfies LiveAppInspectionResult,
      { status: 500 },
    );
  }
}
