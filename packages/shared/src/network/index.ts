import { ProxyError } from "../errors/index.js";

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second] = octets;
  if (first === undefined || second === undefined) return true;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv6 = normalized.includes(":");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "::" ||
    normalized === "::1" ||
    (isIpv6 && normalized.startsWith("fc")) ||
    (isIpv6 && normalized.startsWith("fd")) ||
    (isIpv6 && /^fe[89ab]/.test(normalized))
  ) {
    return true;
  }

  const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return isPrivateIpv4(ipv4Mapped ?? normalized);
}

export function assertPublicHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProxyError("Invalid URL", 400);
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    isPrivateHostname(url.hostname)
  ) {
    throw new ProxyError("URL must target a public HTTP(S) host", 400);
  }

  return url;
}
