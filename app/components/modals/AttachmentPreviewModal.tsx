"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";

type AttachmentPreviewModalProps = {
  searchFileName: string;
  computerSearchResults: string;
  onClose: () => void;
};

type ProjectMatch = {
  file: string;
  line: number;
  text: string;
};

type ProjectFileContent = {
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

type ProjectFileListItem =
  | string
  | {
      file: string;
      readable?: boolean;
      textSearchable?: boolean;
      mime?: string;
      size?: number;
    };

type ProjectPreviewModalProps = {
  projectPath: string;
  projectFiles: ProjectFileContent[];
  projectMatches: ProjectMatch[];
  initialFileReference?: {
    file: string;
    line: number;
  } | null;
  onClose: () => void;
};

type CodeLogPreviewModalProps = {
  log: string;
  code: string;
  onClose: () => void;
};



export function AttachmentPreviewModal({
  searchFileName,
  computerSearchResults,
  onClose,
}: AttachmentPreviewModalProps & { uploadedImages?: { name: string; content: string; type: string }[] }) {
  const [modalImage, setModalImage] = useState<string | null>(null);

  // Extract image data from computerSearchResults if present (assuming JSON or similar structure)
  let images: { name: string; content: string; type: string }[] = [];
  try {
    const parsed = JSON.parse(computerSearchResults);
    if (Array.isArray(parsed.uploadedImages)) {
      images = parsed.uploadedImages;
    }
  } catch {}

  const hasTextPreview = computerSearchResults.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="text-xl font-bold">Attached Computer Search</h3>
            <p className="text-sm text-slate-500">
              {searchFileName || "Search results"} attached to AI context
            </p>
          </div>

          <button onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2 font-semibold">
            Close
          </button>
        </div>

        <div className="flex-1 overscroll-contain overflow-auto bg-slate-950 p-5">
          {images.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-4">
              {images.map((img) => (
                <div key={img.name} className="inline-block">
                  <Image
                    src={img.content}
                    alt={img.name}
                    width={120}
                    height={90}
                    className="cursor-pointer rounded border border-slate-400"
                    onClick={() => setModalImage(img.content)}
                  />
                  <div className="text-xs text-slate-200 text-center mt-1">{img.name}</div>
                </div>
              ))}
            </div>
          )}
          {hasTextPreview ? (
            <pre className="whitespace-pre-wrap break-words text-sm text-green-300">
              {computerSearchResults}
            </pre>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">
              No search preview is available here. Uploaded files open in their own file preview.
            </div>
          )}
        </div>
      </div>
      {modalImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setModalImage(null)}>
          <Image src={modalImage} alt="Preview" width={900} height={600} className="rounded-xl border border-white max-h-[80vh] max-w-[90vw] object-contain" />
        </div>
      )}
    </div>
  );
}

