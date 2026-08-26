//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   AGPL-3.0-or-later - see LICENSE

/**
 * Drift guard between the language tables and the vendored Prism grammars.
 *
 * A language the app can resolve but has no grammar for degrades silently to
 * escaped plain text — the code still renders, just uncoloured, so nothing else
 * in the suite would notice. This test fails instead: adding a mapping without
 * vendoring its grammar (in BOTH `web/index.html` and `headless-test.html`) is
 * caught here.
 * @module unit-tests/language-coverage-test
 */

import { assert } from '../utilities/test-helpers.js';

/**
 * @typedef {object} TestResult
 * @property {number} passed number of passing assertions
 * @property {number} failed number of failing assertions
 * @property {string[]} errors list of error messages from failing assertions
 */

/**
 * Languages that deliberately have no Prism grammar.
 * `text` is the plain-text fallback; `bash` is handled by the command-oriented
 * highlighter in syntax-highlight.js, not by Prism.
 */
const NO_GRAMMAR_NEEDED = new Set(['text', 'bash']);

/**
 * @param {object} _ctx - Test context (unused)
 * @returns {Promise<TestResult>} Aggregated results
 */
export async function runTests(_ctx) {
  let passed = 0;
  let failed = 0;
  /** @type {string[]} */
  const errors = [];

  const { LANGUAGE_BY_EXT, normalizeLanguageId, highlightCode } =
    await import('../../sdk/lib/syntax-highlight.js');

  /**
   * @param {string} label
   * @param {() => void} fn
   */
  const run = (label, fn) => {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
  };

  /** @type {any} */
  const Prism = (/** @type {any} */ (window)).Prism;

  run('Prism is loaded', () => {
    assert(Prism && Prism.languages, 'window.Prism.languages is missing — check the vendor script tags');
  });

  run('every extension mapping resolves to a loaded grammar', () => {
    /** @type {string[]} */
    const missing = [];
    for (const [ext, language] of Object.entries(LANGUAGE_BY_EXT)) {
      const id = normalizeLanguageId(language);
      if (NO_GRAMMAR_NEEDED.has(id)) continue;
      if (!Prism?.languages?.[id]) missing.push(`.${ext} → ${language} (resolved: ${id})`);
    }
    assert(missing.length === 0, `no grammar loaded for: ${missing.join(', ')}`);
  });

  run('the languages we advertise actually colour their code', () => {
    /** @type {Record<string, string>} */
    const samples = {
      javascript: 'const a = 1;',
      typescript: 'let a: number = 1;',
      python: 'def f(): return 1',
      go: 'func main() {}',
      rust: 'fn main() { let x = 1; }',
      java: 'class A { int x; }',
      c: 'int main(void) { return 0; }',
      cpp: '#include <vector>\nint main() { return 0; }',
      csharp: 'class A { int X; }',
      ruby: 'def f; 1; end',
      kotlin: 'fun main() { val x = 1 }',
      swift: 'let x = 1',
      php: '<?php $x = 1; ?>',
      yaml: 'key: value',
      toml: 'key = "value"',
      sql: 'SELECT 1 FROM t;',
      scss: '$c: red; a { color: $c; }',
      css: 'a { color: red; }',
      json: '{"a": 1}',
      markdown: '# title',
      html: '<b>x</b>',
      diff: '+ added',
    };
    /** @type {string[]} */
    const uncoloured = [];
    for (const [language, sample] of Object.entries(samples)) {
      const holder = document.createElement('code');
      holder.innerHTML = highlightCode(sample, language);
      if (holder.querySelector('.token') === null) uncoloured.push(language);
      assert(holder.textContent === sample, `${language}: highlighting changed the visible text`);
    }
    assert(uncoloured.length === 0, `produced no tokens for: ${uncoloured.join(', ')}`);
  });

  run('an unknown language degrades to escaped text', () => {
    const holder = document.createElement('code');
    holder.innerHTML = highlightCode('<b>x</b> && y', 'nosuchlang');
    assert(holder.querySelector('b') === null, 'source markup became live');
    assert(holder.textContent === '<b>x</b> && y', 'escaped text should read back unchanged');
  });

  return { passed, failed, errors };
}
