// The single place the console talks to the server.

class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details || null;
  }
}

async function request(method, path, body, options = {}) {
  const init = { method, headers: {}, ...options };
  if (body !== undefined && body !== null) {
    if (typeof body === 'string') {
      init.headers['content-type'] = 'text/plain; charset=utf-8';
      init.body = body;
    } else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }

  const response = await fetch(`/api${path}`, init);

  if (response.status === 401) {
    window.location.href = '/sign-in';
    throw new ApiError('Your session has ended. Sign in again.', 401);
  }

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = isJson && payload.error ? payload.error.message : `Request failed with status ${response.status}.`;
    throw new ApiError(message, response.status, isJson && payload.error ? payload.error.details : null);
  }
  return payload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path, body) => request('DELETE', path, body),
  postText: (path, text) => request('POST', path, text),
  ApiError,
};

/** Build a query string, leaving out anything empty. */
export function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export { ApiError };
