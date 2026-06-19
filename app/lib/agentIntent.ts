export type AgentFollowUpRoute =
  | "focused-follow-up"
  | "screenshot-review"
  | "build-error"
  | "project-error"
  | "exact-next-steps"
  | "generic";

export type AgentFollowUpIntentInput = {
  prompt: string;
  hasImages: boolean;
  hasProject: boolean;
  isPaxAndroidBuiltSession: boolean;
  previousAssistant: string;
};

export type AgentFollowUpIntent = {
  route: AgentFollowUpRoute;
  reason: string;
};

export function hasBuildErrorEvidence(text: string) {
  return /\b(Configuration cache|Could not resolve|debugRuntimeClasspath|processDebugNavigationResources|Gradle|BUILD FAILED|CONFIGURE FAILED|PKIX path building failed|SSL handshake|certificate_unknown|JAVA_HOME is not set|no 'java' command could be found|Could not GET|Could not HEAD|Maven|repo\.maven|stacktrace|exception|error writing value|failed)\b/i.test(
    text,
  );
}

export function hasTerminalCommandOutput(text: string) {
  const mentionsCommand =
    /\b(?:gradlew(?:\.bat)?|\.\\gradlew(?:\.bat)?|\.\/gradlew|npm|pnpm|yarn|mvn|dotnet|cargo|pytest|python(?:\.exe)?|go|composer|bundle|java(?:\.exe)?|keytool(?:\.exe)?)\b/i.test(
      text,
    );
  const reportsNoOutput =
    /\b(nothing (?:shows|showed|prints|printed|happens)|no output|blank|empty|silent|silently|returns? (?:right )?back|goes? back|hit enter|pressed enter|hangs?|stuck)\b/i.test(
      text,
    );

  return (
    (mentionsCommand && reportsNoOutput) ||
    /(?:^|\n)\s*[A-Za-z]:\\[^>\r\n]+>\s*\S+/i.test(text) ||
    /\b(ERROR|BUILD FAILED|CONFIGURE FAILED|FAILURE):\b/i.test(text) ||
    /\b(JAVA_HOME is not set|no 'java' command could be found|command not found|is not recognized as an internal or external command|Could not resolve|PKIX path building failed|SSL handshake)\b/i.test(
      text,
    )
  );
}

export function asksFocusedFollowUpQuestion(text: string) {
  const asksQuestion = /\b(what|why|which|where|how|exactly|explain)\b/i.test(text) || /\?/.test(text);
  const mentionsSpecificTarget =
    /\b(field|input|blank|custom|vendor|dropdown|select(?:ing)?|option|enter(?:ing)?|type|put|fill|button|menu|screen|page|modal|popup|panel|card|section|message|response|label|setting|toggle|checkbox|tab)\b/i.test(
      text,
    );
  const asksForProjectChange =
    /\b(fix|change|update|make|move|add|remove|delete|apply|patch|implement|build|create|install|wire)\b/i.test(text);

  return (
    asksQuestion &&
    mentionsSpecificTarget &&
    !asksForProjectChange
  );
}

export function asksContextualClarificationFollowUp(text: string, previousAssistant = "") {
  const trimmed = text.trim();
  if (!trimmed || !previousAssistant.trim() || trimmed.length > 320) return false;

  return /\b(what'?s?\s+now|now\s+what|where exactly|what exactly|how exactly|please clarify|clarify|explain that|what does that mean|what should i do|what do i click|where do i click|which one|which option|what next|next step|so what|then what|and then|what about this|what about that)\b/i.test(
    trimmed,
  );
}

