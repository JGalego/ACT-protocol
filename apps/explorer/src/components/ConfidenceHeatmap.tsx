import type { ExplorerEvent } from '../types';

interface ConfidenceHeatmapProps {
  events: ExplorerEvent[];
  selectedEventId: string;
  onSelect: (eventId: string) => void;
}

const DIMENSIONS: { key: 'semantic' | 'implementation' | 'verification'; label: string }[] = [
  { key: 'semantic', label: 'Semantic' },
  { key: 'implementation', label: 'Implementation' },
  { key: 'verification', label: 'Verification' },
];

/** Maps a 0-100 confidence value to a background color: red (low) through amber to green (high). */
function toneFor(value: number): string {
  if (value <= 0) return 'transparent';
  const hue = Math.max(0, Math.min(120, (value / 100) * 120));
  return `hsl(${hue}, 65%, 42%)`;
}

/**
 * Repository-wide confidence overview: every event's semantic,
 * implementation, and verification confidence side by side, so
 * low-confidence records anywhere in the ledger are visible without
 * stepping through the timeline one stage at a time.
 */
export function ConfidenceHeatmap({ events, selectedEventId, onSelect }: ConfidenceHeatmapProps) {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="confidence-heatmap" role="region" aria-label="Confidence heatmap">
      <table>
        <caption className="sr-only">
          Semantic, implementation, and verification confidence for every record, in ledger order
        </caption>
        <thead>
          <tr>
            <th scope="col">Record</th>
            {DIMENSIONS.map((dimension) => (
              <th scope="col" key={dimension.key}>
                {dimension.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((event) => (
            <tr key={event.id} className={event.id === selectedEventId ? 'selected' : ''}>
              <th scope="row">
                <button
                  type="button"
                  onClick={() => onSelect(event.id)}
                  aria-label={`Select record: ${event.title}`}
                >
                  <span className="heatmap-sequence">{event.sequence}</span>
                  {event.title}
                </button>
              </th>
              {DIMENSIONS.map((dimension) => {
                const value = event.confidence[dimension.key];
                return (
                  <td key={dimension.key}>
                    <button
                      type="button"
                      className="heatmap-cell"
                      style={{ backgroundColor: toneFor(value) }}
                      onClick={() => onSelect(event.id)}
                      aria-label={`${event.title}: ${dimension.label} confidence ${value || 'not applicable'}${value ? '%' : ''}`}
                      aria-pressed={event.id === selectedEventId}
                    >
                      {value ? `${value}%` : '—'}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
