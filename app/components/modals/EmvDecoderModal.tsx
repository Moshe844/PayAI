import { CreditCard, X } from "lucide-react";

import type { EmvTlvDecodeResult } from "../../lib/payfixTypes";

type EmvDecoderModalProps = {
  result: EmvTlvDecodeResult;
  onClose: () => void;
};

export default function EmvDecoderModal({ result, onClose }: EmvDecoderModalProps) {
  return (
    <div className="fixed inset-0 z-[260] flex items-start justify-center bg-black/55 p-6 backdrop-blur-sm">
      <div className="mt-4 flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-600">
              <CreditCard size={16} />
              EMV Decoder
            </div>
            <h3 className="mt-1 text-2xl font-bold">TLV Tag Analysis</h3>
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
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_1fr]">
            <aside className="space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="font-bold">Summary</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{result.summary}</p>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="font-bold">Key Signals</div>
                <Signal label="Cryptogram" value={result.signals.cryptogram} />
                <Signal label="Outcome" value={result.signals.outcome} />
                <Signal label="Auth Response" value={result.signals.authorizationResponse} />
                <Signal label="Application" value={result.signals.application} />
                <Signal label="Amount" value={result.signals.amount} />
                <Signal label="Currency" value={result.signals.currency} />
                <Signal label="TVR" value={result.signals.tvr} />
              </section>

              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <div className="font-bold text-amber-900">Limits</div>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-amber-900">
                  {result.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
                <div className="font-bold text-blue-900">Troubleshooting Steps</div>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-blue-900">
                  {result.nextSteps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </aside>

            <section className="space-y-5">
              {Boolean(result.suspectTags?.length) && (
                <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
                  <div className="font-bold text-rose-950">Tags To Look At First</div>
                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {result.suspectTags?.map((tag) => (
                      <div key={`${tag.tag}-${tag.value}`} className="rounded-xl bg-white p-4 ring-1 ring-rose-100">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-mono text-sm font-black text-rose-700">{tag.tag}</div>
                          <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-black uppercase text-rose-700">
                            {tag.severity}
                          </span>
                        </div>
                        <div className="mt-2 font-bold text-slate-950">{tag.title}</div>
                        <div className="mt-1 break-all font-mono text-xs text-slate-600">{tag.value}</div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{tag.meaning}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {Boolean(result.troubleshootingFindings?.length) && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="font-bold">Troubleshooting Findings</div>
                  <div className="mt-4 space-y-3">
                    {result.troubleshootingFindings?.map((finding) => (
                      <div key={`${finding.title}-${finding.evidence}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-bold text-slate-950">{finding.title}</div>
                          <span className="rounded-full bg-white px-2 py-1 text-xs font-black uppercase text-slate-600 ring-1 ring-slate-200">
                            {finding.severity}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{finding.detail}</p>
                        <div className="mt-2 rounded-lg bg-slate-950 px-3 py-2 font-mono text-xs text-emerald-200">
                          {finding.evidence}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold">Decoded Tags</div>
                  <p className="mt-1 text-sm text-slate-500">Unknown or proprietary tags are kept visible instead of guessed.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
                  {result.tags.length}
                </span>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Tag</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Value</th>
                      <th className="px-4 py-3">ASCII</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {result.tags.map((tag, index) => (
                      <tr key={`${tag.tag}-${tag.offset}-${index}`} className="align-top">
                        <td className="px-4 py-3 font-mono font-bold text-slate-950">{tag.tag}</td>
                        <td className="px-4 py-3 text-slate-700">{tag.name}</td>
                        <td className="max-w-[420px] break-all px-4 py-3 font-mono text-xs text-slate-700">{tag.value}</td>
                        <td className="max-w-[220px] break-words px-4 py-3 text-slate-500">{tag.ascii || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Signal({ label, value }: { label: string; value?: string }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 break-words rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
        {value || "Not present"}
      </div>
    </div>
  );
}
