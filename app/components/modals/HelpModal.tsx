import { HelpCircle, X } from "lucide-react";

type HelpModalProps = {
  onClose: () => void;
};

const sections = [
  {
    title: "Regular Chat",
    body: "Use for reading and explaining evidence: screenshots, images, logs, TLV/EMV, gateway responses, pasted code snippets, image conversion, and quick technical questions. It can inspect attached context but should not modify your project.",
    examples: ["Compare these two logs", "What does this screenshot show?", "Explain this gateway error", "Decode this EMV tag"],
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
    body: "Use only when you want engineering work that Regular Chat should not do: connected-project inspection, file edits, patches, validation, installs, generated projects, Visual Fix, or multi-file codebase work.",
    examples: ["Fix this payment form bug in the project", "Apply a safe patch", "Run validation after changing files", "Install a missing dependency after approval"],
  },
  {
    title: "Payment Trace",
    body: "Use when you have a real payment flow across device read, EMV/TLV, SDK event, app request, gateway response, webhook, database update, UI state, or device logs.",
    examples: ["Build a trace from these request/response logs", "Find missing webhook", "Detect duplicate gateway event", "Compare gateway status with DB status"],
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="pf-panel flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--pf-border)] px-6 py-5">
          <div>
            <div className="flex items-center gap-2 pf-section-label text-sky-400">
              <HelpCircle size={16} />
              PayFix Help
            </div>
            <h3 className="mt-1 text-2xl font-bold text-[var(--pf-text)]">How to use this workspace</h3>
          </div>
          <button type="button" onClick={onClose} className="pf-btn-ghost h-10 px-4">
            <X size={16} />
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {sections.map((section) => (
              <section
                key={section.title}
                className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-white/[0.03] p-5"
              >
                <h4 className="text-lg font-bold text-[var(--pf-text)]">{section.title}</h4>
                <p className="mt-2 text-sm leading-6 text-[var(--pf-text-muted)]">{section.body}</p>
                <div className="mt-4 pf-section-label">Examples</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-[var(--pf-text-muted)]">
                  {section.examples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <section className="mt-5 rounded-[var(--pf-radius)] border border-sky-500/25 bg-sky-500/10 p-5 text-sm leading-6 text-sky-100">
            <div className="font-bold text-sky-50">A good rule</div>
            <p className="mt-1 text-sky-100/90">
              Ask Regular Chat when you want understanding. Use Run Agent when you want project changes. Use Payment Trace when
              you have multiple payment-flow events. Use EMV Decoder when the input is raw card/device TLV. Use Device Lab
              when the problem may be a reader, USB, COM port, or driver issue.
            </p>
          </section>

          <section className="mt-5 rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-white/[0.03] p-5 text-sm leading-6 text-[var(--pf-text-muted)]">
            <div className="font-bold text-[var(--pf-text)]">First-time setup</div>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Start the local agent in the <span className="font-mono text-sky-300">payfix-agent</span> folder.
              </li>
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
