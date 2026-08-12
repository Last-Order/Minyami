import { Agent } from "agent-base";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import logger from "./log";
import { default as Registry } from "winreg";

const readRegistryKey = (key: InstanceType<typeof Registry>): Promise<Winreg.RegistryItem[]> => {
    return new Promise((resolve, reject) => {
        key.values((err, items) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(items);
        });
    });
};

class InvalidProxyServerError extends Error {}

function parseProxyAddress(proxy: string, pattern: RegExp): [host: string, port: string] {
    const match = pattern.exec(proxy);
    const host = match?.[1];
    const port = match?.[2];
    if (!host || !port) {
        throw new InvalidProxyServerError("Proxy server invalid.");
    }
    return [host, port];
}

class ProxyAgentHelper {
    proxyAgentInstance: Agent | undefined;
    isEnableProxy = true;

    /**
     * Set up proxy server and initialize the proxy agent instance
     * @param proxy
     * @param params
     * @param params.allowNonPrefixSocksProxy Treat proxy server without protocol as socks5 proxy for backward compatibility
     */
    setProxy(proxy: string, { allowNonPrefixSocksProxy = false } = {}) {
        if (!proxy) {
            return;
        }
        if (proxy.startsWith("http://") || proxy.startsWith("https://")) {
            // HTTP Proxy
            this.proxyAgentInstance = new HttpsProxyAgent(proxy, {
                keepAlive: true,
            });
            logger.debug(`HTTP/HTTPS Proxy set: ${proxy}`);
        } else if (proxy.startsWith("socks")) {
            if (proxy.startsWith("socks4")) {
                throw new InvalidProxyServerError("Socks4 is not supported. Please use HTTP or Socks5 proxy.");
            }
            // Socks5 Proxy
            const [host, port] = parseProxyAddress(proxy, /^socks(?:5h?)?[:：]\/\/(.+)[:：](\d+)$/);
            this.proxyAgentInstance = new SocksProxyAgent(`socks5h://${host}:${port}`, {
                keepAlive: true,
            });
            logger.debug(`Socks5 Proxy set: socks5h://${host}:${port}`);
        } else if (allowNonPrefixSocksProxy && !proxy.match(/\//)) {
            // For compatibility, use proxy without protocol as socks5 proxy
            const [host, port] = parseProxyAddress(proxy, /^(.+)[:：](\d+)$/);
            this.proxyAgentInstance = new SocksProxyAgent(`socks5h://${host}:${port}`, {
                keepAlive: true,
            });
            logger.debug(`Socks5 Proxy set: socks5h://${host}:${port}`);
        } else if (proxy.includes(":")) {
            // Treat as an http proxy without protocol prefix
            const [host, port] = parseProxyAddress(proxy, /^(.+)[:：](\d+)$/);
            this.proxyAgentInstance = new HttpsProxyAgent(`http://${host}:${port}`, {
                keepAlive: true,
            });
            logger.debug(`HTTP Proxy set: http://${host}:${port}`);
        } else {
            throw new InvalidProxyServerError("Proxy server invalid.");
        }
    }

    /**
     * Disable the proxy
     */
    disableProxy() {
        this.isEnableProxy = false;
    }

    getProxyAgentInstance(): Agent | undefined {
        if (!this.isEnableProxy) {
            return undefined;
        }
        return this.proxyAgentInstance;
    }

    /**
     * Read proxy configuration from environment variables.
     * By default, ALL_PROXY, HTTP_PROXY and HTTPS_PROXY will be used.
     * Note: environment variables will override system proxy in Windows.
     */
    readProxyConfigurationFromEnv() {
        const proxySettings = process.env.ALL_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
        if (proxySettings) {
            this.setProxy(proxySettings);
        }
    }

    /**
     * Read Windows system proxy from registry
     */
    async readWindowsSystemProxy() {
        if (process.platform !== "win32") {
            // not a windows environment
            return;
        }
        const key = new Registry({
            hive: Registry.HKCU,
            key: "\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
        });
        try {
            const items = await readRegistryKey(key);
            const proxyEnableItem = items.find((item) => item.name === "ProxyEnable");
            const proxyServerItem = items.find((item) => item.name === "ProxyServer");
            const isProxyEnable = proxyEnableItem?.value === "0x1";
            if (isProxyEnable && proxyServerItem && proxyServerItem.value !== "") {
                if (proxyServerItem.value.startsWith("socks=")) {
                    // socks proxy
                    this.setProxy(proxyServerItem.value.replace("socks=", "socks5://"));
                } else {
                    this.setProxy(`http://${proxyServerItem.value}`);
                }
            }
        } catch {
            // ignore
        }
    }
}

export function createProxyAgent(proxy: string, options: { allowNonPrefixSocksProxy?: boolean } = {}): Agent {
    const helper = new ProxyAgentHelper();
    helper.setProxy(proxy, options);
    const agent = helper.getProxyAgentInstance();
    if (!agent) {
        throw new InvalidProxyServerError("Proxy server invalid.");
    }
    return agent;
}

export default new ProxyAgentHelper();
