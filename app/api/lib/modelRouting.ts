type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
type TextVerbosity = "low" | "medium" | "high";

export type PayFixModelProfile =
  | "regularChat"
  | "imageAnalysis"
  | "agentFast"
  | "agentDeep"
  | "agentPatch"
  | "agentSelector"
  | "validation"
  | "timeline";

type ResponseConfigOptions = {
  text?: Record<string, unknown>;
};

type ModelProfileConfig = {
  model: string;
  effort: ReasoningEffort;
  verbosity: TextVerbosity;
};

function envValue(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

function envEffort(name: string, fallback: ReasoningEffort): ReasoningEffort {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" ? value : fallback;
}

function supportsGpt5Controls(model: string) {
  return /^(gpt-5|o[1-9]|o\d|o3|o4)/i.test(model.trim());
}

function profileConfig(profile: PayFixModelProfile): ModelProfileConfig {
  const fastModel = envValue("PAYFIX_FAST_MODEL", envValue("PAYFIX_AGENT_FAST_MODEL", "gpt-5-mini"));
  const deepModel = envValue("PAYFIX_DEEP_MODEL", envValue("PAYFIX_AGENT_MODEL", fastModel));
  const patchModel = envValue("PAYFIX_PATCH_MODEL", deepModel);

  const profiles: Record<PayFixModelProfile, ModelProfileConfig> = {
    regularChat: {
      model: envValue("PAYFIX_CHAT_MODEL", fastModel),
      effort: envEffort("PAYFIX_CHAT_REASONING_EFFORT", "low"),
      verbosity: "low",
    },
    imageAnalysis: {
      model: envValue("PAYFIX_IMAGE_ANALYSIS_MODEL", envValue("PAYFIX_CHAT_MODEL", deepModel)),
      effort: envEffort("PAYFIX_IMAGE_ANALYSIS_REASONING_EFFORT", "medium"),
      verbosity: "medium",
    },
    agentFast: {
      model: envValue("PAYFIX_AGENT_FAST_MODEL", fastModel),
      effort: envEffort("PAYFIX_AGENT_FAST_REASONING_EFFORT", "low"),
      verbosity: "low",
    },
    agentDeep: {
      model: envValue("PAYFIX_AGENT_DEEP_MODEL", deepModel),
      effort: envEffort("PAYFIX_AGENT_DEEP_REASONING_EFFORT", "high"),
      verbosity: "low",
    },
    agentPatch: {
      model: patchModel,
      effort: envEffort("PAYFIX_PATCH_REASONING_EFFORT", "medium"),
      verbosity: "low",
    },
    agentSelector: {
      model: envValue("PAYFIX_SELECTOR_MODEL", fastModel),
      effort: envEffort("PAYFIX_SELECTOR_REASONING_EFFORT", "low"),
      verbosity: "low",
    },
    validation: {
      model: envValue("PAYFIX_VALIDATION_MODEL", fastModel),
      effort: envEffort("PAYFIX_VALIDATION_REASONING_EFFORT", "low"),
      verbosity: "low",
    },
    timeline: {
      model: envValue("PAYFIX_TIMELINE_MODEL", deepModel),
      effort: envEffort("PAYFIX_TIMELINE_REASONING_EFFORT", "medium"),
      verbosity: "medium",
    },
  };

  return profiles[profile];
}

export function payfixResponseConfig(profile: PayFixModelProfile, options: ResponseConfigOptions = {}) {
  const config = profileConfig(profile);
  const responseConfig: {
    model: string;
    reasoning?: { effort: ReasoningEffort };
    text?: Record<string, unknown>;
  } = {
    model: config.model,
  };

  if (supportsGpt5Controls(config.model)) {
    responseConfig.reasoning = { effort: config.effort };
    responseConfig.text = { verbosity: config.verbosity };
  }

  if (options.text) {
    responseConfig.text = {
      ...(responseConfig.text || {}),
      ...options.text,
    };
  }

  return responseConfig;
}

export function payfixAgentProfileForRequest(question: string): PayFixModelProfile {
  const text = question.toLowerCase();
  const isDeepAudit =
    /\b(deep|audit|hard|complex|root cause|security|race condition|regression|architecture|full project|entire project)\b/.test(
      text,
    );
  const isPatchRequest =
    /\b(fix|update|change|add|remove|delete|install|implement|make|build|repair|apply|do it)\b/.test(text);

  if (isDeepAudit) return "agentDeep";
  if (isPatchRequest) return "agentPatch";
  return "agentFast";
}
