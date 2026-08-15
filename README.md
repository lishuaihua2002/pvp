# 照片格斗 Photo Fighter

**在线试玩：https://lishuaihua2002.github.io/pvp/** （手机浏览器直接打开即可，建议横屏）

网页横版 1v1 真人对打游戏：上传一张照片就能捏出独一无二的角色，和朋友或匹配到的陌生人真人对打。

## 这个项目想做什么

- **只打真人（PVP > PVE）**：打 AI 永远是套路，打人才有意外和乐趣，所以整个游戏只做真人对战——在线匹配、好友约战，或者一台设备上的本地双人。
- **每个人的角色都独一无二**：上传自己的照片，自动识别姿态并抠除背景，把整张人像绑到骨架上做动画，所以角色是"你"，而不是一个通用小人。
- **没有输赢，只要爽**：没有胜负判定、没有排行榜、没有段位。攻击累积"冲击值"，打到一定程度对方会横躺在地上再起身，能量条满了还能放大招把人撞飞、撞墙弹几下——目标只有一个：打起来爽。
- **打着打着就成了朋友**：连续对战满 1 分钟，双方自动成为好友，不用互相加。打完就能私聊、约战下一局，用"一起打过"代替"加个好友吧"来推动社交。
- **好友有上限，关系会新陈代谢**：每人最多 500 个好友；超过之后自动淘汰最不活跃的那个（按最近一次一起对战/私聊的时间排序）。好友列表因此永远是"最近还在一起玩的人"，而不是一堆躺尸。

## 在线试玩 / 部署

- 线上版本：https://lishuaihua2002.github.io/pvp/ （main 分支推送后由 GitHub Actions 自动构建部署）
- 构建产物是纯静态文件，任意静态托管（GitHub Pages / Vercel / Nginx）都能放

## 玩法与键位

- 键盘：`A/D` 移动 · `W/空格` 跳跃（空中再按一次为二段跳） · `S` 下蹲 · `J` 出拳 · `K` 出腿 · `L` 大招 · `Esc` 退出对战
- 组合技：蹲下+拳=低位直拳 · 蹲下+腿=扫堂腿 · 空中+拳=升龙拳 · 空中+腿=飞踢
- 下蹲蹲得很低，站立直拳会从头上打空，但仍会被扫堂腿和踢腿命中
- 大招：把对方打趴一次能量条充满，`L`（手机为 ⚡ 按钮）锁定对方位置冲过去，撞到把对方横向撞飞、撞到墙壁反弹、落地再弹几下，全程不掉血；没撞到就一直冲到场地边缘
- 手机：自动显示虚拟摇杆（左右移动 / 上跳 / 下蹲）与右侧按键
- 本地双人（一台设备）：P2 使用 `方向键` + `1`(拳) `2`(腿) `3`(大招)
- 无血条：攻击累积"冲击值"，被连续命中会被击倒横躺，起身有短暂无敌

## 功能一览

- 账号：邮箱注册/登录/忘记密码 + 游客快速试玩（Supabase 匿名登录）
- 角色：4 个内置预设角色 + 照片角色编辑器（浏览器内压缩去 EXIF、姿态关键点识别、人像分割抠背景、整图绑骨骼动画、动画预览、本地保存）
- 战斗：60FPS 确定性模拟，命中停顿、镜头震动、粒子、受击闪白、程序化音效
- 匹配：`try_matchmake` RPC 原子配对（`for update skip locked` 防竞态）
- 联机：私有 Realtime Channel（Broadcast 输入 + Host 状态快照 + Presence 掉线检测）
- 社交：搜索/申请好友、私聊（服务端校验+限频）、屏蔽、对战满 1 分钟自动加好友、好友上限 500 自动淘汰最不活跃
- 演示模式：二维码扫码即玩、游客入口、诊断面板

## 技术栈

- 前端：React 19 + TypeScript + Vite + Tailwind CSS 4 + Zustand
- 游戏引擎：Phaser 3（骨骼动画 + 照片角色整图网格蒙皮）
- 视觉：MediaPipe Pose（姿态关键点）+ 人像分割（去背景）
- 后端：Supabase（Auth / PostgreSQL / Storage / Realtime / RPC）
- 音效：Web Audio API 程序化生成（无版权风险）
- 测试与检查：Vitest + oxlint

## 目录结构

```
pvp/
├── prompt.md                 # 完整产品需求
├── supabase/migrations/      # 数据库 migration（表、RLS、RPC、Storage、Realtime 授权）
│   ├── 0001_init.sql         # 账号/角色/匹配/对战
│   ├── 0002_friends.sql      # 好友/私聊/屏蔽/对战邀请/自动加好友
│   ├── 0003_revoke_anon_rpc.sql
│   └── 0004_friend_limit.sql # 好友上限 500 + 活跃度淘汰
└── app/                      # 前端应用
    └── src/
        ├── pages/            # 登录、大厅、竞技场、角色编辑器、本地试玩
        ├── components/       # Phaser挂载、触屏摇杆按键、好友面板、二维码
        ├── stores/           # Zustand：auth / match
        ├── lib/              # Supabase 客户端、角色存取、姿态识别、预设角色
        └── game/             # 战斗模拟、动画配置、骨骼渲染、输入、音效、联机频道
```

## 本地跑起来

### 1. 环境要求

- Node.js >= 22.12（推荐 nvm）
- 一个 Supabase 项目（免费版即可）

### 2. 配置 Supabase

1. 在 [supabase.com](https://supabase.com) 创建项目。
2. 在 SQL Editor 中按序号依次执行 `supabase/migrations/*.sql`（或 `supabase db push`）。
3. Dashboard → Authentication：启用 Email 登录，并启用 **Anonymous Sign-Ins**（游客试玩必需）。
4. Dashboard → Project Settings → API：复制 Project URL 与 Publishable (anon) Key。

> ⚠️ 前端只能使用 Publishable/Anon Key。绝对不要把 service_role / Secret Key 写进前端或提交到仓库。

### 3. 启动前端

```bash
cd app
cp .env.example .env    # 填入 Supabase URL 和 anon key
npm install
npm run dev             # 本机开发
npm run dev:lan         # 局域网可访问（手机扫码测试，见 HOW_TO_PLAY_LAN.md）
```

### 4. 其他命令

```bash
npm run build       # 类型检查 + 生产构建
npm run test        # 战斗模拟单元测试
npm run lint        # oxlint
```

## 安全设计

- 所有表启用 RLS；写操作全部通过 `security definer` RPC 校验
- Storage 私有 bucket，部件资源通过 signed URL 访问，对手仅在比赛期间可读
- Realtime 使用私有频道，仅比赛双方可加入
- 聊天内容以纯文本渲染（React 默认转义），不渲染 HTML
- 高频战斗数据只走 Realtime Broadcast，不写数据库

## 已知限制

- 好友淘汰在"新增好友/对战自动加好友"时触发，不是后台定时任务
- 照片角色的抠图质量取决于原图（建议全身、背景简单、正面站立）
- 联机由其中一方做 Host 广播快照，跨国高延迟下可能有拉扯
