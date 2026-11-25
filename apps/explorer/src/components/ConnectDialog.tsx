import { useState, type FormEvent } from 'react';
import { AlertTriangle, Plug, Sparkles, X } from 'lucide-react';

export function ConnectDialog({
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
