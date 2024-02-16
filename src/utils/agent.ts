import { Agent } from "agent-base";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import logger from "./log";
import { default as Registry } from "winreg";

interface RegistryKeyItem {
    name: string;
    value: string;
}

const readRegistryKey = (key: any): Promise<RegistryKeyItem[]> => {
    return new Promise((resolve, reject) => {
        key.values((err, items) => {
            if (err) {
                reject(err);
            }
            resolve(items);
        });
    });
};

class InvalidProxyServerError extends Error {}

class ProxyAgentHelper {
    proxyAgentInstance: Agent = null;

    constructor() {}

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
            try {
                const [_, host, port] = proxy.match(/socks5?(?:(?<=5)h)?[:：]\/\/(.+)[:：](\d+)/);
                this.proxyAgentInstance = new SocksProxyAgent(`socks5h://${host}:${port}`, {
                    keepAlive: true,
                });
                logger.debug(`Socks5 Proxy set: socks5h://${host}:${port}`);
            } catch (e) {
                throw new InvalidProxyServerError("Proxy server invalid.");
            }
        } else if (allowNonPrefixSocksProxy && !proxy.match(/\//)) {
            // For compatibility, use proxy without protocol as socks5 proxy
            try {
                const [_, host, port] = proxy.match(/(.+)[:：](\d+)/);
                this.proxyAgentInstance = new SocksProxyAgent(`socks5h://${host}:${port}`, {
                    keepAlive: true,
                });
                logger.debug(`Socks5 Proxy set: socks5h://${host}:${port}`);
            } catch (e) {
                throw new InvalidProxyServerError("Proxy server invalid.");
            }
        } else {
            throw new InvalidProxyServerError("Proxy server invalid.");
        }
    }

    getProxyAgentInstance() {
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
            this.setProxy(process.env.ALL_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY);
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
            const isProxyEnable = proxyEnableItem.value === "0x1";
            if (isProxyEnable && proxyServerItem && proxyServerItem.value !== "") {
                this.setProxy(proxyServerItem.value);
            }
        } catch {
            // ignore
        }
    }
}

export default new ProxyAgentHelper();
