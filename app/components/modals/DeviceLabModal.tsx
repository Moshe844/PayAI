import {
  Activity,
  AlertTriangle,
  CreditCard,
  Download,
  PackageCheck,
  Keyboard,
  Network,
  Radio,
  RefreshCw,
  Send,
  Square,
  Usb,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type DeviceRecord = Record<string, unknown>;

type DeviceScanResult = {
  ok?: boolean;
  error?: string;
  scannedAt?: string;
  computerName?: string;
  platform?: string;
  comPorts?: DeviceRecord[];
  usbDevices?: DeviceRecord[];
  hidDevices?: DeviceRecord[];
  issues?: DeviceRecord[];
};

type DeviceLabModalProps = {
  result: DeviceScanResult | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onDownloadBundle: () => void;
};

type NetworkProbeResult = {
  ok?: boolean;
  error?: string;
  host?: string;
  ports?: { port: number; open: boolean; error?: string }[];
  openPorts?: number[];
  likelyNetworkTerminal?: boolean;
  hints?: string[];
};

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
  eventCount: number;
  latestEvent?: DeviceCaptureEvent | null;
};

type DeviceCaptureState = {
  ok?: boolean;
  error?: string;
  session?: DeviceCaptureSession;
  events?: DeviceCaptureEvent[];
};

type VendorPack = {
  id: string;
  vendor: string;
  models: string[];
  connectionTypes: string[];
  actions: {
    id: string;
    label: string;
    description: string;
    requiresAdapter: boolean;
  }[];
  sdkRequired: boolean;
  notes: string[];
  adapterInstalled: boolean;
  adapterConfigured: boolean;
  adapterPath: string;
  configPath: string;
  configReason: string;
  status: "ready" | "adapter-required" | "bridge-unconfigured";
};

type VendorActionResult = {
  ok?: boolean;
  error?: string;
  vendor?: string;
  action?: { label: string };
  result?: unknown;
};

type VendorTemplateResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  adapterPath?: string;
  configPath?: string;
  alreadyExists?: boolean;
  pack?: VendorPack;
};

type VendorBridgeSettings = {
  timeoutMs: number;
  sdkModule: string;
  sdkMethods: Record<string, string>;
  commands: Record<
    string,
    {
      hex: string;
      text: string;
      encoding: "utf8" | "ascii";
      description: string;
    }
  >;
  configPath?: string;
  exists?: boolean;
};

function textValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "n/a";
  return String(value);
}

function deviceName(item: DeviceRecord) {
  return textValue(item.FriendlyName || item.Name || item.DeviceID || item.Description);
}

function deviceId(item: DeviceRecord) {
  return textValue(item.DeviceID || item.InstanceId || item.PNPDeviceID);
}

