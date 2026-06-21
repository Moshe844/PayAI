import OpenAI from "openai";

import { PAYFIX_BEST_ANSWER_STANDARD, PAYFIX_FOCUSED_ANSWER_STANDARD } from "../../lib/answerQuality";
import { payfixResponseConfig } from "../../lib/modelRouting";
import type { AgentFollowUpRoute } from "../../../lib/agentIntent";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ROUTES: AgentFollowUpRoute[] = [
  "focused-follow-up",
  "screenshot-review",
  "build-error",
  "project-error",
  "exact-next-steps",
  "generic",
];

function safeString(value: unknown, limit = 4000) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function validRoute(value: unknown): AgentFollowUpRoute {
  return ROUTES.includes(value as AgentFollowUpRoute) ? (value as AgentFollowUpRoute) : "generic";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = safeString(body.prompt, 3000);
    const previousAssistant = safeString(body.previousAssistant, 3000);
    const recentConversation = safeString(body.recentConversation, 6000);
    const uploadSummary = safeString(body.uploadSummary, 1800);
    const hasImages = Boolean(body.hasImages);
    const hasProject = Boolean(body.hasProject);
    const isPaxAndroidBuiltSession = Boolean(body.isPaxAndroidBuiltSession);

    const response = await openai.responses.create({
      ...payfixResponseConfig("agentFast", {
        text: {
          format: {
            type: "json_schema",
            name: "payfix_agent_turn_intent",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                route: {
                  type: "string",
                  enum: ROUTES,
                },
                reason: {
                  type: "string",
                },
                useImages: {
                  type: "boolean",
                  description:
                    "True only when the latest user message asks about current screenshots/images/visible evidence or the image is necessary for the request.",
                },
                shouldRunProjectValidation: {
                  type: "boolean",
                  description:
                    "True only when the user asks to fix/build/validate/check project errors or implementation work needs diagnostics.",
                },
              },
              required: ["route", "reason", "useImages", "shouldRunProjectValidation"],
            },
            strict: true,
          },
        },
      }),
      max_output_tokens: 450,
      input: [
        {
          role: "system",
          content: `You are PayFix's Agent turn router. Classify the latest user turn before any heavy Agent work starts.

${PAYFIX_BEST_ANSWER_STANDARD}
${PAYFIX_FOCUSED_ANSWER_STANDARD}

Routes:
- focused-follow-up: answer a specific question about a field, setting, path, menu, previous answer, wording, option, button, or local workflow. Use this for "I don't see X", "which is it using", "what do I enter", "is this right", or other human follow-ups.
- screenshot-review: the latest turn is asking PayFix to inspect/verify current screenshots or images against previous instructions.
- build-error: the latest turn provides or asks to fix a concrete build/sync/compile/dependency/tooling failure.
- project-error: the latest turn asks to find/fix project/runtime/source problems in a connected project.
- exact-next-steps: the latest turn asks what to do next after a result, without asking to patch/run/fix.
- generic: the latest turn asks for a new implementation/change/action that should go through the normal Agent project flow.

Critical behavior:
- The latest typed user sentence is the request. Uploaded files/screenshots/logs are supporting evidence unless the user explicitly asks to analyze the upload itself.
- First decide whether the latest turn is an information question, recommendation question, execution request, or project-change request. Do not route an information question into a patch/log-comparison flow.
- Treat short clarification turns like "what now", "where exactly", "please clarify", "what do I click", "which option", and "what exactly should I do" as dependent follow-ups. Resolve them against PREVIOUS ASSISTANT MESSAGE and RECENT CONVERSATION instead of starting a fresh task.
- Treat terse replies like "yes", "ok", "run", "check", "confirm", "verify", "fix", "apply", "continue", "again", "same", "this", "that", "those", "why", "where", "which", and "no" as contextual turns. Decide whether they refer to the previous answer, the current uploaded screenshots/files, the current project error, or a new action. Never route those terse replies to log/evidence comparison unless the previous/current context is actually log comparison.
- If the previous assistant listed commands, checks, patches, installs, generated files, or other executable actions and the latest user says "run those", "check them", "confirm", "do it", "go ahead", "proceed", "please execute", "make the update", "install it", "patch it", "generate it", or similar, route to build-error/project-error with shouldRunProjectValidation=true when a project is connected.
- If the user says they already completed a step ("already whitelisted", "already imported", "already added the SDK folder", "already connected", "I did that") and asks what remains, route focused-follow-up unless they explicitly ask PayFix to run validation/build/fix files.
- If the latest turn is a new project request, answer/action the current turn. Do not let stale history override the latest request.
- If the latest turn is a random/general question unrelated to project work, screenshots/files/log evidence, validation, dependencies, generated apps, or specialized PayFix tools, do not route it into project work.
- Do not route simple human follow-up questions to build-error just because older context contains a build failure.
- Do not use images just because old images exist. useImages=true only when the latest prompt references images/screenshots/visible UI or cannot be answered without them.
- If the latest prompt asks to implement, remove, add, patch, build, install, wire, validate, or fix project files, choose generic/project-error/build-error as appropriate.
- If the latest prompt asks what something means or where something is, choose focused-follow-up.
- If the user asks "what should I do", "how do I fix this", "what are my options", "what can be run", or "how can this be automated", classify from the current context: focused-follow-up for explanation/options, build-error/project-error when the natural next step is executable validation/patching, and exact-next-steps when they only need workflow steps.
- Larger tasks such as refactors, feature implementation, multi-file changes, generated apps, dependency installs, or long-running build/debug loops should remain in Agent mode and may recommend a dedicated Agent session.
- Sketches, wireframes, mockups, UI concepts, and diagrams are visual-generation/design flows. Follow-up edits to the latest design should stay connected to that latest generated visual.`,
        },
        {
          role: "user",
          content: `LATEST USER TURN:
${prompt || "(empty)"}

STATE:
- hasImages: ${hasImages}
- hasProject: ${hasProject}
- isGeneratedOrBuiltAppSession: ${isPaxAndroidBuiltSession}

CURRENT/POSSIBLE UPLOADS:
${uploadSummary || "No uploads."}

PREVIOUS ASSISTANT MESSAGE:
${previousAssistant || "None."}

RECENT CONVERSATION:
${recentConversation || "None."}`,
        },
      ],
    });

    const parsed = JSON.parse(response.output_text || "{}") as {
      route?: unknown;
      reason?: unknown;
      useImages?: unknown;
      shouldRunProjectValidation?: unknown;
    };

    return Response.json({
      ok: true,
      route: validRoute(parsed.route),
      reason: typeof parsed.reason === "string" ? parsed.reason : "Classified by PayFix Agent router.",
      useImages: Boolean(parsed.useImages),
      shouldRunProjectValidation: Boolean(parsed.shouldRunProjectValidation),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Intent classification failed.",
      },
      { status: 500 },
    );
  }
}
