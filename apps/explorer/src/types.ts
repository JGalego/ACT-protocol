export type EventKind =
  | 'intent'
  | 'proposal'
  | 'transformation'
  | 'approval'
  | 'implementation'
  | 'test'
  | 'verification'
  | 'challenge'
  | 'revision'
  | 'observation'
  | 'event';

export type EventStatus =
  | 'recorded'
  | 'proposed'
  | 'approved'
  | 'passed'
  | 'challenged'
  | 'superseded'
  | 'resolved'
  | 'observed';

export interface ActorSummary {
  id: string;
  name: string;
  role: string;
  type: 'human' | 'ai' | 'service';
}

export interface EvidenceSummary {
  id: string;
  label: string;
  type: string;
  status: 'verified' | 'recorded' | 'open' | 'superseded';
  detail: string;
}

export interface ConfidenceSummary {
  semantic: number;
  implementation: number;
  verification: number;
}

export interface ExplorerEvent {
  id: string;
  sequence: number;
  eventType: string;
  kind: EventKind;
  status: EventStatus;
  title: string;
  summary: string;
  timestamp: string;
  actor: ActorSummary;
  parents: Array<{ id: string; relation: string }>;
  position: { x: number; y: number };
  digest: string;
  signatureStatus: 'verified' | 'attached' | 'demonstration' | 'missing';
  semanticChange: string;
  rationale: string;
  assumptions: string[];
  uncertainties: string[];
  evidence: EvidenceSummary[];
  confidence: ConfidenceSummary;
  payload: Record<string, unknown>;
}

export interface ExplorerStage {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  focusEventId: string;
  visibleThrough: number;
  callout: {
    tone: 'neutral' | 'positive' | 'warning' | 'critical';
    label: string;
    text: string;
  };
  metrics: {
    records: number;
    signatures: number;
    approvals: number;
    semanticConfidence: number;
    drift: number;
  };
}

export interface ExplorerScenario {
  id: string;
  name: string;
  description: string;
  source: 'demonstration' | 'live';
  sourceDetail: string;
  events: ExplorerEvent[];
  stages: ExplorerStage[];
}