export function reportsCompletedStepAndAsksNext(text: string, previousAssistant = "") {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 700) return false;

  const reportsAlreadyDone =
    /\b(?:already|did|done|tried|confirmed|checked|whitelisted|allowlisted|imported|installed|connected|added|selected|set|fixed|found|ran|reran|re-ran|restarted|uploaded|attached)\b/i.test(
      trimmed,
    );
  const asksForAdvice =
    /\b(?:can you check|advise|what else|what now|next|still|still fails?|still happening|if it is|is it|why|how|fix|do now|supposed to do|anything else|where from here)\b/i.test(
      trimmed,
    ) || /\?/.test(trimmed);
  const priorHasRelevantProblem =
    !previousAssistant.trim() ||
    /\b(?:error|failed|failure|blocker|Gradle|build|sync|PKIX|SSL|certificate|trust|dependency|Maven|SDK|folder|project|validation|settings|proxy|screenshot)\b/i.test(
      previousAssistant,
    );

  return reportsAlreadyDone && asksForAdvice && priorHasRelevantProblem;
}

export function asksCommandLocationHelp(text: string) {
  const trimmed = text.trim();
  const asksWhereOrHow =
    /\b(where|whre|what folder|which folder|which directory|what directory|how)\b[\s\S]{0,80}\b(run|execute|type|paste|enter|use)\b/i.test(
      trimmed,
    ) ||
    /\b(run|execute|type|paste|enter|use)\b[\s\S]{0,80}\b(where|which folder|what folder|which directory|what directory)\b/i.test(
      trimmed,
    );
  const containsCommand =
    /\b(?:gradlew(?:\.bat)?|\.\\gradlew(?:\.bat)?|\.\/gradlew|npm|pnpm|yarn|mvn|dotnet|cargo|pytest|python(?:\.exe)?|go|composer|bundle)\b/i.test(
      trimmed,
    ) || /(?:^|\n)\s*[.$]?[\\/][^\n]+\s+[-\w]/.test(trimmed);

  return asksWhereOrHow && containsCommand;
}

export function asksToChoosePreviousOption(text: string, previousAssistant = "") {
  const trimmed = text.trim();
  if (!previousAssistant.trim()) return false;

  const choseLetter = /^(?:option\s*)?[a-e](?:[\).,:\s].*)?$/i.test(trimmed);
  const priorHasLetteredOptions = /(?:^|\n)\s*(?:A|B|C|D|E)[\).:\s-]/.test(previousAssistant);
  const priorAskedToChoose = /\b(choose one|pick one|reply with|option A|A\/B\/C|If you want|I can)\b/i.test(previousAssistant);

  return choseLetter && (priorHasLetteredOptions || priorAskedToChoose);
}

export function selectedPreviousOption(text: string, previousAssistant = "") {
  const letter = text.trim().match(/^(?:option\s*)?([a-e])(?:[\).,:\s].*)?$/i)?.[1]?.toUpperCase();
  if (!letter || !previousAssistant.trim()) return null;

  const optionPattern = new RegExp(
    `(?:^|\\n)\\s*${letter}[\\).:\\s-]+(.+?)(?=\\n\\s*[A-E][\\).:\\s-]+|$)`,
    "is",
  );
  const option = previousAssistant.match(optionPattern)?.[1]?.replace(/\s+/g, " ").trim();
  if (!option) return null;

  return { letter, option };
}

export function asksToolingPathHelpQuestion(text: string) {
  const mentionsToolingPath =
    /\b(java|jdk|jre|jbr|gradle jdk|gradle jvm|java_home|program files|custom vendor|vendor field|path|folder|directory)\b/i.test(
      text,
    ) || /[A-Za-z]:\\/.test(text);
  const asksOrReportsCannotFind =
    /\b(where|what|which|how|enter|input|put|select|choose|browse|find|locate|missing|not seeing|don'?t see|do not see|don'?t have|do not have|doens'?t have|doesn'?t have|does not have|don'?t ha[ev]|do not ha[ev]|doens'?t ha[ev]|doesn'?t ha[ev]|isn'?t there|not there|blank)\b/i.test(
      text,
    );
  const asksForProjectChange =
    /\b(fix|change|update|make|move|add|remove|delete|apply|patch|implement|build|create|install|wire|rerun|validate)\b/i.test(
      text,
    );
  const reportsMissingSuggestedControl =
    /\b(not seeing|don'?t see|do not see|don'?t have|do not have|doens'?t have|doesn'?t have|does not have|don'?t ha[ev]|do not ha[ev]|doens'?t ha[ev]|doesn'?t ha[ev]|isn'?t there|not there|missing|no option|not visible)\b/i.test(
      text,
    ) &&
    /\b(option|field|dropdown|menu|button|setting|section|gradle|jdk|sdk|java|path|folder|directory)\b/i.test(text) &&
    /\b(what else|what now|supposed to do|where|how|which|what)\b/i.test(text);

  return reportsMissingSuggestedControl || (mentionsToolingPath && asksOrReportsCannotFind && !asksForProjectChange);
}

