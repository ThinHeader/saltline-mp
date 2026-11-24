# Saltline

从 [原始 Claude Artifact](https://claude.ai/artifact/BGY1SztrAYcJQHSsnHHGmp) 恢复的完整可运行版本，保留原游戏画面、关卡、敌人、武器、音效、操作和菜单；在此基础上新增了**局域网房间制 PvP 死斗**（4 位房间码、2–8 人、15 杀获胜）。

## 在线试玩

**[打开 Saltline](https://thinheader.github.io/saltline-mp/)**，点击 **Deploy** 开始游戏。

> 线上版本由 GitHub Pages 托管，只有静态资源，**只能玩单人战役**。多人联机需要房间服务器，见下方[局域网对战](#局域网对战多人模式)。

## 玩法说明

### 单人战役（Deploy）

你是一名被派往雨夜港口的清场人员，任务是在敌人增援赶到前切断全部通讯中继，然后从码头撤离。

1. 场上有 **3 个中继**（Yard / Shed / Quay），走到附近按住 `E` 约 2.4 秒逐个切断，松手进度会回退
2. 每切断一个中继会触发一波增援；三个全部切断后，敌人会持续追加追击单位
3. 三个中继全部断开后，跑到地图南端码头登船撤离，任务完成
4. 中途死亡只能点 **Retry** 整局重来

**敌人**：`Gull` 是飞行无人机（45 血，三连发能量弹，死亡会爆炸），`Hound` 是四足步行机（140 血，近身会猛扑）。打头部/摄像头这类弱点部位伤害约 ×2.2。它们有视野锥和听觉，会巡逻、调查、交火并呼叫同伴。

**补给与生命**：只有一把 `PAC-9 Longshore`，30 发弹匣 / 150 发备弹，没有武器切换和拾取补给。100 血无护盾，脱离战斗 4 秒后按 25/秒回复。

**结算**：按用时、命中率、是否重试评定 6 档等级（Messy → Surgical）。

### 局域网对战（Multiplayer）

2–8 人在同一个局域网里用浏览器开房间对枪，**先拿到 15 杀获胜**。

1. 一台机器运行 `npm run lan`，终端会打印本机局域网 IP
2. 所有人打开 `http://<主机IP>:8080`
3. 房主：标题屏点 **Multiplayer** → 填昵称 → **Host a room**，得到 4 位房间码
4. 其他人：**Multiplayer** → 填昵称 + 房间码 → **Join room**
5. 人数 ≥ 2 后房主点 **Start match (n)**，3 秒倒计时进图
6. 死亡 3 秒后自动重生，出生有 2 秒无敌；右上角比分板实时显示 K/D
7. 对局结束后房主回大厅再开一局

**注意**：房间码是 4 位（字母 + 数字），地图种子由服务端统一下发，所以各端地图完全一致；房主掉线后房主身份会自动转移；没有断线重连。

## 游戏截图

![Saltline 港口战斗场景](docs/screenshots/saltline-harbor.png)

![Saltline 仓库内换弹动作](docs/screenshots/saltline-reload.png)

![Saltline 港口交火场景](docs/screenshots/saltline-combat.png)

![局域网对战大厅](docs/mp-room-check.png)

## 本地开发

需要 Node.js 20.19+ 或 22.12+。推荐使用当前 LTS 和 Chrome/Edge 等支持 WebGL 2 的浏览器。

```sh
git clone https://github.com/ThinHeader/saltline-mp.git
cd saltline-mp
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173/>，点击 **Deploy** 开始。修改脚本或样式后浏览器会重新加载，当前局会重置。

依赖已经安装时，直接执行 `npm run dev`。游戏、Three.js 和全部字体均在本地，运行期间不需要 Claude、Google Fonts 或其他在线服务，也不需要 API Key。

## 构建和预览

```sh
npm run check
npm run build
npm run preview
```

构建结果在 `dist/`，预览地址是 <http://127.0.0.1:4173/>。可将 `dist/` 放到任意静态 HTTP 服务；应通过 HTTP 打开，以便脚本模块和浏览器输入正常工作。

## 局域网对战（多人模式）

推荐用一条命令同时起静态站和房间服务器（单端口 8080，前端与 WebSocket 共用）：

```sh
npm run lan
```

然后所有人访问 `http://<主机局域网IP>:8080`，终端启动时会打印该地址。Windows 首次运行如弹出防火墙提示，请允许 Node 通过**专用网络**，否则同网段其他设备连不上。

开发模式下也可分开跑：

```sh
npm run dev   # 前端 5173
npm run mp    # 房间服务器 8765
```

此时前端会去连 `ws://<当前页面主机>:8765`。房间服务器是纯 Node + `ws` 的中继，只负责房间成员、比分和胜负；移动、射击、命中判定都在各自客户端完成。

## GitHub Pages 部署

仓库已启用 GitHub Pages，发布来源为 **GitHub Actions**。[部署工作流](https://github.com/ThinHeader/saltline-mp/actions/workflows/pages.yml) 在推送到 `main` 时自动运行，也可通过 **Run workflow** 手动触发。工作流检查 Pages 配置，执行 `npm ci`、`npm run check` 和 `npm run build`，然后发布 `dist/`，线上地址为 <https://thinheader.github.io/saltline-mp/>。

**Pages 只能托管静态文件，不提供 WebSocket 房间服务器**，所以线上链接只能玩单人战役。想在公网联机需要把 `server/standalone.mjs` 单独部署到能跑 Node 的平台（Render、Fly.io、Railway 等）。

在其他仓库使用这套工作流时，需要先到 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，否则部署接口会返回 404。

## 继续修改

| 文件 | 内容 |
| --- | --- |
| `index.html` | 页面入口、画布、启动界面 |
| `src/game.js` | 6 行启动入口，安装道具注册表和错误捕获后启动游戏 |
| `src/app/` | 系统装配、主循环、启动界面、诊断和基准模式 |
| `src/vendor/three-r180.js` | 独立保存的原版 Three.js r180，提供标准命名的导出 |
| `src/core/` | 世界/画质配置、事件、随机数、数学、通用几何和降级实现 |
| `src/render/` | 渲染器、天空、阴影、后处理、材质、纹理和着色器 |
| `src/world/` | 碰撞、道具注册与建模、关卡、远景、地面和水面 |
| `src/input/`、`src/player/`、`src/combat/` | 输入、玩家和战斗判定 |
| `src/weapons/`、`src/enemies/` | 武器/敌人的模型、动画和行为 |
| `src/audio/`、`src/effects/` | 声音合成、音库、混音、粒子和特效 |
| `src/ui/`、`src/game/` | HUD、菜单、设置和任务流程 |
| `src/net/` | 多人模式：房间大厅与比分板、WebSocket 客户端、远程玩家模型 |
| `server/` | 房间服务器（`rooms.mjs` 协议与计分）、单端口静态 + WebSocket 服务（`standalone.mjs`） |
| `src/ui.css` | 原版 HUD、菜单、移动端布局和动效 |
| `src/fonts.css`、`public/fonts/` | 原版三组字体的本地副本 |
| `vite.config.js` | 开发服务器、构建和 source map 配置 |
| `archive/original.html` | 与原站发布清单逐字节校验一致的原始单文件 |
| `archive/manifest.json` | 来源、发布版本、原始大小与 SHA-256 |
| `docs/DEVELOPMENT.md` | 游戏代码定位和诊断入口 |
| `docs/VALIDATION.md` | 本次恢复的验收结果 |
| `docs/REFACTOR_VALIDATION.md` | 模块拆分的代码、场景、截图与操作回归记录 |
| `licenses/` | Three.js 与字体的许可文本 |

**源码边界：**公开链接只提供一个已打包的 `index.html`，没有发布前的多文件源码、原始变量名或 source map。本地在恢复完整产物后，将它重新组织为 66 个 ES 模块，并为引擎导入、主要工厂函数和上下文参数补充了可读名称。复杂算法内部仍有原版压缩过的局部变量名。模块边界是本地重建的，构建生成的 source map 对应当前本地文件。

## 操作

| 动作 | 按键 |
| --- | --- |
| 移动 / 视角 | WASD / 鼠标 |
| 开火 / 瞄准 | 鼠标左键 / 右键 |
| 换弹 / 近战 | R / F（或 V、鼠标中键，单人与多人通用） |
| 跳跃 / 冲刺 | Space / Shift |
| 蹲下 | C 或 Ctrl |
| 切断中继 | 在中继附近按住 E（仅单人模式） |
| 暂停 | Esc 或 P（多人对局中右上角常显比分板与击杀信息） |

浏览器无法锁定鼠标时，原版也支持按住鼠标拖动视角，或方向键 / IJKL 转向、Enter 开火。触屏和手柄支持沿用原版，具体布局在 **CONTROLS** 中查看。

设置保存在当前浏览器的 `localStorage`（`saltline.settings.v1`）。本地地址与原站的浏览器存储相互独立。

## 原件校验

恢复日期：2026-11-10；公开版本：`1794242702-61c7`。

```sh
npm run verify:archive
```

原件大小为 1,423,413 字节，SHA-256：

```text
f7081ef7b2fde5880e3c58184c720b2aa3b9115efe58ff71b48f6820d4f16f90
```

原件保留原始 Google Fonts 链接；本地开发入口使用已下载的字体。Claude 的页面外壳与注入运行时未加入本地游戏。

## 开源协议

本项目采用 [CC BY-NC-SA 4.0](LICENSE)：可署名分享与修改，但**禁止商业使用**，衍生作品须沿用相同协议。
