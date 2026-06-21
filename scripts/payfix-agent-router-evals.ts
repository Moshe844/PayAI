import { classifyAgentFollowUpIntent, selectedPreviousOption } from "../app/lib/agentIntent";

type Case = {
  name: string;
  prompt: string;
  hasImages?: boolean;
  hasProject?: boolean;
  isPaxAndroidBuiltSession?: boolean;
  previousAssistant?: string;
  expected: ReturnType<typeof classifyAgentFollowUpIntent>["route"];
};

const previousChecks = [
  "1. In Android Studio open Settings -> Build Tools -> Gradle -> Gradle JDK.",
  "2. In Android Studio open Settings -> Appearance & Behavior -> System Settings -> HTTP Proxy.",
  "Send screenshots back and I will confirm whether it looks right.",
].join("\n");

const cases: Case[] = [
  {
    name: "specific custom vendor field does not replay generated app checklist",
    prompt: "when selecting custom vendor it gives me a blank input field what exactly am i inputting there?",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    expected: "focused-follow-up",
  },
  {
    name: "where exactly resolves against previous answer",
    prompt: "where exactly should I do it?",
    hasProject: true,
    previousAssistant: "Open Settings, change the Gradle JVM criteria, then sync Gradle.",
    expected: "focused-follow-up",
  },
  {
    name: "please clarify resolves against previous answer",
    prompt: "please clarify",
    hasProject: true,
    previousAssistant: "Use the local SDK artifact folder and then run validation.",
    expected: "focused-follow-up",
  },
  {
    name: "what now after command suggestion is focused follow-up",
    prompt: "what now?",
    hasProject: true,
    previousAssistant: "Run npm install, then start the dev server and verify the UI.",
    expected: "focused-follow-up",
  },
  {
    name: "single letter selects previous labeled option",
    prompt: "A",
    hasProject: true,
    previousAssistant: "Choose one:\nA. Prepare cert import\nB. Patch Maven local fallback\nC. Explain tradeoffs",
    expected: "focused-follow-up",
  },
  {
    name: "option letter with text selects previous labeled option",
    prompt: "option B",
    hasProject: true,
    previousAssistant: "Choose one:\nA. Prepare cert import\nB. Patch Maven local fallback\nC. Explain tradeoffs",
    expected: "focused-follow-up",
  },
  {
    name: "missing Java Program Files path is focused help, not build validation",
    prompt: "I don't see C:\\Program Files\\Java\\",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Gradle failed with PKIX path building failed. Check the Gradle JDK and Java truststore.",
    expected: "focused-follow-up",
  },
  {
    name: "plain Java path follow-up with old images is still focused help",
    prompt: "i'm not seeing the java folder in program files",
    hasImages: true,
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Open Android Studio Settings -> Build Tools -> Gradle -> Gradle JDK.",
    expected: "focused-follow-up",
  },
  {
    name: "missing Gradle JDK option is focused help, not repeated build checklist",
    prompt:
      "Again, this already has the sdk folder also the gradle section doesn't have the option of gradle sdk, what else am i supposed to do to fix the error",
    hasImages: true,
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Set Gradle JDK to C:\\Program Files\\Android\\Android Studio\\jbr and confirm SDK files exist.",
    expected: "focused-follow-up",
  },
  {
    name: "where to run pasted Gradle command is focused help, not log analysis",
    prompt:
      "whre exactly do i run this\n.\\gradlew.bat --no-daemon --info --stacktrace dependencies --configuration debugRuntimeClasspath",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Run .\\gradlew.bat --no-daemon --info --stacktrace dependencies --configuration debugRuntimeClasspath",
    expected: "focused-follow-up",
  },
  {
    name: "temporary bypass for current blocker is focused help, not stale exact next steps",
    prompt: "anything else that can be done to bypass this error for now",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Current blocker: SSL handshake exception / PKIX path building failed while Gradle downloads from Maven.",
    expected: "focused-follow-up",
  },
  {
    name: "already whitelisted asks next blocker, not replay whitelist checklist",
    prompt: "I think I have already whitelisted the URLS, can you check and if it is can you advise what i can do to fix the issue",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant:
      "Gradle build is failing with PKIX path building failed while downloading from repo.maven.apache.org. First whitelist Maven/Google URLs, then check JBR truststore.",
    expected: "focused-follow-up",
  },
  {
    name: "already whitelisted with pasted build log still answers latest typed sentence",
    prompt:
      "I have already whitelisted the below urls, can you advise what else to do?\n\nExecuting tasks: [:app:assembleDebug]\nCould not resolve org.jetbrains:annotations:23.0.0\nPKIX path building failed",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant:
      "Whitelist repo.maven.apache.org, dl.google.com, maven.google.com, and plugins.gradle.org, then rerun Gradle.",
    expected: "build-error",
  },
  {
    name: "already added SDK folder asks next step, not add SDK again",
    prompt: "Again, this already has the sdk folder, what else am i supposed to do to fix the error?",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Add the extracted SDK folder, then run Gradle sync. Current error is SSL handshake / PKIX.",
    expected: "focused-follow-up",
  },
  {
    name: "quoted action choices plus full instructions is explanation, not action execution",
    prompt:
      "A. Run a trust check: re-run supported project validation/build checks and show the exact command output.\nB. Prepare a certificate fix: use the exact JBR/JDK path and attached corporate/root CA certificate file to produce the right keytool command.\nC. Prepare an offline Maven fallback: inspect selected artifact folders for required .pom/.jar/.aar files and patch repository order only if safe.\nD. Re-run validation after either environment fix so the next real project error can surface.\n\ngive me full instructions please",
    hasProject: true,
    previousAssistant: "Choose one:\nA. Run a trust check\nB. Prepare a certificate fix\nC. Prepare an offline Maven fallback\nD. Re-run validation",
    expected: "focused-follow-up",
  },
  {
    name: "go ahead after mavenLocal workaround stays on current workaround",
    prompt: "Go ahead and do it",
    hasProject: true,
    previousAssistant:
      "Quick workaround: use mavenLocal() with manually installed artifacts. Run mvn install:install-file for the required jars and poms.",
    expected: "project-error",
  },
  {
    name: "proceed executes previous patch action",
    prompt: "proceed",
    hasProject: true,
    previousAssistant:
      "Next action: patch the connected Gradle project to prefer mavenLocal() only if the local artifact folder has the required pom/jar files.",
    expected: "build-error",
  },
  {
    name: "make the update executes previous file patch action",
    prompt: "make the update",
    hasProject: true,
    previousAssistant:
      "I can update app/build.gradle.kts to add the local file repository before remote repositories and then run validation.",
    expected: "build-error",
  },
  {
    name: "install it executes previous dependency action",
    prompt: "install it",
    hasProject: true,
    previousAssistant:
      "The missing dependency is zod. Install it with npm install zod, then run npm test.",
    expected: "project-error",
  },
  {
    name: "are you able to do this resolves to previous agent action",
    prompt: "are you able to do this for me?",
    hasProject: true,
    previousAssistant:
      "PayFix can inspect the connected project, create the patch, and run validation if you want it to proceed.",
    expected: "project-error",
  },
  {
    name: "please execute latest build commands routes to build-error",
    prompt: "please execute it",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant:
      "Run these checks next: .\\gradlew.bat --stop, then .\\gradlew.bat build. This verifies the current Gradle blocker.",
    expected: "build-error",
  },
  {
    name: "where exactly remains information, not execution",
    prompt: "where exactly do I run it?",
    hasProject: true,
    previousAssistant:
      "Run .\\gradlew.bat --no-daemon --info --stacktrace dependencies --configuration debugRuntimeClasspath from the project root.",
    expected: "focused-follow-up",
  },
  {
    name: "prepare Maven local fallback action stays focused on workaround",
    prompt:
      "Prepare the Maven local fallback for the current Gradle blocker. Do not replay Android app setup steps. Patch the connected Gradle project to prefer mavenLocal() where safe, inspect attached/local artifact folders for the required .pom/.jar/.aar files, and tell me exactly what was changed or what artifact files are still missing before validation.",
    hasProject: true,
    previousAssistant: "Quick workaround: use mavenLocal() with manually installed artifacts.",
    expected: "focused-follow-up",
  },
  {
    name: "specific button why question routes as focused follow-up",
    prompt: "why does this button render over there instead of inside the modal?",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    expected: "focused-follow-up",
  },
  {
    name: "button change request does not get trapped as focused follow-up",
    prompt: "fix this button and move it inside the modal",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    expected: "generic",
  },
  {
    name: "screenshots returned after settings instructions are reviewed as screenshots",
    prompt: "so with these two screenshots does everything look right?",
    hasImages: true,
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: previousChecks,
    expected: "screenshot-review",
  },
  {
    name: "Gradle PKIX failure remains a build-error route",
    prompt:
      "when i ran configuration i get this error Could not resolve org.jetbrains:annotations:23.0.0 PKIX path building failed SSL handshake exception anything needs to be whitelisted?",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    expected: "build-error",
  },
  {
    name: "fresh JAVA_HOME terminal output is build-error route, not stale PKIX follow-up",
    prompt:
      "tried running it\nC:\\Users\\mekstein\\AndroidStudioProjects\\PAXRegisterApp>.\\gradlew.bat --no-daemon --info --stacktrace dependencies --configuration debugRuntimeClasspath\n\nERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.\n\nPlease set the JAVA_HOME variable in your environment to match the location of your Java installation.",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Gradle was previously blocked by PKIX while resolving Maven dependencies.",
    expected: "build-error",
  },
  {
    name: "run Gradle validation is a build-error action route",
    prompt: "Run Gradle validation now through the local agent and show the exact command output.",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Gradle is blocked by PKIX while resolving Maven dependencies.",
    expected: "build-error",
  },
  {
    name: "explicit trust check action is build-error action route",
    prompt:
      "Run the supported local checks for the current Gradle/JDK certificate blocker. Use the connected project and latest validation output. Verify which JDK/JBR Gradle is using if the local agent can detect it, check whether the truststore problem is still present, and report the exact commands tried plus the next concrete blocker. Do not compare logs or replay app setup steps.",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Gradle is blocked by PKIX while resolving Maven dependencies.",
    expected: "build-error",
  },
  {
    name: "run those resolves to previous Gradle commands",
    prompt: "Can you run those for me to confirm",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant:
      "Do this now:\n1. Verify the alias with keytool.\n2. Run gradlew --stop.\n3. Run gradlew.bat build.\nChoose one:\nA. I ran the verify command.",
    expected: "build-error",
  },
  {
    name: "asking for previous command again is focused recall, not run action",
    prompt: "what is the command again to rerun?",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant:
      "If java -version shows a version, re-run: .\\gradlew.bat --no-daemon --info --stacktrace dependencies --configuration debugRuntimeClasspath",
    expected: "focused-follow-up",
  },
  {
    name: "silent Gradle wrapper terminal output is current build blocker",
    prompt:
      "the gradle version is not showing up\n\nC:\\Users\\mekstein\\AndroidStudioProjects\\PAXRegisterApp>echo %JAVA_HOME%\nC:\\Program Files\\Android\\Android Studio\\jbr\n\nC:\\Users\\mekstein\\AndroidStudioProjects\\PAXRegisterApp>\"%JAVA_HOME%\\bin\\java\" -version\nopenjdk version \"21.0.10\" 2026-01-20\n\nC:\\Users\\mekstein\\AndroidStudioProjects\\PAXRegisterApp>.\\gradlew.bat -version\n\nC:\\Users\\mekstein\\AndroidStudioProjects\\PAXRegisterApp>",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Earlier Gradle failed with PKIX while resolving Maven dependencies.",
    expected: "build-error",
  },
  {
    name: "plain no-output command report is current build blocker",
    prompt: "when i run .\\gradlew.bat -version nothing shows up in the terminal",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Earlier Gradle failed with PKIX while resolving Maven dependencies.",
    expected: "build-error",
  },
  {
    name: "single word run resolves to previous Gradle command context",
    prompt: "run",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Next checks: run gradlew --stop, then run gradlew.bat build.",
    expected: "build-error",
  },
  {
    name: "single word validate resolves to previous Gradle command context",
    prompt: "validate",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Next checks: run gradlew --stop, then run gradlew.bat build.",
    expected: "build-error",
  },
  {
    name: "single word retry resolves to previous build failure",
    prompt: "retry",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Validation failed: gradlew.bat build failed with PKIX path building failed.",
    expected: "build-error",
  },
  {
    name: "single word why resolves as focused follow-up",
    prompt: "why",
    hasProject: true,
    previousAssistant: "The Custom vendor field is for the JDK home path Gradle should use.",
    expected: "focused-follow-up",
  },
  {
    name: "single word no resolves as focused correction",
    prompt: "no",
    hasProject: true,
    previousAssistant: "Use the Gradle JDK dropdown to select the Android Studio JBR path.",
    expected: "focused-follow-up",
  },
  {
    name: "single word this with image resolves to screenshot review",
    prompt: "this",
    hasImages: true,
    hasProject: true,
    previousAssistant: "Send a screenshot of Android Studio HTTP Proxy settings and I will confirm if it looks right.",
    expected: "screenshot-review",
  },
  {
    name: "single word same with image resolves to screenshot review",
    prompt: "same",
    hasImages: true,
    hasProject: true,
    previousAssistant: "Send a screenshot of Android Studio HTTP Proxy settings and I will confirm if it looks right.",
    expected: "screenshot-review",
  },
  {
    name: "single word fix resolves against previous build failure",
    prompt: "fix",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Gradle build failed with PKIX path building failed while resolving Maven dependencies.",
    expected: "build-error",
  },
  {
    name: "single word stop is focused control context",
    prompt: "stop",
    hasProject: true,
    previousAssistant: "PayFix can run Gradle validation and inspect the project files.",
    expected: "focused-follow-up",
  },
  {
    name: "generic project command run routes to project-error",
    prompt: "Run the project build and tests through the local agent and tell me what failed.",
    hasProject: true,
    expected: "project-error",
  },
  {
    name: "referenced command follow-up routes to project-error even when prior context is thin",
    prompt: "Can you run those commands for me to confirm",
    hasProject: true,
    expected: "project-error",
  },
  {
    name: "referenced command follow-up routes to build-error in generated Android build session",
    prompt: "Can you run those for me to confirm",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    expected: "build-error",
  },
  {
    name: "can you run those commands after previous keytool checklist is build action",
    prompt: "Can you run those commands you showed above for me to confirm?",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant:
      "Do this now:\n1. Verify cert alias with keytool.\n2. Run .\\gradlew.bat --stop.\n3. Run .\\gradlew.bat build.",
    expected: "build-error",
  },
  {
    name: "referenced validation follow-up ignores attached evidence intent",
    prompt: "please check those validation steps for me",
    hasProject: true,
    hasImages: true,
    expected: "project-error",
  },
  {
    name: "referenced command follow-up without project state does not become generic evidence",
    prompt: "Can you run those commands for me to confirm",
    hasProject: false,
    expected: "focused-follow-up",
  },
  {
    name: "real generated-app next steps still routes to exact next steps",
    prompt: "No errors now, what are my exact next steps to run it in Android Studio?",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    expected: "exact-next-steps",
  },
  {
    name: "generic connected project error routes to project-error",
    prompt: "My VS Code project has a TypeScript build error, fix it and rerun validation.",
    hasProject: true,
    expected: "project-error",
  },
  {
    name: "short screenshot follow-up routes to screenshot review",
    prompt: "what about this?",
    hasImages: true,
    hasProject: true,
    expected: "screenshot-review",
  },
  {
    name: "image-only send routes to screenshot review",
    prompt: "",
    hasImages: true,
    hasProject: true,
    previousAssistant: "Send a screenshot and I will verify the current settings.",
    expected: "screenshot-review",
  },
  {
    name: "screenshot attached to no-output command follow-up is screenshot review",
    prompt: "nothing is showing up, why?????",
    hasImages: true,
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "The current blocker is that .\\gradlew.bat -version exits silently. Send the terminal screenshot and I will check what it shows.",
    expected: "screenshot-review",
  },
  {
    name: "screenshot of settings after previous instructions is screenshot review",
    prompt: "do you see the Gradle JDK option here?",
    hasImages: true,
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Open Android Studio Settings -> Build Tools -> Gradle and choose the Gradle JDK dropdown.",
    expected: "screenshot-review",
  },
  {
    name: "fresh JAVA_HOME command output supersedes older PKIX blocker",
    prompt:
      "tried running it\nC:\\Users\\mekstein\\AndroidStudioProjects\\PAXRegisterApp>echo %JAVA_HOME%\n%JAVA_HOME%\n\nC:\\Users\\mekstein\\AndroidStudioProjects\\PAXRegisterApp>.\\gradlew.bat --version\n\nERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.",
    hasProject: true,
    isPaxAndroidBuiltSession: true,
    previousAssistant: "Earlier Gradle failed with PKIX while resolving Maven dependencies.",
    expected: "build-error",
  },
];

