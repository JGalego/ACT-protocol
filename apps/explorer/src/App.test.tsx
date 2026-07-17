import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/ProtocolGraph', () => ({
  ProtocolGraph: ({ visibleThrough }: { visibleThrough: number }) => (
    <div data-testid="protocol-graph">Visible records: {visibleThrough}</div>
  ),
}));

describe('ACT Explorer demonstration', () => {
  it('steps through the transformation with buttons and keyboard controls', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'The constraint begins with the intent' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next stage' }));
    expect(
      screen.getByRole('heading', { name: 'An AI proposes a path, not a decision' }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(
      screen.getByRole('heading', { name: 'A hidden assumption enters the chain' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(
      screen.getByRole('heading', { name: 'An AI proposes a path, not a decision' }),
    ).toBeInTheDocument();
  });

  it('scrubs directly to drift detection and exposes its evidence', () => {
    render(<App />);
    const timeline = screen.getByRole('slider', { name: 'Transformation timeline' });

    fireEvent.change(timeline, { target: { value: '6' } });
    expect(
      screen.getByRole('heading', { name: 'The baseline exposes intent drift' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Drift detected')).toBeInTheDocument();
    expect(screen.getByText('31%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'evidence' }));
    expect(screen.getByText('Semantic baseline comparison')).toBeInTheDocument();
    expect(screen.getByText(/Candidate retains content after resolution/)).toBeInTheDocument();
  });

  it('reaches the observed outcome and can restart the story', () => {
    render(<App />);
    const timeline = screen.getByRole('slider', { name: 'Transformation timeline' });

    fireEvent.change(timeline, { target: { value: '9' } });
    expect(
      screen.getByRole('heading', { name: 'Runtime evidence closes the loop' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('38% faster first response; zero retained payloads.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restart demonstration' }));
    expect(
      screen.getByRole('heading', { name: 'The constraint begins with the intent' }),
    ).toBeInTheDocument();
  });

  it('opens the source dialog and returns to the deterministic demonstration', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Data source/ }));
    expect(screen.getByRole('dialog', { name: 'Connect an ACT ledger' })).toBeInTheDocument();
    expect(screen.getByLabelText('API base URL')).toHaveValue('http://localhost:4000');

    fireEvent.click(screen.getByRole('button', { name: /Replay demonstration/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
