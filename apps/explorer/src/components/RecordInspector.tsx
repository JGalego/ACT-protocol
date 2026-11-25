import { CheckCircle2, Link2, ShieldCheck } from 'lucide-react';
import type { ExplorerEvent } from '../types';
import { kindIcons } from './kindIcons';

export type InspectorTab = 'summary' | 'evidence' | 'envelope';

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

export function RecordInspector({
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
                <dt>Claim</dt>
                <dd>
                  <b className="chip">{event.semanticChange}</b>
                </dd>
              </div>
            </dl>
            <section className="inspector-section">
              <h3>Why</h3>
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
                <h3>Open questions</h3>
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