export function ProjectPreviewModal({
  projectPath,
  projectFiles,
  projectMatches,
  initialFileReference,
  onClose,
}: ProjectPreviewModalProps) {
  const [allFiles, setAllFiles] = useState<ProjectFileListItem[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [selectedContent, setSelectedContent] = useState<ProjectFileContent | null>(projectFiles[0] || null);
  const [selectedLine, setSelectedLine] = useState<number | null>(initialFileReference?.line || null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState("");

  const loadedByFile = useMemo(
    () => new Map(projectFiles.map((file) => [file.file, file])),
    [projectFiles],
  );

  const uniqueFiles = useMemo(() => {
    const files = new Map<string, ProjectFileListItem>();

    for (const file of allFiles) {
      const key = typeof file === "string" ? file : file.file;
      files.set(key, file);
    }

    for (const file of projectFiles) {
      files.set(file.file, {
        file: file.file,
        readable: true,
        textSearchable: file.kind === "text",
        mime: file.mime,
        size: file.size,
      });
    }

    return [...files.values()];
  }, [allFiles, projectFiles]);

  useEffect(() => {
    async function loadFiles() {
      try {
        const res = await fetch("/api/local-agent/files");
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Could not load project files.");
        setAllFiles(data.files || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Could not load project files.");
      }
    }

    loadFiles();
  }, []);

  const openFile = useCallback(async (filePath: string, line?: number) => {
    setSelectedFile(filePath);
    setSelectedLine(line || null);
    setError("");

    const alreadyLoaded = loadedByFile.get(filePath);
    if (alreadyLoaded) {
      setSelectedContent(alreadyLoaded);
      return;
    }

    setLoadingFile(true);
    try {
      const res = await fetch("/api/local-agent/project/read-file-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: filePath }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Could not read file.");
      setSelectedContent(data.file);
    } catch (err: unknown) {
      setSelectedContent(null);
      setError(err instanceof Error ? err.message : "Could not read file.");
    } finally {
      setLoadingFile(false);
    }
  }, [loadedByFile]);

  useEffect(() => {
    if (!initialFileReference?.file) return;
    const timer = window.setTimeout(() => {
      void openFile(initialFileReference.file, initialFileReference.line);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [initialFileReference?.file, initialFileReference?.line, openFile]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="flex h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="text-xl font-bold">Project Details</h3>
            <p className="mt-1 break-all text-sm text-slate-500">{projectPath}</p>
          </div>

          <button type="button" onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2 font-semibold">
            Close
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] overflow-hidden bg-slate-100">
          <aside className="min-h-0 overflow-auto border-r bg-white p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Files ({uniqueFiles.length})
            </div>

            <div className="mt-3 space-y-2">
              {uniqueFiles.map((item) => {
                const filePath = typeof item === "string" ? item : item.file;
                const fileName = filePath.split(/[\\/]/).pop() || filePath;
                const isSelected = selectedFile === filePath || selectedContent?.file === filePath;

                return (
                  <button
                    key={filePath}
                    type="button"
                      onClick={() => openFile(filePath)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                      isSelected
                        ? "border-blue-300 bg-blue-50 text-blue-950"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="truncate font-semibold">{fileName}</div>
                    {typeof item !== "string" && (
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {item.mime || "unknown"} - {Math.round((item.size || 0) / 1024)} KB
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden p-4">
            <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold">Matching Lines</div>
                  <p className="text-sm text-slate-500">
                    Keyword hits from the text search endpoint. Click a row to open that file.
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                  {projectMatches.length}
                </span>
              </div>

              <div className="mt-3 max-h-44 overflow-auto rounded-xl border border-slate-200">
                {projectMatches.length ? (
                  projectMatches.map((match, index) => (
                    <button
                      key={`${match.file}-${match.line}-${index}`}
                      type="button"
                      onClick={() => openFile(match.file, match.line)}
                      className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                    >
                      <div className="truncate font-semibold text-slate-800">
                        {match.file.split(/[\\/]/).pop()}:{match.line}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-slate-500">{match.text}</div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-6 text-sm text-slate-500">No keyword line matches were recorded.</div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b px-4 py-3">
                <div className="truncate font-bold">
                  {selectedContent?.file || selectedFile || "Select a file"}
                </div>
                {selectedContent && (
                  <div className="mt-1 text-sm text-slate-500">
                    {selectedContent.kind || "unknown"} - {selectedContent.mime || "unknown"} -{" "}
                    {Math.round((selectedContent.size || 0) / 1024)} KB
                    {selectedLine ? ` - line ${selectedLine}` : ""}
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-slate-950 p-4">
                {loadingFile && <div className="text-sm text-slate-300">Loading file...</div>}
                {error && <div className="rounded-xl bg-rose-100 p-3 text-sm font-semibold text-rose-700">{error}</div>}
                {!loadingFile && !error && selectedContent && (
                  <ProjectFileViewer file={selectedContent} selectedLine={selectedLine} />
                )}
                {!loadingFile && !error && !selectedContent && (
                  <div className="text-sm text-slate-300">Choose a file to preview it here.</div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ProjectFileViewer({ file, selectedLine }: { file: ProjectFileContent; selectedLine?: number | null }) {
  if (file.kind === "text") {
    const lines = (file.content || "This text file is empty.").split(/\r?\n/);

    return (
      <div className="font-mono text-sm leading-6 text-green-300">
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const isSelected = selectedLine === lineNumber;

          return (
            <div
              key={`${lineNumber}-${line.slice(0, 16)}`}
              className={`grid grid-cols-[56px_1fr] gap-3 rounded px-2 ${
                isSelected ? "bg-blue-500/25 text-white ring-1 ring-blue-300" : ""
              }`}
            >
              <span className="select-none text-right text-slate-500">{lineNumber}</span>
              <span className="whitespace-pre-wrap break-words">{line || " "}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (file.kind === "image" && file.base64 && file.mime) {
    return (
      <div className="space-y-4">
        <Image
          src={`data:${file.mime};base64,${file.base64}`}
          alt={file.file}
          width={900}
          height={600}
          unoptimized
          className="max-h-[60vh] max-w-full rounded-xl border border-slate-700 object-contain"
        />
        <FileMetadata file={file} />
      </div>
    );
  }

  if (file.kind === "audio" && file.base64 && file.mime) {
    return (
      <div className="space-y-4">
        <audio controls src={`data:${file.mime};base64,${file.base64}`} className="w-full" />
        <FileMetadata file={file} />
      </div>
    );
  }

  return <FileMetadata file={file} />;
}

function FileMetadata({ file }: { file: ProjectFileContent }) {
  return (
    <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
      {`FILE: ${file.file}
TYPE: ${file.kind || "unknown"}
MIME: ${file.mime || "unknown"}
SIZE: ${file.size || 0} bytes
ENCODING: ${file.encoding || "none"}
${file.note ? `NOTE: ${file.note}` : ""}`}
    </pre>
  );
}

export function CodeLogPreviewModal({ log, code, onClose }: CodeLogPreviewModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="text-xl font-bold">Attached Code / Log</h3>
            <p className="text-sm text-slate-500">Context sent with this message</p>
          </div>

          <button type="button" onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2 font-semibold">
            Close
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden bg-slate-100 p-5 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-white">
            <div className="border-b px-4 py-3 text-sm font-bold text-slate-700">Payment Log / Error</div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-slate-950 p-4 text-sm text-green-300">
              {log || "No log was attached to this message."}
            </pre>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-white">
            <div className="border-b px-4 py-3 text-sm font-bold text-slate-700">Related Code</div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-slate-950 p-4 text-sm text-blue-200">
              {code || "No code was attached to this message."}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
