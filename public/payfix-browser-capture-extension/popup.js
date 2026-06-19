const captureButton = document.getElementById("capture");
const statusBox = document.getElementById("status");

function setStatus(message) {
  statusBox.textContent = message;
}

function pageCaptureScript() {
  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => ({
      text: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
      href: anchor.href,
    }))
    .filter((link) => link.href)
    .slice(0, 400);

  return {
    url: location.href,
    title: document.title || "",
    text: (document.body?.innerText || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    links,
    meta: {
      userAgent: navigator.userAgent,
      selectionText: String(window.getSelection?.() || "").trim(),
    },
  };
}

captureButton.addEventListener("click", async () => {
  captureButton.disabled = true;
  setStatus("Capturing visible page...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageCaptureScript,
    });
    const payload = result?.result;
    if (!payload?.url) throw new Error("Could not read this page.");

    setStatus("Sending to PayFix...");
    const response = await fetch("http://localhost:3000/api/browser-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "PayFix did not accept the capture.");
    }

    setStatus("Shared with PayFix. Return to PayFix and click Import shared page.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Capture failed.");
  } finally {
    captureButton.disabled = false;
  }
});
