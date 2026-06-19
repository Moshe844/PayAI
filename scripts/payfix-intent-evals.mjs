function isImageGenerationRequest(text) {
  const asksForGuidance =
    /\b(step by step|instructions?|where do i go|where to start|how to build|how do i build|what do i need|roadmap|plan|guide|explain|tell me|from here|next steps?|developer portal|resources|api docs?|documentation|integrat(?:e|ion)|implementation guidance)\b/i.test(
      text,
    );
  const explicitlyRequestsVisualAsset =
    /\b(generate|create|make|draw|sketch|design|produce|give me|download|draft|render)\b/i.test(text) &&
    /\b(image|picture|logo|icon|favicon|illustration|wireframe|mockup|prototype|diagram|flowchart|architecture diagram|uml|erd|entity relationship|blueprint|app map|site map|sitemap|program map|system map|screen map|user flow|ux flow|visual sketch|downloadable asset)\b/i.test(
      text,
    );
  const wantsVisualPlan =
    /\b(sketch|draw|visualize|wireframe|mockup|map out|blueprint|diagram|design)\b/i.test(text) &&
    /\b(website|dashboard|app|application|program|screen|page|ui|ux|interface|layout|flow|map|inventory|shop|saas|admin|portal|system)\b/i.test(text);

  return (
    !asksForGuidance &&
    (wantsVisualPlan || explicitlyRequestsVisualAsset) &&
    !/\b(convert|export|change format|to jpg|to jpeg|to png|to webp|resize|upscale|enlarge|crop)\b/i.test(text)
  );
}

const cases = [
  {
    name: "PAX app build instructions must not generate image",
    text: "I want to build an app on PAX android device A920 with POS checkout and tokenized payments. Where do I go from here? Please give me step by step instructions how to build it.",
    expected: false,
  },
  {
    name: "Explicit UI sketch should generate image",
    text: "Can you sketch a full website dashboard wireframe for an inventory shop?",
    expected: true,
  },
  {
    name: "Explicit logo image should generate image",
    text: "Generate a downloadable logo image for PayFix.",
    expected: true,
  },
  {
    name: "Implementation plan for app should not generate image",
    text: "Create a plan for building a POS app and explain the API integration steps.",
    expected: false,
  },
];

let failed = false;
for (const testCase of cases) {
  const actual = isImageGenerationRequest(testCase.text);
  const ok = actual === testCase.expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${testCase.name}`);
  if (!ok) {
    failed = true;
    console.log(`  expected=${testCase.expected} actual=${actual}`);
  }
}

if (failed) process.exitCode = 1;
