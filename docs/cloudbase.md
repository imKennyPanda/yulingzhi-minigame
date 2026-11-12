# 玉灵之音 · CloudBase 后端说明

H5 / PC 的激活码校验与 3 天试用判定已改为腾讯云 CloudBase（环境 `yulingzhi-prime`，ID `yulingzhi-prime-d3fjr5nn208b4464`）。

## 结构

```text
cloudbaserc.json                 CloudBase CLI 配置（envId + 两个云函数）
cloudfunctions/ylz-api/          Web 函数（HTTP 访问）：activate / verify；scf_bootstrap 启动
cloudfunctions/ylz-admin/        Event 云函数：gen / import / list / revoke / unbind / rebind / stats / del
tools/cloudbase-admin.js         本地管理脚本（封装 cloudbase fn invoke）
```

> 当前环境是 PostgreSQL 版新环境，需先启用 `pgdoc` 插件，`@cloudbase/node-sdk` 的 `app.database()`
> 才能按文档型数据库的方式读写。已通过下面这条命令开通（返回 `"Enabled": true` 即成功）：
>
> ```bash
> cloudbase api tcb EnablePGDocumentExt \
>   --body '{"EnvId":"yulingzhi-prime-d3fjr5nn208b4464"}' \
>   --api-version 2018-06-08 --json
> ```

云数据库集合（云函数首次调用时自动创建）：

| 集合 | `_id` | 用途 |
|---|---|---|
| `activation_codes` | 规范化激活码（如 `AB12CD34`） | status: unused / used / revoked、expireAt、deviceId、usedAt、note、batch |
| `devices` | 设备 ID | 该设备当前激活的码、到期时间 |
| `trial_fingerprints` | sha256(IP + UA) | 首次访问时间，服务端据此计算 3 天试用，清缓存/改本地时间无效 |

> 三个集合都不要开放给客户端直连。云函数使用管理权限读写；在控制台把集合权限设为「所有用户不可读写」即可。

## 一次性部署

```bash
cloudbase login                    # 扫码 / 浏览器授权
# 启用 pgdoc（仅首次；PostgreSQL 版环境必需）
cloudbase api tcb EnablePGDocumentExt --body '{"EnvId":"yulingzhi-prime-d3fjr5nn208b4464"}' --api-version 2018-06-08 --json
# ylz-api 是 Web 函数：--httpFn 会生成 scf_bootstrap 并自动挂 /ylz 路由
MSYS_NO_PATHCONV=1 cloudbase fn deploy ylz-api --httpFn --path /ylz --install-dependency true
cloudbase fn deploy ylz-admin --force --install-dependency true
cloudbase routes list -e yulingzhi-prime-d3fjr5nn208b4464   # 确认域名与 /ylz 路由
```

> Git Bash 会把 `/ylz` 转成 Windows 路径，必须加 `MSYS_NO_PATHCONV=1`。
> 重复部署已存在的函数时要加 `--force`，否则会停在覆盖确认提示。
> 系统默认域名不允许手工 `routes add`，只能通过 `fn deploy --httpFn --path /ylz` 自动挂载。
> 体验版套餐不支持 `cloudbase cors add`（报「当前套餐无法执行此操作」）；实测该路由无需安全域名配置，
> 跨域由云函数自己返回的 CORS 头处理。

已部署的访问地址（`h5.html` / `pc.html` 的 `PAY_CFG.apiBase` 与此一致）：

```text
https://yulingzhi-prime-d3fjr5nn208b4464-1259601048.ap-shanghai.app.tcloudbase.com/ylz
```

## 导入已有激活码（503 个，含 3 个演示码）

明文清单在仓库外：`../private/yulingzhi-activation-codes-500-2026-11-11.txt`。

```bash
node tools/cloudbase-admin.js import ../private/yulingzhi-activation-codes-500-2026-11-11.txt \
  --expire 2099-12-31 --batch 2026-11
```

脚本按每批 100 个调用 `ylz-admin`，已存在的码自动跳过，可重复执行。

## 日常操作

```bash
# 生成新的一批（明文只返回这一次，脚本会写到 ../private/激活码-日期.txt）
node tools/cloudbase-admin.js gen 100 --expire 2099-12-31 --note "第三批" --out ../private/激活码-第三批.txt

# 统计 / 查询
node tools/cloudbase-admin.js stats
node tools/cloudbase-admin.js list --status used --limit 20
node tools/cloudbase-admin.js list --code AB12-CD34

# 用户换设备：先解绑，再让用户在新设备输入同一个码
node tools/cloudbase-admin.js unbind AB12-CD34
# 或者直接把码绑到指定设备
node tools/cloudbase-admin.js rebind AB12-CD34 <deviceId>

# 作废（退款/异常）
node tools/cloudbase-admin.js revoke AB12-CD34

# 彻底删除一条记录（清理测试码/误导入）
node tools/cloudbase-admin.js del AB12-CD34
```

`deviceId` 可在用户浏览器的 `localStorage['ylz.device.v1']` 或 Cookie `ylz_device` 里看到，也可让用户在客服窗口读取。

## 客户端逻辑

- 首次打开：生成/读取 `deviceId`，向 `/ylz` 发送 `{action:'verify'}`；服务端返回试用到期时间与激活状态。
- 激活：`{action:'activate', code}`；成功即把码绑定到当前 `deviceId`，同一码换设备会提示联系客服。
- 页面每 10 分钟、每次切回前台都会重新向服务端核对；断网时先用本地缓存显示，联网后以服务端为准。
- 本地不再保存任何激活码哈希，源码里没有可被绕过的码表。

## 安全与限制

- 激活码明文只存在云数据库（管理端）和你的本地 TXT；仓库、GitHub Pages 中没有任何明文或哈希码表。
- 试用按「IP + 浏览器 UA」记录。换网络/换浏览器可能重新获得试用，这是无账号体系下的取舍；如需更严，可改为微信登录后再判定。
- 若需临时关闭云端校验，把 `PAY_CFG.apiBase` 置空即可回退为纯本地试用估算（但就没有一码一用能力了）。
