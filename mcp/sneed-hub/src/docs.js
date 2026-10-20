// Sneed Hub documentation as MCP resources, fetched at read time from the live site:
// /llms.txt, /api-docs/<slug>.md and the agent skills under /.well-known/agent-skills/.
// The site is a single-page app that answers unknown paths with index.html (status 200), so a
// missing file is detected by an HTML body, not only by the status code.
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HUB_URL } from './ic.js';

const TIMEOUT_MS = 15000;

/// Fetch a text file from Sneed Hub; { ok, text } or { ok: false, message }.
export const fetchDoc = async (path) => {
  const url = `${HUB_URL}${path}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    const type = res.headers.get('content-type') || '';
    const looksHtml = type.includes('text/html') || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
    if (!res.ok || looksHtml) {
      return { ok: false, url, message: `Not published (yet): ${url} (HTTP ${res.status}${looksHtml ? ', got the app page instead of the file' : ''}). Some Sneed Hub docs are being published now; try ${HUB_URL}/llms.txt for the current list, or ${HUB_URL}/api for the human-readable pages.` };
    }
    return { ok: true, url, text };
  } catch (e) {
    return { ok: false, url, message: `Could not fetch ${url}: ${e.message}` };
  }
};

const asResource = (uri, r, mimeType) => ({
  contents: [{ uri: uri.href ?? String(uri), mimeType: r.ok ? mimeType : 'text/plain', text: r.ok ? r.text : r.message }],
});

/// api-doc slugs listed in llms.txt (links to /api-docs/<slug>.md); a fallback when it cannot be read.
const apiDocSlugs = async () => {
  const r = await fetchDoc('/llms.txt');
  const slugs = r.ok ? [...r.text.matchAll(/\/api-docs\/([A-Za-z0-9_.-]+)\.md\)/g)].map((m) => m[1]) : [];
  return [...new Set(slugs.length ? slugs : ['sneed_lock'])];
};

const skillNames = async () => {
  const r = await fetchDoc('/.well-known/agent-skills/index.json');
  if (!r.ok) return [];
  try {
    return (JSON.parse(r.text).skills ?? []).map((s) => ({ name: s.name, description: s.description, url: s.url }));
  } catch { return []; }
};

export function registerDocResources(server) {
  server.registerResource('llms-txt', 'sneed-hub://docs/llms.txt', {
    title: 'Sneed Hub llms.txt',
    description: 'Index of machine-readable Sneed DAO documentation (canister APIs, agent skills).',
    mimeType: 'text/markdown',
  }, async (uri) => asResource(uri, await fetchDoc('/llms.txt'), 'text/markdown'));

  server.registerResource('agent-skills-index', 'sneed-hub://skills/index.json', {
    title: 'Sneed agent skills index',
    description: 'Discovery index of Sneed agent skills (/.well-known/agent-skills/index.json).',
    mimeType: 'application/json',
  }, async (uri) => asResource(uri, await fetchDoc('/.well-known/agent-skills/index.json'), 'application/json'));

  server.registerResource('api-doc', new ResourceTemplate('sneed-hub://api-docs/{slug}', {
    list: async () => ({
      resources: (await apiDocSlugs()).map((slug) => ({ uri: `sneed-hub://api-docs/${slug}`, name: `API doc: ${slug}`, mimeType: 'text/markdown' })),
    }),
  }), {
    title: 'Sneed canister API doc',
    description: 'Markdown API reference of a Sneed canister (fetched from /api-docs/<slug>.md), e.g. sneed_lock.',
    mimeType: 'text/markdown',
  }, async (uri, { slug }) => asResource(uri, await fetchDoc(`/api-docs/${encodeURIComponent(String(slug))}.md`), 'text/markdown'));

  server.registerResource('agent-skill', new ResourceTemplate('sneed-hub://skills/{name}', {
    list: async () => ({
      resources: (await skillNames()).map((s) => ({ uri: `sneed-hub://skills/${s.name}`, name: `Skill: ${s.name}`, description: s.description, mimeType: 'text/markdown' })),
    }),
  }), {
    title: 'Sneed agent skill',
    description: 'SKILL.md of a Sneed agent skill (from /.well-known/agent-skills/<name>/SKILL.md), e.g. sneed-lock.',
    mimeType: 'text/markdown',
  }, async (uri, { name }) => asResource(uri, await fetchDoc(`/.well-known/agent-skills/${encodeURIComponent(String(name))}/SKILL.md`), 'text/markdown'));
}
