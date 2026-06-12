import type { EmvTlvDecodeResult, EmvTlvTag, PaymentTimelineResult } from "./payfixTypes";

const tagNames: Record<string, string> = {
  "5F2A": "Transaction Currency Code",
  "5F24": "Application Expiration Date",
  "5F2D": "Language Preference",
  "57": "Track 2 Equivalent Data",
  "82": "Application Interchange Profile",
  "84": "Dedicated File Name / AID",
  "8A": "Authorization Response Code",
  "91": "Issuer Authentication Data",
  "95": "Terminal Verification Results",
  "9A": "Transaction Date",
  "9C": "Transaction Type",
  "9F02": "Amount, Authorized",
  "9F10": "Issuer Application Data",
  "9F12": "Application Preferred Name",
  "9F1A": "Terminal Country Code",
  "9F26": "Application Cryptogram",
  "9F27": "Cryptogram Information Data",
  "9F34": "CVM Results",
  "9F36": "Application Transaction Counter",
  "9F37": "Unpredictable Number",
  "9F66": "Terminal Transaction Qualifiers",
  "DF8115": "Error Indication",
  "DF8129": "Outcome Parameter Set",
  "FF8105": "Data Record",
  "FF8106": "Discretionary Data",
};

const cidMeanings: Record<string, string> = {
  "00": "AAC: offline decline",
  "40": "TC: offline approval",
  "80": "ARQC: online authorization request",
  C0: "AAR: referral",
};

const outcomeStatusMeanings: Record<string, string> = {
  "10": "Approved",
  "20": "Declined",
  "30": "Online Request",
  "40": "End Application",
  "50": "Select Next",
  "60": "Try Another Interface",
  "70": "Try Again",
};

const authResponseMeanings: Record<string, string> = {
  "00": "Approved",
  "01": "Refer to card issuer",
  "05": "Do not honor",
  "51": "Insufficient funds",
  "54": "Expired card",
  "55": "Incorrect PIN",
  "57": "Transaction not permitted to cardholder",
  "58": "Transaction not permitted to terminal",
  "91": "Issuer or switch inoperative",
  Z1: "Unable to go online / offline declined",
  Z3: "Unable to go online / offline declined",
};

function onlyHex(text: string) {
  return text.replace(/[^0-9a-fA-F]/g, "");
}

export function extractLongestHexToken(text: string) {
  const tokens = text.match(/[0-9a-fA-F]{80,}/g) || [];
  return tokens.filter((token) => token.length % 2 === 0).sort((a, b) => b.length - a.length)[0] || "";
}

export function looksLikeEmvTlv(text: string) {
  const hex = extractLongestHexToken(text);
  return hex.length >= 80 && /(?:9F27|DF8129|9F10|9F26|9F02|5F2A|9F37|95)/i.test(hex);
}

function readTag(hex: string, position: number) {
  let cursor = position;
  let tag = hex.slice(cursor, cursor + 2).toUpperCase();
  cursor += 2;

  if ((Number.parseInt(tag, 16) & 0x1f) === 0x1f) {
    while (cursor + 2 <= hex.length) {
      const next = hex.slice(cursor, cursor + 2).toUpperCase();
      tag += next;
      cursor += 2;
      if ((Number.parseInt(next, 16) & 0x80) === 0) break;
    }
  }

  return { tag, cursor };
}

function readLength(hex: string, position: number) {
  if (position + 2 > hex.length) return null;
  const first = Number.parseInt(hex.slice(position, position + 2), 16);
  let cursor = position + 2;

  if ((first & 0x80) === 0) return { length: first, cursor };

  const byteCount = first & 0x7f;
  if (byteCount === 0 || byteCount > 3 || cursor + byteCount * 2 > hex.length) return null;

  const length = Number.parseInt(hex.slice(cursor, cursor + byteCount * 2), 16);
  cursor += byteCount * 2;
  return { length, cursor };
}

function asciiFromHex(hex: string) {
  return (hex.match(/../g) || [])
    .map((byte) => {
      const code = Number.parseInt(byte, 16);
      return code >= 32 && code <= 126 ? String.fromCharCode(code) : ".";
    })
    .join("");
}

function isConstructed(tag: string) {
  const firstByte = Number.parseInt(tag.slice(0, 2), 16);
  return (firstByte & 0x20) === 0x20 || tag.startsWith("FF");
}

