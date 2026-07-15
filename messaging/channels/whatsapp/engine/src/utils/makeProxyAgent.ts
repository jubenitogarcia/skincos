import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

type Proxy = {
  host: string;
  password?: string;
  port: string;
  protocol: string;
  username?: string;
};

const HTTP_PROXY_PROTOCOLS = new Set(['http:', 'https:']);
const SOCKS_PROXY_PROTOCOLS = new Set(['socks:', 'socks4:', 'socks5:']);

function validateProxyUrl(proxyUrl: string): URL {
  if (typeof proxyUrl !== 'string' || proxyUrl.length === 0 || proxyUrl.length > 2048) {
    throw new Error('Invalid proxy URL');
  }
  const url = new URL(proxyUrl);
  if (!HTTP_PROXY_PROTOCOLS.has(url.protocol) && !SOCKS_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Unsupported proxy protocol: ${url.protocol}`);
  }
  if (!url.hostname || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('Invalid proxy URL components');
  }
  const port = Number.parseInt(url.port, 10);
  if (!url.port || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid proxy port');
  }
  return url;
}

export function buildProxyUrl(proxy: Proxy | string): URL {
  if (typeof proxy === 'string') return validateProxyUrl(proxy);

  const protocol =
    String(proxy?.protocol || '')
      .trim()
      .replace(/:$/, '') + ':';
  const host = String(proxy?.host || '').trim();
  const port = String(proxy?.port || '').trim();
  if (!HTTP_PROXY_PROTOCOLS.has(protocol) && !SOCKS_PROXY_PROTOCOLS.has(protocol)) {
    throw new Error(`Unsupported proxy protocol: ${protocol}`);
  }
  if (!host || host.length > 253 || /[\s/?#@]/.test(host) || !/^\d{1,5}$/.test(port)) {
    throw new Error('Invalid proxy host or port');
  }

  const url = new URL(`${protocol}//${host}:${port}`);
  if (proxy.username) url.username = String(proxy.username);
  if (proxy.password) url.password = String(proxy.password);
  return validateProxyUrl(url.toString());
}

function selectProxyAgent(url: URL): HttpsProxyAgent<string> | SocksProxyAgent {
  if (HTTP_PROXY_PROTOCOLS.has(url.protocol)) return new HttpsProxyAgent(url);
  if (SOCKS_PROXY_PROTOCOLS.has(url.protocol)) return new SocksProxyAgent(url);
  throw new Error(`Unsupported proxy protocol: ${url.protocol}`);
}

export function makeProxyAgent(proxy: Proxy | string): HttpsProxyAgent<string> | SocksProxyAgent {
  return selectProxyAgent(buildProxyUrl(proxy));
}
