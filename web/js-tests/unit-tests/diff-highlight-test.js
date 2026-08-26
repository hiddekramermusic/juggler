//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   AGPL-3.0-or-later - see LICENSE

/**
 * Syntax highlighting in `<diff-viewer>`.
 *
 * The diff carries two independent layers over the same text — syntax tokens
 * and character-level change marks — so these tests pin that adding the first
 * did not cost the second, and that neither changes what the line says.
 * @module unit-tests/diff-highlight-test
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

  await import('../../js/components/diff-viewer.js');

  /**
   * @param {string} label
   * @param {() => void} fn
   */
  const run = (label, fn) => {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
  };

  /**
   * @param {string} oldText
   * @param {string} newText
   * @param {string} path
   * @param {number} [startLineNumber]
   * @returns {HTMLElement} A rendered, detached diff viewer.
   */
  const render = (oldText, newText, path, startLineNumber = 1) => {
    const el = /** @type {any} */ (document.createElement('diff-viewer'));
    el.setDiff(oldText, newText, path, startLineNumber);
    return el;
  };

  /**
   * @param {HTMLElement} el - A rendered diff viewer.
   * @returns {string[]} The visible text of each rendered line.
   */
  const lineTexts = (el) =>
    [...el.querySelectorAll('.line-content')].map((n) => n.textContent || '');

  const OLD_TS = 'const a: number = 1;\nfunction f() {\n  return a;\n}\n';
  const NEW_TS = 'const a: number = 2;\nfunction f() {\n  return a;\n}\n';

  run('a typescript diff is tokenised', () => {
    const el = render(OLD_TS, NEW_TS, '/src/main.ts');
    assert(el.querySelector('.line-content .token') !== null, 'expected syntax tokens in the diff');
    assert(lineTexts(el).includes('const a: number = 1;'), 'the removed line text should survive');
    assert(lineTexts(el).includes('const a: number = 2;'), 'the added line text should survive');
  });

  run('prefixes, line numbers and counts are unaffected', () => {
    const el = render(OLD_TS, NEW_TS, '/src/main.ts');
    const prefixes = [...el.querySelectorAll('.line-prefix')].map((n) => n.textContent);
    assert(prefixes.includes('-') && prefixes.includes('+'), 'expected both change prefixes');
    assert(el.querySelector('.add-count')?.textContent === '+1', 'wrong added count');
    assert(el.querySelector('.remove-count')?.textContent === '-1', 'wrong removed count');
    const nums = [...el.querySelectorAll('.line-num')].map((n) => n.textContent);
    assert(nums[0] === '1', `expected the first line number to be 1, got ${nums[0]}`);
  });

  run('an unknown file type stays plain text', () => {
    const el = render('hello world\n', 'hello there\n', '/notes.txt');
    assert(el.querySelector('.line-content .token') === null, 'a .txt diff should not be tokenised');
    assert(lineTexts(el).includes('hello world'), 'text should be preserved');
  });

  run('source markup in a diff stays inert', () => {
    const el = render('<script>alert(1)</script>\n', '<script>alert(2)</script>\n', '/notes.txt');
    assert(el.querySelector('script') === null, 'a script element must never be created');
    assert(lineTexts(el).some((t) => t.includes('<script>alert(1)</script>')),
      'the markup should read back as text');
  });

  run('character changes and tokens coexist', () => {
    const el = /** @type {any} */ (document.createElement('diff-viewer'));
    el.setDiff(OLD_TS, NEW_TS, '/src/main.ts', 1);
    // charChanges are computed elsewhere; drive the renderer directly so the
    // test pins the layering rather than the diff algorithm.
    const html = el.renderLineWithCharChanges({
      type: 'remove',
      content: 'const a: number = 1;',
      oldLineNum: 1,
      newLineNum: null,
      charChanges: [{ start: 18, length: 1, type: 'remove' }],
    });
    const holder = document.createElement('div');
    holder.innerHTML = html;
    assert(holder.querySelector('mark.char-remove') !== null, 'the character mark was lost');
    assert(holder.querySelector('mark.char-remove')?.textContent === '1', 'the wrong range was marked');
    assert(holder.querySelector('.token') !== null, 'the syntax tokens were lost');
    assert(holder.textContent === 'const a: number = 1;', 'the line text changed');
  });

  run('a character change spanning a token boundary keeps the whole range marked', () => {
    const el = /** @type {any} */ (document.createElement('diff-viewer'));
    el.setDiff(OLD_TS, NEW_TS, '/src/main.ts', 1);
    const html = el.renderLineWithCharChanges({
      type: 'remove',
      content: 'const a: number = 1;',
      oldLineNum: 1,
      newLineNum: null,
      // Spans "a: number" — several tokens.
      charChanges: [{ start: 6, length: 9, type: 'remove' }],
    });
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const marked = [...holder.querySelectorAll('mark.char-remove')].map((n) => n.textContent).join('');
    assert(marked === 'a: number', `the marked range should be complete, got "${marked}"`);
    assert(holder.textContent === 'const a: number = 1;', 'the line text changed');
  });

  run('a diff that starts partway through a file indexes the right lines', () => {
    const oldText = 'const a = 1;\nconst b = 2;\n';
    const newText = 'const a = 1;\nconst b = 3;\n';
    const el = render(oldText, newText, '/src/main.js', 10);
    const nums = [...el.querySelectorAll('.line-num')].map((n) => n.textContent);
    assert(nums[0] === '10', `expected numbering to start at 10, got ${nums[0]}`);
    assert(lineTexts(el).includes('const b = 2;'), 'the removed line text should survive');
    assert(lineTexts(el).includes('const b = 3;'), 'the added line text should survive');
  });

  return { passed, failed, errors };
}
