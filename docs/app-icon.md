# macOS 应用图标：踩过的坑和最终做法

记录一次把一张白底 JPEG 插画做成 macOS 应用图标的完整过程。中间绕了很多弯路，
最关键的一条结论排在最前面。

---

## 一、最关键的一条：macOS 26 会自己切圆角

**母版应该是一张纯方形、完全不透明的 1024×1024 PNG，不要自己画圆角。**

macOS 26（Tahoe）开始，系统会像 iOS 那样自动给应用图标套圆角遮罩。如果你自己
先画了一圈圆角，它和系统遮罩差那么几个像素，那条缝在 Dock 里就显成**一圈灰边**——
而且怎么清缓存都去不掉。

这条在旧版 macOS 上是反的：以前 `.icns` 是原样显示，圆角必须自己画进去。网上
和早期文档说的都是旧规则。

判断方法：把图标和 Dock 里的邻居并排放大看。如果只有你的有灰圈，邻居没有，
那就是遮罩不匹配，不是投影。

```bash
node scripts/make-icon.mjs <源图> --card --bg=FBF3DC --full --square --pad=0
#                                              铺满画布 ↑    ↑ 不画圆角
```

验证：

```python
from PIL import Image
im = Image.open('build/icon.png').convert('RGBA')
lo, hi = im.split()[3].getextrema()
assert lo == 255, '必须完全不透明，系统才好切遮罩'
```

---

## 二、抠白底：用连通性，别用阈值

源图是白底 JPEG，直接铺进图标会变成一个白方块。抠底时**不能**用「所有接近白色
的像素都变透明」——插画里的白色问号、高光会一起被挖掉。

正确做法是**从四角 flood fill**，只吃和边缘连通的背景：

```python
probe = rgb.copy()
SENT = (255, 0, 255)
for c in [(0,0), (w-1,0), (0,h-1), (w-1,h-1)]:
    ImageDraw.floodfill(probe, c, SENT, thresh=26)
# probe 里等于 SENT 的才是背景
```

图形内部的白色和背景不连通，所以会被保留。边缘再做 1.2px 高斯模糊羽化。

---

## 三、`paste` 会打穿底层 alpha，要用 `alpha_composite`

把图形贴到不透明卡片上时，这样写是错的：

```python
card.paste(inner, (pad, pad), inner)     # ❌
```

`paste` 带 mask 时会对 alpha 通道也做混合：图形边缘 alpha=128 的地方，卡片原本
255 的 alpha 会被算成 `255*0.5 + 128*0.5 = 191`。结果「纯方图」其实不是全不透明
（实测 alpha 范围变成 143–255），系统遮罩就切不干净。

```python
layer = Image.new('RGBA', (BOX, BOX), (0,0,0,0))
layer.paste(inner, (pad, pad))
card = Image.alpha_composite(card, layer)   # ✅ alpha 保持 255
```

---

## 四、尺寸参考

用 `iconutil -c iconset` 解包系统应用的 icns，量「不透明区域占画布的比例」：

| 应用 | 占比 |
| --- | --- |
| Finder / Safari / 备忘录 / Chrome | 80% |

这是**旧规则下**的标准（自己画圆角，四周留 20% 透明给系统画投影）。

**macOS 26 交纯方图的话就是 100%**，遮罩和投影都由系统处理。

---

## 五、生成 .icns

`iconutil` 需要一个 `.iconset` 目录，里面 10 个固定文件名的 PNG：

```
icon_16x16.png      icon_16x16@2x.png     (16, 32)
icon_32x32.png      icon_32x32@2x.png     (32, 64)
icon_128x128.png    icon_128x128@2x.png   (128, 256)
icon_256x256.png    icon_256x256@2x.png   (256, 512)
icon_512x512.png    icon_512x512@2x.png   (512, 1024)
```

从 1024 母版用 `sips -z <size> <size>` 逐个缩放，然后：

```bash
iconutil -c icns build/icon.iconset -o build/icon.icns
```

---

## 六、图标不更新时的排查顺序

改了图标但界面上没变，按这个顺序查——**先证明文件是对的，再怀疑系统**：

**1. 文件本身**（逐像素，别靠肉眼）

```python
# 沿中线从边缘往里扫，看有没有意外的灰色像素
for x in range(0, 20):
    print(x, px[x, W//2])
```

放到品红色背景上合成一张，任何灰色都会立刻显形。

**2. 每个尺寸都要查**。icns 里 10 张图，只查 512 那张可能漏掉问题。

**3. 和系统应用并排渲染**，带上模拟的投影。孤立地看图标看不出问题。

**4. 缓存**

```bash
CACHE="$(getconf DARWIN_USER_CACHE_DIR)"
rm -rf "$CACHE/com.apple.iconservices" "$CACHE/com.apple.iconservicesagent"
killall iconservicesagent Dock Finder
# 系统级的需要 sudo：
# sudo rm -rf /Library/Caches/com.apple.iconservices.store
```

**5. LaunchServices 陈旧注册**（反复装卸同一路径会积累）

```bash
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$LSREG" -u /Applications/TestHub.app    # 注销
"$LSREG" -f /Applications/TestHub.app    # 重新注册
```

---

## 七、几个具体的坑

**开发模式的 Dock 图标要单独设。** 未打包运行时 Dock 显示 Electron 自带图标，
需要 `app.dock.setIcon()`。而且**主进程改动不热更新**——Vite 只重载渲染进程，
改了 `electron/main.js` 必须整个 App 重启。

**打包脚本别串上不带参数的 `npm run icon`。** 之前 `dist:mac` 里串了
`npm run icon && ...`，不带源图参数会重新生成内置的占位图标，**把自定义 logo
静默覆盖掉**——本机看着是对的，一打包发出去就变了。图标是持久化产物，
放在 `build/` 里，打包时不要重新生成。

**`touch` 一个不存在的 .app 会造出一个 0 字节文件。** 卸载后如果还执行
`touch /Applications/Foo.app`，会创建一个同名空文件冒充应用，后续所有
`cp` 到它里面的操作都会报 "Not a directory"，很容易误判成别的问题。

**开发版和安装版共用数据目录。** macOS 默认文件系统不区分大小写，
`app.setName('TestHub')` 之后 `~/Library/Application Support/TestHub` 和
开发时的 `.../testhub` 是同一个目录。好处是配置通用，**坏处是两个同时开会
互相覆盖 config.json**。

---

## 八、工具用法

```bash
node scripts/make-icon.mjs <源图> [选项]
```

| 选项 | 说明 |
| --- | --- |
| `--bg=RRGGBB` | 底色，两个色逗号分隔即为竖向渐变 |
| `--card` | 加底色卡片（不指定 `--bg` 时为白色） |
| `--pad=N` | 图形距卡片边缘的安全边距百分比，默认 1.5 |
| `--square` | 不切圆角，出纯方图 —— macOS 26 会自己套圆角，见上文 |
| `--full` | 底色铺满整张画布，不留四周透明边 |

不带任何选项就是「自由形状」：先用四角 flood fill 抠掉连通的背景色，
图形直接浮在 Dock 上，小尺寸下比卡片版清楚。

**当前使用的命令：**

```bash
node scripts/make-icon.mjs src/assets/logo.png --card --bg=FBF3DC --full --square --pad=0
```

脚本会直接写 `build/icon.png` 和 `build/icon.icns`。想比对效果就打开
`build/icon.png` 看，调完要 `npm run dist:mac` 重新打包才会进 App。
