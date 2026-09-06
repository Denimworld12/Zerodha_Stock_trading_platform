/**
 * Backend origin and the dashboard's location.
 *
 * The landing app authenticates and then hands off to the dashboard, which runs
 * as a separate build on its own port.
 */
export const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3002").replace(/\/+$/, "");
export const DASHBOARD_URL = (process.env.REACT_APP_DASHBOARD_URL || "http://localhost:3000").replace(/\/+$/, "");
export default API_URL;
