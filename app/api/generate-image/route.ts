import OpenAI, { toFile } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function imageSizeFromPrompt(prompt: string) {
  const explicit = prompt.match(/\b(1024x1024|1024x1536|1536x1024|512x512|256x256|1792x1024|1024x1792)\b/i)?.[1];
  if (explicit) return explicit;

  if (/\b(massive|large|big|high[-\s]?res|hi[-\s]?res|detailed)\b/i.test(prompt)) {
    if (/\b(wide|banner|landscape|hero|architecture|flowchart|diagram|blueprint)\b/i.test(prompt)) return "1536x1024";
    if (/\b(portrait|vertical|story|mobile|phone)\b/i.test(prompt)) return "1024x1536";
    return "1024x1024";
  }

  if (/\b(wide|banner|landscape|hero|architecture|flowchart|diagram|blueprint)\b/i.test(prompt)) return "1536x1024";
  if (/\b(portrait|vertical|story|mobile|phone)\b/i.test(prompt)) return "1024x1536";
  return "1024x1024";
}

function imageEditSizeFromPrompt(prompt: string) {
  if (/\b(wide|banner|landscape|hero|architecture|flowchart|diagram|blueprint|app map|site map|sitemap)\b/i.test(prompt)) {
    return "1536x1024";
  }

  if (/\b(portrait|vertical|story|mobile|phone)\b/i.test(prompt)) {
    return "1024x1536";
  }

  return "1024x1024";
}

function fileBaseName(prompt: string) {
  if (/\blogo\b/i.test(prompt)) return "payfix-logo";
  if (/\bicon|favicon\b/i.test(prompt)) return "payfix-icon";
  if (/\b(wireframe|mockup|prototype|sketch|dashboard|website|admin|app map|site map|sitemap|program map|system map|screen map|user flow|ux flow)\b/i.test(prompt)) return "payfix-ui-design";
  if (/\b(architecture|uml|erd|flowchart|diagram|blueprint)\b/i.test(prompt)) return "payfix-diagram";
  return "payfix-image";
}

function outputFormatFromPrompt(prompt: string) {
  if (/\b(jpe?g|jpg)\b/i.test(prompt)) return "jpeg";
  if (/\bwebp\b/i.test(prompt)) return "webp";
  return "png";
}

type InputImagePayload = {
  name?: string;
  type?: string;
  content?: string;
};

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?,(.*)$/);
  if (!match) throw new Error("Uploaded image content was not a valid data URL.");

  return {
    mime: match[1] || "image/png",
    buffer: Buffer.from(match[2] || "", "base64"),
  };
}

async function uploadableImages(inputImages: InputImagePayload[]) {
  return Promise.all(
    inputImages.slice(0, 4).map(async (image, index) => {
      if (!image.content) throw new Error("Uploaded image was missing image data.");

      const parsed = dataUrlToBuffer(image.content);
      const fallbackExtension = parsed.mime.includes("jpeg") ? "jpg" : parsed.mime.split("/")[1] || "png";
      const fileName = image.name || `reference-${index + 1}.${fallbackExtension}`;

      return toFile(parsed.buffer, fileName, {
        type: image.type || parsed.mime,
      });
    }),
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { prompt?: string; mode?: "generate" | "edit"; inputImages?: InputImagePayload[] };
    const prompt = body.prompt?.trim();
    if (!prompt) throw new Error("Tell PayFix what image or logo to generate.");

    const isLogo = /\blogo|icon|favicon|mark|monogram\b/i.test(prompt);
    const isDesignAsset = /\b(wireframe|mockup|prototype|diagram|flowchart|architecture diagram|uml|erd|entity relationship|sketch|blueprint|dashboard|website|admin|app map|site map|sitemap|program map|system map|screen map|user flow|ux flow)\b/i.test(prompt);
    const inputImages = Array.isArray(body.inputImages) ? body.inputImages.filter((image) => image.content) : [];
    const enhancedPrompt = isLogo
      ? `Create a premium, sophisticated, expensive-looking professional logo asset. ${prompt}. Make it visually strong and memorable, not generic clipart, not cheap, not childish. Use crisp edges, elegant composition, strong brand presence, balanced negative space, refined color, and no tiny unreadable text. Suitable for a serious software/payment/debugging product.`
      : isDesignAsset
        ? `Create a polished product-planning sketch for software builders. ${prompt}. Make it look like a sharp founder/engineer planning board: clean hand-drawn energy, readable labels, organized screen boxes, arrows, user flows, data/API notes, component boundaries, and implementation clues. Use strong contrast, restrained color accents, and no tiny unreadable text.`
      : prompt;
    const outputFormat = outputFormatFromPrompt(prompt);
    const response =
      body.mode === "edit" && inputImages.length
        ? await openai.images.edit({
            model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
            image: await uploadableImages(inputImages),
            prompt: `${enhancedPrompt}

Use the uploaded image(s) as the source/reference. Preserve the core identity, subject, layout intent, and recognizable brand/design cues unless the user explicitly asks to replace them. Improve quality, composition, crispness, and polish.`,
            size: imageEditSizeFromPrompt(prompt),
            quality: /\b(massive|large|big|high[-\s]?res|hi[-\s]?res|detailed|premium|professional|polished)\b/i.test(prompt)
              ? "high"
              : "medium",
            output_format: outputFormat,
            background: isLogo && outputFormat !== "jpeg" ? "transparent" : "auto",
            input_fidelity: "high",
            n: 1,
          })
        : await openai.images.generate({
            model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
            prompt: enhancedPrompt,
            size: imageSizeFromPrompt(prompt),
            quality: /\b(massive|large|big|high[-\s]?res|hi[-\s]?res|detailed)\b/i.test(prompt) ? "high" : "medium",
            output_format: outputFormat,
            background: isLogo && outputFormat !== "jpeg" ? "transparent" : "auto",
            n: 1,
          });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image generation finished without returning image data.");

    const bytes = Buffer.from(b64, "base64");
    const extension = outputFormat === "jpeg" ? "jpg" : outputFormat;
    const name = `${fileBaseName(prompt)}-${Date.now()}.${extension}`;

    return Response.json({
      ok: true,
      files: [
        {
          name,
          type: `image/${outputFormat}`,
          size: bytes.length,
          content: `data:image/${outputFormat};base64,${b64}`,
        },
      ],
      revisedPrompt: response.data?.[0]?.revised_prompt || enhancedPrompt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Image generation failed.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
