import { describe, expect, test } from "@jest/globals";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { createProxyAgent, parseWindowsInternetSettings } from "../../src/utils/agent";

describe("createProxyAgent", () => {
    test("creates agents for supported proxy address forms", () => {
        expect(createProxyAgent("http://127.0.0.1:8080")).toBeInstanceOf(HttpsProxyAgent);
        expect(createProxyAgent("socks5://127.0.0.1:1080")).toBeInstanceOf(SocksProxyAgent);
        expect(createProxyAgent("127.0.0.1:1080", { allowNonPrefixSocksProxy: true })).toBeInstanceOf(SocksProxyAgent);
    });

    test("rejects incomplete proxy addresses", () => {
        expect(() => createProxyAgent("socks5://127.0.0.1")).toThrow("Proxy server invalid.");
        expect(() => createProxyAgent("127.0.0.1:", { allowNonPrefixSocksProxy: true })).toThrow(
            "Proxy server invalid."
        );
    });

    test("parses Windows Internet Settings registry output", () => {
        const values = parseWindowsInternetSettings(`
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    socks=127.0.0.1:1080
        `);

        expect(values.get("ProxyEnable")).toBe("0x1");
        expect(values.get("ProxyServer")).toBe("socks=127.0.0.1:1080");
    });
});
