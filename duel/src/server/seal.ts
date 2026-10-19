/**
 * Add the robots header without rebuilding upgrade responses.
 * A new Response drops the `webSocket` on a 101, which makes the live socket fail.
 */
export function seal(response: Response): Response {
  const upgraded = response as Response & { webSocket?: unknown };
  if (response.status === 101 || upgraded.webSocket != null) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
