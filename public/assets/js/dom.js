// Minimal DOM building. Everything in the console is built from h().

/**
 * h('div.panel', { onclick }, child, child)
 *
 * The tag string carries an optional id and any number of classes, which keeps
 * the call sites readable without a template language. Text children are
 * inserted as text nodes, so nothing in this console can inject markup by
 * accident.
 */
export function h(spec, props = null, ...children) {
  const match = /^([a-zA-Z0-9-]+)?(#[^.]+)?((?:\.[^.#]+)*)$/.exec(spec);
  if (!match) throw new Error(`Bad element spec: ${spec}`);
  const [, tag = 'div', id, classes] = match;
  const el = document.createElement(tag);
  if (id) el.id = id.slice(1);
  if (classes) el.className = classes.slice(1).split('.').join(' ');

  if (props && (typeof props !== 'object' || Array.isArray(props) || props instanceof Node)) {
    children.unshift(props);
    props = null;
  }

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      el.className = `${el.className} ${value}`.trim();
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (key in el && key !== 'list' && key !== 'form') {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

/** A fragment, for returning several siblings from one function. */
export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

/** Read a form into a plain object, trimming text and unchecking to false. */
export function formValues(form) {
  const out = {};
  for (const element of form.elements) {
    if (!element.name || element.disabled) continue;
    if (element.type === 'checkbox') {
      out[element.name] = element.checked;
    } else if (element.type === 'radio') {
      if (element.checked) out[element.name] = element.value;
    } else if (element.multiple && element.tagName === 'SELECT') {
      out[element.name] = [...element.selectedOptions].map((o) => o.value);
    } else {
      out[element.name] = typeof element.value === 'string' ? element.value.trim() : element.value;
    }
  }
  return out;
}
