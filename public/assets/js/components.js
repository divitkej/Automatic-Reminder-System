// Shared pieces of interface: tables, tiles, notices, forms, modals, toasts.

import { h, mount, frag, formValues } from './dom.js';
import { icon } from './icons.js';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * dataTable(columns, rows, options)
 *
 * A column is { key, label, num, render(row) }. An empty result is a first
 * class state rather than a blank box, because "no student has declined yet"
 * and "the filter matched nothing" need different words.
 */
export function dataTable(columns, rows, { empty, onRowClick } = {}) {
  if (!rows || rows.length === 0) {
    return emptyState(empty || { title: 'Nothing to show', text: 'There are no records here yet.' });
  }
  const body = h('tbody');
  for (const row of rows) {
    const tr = h('tr', onRowClick ? {
      onclick: (event) => {
        if (event.target.closest('a, button, input, label, select')) return;
        onRowClick(row);
      },
      style: { cursor: 'pointer' },
    } : null);
    for (const column of columns) {
      const content = column.render ? column.render(row) : row[column.key];
      // A column with a blank heading holds row actions, which stay on one line.
      const isActions = column.label === '' || column.className === 'actions';
      tr.append(h(`td${column.num ? '.num' : ''}${isActions ? '.actions' : ''}`,
        content === null || content === undefined || content === '' ? h('span.muted', '-') : content));
    }
    body.append(tr);
  }
  return h('.table-wrap',
    h('table.data',
      h('thead', h('tr', columns.map((c) => h(`th${c.num ? '.num' : ''}`, c.label)))),
      body));
}

export function emptyState({ title, text, action }) {
  return h('.empty', h('strong', title), text ? h('p.small.muted', text) : null, action || null);
}

// ---------------------------------------------------------------------------
// Panels, tiles, notices
// ---------------------------------------------------------------------------
export function panel({ title, hint, actions, body, foot, flush }) {
  return h('.panel',
    title || actions
      ? h('.panel-head',
        h('div', h('h2', title), hint ? h('p.panel-hint', hint) : null),
        actions ? h('.row-tight', actions) : null)
      : null,
    flush ? body : h('.panel-body', body),
    foot ? h('.panel-foot', foot) : null);
}

export function tile({ label, value, note, href }) {
  const isZero = value === 0 || value === '0';
  const inner = frag(
    h('.tile-label', label),
    h(`.tile-value${isZero ? '.is-zero' : ''}`, String(value)),
    note ? h('.tile-note', note) : null,
  );
  if (href) {
    return h('a.tile', { href, style: { textDecoration: 'none', color: 'inherit', display: 'block' } }, inner);
  }
  return h('.tile', inner);
}

export function tiles(items) {
  return h('.tiles', items.filter(Boolean).map(tile));
}

export function notice(level, content, { action } = {}) {
  return h(`.notice.notice-${level}`,
    typeof content === 'string' ? h('p', content) : content,
    action || null);
}

export function badge(text, kind = 'neutral') {
  return h(`span.badge.badge-${kind}`, text);
}

export function statusBadge(status) {
  return badge(status.charAt(0).toUpperCase() + status.slice(1), status);
}

export function bar(value, total, { good = false } = {}) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return h(`.bar${good ? '.bar-good' : ''}`, h('span', { style: { width: `${pct}%` } }));
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function field({ label, name, type = 'text', value = '', hint, required, options, span, rows, placeholder, disabled, min, max, step, attrs }) {
  let control;
  if (type === 'select') {
    control = h('select', { name, required, disabled, ...(attrs || {}) },
      (options || []).map((option) => h('option', {
        value: option.value,
        selected: String(option.value) === String(value ?? ''),
      }, option.label)));
  } else if (type === 'textarea') {
    control = h('textarea', { name, required, disabled, rows: rows || 4, placeholder, ...(attrs || {}) }, value ?? '');
  } else if (type === 'checkbox') {
    return h(`label.checkbox${span ? '.span-2' : ''}`,
      h('input', { type: 'checkbox', name, checked: Boolean(value), disabled }),
      h('span', h('span', label), hint ? h('span.hint', hint) : null));
  } else {
    control = h('input', { type, name, value: value ?? '', required, disabled, placeholder, min, max, step, ...(attrs || {}) });
  }
  return h(`label.field${span ? '.span-2' : ''}`,
    h('span.label', label, required ? h('span.required-mark', ' *') : null),
    control,
    hint ? h('span.hint', hint) : null);
}

