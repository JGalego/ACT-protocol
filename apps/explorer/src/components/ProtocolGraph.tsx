import { useEffect, useRef } from 'react';
import cytoscape, { type Core, type StylesheetJson } from 'cytoscape';
import type { ExplorerEvent } from '../types';

interface ProtocolGraphProps {
  events: ExplorerEvent[];
  visibleThrough: number;
  focusEventId: string;
  selectedEventId: string;
  reducedMotion: boolean;
  onSelect: (eventId: string) => void;
}

const graphStyles: StylesheetJson = [
  {
    selector: 'node',
    style: {
      width: 142,
      height: 64,
      shape: 'round-rectangle',
      'background-color': '#ffffff',
      'border-width': 2,
      'border-color': '#a7b0ae',
      label: 'data(label)',
      color: '#17242b',
      'font-family': 'IBM Plex Sans Variable, sans-serif',
      'font-size': 12,
      'font-weight': 600,
      'text-wrap': 'wrap',
      'text-max-width': '118px',
      'text-valign': 'center',
      'text-halign': 'center',
      'overlay-opacity': 0,
      opacity: 1,
      'transition-property': 'opacity, border-color, border-width, background-color',
      'transition-duration': 300,
    },
  },
  {
    selector: 'node[kind = "intent"]',
    style: { 'border-color': '#315f95', 'background-color': '#edf4fb' },
  },
  {
    selector: 'node[kind = "proposal"]',
    style: { 'border-color': '#73633f', 'background-color': '#faf5e9' },
  },
  {
    selector: 'node[kind = "transformation"]',
    style: {
      shape: 'diamond',
      width: 92,
      height: 92,
      'text-max-width': '74px',
      'border-color': '#087f73',
      'background-color': '#e7f4f1',
    },
  },
  {
    selector: 'node[kind = "approval"]',
    style: { 'border-color': '#7a5930', 'background-color': '#f7efe3' },
  },
  {
    selector: 'node[kind = "implementation"]',
    style: { 'border-color': '#525f68', 'background-color': '#edf0f1' },
  },
  {
    selector: 'node[kind = "test"], node[kind = "verification"]',
    style: { 'border-color': '#2d7a55', 'background-color': '#eaf5ee' },
  },
  {
    selector: 'node[kind = "challenge"]',
    style: { 'border-color': '#c84936', 'background-color': '#faece8' },
  },
  {
    selector: 'node[kind = "revision"]',
    style: { 'border-color': '#087f73', 'background-color': '#e8f5f2' },
  },
  {
    selector: 'node[kind = "observation"]',
    style: { 'border-color': '#507239', 'background-color': '#eef5e9' },
  },
  {
    selector: 'node.future',
    style: { opacity: 0, events: 'no' },
  },
  {
    selector: 'node.in-path',
    style: { 'border-width': 3, 'border-color': '#087f73' },
  },
  {
    selector: 'node.current',
    style: {
      'border-width': 5,
      'border-color': '#17242b',
      'underlay-color': '#d7e9e5',
      'underlay-opacity': 0.72,
      'underlay-padding': 9,
    },
  },
  {
    selector: 'node.selected',
    style: {
      'overlay-color': '#17242b',
      'overlay-opacity': 0.06,
      'overlay-padding': 8,
    },
  },
  {
    selector: 'node.drift',
    style: {
      'border-color': '#c84936',
      'underlay-color': '#f2b7aa',
      'underlay-opacity': 0.5,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 2,
      'line-color': '#a7b0ae',
      'target-arrow-color': '#a7b0ae',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'arrow-scale': 0.8,
      opacity: 0.65,
      label: 'data(relation)',
      color: '#60706f',
      'font-family': 'IBM Plex Mono, monospace',
      'font-size': 8,
      'text-rotation': 'autorotate',
      'text-background-color': '#f4f2ec',
      'text-background-opacity': 0.92,
      'text-background-padding': '3px',
      'transition-property': 'opacity, line-color, target-arrow-color, width',
      'transition-duration': 300,
    },
  },
  {
    selector: 'edge.future',
    style: { opacity: 0, events: 'no' },
  },
  {
    selector: 'edge.in-path',
    style: {
      width: 3,
      'line-color': '#087f73',
      'target-arrow-color': '#087f73',
      opacity: 0.95,
    },
  },
  {
    selector: 'edge.current',
    style: {
      width: 4,
      'line-style': 'dashed',
      'line-dash-pattern': [8, 5],
      'line-color': '#087f73',
      'target-arrow-color': '#087f73',
      opacity: 1,
    },
  },
  {
    selector: 'edge.drift',
    style: {
      'line-color': '#c84936',
      'target-arrow-color': '#c84936',
    },
  },
];

