import { Agent } from "agent-base";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import logger from "./log";

class InvalidProxyServerError extends Error {}

class ProxyAgentHelper {
    proxyAgentInstance: Agent = null;

    constructor() {}

    setProxy(proxy: string) {
        if (proxy.startsWith("http://") || proxy.startsWith("https://")) {
            // HTTP Proxy
            this.proxyAgentInstance = new HttpsProxyAgent(proxy);
            logger.debug(`HTTP/HTTPS Proxy set: ${proxy}`);
        }
        if (proxy.startsWith("socks5://")) {
            // Socks5 Proxy
            try {
                const [_, host, port] = proxy.match(/socks5[h]*:\/\/([\d\.]+):(\d+)/);
                this.proxyAgentInstance = new SocksProxyAgent(`socks5h://${host}:${port}`);
                logger.debug(`Socks5 Proxy set: ${proxy}`);
            } catch (e) {
                throw new InvalidProxyServerError("Proxy server invalid.");
            }
        }
    }

    getProxyAgentInstance() {
        return this.proxyAgentInstance;
    }

    readProxyConfigurationFromEnv() {
        if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
            this.setProxy(process.env.HTTP_PROXY || process.env.HTTPS_PROXY);
        }
    }
}

export default new ProxyAgentHelper();
