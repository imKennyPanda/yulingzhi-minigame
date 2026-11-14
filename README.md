# 玉灵之音 · 拼音闯关

H5 / PC 双端拼音练习游戏。

## 在线地址

- H5：<https://imkennypanda.github.io/yulingzhi-minigame/h5.html>
- PC：<https://imkennypanda.github.io/yulingzhi-minigame/pc.html>
- 付费弹窗预览：<https://imkennypanda.github.io/yulingzhi-minigame/h5.html?paywall=demo>
- 激活码管理：<https://imkennypanda.github.io/yulingzhi-minigame/admin.html>
- 数据看板：<https://imkennypanda.github.io/yulingzhi-minigame/dashboard.html>

## 付费与激活流程

1. 新用户免费试用 **1 天**（服务端按 IP + UA 记录首次访问，改本地时间/清缓存无效）。
2. 到期后弹窗，微信扫码支付 9.9 元，加客服微信领取激活码。
3. 客服在管理后台生成激活码并发送给用户。
4. 用户在弹窗输入激活码，云端校验通过后解锁。

## 激活码机制

- 校验与设备绑定全部在腾讯云 CloudBase 云函数完成，仓库和页面里没有任何明文码或哈希码表。
- 正式码为 **8 位**（两组 4 位，如 `AB12-CD34`），输入时忽略大小写、空格和横杠。
- **一个激活码最多绑定 3 台设备**（手机 H5 / 平板 / 电脑通用），设备数可在管理后台查看。
- 超过设备上限或换设备时，让客服在 admin.html 里解绑旧设备（可单台解绑或全部解绑）。
- 到期日可为 `2099-12-31`（永久）或具体日期，当天 23:59:59 前有效。
- 部署、生成、解绑、统计等完整操作见 [docs/cloudbase.md](docs/cloudbase.md)。

## 素材与许可

- 音标真人录音：`audio/ipa/`，来源、处理方式和音标对应表见 [audio/ipa/README.md](audio/ipa/README.md)（CC BY-SA 4.0）。
- 音标表与音标游戏共用同一套录音文件，发音一致。

## 注意

- 仓库是公开的，**不要把明文激活码、管理口令写进 README、HTML 或提交记录**。
- H5 和 PC 必须同步修改，否则手机和电脑的行为可能不一致。
- 页面改动推送到 `main` 后等 GitHub Pages 部署；云函数改动需要重新 `cloudbase fn deploy`。
