const LOCAL_AGENT_BASE = "http://localhost:7777";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

async function proxyToLocalAgent(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(`${LOCAL_AGENT_BASE}/${path.map(encodeURIComponent).join("/")}`);
  targetUrl.search = sourceUrl.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
    });
    const responseText = await response.text();
    const responseContentType = response.headers.get("content-type") || "application/json";

    if (!responseContentType.includes("application/json")) {
      return Response.json(
        {
          ok: false,
          error: `Local agent returned ${responseContentType || "non-JSON"} for /${path.join("/")}. ${
            response.status === 404
              ? "The running payfix-agent may be old or missing this endpoint. Restart payfix-agent and try again."
              : responseText.replace(/\s+/g, " ").slice(0, 220)
          }`,
        },
        { status: response.ok ? 502 : response.status },
      );
    }

    return new Response(responseText, {
      status: response.status,
      headers: {
        "content-type": responseContentType,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Local agent is not reachable.";

    return Response.json(
      {
        ok: false,
        error: `Local agent is not reachable at ${LOCAL_AGENT_BASE}. ${message}`,
      },
      { status: 502 },
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxyToLocalAgent(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxyToLocalAgent(request, context);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
