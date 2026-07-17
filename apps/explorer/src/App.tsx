import { useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  Code2,
  FileCheck2,
  Fingerprint,
  GitBranch,
  KeyRound,
  Link2,
  ListTree,
  Pause,
  Play,
  Plug,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ProtocolGraph } from './components/ProtocolGraph';
import { demoScenario } from './data/demo-scenario';
import { loadLiveScenario } from './data/live-ledger';
import type { EventKind, ExplorerEvent, ExplorerScenario } from './types';

type InspectorTab = 'summary' | 'evidence' | 'envelope';

const kindIcons: Record<EventKind, LucideIcon> = {
  intent: UserRound,
  proposal: Bot,
  transformation: GitBranch,
  approval: KeyRound,
  implementation: Code2,
  test: FileCheck2,
  verification: ShieldCheck,
  challenge: AlertTriangle,
  revision: RefreshCcw,
  observation: Activity,
  event: CircleDot,
};

const playbackSpeeds = [
  { label: '0.75x', milliseconds: 2800 },
  { label: '1x', milliseconds: 2000 },
  { label: '1.5x', milliseconds: 1200 },
];

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reducedMotion;
}

function shortDigest(digest: string): string {
  if (digest.length <= 28) return digest;
  return `${digest.slice(0, 17)}...${digest.slice(-8)}`;
}

function ConfidenceBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="confidence-row">
      <div className="confidence-label">
        <span>{label}</span>
        <strong>
          {value || 'n/a'}
          {value ? '%' : ''}
        </strong>
      </div>
      <div className="confidence-track" aria-hidden="true">
        <span className={`confidence-value ${tone}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function ConnectDialog({
  open,
  onClose,
  onConnect,
  onUseDemo,
}: {
  open: boolean;
  onClose: () => void;
  onConnect: (baseUrl: string, token: string) => Promise<void>;
  onUseDemo: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState('http://localhost:4000');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConnecting(true);
    setError('');
    try {
      await onConnect(baseUrl, token);
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : 'Could not connect.');
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">Data source</p>
            <h2 id="connect-title">Connect an ACT ledger</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close connection dialog"
            title="Close"
          >
            <X size={18} />
          </button>
        </header>
        <p className="dialog-copy">
          Load ordered signed envelopes from the reference API. Credentials stay in this browser tab
          and are not persisted.
        </p>
        <form onSubmit={submit}>
          <label>
            API base URL
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              required
            />
          </label>
          <label>
            Development bearer actor id
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              placeholder="Optional when the API permits anonymous reads"
            />
          </label>
          {error ? (
            <p className="connection-error" role="alert">
              <AlertTriangle size={16} />
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="text-button secondary" onClick={onUseDemo}>
              <Sparkles size={17} />
              Replay demonstration
            </button>
            <button type="submit" className="text-button primary" disabled={connecting}>
              <Plug size={17} />
              {connecting ? 'Connecting...' : 'Connect ledger'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function EventInspector({
  event,
  tab,
  onTabChange,
}: {
  event: ExplorerEvent;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
}) {
  const EventIcon = kindIcons[event.kind];
  return (
    <aside className="inspector" aria-label="Selected ACT record">
      <div className="inspector-heading">
        <div className={`event-icon ${event.kind}`}>
          <EventIcon size={18} />
        </div>
        <div>
          <p className="record-type">{event.eventType.replaceAll('_', ' ')}</p>
          <h2>{event.title}</h2>
        </div>
        <span className={`record-status ${event.status}`}>{event.status}</span>
      </div>

      <div className="inspector-tabs" role="tablist" aria-label="Record detail views">
        {(['summary', 'evidence', 'envelope'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => onTabChange(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="inspector-body">
        {tab === 'summary' ? (
          <div className="tab-panel" role="tabpanel">
            <p className="record-summary">{event.summary}</p>
            <dl className="record-facts">
              <div>
                <dt>Actor</dt>
                <dd>
                  <span className={`actor-mark ${event.actor.type}`} />
                  {event.actor.name}
                  <small>{event.actor.role}</small>
                </dd>
              </div>
              <div>
                <dt>Recorded</dt>
                <dd>
                  <Clock3 size={15} />
                  {event.timestamp}
                </dd>
              </div>
              <div>
                <dt>Semantic claim</dt>
                <dd>{event.semanticChange}</dd>
              </div>
              <div>
                <dt>Envelope</dt>
                <dd>
                  <Fingerprint size={15} />
                  {event.signatureStatus === 'demonstration'
                    ? 'Demonstration identity'
                    : event.signatureStatus}
                </dd>
              </div>
            </dl>
            <section className="inspector-section">
              <h3>Rationale</h3>
              <p>{event.rationale}</p>
            </section>
            <section className="inspector-section">
              <h3>Confidence</h3>
              <ConfidenceBar
                label="Semantic"
                value={event.confidence.semantic}
                tone={event.confidence.semantic < 65 ? 'critical' : 'semantic'}
              />
              <ConfidenceBar
                label="Implementation"
                value={event.confidence.implementation}
                tone="implementation"
              />
              <ConfidenceBar
                label="Verification"
                value={event.confidence.verification}
                tone="verification"
              />
            </section>
            {event.assumptions.length ? (
              <section className="inspector-section">
                <h3>Assumptions</h3>
                <ul className="detail-list">
                  {event.assumptions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {event.uncertainties.length ? (
              <section className="inspector-section">
                <h3>Remaining uncertainty</h3>
                <ul className="detail-list uncertainty">
                  {event.uncertainties.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === 'evidence' ? (
          <div className="tab-panel" role="tabpanel">
            <section className="inspector-section flush">
              <h3>Lineage</h3>
              {event.parents.length ? (
                <ul className="evidence-list">
                  {event.parents.map((parent) => (
                    <li key={`${parent.id}-${parent.relation}`}>
                      <Link2 size={16} />
                      <div>
                        <strong>{parent.relation}</strong>
                        <code>{shortDigest(parent.id)}</code>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">This is a root record with no causal parents.</p>
              )}
            </section>
            <section className="inspector-section">
              <h3>
                Attached evidence <span>{event.evidence.length}</span>
              </h3>
              {event.evidence.length ? (
                <ul className="evidence-list">
                  {event.evidence.map((item) => (
                    <li key={item.id}>
                      <CheckCircle2 size={17} className={item.status === 'open' ? 'open' : ''} />
                      <div>
                        <strong>{item.label}</strong>
                        <span>
                          {item.type} / {item.status}
                        </span>
                        <p>{item.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">No evidence descriptors are present in this record.</p>
              )}
            </section>
            <section className="digest-block">
              <span>Content digest</span>
              <code>{event.digest}</code>
            </section>
          </div>
        ) : null}

        {tab === 'envelope' ? (
          <div className="tab-panel envelope-panel" role="tabpanel">
            <div className="envelope-note">
              <ShieldCheck size={16} />
              <span>
                {event.signatureStatus === 'attached'
                  ? 'Signature attached; browser verification is not claimed.'
                  : 'Deterministic presentation fixture; use Live ledger to inspect API envelopes.'}
              </span>
            </div>
            <pre>
              <code>{JSON.stringify(event.payload, null, 2)}</code>
            </pre>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export default function App() {
  const [scenario, setScenario] = useState<ExplorerScenario>(demoScenario);
  const [stageIndex, setStageIndex] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState(demoScenario.stages[0]!.focusEventId);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('summary');
  const [connectOpen, setConnectOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const stage = scenario.stages[stageIndex]!;
  const selectedEvent =
    scenario.events.find((item) => item.id === selectedEventId) ?? scenario.events[0]!;
  const isLastStage = stageIndex === scenario.stages.length - 1;

  useEffect(() => {
    setSelectedEventId(stage.focusEventId);
    setInspectorTab('summary');
  }, [stage.focusEventId]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setTimeout(() => {
      if (stageIndex >= scenario.stages.length - 1) {
        setPlaying(false);
        return;
      }
      setStageIndex((current) => current + 1);
    }, playbackSpeeds[speedIndex]!.milliseconds);
    return () => window.clearTimeout(timer);
  }, [playing, scenario.stages.length, speedIndex, stageIndex]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
      if (event.key === ' ') {
        event.preventDefault();
        if (isLastStage && !playing) setStageIndex(0);
        setPlaying((current) => !current);
      }
      if (event.key === 'ArrowRight')
        setStageIndex((current) => Math.min(current + 1, scenario.stages.length - 1));
      if (event.key === 'ArrowLeft') setStageIndex((current) => Math.max(current - 1, 0));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLastStage, playing, scenario.stages.length]);

  function selectEvent(eventId: string) {
    setSelectedEventId(eventId);
    const eventStage = scenario.stages.findIndex((item) => item.focusEventId === eventId);
    if (eventStage >= 0) setStageIndex(eventStage);
  }

  function togglePlayback() {
    if (isLastStage && !playing) setStageIndex(0);
    setPlaying((current) => !current);
  }

  async function connect(baseUrl: string, token: string) {
    const liveScenario = await loadLiveScenario(baseUrl, token);
    setScenario(liveScenario);
    setStageIndex(0);
    setSelectedEventId(liveScenario.stages[0]!.focusEventId);
    setPlaying(false);
    setConnectOpen(false);
  }

  function useDemo() {
    setScenario(demoScenario);
    setStageIndex(0);
    setSelectedEventId(demoScenario.stages[0]!.focusEventId);
    setPlaying(false);
    setConnectOpen(false);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img src="/logo.svg" alt="" width="38" height="38" />
          <div>
            <strong>ACT Explorer</strong>
            <span>Accountability and Chain of Transformation</span>
          </div>
        </div>
        <div className="scenario-context">
          <span className={`source-dot ${scenario.source}`} />
          <div>
            <strong>{scenario.name}</strong>
            <span>{scenario.source === 'live' ? scenario.sourceDetail : 'Seeded walkthrough'}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="ledger-health">
            <Check size={14} />
            {scenario.events.length} records
          </span>
          <button
            type="button"
            className="text-button secondary source-button"
            onClick={() => setConnectOpen(true)}
            aria-label="Data source"
          >
            <Plug size={17} />
            <span>Data source</span>
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="stage-canvas" aria-labelledby="stage-title">
          <div className="stage-copy">
            <div>
              <p className="eyebrow">
                <span>{String(stageIndex + 1).padStart(2, '0')}</span>
                {stage.eyebrow}
              </p>
              <h1 id="stage-title">{stage.title}</h1>
              <p>{stage.description}</p>
            </div>
            <div className={`stage-callout ${stage.callout.tone}`}>
              {stage.callout.tone === 'critical' || stage.callout.tone === 'warning' ? (
                <AlertTriangle size={18} />
              ) : (
                <ShieldCheck size={18} />
              )}
              <div>
                <strong>{stage.callout.label}</strong>
                <span>{stage.callout.text}</span>
              </div>
            </div>
          </div>

          <ProtocolGraph
            events={scenario.events}
            visibleThrough={stage.visibleThrough}
            focusEventId={stage.focusEventId}
            selectedEventId={selectedEventId}
            reducedMotion={reducedMotion}
            onSelect={selectEvent}
          />

          <div className="metric-strip" aria-label="ACT ledger metrics at this stage">
            <div className="metric">
              <ListTree size={16} />
              <span>
                Records<strong>{stage.metrics.records}</strong>
              </span>
            </div>
            <div className="metric">
              <Fingerprint size={16} />
              <span>
                Signatures<strong>{stage.metrics.signatures}</strong>
              </span>
            </div>
            <div className="metric">
              <KeyRound size={16} />
              <span>
                Approvals<strong>{stage.metrics.approvals}</strong>
              </span>
            </div>
            <div className="metric wide">
              <span>
                Semantic confidence
                <strong>
                  {stage.metrics.semanticConfidence
                    ? `${stage.metrics.semanticConfidence}%`
                    : 'n/a'}
                </strong>
              </span>
              <i>
                <b style={{ width: `${stage.metrics.semanticConfidence}%` }} />
              </i>
            </div>
            <div className={`metric drift ${stage.metrics.drift > 0 ? 'active' : ''}`}>
              <Activity size={16} />
              <span>
                Intent drift<strong>{stage.metrics.drift}%</strong>
              </span>
            </div>
          </div>
        </section>

        <EventInspector event={selectedEvent} tab={inspectorTab} onTabChange={setInspectorTab} />
      </main>

      <footer className="playback-panel">
        <div className="transport-controls">
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setPlaying(false);
              setStageIndex(0);
            }}
            aria-label="Restart demonstration"
            title="Restart"
          >
            <RotateCcw size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setStageIndex((current) => Math.max(0, current - 1))}
            disabled={stageIndex === 0}
            aria-label="Previous stage"
            title="Previous"
          >
            <ArrowLeft size={18} />
          </button>
          <button
            type="button"
            className="play-button"
            onClick={togglePlayback}
            aria-label={playing ? 'Pause demonstration' : 'Play demonstration'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <Pause size={19} fill="currentColor" />
            ) : (
              <Play size={19} fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() =>
              setStageIndex((current) => Math.min(scenario.stages.length - 1, current + 1))
            }
            disabled={isLastStage}
            aria-label="Next stage"
            title="Next"
          >
            <ArrowRight size={18} />
          </button>
        </div>

        <div className="timeline-control">
          <div className="timeline-meta">
            <span>Transformation timeline</span>
            <strong>
              {stageIndex + 1} / {scenario.stages.length}
            </strong>
          </div>
          <input
            type="range"
            min="0"
            max={scenario.stages.length - 1}
            value={stageIndex}
            onChange={(event) => {
              setPlaying(false);
              setStageIndex(Number(event.target.value));
            }}
            aria-label="Transformation timeline"
            aria-valuetext={`${stage.label}: ${stage.title}`}
            style={
              {
                '--timeline-progress': `${(stageIndex / Math.max(1, scenario.stages.length - 1)) * 100}%`,
              } as React.CSSProperties
            }
          />
          <div className="timeline-labels" aria-hidden="true">
            {scenario.stages.map((item, index) => (
              <span
                key={item.id}
                className={index === stageIndex ? 'current' : index < stageIndex ? 'complete' : ''}
              >
                {scenario.source === 'demonstration' ? item.label : index + 1}
              </span>
            ))}
          </div>
        </div>

        <div className="speed-control" aria-label="Playback speed">
          {playbackSpeeds.map((speed, index) => (
            <button
              key={speed.label}
              type="button"
              className={index === speedIndex ? 'active' : ''}
              onClick={() => setSpeedIndex(index)}
              aria-pressed={index === speedIndex}
            >
              {speed.label}
            </button>
          ))}
        </div>
      </footer>

      <ConnectDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnect={connect}
        onUseDemo={useDemo}
      />
    </div>
  );
}