let failed = false;

for (const testCase of cases) {
  const actual = classifyAgentFollowUpIntent({
    prompt: testCase.prompt,
    hasImages: Boolean(testCase.hasImages),
    hasProject: Boolean(testCase.hasProject),
    isPaxAndroidBuiltSession: Boolean(testCase.isPaxAndroidBuiltSession),
    previousAssistant: testCase.previousAssistant || "",
  });
  const ok = actual.route === testCase.expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${testCase.name}`);
  if (!ok) {
    failed = true;
    console.log(`  expected=${testCase.expected} actual=${actual.route}`);
    console.log(`  reason=${actual.reason}`);
  }
}

if (failed) process.exitCode = 1;

const selected = selectedPreviousOption(
  "A",
  "Choose one:\n\nA. I’ll guide you to export/import the cert into JBR (safe).\n\nB. I’ll prepare steps to create/use a custom truststore for Gradle (temporary).\n\nC. I’ll list exact dependency jars and how to add them locally (short-term offline).",
);
const optionOk = selected?.letter === "A" && /export\/import the cert into JBR/i.test(selected.option);
console.log(`${optionOk ? "PASS" : "FAIL"} selected option A preserves exact prior option text`);
if (!optionOk) process.exitCode = 1;

const latestC = selectedPreviousOption(
  "C, how exactly?",
  "Do next\nA. Attach/select the folder that contains these Maven artifacts, then run Prepare offline fallback again.\nB. If the files are already somewhere on disk, add that folder in the Agent setup as a Vendor SDK / local artifacts folder.\nC. Use the certificate fix instead if you can get the corporate/root CA, because that fixes dependency downloads without manually mirroring artifacts.",
);
const latestCOk = latestC?.letter === "C" && /certificate fix/i.test(latestC.option) && !/offline Maven fallback/i.test(latestC.option);
console.log(`${latestCOk ? "PASS" : "FAIL"} selected option C uses latest visible options, not older choices`);
if (!latestCOk) process.exitCode = 1;
