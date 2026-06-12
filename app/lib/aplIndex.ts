import http from "node:http";
import https from "node:https";

export type AplSource = {
  state: string;
  url: string;
  note: string;
};

export type AplRow = {
  upc: string;
  normalizedUpc: string;
  description: string;
  category: string;
  raw: string;
  sourceState: string;
  sourceUrl: string;
};

export type AplLookupResult = {
  upc: string;
  normalizedUpc: string;
  status: "found on APL" | "not found on APL" | "replacement/new UPC found" | "unknown/not verified";
  sourceState: string;
  sourceUrl: string;
  matchedRows: AplRow[];
  replacementCandidates: AplRow[];
  evidence: string;
};

export type AplIndexResult = {
  sources: {
    state: string;
    url: string;
    rowCount: number;
    status: "indexed" | "failed" | "skipped";
    note: string;
  }[];
  lookups: AplLookupResult[];
  summary: string;
};

type CachedApl = {
  rows: AplRow[];
  indexedAt: number;
};

const cache = new Map<string, Promise<CachedApl>>();
const cacheTtlMs = 1000 * 60 * 60 * 12;
const maxAplDownloadBytes = 25 * 1024 * 1024;
let pdfWorkerConfigured = false;

async function loadPdfParser() {
  const [{ PDFParse }, { getData: getPdfWorkerData }] = await Promise.all([
    import("pdf-parse"),
    import("pdf-parse/worker"),
  ]);

  if (!pdfWorkerConfigured) {
    PDFParse.setWorker(getPdfWorkerData());
    pdfWorkerConfigured = true;
  }

  return PDFParse;
}

function digitsOnly(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function trimLeadingZeros(value: string) {
  return value.replace(/^0+/, "") || value;
}

function upcVariants(upc: string) {
  const digits = digitsOnly(upc);
  const variants = new Set<string>();
  if (!digits) return [];

  variants.add(digits);
  variants.add(trimLeadingZeros(digits));
  if (digits.length < 12) variants.add(digits.padStart(12, "0"));
  if (digits.length < 13) variants.add(digits.padStart(13, "0"));
  if (digits.length < 14) variants.add(digits.padStart(14, "0"));

  return [...variants].filter(Boolean);
}

function lineLooksLikeAplRow(line: string) {
  return /^\s*\d{8,14}\s+\S/.test(line) || /\b\d{8,14}\b\s+.{4,}/.test(line);
}

function extractRowsFromText(text: string, source: AplSource) {
  const rows: AplRow[] = [];
  const seen = new Set<string>();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!lineLooksLikeAplRow(line)) continue;

    const upcMatch = line.match(/\b\d{8,14}\b/);
    if (!upcMatch) continue;

    const upc = upcMatch[0];
    const afterUpc = line.slice(line.indexOf(upc) + upc.length).trim();
    const categoryMatch = afterUpc.match(/\b(\d{2})\s+(\d{3})\s+(.+?)\s+([A-Z]{2,8}|OZ|CT|LB|GAL|QT|DOZ|PKG)\b/i);
    const key = `${source.state}|${source.url}|${upc}|${line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      upc,
      normalizedUpc: trimLeadingZeros(upc),
      description: categoryMatch ? afterUpc.slice(0, categoryMatch.index).trim() : afterUpc,
      category: categoryMatch ? `${categoryMatch[1]} ${categoryMatch[2]} ${categoryMatch[3]}`.trim() : "",
      raw: line,
      sourceState: source.state,
      sourceUrl: source.url,
    });
  }

  return rows;
}

function downloadWithNode(url: string, allowInsecureTls: boolean, redirectCount = 0): Promise<Buffer> {
  if (redirectCount > 4) return Promise.reject(new Error("Too many APL download redirects."));

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.get(
      parsed,
      {
        headers: {
          "user-agent": "PayFix-APL-Indexer/1.0",
          accept: "application/pdf,text/plain,text/csv,*/*",
        },
        ...(parsed.protocol === "https:" ? { rejectUnauthorized: !allowInsecureTls } : {}),
      },
      (response) => {
        const location = response.headers.location;
        if (location && [301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
          response.resume();
          const nextUrl = new URL(location, parsed).toString();
          downloadWithNode(nextUrl, allowInsecureTls, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (!response.statusCode || response.statusCode >= 400) {
          response.resume();
          reject(new Error(`APL download failed ${response.statusCode || "unknown"}.`));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxAplDownloadBytes) {
            request.destroy(new Error("APL download exceeded size limit."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );

    request.setTimeout(30000, () => request.destroy(new Error("APL download timed out.")));
    request.on("error", reject);
  });
}

async function downloadSource(url: string) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "user-agent": "PayFix-APL-Indexer/1.0" },
    });
    if (!response.ok) throw new Error(`APL download failed ${response.status} ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const allowTlsFallback = process.env.PAYFIX_ALLOW_INSECURE_APL_TLS !== "0";
    if (!allowTlsFallback || !/certificate|fetch failed|TLS|SSL|UNABLE_TO_VERIFY/i.test(message)) throw error;

    return downloadWithNode(url, true);
  }
}

async function sourceToText(source: AplSource) {
  const lower = source.url.toLowerCase();
  const data = await downloadSource(source.url);

  if (lower.endsWith(".pdf") || data.subarray(0, 4).toString() === "%PDF") {
    const PDFParse = await loadPdfParser();
    const parser = new PDFParse({ data });
    try {
      const result = await parser.getText();
      return result.text || "";
    } finally {
      await parser.destroy();
    }
  }

  return data.toString("utf8");
}

