import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

const readout = () => within(screen.getByLabelText('What the chart shows'));

describe('ACT Explorer demonstration', () => {
  it('steps through the story with buttons and keyboard controls', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Baseline' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next stage' }));
    expect(screen.getByRole('heading', { name: 'Provenance' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'New assumption' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: 'Provenance' })).toBeInTheDocument();
  });

  it('labels what the chart shows and flags the drift', () => {
    render(<App />);

    expect(readout().getByText('Meaning')).toBeInTheDocument();
    expect(readout().getByText('Build')).toBeInTheDocument();
    expect(readout().queryByText('Drift')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Go to step 7: Verify/ }));
    expect(screen.getByRole('heading', { name: 'Drift detected' })).toBeInTheDocument();
    expect(readout().getByText('52%')).toBeInTheDocument();
    expect(readout().getByText('94%')).toBeInTheDocument();
    expect(readout().getByText('31%')).toBeInTheDocument();
  });

  it('scrubs to drift detection and exposes its evidence in the record panel', () => {
    render(<App />);
    const timeline = screen.getByRole('slider', { name: 'Transformation timeline' });

    fireEvent.change(timeline, { target: { value: '6' } });
    expect(screen.getByRole('heading', { name: 'Intent drift detected' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'evidence' }));
    expect(screen.getByText('Semantic baseline comparison')).toBeInTheDocument();
    expect(screen.getByText(/Candidate retains content after resolution/)).toBeInTheDocument();
  });

  it('reaches the observed outcome and can restart the story', () => {
    render(<App />);
    const timeline = screen.getByRole('slider', { name: 'Transformation timeline' });

    fireEvent.change(timeline, { target: { value: '9' } });
    expect(screen.getByRole('heading', { name: 'Intent met' })).toBeInTheDocument();
    expect(
      screen.getByText('38% faster first response; zero retained payloads.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restart demonstration' }));
    expect(screen.getByRole('heading', { name: 'Baseline' })).toBeInTheDocument();
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
