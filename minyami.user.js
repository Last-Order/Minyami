// ==UserScript==
// @name New Script
// @namespace Violentmonkey Scripts
// @match https://abema.tv/now-on-air/*
// @match https://abema.tv/channels/*
// @match https://freshlive.tv/*
// @grant none
// ==/UserScript==
(() => {
    class M3U8 {
        constructor(m3u8Content) {
            this.m3u8Content = m3u8Content;
            this.parse();
        }
        parse() {
            if (this.m3u8Content.match(/#EXT-X-STREAM-INF/) !== null) {
                this.isPlaylist = true;
                this.playlists = this.m3u8Content.match(/(.+\.m3u8.*)/ig);

            } else {
                this.isPlaylist = false;
                this.chunks = this.m3u8Content.match(/(.+\.ts.*)/ig);
                this.isEncrypted = this.m3u8Content.match(/EXT-X-KEY:METHOD=AES-128,URI="(.+)"/) !== null;
                if (this.isEncrypted) {
                    this.key = this.m3u8Content.match(/EXT-X-KEY:METHOD=AES-128,URI="(.+)"/)[1];
                    this.iv = this.m3u8Content.match(/IV=0x(.+)/)[1];
                }
            }
        }
    }
    const listen = () => {
        const open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function () {
            this.addEventListener('load', function () {
                if (this.readyState === 4 && this.responseURL.includes('.m3u8')) {
                    const m3u8 = new M3U8(this.responseText);
                    console.log(m3u8);
                    if (m3u8.isPlaylist) {
                        m3u8List = m3u8List.concat(m3u8.playlists.map(playlist => {
                            const url = new URL(this.responseURL)
                            const params = url.pathname.split('/');
                            params[params.length - 1] = playlist;
                            if (playlist.startsWith('/')) {
                                return `${url.protocol}//${url.host}${playlist}`;
                            }
                            return `${url.protocol}//${url.host}${params.join('/')}`;
                        }));
                        m3u8List = Array.from(new Set(m3u8List)); // 去重
                    }
                }
            });
            open.apply(this, arguments);
        };
    }

    const abema = function () {
        const maps = {};

        XMLHttpRequest.prototype = new Proxy(XMLHttpRequest.prototype, {
            set: function (obj, prop, value) {
                if (prop === 'proxy' && maps.proxy) {
                    key = Object.values(JSON.parse(JSON.stringify(new Uint8Array(maps.proxy.response)))).map(i => i.toString(16).length === 1 ? '0' + i.toString(16) : i.toString(16)).join('');
                }
                maps[prop] = value;
                return Reflect.set(...arguments);
            }
        });
    }

    const mi = () => {
        if (!key) {
            document.write('未能获取到 Key 如果该站点需要 Key 请刷新重试；刷新后请等待视频完全加载');
        }
        let counter = 1;
        for (const i of m3u8List) {
            document.write(`
                <div>
                    <span>${i}</span>
                    <br>
                    <input id="minyami-text-${counter}" style="width: 30vw;" id="minyami-${counter}" class="minyami-link"></input>
                    <button id="minyami-link-${counter}">复制</button>
                </div>
            `);
            document.getElementById(`minyami-text-${counter}`).value = `minyami -d "${i}" ${key && '--key ' + key || ''}`;
            counter++;
        }
        m3u8List.forEach((i, index) => {
            document.getElementById(`minyami-link-${index + 1}`).addEventListener('click', e => {
                document.getElementById(`minyami-text-${index + 1}`).select();
                document.execCommand('copy');
            })
        })
    }

    let m3u8List = [];
    let key = undefined;
    let iv = undefined;
    let flag = false;

    document.body.onkeyup = (e) => {
        if (e.keyCode === 13) {
            if (flag) {
                mi();
            } else {
                flag = true;
            }
        }
        setTimeout(() => {
            flag = false;
        }, 500);
    }

    window.onload = () => {
        listen();
        switch (location.host) {
            case 'abema.tv': {
                abema();
                break;
            }
        }
    }


})()

