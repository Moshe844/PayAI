type ColorToolModalProps = {
  cssFileName: string;
  setCssFileName: (value: string) => void;
  cssSelector: string;
  setCssSelector: (value: string) => void;
  cssProperty: string;
  setCssProperty: (value: string) => void;
  cssColor: string;
  setCssColor: (value: string) => void;
  cssFileMatches: string[];
  selectedCssFile: string;
  setSelectedCssFile: (value: string) => void;
  cssPreview: string;
  onClose: () => void;
  onFindCssFile: () => void;
  onPreviewCssColor: () => void;
  onApplyCssColor: () => void;
};

export default function ColorToolModal({
  cssFileName,
  setCssFileName,
  cssSelector,
  setCssSelector,
  cssProperty,
  setCssProperty,
  cssColor,
  setCssColor,
  cssFileMatches,
  selectedCssFile,
  setSelectedCssFile,
  cssPreview,
  onClose,
  onFindCssFile,
  onPreviewCssColor,
  onApplyCssColor,
}: ColorToolModalProps) {
  const inputClass =
    "mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm shadow-sm transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="p-6 pb-2">
            <div className="text-xs font-bold uppercase text-rose-600">Style editor</div>
            <h3 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">CSS Color Tool</h3>
            <p className="mt-1 text-sm text-slate-500">
              Inspector can prefill the selector and color. Find the CSS file, preview the diff, then apply.
            </p>
          </div>
          <button onClick={onClose} className="mr-6 rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-200">
            Close
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2">
          <div>
            <label className="text-sm font-semibold">CSS file name</label>
            <input
              value={cssFileName}
              onChange={(e) => setCssFileName(e.target.value)}
              placeholder="globals.css or app.css"
              className={inputClass}
            />
            <button onClick={onFindCssFile} className="mt-2 rounded-xl bg-slate-950 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-slate-800">
              Find CSS File
            </button>
          </div>

          <div>
            <label className="text-sm font-semibold">Matched file</label>
            <select
              value={selectedCssFile}
              onChange={(e) => setSelectedCssFile(e.target.value)}
              className={inputClass}
            >
              <option value="">Select file...</option>
              {cssFileMatches.map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold">Class / ID selector</label>
            <input
              value={cssSelector}
              onChange={(e) => setCssSelector(e.target.value)}
              placeholder=".button or #header"
              className={inputClass}
            />
          </div>

          <div>
            <label className="text-sm font-semibold">CSS property</label>
            <select
              value={cssProperty}
              onChange={(e) => setCssProperty(e.target.value)}
              className={inputClass}
            >
              <option value="color">color</option>
              <option value="background-color">background-color</option>
              <option value="border-color">border-color</option>
              <option value="box-shadow">box-shadow</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold">Choose color</label>
            <div className="mt-1 flex gap-3">
              <input
                type="color"
                value={cssColor}
                onChange={(e) => setCssColor(e.target.value)}
                className="h-12 w-16 rounded-xl border border-slate-300 bg-white p-1 shadow-sm"
              />
              <input
                value={cssColor}
                onChange={(e) => setCssColor(e.target.value)}
                className={`${inputClass} mt-0 font-mono`}
              />
              <div className="h-12 w-20 rounded-xl border border-slate-300 shadow-inner" style={{ backgroundColor: cssColor }} />
            </div>
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-200 bg-slate-50 px-6 py-5">
          <button onClick={onPreviewCssColor} className="rounded-xl bg-violet-600 px-5 py-2 font-semibold text-white shadow-sm transition hover:bg-violet-500">
            Preview Change
          </button>
          <button onClick={onApplyCssColor} className="rounded-xl bg-rose-600 px-5 py-2 font-semibold text-white shadow-sm transition hover:bg-rose-500">
            Apply Color
          </button>
        </div>

        {cssPreview && (
          <div className="mx-6 mb-6 mt-1 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-sm text-green-300 shadow-inner">
            <pre className="whitespace-pre-wrap">{cssPreview}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
