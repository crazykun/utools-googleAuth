/**
 * Google Authenticator - uTools 插件主程序
 * 性能优化版 + 用户体验优化
 */

(function () {
    'use strict';

    // ==================== 状态管理 ====================
    var items = [];               // 数据列表
    var config_rev = "";          // 配置版本号
    var totpCache = {};           // TOTP 对象缓存
    var animationId = null;       // requestAnimationFrame ID
    var lastUpdateTime = 0;       // 上次更新时间戳
    var UPDATE_INTERVAL = 500;    // 更新间隔(ms)
    var selectedIndex = -1;       // 当前选中的卡片索引
    var layerIndex = null;        // 当前弹窗索引

    // ==================== DOM 引用 ====================
    var view = document.getElementById('view');
    var shortcutsPanel = document.getElementById('shortcutsPanel');

    // ==================== Layui 模块初始化 ====================
    layui.use(['element', 'layer', 'util', 'form', 'laytpl'], function () {
        var element = layui.element;
        var layer = layui.layer;
        var util = layui.util;
        var laytpl = layui.laytpl;
        var form = layui.form;
        var $ = layui.$;

        // 设置模板标签
        laytpl.config({
            open: '<%',
            close: '%>'
        });

        var getTpl = item.innerHTML;

        // ==================== TOTP 缓存管理 ====================

        function getTOTP(secret, period) {
            var cacheKey = secret + '_' + period;
            if (!totpCache[cacheKey]) {
                try {
                    totpCache[cacheKey] = new OTPAuth.TOTP({
                        algorithm: 'SHA1',
                        digits: 6,
                        period: period,
                        secret: OTPAuth.Secret.fromBase32(secret)
                    });
                } catch (e) {
                    console.error('TOTP 创建失败:', e);
                    return null;
                }
            }
            return totpCache[cacheKey];
        }

        function clearTOTPCache() {
            totpCache = {};
        }

        function generateTOTP(secret, period) {
            var totp = getTOTP(secret, period);
            return totp ? totp.generate() : 'ERROR';
        }

        // ==================== 统一定时器 ====================

        function startGlobalTimer() {
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
            lastUpdateTime = 0;
            updateLoop();
        }

        function stopGlobalTimer() {
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }
        }

        function updateLoop() {
            var now = Date.now();

            if (now - lastUpdateTime >= UPDATE_INTERVAL) {
                lastUpdateTime = now;
                updateAllTOTP();
            }

            animationId = requestAnimationFrame(updateLoop);
        }

        function updateAllTOTP() {
            var nowtime = Math.ceil(Date.now() / 1000);

            $(".layui-card").each(function () {
                var $card = $(this);
                var index = $card.data('index');

                if (index === undefined || !items[index]) return;

                var item = items[index];
                var max = parseInt(item.max) || 30;
                var left_time = Math.ceil(max - nowtime % max);

                // 更新验证码
                var totp = generateTOTP(item.password, max);
                $card.find('.num').text(totp);

                // 更新倒计时显示
                $('#countdown' + index).text(left_time + 's');

                // 更新进度条
                var progressPercent = (left_time / max * 100).toFixed(2);
                element.progress('loading' + index, progressPercent + '%');

                // 进度条颜色状态
                var $progressBar = $card.find('.layui-progress-bar');
                $progressBar.removeClass('warning danger');
                if (left_time <= 5) {
                    $progressBar.addClass('danger');
                } else if (left_time <= 10) {
                    $progressBar.addClass('warning');
                }
            });
        }

        // ==================== 渲染函数 ====================
        function render() {
            laytpl(getTpl).render(items, function (html) {
                view.innerHTML = html;
                startGlobalTimer();
            });
        }

        // ==================== 数据持久化 ====================
        function loadConfig() {
            var result = utools.db.get("config");
            if (result) {
                config_rev = result._rev;
                var result_data = JSON.parse(result.data);
                if (result_data) {
                    items = result_data;
                    render();
                } else {
                    saveConfig();
                }
            }

            form.val('set_box', {
                "auto_close": utools.dbStorage.getItem("auto_close") === "true",
                "msg_close": utools.dbStorage.getItem("msg_close") === "true"
            });
        }

        function saveConfig() {
            var result = utools.db.put({
                _id: "config",
                data: JSON.stringify(items),
                _rev: config_rev
            });
            if (result) {
                config_rev = result._rev;
            }
            render();
        }

        // ==================== 通知处理 ====================
        function notice(num) {
            if ($("input[name='auto_close']").prop("checked")) {
                setTimeout(function () {
                    utools.hideMainWindow();
                }, 100);
            }
            if ($("input[name='msg_close']").prop("checked")) {
                utools.showNotification("✓ 已复制: " + num);
            }
        }

        // ==================== 快捷键帮助面板 ====================
        function toggleShortcutsPanel() {
            if (shortcutsPanel.style.display === 'none') {
                shortcutsPanel.style.display = 'block';
            } else {
                shortcutsPanel.style.display = 'none';
            }
        }

        function hideShortcutsPanel() {
            shortcutsPanel.style.display = 'none';
        }

        // 点击其他地方关闭帮助面板
        $(document).on('click', function (e) {
            if (!$(e.target).closest('.shortcuts-panel').length &&
                !$(e.target).closest('.help-text').length) {
                hideShortcutsPanel();
            }
        });

        // ==================== 二维码识别增强 ====================
        function qrcodeIdentify(base64Str) {
            var c = document.getElementById("qrcanvas");
            var ctx = c.getContext("2d");
            var img = new Image();
            img.src = base64Str;

            img.onload = function () {
                $("#qrcanvas").attr("width", img.width);
                $("#qrcanvas").attr("height", img.height);
                ctx.drawImage(img, 0, 0, img.width, img.height);

                var imageData = ctx.getImageData(0, 0, img.width, img.height);

                // 尝试多种识别模式
                var code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: "attemptBoth"
                });

                if (!code) {
                    layer.alert(
                        "❌ 未能识别二维码<br><br>" +
                        "<b>可能原因：</b><br>" +
                        "• 图片模糊或分辨率过低<br>" +
                        "• 二维码不完整或损坏<br>" +
                        "• 图片中没有二维码<br><br>" +
                        "<b>建议：</b> 请确保二维码清晰可见",
                        { title: "识别失败", icon: 2, area: ['320px'] }
                    );
                    resetNavSelection();
                    return;
                }

                var parsed = parseOTPAuthURI(code.data);

                if (!parsed.secret) {
                    layer.alert(
                        "❌ 无法解析密钥<br><br>" +
                        "<b>识别到的内容：</b><br>" +
                        "<code style='word-break:break-all; background:#f5f5f5; padding:5px; display:block;'>" +
                        escapeHtml(code.data.substring(0, 100)) + (code.data.length > 100 ? '...' : '') +
                        "</code><br>" +
                        "<b>支持的格式：</b><br>" +
                        "• otpauth://totp/...?secret=XXX<br>" +
                        "• 标准 TOTP 二维码",
                        { title: "解析失败", icon: 2, area: ['350px'] }
                    );
                    resetNavSelection();
                    return;
                }

                items.push({
                    "name": parsed.name || "未命名",
                    "password": parsed.secret,
                    "max": parsed.period || 30
                });
                saveConfig();
                layer.msg("✓ 识别成功: " + (parsed.name || "未命名"), { icon: 1 });
                resetNavSelection();
            };

            img.onerror = function () {
                layer.alert("❌ 图片加载失败，请重试", { title: "错误", icon: 2 });
                resetNavSelection();
            };
        }

        /**
         * 解析 otpauth:// URI
         * 支持格式：
         * - otpauth://totp/issuer:account?secret=XXX&issuer=YYY&period=30&digits=6
         * - otpauth://totp/account?secret=XXX&issuer=YYY
         */
        function parseOTPAuthURI(uri) {
            var result = {
                name: '',
                secret: '',
                period: 30,
                digits: 6,
                issuer: ''
            };

            if (!uri || typeof uri !== 'string') {
                return result;
            }

            try {
                // 尝试解析为 URL
                var url = new URL(uri);

                if (url.protocol === 'otpauth:') {
                    // 从 pathname 提取名称
                    var pathname = decodeURIComponent(url.pathname);
                    // 移除开头的 /
                    pathname = pathname.replace(/^\//, '');
                    // 格式可能是 "issuer:account" 或 "account"
                    if (pathname.includes(':')) {
                        var parts = pathname.split(':');
                        result.issuer = parts[0];
                        result.name = parts.slice(1).join(':') || parts[0];
                    } else {
                        result.name = pathname || '未命名';
                    }

                    // 解析查询参数
                    var params = url.searchParams;
                    result.secret = params.get('secret') || '';
                    result.issuer = params.get('issuer') || result.issuer;
                    result.period = parseInt(params.get('period')) || 30;
                    result.digits = parseInt(params.get('digits')) || 6;

                    // 如果有 issuer，组合显示名称
                    if (result.issuer && result.name !== result.issuer) {
                        result.name = result.issuer + ':' + result.name;
                    }
                }
            } catch (e) {
                // 非 URL 格式，尝试正则提取
                console.log('非标准 URI，尝试正则提取');
            }

            // 如果 secret 为空，尝试正则匹配
            if (!result.secret) {
                // 匹配 secret 参数（支持不同分隔符）
                var secretMatch = uri.match(/secret=([A-Z2-7]+)/i);
                if (secretMatch) {
                    result.secret = secretMatch[1];
                }

                // 尝试提取名称
                var nameMatch = uri.match(/totp\/([^?]+)/i);
                if (nameMatch) {
                    result.name = decodeURIComponent(nameMatch[1].replace(/:/g, ':'));
                }
            }

            return result;
        }

        function escapeHtml(text) {
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function resetNavSelection() {
            $('.layui-nav-item').eq(0).addClass('layui-this').siblings().removeClass('layui-this');
        }

        // ==================== 导入导出 ====================
        function exportData() {
            if (items.length === 0) {
                layer.msg("暂无数据可导出", { icon: 0 });
                return;
            }

            var filepath = utools.showSaveDialog({
                title: "导出验证器数据",
                defaultPath: utools.getPath("downloads") + '/googleAuth-backup-' + formatDate(new Date()) + '.json',
                buttonLabel: "导出",
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });

            if (filepath) {
                var exportData = {
                    version: '1.0',
                    exportTime: new Date().toISOString(),
                    count: items.length,
                    items: items
                };
                var err = window.writeFile(filepath, JSON.stringify(exportData, null, 2));
                if (err) {
                    layer.alert("导出失败: " + err.message, { title: "错误", icon: 2 });
                } else {
                    layer.msg("✓ 导出成功，共 " + items.length + " 条记录", { icon: 1 });
                }
            }
        }

        function importData() {
            var files = utools.showOpenDialog({
                title: "导入验证器数据",
                defaultPath: utools.getPath("downloads"),
                buttonLabel: "导入",
                filters: [{ name: 'JSON', extensions: ['json'] }],
                properties: ['openFile']
            });

            if (!files) return;

            try {
                var filedata = window.readFile(files[0]);
                var importObj = JSON.parse(filedata);

                // 兼容新旧格式
                var import_items = Array.isArray(importObj) ? importObj : (importObj.items || []);

                if (import_items.length === 0) {
                    layer.msg("文件中没有数据", { icon: 0 });
                    return;
                }

                // 根据 name + password 去重
                var newCount = 0;
                import_items.forEach(function (v) {
                    if (!v.password) return;
                    var exists = items.some(function (v2) {
                        return v.name === v2.name && v.password === v2.password;
                    });
                    if (!exists) {
                        items.push(v);
                        newCount++;
                    }
                });

                if (newCount > 0) {
                    clearTOTPCache();
                    saveConfig();
                    layer.msg("✓ 导入成功，新增 " + newCount + " 条记录", { icon: 1 });
                } else {
                    layer.msg("所有记录已存在，无新增", { icon: 0 });
                }
            } catch (e) {
                layer.alert("导入失败: " + e.message + "<br>请确认文件格式正确", { title: "错误", icon: 2 });
            }
        }

        function formatDate(date) {
            var y = date.getFullYear();
            var m = String(date.getMonth() + 1).padStart(2, '0');
            var d = String(date.getDate()).padStart(2, '0');
            return y + m + d;
        }

        // ==================== 卡片操作 ====================
        function copyByIndex(index) {
            if (index < 0 || index >= items.length) return false;
            var key = $(".layui-card").eq(index).find('.num').text();
            if (key && key !== 'ERROR') {
                utools.copyText(key);
                notice(key);
                return true;
            }
            return false;
        }

        function deleteByIndex(index) {
            if (index < 0 || index >= items.length) return;
            var name = items[index].name;
            layer.confirm('确认删除 "<b>' + escapeHtml(name) + '</b>" ?', { title: '确认删除', icon: 3 }, function (i) {
                delete items[index];
                items = items.filter(Boolean);
                clearTOTPCache();
                saveConfig();
                layer.close(i);
                layer.msg("✓ 已删除", { icon: 1 });
            });
        }

        function editByIndex(index) {
            if (index < 0 || index >= items.length) return;
            var item = items[index];
            $('.edit_box input[name="index"]').val(index);
            $('.edit_box input[name="name"]').val(item.name);
            $('.edit_box input[name="password"]').val(item.password);
            $('.edit_box input[name="max"]').val(item.max || 30);

            layerIndex = layer.open({
                type: 1,
                closeBtn: 1,
                anim: 2,
                title: "编辑 - " + item.name,
                shadeClose: true,
                content: $('.edit_box')
            });
        }

        // ==================== 事件绑定 ====================

        // 复制验证码
        $(document).on('click', '.copy-btn', function (e) {
            e.preventDefault();
            var num = $(this).parents(".layui-elem-quote").find('.num').text();
            if (num && num !== 'ERROR') {
                utools.copyText(num);
                notice(num);
            }
        });

        // 删除
        $(document).on('click', '.del-btn', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var index = $(this).parents(".layui-card").data('index');
            deleteByIndex(index);
        });

        // 编辑/添加
        $(document).on('click', '.edit-btn, .add-btn', function (e) {
            e.preventDefault();
            e.stopPropagation();

            if ($(this).hasClass("add-btn")) {
                $('.edit_box input[name="index"]').val('');
                $('.edit_box input[name="name"]').val('');
                $('.edit_box input[name="password"]').val('');
                $('.edit_box input[name="max"]').val('30');
                layerIndex = layer.open({
                    type: 1,
                    closeBtn: 1,
                    anim: 2,
                    title: "添加密钥",
                    shadeClose: true,
                    content: $('.edit_box')
                });
            } else {
                var index = $(this).parents(".layui-card").data('index');
                editByIndex(index);
            }
        });

        // 卡片点击选中
        $(document).on('click', '.layui-card', function (e) {
            if ($(e.target).closest('.btns').length) return;
            selectedIndex = $(this).data('index');
            $('.layui-card').removeClass('layui-card-selected');
            $(this).addClass('layui-card-selected');
        });

        // 表单提交 - 保存密钥
        form.on('submit(submit_btn)', function (data) {
            var index = data.field.index;
            var newItem = {
                name: data.field.name.trim() || '未命名',
                password: data.field.password.trim().toUpperCase().replace(/\s/g, ''),
                max: parseInt(data.field.max) || 30
            };

            // 验证密钥格式
            if (!/^[A-Z2-7]+=*$/.test(newItem.password)) {
                layer.msg("密钥格式错误，应为 Base32 编码", { icon: 2 });
                return false;
            }

            if (index !== '') {
                items[parseInt(index)] = newItem;
            } else {
                items.push(newItem);
            }
            clearTOTPCache();
            saveConfig();
            layer.closeAll();
            layer.msg("✓ 保存成功", { icon: 1 });
            resetNavSelection();
            return false;
        });

        // 设置按钮
        $(document).on('click', '.set-btn', function (e) {
            e.preventDefault();
            layerIndex = layer.open({
                type: 1,
                closeBtn: 1,
                anim: 2,
                title: "设置",
                shadeClose: true,
                area: ['320px'],
                content: $('.set_box')
            });
        });

        // 表单提交 - 保存设置
        form.on('submit(submit_set_btn)', function (data) {
            utools.dbStorage.setItem("auto_close", data.field.auto_close);
            utools.dbStorage.setItem("msg_close", data.field.msg_close);
            layer.closeAll();
            layer.msg("✓ 设置已保存", { icon: 1 });
            resetNavSelection();
            return false;
        });

        // 识别二维码按钮
        $(".qrcode-btn").click(function (e) {
            e.preventDefault();
            utools.hideMainWindow();
            utools.screenCapture(function (base64Str) {
                utools.showMainWindow();
                qrcodeIdentify(base64Str);
            });
        });

        // 导出按钮
        $("#export").click(function (e) {
            e.preventDefault();
            exportData();
        });

        // 导入按钮
        $("#upload").click(function (e) {
            e.preventDefault();
            importData();
        });

        // ==================== 快捷键系统 ====================
        $(document).keydown(function (e) {
            // 忽略输入框中的快捷键
            if ($(e.target).is('input, textarea')) {
                // ESC 关闭弹窗
                if (e.keyCode === 27) {
                    layer.closeAll();
                    hideShortcutsPanel();
                }
                return;
            }

            // ESC 关闭弹窗或帮助面板
            if (e.keyCode === 27) {
                if (shortcutsPanel.style.display !== 'none') {
                    hideShortcutsPanel();
                } else {
                    layer.closeAll();
                }
                return;
            }

            // ? 显示/隐藏快捷键帮助
            if (e.shiftKey && e.keyCode === 191) { // Shift + /
                toggleShortcutsPanel();
                return;
            }

            // Alt + 1-9 复制验证码
            if (e.altKey) {
                var num = e.keyCode - 48;
                if (num >= 1 && num <= 9) {
                    e.preventDefault();
                    copyByIndex(num - 1);
                    return;
                }
            }

            // 其他快捷键
            if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
                switch (e.keyCode) {
                    case 65: // A - 添加
                        e.preventDefault();
                        $('.add-btn').click();
                        break;
                    case 81: // Q - 二维码
                        e.preventDefault();
                        $('.qrcode-btn').click();
                        break;
                    case 83: // S - 设置
                        e.preventDefault();
                        $('.set-btn').click();
                        break;
                    case 46: // Delete - 删除选中项
                    case 8:  // Backspace
                        if (selectedIndex >= 0) {
                            e.preventDefault();
                            deleteByIndex(selectedIndex);
                            selectedIndex = -1;
                        }
                        break;
                    case 13: // Enter - 编辑选中项
                        if (selectedIndex >= 0) {
                            e.preventDefault();
                            editByIndex(selectedIndex);
                        }
                        break;
                    case 38: // Up - 上移选择
                        e.preventDefault();
                        if (selectedIndex < 0) selectedIndex = 0;
                        else if (selectedIndex > 0) selectedIndex--;
                        $('.layui-card').removeClass('layui-card-selected');
                        $('.layui-card').eq(selectedIndex).addClass('layui-card-selected');
                        break;
                    case 40: // Down - 下移选择
                        e.preventDefault();
                        if (selectedIndex < 0) selectedIndex = 0;
                        else if (selectedIndex < items.length - 1) selectedIndex++;
                        $('.layui-card').removeClass('layui-card-selected');
                        $('.layui-card').eq(selectedIndex).addClass('layui-card-selected');
                        break;
                }
            }
        });

        // ==================== 插件生命周期 ====================

        utools.onPluginEnter(function ({ code, type, payload, option }) {
            if (code === 'qrcode') {
                qrcodeIdentify(payload);
            }
        });

        utools.onPluginOut(function () {
            stopGlobalTimer();
            hideShortcutsPanel();
            selectedIndex = -1;
        });

        // ==================== 初始化 ====================
        loadConfig();

    });
})();
