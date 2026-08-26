//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   AGPL-3.0-or-later - see LICENSE

import { computeDiff } from '../lib/diff-utils.js';
import { escapeHtml } from '../../sdk/lib/html.js';
import { highlightCodeLines, languageForPath } from '../../sdk/lib/syntax-highlight.js';
import { registerContextMenuProvider } from '../services/context-menu-service.js';
import { copyToClipboard } from '../../sdk/lib/clipboard.js';

/** @typedef {import('../lib/diff-types.js').DiffHunk} DiffHunk */
/** @typedef {import('../lib/diff-types.js').DiffLine} DiffLine */

/**
 * Largest side of a diff we syntax-highlight. Both sides are tokenised whole so
 * that a hunk sees the context around it, which is linear but not free; past
 * this a diff stays plain rather than stalling the properties panel.
 */
const MAX_HIGHLIGHT_CHARS = 200_000;

/**
 * DiffViewer - Display file diffs in inline view
 * @class
 * @augments HTMLElement
 */
class DiffViewer extends HTMLElement {
  constructor() {
    super();
    /** @type {string} @private */
    this.oldContent = '';
    /** @type {string} @private */
    this.newContent = '';
    /** @type {string} @private */
    this.filePath = '';
    /** @type {number} @private */
    this.startLineNumber = 1;
    /** @type {{old: string[], new: string[]}|null} @private */
    this.highlighted = null;
  }

  connectedCallback() {
    // wait for setDiff to be called
  }

  /**
   * Set diff data and render
   * @param {string} oldContent
   * @param {string} newContent
   * @param {string} filePath
   * @param {number} [startLineNumber=1]
   */
  setDiff(oldContent, newContent, filePath, startLineNumber = 1) {
    this.oldContent = oldContent || '';
    this.newContent = newContent || '';
    this.filePath = filePath || '';
    this.startLineNumber = startLineNumber;
    this.render();
  }

  /**
   * Tokenise both sides of the diff, once, into per-line markup.
   *
   * Highlighting whole files rather than the visible hunks is deliberate: a hunk
   * is a window into the middle of a file, and a line taken on its own tokenises
   * wrong (an unclosed brace, the inside of a block comment). The line arrays
   * are indexed by `lineNum - startLineNumber`, the same numbering computeDiff
   * derives from splitting the same strings.
   * @returns {{old: string[], new: string[]}|null} Per-line markup, or null when
   *   the diff is left plain (unknown language, or too large to be worth it).
   * @private
   */
  highlightSides() {
    const language = languageForPath(this.filePath);
    if (language === 'text') return null;
    if (this.oldContent.length > MAX_HIGHLIGHT_CHARS || this.newContent.length > MAX_HIGHLIGHT_CHARS) return null;
    return {
      old: highlightCodeLines(this.oldContent, language),
      new: highlightCodeLines(this.newContent, language),
    };
  }

  /** @private */
  render() {
    // compute hunks via shared util; cast to any to satisfy checkJs where needed
    const hunks = /** @type {any} */ (computeDiff(this.oldContent, this.newContent, this.startLineNumber));
    this.highlighted = this.highlightSides();

    this.innerHTML = `
      <diff-content>
        <diff-header>
          ${escapeHtml(this.filePath || 'File diff')}
        </diff-header>
        <diff-inline-view>
          ${this.renderInlineView(hunks)}
        </diff-inline-view>
        <diff-stats>
          <span class="add-count">+${this.countAdded(hunks)}</span>
          <span class="remove-count">-${this.countRemoved(hunks)}</span>
        </diff-stats>
      </diff-content>
    `;
  }

  /**
   * Render inline view (unified diff)
   * @param {DiffHunk[]} hunks
   * @returns {string} HTML string representing the inline diff view.
   * @private
   */
  renderInlineView(hunks) {
    if (!hunks || hunks.length === 0) return '<diff-no-changes>No changes</diff-no-changes>';

    let html = '';
    for (const hunk of hunks) {
      html += '<diff-hunk>';
      html += `<diff-hunk-header>@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@</diff-hunk-header>`;

      for (const line of hunk.lines) {
        const lineClass = line.type === 'equal' ? 'equal' : (line.type === 'remove' ? 'remove' : 'add');
        const lineNum = line.type === 'remove' ? line.oldLineNum : (line.type === 'add' ? line.newLineNum : line.oldLineNum);
        const prefix = line.type === 'remove' ? '-' : (line.type === 'add' ? '+' : ' ');

        html += `<div class="diff-line ${lineClass}">`;
        html += `<span class="line-num">${lineNum || ''}</span>`;
        html += `<span class="line-prefix">${prefix}</span>`;
        html += `<span class="line-content">${this.renderLineWithCharChanges(line)}</span>`;
        html += `</div>`;
      }

      html += '</diff-hunk>';
    }
    return html;
  }