async function indexSource(source: AplSource) {
  const cached = cache.get(source.url);
  if (cached) {
    const resolved = await cached;
    if (Date.now() - resolved.indexedAt < cacheTtlMs) return resolved;
    cache.delete(source.url);
  }

  const promise = sourceToText(source).then((text) => ({
    rows: extractRowsFromText(text, source),
    indexedAt: Date.now(),
  }));
  cache.set(source.url, promise);
  return promise;
}

function indexRows(rows: AplRow[]) {
  const byVariant = new Map<string, AplRow[]>();
  for (const row of rows) {
    for (const variant of upcVariants(row.upc)) {
      const existing = byVariant.get(variant) || [];
      existing.push(row);
      byVariant.set(variant, existing);
    }
  }
  return byVariant;
}

function candidatePrefixes(upc: string) {
  const normalized = trimLeadingZeros(digitsOnly(upc));
  return [7, 6, 5]
    .map((length) => normalized.slice(0, length))
    .filter((prefix) => prefix.length >= 5);
}

function findReplacementCandidates(upc: string, rows: AplRow[]) {
  const normalized = trimLeadingZeros(digitsOnly(upc));
  const prefixes = candidatePrefixes(upc);

  return rows
    .filter((row) => {
      if (row.normalizedUpc === normalized) return false;
      return prefixes.some((prefix) => row.normalizedUpc.startsWith(prefix));
    })
    .slice(0, 8);
}

function describeRows(rows: AplRow[], limit = 3) {
  return rows
    .slice(0, limit)
    .map((row) => `${row.upc} ${row.description}${row.category ? ` (${row.category})` : ""}`)
    .join("; ");
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export async function lookupAplUpcs(upcs: string[], sources: AplSource[]): Promise<AplIndexResult> {
  const usableSources = sources.filter((source) => source.url);
  const sourceResults: AplIndexResult["sources"] = [];
  const indexedRows: AplRow[] = [];

  for (const source of usableSources) {
    try {
      const indexed = await indexSource(source);
      indexedRows.push(...indexed.rows);
      sourceResults.push({
        state: source.state,
        url: source.url,
        rowCount: indexed.rows.length,
        status: "indexed",
        note: `Indexed ${indexed.rows.length} APL UPC row(s).`,
      });
    } catch (error) {
      sourceResults.push({
        state: source.state,
        url: source.url,
        rowCount: 0,
        status: "failed",
        note: error instanceof Error ? error.message : "Failed to index APL source.",
      });
    }
  }

  for (const source of sources.filter((source) => !source.url)) {
    sourceResults.push({
      state: source.state,
      url: "",
      rowCount: 0,
      status: "skipped",
      note: source.note,
    });
  }

  const byVariant = indexRows(indexedRows);
  const lookups = [...new Set(upcs.map(digitsOnly).filter(Boolean))].map((upc) => {
    const variants = upcVariants(upc);
    const matchedRows = variants.flatMap((variant) => byVariant.get(variant) || []);
    const uniqueMatches = [...new Map(matchedRows.map((row) => [`${row.sourceUrl}|${row.upc}|${row.raw}`, row])).values()];
    const replacementCandidates = uniqueMatches.length ? [] : findReplacementCandidates(upc, indexedRows);
    const matchedStates = uniqueValues(uniqueMatches.map((row) => row.sourceState));
    const matchedUrls = uniqueValues(uniqueMatches.map((row) => row.sourceUrl));
    const candidateStates = uniqueValues(replacementCandidates.map((row) => row.sourceState));
    const candidateUrls = uniqueValues(replacementCandidates.map((row) => row.sourceUrl));
    const sourceUrl = matchedUrls[0] || candidateUrls[0] || usableSources[0]?.url || "";
    const sourceState =
      (matchedStates.length ? matchedStates : candidateStates).join(", ") || usableSources[0]?.state || "unknown";

    if (uniqueMatches.length) {
      return {
        upc,
        normalizedUpc: trimLeadingZeros(upc),
        status: "found on APL" as const,
        sourceState,
        sourceUrl,
        matchedRows: uniqueMatches,
        replacementCandidates: [],
        evidence: `Exact UPC match found in ${matchedStates.join(", ") || "indexed APL"}: ${describeRows(
          uniqueMatches,
          6,
        )}.`,
      };
    }

    if (replacementCandidates.length) {
      return {
        upc,
        normalizedUpc: trimLeadingZeros(upc),
        status: "replacement/new UPC found" as const,
        sourceState,
        sourceUrl,
        matchedRows: [],
        replacementCandidates,
        evidence: `Exact UPC was not found. Nearby UPC candidate(s) found in ${
          candidateStates.join(", ") || "indexed APL"
        }: ${describeRows(replacementCandidates, 6)}.`,
      };
    }

    return {
      upc,
      normalizedUpc: trimLeadingZeros(upc),
      status: indexedRows.length ? ("not found on APL" as const) : ("unknown/not verified" as const),
      sourceState,
      sourceUrl,
      matchedRows: [],
      replacementCandidates: [],
      evidence: indexedRows.length
        ? `Exact UPC ${upc} was not found in ${indexedRows.length} indexed APL row(s).`
        : "No APL rows were indexed, so the UPC could not be verified.",
    };
  });

  return {
    sources: sourceResults,
    lookups,
    summary: [
      sourceResults.length
        ? sourceResults
            .map((source) => `${source.state || "unknown"} ${source.status}: ${source.rowCount} row(s) ${source.url || ""}`)
            .join("\n")
        : "No APL sources were available.",
      lookups.length
        ? lookups.map((lookup) => `UPC ${lookup.upc}: ${lookup.status}. ${lookup.evidence}`).join("\n")
        : "No UPCs were extracted for APL lookup.",
    ].join("\n"),
  };
}