function parseTlv(hexInput: string, baseOffset = 0, depth = 0): EmvTlvTag[] {
  const hex = onlyHex(hexInput).toUpperCase();
  const tags: EmvTlvTag[] = [];
  let cursor = 0;

  while (cursor + 4 <= hex.length && depth < 5) {
    const offset = baseOffset + cursor / 2;
    const tagResult = readTag(hex, cursor);
    const lengthResult = readLength(hex, tagResult.cursor);
    if (!lengthResult) break;

    const valueStart = lengthResult.cursor;
    const valueEnd = valueStart + lengthResult.length * 2;
    if (valueEnd > hex.length) break;

    const tag = tagResult.tag;
    const value = hex.slice(valueStart, valueEnd);
    const ascii = asciiFromHex(value);
    tags.push({
      tag,
      name: tagNames[tag] || "Unknown / proprietary EMV tag",
      value,
      offset,
      ascii: /[A-Z0-9 ]{3,}/i.test(ascii) ? ascii : undefined,
    });

    if (isConstructed(tag) && value.length >= 4) {
      tags.push(...parseTlv(value, offset + (valueStart - cursor) / 2, depth + 1));
    }

    cursor = valueEnd;
  }

  return tags;
}

function knownValue(rawHex: string, tag: string) {
  const parsed = parseTlv(rawHex).find((item) => item.tag === tag)?.value;
  if (parsed) return parsed;

  const hex = onlyHex(rawHex).toUpperCase();
  const expectedLengths: Record<string, { min: number; max: number; startsWith?: string }> = {
    "84": { min: 5, max: 16, startsWith: "A0" },
    "8A": { min: 2, max: 2 },
    "95": { min: 5, max: 5 },
    "9F02": { min: 6, max: 6 },
    "9F12": { min: 1, max: 32 },
    "9F27": { min: 1, max: 1 },
    "5F2A": { min: 2, max: 2 },
    DF8129: { min: 8, max: 8 },
  };
  const expected = expectedLengths[tag];
  let cursor = 0;

  while (cursor < hex.length) {
    const found = hex.indexOf(tag, cursor);
    if (found < 0) return "";

    const lengthResult = readLength(hex, found + tag.length);
    if (lengthResult) {
      const valueStart = lengthResult.cursor;
      const valueEnd = valueStart + lengthResult.length * 2;
      const value = hex.slice(valueStart, valueEnd);
      const valid =
        valueEnd <= hex.length &&
        (!expected ||
          (lengthResult.length >= expected.min &&
            lengthResult.length <= expected.max &&
            (!expected.startsWith || value.startsWith(expected.startsWith))));

      if (valid) return value;
    }

    cursor = found + 2;
  }

  return "";
}

function amountFrom9f02(value: string) {
  if (!value || !/^\d+$/.test(value)) return "";
  return (Number(value) / 100).toFixed(2);
}

function decodeTvr(value: string) {
  if (!/^[0-9A-F]{10}$/i.test(value)) return [];
  const bytes = (value.match(/../g) || []).map((byte) => Number.parseInt(byte, 16));
  const labels: string[][] = [
    [
      "Offline data authentication was not performed",
      "SDA failed",
      "ICC data missing",
      "Card appears on terminal exception file",
      "DDA failed",
      "CDA failed",
    ],
    [
      "ICC and terminal application versions differ",
      "Expired application",
      "Application not yet effective",
      "Requested service is not allowed for card product",
      "New card",
    ],
    [
      "Cardholder verification was not successful",
      "Unrecognized CVM",
      "PIN try limit exceeded",
      "PIN entry required but PIN pad not present or not working",
      "PIN entry required, PIN pad present, but PIN was not entered",
      "Online PIN entered",
    ],
    [
      "Transaction exceeds floor limit",
      "Lower consecutive offline limit exceeded",
      "Upper consecutive offline limit exceeded",
      "Transaction randomly selected for online processing",
      "Merchant forced transaction online",
    ],
    [
      "Default TDOL used",
      "Issuer authentication failed",
      "Script processing failed before final GENERATE AC",
      "Script processing failed after final GENERATE AC",
    ],
  ];
  const bitMasks = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01];

  return bytes.flatMap((byte, byteIndex) =>
    bitMasks
      .map((mask, bitIndex) => ((byte & mask) && labels[byteIndex]?.[bitIndex] ? labels[byteIndex][bitIndex] : ""))
      .filter(Boolean),
  );
}

