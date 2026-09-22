'use strict';

/**
 * A deliberately small template language for message bodies.
 *
 *   {{event.name}}                    merge field
 *   {{#if event.meeting_link}}…{{/if}}       conditional section
 *   {{#unless event.venue}}…{{/unless}}      inverted section
 *   {{#if x}}…{{else}}…{{/if}}               with an alternative
 *
 * Bodies are authored as plain text. The email layer turns the rendered text
 * into HTML, so there is no markup to escape here and staff never have to write
 * any. A missing merge field renders as an empty string rather than raising,
 * because a half rendered reminder is still better than no reminder at all, and
 * the unknown field is reported by validateTemplate() when the template is
 * saved.
 */

const TOKEN_RE = /\{\{\s*(#if|#unless|\/if|\/unless|else)?\s*([a-zA-Z0-9_.]*)\s*\}\}/g;

function tokenise(source) {
  const tokens = [];
  let lastIndex = 0;
  let match;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(source)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: source.slice(lastIndex, match.index) });
    }
    const [raw, keyword, path] = match;
    if (keyword === '#if' || keyword === '#unless') {
      tokens.push({ type: 'open', inverted: keyword === '#unless', path, raw });
    } else if (keyword === '/if' || keyword === '/unless') {
      tokens.push({ type: 'close', raw });
    } else if (keyword === 'else') {
      tokens.push({ type: 'else', raw });
    } else if (path) {
      tokens.push({ type: 'var', path, raw });
    } else {
      tokens.push({ type: 'text', value: raw });
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < source.length) {
    tokens.push({ type: 'text', value: source.slice(lastIndex) });
  }
  return tokens;
}

function parse(source) {
  const tokens = tokenise(source);
  const root = { type: 'root', children: [] };
  const stack = [{ node: root, bucket: root.children }];

  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token.type === 'open') {
      const node = {
        type: 'section',
        path: token.path,
        inverted: token.inverted,
        children: [],
        alternate: null,
      };
      top.bucket.push(node);
      stack.push({ node, bucket: node.children });
    } else if (token.type === 'else') {
      if (stack.length === 1 || top.node.type !== 'section') {
        top.bucket.push({ type: 'text', value: token.raw });
        continue;
      }
      top.node.alternate = [];
      top.bucket = top.node.alternate;
    } else if (token.type === 'close') {
      if (stack.length === 1) {
        top.bucket.push({ type: 'text', value: token.raw });
        continue;
      }
      stack.pop();
    } else {
      top.bucket.push(token);
    }
  }
  return root;
}

function lookup(context, path) {
  if (!path) return undefined;
  let value = context;
  for (const key of path.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}

function isTruthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  return Boolean(value);
}

function stringify(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value === true) return 'Yes';
  return String(value);
}

function renderNodes(nodes, context, used) {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += node.value;
    } else if (node.type === 'var') {
      if (used) used.add(node.path);
      out += stringify(lookup(context, node.path));
    } else if (node.type === 'section') {
      if (used) used.add(node.path);
      const truthy = isTruthy(lookup(context, node.path));
      const take = node.inverted ? !truthy : truthy;
      if (take) out += renderNodes(node.children, context, used);
      else if (node.alternate) out += renderNodes(node.alternate, context, used);
    }
  }
  return out;
}

/** Render `source` against `context`. Never throws on a missing field. */
function render(source, context) {
  if (!source) return '';
  return renderNodes(parse(String(source)).children, context, null);
}

function collectFields(nodes, used) {
  for (const node of nodes) {
    if (node.type === 'var') {
      used.add(node.path);
    } else if (node.type === 'section') {
      used.add(node.path);
      collectFields(node.children, used);
      if (node.alternate) collectFields(node.alternate, used);
    }
  }
  return used;
}

/**
 * Every merge field a template refers to, including fields that only appear
 * inside a branch that a particular context would not take.
 */
function fieldsUsed(source) {
  return [...collectFields(parse(String(source || '')).children, new Set())];
}

/**
 * Structural check used when staff save a template: unbalanced sections and
 * merge fields that the system cannot supply are reported rather than silently
 * producing blank text in a message that has already gone out.
 */
function validateTemplate(source, knownFields) {
  const problems = [];
  const tokens = tokenise(String(source || ''));
  let depth = 0;
  for (const token of tokens) {
    if (token.type === 'open') depth += 1;
    if (token.type === 'close') {
      depth -= 1;
      if (depth < 0) {
        problems.push('There is a closing tag without a matching {{#if}} or {{#unless}}.');
        depth = 0;
      }
    }
  }
  if (depth > 0) {
    problems.push(`${depth} section${depth === 1 ? ' is' : 's are'} opened but never closed.`);
  }
  if (Array.isArray(knownFields) && knownFields.length) {
    const known = new Set(knownFields);
    for (const field of fieldsUsed(source)) {
      if (!known.has(field)) problems.push(`Unknown merge field: {{${field}}}`);
    }
  }
  return { valid: problems.length === 0, problems };
}

/** Collapse the blank lines that conditional sections leave behind. */
function tidy(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { render, fieldsUsed, validateTemplate, tidy, parse };
