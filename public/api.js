/**
 * Talking to the service. Separate from `app.js` so the tab modules can call it
 * without importing the shell that imports them.
 */

/** Every endpoint reports failure as `{ error }`, so unwrap it in one place. */
export const requestJson = async (url, options) => {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error ?? `Request failed with ${response.status}`);
    }
    return body;
};

const sendJson = (method, url, value) => requestJson(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
});

export const putJson = (url, value) => sendJson('PUT', url, value);
export const postJson = (url, value) => sendJson('POST', url, value);
