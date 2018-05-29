// ==UserScript==
// @name Minyami 网页提取器
// @run-at document-start
// @namespace Violentmonkey Scripts
// @match https://abema.tv/*
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
        var content = document.createElement('div');
      
        
        if (!key) {
            let tips = document.createElement('div');
            tips.style.color = "red";
            tips.innerHTML ='未能获取到 Key 如果该站点需要 Key 请刷新重试；刷新后请等待视频完全加载';
            content.appendChild(tips);
        }
        
        let counter = 1;
        
        for (const i of m3u8List) {
            let listi = document.createElement('div');
            let spani = document.createElement("span");
            spani.innerHTML = i;
            listi.append(spani);
            listi.append(document.createElement('br'));
            
            let input_i = document.createElement('input');
            input_i.style.width="400px";
            input_i.value = `minyami -d "${i}" ${key && '--key ' + key || ''}`;
            listi.append(input_i);
            
            let button_i = document.createElement('button');
            button_i.innerHTML = "复制";
            button_i.addEventListener('click', e => {
                input_i.select();
                document.execCommand('copy');
            });
            listi.append(button_i);
            content.appendChild(listi);
        }
        buildDialog(content, "Minyami 提取器", {type:"ok"});
    }
    
    /**
     * 在页面上创建一个对话框
     * @param {HTMLElement} content 要显示的对话框主要内容
     * @param {String} title 对话框标题
     * @param {any} option 对话框选项。
     * 对话框选项介绍如下：
     * type: ok——只有确定按钮，okcancel——确定取消两个按钮
     * callback: 在对话框关闭时回调，如果返回了false，会阻止对话框关闭。callback接受一个字符串参数，在type为okcancel是会传入"ok"或者"cancel"来让开发者了解用户点击了哪个按钮。在type是ok的时候永远为"ok"。如果上一个对话框还没有关闭，又建立了一个新的对话框的话，callback会收到"override"，但是callback的返回值不再能阻止对话框关闭。
     * oncreated: 在对话框创建时回调。
     * width: 对话框的宽度。默认值是450px;
     * top: 对话框距离顶部的高度。默认值是100px;
     * left: 对话框距离左侧的高度。默认值是0;
     * right: 对话框距离右侧的高度。默认值是0;
     * id: 对话框的id。默认值是"tdialog";
     * containerBackgroundColor: 容器背景色。默认是white;
     * titleBackgroundColor: 标题栏背景色。默认是#F0F0F0;
     * titleTextAlign: 标题栏文字居中情况。默认是center，可选值为left/right/center;
     * footerBackgroundColor: 底部栏背景色。默认是#F0F0F0;
     * footerTextAlign: 底部栏文字居中情况。默认是right，可选值为left/right/center;
     * okText: 确定按钮的文字。默认是“确定”;
     * cancelText: 取消按钮的文字。默认是“取消”;
     */
    const buildDialog = (content, title, option) => {
        option = option || {};
        var oncreated = option.oncreated || function () { };
        var callback = option.callback || function () { };
      
        if(document.getElementById("tdialog")!=null){
            bodyTag.removeChild(document.getElementById("tdialog"));
            callback("override");
        }
      
        //body
        var bodyTag = document.getElementsByTagName("body")[0];
      
        //外围容器
        var tdialog = document.createElement("div");
        tdialog.style.position = "fixed";
        tdialog.style.width = option.width || "450px";
        tdialog.style.left = option.left || "0";
        tdialog.style.right = option.right || "0";
        tdialog.style.top = option.top || "100px";
        tdialog.style.margin = "auto";
        tdialog.style.zIndex = "999";
        tdialog.id = option.id || "tdialog";
        //内部容器
        var t_container = document.createElement("div");
        t_container.style.backgroundColor = option.containerBackgroundColor || "white";
        t_container.style.margin = "10px";
        //标题栏
        var t_title = document.createElement("div");
        t_title.style.backgroundColor = option.titleBackgroundColor || "#F0F0F0";
        t_title.style.textAlign = option.titleTextAlign || "center";
        t_title.style.fontWeight = "bold";
        t_title.innerHTML = title;
        //内容框
        var t_content = document.createElement("div");
        t_content.append(content);
        //底部框
        var t_footer = document.createElement("div");
        t_footer.style.backgroundColor = option.footerBackgroundColor || "#F0F0F0";
        t_footer.style.textAlign = option.footerTextAlign || "right";
        if (option.type == "okcancel") {
            var okbutton = document.createElement("button");
            okbutton.innerHTML = option.okText || "确定";
            okbutton.onclick = () => {
                if (callback("ok") === false) return false;
                bodyTag.removeChild(tdialog);
            }
            var cancelbutton = document.createElement("button");
            cancelbutton.innerHTML = option.cancelText || "取消";
            cancelbutton.onclick = () => {
                if (callback("cancel") === false) return false;
                bodyTag.removeChild(tdialog);
            }
            t_footer.appendChild(okbutton);
            t_footer.append(" ");
            t_footer.appendChild(cancelbutton);
        }else{
            var okbutton = document.createElement("button");
            okbutton.innerHTML = option.okText || "确定";
            okbutton.onclick = () => {
                if (callback("ok") === false) return false;
                bodyTag.removeChild(tdialog);
            }
            t_footer.appendChild(okbutton);
        }

        //show
        tdialog.appendChild(t_container);
        t_container.appendChild(t_title);
        t_container.appendChild(t_content);
        t_container.appendChild(t_footer);
        bodyTag.appendChild(tdialog);
        oncreated();
    }

    let m3u8List = [];
    let key = undefined;
    let iv = undefined;
    let flag = false;



    window.onload = () => {
        listen();
        switch (location.host) {
            case 'abema.tv': {
                abema();
                break;
            }
        }
        document.body.onkeyup = (e) => {
            if (e.keyCode === 13) {
                if (flag) {
                    mi();
                    flag = false;
                } else {
                    flag = true;
                }
            }
            setTimeout(() => {
                flag = false;
            }, 500);
        }
    }


})()