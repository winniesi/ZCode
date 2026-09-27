export interface WebRemoteControlParams {
  deviceSid: string;
  passHash: string;
  timestamp: number;
  deviceMid?: string;
  deviceName?: string;
  appVersion?: string;
  theme?: string;
}

function getParam(params: URLSearchParams, key: string): string | undefined {
  const val = params.get(key)?.trim();
  return val ? val : undefined;
}

export function parseWebRemoteControlParams(
  params: URLSearchParams,
): WebRemoteControlParams | null {
  const sid = getParam(params, "sid");
  const hash = getParam(params, "hash");
  const t = getParam(params, "t");
  const timestamp = t ? Number(t) : NaN;

  if (!sid || !hash || !Number.isFinite(timestamp)) {
    return null;
  }

  return {
    deviceSid: sid,
    passHash: hash,
    timestamp,
    ...(getParam(params, "mid") ? { deviceMid: getParam(params, "mid") } : {}),
    ...(getParam(params, "name") ? { deviceName: getParam(params, "name") } : {}),
    ...(getParam(params, "app_version") ? { appVersion: getParam(params, "app_version") } : {}),
    ...(getParam(params, "theme") ? { theme: getParam(params, "theme") } : {}),
  };
}

export function isWebRemoteControlPath(pathname: string, params: URLSearchParams): boolean {
  // 支持 /remote/v4, /remote, /remote/v3 以及任何携带 sid & hash 参数的访问
  const normalized = pathname.replace(/\/+$/, "");
  if (
    normalized === "/remote" ||
    normalized.startsWith("/remote/") ||
    normalized === "/web-remote"
  ) {
    return true;
  }
  return params.has("sid") && params.has("hash");
}