export function ProtocolGraph({
  events,
  visibleThrough,
  focusEventId,
  selectedEventId,
  reducedMotion,
  onSelect,
}: ProtocolGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const eventIds = new Set(events.map((item) => item.id));
    const elements = events.flatMap((item) => [
      {
        group: 'nodes' as const,
        data: {
          id: item.id,
          label: item.title,
          kind: item.kind,
          sequence: item.sequence,
        },
        position: item.position,
      },
      ...item.parents
        .filter((parent) => eventIds.has(parent.id))
        .map((parent, parentIndex) => ({
          group: 'edges' as const,
          data: {
            id: `${parent.id}--${item.id}--${parentIndex}`,
            source: parent.id,
            target: item.id,
            relation: parent.relation,
            sequence: item.sequence,
          },
        })),
    ]);

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: graphStyles,
      layout: { name: 'preset', fit: true, padding: 48 },
      minZoom: 0.15,
      maxZoom: 1.25,
      selectionType: 'single',
      boxSelectionEnabled: false,
    });

    cy.on('tap', 'node', (tapEvent) => {
      onSelectRef.current(tapEvent.target.id());
    });

    const resizeObserver = new ResizeObserver(() => {
      cy.resize();
      cy.fit(cy.elements().not('.future'), 52);
    });
    resizeObserver.observe(containerRef.current);
    cyRef.current = cy;

    return () => {
      resizeObserver.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [events]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const byId = new Map(events.map((item) => [item.id, item]));
    const ancestorIds = new Set<string>();
    const pathEdgeIds = new Set<string>();

    function visit(eventId: string) {
      const item = byId.get(eventId);
      if (!item) return;
      for (const [parentIndex, parent] of item.parents.entries()) {
        if (!byId.has(parent.id) || ancestorIds.has(parent.id)) continue;
        ancestorIds.add(parent.id);
        pathEdgeIds.add(`${parent.id}--${item.id}--${parentIndex}`);
        visit(parent.id);
      }
    }
    visit(focusEventId);

    cy.batch(() => {
      cy.elements().removeClass('future in-path current selected drift');
      cy.nodes().forEach((node) => {
        const sequence = Number(node.data('sequence'));
        if (sequence > visibleThrough) node.addClass('future');
        if (ancestorIds.has(node.id())) node.addClass('in-path');
        if (node.id() === focusEventId) node.addClass('current');
        if (node.id() === selectedEventId) node.addClass('selected');
        if (
          visibleThrough >= 7 &&
          visibleThrough <= 8 &&
          ['transformation-requirements', 'semantic-verification', 'challenge-retention'].includes(
            node.id(),
          )
        ) {
          node.addClass('drift');
        }
      });
      cy.edges().forEach((edge) => {
        const sequence = Number(edge.data('sequence'));
        if (sequence > visibleThrough) edge.addClass('future');
        if (pathEdgeIds.has(edge.id())) edge.addClass('in-path');
        if (edge.target().id() === focusEventId) edge.addClass('current');
        if (
          visibleThrough >= 7 &&
          visibleThrough <= 8 &&
          ['transformation-requirements', 'semantic-verification', 'challenge-retention'].includes(
            edge.target().id(),
          )
        ) {
          edge.addClass('drift');
        }
      });
    });
  }, [events, focusEventId, selectedEventId, visibleThrough]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const visibleElements = cy.elements().not('.future');
    if (reducedMotion) {
      cy.fit(visibleElements, 52);
    } else {
      cy.animate({ fit: { eles: visibleElements, padding: 52 }, duration: 360 });
    }
  }, [events, focusEventId, reducedMotion, visibleThrough]);

  useEffect(() => {
    if (reducedMotion) return undefined;
    const timer = window.setInterval(() => {
      const edge = cyRef.current?.edges('.current');
      if (!edge?.length) return;
      const offset = Number(edge.style('line-dash-offset')) || 0;
      edge.style('line-dash-offset', offset - 2);
    }, 70);
    return () => window.clearInterval(timer);
  }, [reducedMotion, focusEventId]);

  return (
    <div className="graph-wrap">
      <div
        ref={containerRef}
        className="protocol-graph"
        role="img"
        aria-label="Animated ACT transformation lineage graph. Select a visible node to inspect its record."
      />
      <div className="graph-legend" aria-label="Graph legend">
        <span>
          <i className="legend-swatch intent" />
          Artifact
        </span>
        <span>
          <i className="legend-swatch transformation" />
          Transformation
        </span>
        <span>
          <i className="legend-swatch challenge" />
          Challenge
        </span>
      </div>
    </div>
  );
}
