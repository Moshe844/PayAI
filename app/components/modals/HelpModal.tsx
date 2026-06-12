import { HelpCircle, X } from "lucide-react";

type HelpModalProps = {
  onClose: () => void;
};

const sections = [
  {
    title: "Regular Chat",
    body: "Use for explanations, screenshots, log review, decoding, image conversion, EMV questions, and quick technical help. It can read attached context but should not modify your project.",
    examples: ["Decode this base64/JWT", "What does this EMV tag mean?", "What is this screenshot showing?", "Explain this gateway error"],
  },
  {
    title: "Project Path",
    body: "Paste the full folder path for the project you want PayFix to inspect, then click Connect. Connecting only gives PayFix access through your local agent; it does not change files by itself.",
    examples: ["C:\\Users\\you\\Documents\\my-payment-app", "Connect before using project files", "If the path is wrong, reconnect with the correct folder"],
  },
  {
    title: "Use Project Files",
    body: "This loads relevant snippets from the connected project into regular chat context. Use it when you want the AI to understand the project, but not automatically patch files.",
    examples: ["Ask what files are in this project", "Explain where the checkout flow lives", "Review related code before I ask a follow-up"],
  },
  {
    title: "Search / Upload",
    body: "Search finds files or text on your computer through the local agent. Upload attaches logs, screenshots, configs, source files, encoded strings, or images directly to the message.",
    examples: ["Search for gatewayId", "Upload a screenshot and ask what changed", "Paste base64 and ask PayFix to decode it"],
  },
  {
    title: "Run Agent",
    body: "Use when a connected project needs inspection, patches, validation, or dependency checks. Agent mode reads exact files, proposes verified changes, and asks before installing packages.",
    examples: ["Find why my TypeScript project fails", "Fix this payment form bug", "Apply a safe patch", "Install a missing dependency after approval"],
  },
  {
    title: "Trace Timeline",
    body: "Use when you have a real payment flow across multiple systems: frontend submit, backend request, gateway response, webhook, database update, UI state, or device logs.",
    examples: ["Build a timeline from these request/response logs", "Find missing webhook", "Detect duplicate gateway event", "Compare gateway status with DB status"],
  },
  {
    title: "EMV Decoder",
    body: "Use for raw EMV/TLV hex. It decodes tags and highlights what can be concluded. A TLV blob alone often cannot prove a final issuer decline reason without host response data such as tag 8A.",
    examples: ["Decode this TLV", "Does this contain a decline reason?", "Show 9F27/DF8129/95/8A", "Explain ARQC vs decline"],
  },
  {
    title: "Device Lab",
    body: "Use for local terminal diagnostics. It scans USB, HID, COM ports, driver status, and likely payment-device records through the local agent without changing drivers or registry settings.",
    examples: ["Find connected ID TECH or Verifone devices", "Check COM port assignment", "Download a USB/driver support bundle", "Spot driver status problems"],
  },
  {
    title: "Live App Inspector",
    body: "Use when your app is running locally and something looks broken in the browser. It opens the localhost app in Playwright, captures a screenshot, reads DOM details, console messages, page errors, failed network requests, and layout overflow evidence.",
    examples: ["Inspect http://localhost:3000", "Find hydration warnings", "Show failed API requests", "Detect clipped or horizontally overflowing UI"],
  },
  {
    title: "Apply Changes",
    body: "When Agent mode has a safe patch, PayFix opens a preview showing what it found, the current file, and the new file. Review it first, then click Apply Changes to write it.",
    examples: ["Preview the diff before applying", "Do not apply if the file path looks wrong", "After apply, PayFix re-reads and validates when possible"],
  },
  {
    title: "Dependencies",
    body: "Dependency installs only happen in Agent mode and only after you approve them. If PayFix detects a missing package, it shows the package name, dependency type, and reason.",
    examples: ["Install missing uuid after approval", "Use npm/yarn/pnpm based on lockfile", "No package is installed from regular chat"],
  },
];

export default function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-600">
              <HelpCircle size={16} />
              PayFix Help
            </div>
            <h3 className="mt-1 text-2xl font-bold">How To Use This Workspace</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            <X size={16} />
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {sections.map((section) => (
              <section key={section.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h4 className="text-lg font-bold">{section.title}</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">{section.body}</p>
                <div className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">Examples</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                  {section.examples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <section className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-950">
            <div className="font-bold">A good rule</div>
            <p className="mt-1">
              Ask Regular Chat when you want understanding. Use Run Agent when you want project changes. Use Trace Timeline when
              you have multiple payment-flow events. Use EMV Decoder when the input is raw card/device TLV. Use Device Lab
              when the problem may be a reader, USB, COM port, or driver issue.
            </p>
          </section>

          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700">
            <div className="font-bold text-slate-950">First-time setup</div>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Start the local agent in the <span className="font-mono">payfix-agent</span> folder.</li>
              <li>Paste your project folder into Project Path and click Connect.</li>
              <li>Use Regular Chat for explanations, Use Project Files for context, or Run Agent for real code fixes.</li>
              <li>Attach screenshots/logs before sending when they are part of the problem.</li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