export function asksForExactNextSteps(text: string) {
  if (
    asksCommandLocationHelp(text) ||
    asksFocusedFollowUpQuestion(text) ||
    asksToolingPathHelpQuestion(text) ||
    asksForTemporaryWorkaround(text) ||
    asksContextualClarificationFollowUp(text)
  ) {
    return false;
  }

  const explicitNextStepRequest =
    /\b(next steps?|what now|where do i go next|open android studio|sync gradle|test it|run it|build it|make project|build apk|install it)\b/i.test(
      text,
    );
  const vagueStepRequest =
    /\b(how exactly|what exactly|where do i|how do i|instructions?|step by step)\b/i.test(text) &&
    /\b(next|run|build|sync|test|open|install|device|apk|project|android studio|gradle)\b/i.test(text);

  return explicitNextStepRequest || vagueStepRequest;
}

export function asksForTemporaryWorkaround(text: string, previousAssistant = "") {
  const asksWorkaround =
    /\b(bypass|get around|workaround|work around|skip|avoid|temporary|temporarily|for now|until|anything else|mavenlocal|maven local|go ahead|do it)\b/i.test(text) &&
    /\b(error|issue|failure|blocker|problem|this|that|it)\b/i.test(text);
  const wantsMavenLocal =
    /\b(mavenlocal|maven local|local maven|mvn install:install-file|install-file|local repo|local repository|manually installed artifacts?)\b/i.test(
      text,
    ) || (/\b(go ahead|do it|do this)\b/i.test(text) && /\bmavenLocal\b/i.test(previousAssistant));
  const priorHasBlocker = /\b(error|failed|failure|blocker|PKIX|SSL handshake|Could not resolve|Gradle|build|sync|validation)\b/i.test(
    previousAssistant,
  );

  return wantsMavenLocal || (asksWorkaround && priorHasBlocker);
}

export function asksToRunPreviousCommands(text: string, previousAssistant = "") {
  const trimmed = text.trim();
  if (!trimmed || !previousAssistant.trim() || trimmed.length > 260) return false;
  if (/\b(where|what|which|how)\s+(exactly|do|should|can|would|is|are)\b/i.test(trimmed)) return false;

  const asksRunThem =
    /\b(can you|could you|please|go ahead|run|rerun|execute|try|check|confirm|verify|validate)\b/i.test(trimmed) &&
    /\b(those|these|them|that|it|for me|to confirm|the commands?|the checks?|the steps?)\b/i.test(trimmed);
  const priorHadRunnableProjectCommand =
    /\b(gradlew(?:\.bat)?|\.\/gradlew|gradle\s+(?:build|test|check|assemble|--stop)|npm\s+(?:run\s+)?(?:build|test|lint)|pnpm\s+(?:build|test|lint)|yarn\s+(?:build|test|lint)|mvn\s+(?:test|verify|package)|dotnet\s+(?:build|test|restore)|cargo\s+(?:build|test|check)|pytest|go test)\b/i.test(
      previousAssistant,
    );
  const priorHadBuildOrValidationContext =
    /\b(build|validation|validate|Gradle|dependency|PKIX|SSL handshake|certificate|truststore|repo\.maven|Maven|test|lint|compile)\b/i.test(
      previousAssistant,
    );

  return asksRunThem && (priorHadRunnableProjectCommand || priorHadBuildOrValidationContext);
}

