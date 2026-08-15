# 让同一 WiFi 下的其他人玩这个游戏

游戏网页需要跑在**你自己的电脑**上，Supabase（云端）负责登录、匹配和联机数据。
同一 WiFi 下的手机/电脑用浏览器访问你电脑的局域网地址即可开玩。

## 一、准备（只做一次）

1. 安装 Node.js 22 或更高版本：https://nodejs.org
2. 解压本项目，打开终端进入 `app` 目录：

```bash
cd pvp/app
npm install
```

3. 确认 `app/.env` 存在且内容为（zip 里已经带好，无需修改）：

```
VITE_SUPABASE_URL=https://qruwjheirllgemiqjmig.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable__3diCj3mywm6L1_d0fG0jw_1mH1VYAa
VITE_DEMO_MODE=true
```

## 二、启动局域网服务

开发模式（改代码即时生效，端口 5173）：

```bash
npm run dev:lan
```

正式模式（更快更稳，推荐给别人玩，端口 4173）：

```bash
npm run demo:build
npm run demo:lan
```

启动后终端会打印 `Network: http://192.168.x.x:5173/` 之类的地址，这就是别人要访问的地址。

## 三、查你电脑的局域网 IP

- Windows：`ipconfig`，看"无线局域网适配器 WLAN"下的 IPv4 地址
- macOS：`ipconfig getifaddr en0`
- Linux：`hostname -I`

得到形如 `192.168.1.5` 的地址。

## 四、其他人怎么进

1. 确保他们的手机/电脑连的是**同一个 WiFi**；
2. 浏览器打开 `http://192.168.1.5:5173`（正式模式是 `:4173`）；
3. 也可以让他们扫描游戏大厅右侧的二维码（注意：二维码需在局域网地址下打开页面才会指向正确 IP）；
4. 各自"注册/登录"或点"Guest play"进入，点 **Find online match** 就能互相匹配对战；
5. 同一台电脑上两个人玩，直接点 **Local Versus**（P1：A/D 移动、W 跳、J 拳、K 腿、按住 S 蹲；P2：方向键 + 1/2）。

## 五、连不上时排查

1. **防火墙**：Windows 首次启动会弹"允许 Node.js 访问网络"，一定要勾选"专用网络"并允许。
   已经拒绝过的话：控制面板 → Windows Defender 防火墙 → 允许应用通过防火墙 → 勾选 Node.js。
   macOS：系统设置 → 网络 → 防火墙 → 选项 → 允许 node 接入连接。
2. **不能用 localhost**：别人必须用你的 192.168.x.x 地址，`localhost` 只指他们自己的设备。
3. **访客网络/AP 隔离**：很多路由器的"访客 WiFi"会隔离设备互访，改用主 WiFi。
4. **手机摄像头/照片上传**：手机浏览器在 http（非 https）下可正常选相册照片；若要用摄像头拍照可能需要 https，用相册即可。
5. **电脑休眠**会断服务，玩的时候别让电脑睡眠。

## 六、想让不在同一 WiFi 的人玩？

需要把网页部署到公网（例如 Vercel/Netlify 等静态托管，Supabase 后端不用变）。
告诉我你想用哪个平台，我可以帮你准备部署配置。
