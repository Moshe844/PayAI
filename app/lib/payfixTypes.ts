export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachedLog?: string;
  attachedCode?: string;
  attachedUploads?: UploadedFile[];
  generatedFiles?: GeneratedFile[];
  isAgentSessionSummary?: boolean;
  agentSessionMessages?: ChatMessage[];
  agentPatchData?: unknown;
  patchAlreadyApplied?: boolean;
  agentProgress?: AgentProgressStep[];
};

export type AgentProgressStep = {
  step: string;
  message: string;
  at: string;
};

export type UploadedFile = {
  name: string;
  type: string;
  size: number;
  content: string;
  isImage: boolean;
  width?: number;
  height?: number;
};

export type GeneratedFile = {
  name: string;
  type: string;
  size: number;
  content: string;
};

export type SavedChat = {
  id: string;
  title: string;
  createdAt: string;
  lastActivityAt?: string;
  messages: ChatMessage[];
  projectPath?: string;
  connectedProjectPath?: string;
  projectContext?: string;
  computerSearchResults?: string;
  computerSearchPreview?: string;
  searchFolder?: string;
  searchFileName?: string;
  searchText?: string;
  lastConnectedAt?: string;
};

export type RunnerMode = "html" | "css" | "js" | "unsupported";

export type AttachTab = "search" | "upload" | "project";

export type PaymentTimelineStage =
  | "frontend"
  | "backend"
  | "gateway"
  | "webhook"
  | "database"
  | "ui"
  | "device"
  | "unknown";

export type PaymentTimelineSeverity = "info" | "warning" | "critical";

export type PaymentTimelineEvent = {
  id: string;
  stage: PaymentTimelineStage;
  timestamp?: string;
  sequence: number;
  source: string;
  action: string;
  status: string;
  gateway?: string;
  transactionId?: string;
  orderId?: string;
  amount?: string;
  evidence: string;
  confidence: number;
};

export type PaymentTimelineAnomaly = {
  id: string;
  type:
    | "missing_stage"
    | "duplicate_event"
    | "long_gap"
    | "status_mismatch"
    | "webhook_mismatch"
    | "unsafe_retry"
    | "low_confidence";
  severity: PaymentTimelineSeverity;
  title: string;
  detail: string;
  relatedEventIds: string[];
};

export type PaymentTimelineResult = {
  summary: string;
  correlation: {
    transactionIds: string[];
    orderIds: string[];
    gateways: string[];
  };
  sourceEvidence?: UploadedFile[];
  rootCauseAnalysis?: {
    title: string;
    detail: string;
    confidence: number;
    evidence: string[];
  };
  investigationFindings?: {
    title: string;
    detail: string;
    severity: PaymentTimelineSeverity;
    evidence: string;
  }[];
  fixActions?: {
    title: string;
    detail: string;
    owner: string;
    priority: PaymentTimelineSeverity;
  }[];
  externalLookups?: {
    query: string;
    result: string;
    sourceUrl?: string;
    confidence: number;
  }[];
  aplSources?: {
    state: string;
    url: string;
    note: string;
  }[];
  lineItemAnalysis?: {
    line: string;
    upc: string;
    quantity: string;
    unitPrice: string;
    amount: string;
    category: string;
    aplStatus: string;
    finding: string;
    severity: PaymentTimelineSeverity;
    evidence: string;
  }[];
  events: PaymentTimelineEvent[];
  anomalies: PaymentTimelineAnomaly[];
  recommendedNextSteps: string[];
};

export type EmvTlvTag = {
  tag: string;
  name: string;
  value: string;
  offset: number;
  ascii?: string;
};

export type EmvTlvDecodeResult = {
  isTlv: boolean;
  rawHex: string;
  summary: string;
  tags: EmvTlvTag[];
  signals: {
    cryptogram?: string;
    outcome?: string;
    authorizationResponse?: string;
    amount?: string;
    currency?: string;
    application?: string;
    tvr?: string;
  };
  troubleshootingFindings?: {
    title: string;
    detail: string;
    severity: PaymentTimelineSeverity;
    evidence: string;
  }[];
  suspectTags?: {
    tag: string;
    title: string;
    value: string;
    meaning: string;
    severity: PaymentTimelineSeverity;
  }[];
  limitations: string[];
  nextSteps: string[];
};

export type LiveAppFinding = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  evidence: string;
  sourceHint?: string;
};

export type LiveAppNetworkEntry = {
  url: string;
  method: string;
  resourceType: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseMimeType?: string;
  failure?: string;
};

export type LiveAppConsoleEntry = {
  type: string;
  text: string;
  location?: string;
};

export type LiveAppDomSnapshot = {
  title: string;
  url: string;
  bodyText: string;
  documentWidth: number;
  viewportWidth: number;
  horizontalOverflow: boolean;
  forms: {
    id: string;
    action: string;
    method: string;
    fields: number;
  }[];
  buttons: {
    text: string;
    id: string;
    type: string;
  }[];
  links: {
    text: string;
    href: string;
  }[];
  imagesWithoutAlt: number;
  overflowElements: {
    tag: string;
    id: string;
    className: string;
    text: string;
    scrollWidth: number;
    clientWidth: number;
    right: number;
    viewportWidth: number;
    position: string;
  }[];
  visualTargets: {
    selector: string;
    tag: string;
    id: string;
    className: string;
    text: string;
    role: string;
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    styles: {
      color: string;
      backgroundColor: string;
      fontSize: string;
      display: string;
      position: string;
    };
  }[];
};

export type LiveAppRootCause = {
  title: string;
  confidence: number;
  why: string;
  likelyFiles: {
    file: string;
    reason: string;
    imports?: string[];
    importedBy?: string[];
  }[];
  suggestedFix: string;
};

export type LiveAppDetectedProject = {
  root: string;
  packageName: string;
  framework: string;
  confidence: number;
  reason: string;
  processHint?: string;
  candidates?: {
    root: string;
    packageName: string;
    framework: string;
    confidence: number;
    reason: string;
  }[];
};

export type LiveAppInspectionResult = {
  ok: boolean;
  inspectedAt: string;
  targetUrl: string;
  detectedApps: {
    port: number;
    url: string;
  }[];
  durationMs?: number;
  screenshotBase64?: string;
  detectedProject?: LiveAppDetectedProject;
  dom?: LiveAppDomSnapshot;
  consoleMessages: LiveAppConsoleEntry[];
  pageErrors: string[];
  network: LiveAppNetworkEntry[];
  findings: LiveAppFinding[];
  rootCause?: LiveAppRootCause;
  error?: string;
  setup?: string[];
};