export function asksToRunReferencedCommands(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 320) return false;
  if (/\b(what|which|where|how)\b[\s\S]{0,120}\b(command|commands?|check|checks?|step|steps?)\b/i.test(trimmed)) {
    return false;
  }

  const asksRun = /\b(can you|could you|please|go ahead|run|rerun|execute|try|check|confirm|verify|validate|do)\b/i.test(trimmed);
  const referencesExplicitCommand =
    /\b(those|these|them|that|it|the)\s+(commands?|checks?|steps?|validation|build|tests?)\b/i.test(trimmed);
  const referencesPriorAction =
    /\b(those|these|them|that|it)\b/i.test(trimmed) && /\b(for me|to confirm|again|now|please)\b/i.test(trimmed);

  return asksRun && (referencesExplicitCommand || referencesPriorAction);
}

function asksToRecallPreviousCommand(text: string, previousAssistant = "") {
  const trimmed = text.trim();
  if (!trimmed || !previousAssistant.trim() || trimmed.length > 260) return false;

  const asksForCommand =
    /\b(what|which)\b[\s\S]{0,80}\b(command|commands?|line|thing)\b[\s\S]{0,80}\b(again|rerun|run|use|paste|type)\b/i.test(trimmed) ||
    /\b(command|commands?)\b[\s\S]{0,80}\b(again|to rerun|to run|should i run|do i run)\b/i.test(trimmed);
  const priorHadCommand =
    /\b(?:gradlew(?:\.bat)?|\.\\gradlew(?:\.bat)?|\.\/gradlew|npm|pnpm|yarn|mvn|dotnet|cargo|pytest|python(?:\.exe)?|go|composer|bundle)\b/i.test(
      previousAssistant,
    );

  return asksForCommand && priorHadCommand;
}

export function asksToExplainQuotedChoices(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const includesChoiceList = /(?:^|\n)\s*A[\).:\s-]+[\s\S]*\n\s*B[\).:\s-]+[\s\S]*\n\s*C[\).:\s-]+/i.test(trimmed);
  const asksForExplanation = /\b(full instructions?|instructions?|explain|clarify|what does|which one|help me understand|give me|walk me through|step by step)\b/i.test(
    trimmed,
  );
  const selectsSingleChoice = /^\s*(?:option\s*)?[A-E]\b/i.test(trimmed) && trimmed.length < 120;

  return includesChoiceList && asksForExplanation && !selectsSingleChoice;
}

export function asksGradleTrustCheck(text: string) {
  const trimmed = text.trim();
  if (!trimmed || asksToExplainQuotedChoices(trimmed)) return false;

  return (
    /^\s*(?:run|re-run|rerun|start|do|perform|check|verify|validate)\b[\s\S]{0,180}\b(?:trust check|local checks?|supported local checks?|jdk|jbr|certificate blocker|cert(?:ificate)? trust|gradle\/jdk|gradle jdk|pkix)\b/i.test(
      trimmed,
    ) ||
    /\b(?:run|re-run|rerun|start|do|perform)\b[\s\S]{0,100}\btrust check\b/i.test(trimmed)
  );
}

