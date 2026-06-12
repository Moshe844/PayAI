export function extractFirstUrl(text: string) {
  return text.match(/https?:\/\/[^\s)\]]+/)?.[0] || "";
}

export function splitFullHtml(codeString: string) {
  const cssMatch = codeString.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const jsMatch = codeString.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  const bodyMatch = codeString.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  return {
    html: bodyMatch
      ? bodyMatch[1].trim()
      : codeString
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .trim(),
    css: cssMatch ? cssMatch[1].trim() : "",
    js: jsMatch ? jsMatch[1].trim() : "",
  };
}

export function unsupportedInstructions(language: string, codeString: string) {
  const lang = language.toLowerCase();

  if (["csharp", "cs", "c#"].includes(lang)) {
    return `C# cannot run in the browser sandbox.\n\nHow to run locally:\n1. Save the code to Program.cs\n2. Run: dotnet new console -n TestRun\n3. Replace TestRun/Program.cs with this code\n4. Run: dotnet run --project TestRun\n\nCode length: ${codeString.length} characters`;
  }

  if (["cpp", "c++", "c"].includes(lang)) {
    return `C/C++ cannot run in the browser sandbox.\n\nHow to run locally with g++:\n1. Save as main.cpp\n2. Run: g++ main.cpp -o main\n3. Run: ./main\n\nOn Windows PowerShell, run: .\\main.exe\n\nCode length: ${codeString.length} characters`;
  }

  if (["python", "py"].includes(lang)) {
    return `Python cannot run in this browser sandbox yet.\n\nHow to run locally:\n1. Save as script.py\n2. Run: python script.py\n\nCode length: ${codeString.length} characters`;
  }

  if (["java"].includes(lang)) {
    return `Java cannot run in the browser sandbox.\n\nHow to run locally:\n1. Save as Main.java\n2. Run: javac Main.java\n3. Run: java Main\n\nCode length: ${codeString.length} characters`;
  }

  if (["cmd", "bat", "batch", "powershell", "ps1", "shell", "sh", "bash"].includes(lang)) {
    const command = codeString.trim();
    return `Windows/system commands cannot run inside the browser preview.\n\nThis is expected: the Code Runner is sandboxed for HTML, CSS, and JavaScript previews only.\n\nTo run this on your PC, use a terminal:\n${command || "[command]"}\n\nFor project-aware command execution, use Run Agent or Project IQ sandbox checks so PayFix can run through the local agent with validation.\n\nCode length: ${codeString.length} characters`;
  }

  return `I detected this as "${language || "unknown"}". This language cannot run directly in the browser runner.\n\nUse the correct local runtime/compiler for this file type.\n\nCode length: ${codeString.length} characters`;
}

export function buildRunnerSrcDoc(runnerHtml: string, runnerCss: string, runnerJs: string) {
  const safeJs = runnerJs.replace(/<\/script>/gi, "<\\/script>");

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body {
    font-family: Arial, sans-serif;
    padding: 20px;
  }
  .preview-box {
    padding: 20px;
    border-radius: 12px;
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    margin-bottom: 12px;
  }
  #payfix-console {
    margin-top: 20px;
    padding: 12px;
    background: #020617;
    color: #86efac;
    font-family: monospace;
    white-space: pre-wrap;
    border-radius: 12px;
    min-height: 48px;
  }
  ${runnerCss}
</style>
</head>
<body>
${runnerHtml || "<div id='app'>JavaScript Runner</div>"}
<div id="payfix-console"></div>
<script>
  const box = document.getElementById("payfix-console");
  const originalLog = console.log;
  console.log = (...args) => {
    box.textContent += args.map((x) => {
      try { return typeof x === "object" ? JSON.stringify(x, null, 2) : String(x); }
      catch { return String(x); }
    }).join(" ") + "\\n";
    originalLog(...args);
  };

  try {
    ${safeJs}
    if (!box.textContent.trim()) {
      box.textContent = "Script ran successfully. No console output.";
    }
  } catch (err) {
    box.textContent += "Error: " + err.message;
  }
</script>
</body>
</html>`;
}

export function readBrowserFile(file: File, asDataUrl: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    if (asDataUrl) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}
