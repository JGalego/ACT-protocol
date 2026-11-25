import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play, Plug, RotateCcw } from 'lucide-react';
import { ConnectDialog } from './components/ConnectDialog';
import { RecordInspector, type InspectorTab } from './components/RecordInspector';
import { StoryChart } from './components/StoryChart';
import { demoScenario } from './data/demo-scenario';
import { loadLiveScenario } from './data/live-ledger';
import type { ExplorerScenario } from './types';

const playbackSpeeds = [
  { label: '0.75x', milliseconds: 3200 },
  { label: '1x', milliseconds: 2400 },
  { label: '1.5x', milliseconds: 1500 },
];

export default function App() {
  const [scenario, setScenario] = useState<ExplorerScenario>(demoScenario);
  const [stageIndex, setStageIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('summary');
  const [connectOpen, setConnectOpen] = useState(false);

  const stage = scenario.stages[stageIndex]!;
  const selectedEvent =
    scenario.events.find((item) => item.id === stage.focusEventId) ?? scenario.events[0]!;
  const isLastStage = stageIndex === scenario.stages.length - 1;
  const stageCount = scenario.stages.length;
  const build = selectedEvent.confidence.implementation;
  const meaningLow = stage.metrics.semanticConfidence > 0 && stage.metrics.semanticConfidence < 65;

  useEffect(() => setInspectorTab('summary'), [stage.focusEventId]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setTimeout(() => {
      if (stageIndex >= stageCount - 1) {
        setPlaying(false);
        return;
      }
      setStageIndex((current) => current + 1);
    }, playbackSpeeds[speedIndex]!.milliseconds);
    return () => window.clearTimeout(timer);
  }, [playing, stageCount, speedIndex, stageIndex]);

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
        setStageIndex((current) => Math.min(current + 1, stageCount - 1));
      if (event.key === 'ArrowLeft') setStageIndex((current) => Math.max(current - 1, 0));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLastStage, playing, stageCount]);

  function goTo(index: number) {
    setPlaying(false);
    setStageIndex(index);
  }

  function togglePlayback() {
    if (isLastStage && !playing) setStageIndex(0);
    setPlaying((current) => !current);
  }

  function load(next: ExplorerScenario) {
    setScenario(next);
    setStageIndex(0);
    setPlaying(false);
    setConnectOpen(false);
  }

  async function connect(baseUrl: string, token: string) {
    load(await loadLiveScenario(baseUrl, token));
  }

  return (
    <div className="app" data-tone={stage.callout.tone}>
      <div className="glow" key={stage.callout.tone} aria-hidden="true" />

      <header className="bar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width="30" height="30" />
          <strong>ACT Explorer</strong>
        </div>
        <span className="context">{scenario.name}</span>
        <button
          type="button"
          className="ghost"
          onClick={() => setConnectOpen(true)}
          aria-label="Data source"
        >
          <Plug size={16} />
          <span>Data source</span>
        </button>
      </header>

      <div className="body">
        <main className="stage">
          <section className="headline" aria-labelledby="stage-title">
            <p className="step">
              <b>{String(stageIndex + 1).padStart(2, '0')}</b>
              <span>/ {stageCount}</span>
              {stage.eyebrow}
            </p>
            <h1 id="stage-title" key={stage.id}>
              {stage.callout.label}
            </h1>
            <p className="sub">{stage.callout.text}</p>
          </section>

          <dl className="readout" aria-label="What the chart shows">
            <div className={`reading meaning ${meaningLow ? 'low' : ''}`}>
              <dt>Meaning</dt>
              <dd key={`m${stageIndex}`}>
                {stage.metrics.semanticConfidence ? `${stage.metrics.semanticConfidence}%` : 'n/a'}
              </dd>
              <small>still matches the intent</small>
            </div>
            <div className="reading build">
              <dt>Build</dt>
              <dd key={`b${stageIndex}`}>{build ? `${build}%` : 'n/a'}</dd>
              <small>how finished it looks</small>
            </div>
            {stage.metrics.drift > 0 ? (
              <div className="reading drift">
                <dt>Drift</dt>
                <dd key={`d${stageIndex}`}>{stage.metrics.drift}%</dd>
                <small>gap from the intent</small>
              </div>
            ) : null}
          </dl>

          <StoryChart
            stages={scenario.stages}
            events={scenario.events}
            index={stageIndex}
            numbered={scenario.source === 'demonstration'}
            onSelect={goTo}
          />

          <div className="controls">
            <div className="transport">
              <button
                type="button"
                className="round"
                onClick={() => goTo(0)}
                aria-label="Restart demonstration"
                title="Restart"
              >
                <RotateCcw size={16} />
              </button>
              <button
                type="button"
                className="round"
                onClick={() => goTo(Math.max(0, stageIndex - 1))}
                disabled={stageIndex === 0}
                aria-label="Previous stage"
                title="Previous"
              >
                <ArrowLeft size={17} />
              </button>
              <button
                type="button"
                className="play"
                onClick={togglePlayback}
                aria-label={playing ? 'Pause demonstration' : 'Play demonstration'}
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? (
                  <Pause size={20} fill="currentColor" />
                ) : (
                  <Play size={20} fill="currentColor" />
                )}
              </button>
              <button
                type="button"
                className="round"
                onClick={() => goTo(Math.min(stageCount - 1, stageIndex + 1))}
                disabled={isLastStage}
                aria-label="Next stage"
                title="Next"
              >
                <ArrowRight size={17} />
              </button>
            </div>

            <input
              className="sr-only"
              type="range"
              min="0"
              max={stageCount - 1}
              value={stageIndex}
              onChange={(event) => goTo(Number(event.target.value))}
              aria-label="Transformation timeline"
              aria-valuetext={`${stage.label}: ${stage.title}`}
            />

            <button
              type="button"
              className="ghost speed"
              onClick={() => setSpeedIndex((current) => (current + 1) % playbackSpeeds.length)}
              aria-label={`Playback speed ${playbackSpeeds[speedIndex]!.label}`}
            >
              {playbackSpeeds[speedIndex]!.label}
            </button>
          </div>
        </main>

        <div className="side">
          <RecordInspector event={selectedEvent} tab={inspectorTab} onTabChange={setInspectorTab} />
        </div>
      </div>

      <ConnectDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnect={connect}
        onUseDemo={() => load(demoScenario)}
      />
    </div>
  );
}