export function classifyShortContextualTurn(input: AgentFollowUpIntentInput): AgentFollowUpIntent | null {
  const { prompt, hasImages, hasProject, isPaxAndroidBuiltSession, previousAssistant } = input;
  const trimmed = prompt.trim();
  if (!trimmed || !previousAssistant.trim() || trimmed.length > 180) return null;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 8) return null;

  const isTinyContext =
    /^(?:yes|y|yep|yeah|ok|okay|k|sure|fine|please|pls|no|n|nope|nah|why|where|which|how|what|explain|again|same|continue|cont|run|rerun|retry|redo|check|confirm|verify|validate|fix|apply|do|do it|go|go ahead|this|that|these|those|them|it|so|here|there|more|next|then|show|open|send|download|upload|install|build|test|lint|sync|compile|stop|wait|cancel|pause|back)$/i.test(
      trimmed,
    ) ||
    /^(?:yes|ok|sure|please|pls|run|check|confirm|verify|validate|fix|apply|continue|again|retry|redo|show|open|send|download|install|build|test|sync)\b/i.test(
      trimmed,
    );
  if (!isTinyContext) return null;

  const previousHasChoices = /(?:^|\n)\s*(?:A|B|C|D|E)[\).:\s-]/.test(previousAssistant);
  const previousHasScreenshotTask = /\b(screenshot|image|visible|what I see|settings|screen|UI|menu|dialog)\b/i.test(previousAssistant);
  const previousHasBuildOrValidation =
    /\b(Gradle|gradlew|build|sync|validation|compile|test|lint|PKIX|SSL handshake|Could not resolve|BUILD FAILED|CONFIGURE FAILED|dependency)\b/i.test(
      previousAssistant,
    );
  const previousHasPatchOrProjectAction =
    /\b(patch|apply|fix|install|wire|copy|create|delete|update|mavenLocal|local artifact|SDK|build config|project)\b/i.test(
      previousAssistant,
    );
  const asksWhyWhereWhich = /^(?:why|where|which|how|what|explain|no|n|nope|nah)$/i.test(trimmed);
  const asksRunLike = /^(?:run|rerun|retry|redo|check|confirm|verify|validate|continue|again|build|test|lint|sync|compile)$/i.test(trimmed);
  const asksDoLike = /^(?:yes|y|yep|yeah|ok|okay|k|sure|fine|please|pls|do|do it|go|go ahead|apply|fix|install|send|download|open|show|more|next|then)$/i.test(
    trimmed,
  );
  const asksStopLike = /^(?:stop|wait|cancel|pause|back)$/i.test(trimmed);
  const refersToImage = hasImages && /^(?:this|that|these|those|them|it|so|same|again|here|there|show|open)$/i.test(trimmed);

  if (asksStopLike) {
    return {
      route: "focused-follow-up",
      reason: "The user gave a short control/correction reply that should be handled in the current context.",
    };
  }

  if (previousHasChoices && asksDoLike) {
    return {
      route: "focused-follow-up",
      reason: "The user gave a short reply to previous labeled choices; ask/answer in that context rather than starting fresh.",
    };
  }

  if (refersToImage || (hasImages && previousHasScreenshotTask && /^(?:yes|ok|same|again|this|that|these|those|so)$/i.test(trimmed))) {
    return {
      route: "screenshot-review",
      reason: "The short turn refers to current/previous screenshot evidence.",
    };
  }

  if (previousHasBuildOrValidation && (asksRunLike || asksDoLike) && !asksWhyWhereWhich) {
    return {
      route: isPaxAndroidBuiltSession ? "build-error" : hasProject ? "project-error" : "focused-follow-up",
      reason: "The short turn asks to continue/run/fix the previous build or validation context.",
    };
  }

  if (previousHasBuildOrValidation && asksWhyWhereWhich) {
    return {
      route: "focused-follow-up",
      reason: "The short question asks for explanation of the previous build or validation context.",
    };
  }

  if (hasProject && previousHasPatchOrProjectAction && asksDoLike && !asksWhyWhereWhich) {
    return {
      route: "project-error",
      reason: "The short turn asks PayFix to continue the previous project action.",
    };
  }

  if (hasProject && previousHasPatchOrProjectAction && asksWhyWhereWhich) {
    return {
      route: "focused-follow-up",
      reason: "The short question asks for clarification of the previous project action.",
    };
  }

  return {
    route: "focused-follow-up",
    reason: "The short turn depends on recent context and should be answered as a follow-up.",
  };
}

