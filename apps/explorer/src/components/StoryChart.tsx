import { useId } from 'react';
import type { ExplorerEvent, ExplorerStage } from '../types';
import { kindIcons } from './kindIcons';

interface StoryChartProps {
  stages: ExplorerStage[];
  events: ExplorerEvent[];
  index: number;
  numbered: boolean;
  onSelect: (index: number) => void;
}

const PAD = 5; // horizontal padding, in % of the plot
const TONE_COLOR = {
  neutral: '#818cf8',
  positive: '#818cf8',
  warning: '#fbbf24',
  critical: '#f87171',
} as const;

const xAt = (i: number, n: number) => (n <= 1 ? 50 : PAD + (i * (100 - 2 * PAD)) / (n - 1));
const yAt = (value: number) => 6 + (100 - value) * 0.88;

/**
 * The story as a picture: how much the work still means what the human intended
 * (meaning) against how finished it looks (build). Where they part ways is drift.
 */
export function StoryChart({ stages, events, index, numbered, onSelect }: StoryChartProps) {
  const id = useId();
  const n = stages.length;
  const meaning = stages.map((stage) => stage.metrics.semanticConfidence);
  const build = stages.map(
    (stage) =>
      events.find((event) => event.id === stage.focusEventId)?.confidence.implementation ?? 0,
  );
  const hasData = meaning.some((value) => value > 0);
  const baseline = meaning[0] ?? 0;

  const line = (values: number[]) => values.map((v, i) => `${xAt(i, n)},${yAt(v)}`).join(' ');
  const area = `${line(meaning)} ${meaning
    .map((_, i) => `${xAt(n - 1 - i, n)},${yAt(baseline)}`)
    .join(' ')}`;
  const revealTo = xAt(index, n);
  const close = Math.abs((meaning[index] ?? 0) - (build[index] ?? 0)) < 9; // dots nearly overlap

  return (
    <div className="story">
      <div className="plot" data-empty={!hasData}>
        {hasData ? (
          <>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id={`${id}-m`} gradientUnits="userSpaceOnUse" x1="0" x2="100">
                  {stages.map((stage, i) => (
                    <stop
                      key={stage.id}
                      offset={`${xAt(i, n)}%`}
                      stopColor={TONE_COLOR[stage.callout.tone]}
                    />
                  ))}
                </linearGradient>
                <clipPath id={`${id}-reveal`}>
                  <rect className="reveal" x="0" y="0" height="100" width={revealTo} />
                </clipPath>
              </defs>
              {[25, 50, 75].map((v) => (
                <line key={v} className="grid" x1="0" x2="100" y1={yAt(v)} y2={yAt(v)} />
              ))}
              <line className="baseline" x1="0" x2="100" y1={yAt(baseline)} y2={yAt(baseline)} />
              <g clipPath={`url(#${id}-reveal)`}>
                <polygon className="drift-area" points={area} />
                <polyline className="line build" points={line(build)} />
                <polyline
                  className="line meaning"
                  points={line(meaning)}
                  stroke={`url(#${id}-m)`}
                />
              </g>
            </svg>
            <span className="baseline-label" style={{ top: `${yAt(baseline)}%` }}>
              Intent baseline
            </span>
            <i className="playhead" style={{ left: `${revealTo}%` }} />
            <i
              className={`dot build ${revealTo > 78 ? 'flip' : ''} ${close ? 'close' : ''}`}
              style={{ left: `${revealTo}%`, top: `${yAt(build[index] ?? 0)}%` }}
            >
              <em>Build</em>
            </i>
            <i
              className={`dot meaning ${stages[index]?.callout.tone ?? 'neutral'} ${revealTo > 78 ? 'flip' : ''} ${close ? 'close' : ''}`}
              style={{ left: `${revealTo}%`, top: `${yAt(meaning[index] ?? 0)}%` }}
            >
              <em>Meaning</em>
            </i>
          </>
        ) : (
          <p className="plot-empty">This ledger carries no confidence data.</p>
        )}
      </div>

      <div className="beads">
        <i className="chain" />
        <i
          className="chain done"
          style={{ left: `${xAt(0, n)}%`, width: `${revealTo - xAt(0, n)}%` }}
        />
        {stages.map((stage, i) => {
          const event = events.find((item) => item.id === stage.focusEventId);
          const Icon = kindIcons[event?.kind ?? 'event'];
          return (
            <button
              key={stage.id}
              type="button"
              className={`bead tone-${stage.callout.tone} ${i === index ? 'current' : i < index ? 'past' : ''}`}
              style={{ left: `${xAt(i, n)}%` }}
              onClick={() => onSelect(i)}
              aria-label={`Go to step ${i + 1}: ${stage.label}`}
              aria-current={i === index ? 'step' : undefined}
            >
              <span className="orb">
                <Icon size={16} strokeWidth={2.2} />
              </span>
              <span className="tag">{numbered ? stage.label : i + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
