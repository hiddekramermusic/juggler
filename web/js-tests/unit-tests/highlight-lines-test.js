//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   AGPL-3.0-or-later - see LICENSE

/**
 * Per-line highlighting: a construct spanning several lines (a block comment, a
 * template literal) must keep its tokens on every line, and splitting the markup
 * must not change the visible text or leave a line unbalanced.
 * @module unit-tests/highlight-lines-test
 */

import { assert } from '../utilities/test-helpers.js';

/**
 * @typedef {object} TestResult
 * @property {number} passed number of passing assertions
 * @property {number} failed number of failing assertions
 * @property {string[]} errors list of error messages from failing assertions
 */

/**
 * @param {object} _ctx - Test context (unused)
 * @returns {Promise<TestResult>} Aggregated results
 */
export async function runTests(_ctx) {
  let passed = 0;
  let failed = 0;
  /** @type {string[]} */
  const errors = [];

  const { highlightCodeLines, normalizeLanguageId, languageForPath } =
    await import('../../sdk/lib/syntax-highlight.js');
  const { createCodeBlock } = await import('../../sdk/lib/context-item-utils.js');

  /**
   * @param {string} label
   * @param {() => void} fn
   */
  const run = (label, fn) => {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
  };

  /**
   * @param {string} html - One line of highlighted markup.
   * @returns {HTMLElement} A `<code>` holding that line.
   */
  const asElement = (html) => {
    const code = document.createElement('code');
    code.innerHTML = html;
    return code;
  };

  /**
   * @param {string[]} lines - Highlighted lines.
   * @returns {string} The visible text of all lines, newline-joined.
   */
  const textOf = (lines) => lines.map((line) => asElement(line).textContent).join('\n');

  run('a block comment keeps its token class on every line', () => {
    const src = 'const a = 1;\n/* one\n   two\n   three */\nconst b = 2;';
    const lines = highlightCodeLines(src, 'javascript');
    assert(lines.length === 5, `expected 5 lines, got ${lines.length}`);
    for (const i of [1, 2, 3]) {
      assert(asElement(lines[i]).querySelector('.token.comment') !== null,
        `line ${i} lost its comment token`);
    }
    assert(textOf(lines) === src, 'splitting changed the visible text');
  });

  run('a multi-line template literal keeps its token class on every line', () => {
    const src = 'const t = `first\nsecond\nthird`;';
    const lines = highlightCodeLines(src, 'javascript');
    assert(lines.length === 3, `expected 3 lines, got ${lines.length}`);
    for (const i of [0, 1, 2]) {
      assert(asElement(lines[i]).querySelector('.token.template-string, .token.string') !== null,
        `line ${i} lost its template-string token`);
    }
    assert(textOf(lines) === src, 'splitting changed the visible text');
  });

  run('every line is balanced markup on its own', () => {
    const lines = highlightCodeLines('/* a\nb */', 'javascript');
    for (const line of lines) {
      const holder = document.createElement('code');
      holder.innerHTML = line;
      // A line that closed too few tags would swallow this sibling into itself.
      assert(!holder.innerHTML.includes('</span></span></span></span>'),
        'unexpected tag depth after re-balancing');
      assert(holder.innerHTML.replace(/<[^>]*>/g, '') === line.replace(/<[^>]*>/g, ''),
        'the browser had to repair the markup, so it was unbalanced');
    }
  });

  run('an unbundled language returns escaped lines', () => {
    const lines = highlightCodeLines('<b>a</b>\n<i>b</i>', 'nosuchlang');
    assert(lines.length === 2, `expected 2 lines, got ${lines.length}`);
    assert(lines[0] === '&lt;b&gt;a&lt;/b&gt;', `unescaped first line: ${lines[0]}`);
    assert(asElement(lines[0]).querySelector('b') === null, 'markup in the source became live');
  });

  run('bash lines go through the command highlighter', () => {
    const lines = highlightCodeLines('cd foo && make test\necho done', 'bash');
    assert(lines.length === 2, `expected 2 lines, got ${lines.length}`);
    assert(asElement(lines[0]).querySelector('.bash-command-head') !== null,
      'bash lines should keep the command-oriented highlighting');
    assert(textOf(lines) === 'cd foo && make test\necho done', 'splitting changed the visible text');
  });

  run('empty and single-line input behave', () => {
    assert(highlightCodeLines('', 'javascript').length === 1, 'empty input should be one empty line');
    assert(highlightCodeLines('', 'javascript')[0] === '', 'empty input should produce an empty line');
    assert(highlightCodeLines('const a = 1;', 'javascript').length === 1, 'one line in, one line out');
    assert(highlightCodeLines('a\n', 'javascript').length === 2, 'a trailing newline yields a final empty line');
  });

  run('language ids are normalised', () => {
    assert(normalizeLanguageId('YML') === 'yaml', 'yml should normalise to yaml');
    assert(normalizeLanguageId(' Golang ') === 'go', 'golang should normalise to go');
    assert(normalizeLanguageId('c++') === 'cpp', 'c++ should normalise to cpp');
    assert(normalizeLanguageId('sh') === 'bash', 'sh should normalise to bash');
    assert(normalizeLanguageId('') === 'text', 'an empty id should fall back to text');
    assert(normalizeLanguageId('javascript') === 'javascript', 'a canonical id should pass through');
  });

  run('paths resolve to languages by extension', () => {
    assert(languageForPath('/a/b/c.ts') === 'typescript', 'ts should resolve to typescript');
    assert(languageForPath('C:\\src\\main.go') === 'go', 'a windows path should resolve');
    assert(languageForPath('Makefile') === 'text', 'an unknown extension should fall back to text');
    assert(languageForPath('') === 'text', 'an empty path should fall back to text');
  });

  run('a line-numbered grid tokenises against the whole block', () => {
    const src = 'const a = 1;\n/* one\n   two\n   three */\nconst b = 2;';
    const block = createCodeBlock({ content: src, language: 'javascript', lineNumberStart: 1 });
    const lines = block.querySelectorAll('.ci-line');
    assert(lines.length === 5, `expected 5 grid lines, got ${lines.length}`);
    assert(block.querySelectorAll('.ci-line-num').length === 5, 'line numbers should match line count');
    for (const i of [1, 2, 3]) {
      assert(lines[i].querySelector('.token.comment') !== null,
        `grid line ${i} lost its comment token`);
    }
    assert([...lines].map((l) => l.textContent).join('\n') === src, 'grid changed the visible text');
  });

  return { passed, failed, errors };
}
