# 照片格斗 Photo Fighter

网页横版 1v1 PVP 格斗游戏：上传照片创建自己的格斗角色，通过 Supabase 实时匹配与好友在线对战。为黑客松现场演示设计（扫码即玩、游客快速试玩、预设角色）。

## 技术栈

- 前端：React 19 + TypeScript + Vite + Tailwind CSS 4 + Zustand
- 游戏引擎：Phaser 3（骨骼式部件动画，60FPS 确定性战斗模拟）
- 后端：Supabase（Auth / PostgreSQL / Storage / Realtime Broadcast + Presence / RPC）
- 音效：Web Audio API 程序化生成（无版权风险）
- 测试：Vitest

## 目录结构

```
pvp/
├── prompt.md                 # 完整产品需求
├── supabase/migrations/      # 数据库 migration（表、RLS、RPC、Storage、Realtime 授权）
│   ├── 0001_init.sql         # 账号/角色/匹配/对战
│   └── 0002_friends.sql      # 好友/私聊/屏蔽/对战邀请/自动加好友
└── app/                      # 前端应用
    └── src/
        ├── pages/            # 登录、大厅、竞技场、角色编辑器、本地试玩
        ├── components/       # Phaser挂载、触屏按键、好友面板、二维码
        ├── stores/           # Zustand：auth / match
        ├── lib/supabase/     # Supabase 客户端与角色存取
        ├── lib/presets.ts    # 4个程序生成的预设角色
        └── game/             # 战斗模拟、动画配置、骨骼渲染、输入、音效、联机频道
```

## 从零启动

### 1. 环境要求

- Node.js >= 22.12（推荐用 nvm 安装）
- 一个 Supabase 项目（免费版即可）

### 2. 配置 Supabase

1. 在 [supabase.com](https://supabase.com) 创建项目。
2. 在 SQL Editor 中依次执行 `supabase/migrations/0001_init.sql` 和 `0002_friends.sql`（或使用 `supabase db push`）。
3. Dashboard → Authentication → Sign In / Up：
   - 启用 Email 登录；
   - 启用 **Anonymous Sign-Ins**（游客试玩必需）。
4. Dashboard → Project Settings → API：复制 Project URL 和 Publishable (anon) Key。

> ⚠️ 前端只能使用 Publishable/Anon Key。绝对不要把 service_role / Secret Key 写进前端或提交到仓库。

### 3. 启动前端

```bash
cd app
cp .env.example .env    # 填入你的 Supabase URL 和 Key
npm install
npm run dev             # 本机开发
npm run dev:lan         # 局域网可访问（手机扫码测试）
```

### 4. 其他命令

```bash
npm run build       # 类型检查 + 生产构建
npm run test        # 运行战斗模拟单元测试
npm run lint        # oxlint
npm run demo:build && npm run demo:lan   # 黑客松演示：构建并在局域网提供服务
```

## 玩法与键位

- 键盘：`A/D` 移动 · `W/空格` 跳跃（空中再按一次为二段跳） · `S` 下蹲 · `J` 出拳 · `K` 出腿 · `L` 大招 · `Esc` 退出对战
- 组合技：蹲下+拳=低位直拳 · 蹲下+腿=扫堂腿 · 空中+拳=升龙拳 · 空中+腿=飞踢
- 大招：把对方打趴一次能量条充满，`L`（手机为 ⚡ 按钮）锁定对方冲撞，撞到把对方弹飞且不掉血，没撞到就一直冲
- 手机：自动显示虚拟摇杆与按键（建议横屏）
- 本地双人：P2 使用 `方向键` + `1`(拳) `2`(腿) `3`(大招)
- 无血条：攻击累积“冲击值”，被连续命中会被击倒，起身有短暂无敌

## 主要功能

- 邮箱注册/登录/忘记密码 + 游客快速试玩（Supabase 匿名登录）
- 照片角色编辑器：浏览器内压缩并去除 EXIF、10 个身体部位框选、橡皮擦去背景、撤销/重做、动画预览
- 4 个内置预设演示角色（程序生成，无版权风险）
- 在线匹配：`try_matchmake` RPC 原子配对（`for update skip locked` 防止竞态）
- 对战同步：私有 Realtime Channel（Broadcast 输入 + Host 状态快照 + Presence 掉线检测）
- 好友系统：搜索、申请、私聊（服务端校验+限频）、屏蔽、对战满 1 分钟自动成为好友（服务端校验时长）
- 打击反馈：命中停顿、镜头震动、粒子、受击闪白、程序化音效

## 安全设计

- 所有表启用 RLS；写操作全部通过 `security definer` RPC 校验
- Storage 私有 bucket，部件资源通过 signed URL 访问，对手仅在比赛期间可读
- Realtime 使用私有频道，仅比赛双方可加入
- 聊天内容以纯文本渲染（React 默认转义），不渲染 HTML
- 高频战斗数据只走 Realtime Broadcast，不写数据库

## 已知限制

- 照片人物自动识别/自动抠图未接入模型，当前为手动框选 + 橡皮擦方案
- 公网部署需自行选择托管（构建产物为纯静态文件，任何静态托管均可）
