import createClient from "openapi-fetch";
import type { paths as ApiPaths } from "./generated/api";
import type { paths as DataPaths } from "./generated/data";
import { dataUrl, v3APIBaseUrl } from "../urls";

// The generated paths already carry the /v3 prefix, so the client's base URL is
// the origin rather than v3APIBaseUrl itself.
const apiOrigin = v3APIBaseUrl.replace(/\/v3$/, "");

/** The `api` service: radar, lightning, mobile, telemetry and preview. */
export const apiClient = createClient<ApiPaths>({ baseUrl: apiOrigin });

/** The `data` service: the live lightning and mesocyclone caches. */
export const dataClient = createClient<DataPaths>({ baseUrl: dataUrl });
