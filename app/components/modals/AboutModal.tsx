import { CheckCircle2, HelpCircle, X } from "lucide-react";

type AboutModalProps = {
  onClose: () => void;
};

const capabilityGroups = [
  {
    title: "Chat and Context",
    items: [
      "Answer payment, coding, debugging, device, gateway, and integration questions.",
      "Read pasted logs, errors, code snippets, screenshots, uploaded files, and search results.",
      "Keep evidence-only analysis in regular chat instead of sending simple read/explain tasks to Agent mode.",
      "Keep uploaded images/files attached to the message that used them.",
      "Open uploaded images and text files in preview popups.",
      "Decode base64, JWT-like strings, encoded payloads, JSON, logs, and raw text.",
      "Convert uploaded images into requested output formats with downloadable files.",
      "Save conversations automatically and reopen previous chats from the sidebar.",
      "Edit a sent user message and regenerate the AI response from the corrected context.",
    ],
  },
  {
    title: "Project and Code Agent",
    items: [
      "Connect a local project folder through the local agent.",
      "Search files and text across the connected project or computer.",
      "Load project snippets into regular chat context.",
      "Run Agent to inspect exact files instead of guessing.",
      "Reject simple image/log reading tasks from Agent mode when Regular Chat can handle them.",
      "Select likely files, read them, reason from exact code, and propose patches.",
      "Create new files when the requested change requires new project files.",
      "Preview file changes before writing them.",
      "Apply one file or multiple generated files from the same response.",
      "Re-read files after applying changes.",
      "Run sandbox checks such as TypeScript, lint, tests, and build when available.",
      "Detect missing dependencies and ask before installing packages.",
      "Rollback the most recent applied change when a rollback snapshot exists.",
      "Open clickable file references such as Composer.tsx:482 in the project preview.",
      "Build a Project IQ view with memory, project map, runner, and watch mode.",
      "Watch a file for changes and show diffs, added/removed lines, and simple diagnostics.",
    ],
  },
  {
    title: "Browser and UI Debugging",
    items: [
      "Inspect a running localhost app with Playwright.",
      "Capture a screenshot of the running app.",
      "Read DOM structure, forms, buttons, links, images, and layout dimensions.",
      "Collect console messages, page errors, failed requests, request bodies, and response bodies.",
      "Detect layout overflow, clipped UI, missing alt text, and visual target candidates.",
      "Link inspected localhost ports back to likely project folders when possible.",
      "Open a runner preview for HTML, CSS, and JavaScript snippets.",
      "Use Visual Fix Agent to detect bad contrast, spacing, overflow, and likely CSS/component sources.",
    ],
  },
  {
    title: "Payment Trace and Gateway Tools",
    items: [
      "Build payment-specific traces from logs, HAR files, payloads, screenshots, and gateway responses.",
      "Reconstruct device read, EMV/TLV, SDK event, app request, gateway response, webhook, database, UI, and final decision stages.",
      "Detect missing stages, duplicate events, status mismatches, webhook gaps, and long timeout gaps.",
      "Extract transaction IDs, order IDs, gateway names, statuses, amounts, and evidence.",
      "Decode EMV/TLV blobs separately from full payment traces.",
      "Open EMV Decoder when the input is device/TLV evidence rather than a full transaction flow.",
      "Decode common EMV tags and highlight limitations instead of inventing unsupported decline causes.",
      "Show root cause, investigation findings, fix actions, and recommended next steps in timelines.",
    ],
  },
  {
    title: "Webhook Lab",
    items: [
      "Simulate gateway webhook calls to local endpoints.",
      "Use vendor presets for Stripe, Authorize.Net, Cardknox, Square, Adyen, PayPal, and generic payloads.",
      "Generate common signature headers for testing local webhook handlers.",
      "Replay JSON payloads extracted from conversation logs.",
      "Discover likely webhook endpoints from connected project files.",
      "Compare webhook payloads against pasted DB/order/backend logs.",
      "Show replay status, response body, headers, timing, and request payload.",
    ],
  },
  {
    title: "Device Lab",
    items: [
      "Scan connected USB, HID, COM, and likely payment terminal records.",
      "Filter device data toward likely credit-card/payment devices.",
      "Check COM port and TCP/IP reachability for payment terminals.",
      "Capture raw output from COM/TCP devices when the terminal emits data.",
      "Capture keyboard-wedge reader output when a reader types card/device payloads.",
      "Mask likely PAN/track data before displaying captured payloads.",
      "Send optional test commands or hex bytes to a connected stream.",
      "Support vendor command-pack bridges for SDK-controlled terminals when a real SDK adapter is installed.",
      "Build a local support bundle with device, driver, registry, and diagnostic evidence.",
    ],
  },
  {
    title: "Safety and Workflow",
    items: [
      "Keep project actions local through the local agent.",
      "Do not apply patches until you confirm in the preview modal.",
      "Do not install dependencies until you approve the dependency popup.",
      "Show status toasts for success, warnings, errors, long-running actions, and validation results.",
      "Use Tools for specialized workflows and regular chat for explanations.",
    ],
  },
];

export default function AboutModal({ onClose }: AboutModalProps) {
  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/55 p-6">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-blue-600">
              <HelpCircle size={16} />
              About PayFix AI
            </div>
            <h3 className="mt-1 text-2xl font-black text-slate-950">What PayFix Can Do</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              A one-line capability list for the workspace, local agent, payment tools, and debugging tools.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-6">
          <div className="space-y-4">
            {capabilityGroups.map((group) => (
              <section key={group.title} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 font-black text-slate-950">
                  {group.title}
                </div>
                <div className="divide-y divide-slate-100">
                  {group.items.map((item) => (
                    <div key={item} className="flex items-start gap-3 px-5 py-2.5 text-sm leading-6 text-slate-700">
                      <CheckCircle2 size={16} className="mt-1 shrink-0 text-emerald-600" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
