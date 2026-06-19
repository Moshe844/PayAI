export const dynamic = "force-dynamic";

type BrowserCaptureLink = {
  text: string;
  href: string;
};

type BrowserCapturePayload = {
  id: string;
  capturedAt: string;
  source: "payfix-browser-extension";
  url: string;
  title: string;
  text: string;
  links: BrowserCaptureLink[];
  meta: {
    userAgent?: string;
    selectionText?: string;
  };
};

const captures: BrowserCapturePayload[] = [];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

function cleanString(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .slice(0, maxLength);
}

function normalizeLinks(value: unknown): BrowserCaptureLink[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      text: cleanString((item as BrowserCaptureLink)?.text, 260).replace(/\s+/g, " ").trim(),
      href: cleanString((item as BrowserCaptureLink)?.href, 2000).trim(),
    }))
    .filter((link) => link.href && /^https?:\/\//i.test(link.href))
    .slice(0, 400);
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<BrowserCapturePayload>;
    const url = cleanString(payload.url, 2000).trim();
    if (!/^https?:\/\//i.test(url)) {
      return Response.json({ ok: false, error: "A valid http/https page URL is required." }, { status: 400, headers: corsHeaders() });
    }

    const capture: BrowserCapturePayload = {
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      source: "payfix-browser-extension",
      url,
      title: cleanString(payload.title, 500).trim(),
      text: cleanString(payload.text, 120000).trim(),
      links: normalizeLinks(payload.links),
      meta: {
        userAgent: cleanString(payload.meta?.userAgent, 500).trim(),
        selectionText: cleanString(payload.meta?.selectionText, 10000).trim(),
      },
    };

    captures.unshift(capture);
    captures.splice(12);

    return Response.json({ ok: true, capture }, { headers: corsHeaders() });
  } catch (error: unknown) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not store browser capture." },
      { status: 400, headers: corsHeaders() },
    );
  }
}

export async function GET() {
  return Response.json({ ok: true, captures }, { headers: corsHeaders() });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