  /**
   * The syntax-highlighted markup for a line, or its escaped text when the diff
   * is not being highlighted (or the index falls outside what we tokenised).
   * @param {DiffLine} line
   * @returns {string} Safe HTML for the line's content.
   * @private
   */
  lineMarkup(line) {
    const sides = this.highlighted;
    if (sides) {
      const num = line.type === 'add' ? line.newLineNum : line.oldLineNum;
      const source = line.type === 'add' ? sides.new : sides.old;
      const html = num === null || num === undefined ? undefined : source[num - this.startLineNumber];
      if (html !== undefined) return html;
    }
    return escapeHtml(line.content);
  }

  /**
   * Render a line, applying character highlights if present.
   *
   * The character ranges and the syntax tokens are two independent layers over
   * the same text, so the marks are applied to the *rendered* line rather than
   * spliced into the source: the line is parsed, its text nodes are walked to
   * find the range, and only that run is wrapped. A range that straddles a token
   * boundary therefore yields one `<mark>` per token rather than breaking either
   * layer.
   * @param {DiffLine} line
   * @returns {string} HTML string of the line with character changes highlighted.
   * @private
   */
  renderLineWithCharChanges(line) {
    const html = this.lineMarkup(line);
    if (!line.charChanges || line.charChanges.length === 0) return html;

    const template = document.createElement('template');
    template.innerHTML = html;

    /** @type {Text[]} */
    const texts = [];
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) texts.push(/** @type {Text} */ (walker.currentNode));

    /**
     * Text nodes with their character offsets in the line.
     * @type {{node: Text, start: number, end: number}[]}
     */
    const spans = [];
    let offset = 0;
    for (const node of texts) {
      spans.push({ node, start: offset, end: offset + node.data.length });
      offset += node.data.length;
    }

    // Later ranges first: splitting a text node keeps the head node (and so its
    // recorded start offset) intact, so earlier ranges stay addressable.
    const changes = [...line.charChanges].sort((a, b) => b.start - a.start);
    for (const change of changes) {
      const from = change.start;
      const to = change.start + change.length;
      for (let i = spans.length - 1; i >= 0; i--) {
        const span = /** @type {{node: Text, start: number, end: number}} */ (spans[i]);
        const localFrom = Math.max(from, span.start) - span.start;
        const localTo = Math.min(to, span.end) - span.start;
        if (localTo <= localFrom) continue;

        let target = span.node;
        // Clamp against a node an earlier (later-positioned) split shortened.
        const end = Math.min(localTo, target.data.length);
        const begin = Math.min(localFrom, end);
        if (end < target.data.length) target.splitText(end);
        if (begin > 0) target = target.splitText(begin);

        const mark = document.createElement('mark');
        mark.className = `char-${change.type}`;
        target.parentNode?.insertBefore(mark, target);
        mark.appendChild(target);
      }
    }

    return template.innerHTML;
  }

  /**
   * Count added lines
   * @param {DiffHunk[]} hunks
   * @returns {number} The total count of added lines.
   * @private
   */
  countAdded(hunks) {
    let count = 0;
    for (const hunk of hunks || []) for (const line of hunk.lines) if (line.type === 'add') count++;
    return count;
  }

  /**
   * Count removed lines
   * @param {DiffHunk[]} hunks
   * @returns {number} The total count of removed lines.
   * @private
   */
  countRemoved(hunks) {
    let count = 0;
    for (const hunk of hunks || []) for (const line of hunk.lines) if (line.type === 'remove') count++;
    return count;
  }

}

customElements.define('diff-viewer', DiffViewer);

// Right-click menu for diffs: copy the changed file's path and its new content.
// Reads the DiffViewer instance's own fields (set via setDiff).
registerContextMenuProvider({
  match: (start) => start?.closest('diff-viewer') || null,
  build: (subject) => {
    const diffViewer = /** @type {any} */ (subject);
    const filePath = diffViewer.filePath || '';
    const newContent = diffViewer.newContent || '';
    /** @type {import('../services/context-menu-service.js').ContextMenuItem[]} */
    const items = [{
      label: 'Copy file path',
      disabled: !filePath,
      onClick: () => { void copyToClipboard(filePath).catch(() => {}); },
    }, {
      label: 'Copy new content',
      disabled: !newContent,
      onClick: () => { void copyToClipboard(newContent).catch(() => {}); },
    }];
    return items;
  },
});

export default DiffViewer;