export function fieldset(legend, ...children) {
  return h('fieldset', h('legend', legend), ...children);
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
let openModal = null;

export function modal({ title, body, actions, wide, onClose }) {
  closeModal();
  const close = () => {
    if (onClose) onClose();
    closeModal();
  };
  const dialog = h(`.modal${wide ? '.modal-wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('.modal-head',
      h('h2', title),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
    h('.modal-body', body),
    actions ? h('.modal-foot', actions) : null);

  const backdrop = h('.modal-backdrop', {
    onclick: (event) => { if (event.target === backdrop) close(); },
  }, dialog);

  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  openModal = { backdrop, onKey };
  document.getElementById('modal-root').append(backdrop);

  const focusable = dialog.querySelector('input, select, textarea, button:not(.icon-btn)');
  if (focusable) focusable.focus();
  return { close, dialog };
}

export function closeModal() {
  if (!openModal) return;
  document.removeEventListener('keydown', openModal.onKey);
  openModal.backdrop.remove();
  openModal = null;
}

/**
 * A modal wrapping a form. onSubmit receives the form values and may be async;
 * errors are shown inside the modal rather than as a toast, because the field
 * that caused them is on screen.
 */
export function formModal({ title, fields, submitLabel = 'Save', wide, onSubmit, intro }) {
  const errorBox = h('div');
  const form = h('form.form-grid', {
    onsubmit: async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      mount(errorBox);
      try {
        await onSubmit(formValues(form), { close });
      } catch (error) {
        mount(errorBox, notice('error', h('div',
          h('p', error.message),
          error.details && error.details.length > 1
            ? h('ul', error.details.slice(1).map((d) => h('li', d)))
            : null)));
        errorBox.scrollIntoView({ block: 'nearest' });
      } finally {
        if (button) button.disabled = false;
      }
    },
  }, fields);

  const submit = h('button.btn.btn-primary', { type: 'submit', form: 'modal-form' }, submitLabel);
  form.id = 'modal-form';

  const { close } = modal({
    title,
    wide,
    body: frag(intro ? h('p.small.muted', intro) : null, h('.span-2', errorBox), form),
    actions: frag(
      h('button.btn', { type: 'button', onclick: () => close() }, 'Cancel'),
      submit),
  });
  return { close, form };
}

export function confirmModal({ title, message, confirmLabel = 'Confirm', danger, onConfirm }) {
  const { close } = modal({
    title,
    body: typeof message === 'string' ? h('p', message) : message,
    actions: frag(
      h('button.btn', { type: 'button', onclick: () => close() }, 'Cancel'),
      h(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
        type: 'button',
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            await onConfirm();
            close();
          } catch (error) {
            toast(error.message, 'error');
            event.currentTarget.disabled = false;
          }
        },
      }, confirmLabel)),
  });
  return close;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
export function toast(message, kind = 'good') {
  const node = h(`.toast${kind === 'error' ? '.toast-error' : kind === 'info' ? '.toast-info' : ''}`, message);
  document.getElementById('toast-root').append(node);
  setTimeout(() => {
    node.style.transition = 'opacity 200ms';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, kind === 'error' ? 6500 : 3800);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
export function tabs(items, currentHref) {
  return h('nav.tabs', { 'aria-label': 'Sections of this event' },
    items.map((item) => h('a', {
      href: item.href,
      'aria-current': item.href === currentHref ? 'page' : null,
    }, item.label, item.count !== undefined && item.count !== null ? h('span.tab-count', String(item.count)) : null)));
}

export function detailList(rows) {
  return h('dl.detail-list',
    rows.filter(Boolean).map(([label, value]) => h('.detail-row', h('dt', label), h('dd', value ?? h('span.muted', 'Not set')))));
}

/** A file picker that reads a CSV and hands the text to a callback. */
export function csvPicker({ label = 'Choose a CSV file', onFile, accept = '.csv,text/csv' }) {
  const input = h('input', {
    type: 'file',
    accept,
    style: { display: 'none' },
    onchange: async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const text = await file.text();
      input.value = '';
      await onFile(text, file);
    },
  });
  return frag(input, h('button.btn', { type: 'button', onclick: () => input.click() }, icon('upload'), label));
}

export function downloadLink(href, label) {
  return h('a.btn', { href, download: '' }, icon('download'), label);
}

export function spinnerText(text = 'Working.') {
  return h('p.muted.small', text);
}
