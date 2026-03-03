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
    var timerId = null;           // 定时器 ID
    var selectedIndex = -1;       // 当前选中的卡片索引
    var layerIndex = null;        // 当前弹窗索引

    // ==================== DOM 引用 ====================
    var view = document.getElementById('view');
    var shortcutsPanel = document.getElementById('shortcutsPanel');

    // ==================== DOM 缓存 ====================
    var domCache = {};            // DOM 元素缓存
    var settingsCache = {         // 设置状态缓存
        auto_close: false,
        msg_close: false
    };

    // ==================== Layui 模块初始化 ====================
    layui.use(['element', 'layer', 'util', 'form', 'laytpl'], function () {
        var element = layui.element;
        var layer = layui.layer;
        var util = layui.util;
        var laytpl = layui.laytpl;
        var form = layui.form;
        var $ = layui.$;

        // ==================== 拖拽排序 ====================
        var dragSrcEl = null;
        var draggedElement = null;

        function handleDragStart(e) {
            dragSrcEl = this;
            draggedElement = $(this);
            this.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', $(this).data('index'));
        }

        function handleDragEnd(e) {
            this.style.opacity = '1';
            $('.layui-card').removeClass('drag-over');
        }

        function handleDragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            return false;
        }

        function handleDragEnter(e) {
            e.preventDefault();
            $(this).addClass('drag-over');
        }

        function handleDragLeave(e) {
            $(this).removeClass('drag-over');
        }

        function handleDrop(e) {
            e.preventDefault();
            e.stopPropagation();

            $(this).removeClass('drag-over');

            if (dragSrcEl !== this) {
                var fromIndex = $(dragSrcEl).data('index');
                var toIndex = $(this).data('index');

                if (fromIndex !== undefined && toIndex !== undefined) {
                    // 重新排序 items 数组
                    var movedItem = items[fromIndex];
                    items.splice(fromIndex, 1);
                    items.splice(toIndex, 0, movedItem);

                    // 重新渲染以更新所有显示
                    clearTOTPCache();
                    render();
                    saveConfig(false);
                    layer.msg('排序已更新', { icon: 1, time: 1000 });
                }
            }

            return false;
        }

        // 绑定拖拽事件
        function bindDragEvents() {
            var cards = document.querySelectorAll('.layui-card');
            cards.forEach(function (card) {
                // 检查是否已经绑定过（避免重复绑定）
                if (card.hasAttribute('data-drag-bound')) {
                    return;
                }

                card.setAttribute('draggable', 'true');
                card.addEventListener('dragstart', handleDragStart, false);
                card.addEventListener('dragend', handleDragEnd, false);
                card.addEventListener('dragover', handleDragOver, false);
                card.addEventListener('dragenter', handleDragEnter, false);
                card.addEventListener('dragleave', handleDragLeave, false);
                card.addEventListener('drop', handleDrop, false);

                // 标记已绑定
                card.setAttribute('data-drag-bound', 'true');
            });
        }

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
            if (timerId) {
                clearInterval(timerId);
            }
            timerId = setInterval(updateAllTOTP, 500);
        }

        function stopGlobalTimer() {
            if (timerId) {
                clearInterval(timerId);
                timerId = null;
            }
        }

        function updateAllTOTP() {
            var nowtime = Math.ceil(Date.now() / 1000);
            var $cards = $('.layui-card');
            var cardCount = $cards.length;

            for (var i = 0; i < cardCount; i++) {
                var $card = $($cards[i]);
                var index = $card.data('index');

                if (index === undefined || !items[index]) continue;

                var item = items[index];
                var max = parseInt(item.max) || 30;
                var left_time = Math.ceil(max - nowtime % max);

                // 初始化缓存
                if (!domCache[index]) {
                    domCache[index] = {};
                }

                // 更新验证码 - 缓存DOM元素
                if (!domCache[index].$num) {
                    domCache[index].$num = $card.find('.num');
                }
                var totp = generateTOTP(item.password, max);
                domCache[index].$num.text(totp);

                // 更新进度条 - 添加变化检测（使用整数比较避免浮点精度问题）
                var progressValue = Math.floor(left_time / max * 100);
                var oldProgressValue = domCache[index].progressValue;

                if (oldProgressValue !== progressValue) {
                    element.progress('loading' + index, progressValue + '%');
                    domCache[index].progressValue = progressValue;
                }

                // 进度条颜色状态 - 缓存DOM元素和状态
                if (!domCache[index].$progressBar) {
                    domCache[index].$progressBar = $card.find('.layui-progress-bar');
                }
                var oldState = domCache[index].progressState || PROGRESS_STATE.NORMAL;
                var newState = left_time <= 5 ? PROGRESS_STATE.DANGER : (left_time <= 10 ? PROGRESS_STATE.WARNING : PROGRESS_STATE.NORMAL);

                if (oldState !== newState) {
                    domCache[index].$progressBar.removeClass(PROGRESS_STATE.WARNING + ' ' + PROGRESS_STATE.DANGER);
                    if (newState) {
                        domCache[index].$progressBar.addClass(newState);
                    }
                    domCache[index].progressState = newState;
                }
            }
        }

        // 清除 DOM 缓存
        function clearDOMCache() {
            domCache = {};
        }

        // 更新卡片显示（序号、快捷键提示、进度条filter）
        function updateCardsDisplay() {
            $('.layui-card').each(function (i) {
                var $card = $(this);
                $card.attr('data-index', i);
                // 更新序号
                $card.find('.card-index').text(i + 1);
                // 更新快捷键提示
                var $shortcutText = $card.find('.shortcut-text');
                if (i < 9) {
                    $shortcutText.text('Alt+' + (i + 1));
                    $shortcutText.show();
                } else {
                    $shortcutText.hide();
                }
                // 更新进度条的 lay-filter 和 data-id
                var $progress = $card.find('.layui-progress');
                var oldFilter = $progress.attr('lay-filter');
                if (oldFilter) {
                    $progress.attr('lay-filter', 'loading' + i);
                }
                $card.find('.layui-progress-bar').attr('data-id', i);
            });
        }

        // ==================== 渲染函数 ====================
        function render() {
            laytpl(getTpl).render(items, function (html) {
                view.innerHTML = html;
                startGlobalTimer();
                bindDragEvents();
                clearDOMCache();
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
                    saveConfig(false, true); // 跳过备份
                }
            }

            // 缓存设置状态
            settingsCache.auto_close = utools.dbStorage.getItem("auto_close") === "true";
            settingsCache.msg_close = utools.dbStorage.getItem("msg_close") === "true";

            form.val('set_box', {
                "auto_close": settingsCache.auto_close,
                "msg_close": settingsCache.msg_close
            });
        }

        function saveConfig(shouldRender, skipBackup) {
            if (shouldRender !== false) {
                shouldRender = true;
            }

            // 在保存前创建备份（除非跳过备份）
            if (skipBackup !== true) {
                createBackup();
            }

            var result = utools.db.put({
                _id: "config",
                data: JSON.stringify(items),
                _rev: config_rev
            });
            if (result) {
                config_rev = result._rev;
            }
            if (shouldRender) {
                clearDOMCache();
                render();
            }
        }

        // ==================== 通知处理 ====================
        function notice(num) {
            // 使用缓存的设置状态
            if (settingsCache.auto_close) {
                setTimeout(function () {
                    utools.hideMainWindow();
                }, 100);
            }
            if (settingsCache.msg_close) {
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
                !$(e.target).closest('.help-btn').length) {
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
                    result.name = decodeURIComponent(nameMatch[1]);
                }
            }

            return result;
        }

        // 复用的隐藏元素用于 HTML 转义
        var escapeEl = document.createElement('div');
        escapeEl.style.display = 'none';

        function escapeHtml(text) {
            escapeEl.textContent = text;
            return escapeEl.innerHTML;
        }

        // 空函数 - 左侧导航已移除，保留函数以避免调用报错
        function resetNavSelection() {
            // No-op: 左侧导航已移除
        }

        // ==================== 常量定义 ====================
        // 进度条状态常量
        var PROGRESS_STATE = {
            NORMAL: '',
            WARNING: 'warning',
            DANGER: 'danger'
        };

        // 日期格式常量
        var DATE_FORMAT = {
            YMD: 'ymd',
            YMD_HMS: 'ymd_hms',
            YMD_HMS_COLON: 'ymd_hms_colon'
        };

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

                // 使用 Set 进行 O(1) 查找优化去重
                var existingKeys = new Set();
                items.forEach(function (item) {
                    existingKeys.add(item.name + '|' + item.password);
                });

                var newCount = 0;
                import_items.forEach(function (v) {
                    if (!v.password) return;
                    var key = v.name + '|' + v.password;
                    if (!existingKeys.has(key)) {
                        items.push(v);
                        existingKeys.add(key);
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
            return formatDateTime(date, DATE_FORMAT.YMD);
        }

        // 日期时间格式化辅助函数
        function pad2(value) {
            return String(value).padStart(2, '0');
        }

        function formatDateTime(date, format) {
            var y = date.getFullYear();
            var m = pad2(date.getMonth() + 1);
            var d = pad2(date.getDate());
            var hh = pad2(date.getHours());
            var mm = pad2(date.getMinutes());
            var ss = pad2(date.getSeconds());

            if (format === DATE_FORMAT.YMD) {
                return y + m + d;
            } else if (format === DATE_FORMAT.YMD_HMS) {
                return y + m + d + '_' + hh + mm + ss;
            } else if (format === DATE_FORMAT.YMD_HMS_COLON) {
                return y + '-' + m + '-' + d + ' ' + hh + ':' + mm + ':' + ss;
            }
        }

        // ==================== 自动备份 ====================

        // 格式化备份时间显示
        function formatBackupTime(isoString) {
            return formatDateTime(new Date(isoString), DATE_FORMAT.YMD_HMS_COLON);
        }

        // 创建备份
        function createBackup() {
            // 没有数据时不创建备份
            if (items.length === 0) return;

            try {
                // 只创建一次 Date 对象并复用
                var now = new Date();
                var backupTime = now.toISOString();
                var backupId = 'backup_' + formatDateTime(now, DATE_FORMAT.YMD_HMS);

                // 备份数据
                var backupData = {
                    version: '1.0',
                    backupTime: backupTime,
                    items: JSON.parse(JSON.stringify(items)) // 深拷贝
                };

                // 保存备份数据
                utools.dbStorage.setItem(backupId, JSON.stringify(backupData));

                // 更新备份列表
                var backupList = getBackupList();
                backupList.push({
                    id: backupId,
                    time: backupTime,
                    timestamp: now.getTime(),
                    count: items.length
                });

                // 按时间排序（新的在前）- 使用缓存的时间戳
                backupList.sort(function (a, b) {
                    return (b.timestamp || 0) - (a.timestamp || 0);
                });

                // 保存备份列表
                utools.dbStorage.setItem('backup_list', JSON.stringify(backupList));

                // 清理旧备份（保留最新5个）
                cleanupOldBackups(backupList);
            } catch (e) {
                console.error('创建备份失败:', e);
            }
        }

        // 获取备份列表
        function getBackupList() {
            try {
                var listStr = utools.dbStorage.getItem('backup_list');
                if (listStr) {
                    return JSON.parse(listStr);
                }
            } catch (e) {
                console.error('获取备份列表失败:', e);
            }
            return [];
        }

        // 获取单个备份数据
        function getBackupData(backupId) {
            try {
                var dataStr = utools.dbStorage.getItem(backupId);
                if (dataStr) {
                    return JSON.parse(dataStr);
                }
            } catch (e) {
                console.error('获取备份数据失败:', e);
            }
            return null;
        }

        // 删除备份
        function deleteBackup(backupId) {
            try {
                // 删除备份数据
                utools.dbStorage.removeItem(backupId);

                // 从列表移除
                var backupList = getBackupList();
                backupList = backupList.filter(function (b) {
                    return b.id !== backupId;
                });

                // 保存更新后的列表
                utools.dbStorage.setItem('backup_list', JSON.stringify(backupList));

                return true;
            } catch (e) {
                console.error('删除备份失败:', e);
                return false;
            }
        }

        // 恢复备份
        function restoreBackup(backupId) {
            try {
                var backupData = getBackupData(backupId);
                if (!backupData || !backupData.items) {
                    layer.alert('备份数据损坏或不存在', { title: '恢复失败', icon: 2 });
                    return false;
                }

                // 确认对话框
                layer.confirm(
                    '确认从备份恢复？<br><br>' +
                    '<span style="color:#666;">备份时间: ' + formatBackupTime(backupData.backupTime) + '</span><br>' +
                    '<span style="color:#666;">包含项目: ' + backupData.items.length + ' 个</span><br><br>' +
                    '<span style="color:#FF5722;">⚠ 此操作将覆盖当前配置</span>',
                    { title: '确认恢复', icon: 3 },
                    function (i) {
                        // 关闭所有弹窗
                        layer.closeAll();

                        // 恢复数据
                        items = backupData.items;
                        clearTOTPCache();
                        stopGlobalTimer(); // 先停止定时器
                        clearDOMCache();
                        saveConfig(false, true); // 跳过备份，避免循环

                        // 重新渲染
                        laytpl(getTpl).render(items, function (html) {
                            view.innerHTML = html;
                            startGlobalTimer();
                            bindDragEvents();
                            clearDOMCache();
                        });

                        layer.msg('✓ 已恢复备份', { icon: 1 });
                    }
                );

                return true;
            } catch (e) {
                console.error('恢复备份失败:', e);
                layer.alert('恢复失败: ' + e.message, { title: '错误', icon: 2 });
                return false;
            }
        }

        // 清理旧备份
        function cleanupOldBackups(backupList) {
            if (!backupList) {
                backupList = getBackupList();
            }

            // 保留最新5个
            if (backupList.length > 5) {
                var toDelete = backupList.slice(5);
                toDelete.forEach(function (backup) {
                    utools.dbStorage.removeItem(backup.id);
                });

                // 更新列表
                var keepList = backupList.slice(0, 5);
                utools.dbStorage.setItem('backup_list', JSON.stringify(keepList));
            }
        }

        // 显示备份管理弹窗
        function showBackupManager() {
            refreshBackupList();

            // 显示弹窗
            layerIndex = layer.open({
                type: 1,
                closeBtn: 1,
                anim: 2,
                title: '📦 备份管理',
                shadeClose: true,
                area: ['450px'],
                content: $('.backup_box')
            });
        }

        // 刷新备份列表（不重新打开弹窗）
        function refreshBackupList() {
            var backupList = getBackupList();
            var $list = $('#backupList');
            var $count = $('#backupCount');

            // 更新计数
            $count.text('共 ' + backupList.length + ' 个备份');

            // 渲染列表
            if (backupList.length === 0) {
                $list.html('<div class="backup-empty"><i class="layui-icon">&#xe658;</i><p>暂无备份记录</p></div>');
            } else {
                // 使用数组收集HTML片段，提高效率
                var htmlParts = [];
                backupList.forEach(function (backup, index) {
                    var isLatest = index === 0;
                    var timeStr = formatBackupTime(backup.time);
                    var itemText = backup.count + ' 个项目';
                    var currentClass = isLatest ? ' backup-current' : '';

                    htmlParts.push(
                        '<div class="backup-item' + currentClass + '">',
                        '<div class="backup-item-info">',
                        '<div class="backup-item-time">' + timeStr + '</div>',
                        '<div class="backup-item-meta">' + itemText + '</div>',
                        '</div>',
                        '<div class="backup-item-actions">',
                        '<button type="button" class="layui-btn layui-btn-xs layui-btn-normal restore-backup-btn" data-id="' + backup.id + '">恢复</button>',
                        '<button type="button" class="layui-btn layui-btn-xs layui-btn-warm export-backup-btn" data-id="' + backup.id + '">导出</button>',
                        '<button type="button" class="layui-btn layui-btn-xs layui-btn-danger delete-backup-btn" data-id="' + backup.id + '">删除</button>',
                        '</div>',
                        '</div>'
                    );
                });
                $list.html(htmlParts.join(''));
            }
        }

        // 导出单个备份
        function exportSingleBackup(backupId) {
            var backupData = getBackupData(backupId);
            if (!backupData) {
                layer.msg('备份数据不存在', { icon: 2 });
                return;
            }

            var timeStr = formatBackupTime(backupData.backupTime).replace(/[:\s]/g, '');
            var filepath = utools.showSaveDialog({
                title: "导出备份",
                defaultPath: utools.getPath("downloads") + '/googleAuth-backup-' + timeStr + '.json',
                buttonLabel: "导出",
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });

            if (filepath) {
                var exportData = {
                    version: '1.0',
                    backupTime: backupData.backupTime,
                    count: backupData.items.length,
                    items: backupData.items
                };
                var err = window.writeFile(filepath, JSON.stringify(exportData, null, 2));
                if (err) {
                    layer.alert("导出失败: " + err.message, { title: "错误", icon: 2 });
                } else {
                    layer.msg("✓ 导出成功", { icon: 1 });
                }
            }
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
                items.splice(index, 1);
                clearTOTPCache();
                clearDOMCache();
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
            var $card = $(this).closest('.layui-card');
            var num = $card.find('.num').text();
            if (num && num !== 'ERROR') {
                utools.copyText(num);
                notice(num);
            }
        });

        // 删除
        $(document).on('click', '.del-btn', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var index = $(this).closest('.layui-card').data('index');
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
                var index = $(this).closest('.layui-card').data('index');
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
            // 更新缓存
            settingsCache.auto_close = data.field.auto_close;
            settingsCache.msg_close = data.field.msg_close;
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

        // 备份管理菜单
        $(".backup-btn").click(function (e) {
            e.preventDefault();
            showBackupManager();
        });

        // 快捷键帮助按钮
        $(".help-btn").click(function (e) {
            e.preventDefault();
            e.stopPropagation();
            toggleShortcutsPanel();
        });

        // 备份管理中的导出当前数据按钮
        $("#backupExportBtn").click(function (e) {
            e.preventDefault();
            exportData();
        });

        // 备份管理中的导入按钮
        $("#backupImportBtn").click(function (e) {
            e.preventDefault();
            importData();
        });

        // 恢复备份事件（委托）
        $(document).on('click', '.restore-backup-btn', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var backupId = $(this).data('id');
            restoreBackup(backupId);
        });

        // 导出单个备份事件（委托）
        $(document).on('click', '.export-backup-btn', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var backupId = $(this).data('id');
            exportSingleBackup(backupId);
        });

        // 删除备份事件（委托）
        $(document).on('click', '.delete-backup-btn', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var backupId = $(this).data('id');
            layer.confirm('确认删除此备份？', { title: '确认删除', icon: 3 }, function (i) {
                layer.close(i); // 先关闭确认对话框
                if (deleteBackup(backupId)) {
                    layer.msg('✓ 已删除备份', { icon: 1 });
                    // 重新渲染备份列表（不重新打开弹窗）
                    refreshBackupList();
                } else {
                    layer.msg('删除失败', { icon: 2 });
                }
            });
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
            } else {
                // 重新启动定时器（从后台恢复时）
                startGlobalTimer();
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
