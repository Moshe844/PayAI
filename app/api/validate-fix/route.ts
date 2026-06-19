import OpenAI from "openai";

import { payfixResponseConfig } from "../lib/modelRouting";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const question = String(body.question || "");
    const file = String(body.file || "");
    const appliedChange = String(body.appliedChange || "");
    const updatedContent = String(body.updatedContent || "");

    const response = await openai.responses.create({
      ...payfixResponseConfig("validation"),
      max_output_tokens: 1000,
      input: [
        {
          role: "system",
          content: `You are PayFix AI's patch validation step.

Validate only the updated file content provided. Do not assume other files changed.

Return:
- VALIDATED or NEEDS ATTENTION
- what changed
- whether the change appears to address the user's request
- any obvious remaining risk

Be concise and specific.`,
        },
        {
          role: "user",
          content: `USER REQUEST:
${question || "No original request was provided."}

UPDATED FILE:
${file}

APPLIED CHANGE:
${appliedChange}

UPDATED FILE CONTENT:
${updatedContent.slice(0, 70000)}`,
        },
      ],
    });

    return Response.json({
      ok: true,
      result: response.output_text?.trim() || "Validation completed, but no text was returned.",
    });
  } catch (error: unknown) {
    console.error(error);

    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Validation failed.",
      },
      { status: 500 },
    );
  }
}
