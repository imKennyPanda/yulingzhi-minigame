# 玉灵之音 · 拼音闯关

H5 / PC 双端拼音练习游戏。

## 在线地址

- H5：<https://imkennypanda.github.io/yulingzhi-minigame/h5.html>
- PC：<https://imkennypanda.github.io/yulingzhi-minigame/pc.html>
- 付费弹窗预览：<https://imkennypanda.github.io/yulingzhi-minigame/h5.html?paywall=demo>

## 付费与激活流程

1. 用户免费试用 3 天。
2. 到期后弹窗，微信扫码支付 9.9 元，并在付款备注里填写手机号。
3. 卖家在微信账单里看到备注手机号后，手动用短信发送激活码。
4. 用户在弹窗输入激活码，本地校验通过后解锁。

页面是纯静态 GitHub Pages，没有后端；付款确认和短信发送目前都靠人工。

## 激活码机制

- 页面只保存 `SHA-256(激活码)` 和到期日，不保存明文。
- 输入时忽略大小写、空格和横杠：`ylz-8k3d...` 和 `YLZ8K3D...` 等价。
- 当前内置 **500 个正式码 + 3 个演示码**，到期日 `2099-12-31`。明文清单只保存在本地私密 TXT，不要写进仓库。
- 激活码可以被转发，前端只能做软校验；高价值场景需要后端。

## 新增激活码

### 批量生成（推荐）

```bash
node tools/gen-codes.js 2099-12-31 --count 20
```

终端会输出两段：

- **明文激活码**：复制到你自己的私密表格/备忘录，不要提交到 GitHub。
- **哈希行**：形如 `'69dc...': '2099-12-31',`，粘贴到 `h5.html` 和 `pc.html` 的 `PAY_CFG.codes` 里。两份都要改，并保持完全一致。

### 使用自己指定的码

```bash
node tools/gen-codes.js 2099-12-31 YLZ-XXXX-XXXX-XXXX YLZ-YYYY-YYYY-YYYY
```

### 发布

```bash
git add h5.html pc.html
git commit -m "新增激活码"
git push
```

等 GitHub Pages 部署完成后生效。

### 验证

打开：

`https://imkennypanda.github.io/yulingzhi-minigame/h5.html?paywall=demo`

输入新码，显示“激活成功，正在进入…”即成功。

## 到期日

- 永久畅玩：`2099-12-31`
- 限时码：填具体日期，当天 23:59:59 前有效
- 当前内置的 500 个正式码和 3 个演示码都是 `2099-12-31`

## 注意

- 仓库是公开的，**不要把明文激活码写进 README、HTML 注释或提交记录**。
- `PAY_CFG.codes` 里只放哈希行，不要带 `// 明文码` 注释。
- 两份 HTML 必须同步，否则手机和电脑的解锁结果可能不一致。
- 修改后没有在线后台，必须重新部署。
- 用户清缓存或换设备会重置试用；激活码本身可以重新输入。
