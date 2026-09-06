/**
 * Single source of truth for the backend origin.
 *
 * Every dashboard component used to hardcode http://localhost:3002, so the app
 * could only ever run on the developer's own machine - a deployed build would
 * call the viewer's localhost and fail. Set REACT_APP_API_URL at build time
 * (see .env.example); the localhost value is only the dev fallback.
 */
export const API_URL = (
  process.env.REACT_APP_API_URL || "http://localhost:3002"
).replace(/\/+$/, "");

export default API_URL;
