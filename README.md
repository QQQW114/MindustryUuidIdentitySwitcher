# Mindustry UUID Identity Switcher

用于测试服务器权限系统的 Mindustry 客户端 mod。

特点：

- 支持保存多个身份档案。
- 首次加载会保存安装前的原始 UUID；切回“无默认身份/未绑定服务器”时会尽量还原原始 UUID/USID。
- 每个身份包含：
  - 客户端本地 UUID（8 字节 Base64）
  - USID（按服务器使用的 8 字节 Base64）
  - 服务器地址绑定
- 连接服务器前自动按服务器地址切换 UUID/USID；MindustryX B464 这类新版优先使用 `ClientServerConnectEvent`，并保留连接包 Hook 作为桌面端兜底。
- 支持手动编辑、随机生成、从当前设置创建身份。

## 安装

把整个 `MindustryUuidIdentitySwitcher` 文件夹复制到 Mindustry 的 `mods` 目录，或把本目录打包成 zip 后导入游戏。

本项目自带 `pack.ps1`：

```powershell
.\pack.ps1
```

会生成：

```text
dist/uuid-identity-switcher.zip
dist/uuid-identity-switcher-android.zip
dist/uuid-identity-switcher-android-visible.zip
```

包说明：

- `uuid-identity-switcher.zip`：默认隐藏版，适合桌面端；不会加入连接时的 mod 列表。
- `uuid-identity-switcher-android.zip`：安卓/MindustryX 兼容版。元数据里先设为可见，避免部分安卓构建漏加载隐藏脚本；脚本启动后会把自己重新标记为隐藏，尽量不进入服务器 mod 列表。
- `uuid-identity-switcher-android-visible.zip`：诊断版，始终可见。只用于确认安卓是否正确导入/启用 mod；连接普通服务器时可能因多余 mod 被拒。

## 使用

进入游戏后打开：

```text
设置 -> UUID Identity
```

然后点击“打开身份管理器”。

安卓 / MindustryX 说明：MindustryX 会提前构建设置菜单，旧版脚本注册的分类可能已经加入但不显示；0.2.1 起会强制刷新设置菜单，并且分类页只放一个轻量的“打开身份管理器”入口。如果安卓导入隐藏版后仍看不到，请改用 `dist/uuid-identity-switcher-android.zip`。如果还是看不到，再用 `dist/uuid-identity-switcher-android-visible.zip` 诊断：若诊断版也不在 Mods 列表中，说明包没有被正确导入/启用；若在列表中但无设置入口，说明脚本加载报错，需要查看安卓 `last_log.txt`。

常用流程：

1. 点击“新增随机身份”。
2. 编辑身份名称。
3. 如果想全局使用它，点击“保存并设为默认”或列表里的“应用为默认”。仅“新增随机身份”不会再自动覆盖当前默认身份。
4. 如果想只对某个服务器使用它，点击该身份的“绑定服务器”。
5. 输入服务器地址，例如：
   - `127.0.0.1:6567`
   - `example.com:6567`
6. 之后连接该服务器时，mod 会自动写入对应的 `uuid` 和 `usid-*`。

如果没有服务器绑定，但设置了默认身份，则会使用默认身份。

如果想回到安装 mod 前的本机身份，点击管理器底部的“清除默认并还原”。调试日志默认关闭；需要排查时可在管理器里临时打开“调试日志”。

## 注意

- 修改身份只对“下一次连接”生效，已经进入服务器后不会改变当前连接身份。
- Steam 身份不做适配。
- 原始 USID 是按服务器地址保存的；mod 会在覆盖某个服务器 USID 前先备份已存在的 `usid-地址`。如果旧版本已经覆盖过某个地址且没有备份，无法自动恢复被覆盖前的值，只能让游戏重新生成或手动填写。
- `uuid` 输入支持这些格式：
  - 客户端本地 UUID：8 字节 Base64；
  - 服务端显示 UUID：16 字节 Base64；保存时会自动取前 8 字节转为客户端本地 UUID。
  - ScriptAgent4MindustryExt 服务器短 ID：例如 `6s2`、`5pa`、`Ohk`，保存或点击“ScriptAgent短ID转UUID”时会按插件算法搜索一个对应的完整 UUID。
- `usid` 建议使用随机生成的 8 字节 Base64。

ScriptAgent4MindustryExt 的三位 ID 逻辑在 `scripts/wayzer/user/shortID.kts`，注意它对服务端 `player.uuid()` 计算，而不是客户端 settings 里的 8 字节 UUID：

```kotlin
shortID = Base64(md5(md5(uuidBytes) + uuidBytes))[0..2]
```

并把 `k/S/l/+//` 分别替换为 `K/s/L/A/B`。因此这个三位 ID 不是 UUID 的 Base64 前缀，而是 UUID 的哈希结果。想指定 `6s2` 这种短 ID，只能随机搜索一个满足该哈希结果的 UUID，平均约需 262144 次尝试。