function luhnLooksValid(value: string) {
  let sum = 0;
  let doubleDigit = false;

  for (let index = value.length - 1; index >= 0; index--) {
    let digit = Number(value[index]);
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

function maskPan(value: string) {
  if (value.length < 10) return value;
  return `${value.slice(0, 6)}${"*".repeat(Math.max(0, value.length - 10))}${value.slice(-4)}`;
}

function analyzeKeyboardWedge(value: string) {
  let redacted = value.replace(/\b\d{13,19}\b/g, (candidate) =>
    luhnLooksValid(candidate) ? maskPan(candidate) : candidate,
  );
  redacted = redacted
    .replace(/(%B)(\d{13,19})(\^)/g, (_match, prefix, pan, suffix) => `${prefix}${maskPan(pan)}${suffix}`)
    .replace(/(;)(\d{13,19})(=)/g, (_match, prefix, pan, suffix) => `${prefix}${maskPan(pan)}${suffix}`);

  const findings = [];
  if (/%B\d{6}/.test(value) || /;\d{6}/.test(value)) {
    findings.push("Magstripe track-looking keyboard-wedge data detected.");
  }
  if (/\b(9F26|9F27|5F2A|9F10|8202|9505)\b/i.test(value.replace(/\s/g, ""))) {
    findings.push("EMV/TLV-looking text was typed by the device.");
  }
  if (!findings.length) {
    findings.push("Keyboard input captured. If this is a payment reader, compare with expected vendor output format.");
  }

  return { redacted, findings };
}

function vendorPackStatusLabel(pack: VendorPack) {
  if (!pack.adapterInstalled) return "PC bridge needed";
  if (!pack.adapterConfigured) return "Bridge needs config";
  return "Ready to run";
}

function vendorPackStatusClass(pack: VendorPack) {
  if (!pack.adapterInstalled) return "bg-amber-100 text-amber-800";
  if (!pack.adapterConfigured) return "bg-yellow-100 text-yellow-800";
  return "bg-emerald-100 text-emerald-700";
}

export default function DeviceLabModal({
  result,
  loading,
  onClose,
  onRefresh,
  onDownloadBundle,
}: DeviceLabModalProps) {
  const [host, setHost] = useState("");
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeResult, setProbeResult] = useState<NetworkProbeResult | null>(null);
  const [captureMode, setCaptureMode] = useState<"tcp" | "serial">("tcp");
  const [captureHost, setCaptureHost] = useState("");
  const [capturePort, setCapturePort] = useState("10009");
  const [serialPath, setSerialPath] = useState("");
  const [serialBaudRate, setSerialBaudRate] = useState("9600");
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureState, setCaptureState] = useState<DeviceCaptureState | null>(null);
  const [sendPayload, setSendPayload] = useState("");
  const [sendEncoding, setSendEncoding] = useState<"text" | "hex">("text");
  const [wedgeInput, setWedgeInput] = useState("");
  const [wedgeCaptures, setWedgeCaptures] = useState<Array<{ id: string; at: string; raw: string; redacted: string; findings: string[] }>>([]);
  const [vendorPacks, setVendorPacks] = useState<VendorPack[]>([]);
  const [selectedVendorPackId, setSelectedVendorPackId] = useState("idtech");
  const [selectedVendorActionId, setSelectedVendorActionId] = useState("start-card-read");
  const [vendorActionLoading, setVendorActionLoading] = useState(false);
  const [vendorActionResult, setVendorActionResult] = useState<VendorActionResult | null>(null);
  const [vendorTemplateLoading, setVendorTemplateLoading] = useState(false);
  const [vendorTemplateResult, setVendorTemplateResult] = useState<VendorTemplateResult | null>(null);
  const [vendorConfigLoading, setVendorConfigLoading] = useState(false);
  const [vendorSettingsLoading, setVendorSettingsLoading] = useState(false);
  const [vendorSettingsSaving, setVendorSettingsSaving] = useState(false);
  const [vendorBridgeSettings, setVendorBridgeSettings] = useState<VendorBridgeSettings | null>(null);
  const [vendorCommandMode, setVendorCommandMode] = useState<"sdk" | "hex" | "text">("sdk");
  const comPorts = result?.comPorts || [];
  const usbDevices = result?.usbDevices || [];
  const hidDevices = result?.hidDevices || [];
  const issues = result?.issues || [];
  const connectedDeviceCount = comPorts.length + usbDevices.length + hidDevices.length;
  const selectedVendorPack = vendorPacks.find((pack) => pack.id === selectedVendorPackId);
  const selectedVendorAction =
    selectedVendorPack?.actions.find((action) => action.id === selectedVendorActionId) || selectedVendorPack?.actions[0];

  async function probeNetworkTerminal() {
    setProbeLoading(true);
    setProbeResult(null);

    try {
      const response = await fetch("/api/local-agent/device/probe-network", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host }),
      });
      const data = await response.json();
      setProbeResult(data);
    } catch (error: unknown) {
      setProbeResult({
        ok: false,
        error: error instanceof Error ? error.message : "Network probe failed.",
      });
    } finally {
      setProbeLoading(false);
    }
  }

  async function loadVendorPacks() {
    try {
      const response = await fetch("/api/local-agent/device/vendor-packs");
      const data = await response.json();
      if (data.ok && Array.isArray(data.packs)) {
        setVendorPacks(data.packs);
      }
    } catch {
      setVendorPacks([]);
    }
  }

  const refreshCapture = useCallback(async (sessionId = captureState?.session?.id) => {
    if (!sessionId) return;

    try {
      const response = await fetch(`/api/local-agent/device/capture/${sessionId}/events`);
      const data = await response.json();
      setCaptureState(data);
    } catch (error: unknown) {
      setCaptureState({
        ok: false,
        error: error instanceof Error ? error.message : "Could not refresh capture session.",
      });
    }
  }, [captureState?.session?.id]);

  async function startCapture() {
    setCaptureLoading(true);

    try {
      const body =
        captureMode === "tcp"
          ? { mode: "tcp", host: captureHost, port: Number(capturePort) }
          : { mode: "serial", path: serialPath, baudRate: Number(serialBaudRate) };
      const response = await fetch("/api/local-agent/device/capture/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      setCaptureState(data);
      if (data.session?.id) {
        window.setTimeout(() => void refreshCapture(data.session.id), 500);
      }
    } catch (error: unknown) {
      setCaptureState({
        ok: false,
        error: error instanceof Error ? error.message : "Could not start device capture.",
      });
    } finally {
      setCaptureLoading(false);
    }
  }

  async function stopCapture() {
    if (!captureState?.session?.id) return;
    setCaptureLoading(true);

    try {
      const response = await fetch(`/api/local-agent/device/capture/${captureState.session.id}/stop`, {
        method: "POST",
      });
      const data = await response.json();
      setCaptureState((current) => ({
        ...current,
        ok: data.ok,
        session: data.session || current?.session,
      }));
    } catch (error: unknown) {
      setCaptureState({
        ok: false,
        error: error instanceof Error ? error.message : "Could not stop capture session.",
      });
    } finally {
      setCaptureLoading(false);
    }
  }

  async function sendToDevice() {
    if (!captureState?.session?.id || !sendPayload) return;
    setCaptureLoading(true);

    try {
      const response = await fetch(`/api/local-agent/device/capture/${captureState.session.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: sendPayload, encoding: sendEncoding }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Send failed.");
      setSendPayload("");
      await refreshCapture(captureState.session.id);
    } catch (error: unknown) {
      setCaptureState((current) => ({
        ...current,
        ok: false,
        error: error instanceof Error ? error.message : "Could not send payload.",
      }));
    } finally {
      setCaptureLoading(false);
    }
  }

  function commitKeyboardWedgeCapture(value = wedgeInput) {
    const trimmed = value.trim();
    if (!trimmed) return;

    const analysis = analyzeKeyboardWedge(trimmed);
    setWedgeCaptures((current) => [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        raw: trimmed,
        redacted: analysis.redacted,
        findings: analysis.findings,
      },
      ...current.slice(0, 24),
    ]);
    setWedgeInput("");
  }

  async function runVendorAction() {
    if (!selectedVendorPack || !selectedVendorAction) return;
    setVendorActionLoading(true);
    setVendorActionResult(null);

    try {
      const response = await fetch(`/api/local-agent/device/vendor-packs/${selectedVendorPack.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: selectedVendorAction.id,
          captureSessionId: captureState?.session?.id || "",
          connection:
            captureMode === "tcp"
              ? { mode: "tcp", host: captureHost, port: Number(capturePort) }
              : { mode: "serial", path: serialPath, baudRate: Number(serialBaudRate) },
          params: {},
        }),
      });
      setVendorActionResult((await response.json()) as VendorActionResult);
      if (captureState?.session?.id) {
        await refreshCapture(captureState.session.id);
      }
    } catch (error: unknown) {
      setVendorActionResult({
        ok: false,
        error: error instanceof Error ? error.message : "Vendor action failed.",
      });
    } finally {
      setVendorActionLoading(false);
    }
  }

  async function createVendorTemplate() {
    if (!selectedVendorPack) return;
    setVendorTemplateLoading(true);
    setVendorTemplateResult(null);

    try {
      const response = await fetch(`/api/local-agent/device/vendor-packs/${selectedVendorPack.id}/create-template`, {
        method: "POST",
      });
      const data = (await response.json()) as VendorTemplateResult;
      setVendorTemplateResult(data);
      await loadVendorPacks();
    } catch (error: unknown) {
      setVendorTemplateResult({
        ok: false,
        error: error instanceof Error ? error.message : "Could not create vendor bridge template.",
      });
    } finally {
      setVendorTemplateLoading(false);
    }
  }

  async function createVendorConfig() {
    if (!selectedVendorPack) return;
    setVendorConfigLoading(true);
    setVendorTemplateResult(null);

    try {
      const response = await fetch(`/api/local-agent/device/vendor-packs/${selectedVendorPack.id}/create-config`, {
        method: "POST",
      });
      const data = (await response.json()) as VendorTemplateResult;
      setVendorTemplateResult(data);
      await loadVendorPacks();
    } catch (error: unknown) {
      setVendorTemplateResult({
        ok: false,
        error: error instanceof Error ? error.message : "Could not create bridge settings template.",
      });
    } finally {
      setVendorConfigLoading(false);
    }
  }

  const loadVendorSettings = useCallback(async (packId = selectedVendorPackId) => {
    if (!packId) return;
    setVendorSettingsLoading(true);

    try {
      const response = await fetch(`/api/local-agent/device/vendor-packs/${packId}/settings`);
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Could not load bridge settings.");
      setVendorBridgeSettings(data.settings as VendorBridgeSettings);
    } catch (error: unknown) {
      setVendorTemplateResult({
        ok: false,
        error: error instanceof Error ? error.message : "Could not load bridge settings.",
      });
    } finally {
      setVendorSettingsLoading(false);
    }
  }, [selectedVendorPackId]);

  async function saveVendorSettings() {
    if (!selectedVendorPack || !vendorBridgeSettings) return;
    setVendorSettingsSaving(true);
    setVendorTemplateResult(null);

    try {
      const response = await fetch(`/api/local-agent/device/vendor-packs/${selectedVendorPack.id}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vendorBridgeSettings),
      });
      const data = (await response.json()) as VendorTemplateResult & { settings?: VendorBridgeSettings };
      if (!data.ok) throw new Error(data.error || "Could not save bridge settings.");
      setVendorBridgeSettings(data.settings || vendorBridgeSettings);
      setVendorTemplateResult(data);
      await loadVendorPacks();
    } catch (error: unknown) {
      setVendorTemplateResult({
        ok: false,
        error: error instanceof Error ? error.message : "Could not save bridge settings.",
      });
    } finally {
      setVendorSettingsSaving(false);
    }
  }

  function updateVendorCommand(actionId: string, patch: Partial<VendorBridgeSettings["commands"][string]>) {
    setVendorBridgeSettings((current) => {
      if (!current) return current;
      return {
        ...current,
        commands: {
          ...current.commands,
          [actionId]: {
            ...current.commands[actionId],
            ...patch,
          },
        },
      };
    });
  }

  useEffect(() => {
    void loadVendorPacks();
  }, []);

  useEffect(() => {
    void loadVendorSettings(selectedVendorPackId);
  }, [loadVendorSettings, selectedVendorPackId]);

  useEffect(() => {
    const pack = vendorPacks.find((candidate) => candidate.id === selectedVendorPackId);
    if (pack?.actions[0] && !pack.actions.some((action) => action.id === selectedVendorActionId)) {
      setSelectedVendorActionId(pack.actions[0].id);
    }
  }, [selectedVendorActionId, selectedVendorPackId, vendorPacks]);

  useEffect(() => {
    setVendorActionResult(null);
    setVendorTemplateResult(null);
  }, [selectedVendorPackId, selectedVendorActionId]);

  useEffect(() => {
    const sessionId = captureState?.session?.id;
    const status = captureState?.session?.status;
    if (!sessionId || status === "closed" || status === "error") return;

    const timer = window.setInterval(() => {
      void refreshCapture(sessionId);
    }, 1800);

    return () => window.clearInterval(timer);
  }, [captureState?.session?.id, captureState?.session?.status, refreshCapture]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950 px-6 py-5 text-white">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-300">
              <Usb size={16} />
              Device Lab
            </div>
            <h3 className="mt-1 text-2xl font-bold">Payment Terminal Diagnostics</h3>
            <p className="mt-1 text-sm text-slate-300">
              Live USB/COM recognition, IP terminal debugging, and swipe/tap/insert capture.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Scan
            </button>
            <button
              type="button"
              onClick={onDownloadBundle}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500"
            >
              <Download size={16} />
              Bundle
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-6">
          {result?.error && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {result.error}
            </div>
          )}

          <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-bold text-slate-950">
                  <Usb size={18} className="text-blue-600" />
                  Connected Local Payment Devices
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Only currently connected likely payment USB/HID/COM devices are shown. Old disconnected Windows records are ignored.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{comPorts.length} COM</span>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700">
                  {usbDevices.length + hidDevices.length} USB/HID
                </span>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{issues.length} issue(s)</span>
              </div>
            </div>

            {connectedDeviceCount ? (
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {[...comPorts, ...usbDevices, ...hidDevices].slice(0, 10).map((device, index) => {
                  const id = deviceId(device);
                  const isCom = /^COM\d+$/i.test(id);
                  return (
                    <article key={`${id}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="font-bold text-slate-950">{deviceName(device)}</div>
                      <div className="mt-1 break-all font-mono text-xs leading-5 text-slate-500">{id}</div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
                        <span className="rounded-full bg-white px-3 py-1 text-slate-600">
                          Status: {textValue(device.Status)}
                        </span>
                        {isCom && (
                          <button
                            type="button"
                            onClick={() => {
                              setCaptureMode("serial");
                              setSerialPath(id);
                            }}
                            className="rounded-full bg-blue-600 px-3 py-1 text-white transition hover:bg-blue-500"
                          >
                            Capture on {id}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-6 text-slate-600">
                No connected payment USB/HID/COM reader was detected. You can still enter a COM port manually or use TCP/IP
                capture for network terminals.
              </div>
            )}
          </section>

          <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex items-center gap-2 font-bold text-slate-950">
                <Keyboard size={18} className="text-indigo-600" />
                USB Keyboard-Wedge Capture
              </div>
              <p className="mt-1 text-sm text-slate-500">
                If your reader appears as a USB Input Device, click the box below, then swipe/tap/insert. Some readers type
                the card payload like a keyboard, with no SDK required.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-[360px_1fr]">
              <div>
                <textarea
                  value={wedgeInput}
                  onChange={(event) => setWedgeInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitKeyboardWedgeCapture();
                    }
                  }}
                  placeholder="Focus here, then swipe/tap/insert a test card..."
                  className="h-28 w-full resize-none rounded-xl border border-slate-300 bg-white p-3 font-mono text-sm shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => commitKeyboardWedgeCapture()}
                    disabled={!wedgeInput.trim()}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <Keyboard size={16} />
                    Capture Typed Data
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWedgeInput("");
                      setWedgeCaptures([]);
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {wedgeCaptures.length ? (
                  <div className="max-h-72 space-y-3 overflow-auto">
                    {wedgeCaptures.map((capture) => (
                      <article key={capture.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
                            keyboard wedge
                          </span>
                          <span className="text-xs font-semibold text-slate-400">
                            {new Date(capture.at).toLocaleTimeString()}
                          </span>
                        </div>
                        <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
                          {capture.findings.map((finding) => (
                            <li key={finding}>{finding}</li>
                          ))}
                        </ul>
                        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-xs leading-5 text-green-200">
                          {capture.redacted}
                        </pre>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm leading-6 text-slate-500">
                    No keyboard-wedge data captured yet. This works only if the reader types output into the focused box.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex items-center gap-2 font-bold text-slate-950">
                <Network size={18} className="text-blue-600" />
                IP / LAN Terminal Probe
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Enter a terminal IP/host to test common payment ports and get concrete reachability/debugging results.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-[1fr_260px]">
              <input
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="Terminal IP or hostname, e.g. 192.168.1.50"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={probeNetworkTerminal}
                disabled={probeLoading || !host.trim()}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {probeLoading ? <RefreshCw size={16} className="animate-spin" /> : <Activity size={16} />}
                Probe Terminal
              </button>
            </div>
            {probeResult && (
              <div className="border-t border-slate-200 p-5">
                <div
                  className={`rounded-2xl border p-4 text-sm ${
                    probeResult.ok && probeResult.openPorts?.length
                      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                      : "border-amber-200 bg-amber-50 text-amber-950"
                  }`}
                >
                  <div className="font-bold">
                    {probeResult.ok
                      ? probeResult.openPorts?.length
                        ? `Reachable on port(s): ${probeResult.openPorts.join(", ")}`
                        : "No tested terminal ports responded"
                      : probeResult.error || "Probe failed"}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(probeResult.ports || []).map((port) => (
                      <span
                        key={port.port}
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          port.open ? "bg-emerald-600 text-white" : "bg-white/80 text-slate-600"
                        }`}
                      >
                        {port.port}: {port.open ? "open" : "closed"}
                      </span>
                    ))}
                  </div>
                  {probeResult.hints?.length ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5">
                      {probeResult.hints.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
              <div className="flex items-center gap-2 font-bold">
                <CreditCard size={18} className="text-cyan-300" />
                Device Capture Lab
              </div>
              <p className="mt-1 text-sm text-slate-300">
                Capture test-card output from TCP/IP or COM payment devices. PayFix masks likely PAN/track data before showing it.
              </p>
            </div>
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm leading-6 text-amber-950">
              <div className="flex gap-2">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <span className="font-bold">Important:</span> generic COM/TCP capture listens to bytes. It does not
                  start a vendor payment flow by itself. If the device requires ID TECH, Verifone, Ingenico, PAX, or
                  gateway SDK commands to prompt tap/insert, you must trigger that flow from the vendor app/protocol
                  while PayFix captures the output.
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-[360px_1fr]">
              <div className="space-y-4">
                <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                  {(["tcp", "serial"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setCaptureMode(mode)}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${
                        captureMode === mode ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                      }`}
                    >
                      {mode === "tcp" ? "TCP/IP" : "COM Serial"}
                    </button>
                  ))}
                </div>

                {captureMode === "tcp" ? (
                  <div className="grid grid-cols-[1fr_110px] gap-2">
                    <input
                      value={captureHost}
                      onChange={(event) => setCaptureHost(event.target.value)}
                      placeholder="Terminal IP"
                      className="h-11 rounded-xl border border-slate-300 px-3 text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    />
                    <input
                      value={capturePort}
                      onChange={(event) => setCapturePort(event.target.value)}
                      placeholder="Port"
                      className="h-11 rounded-xl border border-slate-300 px-3 text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_120px] gap-2">
                      <input
                        value={serialPath}
                        onChange={(event) => setSerialPath(event.target.value)}
                        placeholder="COM1, COM3..."
                        className="h-11 rounded-xl border border-slate-300 px-3 text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                      />
                      <input
                        value={serialBaudRate}
                        onChange={(event) => setSerialBaudRate(event.target.value)}
                        placeholder="9600"
                        className="h-11 rounded-xl border border-slate-300 px-3 text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                      />
                    </div>
                    {comPorts.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {comPorts.slice(0, 6).map((port, index) => {
                          const deviceId = textValue(port.DeviceID);
                          return (
                            <button
                              key={`${deviceId}-${index}`}
                              type="button"
                              onClick={() => setSerialPath(deviceId)}
                              className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"
                            >
                              {deviceId}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={startCapture}
                    disabled={captureLoading}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-500 disabled:bg-slate-300"
                  >
                    <Radio size={16} className={captureLoading ? "animate-pulse" : ""} />
                    Start Capture
                  </button>
                  <button
                    type="button"
                    onClick={() => refreshCapture()}
                    disabled={!captureState?.session?.id}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw size={16} />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={stopCapture}
                    disabled={!captureState?.session?.id || captureLoading}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <Square size={15} />
                    Stop
                  </button>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Send test command</div>
                  <textarea
                    value={sendPayload}
                    onChange={(event) => setSendPayload(event.target.value)}
                    placeholder="Optional command or hex bytes to send to device..."
                    className="h-20 w-full resize-none rounded-xl border border-slate-300 p-3 font-mono text-sm shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      value={sendEncoding}
                      onChange={(event) => setSendEncoding(event.target.value as "text" | "hex")}
                      className="h-10 rounded-xl border border-slate-300 px-3 text-sm font-bold"
                    >
                      <option value="text">Text</option>
                      <option value="hex">Hex</option>
                    </select>
                    <button
                      type="button"
                      onClick={sendToDevice}
                      disabled={!captureState?.session?.id || !sendPayload || captureLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Send size={16} />
                      Send
                    </button>
                  </div>
                </div>
              </div>

              <div className="min-h-[420px] rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {captureState?.error && (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                    {captureState.error}
                  </div>
                )}

                {captureState?.session ? (
                  <>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white">
                        {captureState.session.label}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          captureState.session.status === "connected"
                            ? "bg-emerald-100 text-emerald-700"
                            : captureState.session.status === "error"
                              ? "bg-rose-100 text-rose-700"
                              : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {captureState.session.status}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600">
                        {captureState.session.eventCount} event(s)
                      </span>
                    </div>
                    {captureState.session.status === "connected" &&
                      !(captureState.events || []).some((event) => event.direction === "in") && (
                        <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-950">
                          Connected and waiting. Now tap/swipe/insert a test card, or trigger the transaction from the
                          vendor/payment app. If nothing appears, this device likely requires vendor SDK/protocol commands
                          or uses keyboard-wedge/HID output instead of this COM/TCP stream.
                        </div>
                      )}
                  </>
                ) : (
                  <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-950">
                    Start capture, then swipe/tap/insert a test card. If the device outputs data to this connection,
                    PayFix will show redacted ASCII, hex, and analysis here.
                  </div>
                )}

                <div className="max-h-[560px] space-y-3 overflow-auto">
                  {(captureState?.events || []).length ? (
                    captureState?.events?.map((event) => (
                      <article key={event.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-700">
                              {event.direction}
                            </span>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                              {event.analysis.kind}
                            </span>
                            {event.analysis.sensitiveDataRedacted && (
                              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                PAN redacted
                              </span>
                            )}
                          </div>
                          <span className="text-xs font-semibold text-slate-400">
                            {new Date(event.at).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-semibold text-slate-900">{event.analysis.summary}</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                          {event.analysis.findings.map((finding) => (
                            <li key={finding}>{finding}</li>
                          ))}
                        </ul>
                        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                          <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-xs leading-5 text-green-200">
                            {event.redacted || "(no printable text)"}
                          </pre>
                          <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-3 text-xs leading-5 text-cyan-200">
                            {event.rawHex || "(no bytes)"}
                          </pre>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
                      No captured device data yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex items-center gap-2 font-bold text-slate-950">
                <PackageCheck size={18} className="text-violet-600" />
                Vendor SDK Command Packs
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Use these when the terminal needs a vendor SDK/protocol call from this PC to prompt tap, swipe,
                insert, status, or sale.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-[360px_1fr]">
              <div className="space-y-3">
                <select
                  value={selectedVendorPackId}
                  onChange={(event) => setSelectedVendorPackId(event.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold shadow-sm focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                >
                  {vendorPacks.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.vendor} ({vendorPackStatusLabel(pack)})
                    </option>
                  ))}
                </select>

                <select
                  value={selectedVendorAction?.id || ""}
                  onChange={(event) => setSelectedVendorActionId(event.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold shadow-sm focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                >
                  {(selectedVendorPack?.actions || []).map((action) => (
                    <option key={action.id} value={action.id}>
                      {action.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={runVendorAction}
                  disabled={!selectedVendorPack || !selectedVendorAction || vendorActionLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <CreditCard size={16} />
                  {vendorActionLoading ? "Running..." : "Run Vendor Action"}
                </button>

                {selectedVendorPack && !selectedVendorPack.adapterInstalled && (
                  <button
                    type="button"
                    onClick={createVendorTemplate}
                    disabled={vendorTemplateLoading}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <PackageCheck size={16} />
                    {vendorTemplateLoading ? "Creating..." : "Create PC Bridge Template"}
                  </button>
                )}

                {selectedVendorPack && selectedVendorPack.adapterInstalled && !selectedVendorPack.adapterConfigured && (
                  <button
                    type="button"
                    onClick={createVendorConfig}
                    disabled={vendorConfigLoading}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-yellow-300 bg-yellow-50 px-4 text-sm font-bold text-yellow-900 shadow-sm transition hover:bg-yellow-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <PackageCheck size={16} />
                    {vendorConfigLoading ? "Creating..." : "Create Bridge Settings"}
                  </button>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {selectedVendorPack ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white">
                        {selectedVendorPack.vendor}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${vendorPackStatusClass(
                          selectedVendorPack,
                        )}`}
                      >
                        {vendorPackStatusLabel(selectedVendorPack)}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600">
                        {selectedVendorPack.connectionTypes.join(" / ")}
                      </span>
                    </div>

                    <div className="mt-3 text-sm leading-6 text-slate-700">
                      <div>
                        <span className="font-bold">Models:</span> {selectedVendorPack.models.join(", ")}
                      </div>
                      {selectedVendorAction && (
                        <div className="mt-2">
                          <span className="font-bold">Selected action:</span> {selectedVendorAction.description}
                        </div>
                      )}
                      <div className="mt-2">
                        <span className="font-bold">Connection passed to bridge:</span>{" "}
                        {captureMode === "tcp"
                          ? `${captureHost || "host not set"}:${capturePort || "port not set"}`
                          : `${serialPath || "COM port not set"} @ ${serialBaudRate || "baud not set"}`}
                      </div>
                      {!selectedVendorPack.adapterInstalled && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
                          Your terminal can already have the correct firmware/files. This missing piece is different:
                          PayFix needs a small PC-side bridge that calls the approved {selectedVendorPack.vendor} SDK or
                          protocol before it can start card reads or sales. Add that bridge here:
                          <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-green-200">
                            {selectedVendorPack.adapterPath}
                          </pre>
                          <p className="mt-2 text-xs leading-5 text-amber-900">
                            Once that file exists, this button will call the real SDK action instead of only listening to
                            COM/TCP bytes.
                          </p>
                        </div>
                      )}
                      {selectedVendorPack.adapterInstalled && !selectedVendorPack.adapterConfigured && (
                        <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-yellow-950">
                          The PC bridge file exists, but it cannot prompt the terminal yet because no SDK wrapper or
                          vendor command bytes are saved in PayFix Bridge Settings.
                          <div className="mt-2 text-xs font-bold uppercase tracking-wide text-yellow-800">
                            Bridge settings file
                          </div>
                          <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-green-200">
                            {selectedVendorPack.configPath}
                          </pre>
                          <p className="mt-2 text-xs leading-5 text-yellow-900">{selectedVendorPack.configReason}</p>
                        </div>
                      )}
                    </div>

                    {selectedVendorPack.adapterInstalled && (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-bold text-slate-950">PayFix Bridge Settings</div>
                            <p className="text-xs leading-5 text-slate-500">
                              These settings tell PayFix how your PC should talk to the terminal. They are not terminal
                              firmware or ID TECH device config files.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void loadVendorSettings()}
                            disabled={vendorSettingsLoading}
                            className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                          >
                            <RefreshCw size={14} />
                            {vendorSettingsLoading ? "Loading..." : "Reload"}
                          </button>
                        </div>

                        {vendorBridgeSettings ? (
                          <div className="mt-4 space-y-3">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_150px]">
                              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                SDK wrapper module path
                                <input
                                  value={vendorBridgeSettings.sdkModule}
                                  onChange={(event) =>
                                    setVendorBridgeSettings((current) =>
                                      current ? { ...current, sdkModule: event.target.value } : current,
                                    )
                                  }
                                  placeholder="Optional local SDK wrapper path"
                                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm normal-case tracking-normal text-slate-900 shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                                />
                              </label>
                              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                Timeout ms
                                <input
                                  type="number"
                                  min={1000}
                                  max={120000}
                                  value={vendorBridgeSettings.timeoutMs}
                                  onChange={(event) =>
                                    setVendorBridgeSettings((current) =>
                                      current ? { ...current, timeoutMs: Number(event.target.value) } : current,
                                    )
                                  }
                                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm normal-case tracking-normal text-slate-900 shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                                />
                              </label>
                            </div>

                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                {(["sdk", "hex", "text"] as const).map((mode) => (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setVendorCommandMode(mode)}
                                    className={`h-8 rounded-lg px-3 text-xs font-bold ${
                                      vendorCommandMode === mode
                                        ? "bg-slate-950 text-white"
                                        : "bg-white text-slate-600 hover:bg-slate-100"
                                    }`}
                                  >
                                    {mode === "sdk" ? "SDK Wrapper" : mode === "hex" ? "Protocol Hex" : "Protocol Text"}
                                  </button>
                                ))}
                              </div>

                              {selectedVendorAction && (
                                <div className="mt-3">
                                  {vendorCommandMode === "sdk" ? (
                                    <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                      SDK method for {selectedVendorAction.label}
                                      <input
                                        value={vendorBridgeSettings.sdkMethods[selectedVendorAction.id] || ""}
                                        onChange={(event) =>
                                          setVendorBridgeSettings((current) =>
                                            current
                                              ? {
                                                  ...current,
                                                  sdkMethods: {
                                                    ...current.sdkMethods,
                                                    [selectedVendorAction.id]: event.target.value,
                                                  },
                                                }
                                              : current,
                                          )
                                        }
                                        placeholder="startCardRead"
                                        className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm normal-case tracking-normal text-slate-900 shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                                      />
                                    </label>
                                  ) : (
                                    <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                      {vendorCommandMode === "hex" ? "Exact vendor command bytes" : "Exact vendor command text"} for{" "}
                                      {selectedVendorAction.label}
                                      <textarea
                                        value={
                                          vendorCommandMode === "hex"
                                            ? vendorBridgeSettings.commands[selectedVendorAction.id]?.hex || ""
                                            : vendorBridgeSettings.commands[selectedVendorAction.id]?.text || ""
                                        }
                                        onChange={(event) =>
                                          updateVendorCommand(
                                            selectedVendorAction.id,
                                            vendorCommandMode === "hex"
                                              ? { hex: event.target.value }
                                              : { text: event.target.value },
                                          )
                                        }
                                        placeholder={
                                          vendorCommandMode === "hex"
                                            ? "Paste approved hex bytes from vendor/protocol docs"
                                            : "Paste approved text command from vendor/protocol docs"
                                        }
                                        className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm normal-case tracking-normal text-slate-900 shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                                      />
                                    </label>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={saveVendorSettings}
                                disabled={vendorSettingsSaving}
                                className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                <PackageCheck size={16} />
                                {vendorSettingsSaving ? "Saving..." : "Save Bridge Settings"}
                              </button>
                              <p className="text-xs leading-5 text-slate-500">
                                After saving real SDK/protocol details, restart the local agent and run the vendor action.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                            Bridge settings are not loaded yet.
                          </div>
                        )}
                      </div>
                    )}

                    {vendorTemplateResult && (
                      <div
                        className={`mt-3 rounded-xl border p-3 text-sm leading-6 ${
                          vendorTemplateResult.ok
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-rose-200 bg-rose-50 text-rose-900"
                        }`}
                      >
                        <div className="font-bold">
                          {vendorTemplateResult.ok ? "Bridge template status" : "Bridge template failed"}
                        </div>
                        <div>{vendorTemplateResult.message || vendorTemplateResult.error}</div>
                        {vendorTemplateResult.adapterPath && (
                          <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-green-200">
                            {vendorTemplateResult.adapterPath}
                          </pre>
                        )}
                        {vendorTemplateResult.configPath && (
                          <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-green-200">
                            {vendorTemplateResult.configPath}
                          </pre>
                        )}
                      </div>
                    )}

                    {selectedVendorPack.notes.length > 0 && (
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
                        {selectedVendorPack.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    )}

                    {vendorActionResult && (
                      <pre
                        className={`mt-4 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl p-3 text-xs leading-5 ${
                          vendorActionResult.ok ? "bg-slate-950 text-green-200" : "bg-rose-950 text-rose-100"
                        }`}
                      >
                        {JSON.stringify(vendorActionResult, null, 2)}
                      </pre>
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
                    Vendor packs are loading. Restart the local agent if this stays empty.
                  </div>
                )}
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
