import express from "express";
import cors from "cors";
import fg from "fast-glob";
import { watch, type FSWatcher } from "fs";
import fs from "fs/promises";
import path from "path";
import os from "os";
import net from "net";
import crypto from "crypto";
import { execFile, spawn } from "child_process";
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
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!err) {
    next();
    return;
  }

  res.status(400).json({
    ok: false,
    error: errorMessage(err),
  });
});

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
  issues: Array<{ severity: "error" | "warning" | "info"; message: string; line?: number; source?: "parser" | "compiler" | "lightweight" }>;
  analysis?: WatchAnalysis;
}> = [];
type WatchIssue = { severity: "error" | "warning" | "info"; message: string; line?: number; source?: "parser" | "compiler" | "lightweight" };
type WatchAnalysis = {
  title: string;
  confidence: number;
  risk: "low" | "medium" | "high";
  evidence: string[];
  probableCause: string;
  suggestedFix: string;
  validation: string[];
};

type BrowserChoice = "chrome" | "edge" | "firefox";
type SdkInspectionFile = {
  file: string;
  relative: string;
  size: number;
  mime: string;
  role: string;
  content?: string;
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

async function firstAccessiblePath(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next known install location.
    }
  }

  return "";
}

async function browserLaunchCommand(browser: BrowserChoice) {
  if (process.platform === "darwin") {
    const appName =
      browser === "chrome" ? "Google Chrome" : browser === "edge" ? "Microsoft Edge" : "Firefox";
    return { command: "open", args: ["-a", appName] };
  }

  if (process.platform === "win32") {
    const programFiles = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(
      Boolean,
    ) as string[];
    const candidates =
      browser === "chrome"
        ? [
            path.join(programFiles[0] || "", "Google", "Chrome", "Application", "chrome.exe"),
            path.join(programFiles[1] || "", "Google", "Chrome", "Application", "chrome.exe"),
            path.join(programFiles[2] || "", "Google", "Chrome", "Application", "chrome.exe"),
          ]
        : browser === "edge"
          ? [
              path.join(programFiles[0] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
              path.join(programFiles[1] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
              path.join(programFiles[2] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
            ]
          : [
              path.join(programFiles[0] || "", "Mozilla Firefox", "firefox.exe"),
              path.join(programFiles[1] || "", "Mozilla Firefox", "firefox.exe"),
              path.join(programFiles[2] || "", "Mozilla Firefox", "firefox.exe"),
            ];
    const command = await firstAccessiblePath(candidates);
    if (!command) {
      throw new Error(`Could not find ${browser} in the standard Windows install locations.`);
    }

    return { command, args: [] as string[] };
  }

  const command =
    browser === "chrome"
      ? "google-chrome"
      : browser === "edge"
        ? "microsoft-edge"
        : "firefox";
  return { command, args: [] as string[] };
}

async function openUrlInBrowser(rawUrl: string, browser: BrowserChoice) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs can be opened.");
  }

  const launch = await browserLaunchCommand(browser);
  const child = spawn(launch.command, [...launch.args, url.toString()], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  return {
    ok: true,
    browser,
    url: url.toString(),
    command: launch.command,
    processId: child.pid,
  };
}

async function pickFolderWithNativeDialog(title = "Select folder") {
  if (process.platform === "win32") {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = ${JSON.stringify(title)}
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`;
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      timeout: 120000,
      windowsHide: false,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  }

  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("osascript", ["-e", `POSIX path of (choose folder with prompt ${JSON.stringify(title)})`], {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  }

  try {
    const { stdout } = await execFileAsync("zenity", ["--file-selection", "--directory", "--title", title], {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    const { stdout } = await execFileAsync("kdialog", ["--getexistingdirectory", os.homedir(), "--title", title], {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  }
}

async function browseLocalFolders(rawPath?: string) {
  const home = os.homedir();
  const requestedPath = String(rawPath || "").trim();
  const currentPath = path.resolve(requestedPath || home);
  const stat = await fs.stat(currentPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("Folder does not exist or is not accessible.");

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const folders = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("$RECYCLE.BIN") && entry.name !== "System Volume Information")
      .slice(0, 500)
      .map(async (entry) => {
        const folderPath = path.join(currentPath, entry.name);
        const folderStat = await fs.stat(folderPath).catch(() => null);
        return {
          name: entry.name,
          path: folderPath,
          modifiedAt: folderStat?.mtime?.toISOString() || "",
        };
      })
  );

  const roots = [
    home,
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
    process.cwd(),
  ];

  return {
    ok: true,
    currentPath,
    parentPath: path.dirname(currentPath) !== currentPath ? path.dirname(currentPath) : "",
    roots: [...new Set(roots)].filter(Boolean),
    folders: folders.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function sdkFileRole(file: string) {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  if (/\.(aar|jar)$/i.test(file)) return "android-library";
  if (/\.apk$/i.test(file)) return "sample-apk";
  if (/\.aidl$/i.test(file)) return "aidl-interface";
  if (/(\breadme\b|setup|integration|guide|manual|docs?|sample|example).*\.(md|txt|pdf|html?)$/i.test(normalized)) return "documentation";
  if (/build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|pom\.xml|androidmanifest\.xml$/i.test(normalized)) return "build-config";
  if (/\.(kt|java|cs|xml|json|properties|gradle|md|txt|html?)$/i.test(file)) return "source-or-text";
  return "artifact";
}

function sdkInspectionScore(file: string) {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  let score = 0;
  if (/poslink|posdk|broadpos|paxstore|pax|android|a920|a80|aidl|intent|sample|demo|integration|setup|readme|guide|manual/.test(normalized)) {
    score += 20;
  }
  if (/\.(aar|jar|aidl|apk)$/i.test(file)) score += 18;
  if (/readme|setup|integration|guide|sample|example|androidmanifest|build\.gradle|settings\.gradle/i.test(normalized)) score += 14;
  if (/(^|\/)(docs?|samples?|examples?|libs?|aar|jar)(\/|$)/i.test(normalized)) score += 8;
  return score;
}

async function inspectSdkFolder(rawRoot: string) {
  const root = path.resolve(String(rawRoot || "").trim());
  if (!root) throw new Error("SDK folder path is required.");
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("SDK path must be an extracted folder, not a zip file.");

  const entries = await fg(["**/*"], {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/build/**", "**/dist/**", "**/.gradle/**"],
  });

  const scored = await Promise.all(
    entries.slice(0, 2500).map(async (file) => {
      const fileStat = await fs.stat(file);
      return {
        file,
        relative: path.relative(root, file),
        size: fileStat.size,
        mime: fileMime(file),
        role: sdkFileRole(file),
        score: sdkInspectionScore(file),
      };
    }),
  );

  const important = scored
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.relative.localeCompare(right.relative))
    .slice(0, 80);

  const readable = await Promise.all(
    important
      .filter((item) => /source-or-text|build-config|documentation|aidl-interface/.test(item.role) && item.size <= 220000 && !/\.pdf$/i.test(item.file))
      .slice(0, 24)
      .map(async (item): Promise<SdkInspectionFile> => {
        try {
          const content = await fs.readFile(item.file, "utf8");
          return {
            file: item.file,
            relative: item.relative,
            size: item.size,
            mime: item.mime,
            role: item.role,
            content: content.slice(0, 18000),
          };
        } catch {
          return {
            file: item.file,
            relative: item.relative,
            size: item.size,
            mime: item.mime,
            role: item.role,
          };
        }
      }),
  );

  return {
    ok: true,
    root,
    totalFiles: entries.length,
    importantFiles: important.map((item) => ({
      file: item.file,
      relative: item.relative,
      size: item.size,
      mime: item.mime,
      role: item.role,
    })),
    readableFiles: readable,
  };
}

async function findFilesUnderRoots(rawRoots: string[], extensions: string[], limit = 80) {
  const files: string[] = [];
  for (const rawRoot of rawRoots) {
    const root = path.resolve(String(rawRoot || "").trim());
    const stat = await fs.stat(root).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const matches = await fg(extensions.map((extension) => `**/*${extension}`), {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      dot: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/build/**", "**/.gradle/**"],
      suppressErrors: true,
    });
    files.push(...matches);
    if (files.length >= limit) break;
  }
  return [...new Set(files)].slice(0, limit);
}

function androidPackageFromManifest(content: string) {
  return content.match(/\bpackage\s*=\s*["']([^"']+)["']/i)?.[1] || "";
}

function androidNamespaceFromGradle(content: string) {
  return content.match(/\bnamespace\s*[= ]\s*["']([^"']+)["']/i)?.[1] || "";
}

async function detectAndroidProjectInfo() {
  if (!allowedRoot) throw new Error("No project folder selected.");
  const settingsFile =
    (await fileExists(path.join(allowedRoot, "settings.gradle.kts"))) ? path.join(allowedRoot, "settings.gradle.kts") :
    (await fileExists(path.join(allowedRoot, "settings.gradle"))) ? path.join(allowedRoot, "settings.gradle") : "";
  const appGradle =
    (await fileExists(path.join(allowedRoot, "app", "build.gradle.kts"))) ? path.join(allowedRoot, "app", "build.gradle.kts") :
    (await fileExists(path.join(allowedRoot, "app", "build.gradle"))) ? path.join(allowedRoot, "app", "build.gradle") : "";
  const manifest = path.join(allowedRoot, "app", "src", "main", "AndroidManifest.xml");
  const appGradleContent = appGradle ? await fs.readFile(appGradle, "utf8").catch(() => "") : "";
  const manifestContent = await fs.readFile(manifest, "utf8").catch(() => "");
  const namespace = androidNamespaceFromGradle(appGradleContent) || androidPackageFromManifest(manifestContent) || "com.payfix.paxregister";

  return {
    settingsFile,
    appGradle,
    manifest,
    namespace,
    packagePath: namespace.replace(/\./g, path.sep),
    kotlin: /\.(kts|kt)$/i.test(appGradle) || /kotlin|org\.jetbrains\.kotlin/i.test(appGradleContent),
    appGradleContent,
    manifestContent,
  };
}

function ensureAndroidGradleVendorDeps(content: string, isKts: boolean) {
  const fileTreeLine = isKts
    ? `implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.jar", "*.aar"))))`
    : `implementation fileTree(dir: 'libs', include: ['*.jar', '*.aar'])`;
  let next = content || "";
  if (!next.trim()) {
    next = isKts
      ? `plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "com.payfix.paxregister"\n    compileSdk = 35\n\n    defaultConfig {\n        applicationId = "com.payfix.paxregister"\n        minSdk = 23\n        targetSdk = 35\n        versionCode = 1\n        versionName = "1.0"\n    }\n}\n\ndependencies {\n}\n`
      : `plugins {\n    id 'com.android.application'\n}\n\nandroid {\n    namespace 'com.payfix.paxregister'\n    compileSdk 35\n\n    defaultConfig {\n        applicationId 'com.payfix.paxregister'\n        minSdk 23\n        targetSdk 35\n        versionCode 1\n        versionName '1.0'\n    }\n}\n\ndependencies {\n}\n`;
  }
  if (/fileTree\([\s\S]+libs[\s\S]+\*\.(jar|aar)/i.test(next)) return next;
  if (/dependencies\s*\{/i.test(next)) {
    return next.replace(/dependencies\s*\{/, (match) => `${match}\n    ${fileTreeLine}`);
  }
  return `${next.trim()}\n\ndependencies {\n    ${fileTreeLine}\n}\n`;
}

function paxMainActivitySource(packageName: string, kotlin: boolean) {
  if (kotlin) {
    return `package ${packageName}

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var status: TextView
    private val paymentBridge = PaymentServiceBridge()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "PAX Register"

        status = TextView(this).apply {
            text = "Ready for barcode checkout"
            textSize = 18f
            setPadding(24, 24, 24, 24)
        }

        val scanButton = Button(this).apply {
            text = "Start checkout"
            setOnClickListener { startCheckout() }
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
            addView(status)
            addView(scanButton)
        }

        setContentView(layout)
    }

    private fun startCheckout() {
        status.text = "Checkout started. Wire barcode scanner and POSLink payment call next."
        Toast.makeText(this, paymentBridge.describeIntegration(), Toast.LENGTH_LONG).show()
    }
}
`;
  }

  return `package ${packageName};

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private TextView status;
    private final PaymentServiceBridge paymentBridge = new PaymentServiceBridge();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("PAX Register");

        status = new TextView(this);
        status.setText("Ready for barcode checkout");
        status.setTextSize(18);
        status.setPadding(24, 24, 24, 24);

        Button scanButton = new Button(this);
        scanButton.setText("Start checkout");
        scanButton.setOnClickListener(v -> startCheckout());

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(24, 24, 24, 24);
        layout.addView(status);
        layout.addView(scanButton);
        setContentView(layout);
    }

    private void startCheckout() {
        status.setText("Checkout started. Wire barcode scanner and POSLink payment call next.");
        Toast.makeText(this, paymentBridge.describeIntegration(), Toast.LENGTH_LONG).show();
    }
}
`;
}

function paxPaymentBridgeSource(packageName: string, kotlin: boolean, copiedArtifacts: string[]) {
  const artifactList = copiedArtifacts.length ? copiedArtifacts.map((item) => `- ${path.basename(item)}`).join("\\n") : "No vendor libraries copied yet.";
  if (kotlin) {
    return `package ${packageName}

class PaymentServiceBridge {
    fun describeIntegration(): String {
        return "Vendor SDK artifacts detected:\\n${artifactList}\\nNext: replace this bridge with the POSLink/BroadPOS Intent or AIDL call from the vendor sample included in your SDK."
    }
}
`;
  }
  return `package ${packageName};

public class PaymentServiceBridge {
    public String describeIntegration() {
        return "Vendor SDK artifacts detected:\\n${artifactList}\\nNext: replace this bridge with the POSLink/BroadPOS Intent or AIDL call from the vendor sample included in your SDK.";
    }
}
`;
}

function ensurePaxMainActivityInManifest(content: string) {
  if (!content.trim()) {
    return `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.CAMERA" />\n    <application android:theme="@style/AppTheme" android:label="PAX Register">\n        <activity android:name=".MainActivity" android:exported="true">\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n        </activity>\n    </application>\n</manifest>\n`;
  }

  if (/android:name\s*=\s*["'](?:\.MainActivity|[^"']*\.MainActivity)["']/i.test(content)) return content;

  const activity = `\n        <activity android:name=".MainActivity" android:exported="true">\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n        </activity>`;

  if (/<application\b[^>]*>/i.test(content)) {
    return content.replace(/(<application\b[^>]*>)/i, `$1${activity}`);
  }

  return content.replace(
    /<\/manifest>/i,
    `    <application android:theme="@style/AppTheme" android:label="PAX Register">${activity}\n    </application>\n</manifest>`,
  );
}

async function buildPaxAndroidApp(rawSdkRoots: string[], prompt: string) {
  if (!allowedRoot) throw new Error("No project folder selected.");
  const info = await detectAndroidProjectInfo();
  if (!info.settingsFile && !info.appGradle) {
    throw new Error("Connected folder does not look like an Android/Gradle project. Select the Android Studio project root first.");
  }

  const libsDir = path.join(allowedRoot, "app", "libs");
  await fs.mkdir(libsDir, { recursive: true });
  const vendorArtifacts = await findFilesUnderRoots(rawSdkRoots, [".aar", ".jar"], 40);
  const copiedArtifacts: string[] = [];
  for (const artifact of vendorArtifacts) {
    const target = path.join(libsDir, path.basename(artifact));
    await fs.copyFile(artifact, target);
    copiedArtifacts.push(relativeProjectPath(target));
  }

  const sourceExt = info.kotlin ? "kt" : "java";
  const sourceRoot = path.join(allowedRoot, "app", "src", "main", info.kotlin ? "java" : "java", info.packagePath);
  await fs.mkdir(sourceRoot, { recursive: true });
  const mainActivity = path.join(sourceRoot, `MainActivity.${sourceExt}`);
  const bridge = path.join(sourceRoot, `PaymentServiceBridge.${sourceExt}`);
  await fs.writeFile(mainActivity, paxMainActivitySource(info.namespace, info.kotlin), "utf8");
  await fs.writeFile(bridge, paxPaymentBridgeSource(info.namespace, info.kotlin, copiedArtifacts), "utf8");

  if (info.appGradle) {
    const updatedGradle = ensureAndroidGradleVendorDeps(info.appGradleContent, info.appGradle.endsWith(".kts"));
    await fs.writeFile(info.appGradle, updatedGradle, "utf8");
  }

  const manifestContent = ensurePaxMainActivityInManifest(info.manifestContent);
  await fs.mkdir(path.dirname(info.manifest), { recursive: true });
  await fs.writeFile(info.manifest, manifestContent, "utf8");

  const filesChanged = [
    relativeProjectPath(mainActivity),
    relativeProjectPath(bridge),
    info.appGradle ? relativeProjectPath(info.appGradle) : "",
    relativeProjectPath(info.manifest),
    ...copiedArtifacts,
  ].filter(Boolean);

  return {
    ok: true,
    prompt,
    projectRoot: allowedRoot,
    namespace: info.namespace,
    kotlin: info.kotlin,
    copiedArtifacts,
    filesChanged,
    nextSteps: [
      "Open the project in Android Studio.",
      "Sync Gradle.",
      "Build the app module.",
      "Run on a PAX A-series device.",
      "Replace PaymentServiceBridge with the exact POSLink/BroadPOS Intent or AIDL call from the copied vendor sample/docs.",
    ],
  };
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

async function forceRemoveDirectoryFromDisk(root: string) {
  if (process.platform !== "win32") {
    await fs.rm(root, { recursive: true, force: true });
    return;
  }

  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$TargetPath = $env:PAYFIX_DELETE_TARGET; if ([string]::IsNullOrWhiteSpace($TargetPath)) { throw 'PAYFIX_DELETE_TARGET was empty.' }; Remove-Item -LiteralPath $TargetPath -Recurse -Force -ErrorAction Stop",
      ],
      { env: { ...process.env, PAYFIX_DELETE_TARGET: root }, windowsHide: true, timeout: 15000 },
    );
  } catch (err: unknown) {
    const details = [
      errorMessage(err),
      typeof (err as { stderr?: unknown }).stderr === "string" ? (err as { stderr: string }).stderr.trim() : "",
      typeof (err as { stdout?: unknown }).stdout === "string" ? (err as { stdout: string }).stdout.trim() : "",
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(details || "PowerShell Remove-Item failed.");
  }
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
            source: "lightweight",
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
        source: "lightweight",
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
        source: "lightweight",
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

async function diagnoseNodeSyntax(file: string): Promise<WatchIssue[]> {
  try {
    await execFileAsync(process.execPath, ["--check", file], {
      cwd: path.dirname(file),
      timeout: 10000,
      windowsHide: true,
    });
    return [];
  } catch (error: unknown) {
    const output =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr || "")
        : error instanceof Error
          ? error.message
          : "Node syntax check failed.";
    const lineMatch = output.match(/:(\d+)(?::\d+)?\)?\s*$/m) || output.match(/\n\s*(\d+)\s*\|/);
    const message =
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /SyntaxError|Unexpected|missing|Invalid/i.test(line)) || "Node reported a JavaScript syntax error.";

    return [
      {
        severity: "error",
        line: lineMatch ? Number(lineMatch[1]) : undefined,
        message,
        source: "parser",
      },
    ];
  }
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
      source: "lightweight",
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
      if (count > 1) issues.push({ severity: "error", message: `Duplicate id "${id}" appears ${count} times.`, source: "lightweight" });
    }

    const appearsToBeFullHtmlDocument = /<html[\s>]/i.test(content) || /<body[\s>]/i.test(content) || /<!doctype/i.test(content);

    if (appearsToBeFullHtmlDocument && !/<!doctype\s+html>/i.test(content)) {
      issues.push({ severity: "warning", message: "Missing <!DOCTYPE html>.", source: "lightweight" });
    }
    if (appearsToBeFullHtmlDocument && !/<html[\s>]/i.test(content)) {
      issues.push({ severity: "warning", message: "Missing <html> element.", source: "lightweight" });
    }
    if (appearsToBeFullHtmlDocument && !/<body[\s>]/i.test(content)) {
      issues.push({ severity: "warning", message: "Missing <body> element.", source: "lightweight" });
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
          source: "lightweight",
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
        issues.push({ severity: "error", message: `Possible tag mismatch: expected </${last || "none"}> but found </${tag}>.`, source: "lightweight" });
        break;
      }
    }
    if (stack.length) {
      issues.push({ severity: "error", message: `Possible unclosed tag: <${stack[stack.length - 1]}>.`, source: "lightweight" });
    }

    for (const match of content.matchAll(/<link[^>]+href=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gi)) {
      const href = match[1].replace(/\?.*$/, "");
      if (/^(https?:)?\/\//i.test(href) || href.startsWith("/") || href.startsWith("#")) continue;
      const cssPath = path.resolve(path.dirname(file), href);
      if (!(await fileExists(cssPath))) {
        issues.push({ severity: "error", message: `Linked stylesheet was not found: ${href}.`, source: "lightweight" });
      }
    }
  }

  if (extension === ".css") {
    const openCount = (content.match(/\{/g) || []).length;
    const closeCount = (content.match(/\}/g) || []).length;
    if (openCount !== closeCount) {
      issues.push({ severity: "error", message: `CSS brace mismatch: ${openCount} "{" and ${closeCount} "}".`, source: "lightweight" });
    }
  }

  if ([".js", ".cjs", ".mjs"].includes(extension)) {
    issues.push(...(await diagnoseNodeSyntax(file)));
  }

  if ([".ts", ".tsx", ".jsx", ".cs", ".java", ".php", ".go", ".rs", ".cpp", ".c", ".h"].includes(extension)) {
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
    source?: "parser" | "compiler" | "lightweight";
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
        source: issue.source || "lightweight",
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
  if (/(^|\/)(agents?|ai|copilot|assistant)(\/|$)|server\.(ts|js)/i.test(relative)) return "agent";
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

async function findLocalJavaHome() {
  const candidates = [
    process.env.JAVA_HOME || "",
    "C:\\Program Files\\Android\\Android Studio\\jbr",
    "C:\\Program Files\\Android\\Android Studio\\jre",
    "C:\\Program Files\\Java\\jdk-21",
    "C:\\Program Files\\Java\\jdk-17",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const javaExe = process.platform === "win32"
      ? path.join(candidate, "bin", "java.exe")
      : path.join(candidate, "bin", "java");
    if (await fileExists(javaExe)) return candidate;
  }

  if (process.platform === "win32") {
    const discovered = await fg(
      ["Android/Android Studio*/jbr/bin/java.exe", "Android/Android Studio*/jre/bin/java.exe", "Java/jdk*/bin/java.exe"],
      {
        cwd: "C:/Program Files",
        absolute: true,
        onlyFiles: true,
        suppressErrors: true,
        deep: 5,
      },
    );
    const javaExe = discovered[0];
    if (javaExe) return path.dirname(path.dirname(javaExe));
  }

  return "";
}

async function runProjectCommand(command: string, args: string[]) {
  const displayCommand = [command, ...args]
    .map((part) => (/[\s"]/g.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part))
    .join(" ");
  const needsWindowsCommandShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const env = { ...process.env };
  const isGradleCommand = /(?:^|[\\/])gradlew(?:\.bat)?$/i.test(command) || /(?:^|[\\/])gradle(?:\.cmd)?$/i.test(command) || /^gradle(?:\.cmd)?$/i.test(command);
  if (isGradleCommand && !env.JAVA_HOME) {
    const javaHome = await findLocalJavaHome();
    if (javaHome) {
      env.JAVA_HOME = javaHome;
      env.PATH = `${path.join(javaHome, "bin")}${path.delimiter}${env.PATH || ""}`;
    }
  }
  const environmentNote = isGradleCommand && env.JAVA_HOME ? `PayFix using JAVA_HOME=${env.JAVA_HOME}` : "";

  try {
    const result = await execFileAsync(command, args, {
      cwd: allowedRoot,
      timeout: 45000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      shell: needsWindowsCommandShell,
      env,
    });

    return {
      ok: true,
      command: displayCommand,
      output: `${environmentNote ? `${environmentNote}\n` : ""}${result.stdout || ""}${result.stderr || ""}`.trim(),
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
      output: `${environmentNote ? `${environmentNote}\n` : ""}${maybe.stdout || ""}${maybe.stderr || ""}${maybe.message || ""}`.trim(),
    };
  }
}

async function commandExists(command: string) {
  if (path.isAbsolute(command)) {
    return fileExists(command);
  }

  if (/^java(?:\.exe)?$/i.test(command) || /^javac(?:\.exe)?$/i.test(command)) {
    const javaHome = await findLocalJavaHome();
    const exeName = /^javac/i.test(command) ? (process.platform === "win32" ? "javac.exe" : "javac") : (process.platform === "win32" ? "java.exe" : "java");
    if (javaHome && (await fileExists(path.join(javaHome, "bin", exeName)))) return true;
  }

  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  const lookupName = command.replace(/\.(cmd|bat|exe)$/i, "");

  try {
    await execFileAsync(lookupCommand, [lookupName], {
      cwd: allowedRoot || process.cwd(),
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 1024 * 64,
    });
    return true;
  } catch {
    return false;
  }
}

async function commandVersion(command: string, args = ["--version"]) {
  if (!(await commandExists(command))) return "";

  try {
    let executable = command;
    const env = { ...process.env };
    if (/^java(?:\.exe)?$/i.test(command) || /^javac(?:\.exe)?$/i.test(command)) {
      const javaHome = await findLocalJavaHome();
      const exeName = /^javac/i.test(command) ? (process.platform === "win32" ? "javac.exe" : "javac") : (process.platform === "win32" ? "java.exe" : "java");
      if (javaHome) {
        executable = path.join(javaHome, "bin", exeName);
        env.JAVA_HOME = javaHome;
        env.PATH = `${path.join(javaHome, "bin")}${path.delimiter}${env.PATH || ""}`;
      }
    }
    const result = await execFileAsync(executable, args, {
      cwd: allowedRoot || process.cwd(),
      timeout: 6000,
      windowsHide: true,
      maxBuffer: 1024 * 64,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(executable),
      env,
    });

    return `${result.stdout || ""}${result.stderr || ""}`.trim().split(/\r?\n/)[0] || "available";
  } catch {
    return "available";
  }
}

async function runProjectCommandIfAvailable(
  command: string,
  args: string[],
  skipped: string[],
  label: string
) {
  if (!(await commandExists(command))) {
    skipped.push(`${label} skipped: ${command} was not found on PATH.`);
    return null;
  }

  return runProjectCommand(command, args);
}

function splitSimpleProjectCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed || /[;&|<>]/.test(trimmed)) return null;
  const parts = trimmed.match(/"[^"]+"|'[^']+'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) || [];
  return parts.length ? parts : null;
}

async function readPayfixPyprojectCommand(name: "start" | "check") {
  const pyprojectPath = path.join(allowedRoot, "pyproject.toml");
  if (!(await fileExists(pyprojectPath))) return "";

  const content = await fs.readFile(pyprojectPath, "utf8");
  return content.match(new RegExp(`^\\s*${name}\\s*=\\s*["']([^"']+)["']`, "m"))?.[1] || "";
}

async function hasPythonProject() {
  if (
    (await fileExists(path.join(allowedRoot, "pyproject.toml"))) ||
    (await fileExists(path.join(allowedRoot, "requirements.txt"))) ||
    (await fileExists(path.join(allowedRoot, "setup.py")))
  ) {
    return true;
  }

  const files = await fg(["**/*.py", ...projectIgnoreGlobs], {
    cwd: allowedRoot,
    absolute: false,
    onlyFiles: true,
    suppressErrors: true,
  });
  return files.length > 0;
}

async function runPythonProjectChecks(
  checks: string[],
  commands: Awaited<ReturnType<typeof runProjectCommand>>[],
  skipped: string[],
) {
  if (!(await hasPythonProject())) return;

  const pythonCommand = process.platform === "win32" ? "python.exe" : "python";

  if (checks.includes("check") || checks.includes("python")) {
    const compile = await runProjectCommandIfAvailable(
      pythonCommand,
      ["-m", "compileall", "-q", "."],
      skipped,
      "Python compile check",
    );
    if (compile) commands.push(compile);

    const configuredCheck = await readPayfixPyprojectCommand("check");
    const smokeCheck = await fileExists(path.join(allowedRoot, "scripts", "smoke_check.py"))
      ? "python scripts/smoke_check.py"
      : "";
    const checkCommand = configuredCheck || smokeCheck;
    const parts = checkCommand ? splitSimpleProjectCommand(checkCommand) : null;
    if (parts) {
      const [command, ...args] = parts;
      const runnable = /^python(?:\.exe|3)?$/i.test(command) ? pythonCommand : command;
      const result = await runProjectCommandIfAvailable(runnable, args, skipped, "Python project check");
      if (result) commands.push(result);
    } else if (checkCommand) {
      skipped.push("Python project check skipped: check command uses shell syntax PayFix will not run automatically.");
    } else {
      skipped.push("Python project check skipped: no [tool.payfix] check command or scripts/smoke_check.py found.");
    }
  }

  if (checks.includes("test")) {
    const hasTests = (await fg(["tests/**/*.py", "test_*.py", ...projectIgnoreGlobs], {
      cwd: allowedRoot,
      absolute: false,
      onlyFiles: true,
      suppressErrors: true,
    })).length > 0;
    if (hasTests) {
      const pytest = await runProjectCommandIfAvailable(pythonCommand, ["-m", "pytest"], skipped, "Python tests");
      if (pytest) commands.push(pytest);
    } else {
      skipped.push("Python tests skipped: no obvious Python tests found.");
    }
  }

  if (checks.includes("lint")) {
    const ruff = await runProjectCommandIfAvailable("ruff", ["check", "."], skipped, "Python linting");
    if (ruff) commands.push(ruff);
  }
}

async function runCrossLanguageProjectChecks(
  checks: string[],
  commands: Awaited<ReturnType<typeof runProjectCommand>>[],
  skipped: string[],
) {
  if (await fileExists(path.join(allowedRoot, "go.mod"))) {
    if (checks.includes("test") || checks.includes("check") || checks.includes("go")) {
      const goTest = await runProjectCommandIfAvailable("go", ["test", "./..."], skipped, "Go tests");
      if (goTest) commands.push(goTest);
    }
    if (checks.includes("lint") || checks.includes("go")) {
      const goVet = await runProjectCommandIfAvailable("go", ["vet", "./..."], skipped, "Go vet");
      if (goVet) commands.push(goVet);
    }
  }

  if (await fileExists(path.join(allowedRoot, "Cargo.toml"))) {
    if (checks.includes("check") || checks.includes("build") || checks.includes("rust")) {
      const cargoCheck = await runProjectCommandIfAvailable("cargo", ["check"], skipped, "Rust check");
      if (cargoCheck) commands.push(cargoCheck);
    }
    if (checks.includes("test") || checks.includes("rust")) {
      const cargoTest = await runProjectCommandIfAvailable("cargo", ["test"], skipped, "Rust tests");
      if (cargoTest) commands.push(cargoTest);
    }
    if (checks.includes("lint") || checks.includes("rust")) {
      const clippy = await runProjectCommandIfAvailable("cargo", ["clippy", "--", "-D", "warnings"], skipped, "Rust Clippy");
      if (clippy) commands.push(clippy);
    }
  }

  if (await fileExists(path.join(allowedRoot, "pom.xml"))) {
    const mvn = windowsCommand("mvn");
    if (checks.includes("build") || checks.includes("check") || checks.includes("java")) {
      const compile = await runProjectCommandIfAvailable(mvn, ["-q", "-DskipTests", "compile"], skipped, "Maven compile");
      if (compile) commands.push(compile);
    }
    if (checks.includes("test") || checks.includes("java")) {
      const test = await runProjectCommandIfAvailable(mvn, ["-q", "test"], skipped, "Maven tests");
      if (test) commands.push(test);
    }
  } else if (
    (await fileExists(path.join(allowedRoot, "build.gradle"))) ||
    (await fileExists(path.join(allowedRoot, "build.gradle.kts"))) ||
    (await fileExists(path.join(allowedRoot, "settings.gradle"))) ||
    (await fileExists(path.join(allowedRoot, "settings.gradle.kts"))) ||
    (await fileExists(path.join(allowedRoot, "app", "build.gradle"))) ||
    (await fileExists(path.join(allowedRoot, "app", "build.gradle.kts")))
  ) {
    const gradle = await findGradleCommand();
    if (checks.includes("build") || checks.includes("check") || checks.includes("java")) {
      const build = await runProjectCommandIfAvailable(gradle, ["build"], skipped, "Gradle build");
      if (build) commands.push(build);
    }
    if (checks.includes("test") || checks.includes("java")) {
      const test = await runProjectCommandIfAvailable(gradle, ["test"], skipped, "Gradle tests");
      if (test) commands.push(test);
    }
  }

  if (await fileExists(path.join(allowedRoot, "composer.json"))) {
    if (checks.includes("check") || checks.includes("php")) {
      const validate = await runProjectCommandIfAvailable("composer", ["validate", "--no-check-publish"], skipped, "Composer validate");
      if (validate) commands.push(validate);
    }
    if (checks.includes("test") || checks.includes("php")) {
      const test = await runProjectCommandIfAvailable("composer", ["test"], skipped, "Composer tests");
      if (test) commands.push(test);
    }
  }

  if (await fileExists(path.join(allowedRoot, "Gemfile"))) {
    if (checks.includes("test") || checks.includes("ruby")) {
      const test = await runProjectCommandIfAvailable("bundle", ["exec", "rake", "test"], skipped, "Ruby tests");
      if (test) commands.push(test);
    }
    if (checks.includes("lint") || checks.includes("ruby")) {
      const rubocop = await runProjectCommandIfAvailable("bundle", ["exec", "rubocop"], skipped, "Ruby RuboCop");
      if (rubocop) commands.push(rubocop);
    }
  }

  if (await fileExists(path.join(allowedRoot, "pubspec.yaml"))) {
    const runner = await commandExists("flutter") ? "flutter" : "dart";
    if (checks.includes("lint") || checks.includes("check") || checks.includes("dart")) {
      const analyze = await runProjectCommandIfAvailable(runner, ["analyze"], skipped, "Dart/Flutter analyze");
      if (analyze) commands.push(analyze);
    }
    if (checks.includes("test") || checks.includes("dart")) {
      const test = await runProjectCommandIfAvailable(runner, ["test"], skipped, "Dart/Flutter tests");
      if (test) commands.push(test);
    }
  }

  if (await fileExists(path.join(allowedRoot, "Package.swift"))) {
    if (checks.includes("build") || checks.includes("check") || checks.includes("swift")) {
      const build = await runProjectCommandIfAvailable("swift", ["build"], skipped, "Swift build");
      if (build) commands.push(build);
    }
    if (checks.includes("test") || checks.includes("swift")) {
      const test = await runProjectCommandIfAvailable("swift", ["test"], skipped, "Swift tests");
      if (test) commands.push(test);
    }
  }
}

function windowsCommand(command: string) {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

async function findGradleCommand() {
  const localGradle = process.platform === "win32"
    ? path.join(allowedRoot, "gradlew.bat")
    : path.join(allowedRoot, "gradlew");
  if (await fileExists(localGradle)) return localGradle;
  return windowsCommand("gradle");
}

async function addLanguageValidationCommands(
  file: string,
  commands: Awaited<ReturnType<typeof runProjectCommand>>[],
  skipped: string[]
) {
  const relativeFile = path.relative(allowedRoot, file);
  const ext = path.extname(file).toLowerCase();
  const hasPackageJson = await fileExists(path.join(allowedRoot, "package.json"));
  const hasTsConfig = await fileExists(path.join(allowedRoot, "tsconfig.json"));
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

  if (hasPackageJson && hasTsConfig && /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|htm)$/i.test(file)) {
    commands.push(await runProjectCommand(npxCommand, ["tsc", "--noEmit"]));
  } else if (/\.(ts|tsx)$/i.test(file)) {
    skipped.push("TypeScript type check skipped: package.json or tsconfig.json was not found.");
  }

  if (/\.(js|mjs|cjs)$/i.test(file)) {
    commands.push(await runProjectCommand(process.execPath, ["--check", relativeFile]));
  }

  if (hasPackageJson && /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) {
    commands.push(await runProjectCommand(npxCommand, ["eslint", relativeFile]));
  }

  const dotnetTarget = await findDotnetTarget();
  if (dotnetTarget && /\.(cs|csproj|config|json|xml)$/i.test(file)) {
    commands.push(await runProjectCommand("dotnet", ["build", dotnetTarget, "--nologo"]));
  } else if (/\.(cs|csproj)$/i.test(file)) {
    skipped.push("C# build skipped: no .sln or .csproj file found.");
  }

  if (ext === ".py") {
    const pyCompile = await runProjectCommandIfAvailable("python", ["-m", "py_compile", relativeFile], skipped, "Python syntax check");
    if (pyCompile) commands.push(pyCompile);
    const mypy = await runProjectCommandIfAvailable("mypy", [relativeFile], skipped, "Python type checking");
    if (mypy) commands.push(mypy);
    const ruff = await runProjectCommandIfAvailable("ruff", ["check", relativeFile], skipped, "Python linting");
    if (ruff) commands.push(ruff);
  }

  if (ext === ".go") {
    const goMod = await fileExists(path.join(allowedRoot, "go.mod"));
    const goCheckArgs = goMod ? ["test", "./..."] : ["test", relativeFile];
    const goTest = await runProjectCommandIfAvailable("go", goCheckArgs, skipped, "Go build/test");
    if (goTest) commands.push(goTest);
    if (goMod) {
      const goVet = await runProjectCommandIfAvailable("go", ["vet", "./..."], skipped, "Go vet");
      if (goVet) commands.push(goVet);
    }
  }

  if (ext === ".rs") {
    const cargoToml = await fileExists(path.join(allowedRoot, "Cargo.toml"));
    if (cargoToml) {
      const cargoCheck = await runProjectCommandIfAvailable("cargo", ["check"], skipped, "Rust check");
      if (cargoCheck) commands.push(cargoCheck);
      const clippy = await runProjectCommandIfAvailable("cargo", ["clippy", "--", "-D", "warnings"], skipped, "Rust Clippy");
      if (clippy) commands.push(clippy);
    } else {
      skipped.push("Rust check skipped: Cargo.toml was not found.");
    }
  }

  if (ext === ".java" || ext === ".kt" || ext === ".kts" || /gradle$/i.test(file)) {
    const gradleCommand = await findGradleCommand();
    if (await fileExists(path.join(allowedRoot, "pom.xml"))) {
      const mvn = await runProjectCommandIfAvailable(windowsCommand("mvn"), ["-q", "-DskipTests", "compile"], skipped, "Java compile");
      if (mvn) commands.push(mvn);
    } else if (await fileExists(path.join(allowedRoot, "build.gradle")) || await fileExists(path.join(allowedRoot, "build.gradle.kts"))) {
      const gradleBuild = await runProjectCommandIfAvailable(gradleCommand, ["build"], skipped, "Java/Kotlin build");
      if (gradleBuild) commands.push(gradleBuild);
    } else if (ext === ".java") {
      const javac = await runProjectCommandIfAvailable("javac", [relativeFile], skipped, "Java compile");
      if (javac) commands.push(javac);
    } else {
      skipped.push("Kotlin/Java build skipped: no Gradle, Maven, or javac validation target was found.");
    }
  }

  if ([".c", ".cc", ".cpp", ".cxx", ".m", ".mm"].includes(ext)) {
    const compiler = ext === ".cpp" || ext === ".cc" || ext === ".cxx" ? "g++" : "clang";
    const compile = await runProjectCommandIfAvailable(compiler, ["-fsyntax-only", relativeFile], skipped, "C/C++/Objective-C syntax check");
    if (compile) commands.push(compile);
  }

  if (ext === ".php" || ext === ".phtml") {
    const php = await runProjectCommandIfAvailable("php", ["-l", relativeFile], skipped, "PHP lint");
    if (php) commands.push(php);
  }

  if (ext === ".rb") {
    const ruby = await runProjectCommandIfAvailable("ruby", ["-c", relativeFile], skipped, "Ruby syntax check");
    if (ruby) commands.push(ruby);
    const rubocop = await runProjectCommandIfAvailable("rubocop", [relativeFile], skipped, "Ruby static analysis");
    if (rubocop) commands.push(rubocop);
  }

  if (ext === ".dart") {
    const analyzer = await commandExists("flutter") ? "flutter" : "dart";
    const args = analyzer === "flutter" ? ["analyze"] : ["analyze"];
    const dart = await runProjectCommandIfAvailable(analyzer, args, skipped, "Dart/Flutter analyze");
    if (dart) commands.push(dart);
  }

  if (ext === ".swift") {
    if (await fileExists(path.join(allowedRoot, "Package.swift"))) {
      const swift = await runProjectCommandIfAvailable("swift", ["build"], skipped, "Swift build");
      if (swift) commands.push(swift);
    } else {
      skipped.push("Swift build skipped: Package.swift was not found.");
    }
  }

  if (ext === ".scala") {
    if (await fileExists(path.join(allowedRoot, "build.sbt"))) {
      const sbt = await runProjectCommandIfAvailable(process.platform === "win32" ? "sbt.bat" : "sbt", ["compile"], skipped, "Scala compile");
      if (sbt) commands.push(sbt);
    } else {
      skipped.push("Scala compile skipped: build.sbt was not found.");
    }
  }

  if (ext === ".ex" || ext === ".exs") {
    if (await fileExists(path.join(allowedRoot, "mix.exs"))) {
      const mixCompile = await runProjectCommandIfAvailable(process.platform === "win32" ? "mix.bat" : "mix", ["compile"], skipped, "Elixir compile");
      if (mixCompile) commands.push(mixCompile);
      const mixDialyzer = await runProjectCommandIfAvailable(process.platform === "win32" ? "mix.bat" : "mix", ["dialyzer"], skipped, "Elixir Dialyzer");
      if (mixDialyzer) commands.push(mixDialyzer);
    } else {
      skipped.push("Elixir compile skipped: mix.exs was not found.");
    }
  }

  if (ext === ".hs" || ext === ".lhs") {
    if (await fileExists(path.join(allowedRoot, "stack.yaml"))) {
      const stack = await runProjectCommandIfAvailable("stack", ["build"], skipped, "Haskell stack build");
      if (stack) commands.push(stack);
    } else {
      const cabal = await runProjectCommandIfAvailable("cabal", ["build"], skipped, "Haskell cabal build");
      if (cabal) commands.push(cabal);
    }
  }

  if (ext === ".lua") {
    const lua = await runProjectCommandIfAvailable("luac", ["-p", relativeFile], skipped, "Lua linting");
    if (lua) commands.push(lua);
  }

  if (ext === ".pl" || ext === ".pm" || ext === ".t") {
    const perl = await runProjectCommandIfAvailable("perl", ["-c", relativeFile], skipped, "Perl syntax check");
    if (perl) commands.push(perl);
  }

  if (ext === ".r") {
    const r = await runProjectCommandIfAvailable("Rscript", ["-e", `parse(file='${relativeFile.replace(/\\/g, "/").replace(/'/g, "\\'")}')`], skipped, "R parse check");
    if (r) commands.push(r);
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

type ToolchainItem = {
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

async function projectToolchainDoctor() {
  if (!allowedRoot) throw new Error("No project folder selected.");

  const files = (await listAllProjectFiles()).map((file) => relativeProjectPath(file).replace(/\\/g, "/"));
  const has = (pattern: RegExp) => files.some((file) => pattern.test(file));
  const packageJson = await readPackageJsonSafe();
  const packageScripts = ((packageJson?.scripts as Record<string, string>) || {});
  const hasPackageJson = Boolean(packageJson);
  const toolchains: Array<{
    id: string;
    label: string;
    detected: boolean;
    commands: string[];
    versionCommand?: string;
    versionArgs?: string[];
    installHint: string;
    installCommand?: string;
    installUrl?: string;
  }> = [
    {
      id: "node",
      label: "Node.js / JavaScript / TypeScript",
      detected: hasPackageJson || has(/\.(js|jsx|ts|tsx|mjs|cjs)$/i),
      commands: ["node", "npm"],
      versionCommand: "node",
      installHint: "Install Node.js LTS. PayFix uses node/npm/npx for JS and TS validation.",
      installCommand: "winget install OpenJS.NodeJS.LTS",
      installUrl: "https://nodejs.org/",
    },
    {
      id: "python",
      label: "Python",
      detected: has(/(^|\/)(pyproject\.toml|requirements\.txt|setup\.py|Pipfile)$/i) || has(/\.py$/i),
      commands: ["python"],
      versionCommand: "python",
      installHint: "Install Python and add it to PATH. Optional validators: ruff and mypy.",
      installCommand: "winget install Python.Python.3.13",
      installUrl: "https://www.python.org/downloads/",
    },
    {
      id: "dotnet",
      label: ".NET / C#",
      detected: has(/\.(sln|csproj|cs)$/i),
      commands: ["dotnet"],
      versionCommand: "dotnet",
      installHint: "Install the .NET SDK so PayFix can run dotnet build/test.",
      installCommand: "winget install Microsoft.DotNet.SDK.9",
      installUrl: "https://dotnet.microsoft.com/download",
    },
    {
      id: "go",
      label: "Go",
      detected: has(/(^|\/)go\.mod$/i) || has(/\.go$/i),
      commands: ["go"],
      versionCommand: "go",
      versionArgs: ["version"],
      installHint: "Install Go so PayFix can run go test and go vet.",
      installCommand: "winget install GoLang.Go",
      installUrl: "https://go.dev/dl/",
    },
    {
      id: "rust",
      label: "Rust",
      detected: has(/(^|\/)Cargo\.toml$/i) || has(/\.rs$/i),
      commands: ["cargo", "rustc"],
      versionCommand: "rustc",
      installHint: "Install Rust via rustup so PayFix can run cargo check and clippy.",
      installCommand: "winget install Rustlang.Rustup",
      installUrl: "https://rustup.rs/",
    },
    {
      id: "java",
      label: "Java / Kotlin",
      detected: has(/(^|\/)(pom\.xml|build\.gradle|build\.gradle\.kts)$/i) || has(/\.(java|kt|kts)$/i),
      commands: ["java", "javac"],
      versionCommand: "java",
      installHint: "Install a JDK. Maven or Gradle are also needed if the project uses pom.xml or build.gradle.",
      installCommand: "winget install EclipseAdoptium.Temurin.21.JDK",
      installUrl: "https://adoptium.net/",
    },
    {
      id: "php",
      label: "PHP",
      detected: has(/(^|\/)composer\.json$/i) || has(/\.(php|phtml)$/i),
      commands: ["php"],
      versionCommand: "php",
      installHint: "Install PHP. Install Composer too for composer.json projects.",
      installCommand: "winget install PHP.PHP",
      installUrl: "https://www.php.net/downloads.php",
    },
    {
      id: "ruby",
      label: "Ruby",
      detected: has(/(^|\/)(Gemfile|\.ruby-version)$/i) || has(/\.(rb|rake)$/i),
      commands: ["ruby"],
      versionCommand: "ruby",
      installHint: "Install Ruby. Bundler is needed for Gemfile projects.",
      installCommand: "winget install RubyInstallerTeam.RubyWithDevKit.3.3",
      installUrl: "https://rubyinstaller.org/",
    },
    {
      id: "cpp",
      label: "C / C++ / Objective-C",
      detected: has(/\.(c|cc|cpp|cxx|h|hpp|m|mm)$/i),
      commands: ["clang"],
      versionCommand: "clang",
      installHint: "Install LLVM/Clang or Visual Studio Build Tools so PayFix can run syntax checks.",
      installCommand: "winget install LLVM.LLVM",
      installUrl: "https://visualstudio.microsoft.com/visual-cpp-build-tools/",
    },
    {
      id: "dart",
      label: "Dart / Flutter",
      detected: has(/(^|\/)pubspec\.yaml$/i) || has(/\.dart$/i),
      commands: ["dart"],
      versionCommand: "dart",
      installHint: "Install Dart or Flutter so PayFix can run analyze.",
      installCommand: "winget install Dart.Dart",
      installUrl: "https://dart.dev/get-dart",
    },
  ];

  const detected = toolchains.filter((toolchain) => toolchain.detected);
  const items: ToolchainItem[] = [];

  for (const toolchain of detected) {
    const commandStatuses = await Promise.all(toolchain.commands.map(async (command) => ({
      command,
      available: await commandExists(command),
    })));
    const availableCommands = commandStatuses.filter((item) => item.available).map((item) => item.command);
    const missingCommands = commandStatuses.filter((item) => !item.available).map((item) => item.command);
    const version = toolchain.versionCommand && availableCommands.includes(toolchain.versionCommand)
      ? await commandVersion(toolchain.versionCommand, toolchain.versionArgs || ["--version"])
      : "";

    items.push({
      id: toolchain.id,
      label: toolchain.label,
      detected: true,
      available: missingCommands.length === 0,
      requiredCommands: toolchain.commands,
      availableCommands,
      missingCommands,
      version,
      installHint: toolchain.installHint,
      installCommand: toolchain.installCommand,
      installUrl: toolchain.installUrl,
    });
  }

  if (has(/(^|\/)pom\.xml$/i)) {
    const available = await commandExists(windowsCommand("mvn"));
    items.push({
      id: "maven",
      label: "Maven",
      detected: true,
      available,
      requiredCommands: ["mvn"],
      availableCommands: available ? ["mvn"] : [],
      missingCommands: available ? [] : ["mvn"],
      version: available ? await commandVersion(windowsCommand("mvn"), ["-version"]) : "",
      installHint: "Install Maven so PayFix can compile Maven Java projects.",
      installCommand: "winget install Apache.Maven",
      installUrl: "https://maven.apache.org/install.html",
    });
  }

  if (has(/(^|\/)build\.gradle(\.kts)?$/i)) {
    const localGradle = process.platform === "win32" ? "gradlew.bat" : "gradlew";
    const hasWrapper = await fileExists(path.join(allowedRoot, localGradle));
    const available = hasWrapper || await commandExists(windowsCommand("gradle"));
    items.push({
      id: "gradle",
      label: "Gradle",
      detected: true,
      available,
      requiredCommands: hasWrapper ? [localGradle] : ["gradle"],
      availableCommands: available ? [hasWrapper ? localGradle : "gradle"] : [],
      missingCommands: available ? [] : ["gradle"],
      version: available && !hasWrapper ? await commandVersion(windowsCommand("gradle"), ["--version"]) : hasWrapper ? "Gradle wrapper present" : "",
      installHint: "Install Gradle or add a Gradle wrapper so PayFix can build Gradle projects.",
      installCommand: "winget install Gradle.Gradle",
      installUrl: "https://gradle.org/install/",
    });
  }

  if (has(/(^|\/)composer\.json$/i)) {
    const available = await commandExists("composer");
    items.push({
      id: "composer",
      label: "Composer",
      detected: true,
      available,
      requiredCommands: ["composer"],
      availableCommands: available ? ["composer"] : [],
      missingCommands: available ? [] : ["composer"],
      version: available ? await commandVersion("composer", ["--version"]) : "",
      installHint: "Install Composer so PayFix can install and validate PHP dependencies.",
      installCommand: "winget install Composer.Composer",
      installUrl: "https://getcomposer.org/download/",
    });
  }

  const missing = items.filter((item) => !item.available);
  const unavailableValidation = missing.map((item) => `${item.label}: missing ${item.missingCommands.join(", ")}`);

  return {
    ok: true,
    root: allowedRoot,
    detectedLanguages: items.map((item) => item.label),
    items,
    missing,
    unavailableValidation,
    packageScripts,
  };
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

function safeProjectPackageName(root: string) {
  const fallback = path.basename(root || "payfix-project").toLowerCase();
  const cleaned = fallback.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "payfix-project";
}

async function ensureInstallMetadata(ecosystem: string, packageManager: string) {
  const commands: Awaited<ReturnType<typeof runProjectCommand>>[] = [];

  if (ecosystem === "node") {
    const packageJsonPath = path.join(allowedRoot, "package.json");
    if (!(await fileExists(packageJsonPath))) {
      const commandName = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm";
      const command = windowsCommand(commandName);
      const args = packageManager === "yarn" ? ["init", "-y"] : ["init", "-y"];
      commands.push(await runProjectCommand(command, args));
    }
  }

  if (ecosystem === "go" && !(await fileExists(path.join(allowedRoot, "go.mod")))) {
    commands.push(await runProjectCommand("go", ["mod", "init", safeProjectPackageName(allowedRoot)]));
  }

  if (ecosystem === "rust" && !(await fileExists(path.join(allowedRoot, "Cargo.toml")))) {
    commands.push(await runProjectCommand("cargo", ["init", "--vcs", "none", "--name", safeProjectPackageName(allowedRoot)]));
  }

  if (ecosystem === "php" && !(await fileExists(path.join(allowedRoot, "composer.json")))) {
    commands.push(await runProjectCommand("composer", ["init", "--no-interaction", "--name", `local/${safeProjectPackageName(allowedRoot)}`]));
  }

  if (ecosystem === "ruby" && !(await fileExists(path.join(allowedRoot, "Gemfile")))) {
    commands.push(await runProjectCommand("bundle", ["init"]));
  }

  const failed = commands.find((command) => !command.ok);
  return {
    ok: !failed,
    commands,
    command: commands.map((command) => command.command).join(" && "),
    output: commands.map((command) => command.output).filter(Boolean).join("\n\n"),
  };
}

function dependencyNameKey(name: string) {
  return name.trim().toLowerCase().replace(/_/g, "-");
}

function pythonDependencyNameFromLine(line: string) {
  return dependencyNameKey(line.trim().replace(/^["']|["'],?$/g, "").match(/^([A-Za-z0-9_.-]+)/)?.[1] || "");
}

async function updatePythonDependencyMetadata(packageNames: string[]) {
  const pyprojectPath = path.join(allowedRoot, "pyproject.toml");
  const requirementsPath = path.join(allowedRoot, "requirements.txt");
  const normalizedPackages = [...new Set(packageNames.map(dependencyNameKey).filter(Boolean))];

  if (await fileExists(pyprojectPath)) {
    const original = await fs.readFile(pyprojectPath, "utf8");
    const declared = new Set(
      [...original.matchAll(/^\s*["']([^"']+)["']\s*,?\s*$/gm)].map((match) =>
        pythonDependencyNameFromLine(match[1] || ""),
      ),
    );
    const missing = normalizedPackages.filter((packageName) => !declared.has(packageName));
    if (!missing.length) {
      return { updated: false, file: relativeProjectPath(pyprojectPath), added: [] as string[] };
    }

    let next = original;
    const dependencyBlock = next.match(/(^dependencies\s*=\s*\[\s*$)([\s\S]*?)(^\]\s*$)/m);
    if (dependencyBlock?.index !== undefined) {
      const insert = missing.map((packageName) => `  "${packageName}",`).join("\n");
      next = `${next.slice(0, dependencyBlock.index)}${dependencyBlock[1]}${dependencyBlock[2]}${dependencyBlock[2].trim() ? "\n" : ""}${insert}\n${dependencyBlock[3]}${next.slice(dependencyBlock.index + dependencyBlock[0].length)}`;
    } else if (/^\[project\]\s*$/m.test(next)) {
      const insert = `\ndependencies = [\n${missing.map((packageName) => `  "${packageName}",`).join("\n")}\n]`;
      next = next.replace(/^\[project\]\s*$/m, `[project]${insert}`);
    } else {
      next = `[project]\ndependencies = [\n${missing.map((packageName) => `  "${packageName}",`).join("\n")}\n]\n\n${next}`;
    }

    await fs.writeFile(pyprojectPath, next, "utf8");
    return { updated: true, file: relativeProjectPath(pyprojectPath), added: missing };
  }

  if (await fileExists(requirementsPath)) {
    const original = await fs.readFile(requirementsPath, "utf8");
    const declared = new Set(original.split(/\r?\n/).map(pythonDependencyNameFromLine).filter(Boolean));
    const missing = normalizedPackages.filter((packageName) => !declared.has(packageName));
    if (!missing.length) {
      return { updated: false, file: relativeProjectPath(requirementsPath), added: [] as string[] };
    }

    await fs.writeFile(requirementsPath, `${original.trimEnd()}\n${missing.join("\n")}\n`, "utf8");
    return { updated: true, file: relativeProjectPath(requirementsPath), added: missing };
  }

  return { updated: false, file: "", added: [] as string[] };
}

function safeInstallPackageName(name: string) {
  const trimmed = name.trim();

  if (!/^[A-Za-z0-9@._/-]+$/.test(trimmed) || trimmed.startsWith(".") || trimmed.includes("..")) {
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
    for (const match of text.matchAll(/\/(?:Users|home|Volumes|opt|workspace|srv)\/[^"'<>|]+?(?=\s|$|")/g)) {
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
  if (process.platform !== "win32" && process.platform !== "darwin" && process.platform !== "linux") {
    return {
      ok: false,
      error: "Port to project resolver is not supported on this operating system yet.",
      port,
      processes: [],
    };
  }

  if (process.platform !== "win32") {
    const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-FpPc"], {
      timeout: 10000,
      maxBuffer: 1024 * 256,
    });
    const processes = parseLsofProcessRows(stdout);
    const enriched = await enrichUnixProcesses(processes.map((item) => item.processId).filter(Boolean) as number[]);

    return {
      ok: true,
      port,
      connectionCount: processes.length,
      processes: enriched.length ? enriched : processes,
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

function processLooksLikeDevServer(processInfo: { name?: string; commandLine?: string; executablePath?: string }) {
  const text = `${processInfo.name || ""} ${processInfo.commandLine || ""} ${processInfo.executablePath || ""}`;
  return /\b(node|npm|pnpm|yarn|next|vite|react-scripts|ng|astro|nuxt|remix|dotnet|python|uvicorn|flask|django|php|artisan|ruby|rails|cargo|tauri)\b/i.test(
    text
  );
}

function parseLsofProcessRows(output: string) {
  const rows: Array<{ processId?: number; name?: string; commandLine?: string; executablePath?: string; port?: number; localAddress?: string }> = [];
  let current: { processId?: number; name?: string; commandLine?: string; executablePath?: string; port?: number; localAddress?: string } | null = null;

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const type = line[0];
    const value = line.slice(1);

    if (type === "p") {
      if (current?.processId && current.port) rows.push(current);
      current = { processId: Number(value) || undefined };
      continue;
    }

    if (!current) continue;
    if (type === "c") current.name = value;
    if (type === "n") {
      const portMatch = value.match(/(?:^|:)(\d+)(?:\s|\(|$)/);
      current.port = portMatch ? Number(portMatch[1]) : current.port;
      current.localAddress = value.split("->")[0]?.trim();
    }
  }

  if (current?.processId && current.port) rows.push(current);
  return rows;
}

async function enrichUnixProcesses(pids: number[]) {
  const uniquePids = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (!uniquePids.length) return [];

  const { stdout } = await execFileAsync("ps", ["-o", "pid=,ppid=,comm=,command=", "-p", uniquePids.join(",")], {
    timeout: 10000,
    maxBuffer: 1024 * 512,
  });

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+([\s\S]+)$/);
      return {
        processId: match ? Number(match[1]) : undefined,
        parentProcessId: match ? Number(match[2]) : undefined,
        name: match?.[3],
        executablePath: match?.[3],
        commandLine: match?.[4] || line,
      };
    });
}

async function listListeningPorts() {
  if (process.platform !== "win32" && process.platform !== "darwin" && process.platform !== "linux") {
    return {
      ok: false,
      error: "Port manager is not supported on this operating system yet.",
      ports: [],
    };
  }

  if (process.platform !== "win32") {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpPcn"], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const rows = parseLsofProcessRows(stdout);
    const enriched = await enrichUnixProcesses(rows.map((row) => row.processId).filter(Boolean) as number[]);
    const byPid = new Map(enriched.map((processInfo) => [processInfo.processId, processInfo]));
    const byPort = new Map<number, {
      port: number;
      localAddresses: string[];
      processes: Array<{ processId?: number; name?: string; executablePath?: string; commandLine?: string }>;
      devServerLikely: boolean;
      currentAgent: boolean;
      projectCandidates: Awaited<ReturnType<typeof inferProjectRootsFromProcessClues>>;
    }>();

    for (const row of rows) {
      const port = Number(row.port || 0);
      if (!Number.isInteger(port) || port <= 0) continue;
      const processInfo = byPid.get(row.processId || 0) || row;
      const item =
        byPort.get(port) ||
        {
          port,
          localAddresses: row.localAddress ? [row.localAddress] : [],
          processes: [],
          devServerLikely: false,
          currentAgent: port === PORT,
          projectCandidates: [],
        };

      if (row.localAddress && !item.localAddresses.includes(row.localAddress)) item.localAddresses.push(row.localAddress);
      if (!item.processes.some((existing) => existing.processId === processInfo.processId)) item.processes.push(processInfo);
      item.devServerLikely = item.devServerLikely || processLooksLikeDevServer(processInfo);
      byPort.set(port, item);
    }

    const ports = await Promise.all(
      [...byPort.values()]
        .sort((left, right) => left.port - right.port)
        .slice(0, 120)
        .map(async (item) => ({
          ...item,
          projectCandidates: item.devServerLikely
            ? await inferProjectRootsFromProcessClues(item.port, item.processes).catch(() => [])
            : [],
        }))
    );

    return { ok: true, currentRoot: allowedRoot || null, ports };
  }

  const script = String.raw`
$ErrorActionPreference = "SilentlyContinue"
$connections = @(Get-NetTCPConnection -State Listen | Sort-Object LocalPort, OwningProcess)
$items = @()
foreach ($connection in $connections) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
  $items += [pscustomobject]@{
    port = [int]$connection.LocalPort
    localAddress = $connection.LocalAddress
    processId = [int]$connection.OwningProcess
    name = $process.Name
    executablePath = $process.ExecutablePath
    commandLine = $process.CommandLine
  }
}
$items | ConvertTo-Json -Depth 5
`;

  const raw = await runPowerShellJson(script);
  const rows = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<{
    port?: number;
    localAddress?: string;
    processId?: number;
    name?: string;
    executablePath?: string;
    commandLine?: string;
  }>;
  const byPort = new Map<number, {
    port: number;
    localAddresses: string[];
    processes: Array<{ processId?: number; name?: string; executablePath?: string; commandLine?: string }>;
    devServerLikely: boolean;
    currentAgent: boolean;
    projectCandidates: Awaited<ReturnType<typeof inferProjectRootsFromProcessClues>>;
  }>();

  for (const row of rows) {
    const port = Number(row.port || 0);
    if (!Number.isInteger(port) || port <= 0) continue;

    const item =
      byPort.get(port) ||
      {
        port,
        localAddresses: [],
        processes: [],
        devServerLikely: false,
        currentAgent: port === PORT,
        projectCandidates: [],
      };

    if (row.localAddress && !item.localAddresses.includes(row.localAddress)) item.localAddresses.push(row.localAddress);
    if (!item.processes.some((processInfo) => processInfo.processId === row.processId)) {
      item.processes.push({
        processId: row.processId,
        name: row.name,
        executablePath: row.executablePath,
        commandLine: row.commandLine,
      });
    }
    item.devServerLikely = item.devServerLikely || processLooksLikeDevServer(row);
    byPort.set(port, item);
  }

  const ports = await Promise.all(
    [...byPort.values()]
      .sort((left, right) => left.port - right.port)
      .slice(0, 120)
      .map(async (item) => ({
        ...item,
        projectCandidates: item.devServerLikely
          ? await inferProjectRootsFromProcessClues(item.port, item.processes).catch(() => [])
          : [],
      }))
  );

  return {
    ok: true,
    currentRoot: allowedRoot || null,
    ports,
  };
}

async function stopListeningPort(port: number) {
  if (port === PORT) {
    throw new Error("Refusing to stop PayFix Local Agent's own port 7777 from inside the app.");
  }

  const processInfo = await listeningProcessInfo(port);
  if (!processInfo.ok) throw new Error(processInfo.error || "Could not inspect port.");
  const processes = (processInfo.processes || []) as Array<{ processId?: number; name?: string; commandLine?: string; executablePath?: string }>;
  const pids = [
    ...new Set(
      processes
        .filter(processLooksLikeDevServer)
        .map((item) => Number(item.processId || 0))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    ),
  ];

  if (!pids.length) {
    throw new Error("No safe dev-server process was found for this port. PayFix will not stop system-looking processes automatically.");
  }

  for (const pid of pids) {
    if (process.platform === "win32") {
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1024 * 256,
      }).catch(() => undefined);
    } else {
      process.kill(pid, "SIGTERM");
    }
  }

  return { ok: true, port, stoppedProcessIds: pids };
}

async function startProjectServer(scriptName?: string, port?: number) {
  if (!allowedRoot) throw new Error("No project folder selected.");
  const packageJsonPath = path.join(allowedRoot, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    throw new Error("Cannot restart a Node dev server because package.json was not found in the connected project.");
  }

  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts || {};
  const chosenScript =
    scriptName && scripts[scriptName]
      ? scriptName
      : ["dev", "start", "serve", "preview"].find((candidate) => scripts[candidate]);
  if (!chosenScript) {
    throw new Error("No dev/start/serve/preview script was found in package.json.");
  }

  const packageManager = await detectPackageManager(allowedRoot);
  const commandName = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm";
  const command = windowsCommand(commandName);
  const args = packageManager === "npm" ? ["run", chosenScript] : [chosenScript];
  const child = spawn(command, args, {
    cwd: allowedRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
    env: {
      ...process.env,
      ...(port ? { PORT: String(port) } : {}),
    },
  });
  child.unref();

  return {
    ok: true,
    root: allowedRoot,
    packageManager,
    script: chosenScript,
    command: [command, ...args].join(" "),
    processId: child.pid,
  };
}

app.get("/system/ports/list", async (_req, res) => {
  try {
    res.json(await listListeningPorts());
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err), ports: [] });
  }
});

app.post("/system/ports/stop", async (req, res) => {
  try {
    const port = Number(req.body.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("A valid port is required.");
    res.json(await stopListeningPort(port));
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/system/ports/restart", async (req, res) => {
  try {
    const port = Number(req.body.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("A valid port is required.");
    const stopped = await stopListeningPort(port);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const started = await startProjectServer(typeof req.body.script === "string" ? req.body.script : undefined, port);
    res.json({ ok: true, port, stopped, started });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

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

app.post("/app/open-url", async (req, res) => {
  try {
    const rawUrl = typeof req.body.url === "string" ? req.body.url.trim() : "";
    const browser = typeof req.body.browser === "string" ? req.body.browser.trim().toLowerCase() : "";

    if (!rawUrl) throw new Error("URL is required.");
    if (!["chrome", "edge", "firefox"].includes(browser)) {
      throw new Error("Browser must be chrome, edge, or firefox.");
    }

    res.json(await openUrlInBrowser(rawUrl, browser as BrowserChoice));
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/app/pick-folder", async (req, res) => {
  try {
    const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 120) : "Select folder";
    const folder = await pickFolderWithNativeDialog(title || "Select folder");
    if (!folder) {
      res.json({ ok: false, cancelled: true, error: "Folder selection was cancelled." });
      return;
    }

    res.json({ ok: true, folder });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/app/browse-folders", async (req, res) => {
  try {
    const targetPath = typeof req.body.path === "string" ? req.body.path : "";
    res.json(await browseLocalFolders(targetPath));
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/sdk/inspect", async (req, res) => {
  try {
    const root = typeof req.body.root === "string" ? req.body.root.trim() : "";
    res.json(await inspectSdkFolder(root));
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/project/build-pax-android", async (req, res) => {
  try {
    const sdkRoots = Array.isArray(req.body.sdkRoots) ? req.body.sdkRoots.map(String) : [];
    const prompt = typeof req.body.prompt === "string" ? req.body.prompt : "";
    res.json(await buildPaxAndroidApp(sdkRoots, prompt));
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
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

app.post("/project/delete-file", async (req, res) => {
  try {
    const file = safePath(req.body.file);
    const apply = Boolean(req.body.apply);
    const fileExisted = await fileExists(file);

    if (!fileExisted) {
      throw new Error("File does not exist.");
    }

    const oldContent = await fs.readFile(file, "utf8");
    let rollback = null;

    if (apply) {
      const rollbackId = crypto.randomUUID();
      const snapshot = {
        id: rollbackId,
        file,
        relative: relativeProjectPath(file),
        previousContent: oldContent,
        fileExisted: true,
        createdAt: new Date().toISOString(),
        reason: String(req.body.reason || "Delete file"),
      };
      rollbackSnapshots.set(rollbackId, snapshot);
      if (rollbackSnapshots.size > 50) {
        const oldest = [...rollbackSnapshots.values()].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )[0];
        if (oldest) rollbackSnapshots.delete(oldest.id);
      }

      await fs.unlink(file);
      rollback = {
        id: snapshot.id,
        file: snapshot.file,
        relative: snapshot.relative,
        fileExisted: snapshot.fileExisted,
        createdAt: snapshot.createdAt,
        reason: snapshot.reason,
      };
    }

    res.json({
      ok: true,
      file,
      relative: relativeProjectPath(file),
      mode: "delete",
      applied: apply,
      oldContent,
      newContent: "",
      rollback,
    });
  } catch (err: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(err) });
  }
});

app.post("/project/delete-root", async (req, res) => {
  try {
    if (!allowedRoot) throw new Error("No project folder selected.");

    const apply = Boolean(req.body.apply);
    const force = Boolean(req.body.force);
    const root = allowedRoot;
    const allEntries = await fg(["**/*"], {
      cwd: root,
      absolute: true,
      onlyFiles: false,
      dot: true,
      suppressErrors: true,
    });
    const fileEntries = await fg(["**/*"], {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      dot: true,
      suppressErrors: true,
    });
    const directoryEntries = allEntries.filter((entry) => !fileEntries.includes(entry));

    if (fileEntries.length > 0) {
      res.status(409).json({
        ok: false,
        code: "not_empty",
        root,
        fileCount: fileEntries.length,
        directoryCount: directoryEntries.length,
        remaining: fileEntries.slice(0, 12).map(relativeProjectPath),
        error: "The connected project folder still contains files. Delete the files first, then delete the folder.",
      });
      return;
    }

    if (apply) {
      const maxAttempts = force ? 4 : 1;
      let lastDeleteError: unknown = null;

      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            await fs.rm(root, { recursive: true, force });
            lastDeleteError = null;
            break;
          } catch (err: unknown) {
            lastDeleteError = err;
            if (!force || attempt === maxAttempts) break;
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          }
        }

        if (lastDeleteError && force) {
          try {
            await forceRemoveDirectoryFromDisk(root);
            lastDeleteError = null;
          } catch (err: unknown) {
            lastDeleteError = err;
          }
        }

        if (lastDeleteError) throw lastDeleteError;
        allowedRoot = "";
      } catch (err: unknown) {
        const detail = errorMessage(err);
        if (/EBUSY|EPERM|ENOTEMPTY|busy|locked|resource|being used by another process|cannot access the file|RemoveFileSystemItemIOError/i.test(detail)) {
          res.status(409).json({
            ok: false,
            code: "busy",
            root,
            detail,
            canForce: !force,
            error: force
              ? "The operating system still reports this folder as busy or locked. Close any file explorer, editor, terminal, or server process using it, then retry."
              : "The connected project folder is busy or locked by another process.",
          });
          return;
        }

        throw err;
      }
    }

    res.json({
      ok: true,
      root,
      applied: apply,
      forced: apply && force,
      directoryCount: directoryEntries.length,
      message: apply
        ? "Deleted the empty connected project folder tree."
        : directoryEntries.length
          ? "The connected project contains only empty subfolders and can be deleted."
          : "The connected project folder is empty and can be deleted.",
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
    if (mode === "delete") {
      if (!fileExisted) throw new Error("Validation refused: file does not exist.");
      await fs.unlink(file);
    } else {
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
    }

    const commands: Awaited<ReturnType<typeof runProjectCommand>>[] = [];
    const skipped: string[] = [];
    await addLanguageValidationCommands(file, commands, skipped);

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
      skipped,
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

    const toolchain = await projectToolchainDoctor();
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

      if (scripts.check) {
        commands.push(await runProjectCommand(pmCommand, ["run", "check"]));
      } else if (scripts.smoke) {
        commands.push(await runProjectCommand(pmCommand, ["run", "smoke"]));
      } else {
        skipped.push("Runtime check skipped: package.json has no check/smoke script.");
      }
    } else {
      skipped.push("npm/yarn/pnpm diagnostics skipped: no package.json found.");
    }

    await runPythonProjectChecks(["check", "lint", "test"], commands, skipped);
    await runCrossLanguageProjectChecks(["check", "lint", "test", "build"], commands, skipped);

    for (const item of toolchain.missing || []) {
      skipped.push(`Toolchain missing: ${item.label} cannot be fully validated until ${item.missingCommands.join(", ")} is installed.`);
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

app.get("/project/toolchain", async (_req, res) => {
  try {
    res.json(await projectToolchainDoctor());
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

    const toolchain = await projectToolchainDoctor();
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
    const checks = requested.length ? requested : ["check", "typescript", "lint", "test", "build"];
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

    if (hasPackageJson && checks.includes("check")) {
      if (scripts.check) {
        commands.push(await runProjectCommand(pmCommand, ["run", "check"]));
      } else if (scripts.smoke) {
        commands.push(await runProjectCommand(pmCommand, ["run", "smoke"]));
      } else {
        skipped.push("Runtime check skipped: package.json has no check/smoke script.");
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

    await runPythonProjectChecks(checks, commands, skipped);
    await runCrossLanguageProjectChecks(checks, commands, skipped);

    for (const item of toolchain.missing || []) {
      skipped.push(`Toolchain missing: ${item.label} cannot be fully validated until ${item.missingCommands.join(", ")} is installed.`);
    }

    const failed = commands.filter((command) => !command.ok);

    res.json({
      ok: failed.length === 0,
      root: allowedRoot,
      packageManager,
      toolchain,
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

    const requestedPackages: unknown[] = Array.isArray(req.body.packageNames)
      ? req.body.packageNames
      : [req.body.packageName];
    const packageNames: string[] = [
      ...new Set(
        requestedPackages
          .map((item: unknown) => safeInstallPackageName(String(item || "")))
          .filter(Boolean),
      ),
    ];
    if (!packageNames.length) throw new Error("No package name was provided.");
    const dev = Boolean(req.body.dev);
    const ecosystem = String(req.body.ecosystem || "node").toLowerCase();
    const packageManager = ecosystem === "node" ? await detectPackageManager(allowedRoot) : ecosystem;
    const bootstrap = await ensureInstallMetadata(ecosystem, packageManager);
    if (!bootstrap.ok) {
      throw new Error(`Could not initialize ${ecosystem} project metadata before install.\n${bootstrap.output}`);
    }

    let command = "";
    let args: string[] = [];
    let result: Awaited<ReturnType<typeof runProjectCommand>>;

    if (ecosystem === "python") {
      command = process.platform === "win32" ? "python.exe" : "python";
      args = ["-m", "pip", "install", ...packageNames];
    } else if (ecosystem === "dotnet") {
      command = "dotnet";
      args = ["add", "package", ...packageNames];
    } else if (ecosystem === "rust") {
      command = "cargo";
      args = ["add", ...packageNames];
    } else if (ecosystem === "go") {
      command = "go";
      args = ["get", ...packageNames];
    } else if (ecosystem === "php") {
      command = "composer";
      args = ["require", ...packageNames];
    } else if (ecosystem === "ruby") {
      command = "bundle";
      args = ["add", ...packageNames];
    } else {
      const commandName = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm";
      command = process.platform === "win32" ? `${commandName}.cmd` : commandName;
      args =
        packageManager === "yarn"
          ? ["add", ...(dev ? ["-D"] : []), ...packageNames]
          : ["install", ...(dev ? ["-D"] : []), ...packageNames];
    }

    if ((ecosystem === "dotnet" || ecosystem === "ruby") && packageNames.length > 1) {
      const results = [];
      for (const packageName of packageNames) {
        const itemArgs = ecosystem === "dotnet" ? ["add", "package", packageName] : ["add", packageName];
        results.push(await runProjectCommand(command, itemArgs));
      }

      const failed = results.find((item) => !item.ok);
      result = {
        ok: !failed,
        command: results.map((item) => item.command).join(" && "),
        output: results.map((item) => item.output).filter(Boolean).join("\n\n"),
      };
    } else {
      result = await runProjectCommand(command, args);
    }

    const metadata =
      result.ok && ecosystem === "python"
        ? await updatePythonDependencyMetadata(packageNames)
        : { updated: false, file: "", added: [] as string[] };

    res.json({
      ok: result.ok,
      packageName: packageNames[0],
      packageNames,
      ecosystem,
      packageManager,
      metadataUpdated: metadata.updated,
      metadataFile: metadata.file,
      metadataAdded: metadata.added,
      initialized: bootstrap.commands.length > 0,
      bootstrapCommands: bootstrap.commands,
      command: [bootstrap.command, result.command].filter(Boolean).join(" && "),
      output: [bootstrap.output, result.output].filter(Boolean).join("\n\n"),
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
