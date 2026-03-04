# Google 身份验证器 - uTools 插件

一个简洁美观的 Google Authenticator（谷歌动态口令）uTools 插件，支持双重验证（2FA）、TOTP 动态验证码生成。

## 功能特性

- 🔐 **TOTP 验证码** - 支持基于时间的一次性密码生成
- 📷 **二维码识别** - 直接扫描屏幕二维码添加账号
- 🔑 **手动添加** - 支持手动输入密钥（Secret）
- 🔄 **拖拽排序** - 拖动卡片自由调整顺序
- 💾 **备份管理** - 导入/导出数据，支持多版本备份
- ⌨️ **快捷键** - Alt+数字快速复制验证码
- 🎨 **精美界面** - Mac Dock 风格操作栏，流畅动画效果

## 安装

在 uTools 插件市场搜索 `googleAuth` 或 `Google身份验证器` 安装。
[链接](https://u.tools/plugins/detail/Google%E4%BA%8C%E6%AC%A1%E8%BA%AB%E4%BB%BD%E9%AA%8C%E8%AF%81%E5%99%A8/?c=dhknilkfxl)

## 使用方法

### 添加账号

1. **二维码识别**：点击底部放大镜按钮，框选屏幕上的二维码
2. **手动添加**：点击底部 ➕ 按钮，输入账号名称和密钥

### 复制验证码

- 点击验证码数字直接复制
- 使用快捷键 `Alt + 1~9` 快速复制对应位置的验证码
- 点击复制按钮复制

### 其他操作

| 操作 | 方法 |
|------|------|
| 编辑账号 | 点击编辑按钮或选中后按 `Enter` |
| 删除账号 | 点击删除按钮或选中后按 `Delete` |
| 调整顺序 | 拖拽卡片到目标位置 |
| 查看快捷键 | 点击底部 `?` 按钮或按 `?` 键 |
| 打开设置 | 点击底部设置按钮或按 `S` |
| 备份管理 | 点击底部备份按钮 |

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt + 1~9` | 复制第 N 个验证码 |
| `A` | 添加密钥 |
| `Q` | 识别二维码 |
| `S` | 打开设置 |
| `?` | 显示/隐藏快捷键帮助 |
| `Esc` | 关闭弹窗 |
| `Enter` | 编辑选中的账号 |
| `Delete` | 删除选中的账号 |

## 设置选项

- **自动隐藏**：复制验证码后自动隐藏主窗口
- **复制通知**：复制成功后显示系统通知

## 支持的二维码格式

```
otpauth://totp/账号名称?secret=XXXXXXXX&issuer=服务名
```

兼容 Google Authenticator、Microsoft Authenticator、Authy 等应用导出的数据。

## 截图

![主界面](https://raw.githubusercontent.com/crazykun/utools-googleAuth/main/img/screenshot.png)
![备份管理](https://raw.githubusercontent.com/crazykun/utools-googleAuth/main/img/screenshot-backup.png)
![添加密钥](https://raw.githubusercontent.com/crazykun/utools-googleAuth/main/img/screenshot-key.png)
![设置](https://raw.githubusercontent.com/crazykun/utools-googleAuth/main/img/screenshot-set.png)

## 应用场景

可用于以下网站/服务的双重验证：

- GitHub
- Google
- Microsoft
- Facebook
- JumpServer
- 以及所有支持 TOTP 的服务

## 相关版本

- [uTools 版本](https://github.com/crazykun/utools-googleAuth)（本仓库）
- [Golang 命令行版本](https://github.com/crazykun/googleAuth)

## License

[MIT](LICENSE.md)