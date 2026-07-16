import { createServer, type Server } from 'node:http';

/**
 * A deterministic, offline emulator of an OpenAI-compatible
 * /chat/completions endpoint, so `assessWithOpenAiCompatible` is usable and
 * testable without a paid external service (PROMPT.md's Execution
 * Directive: "a configurable external integration is acceptable only when
 * the repository also includes a deterministic local implementation or
 * emulator").
 *
 * Deterministic judging rule: extracts DATA_A/DATA_B from the delimited
 * user message and classifies by exact match after whitespace
 * normalization -- byte-identical after trimming reports
 * exact-preservation; otherwise a fixed likely-divergent verdict. This is
 * intentionally simple: its purpose is to exercise the full HTTP/JSON
 * contract deterministically, not to emulate real model judgment quality.
 */
export function startMockOpenAiServer(port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as {
          model: string;
          messages: { role: string; content: string }[];
        };
        const userMessage = parsed.messages.find((m) => m.role === 'user')?.content ?? '';
        const dataA = extractBetween(userMessage, '<<<DATA_A>>>', '<<<END_DATA_A>>>').trim();
        const dataB = extractBetween(userMessage, '<<<DATA_B>>>', '<<<END_DATA_B>>>').trim();

        const identical = dataA === dataB;
        const content = JSON.stringify({
          classification: identical ? 'exact-preservation' : 'likely-divergent',
          confidence: identical ? 100 : 40,
          rationale: identical
            ? 'DATA_A and DATA_B are identical after whitespace trimming.'
            : 'DATA_A and DATA_B differ; this deterministic mock does not perform real semantic judgment.',
        });

        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            model: parsed.model,
            choices: [{ message: { role: 'assistant', content } }],
          }),
        );
      } catch (err) {
        res
          .writeHead(400, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: err instanceof Error ? err.message : 'bad request' }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({ server, url: `http://127.0.0.1:${actualPort}` });
    });
  });
}

function extractBetween(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) return '';
  return text.slice(start + startMarker.length, end);
}
