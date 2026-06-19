const baseUrl = process.env.PAYFIX_EVAL_URL || "http://localhost:3000";

const cases = [
  {
    name: "Cardknox IDTech duplicate Tag 95",
    question: "Compare these logs. Mastercard is failing and Visa is approved. What sticks out?",
    uploadedFiles: [
      {
        name: "cardknox_visa_approved.txt",
        type: "text/plain",
        size: 360,
        isImage: false,
        content: [
          "08:28:45 SDK: DEVICE_STARTTRANSACTION",
          "08:28:49 SDK: ExecuteHttpRequestAsync: Parsing: form url encoded: content: raw content: xResult=A&xStatus=Approved&xError=&xErrorCode=00000&xRefNum=10937155076",
          "08:28:49 SDK: ExecuteHttpRequestAsync: Parsing: form url encoded: rest error?: unknown",
        ].join("\n"),
      },
      {
        name: "master_card_cardknox.txt",
        type: "text/plain",
        size: 420,
        isImage: false,
        content: [
          "11:42:23 SDK: DEVICE_STARTTRANSACTION",
          "11:42:23 SDK: DroidIDTechUSBService - FireMsrCardReadEvent - Exception",
          "11:42:23 SDK: DroidIDTechUSBService - An item with the same key has already been added. Key: 95",
          "11:42:23 SDK: IDTechUSBManager: CardReaderServiceErrorEventHandler: (Android_MsrCardRead_GenericError), 'An item with the same key has already been added. Key: 95'",
        ].join("\n"),
      },
    ],
    mustInclude: ["key: 95", "DroidIDTechUSBService", "Mastercard", "Visa", "approved"],
  },
  {
    name: "Chrome PNA/CORS provisional headers",
    question: "Their Chrome screenshot/log says Provisional headers are shown and Firefox shows Access-Control-Allow-Private-Network true. What is likely wrong?",
    log: [
      "Chrome DevTools: Provisional headers are shown",
      "Console: Access to fetch at https://localemv.com:8887/test from origin https://www.cardknox.com blocked by CORS policy",
      "Firefox response headers: Access-Control-Allow-Origin: https://posqa.pcsrcs.com",
      "Firefox response headers: Access-Control-Allow-Private-Network: true",
    ].join("\n"),
    mustInclude: ["CORS", "Chrome", "verify"],
    mustIncludeAny: [["Private Network", "PNA", "Local Network"]],
    mustAvoid: [
      "root cause is missing Access-Control-Allow-Private-Network",
      "not getting a valid response that includes the required CORS + Private Network response headers",
      "Firefox is more permissive here",
    ],
  },
  {
    name: "PAX Android POS build instructions",
    question:
      "I want to build an app on PAX android device PAX A920 A80 etc with a POS app, barcode checkout, CardPointe linked to BroadPOS via PosLink, and tokenized payments. Where do I go from here? Give me very clear step by step instructions with Android Studio steps, files to create, and code snippets.",
    mustInclude: [
      "Android Studio",
      "File",
      "build.gradle",
      "AndroidManifest",
      "MainActivity",
      "https://",
      "Agent",
      "token",
      "test",
    ],
    mustAvoid: ["downloadable image", "generated image asset"],
  },
];

async function runCase(testCase) {
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: testCase.question,
      log: testCase.log || "",
      code: "",
      history: [],
      uploadedFiles: testCase.uploadedFiles || [],
    }),
  });

  if (!response.ok) {
    throw new Error(`${testCase.name}: HTTP ${response.status}`);
  }

  const data = await response.json();
  const answer = String(data.result || "");
  const missing = testCase.mustInclude.filter((term) => !answer.toLowerCase().includes(term.toLowerCase()));
  const missingAny = (testCase.mustIncludeAny || []).filter(
    (terms) => !terms.some((term) => answer.toLowerCase().includes(term.toLowerCase())),
  );
  const forbidden = (testCase.mustAvoid || []).filter((term) => answer.toLowerCase().includes(term.toLowerCase()));

  return {
    name: testCase.name,
    ok: missing.length === 0 && missingAny.length === 0 && forbidden.length === 0,
    missing,
    missingAny,
    forbidden,
    revised: Boolean(data.quality?.revised),
    answerPreview: answer.replace(/\s+/g, " ").slice(0, 360),
  };
}

const results = [];
for (const testCase of cases) {
  results.push(await runCase(testCase));
}

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}${result.revised ? " (revised)" : ""}`);
  if (!result.ok) {
    if (result.missing.length) console.log(`  Missing: ${result.missing.join(", ")}`);
    if (result.missingAny.length) console.log(`  Missing one of: ${result.missingAny.map((terms) => terms.join(" / ")).join(", ")}`);
    if (result.forbidden.length) console.log(`  Forbidden: ${result.forbidden.join(", ")}`);
    console.log(`  Preview: ${result.answerPreview}`);
  }
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