function buildEmvTroubleshooting({
  cid,
  outcome,
  outcomeStatus,
  auth,
  tvr,
  amount,
  currency,
  application,
}: {
  cid: string;
  outcome: string;
  outcomeStatus: string;
  auth: string;
  tvr: string;
  amount: string;
  currency: string;
  application: string;
}) {
  const findings: NonNullable<EmvTlvDecodeResult["troubleshootingFindings"]> = [];
  const suspectTags: NonNullable<EmvTlvDecodeResult["suspectTags"]> = [];
  const tvrReasons = decodeTvr(tvr);

  if (cid === "00") {
    findings.push({
      title: "Card generated AAC, which means offline decline",
      detail:
        "Tag 9F27=00 means the card/kernel produced an Application Authentication Cryptogram. That is an offline decline signal, not a Mastercard host decline reason by itself.",
      severity: "critical",
      evidence: "9F27=00",
    });
    suspectTags.push({
      tag: "9F27",
      title: "Cryptogram Information Data",
      value: cid,
      meaning: "AAC / offline decline",
      severity: "critical",
    });
  } else if (cid === "80") {
    findings.push({
      title: "Card requested online authorization",
      detail:
        "Tag 9F27=80 means ARQC. That is not a decline; it means the terminal should send the transaction online and the decline reason must come from the host response.",
      severity: "info",
      evidence: "9F27=80",
    });
  }

  if (outcomeStatus === "20") {
    findings.push({
      title: "Kernel outcome says declined",
      detail:
        "DF8129 status byte 20 indicates a declined outcome at the contactless/kernel layer. Pair this with 9F27 and TVR to understand whether it declined before host authorization.",
      severity: cid === "00" ? "critical" : "warning",
      evidence: `DF8129=${outcome}`,
    });
    suspectTags.push({
      tag: "DF8129",
      title: "Outcome Parameter Set",
      value: outcome,
      meaning: "Kernel outcome status is Declined",
      severity: cid === "00" ? "critical" : "warning",
    });
  }

  if (!auth) {
    findings.push({
      title: "No issuer/host response code is present",
      detail:
        "Tag 8A is missing, so this TLV does not contain the final issuer/gateway response code. If the app says the Mastercard transaction declined, you still need the host/gateway response log to know the external decline reason.",
      severity: "warning",
      evidence: "8A not present",
    });
  } else {
    findings.push({
      title: "Issuer/host response code is present",
      detail: `Tag 8A=${auth} (${authResponseMeanings[auth] || "unknown response"}). This is the final issuer/host response evidence inside the TLV.`,
      severity: auth === "00" ? "info" : "critical",
      evidence: `8A=${auth}`,
    });
  }

  if (tvrReasons.length) {
    findings.push({
      title: "TVR contains terminal risk flags",
      detail: tvrReasons.slice(0, 5).join("; "),
      severity: "warning",
      evidence: `95=${tvr}`,
    });
    suspectTags.push({
      tag: "95",
      title: "Terminal Verification Results",
      value: tvr,
      meaning: tvrReasons.slice(0, 3).join("; "),
      severity: "warning",
    });
  }

  if (application || amount || currency) {
    findings.push({
      title: "Transaction context decoded",
      detail: [
        application ? `Application: ${application}` : "",
        amount ? `Amount: ${amount}` : "",
        currency ? `Currency code: ${currency}` : "",
      ]
        .filter(Boolean)
        .join("; "),
      severity: "info",
      evidence: [application ? `9F12=${application}` : "", amount ? `9F02=${amount}` : "", currency ? `5F2A=${currency}` : ""]
        .filter(Boolean)
        .join(", "),
    });
  }

  return { findings, suspectTags, tvrReasons };
}