export function asksToFixBuildErrors(text: string, previousAssistant = "") {
  const explicitBuildFailure =
    /\b(error|errors|failed|failing|failure|broken|red|gradle|sync|compile|build failed|configure failed|cannot resolve|can't resolve|doesn'?t work|not working|PKIX|SSL handshake)\b/i.test(
      text,
    );
  const asksToRunBuildCommand =
    /\b(run|rerun|execute|try|validate|check|build|test|compile)\b[\s\S]{0,100}\b(gradle|gradlew|gradlew\.bat|build|test|assemble|sync|validation)\b/i.test(
      text,
    ) || asksToRunPreviousCommands(text, previousAssistant);
  const fixFollowUpAfterBuildFailure =
    /\b(fix it|fix this|continue|try again|rerun|apply fix)\b/i.test(text) &&
    /\b(build failed|configure failed|validation.*fail|gradle|sync failed|compile failed|PKIX|SSL handshake|Could not resolve)\b/i.test(
      previousAssistant,
    );

  return explicitBuildFailure || asksToRunBuildCommand || fixFollowUpAfterBuildFailure;
}

export function asksToFindOrFixProjectErrors(text: string, previousAssistant = "") {
  const explicitProjectFailure = /\b(error|errors|failed|failing|failure|broken|red|exception|stack trace|traceback|gradle sync|sync failed|compile failed|build failed|cannot|can't|doesn'?t work|not working|check for more|more errors|remaining issues|validation failure)\b/i.test(
    text,
  );
  const asksToRunProjectCommand =
    /\b(run|rerun|execute|try|validate|check|build|test|compile|lint|typecheck)\b[\s\S]{0,100}\b(command|commands|validation|project|build|test|lint|typecheck|npm|pnpm|yarn|mvn|gradle|gradlew|dotnet|cargo|pytest|go test)\b/i.test(
      text,
    ) || asksToRunPreviousCommands(text, previousAssistant);
  const fixFollowUpAfterProjectFailure =
    /\b(fix it|fix this|continue|try again|rerun|apply fix)\b/i.test(text) &&
    /\b(error|failed|failure|exception|stack trace|traceback|validation.*fail|build failed|compile failed|not working)\b/i.test(
      previousAssistant,
    );

  return explicitProjectFailure || asksToRunProjectCommand || fixFollowUpAfterProjectFailure;
}

export function userReportsErrorsGone(text: string) {
  return /\b(no errors?|no more errors?|errors? (?:are )?gone|sync passed|build passed|it works|all good|fixed now|wow[, ]+no errors?)\b/i.test(
    text,
  );
}

function isShortImageFollowUp(prompt: string, hasImages: boolean) {
  const trimmed = prompt.trim();
  const explicitlyReferencesImage =
    /\b(screenshot|screen shot|image|picture|photo|look at|see attached|attached)\b/i.test(trimmed);
  if (
    asksToRunReferencedCommands(trimmed) ||
    asksToolingPathHelpQuestion(trimmed) ||
    asksToRecallPreviousCommand(trimmed) ||
    /\b(validation|validate|build|test|command|commands?|checks?)\b/i.test(trimmed) ||
    (!explicitlyReferencesImage && /\b(gradle|jdk|jbr|java|sdk|folder|path|option|field|dropdown|setting|settings)\b/i.test(trimmed))
  ) {
    return false;
  }

  return (
    hasImages &&
    trimmed.length <= 180 &&
    /\b(so|these|those|this|that|what now|now what|what about|how about|same issue|still|again|here|see|look)\b/i.test(trimmed)
  );
}

