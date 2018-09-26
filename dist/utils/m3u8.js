"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('fs');
const m3u8_1 = require("../core/m3u8");
const log_1 = require("../utils/log");
let Log = log_1.default.getInstance();
const axios_1 = require("axios");
const SocksProxyAgent = require('socks-proxy-agent');
function loadM3U8(path, retries = 1, timeout = 60000, proxy = undefined) {
    return __awaiter(this, void 0, void 0, function* () {
        let m3u8Content;
        if (path.startsWith('http')) {
            Log.info('Start fetching M3U8 file.');
            while (retries >= 0) {
                try {
                    const response = yield axios_1.default.get(path, {
                        timeout,
                        httpsAgent: proxy ? new SocksProxyAgent(`socks5://${proxy.host}:${proxy.port}`) : undefined,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36'
                        }
                    });
                    Log.info('M3U8 file fetched.');
                    m3u8Content = response.data;
                    break;
                }
                catch (e) {
                    Log.warning(`Fail to fetch M3U8 file: [${e.code ||
                        (e.response ? `${e.response.status} ${e.response.statusText}` : undefined)
                        || 'UNKNOWN'}]`);
                    Log.warning('If you are downloading a live stream, this may result in a broken output video.');
                    retries--;
                    if (retries >= 0) {
                        Log.info('Try again.');
                    }
                    else {
                        Log.warning('Max retries exceeded. Abort.');
                        throw new Error('Max retries exceeded.');
                    }
                }
            }
        }
        else {
            // is a local file path
            if (!fs.existsSync(path)) {
                Log.error(`File '${path}' not found.`);
            }
            Log.info('Loading M3U8 file.');
            m3u8Content = fs.readFileSync(path).toString();
        }
        return new m3u8_1.default(m3u8Content);
    });
}
exports.loadM3U8 = loadM3U8;
//# sourceMappingURL=m3u8.js.map