export function decodeEmvTlv(text: string): EmvTlvDecodeResult {
  const rawHex = extractLongestHexToken(text).toUpperCase();
  const tags = rawHex ? parseTlv(rawHex) : [];
  const get = (tag: string) => knownValue(rawHex, tag);
  const cid = get("9F27");
  const outcome = get("DF8129");
  const auth = get("8A");
  const outcomeStatus = outcome.slice(0, 2);
  const application = get("9F12") ? asciiFromHex(get("9F12")).replace(/\.+/g, "").trim() : "";
  const amount = amountFrom9f02(get("9F02"));
  const currency = get("5F2A");
  const tvr = get("95");
  const troubleshooting = buildEmvTroubleshooting({
    cid,
    outcome,
    outcomeStatus,
    auth,
    tvr,
    amount,
    currency,
    application,
  });

  const limitations: string[] = [];
  if (!auth) {
    limitations.push("No tag 8A Authorization Response Code is present, so this payload does not contain the final issuer/host approval or decline reason.");
  }
  if (cid === "80" || outcomeStatus === "30") {
    limitations.push("9F27=80 and/or DF8129 status 30 indicate an online authorization request, not a final decline by themselves.");
  }

  return {
    isTlv: Boolean(rawHex && tags.length),
    rawHex,
    summary: auth
      ? `EMV TLV decoded. Authorization Response Code 8A=${auth} (${authResponseMeanings[auth] || "response code present"}).`
      : "EMV TLV decoded. No final decline reason is present in this TLV. It appears to be card/device evidence for an online authorization request; check host/gateway response data for the actual decline reason.",
    tags,
    signals: {
      cryptogram: cid ? `${cid} (${cidMeanings[cid] || "unknown"})` : undefined,
      outcome: outcome ? `${outcome}; status ${outcomeStatus} (${outcomeStatusMeanings[outcomeStatus] || "unknown"})` : undefined,
      authorizationResponse: auth ? `${auth} (${authResponseMeanings[auth] || "unknown"})` : undefined,
      amount: amount || undefined,
      currency: currency || undefined,
      application: application || undefined,
      tvr: tvr || undefined,
    },
    troubleshootingFindings: troubleshooting.findings,
    suspectTags: troubleshooting.suspectTags,
    limitations,
    nextSteps: [
      cid === "00"
        ? "Check terminal/kernel logs before the host call. 9F27=00 means the card/kernel declined offline, so the gateway may not have the real cause."
        : "Capture host/gateway authorization response logs, especially ISO response code or EMV tag 8A.",
      "Review TVR tag 95 and DF8129 together; they usually explain whether this is terminal risk management, CVM, offline auth, or host response evidence.",
      "Compare the terminal amount/currency against the gateway request to rule out amount/currency mismatch.",
      "Capture terminal/kernel post-online outcome logs, not only the card data sent for authorization.",
    ],
  };
}

export function emvDecodeToTimeline(result: EmvTlvDecodeResult): PaymentTimelineResult {
  const criticalFinding = result.troubleshootingFindings?.find((finding) => finding.severity === "critical");
  const warningFinding = result.troubleshootingFindings?.find((finding) => finding.severity === "warning");
  const primaryFinding = criticalFinding || warningFinding || result.troubleshootingFindings?.[0];

  return {
    summary: `${result.summary} This is EMV/device evidence, so Timeline shows the device-side investigation instead of inventing frontend/backend/webhook events.`,
    correlation: { transactionIds: [], orderIds: [], gateways: [] },
    rootCauseAnalysis: primaryFinding
      ? {
          title: primaryFinding.title,
          detail: primaryFinding.detail,
          confidence: primaryFinding.severity === "critical" ? 0.92 : 0.78,
          evidence: [primaryFinding.evidence],
        }
      : undefined,
    investigationFindings: result.troubleshootingFindings,
    fixActions: [
      {
        title: "Collect the matching host/gateway response",
        detail:
          "Find the gateway/processor log for the same transaction attempt and compare ISO response, auth response, amount, currency, and terminal response fields.",
        owner: "Developer / payment support",
        priority: result.signals.authorizationResponse ? "info" : "warning",
      },
      {
        title: "Inspect terminal/kernel decline path",
        detail:
          "If 9F27 is AAC or DF8129 is Declined, inspect terminal risk/CVM/offline auth settings and kernel logs before assuming a Mastercard issuer decline.",
        owner: "Terminal integration",
        priority: result.signals.cryptogram?.startsWith("00") ? "critical" : "warning",
      },
    ],
    events: [
      {
        id: "emv-device-evidence",
        stage: "device",
        timestamp: "",
        sequence: 1,
        source: "EMV TLV payload",
        action: "Decode card/device EMV evidence",
        status: result.signals.authorizationResponse || result.signals.outcome || result.signals.cryptogram || "EMV TLV parsed",
        gateway: "",
        transactionId: "",
        orderId: "",
        amount: result.signals.amount || "",
        evidence: [
          result.signals.cryptogram ? `Cryptogram: ${result.signals.cryptogram}.` : "",
          result.signals.outcome ? `Outcome: ${result.signals.outcome}.` : "",
          result.signals.tvr ? `TVR: ${result.signals.tvr}.` : "",
          result.limitations.join(" "),
        ]
          .filter(Boolean)
          .join(" "),
        confidence: 1,
      },
    ],
    anomalies: result.limitations.map((detail, index) => ({
      id: `emv-limit-${index + 1}`,
      type: "low_confidence",
      severity: index === 0 ? "warning" : "info",
      title: index === 0 ? "Final decline reason is not in this TLV" : "EMV evidence is not a full payment trace",
      detail,
      relatedEventIds: ["emv-device-evidence"],
    })),
    recommendedNextSteps: result.nextSteps,
  };
}
