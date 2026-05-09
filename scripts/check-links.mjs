#!/usr/bin/env node
// Scans markdown article(s) for external HTTP/HTTPS links and verifies each
// is reachable. Run by .github/workflows/check-links.yml on every push that
// adds/modifies files in src/content/articles/.
//
// Usage:  node scripts/check-links.mjs <markdown-path-1> [path-2] ...
//
// Method: HEAD first, GET fallback for servers that reject HEAD.
// Timeout: 10s per URL. Concurrency: 5.
// Reports broken links (4xx, 5xx, timeout, network error) to stdout.
// Exits 1 if any broken links found, 0 otherwise.
//
// Skips: relative URLs, anchors (#x), mailto:, tel:, data:, javascript:.

import { readFile } from 'node:fs/promises';

const TIMEOUT_MS = 10000;
const CONCURRENCY = 5;
const UA = 'photoandmoto-link-checker/1.0';

function extractLinks(markdown) {
  const urls = new Set();

  // [text](url) and ![alt](url)
  const linkRe = /!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
  for (const m of markdown.matchAll(linkRe)) urls.add(m[1]);

  // <url> autolinks
  const autoRe = /<(https?:\/\/[^>]+)>/g;
  for (const m of markdown.matchAll(autoRe)) urls.add(m[1]);

  // Bare http(s) URLs (not inside a link or autolink)
  const bareRe = /(?<![(\[<])\bhttps?:\/\/[^\s<>"')]+/g;
  for (const m of markdown.matchAll(bareRe)) urls.add(m[0]);

  return [...urls].filter(isCheckable);
}

function isCheckable(url) {
  if (!url || typeof url !== 'string') return false;
  return /^https?:\/\//.test(url);
}

async function fetchOnce(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA },
    });
    clearTimeout(timer);
    return { status: res.status };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') return { status: 0, error: 'timeout' };
    return { status: 0, error: e.message };
  }
}

async function checkUrl(url) {
  // Try HEAD first (cheap), fall back to GET if server rejects HEAD or errors.
  const head = await fetchOnce(url, 'HEAD');
  if (head.status >= 200 && head.status < 400) {
    return { ok: true, status: head.status, method: 'HEAD' };
  }
  // Some servers return 403/405 on HEAD but allow GET — retry.
  const get = await fetchOnce(url, 'GET');
  if (get.status >= 200 && get.status < 400) {
    return { ok: true, status: get.status, method: 'GET' };
  }
  const reason = get.error
    ? get.error
    : `HTTP ${get.status}`;
  return { ok: false, status: get.status, reason };
}

async function checkBatch(urls) {
  const results = new Map();
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const url = urls[idx];
      const r = await checkUrl(url);
      results.set(url, r);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return results;
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node scripts/check-links.mjs <markdown-path>...');
    process.exit(1);
  }

  const fileUrls = new Map();
  const allUrls = new Set();
  for (const f of files) {
    try {
      const md = await readFile(f, 'utf8');
      const urls = extractLinks(md);
      fileUrls.set(f, urls);
      for (const u of urls) allUrls.add(u);
    } catch (e) {
      console.error(`SKIP (unreadable): ${f} — ${e.message}`);
    }
  }

  if (allUrls.size === 0) {
    console.log('No external links to check.');
    return;
  }

  console.log(`Checking ${allUrls.size} unique URL(s) across ${files.length} file(s)...\n`);
  const results = await checkBatch([...allUrls]);

  let totalBroken = 0;
  for (const [f, urls] of fileUrls) {
    if (urls.length === 0) continue;
    const broken = urls.filter((u) => !results.get(u).ok);
    if (broken.length === 0) {
      console.log(`OK  ${f}  (${urls.length} link${urls.length === 1 ? '' : 's'})`);
    } else {
      totalBroken += broken.length;
      console.log(`FAIL ${f}  (${broken.length} broken / ${urls.length} total)`);
      for (const u of broken) {
        console.log(`     ${u}  ->  ${results.get(u).reason}`);
      }
    }
  }

  if (totalBroken > 0) {
    console.log(`\n${totalBroken} broken link(s) total.`);
    process.exit(1);
  }
  console.log('\nAll links OK.');
}

main().catch((e) => {
  console.error('check-links failed:', e.message);
  process.exit(1);
});