function isSettingsScreenshotReview(prompt: string, hasImages: boolean) {
  const trimmed = prompt.trim();
  return (
    hasImages &&
    /\b(screenshot|screen shot|image|settings|proxy|http proxy|gradle jdk|gradle|jdk|java|company needs a proxy|everything looks|looks good|confirm whether|trusted|certificate|ssl)\b/i.test(
      trimmed,
    ) &&
    /\b(tell me|confirm|check|look|see|good|right|wrong|what now|next|so|these|those|this|that|for your two things|the two things)\b/i.test(
      trimmed,
    )
  );
}

function isScreenshotFollowUpForCurrentProblem(prompt: string, hasImages: boolean, previousAssistant: string) {
  if (!hasImages) return false;
  if (asksToRunReferencedCommands(prompt) || asksToolingPathHelpQuestion(prompt) || asksToRecallPreviousCommand(prompt, previousAssistant)) {
    return false;
  }

  const currentAsksAboutVisibleProblem =
    /\b(screenshot|screen shot|image|picture|look at|see attached|attached screenshot|this screenshot|in this image|what do you see|nothing (?:is )?(?:showing|visible)|blank screen|empty screen|no output visible|stuck on this)\b/i.test(
      prompt,
    );
  const previousHasProblemContext =
    /\b(command|terminal|output|gradlew|gradle|build|error|failed|failure|validation|setting|screen|screenshot|image)\b/i.test(
      previousAssistant,
    );

  return currentAsksAboutVisibleProblem && previousHasProblemContext;
}

function isScreenshotVerificationOfPreviousInstructions(prompt: string, hasImages: boolean, previousAssistant: string) {
  if (!hasImages) return false;

  const previousGaveChecks =
    /\b(check|confirm|verify|look at|open|go to|settings|proxy|gradle jdk|jdk|certificate|trust|whitelist|allow|next steps?|what to do|file ->|settings ->)\b/i.test(
      previousAssistant,
    ) || /^\s*\d+\.\s+/m.test(previousAssistant);
  const currentLooksLikeReturnEvidence =
    /\b(screenshot|screen shot|image|this is what i see|these are|looks|good|right|wrong|so|here|now|i went|i checked|the places|you told me|you said|your instructions)\b/i.test(
      prompt,
    );

  return previousGaveChecks && currentLooksLikeReturnEvidence;
}

export function classifyAgentFollowUpIntent(input: AgentFollowUpIntentInput): AgentFollowUpIntent {
  const { prompt, hasImages, hasProject, isPaxAndroidBuiltSession, previousAssistant } = input;
  const asksForReferencedRun = asksToRunReferencedCommands(prompt);

  if (!prompt.trim() && hasImages) {
    return {
      route: "screenshot-review",
      reason: "The user submitted image evidence without text; inspect the current image instead of using stale context.",
    };
  }

  if (hasTerminalCommandOutput(prompt) && (hasProject || isPaxAndroidBuiltSession)) {
    return {
      route: isPaxAndroidBuiltSession ? "build-error" : "project-error",
      reason: "The user pasted fresh terminal/build output; that current error should override older validation memory.",
    };
  }

  if (/\b(gradle|jdk|jbr|java|sdk)\b[\s\S]{0,160}\b(option|field|dropdown|setting|section|folder|path)\b/i.test(prompt) && /\b(don'?t see|do not see|doesn'?t have|does not have|doens'?t have|not visible|missing|what else|supposed to do|where|how|which|what)\b/i.test(prompt)) {
    return {
      route: "focused-follow-up",
      reason: "The latest text asks about a missing tooling/settings control, so it should not be hijacked by attached images.",
    };
  }

  if (
    isShortImageFollowUp(prompt, hasImages) ||
    isSettingsScreenshotReview(prompt, hasImages) ||
    isScreenshotFollowUpForCurrentProblem(prompt, hasImages, previousAssistant)
  ) {
    return {
      route: "screenshot-review",
      reason: "The user attached current screenshot evidence for the active follow-up/problem.",
    };
  }

  if (asksToExplainQuotedChoices(prompt)) {
    return {
      route: "focused-follow-up",
      reason: "The user quoted multiple labeled choices and asked for explanation/instructions, not execution of one choice.",
    };
  }

  if (asksCommandLocationHelp(prompt)) {
    return {
      route: "focused-follow-up",
      reason: "The user is asking where/how to run a specific command, not asking PayFix to analyze evidence.",
    };
  }

  if (asksToRecallPreviousCommand(prompt, previousAssistant)) {
    return {
      route: "focused-follow-up",
      reason: "The user is asking to repeat/identify the previous command, not asking PayFix to run validation.",
    };
  }

  if (asksGradleTrustCheck(prompt) && (hasProject || isPaxAndroidBuiltSession)) {
    return {
      route: isPaxAndroidBuiltSession ? "build-error" : "project-error",
      reason: "The user is asking PayFix to run a connected-project Gradle/JDK trust check.",
    };
  }

  if (reportsCompletedStepAndAsksNext(prompt, previousAssistant)) {
    return {
      route: "focused-follow-up",
      reason: "The user says a prior step is already done and asks what remains, so answer the changed situation instead of replaying the same step.",
    };
  }

  if (isPaxAndroidBuiltSession && (asksToRunPreviousCommands(prompt, previousAssistant) || asksForReferencedRun) && !userReportsErrorsGone(prompt)) {
    return {
      route: "build-error",
      reason: "The user is asking PayFix to run/confirm the previous build or validation commands.",
    };
  }

  if (hasProject && (asksToRunPreviousCommands(prompt, previousAssistant) || asksForReferencedRun) && !userReportsErrorsGone(prompt)) {
    return {
      route: "project-error",
      reason: "The user is asking PayFix to run/confirm the previous project commands.",
    };
  }

  if (asksForReferencedRun && !userReportsErrorsGone(prompt)) {
    return {
      route: "focused-follow-up",
      reason: "The user is asking to run/check previously mentioned commands, but no connected project state was provided to the router.",
    };
  }

  const shortContext = classifyShortContextualTurn(input);
  if (shortContext) return shortContext;

  if (asksFocusedFollowUpQuestion(prompt) || asksToolingPathHelpQuestion(prompt) || asksContextualClarificationFollowUp(prompt, previousAssistant)) {
    return {
      route: "focused-follow-up",
      reason: "The user is asking a focused question about a specific UI/setup/code target.",
    };
  }

  if (asksToChoosePreviousOption(prompt, previousAssistant)) {
    return {
      route: "focused-follow-up",
      reason: "The user selected one of the previous assistant's labeled options.",
    };
  }

  if (asksForTemporaryWorkaround(prompt, previousAssistant)) {
    return {
      route: "focused-follow-up",
      reason: "The user is asking for a temporary workaround for the current blocker, not a full checklist.",
    };
  }

  if (isScreenshotVerificationOfPreviousInstructions(prompt, hasImages, previousAssistant)) {
    return {
      route: "screenshot-review",
      reason: "The user is returning screenshot evidence for a current or previous instruction.",
    };
  }

  if (isPaxAndroidBuiltSession && asksToFixBuildErrors(prompt, previousAssistant) && !userReportsErrorsGone(prompt)) {
    return {
      route: "build-error",
      reason: "The generated/build session is active and the user is asking to fix a build or sync problem.",
    };
  }

  if (hasProject && asksToFindOrFixProjectErrors(prompt, previousAssistant) && !userReportsErrorsGone(prompt)) {
    return {
      route: "project-error",
      reason: "The connected project has an IDE/build/runtime error request.",
    };
  }

  if (asksForExactNextSteps(prompt) && !hasBuildErrorEvidence(prompt)) {
    return {
      route: "exact-next-steps",
      reason: "The user is asking for workflow next steps, not a focused UI/setup question or build fix.",
    };
  }

  return {
    route: "generic",
    reason: "No higher-priority follow-up route matched.",
  };
}
