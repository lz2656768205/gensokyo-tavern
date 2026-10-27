# 幻想乡酒馆 · Gensokyo Tavern

一个可以真正玩起来的 **AI 剧本角色扮演** 本地应用。

95 张角色卡（49 位东方 Project 角色 + 5 位虚拟歌姬 + 41 位《东方夜雀食堂》角色）、13 部带分幕与结局的剧本、65 条世界观词条，一个专门用来「稳住角色」的提示词与记忆引擎，以及一张可点击的幻想乡地图。纯 Python 标准库后端，双击 `启动.bat` 就能在浏览器里打开；没有 API Key 也能先离线试玩。

> 参考了「树梦」App 的产品结构（角色卡 / 剧本 / 酒馆 / 对话 / 朗读 / 推荐回复），代码、文本与美术均为本项目重新实现，未使用其任何素材。

![首页](docs/screenshots/home.png)

| 角色馆 | 剧本馆 |
|---|---|
| ![角色馆](docs/screenshots/characters.png) | ![剧本馆](docs/screenshots/scenarios.png) |

![对话](docs/screenshots/chat.png)

手机端：

| 首页 | 角色馆 | 对话 |
|---|---|---|
| ![手机首页](docs/screenshots/mobile_home.png) | ![手机角色馆](docs/screenshots/mobile_characters.png) | ![手机对话](docs/screenshots/mobile_chat.png) |

| 幻想乡地图 | 莉格露·奈特巴格 | 夜雀食堂 |
|---|---|---|
| ![地图](docs/screenshots/map.png) | ![莉格露](docs/screenshots/wriggle.png) | ![夜雀食堂](docs/screenshots/night_chat.png) |

---

## 一分钟开始

1. 确认电脑上有 **Python 3.8+**（Windows 商店版或 python.org 版都行）。
2. 双击 **`启动.bat`**。
3. 浏览器会自动打开 `http://127.0.0.1:8765`（端口被占用时会自动换一个）。
4. 第一次进入会看到「先点灯，还是先坐下？」：
   - **去配置 API**：填一个 OpenAI 兼容接口，就能自由对话；
   - **先离线试玩**：不填 Key，也能按剧本分幕走完一段故事。

关闭启动窗口即停止服务。所有存档在 `data/saves/`，所有配置在 `config.json`，都在本机。

### 手动启动

```bat
cd /d F:\幻想乡剧本\GensokyoTavern
python server.py --open
```

默认只监听 `127.0.0.1`，局域网里的其他设备访问不到；手机版用下面的 `--lan`。

### 手机 / APK（方案 A）

电脑当后端、手机当显示屏：

1. 双击 **`启动手机版.bat`**（等价于 `python server.py --lan --open`），窗口里会打印 `手机访问：http://<电脑IP>:8765`。
2. 手机和电脑连同一个 Wi-Fi，手机浏览器先打开这个地址确认能访问。
3. 安装 `GensokyoTavern-Android/dist/GensokyoTavern.apk`。
4. 首次启动填电脑日志里的地址；之后可从右上角菜单「服务器地址」修改。

APK 只是一个 WebView 壳：角色、存档、API Key 都留在电脑上，所以电脑必须开着并运行服务。换网络或 IP 变了，在 App 里改地址即可。详细说明和重新打包方法见 [Android 壳说明](GensokyoTavern-Android/README.md)。

> 只在可信的家庭 Wi-Fi 使用；服务没有登录验证，不要把 8765 端口映射到公网。

### 云端后端（方案 C）

如果不想让手机和电脑同 Wi-Fi，或者电脑不能一直开着，可以把整个 Python 后端装进 Docker 放到云平台：

- 根目录已带 `Dockerfile`、`.dockerignore`、`render.yaml`；
- 详细步骤（Render / Hugging Face Spaces / Railway / Fly.io）见 [云端部署说明](deploy/README.md)；
- 云端必须设置 `TAVERN_TOKEN`，第一次用 `https://你的域名/?token=令牌` 打开；`DEEPSEEK_API_KEY` 只放平台环境变量，不写进镜像。

Hugging Face Spaces 是最省事的免费方案：新建 Docker Space，上传项目，按 [Space README](deploy/huggingface/README.md) 配好 secret 即可。如果所在网络无法访问 `huggingface.co`，改用 Render、Railway、Fly.io 或自己的 VPS。Render 免费实例会休眠，免费磁盘也不是持久的，长期存档需要挂 Disk 或定期导出。


---

## 第一次配置 API

设置页 →「模型连接」。任何 **OpenAI 兼容** 的 `/chat/completions` 接口都可以：

| 服务 | Base URL | 模型示例 |
|---|---|---|
| DeepSeek 官方 | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
| Ollama 本地 | `http://127.0.0.1:11434/v1` | 你 `ollama pull` 过的模型名 |
| LM Studio | `http://127.0.0.1:1234/v1` | 载入的模型名 |

填完点「测试连接」，成功后保存即可。Key 只写入本机 `config.json`，页面只会拿到掩码；但它是**明文存储**的，公用电脑上请注意。

**没有 Key 时**：应用进入离线演示。它会按剧本分幕给出旁白、角色台词和建议选项，能走完流程，但不会真正理解你说的话；配好 Key 之后角色才会接住每一句话。

---

## 里面有什么

### 角色（95）

- **东方 Project 49 位**：博丽灵梦、雾雨魔理沙、十六夜咲夜、蕾米莉亚、芙兰朵露、西行寺幽幽子、魂魄妖梦、八云紫、古明地觉、古明地恋、火焰猫燐、灵乌路空、蓬莱山辉夜、八意永琳、铃仙、藤原妹红、东风谷早苗、八坂神奈子、洩矢诸访子、琪露诺、射命丸文、犬走椛、河城荷取、稗田阿求、上白泽慧音、米斯蒂娅、伊吹萃香、星熊勇仪、四季映姬、小野塚小町、摩多罗隐岐奈、宇佐见堇子……
  角色卡来自 `F:\幻想乡剧本\GensokyoAI-main\characters\zh_cn` 的完整人格设定；古明地觉、西行寺幽幽子额外合并了 `gensokyoai-v2-main` 的深度人格。
- **虚拟歌姬 5 位**：初音未来、重音 Teto、GUMI、亚北留音、洛天依。
  卡片是按公开设定重新撰写的，参考了 roleplayst / chub.ai 的卡片字段与官方设定；没有搬运任何成人向内容。
- **《东方夜雀食堂》角色 41 位**：
  - 首批 5 位：莉格露·奈特巴格、帕秋莉·诺蕾姬、本居小铃、茨木华扇、幽谷响子；
  - 扩展 36 位：比那名居天子、圣白莲、丰聪耳神子、物部布都、苏我屠自古、霍青娥、宫古芳香、村纱水蜜、封兽鵺、云居一轮、二岩猯藏、娜兹玲、少名针妙丸、鬼人正邪、今泉影狼、赤蛮奇、若鹭姬、梅蒂欣、键山雏、水桥帕露西、黑谷山女、琪斯美、绵月丰姬、绵月依姬、魅魔、爱莲、露易兹、神绮、梦子、萨拉、拉尔瓦、饕餮尤魔、矢田寺成美、高丽野阿吽、秦心、森近霖之助。
  角色卡来自游戏内 `SpecGuestLang` 角色档案、`Kizuna_*` 羁绊剧情、游戏头像与公开设定。

每张卡包含：身份、性格、能力、人际关系、说话方式、2–4 段台词示例、开场白、来源。角色馆里可以完整阅读。

### 夜雀食堂联动（本次新增）

- **41 张夜雀食堂角色卡**：首批 5 位 + 扩展 36 位（名单见上），全部来自游戏内 `SpecGuestLang` 角色档案、`Kizuna_*` 羁绊剧情、游戏头像与公开设定。
- **34 张既有角色卡补完**：米斯蒂娅、灵梦、魔理沙、咲夜、蕾米莉亚、芙兰、美铃、幽幽子、妖梦、紫、萃香、阿求、慧音、妹红、辉夜、帝、铃仙、早苗、荷取、椛、文、勇仪、觉、燐、空、恋、小伞、幽香、橙、小町等，新增「夜雀食堂」常客档案、游戏内性格细节与口味/关系。
- **37 条夜雀食堂世界书**：夜雀食堂、妖怪兽道、人间之里、红魔馆、白玉楼、迷途竹林、妖怪之山、旧地狱/地灵殿、命莲寺、神灵庙、太阳花田、辉针城、月之都、魔界、料理/酒水标签、羁绊、营业规则、命莲寺众、神灵庙众、辉针城、魔界众……共 65 条世界观词条。
- **一张可点击的幻想乡地图**：22 个地点、22 条路线，基于游戏 `DaySceneMapLang` 文本与场景整理；点地名可以看描述、住在这里的角色，直接开聊。
- **一部新剧本《夜雀食堂·今夜的客人》**：经营/美食/群像，米斯蒂娅、莉格露、响子、小铃、帕秋莉、华扇同台，带口碑/食材/心情资源。


### 剧本（13）

| 剧本 | 类型 | 一句话 |
|---|---|---|
| 红雾封馆·第十三位客人 | 硬核推理 | 红雾本该散了却还在变浓，馆里每个人都有半句没说出口的证词 |
| 春雪·西行妖下的一百个春天 | 情感向 | 你扮演妖梦，替幽幽子偷走整个幻想乡的春天 |
| 永夜·迷途竹林的第九夜 | 悬疑恐怖 | 月亮停在原地，你已经第七次走过同一丛竹子 |
| 地底温泉繁盛记 | 经营喜剧 | 间歇泉通了，预算只剩一袋旧硬币 |
| 守矢祭·信仰争夺七日 | 祭典经营 | 七天之内，让这座山的香客比博丽神社多一倍 |
| 魔法森林·蘑菇实验 | 日常喜剧 | 会唱歌的蘑菇、失控的人偶，以及魔理沙的第三十七次爆炸 |
| 人里·夜巡委托 | 推理人情 | 连续七夜，村民的影子在消失 |
| 博丽神社·除夕宴会 | 群像温情 | 赛钱箱第一次满了，灵梦却高兴不起来 |
| 夜雀食堂·今夜的客人 | 经营美食 | 米斯蒂娅的食堂今晚满座，响子又迟到了，食材还差一味 |
| 声之都·深夜录音室 | 音乐日常 | 截止日前夜，三个歌姬为一句副歌吵了起来 |
| 声之都·星空演唱会 | 群像燃向 | 开场前三十分钟，主麦克风哑了，亚北留音不见了 |
| 声之都·天依的小食堂 | 美食治愈 | 开张第一碗面，来了四个蹭饭的 |
| 幻想乡·满月歌会 | 跨世界联动 | 满月之夜，声之都与幻想乡之间的门开了 |

每部剧本都有：前提、你的身份与目标、世界规则、3–4 幕（每幕有目标、节拍、导演提示、高潮）、3 个结局、建议行动。部分经营剧本还有 **预算 / 口碑 / 信仰 / 樱点** 等资源，模型会在剧情里输出 `[[budget-1]]` 这类标记，界面自动结算。

### 角色稳定引擎（这是本项目的重点）

「同款」应用最容易崩的地方是角色演着演着变成 AI 助手。这里做了六层：

1. **人格卡分层注入**：身份 / 性格 / 能力 / 人际关系 / 说话方式 / 台词示例，多人场景里主视角角色用全卡，其他角色用压缩卡。
2. **世界观检索**：65 条幻想乡 / 声之都 / 夜雀食堂词条，按关键词命中注入（符卡规则、红魔馆、月都、满月之门、夜雀食堂、妖怪兽道……），不一次性塞满上下文。
3. **剧本状态**：当前幕目标、可参考节拍、导演提示、高潮、资源，既给方向又不写死剧情。
4. **记忆**：自动/手动生成前情提要、已确认事实、角色关系值；长对话按 token 预算裁剪历史。
5. **输出格式约束**：台词用「」、动作用（）、旁白用【】；禁止替玩家行动、禁止复读、禁止出戏。
6. **回复后自检与纠偏**：检测「作为 AI」「语言模型」「提示词」「中文比例过低」「句子复读」「替玩家说话」等信号，右侧显示稳定度；点「纠偏」会按角色卡重写这一段。

设置里可以把严格程度调到 **严格**：会追加一份《角色稳定协议》和输出前自检。

---

## 怎么玩

- **角色馆**：点角色卡 → 读完整卡 →「自由对话」。
- **剧本馆**：点剧本 → 看分幕与结局 →「进入剧本」。进入后会自动用剧本指定的玩家身份（例如《春雪》里你就是妖梦）。
- **对话页**：
  - 输入框：`Enter` 发送，`Shift+Enter` 换行；
  - ✨ 建议：让模型给 3 个不同方向的行动，点一下填进输入框；
  - ✎ 旁白：插入一段旁白；
  - 每条回复下：朗读 / 复制 / 重写 / 纠偏；
  - 顶部：当前幕、地点、资源、「推进剧情」；
  - 右侧：稳定度、在场角色、剧本进度、资源、记忆、保存 / 导出 / 读档；
  - 最后一幕会出现「收束故事」，可以让 AI 按当前剧情写结局。
- **酒馆**：所有存档。支持导出当前对话、导出全部存档、导入备份。
- **幻想乡地图**：左侧导航或首页「看幻想乡地图」；点地点看描述与角色，直接从地图开聊。
- **朗读**：浏览器自带语音，离线可用；不同角色会按名字换一点音高。

### 存档与深链

- 服务器存档：`data/saves/*.json`，刷新/换浏览器都还在。
- 浏览器本地：`localStorage` 里保存当前会话，崩溃后可恢复。
- 深链：
  - `?save=<存档id>` 直接打开某个存档；
  - `?char=<角色id>` 打开角色详情；
  - `?scenario=<剧本id>` 打开剧本详情。
  例：`http://127.0.0.1:8765/?scenario=spring_snow`

---

## 文件结构

```
GensokyoTavern/
├─ server.py            # 标准库 HTTP 服务器 + OpenAI 兼容流式代理 + 存档 API
├─ engine.py            # 提示词分层、世界观检索、记忆、OOC 自检
├─ offline.py           # 无 Key 时的离线演示引擎
├─ config.json          # API 配置（运行时生成；Key 明文）
├─ runtime_url.txt      # 最近一次启动的地址
├─ 启动.bat
├─ web/
│  ├─ index.html        # 单页壳 + SVG 图标
│  ├─ style.css         # 夜色 / 和纸 / 朱红主题，响应式
│  ├─ app.js            # 路由、角色馆、剧本馆、对话、设置、朗读
│  └─ assets/           # 生成的角色头像、剧本封面、首页主视觉
├─ data/
│  ├─ characters.json   # 49 张东方角色卡（从 YAML 转换）
│  ├─ vocaloid.json     # 5 张歌姬卡
│  ├─ game_cards.json   # 41 张夜雀食堂角色卡 + 34 张既有卡补完
│  ├─ game_lorebook.json# 37 条夜雀食堂世界书
│  ├─ gensokyo_map.json # 22 个地点 / 22 条路线
│  ├─ game_scenarios.json # 夜雀食堂剧本
│  ├─ scenarios.json    # 12 部基础剧本
│  ├─ lorebook.json     # 28 条基础世界观词条
│  ├─ scenes.json       # 5 个原始场景
│  └─ saves/            # 存档
├─ docs/
│  ├─ screenshots/      # 界面截图
│  ├─ research/         # 角色卡/剧本检索记录
│  └─ game/             # 夜雀食堂文本提取、角色档案、地图、截图
└─ tools/               # 可复跑的数据构建脚本（需要 PyYAML / OpenCC / Pillow）
```

运行时**不需要任何第三方包**；`tools/` 里的构建脚本需要 `pip install pyyaml`。

### 重新构建数据

```bat
cd /d F:\幻想乡剧本\GensokyoTavern
python tools\build_data.py        # YAML → characters.json + 头像
python tools\build_lorebook.py    # 世界观词条
python tools\build_vocaloid.py    # 歌姬卡
python tools\build_scenarios.py   # 原创剧本 + 封面
python tools\build_scenarios2.py  # 合并检索素材剧本（会覆盖 scenarios.json）
python tools\build_game_cards.py  # 夜雀食堂首批 5 张 + 既有卡补完
python tools\build_more_cards.py  # 夜雀食堂扩展 36 张
python tools\build_game_world.py  # 夜雀食堂世界书 / 地图 / 新剧本
python tools\build_art.py         # 首页主视觉
```

> 注意：`build_scenarios2.py` 依赖 `build_scenarios.py` 先产出的 `scenarios.json`，顺序不要反。

### 加自己的角色 / 剧本

- 角色：往 `data/characters.json` 或 `data/vocaloid.json` 追加一个对象，字段参考现有卡片；`id` 用 ASCII，`avatar` 指向 `assets/avatars/xxx.svg` 或任意图片 URL。
- 剧本：往 `data/scenarios.json` 追加对象，最小字段：`id / title / subtitle / series / tags / accent / cover / characters / location / premise / player_role / player_persona / opening{first_speaker,first_line,narration} / acts[{title,goal,beats,director,suggested}] / endings`。改完重启服务器即可。

---

## 数据来源与致谢

**角色设定**
- [GensokyoAI](https://github.com/Patchouli-CN/GensokyoAI)（Apache-2.0）：49 位角色的中文人格卡、场景与格式。
- `gensokyoai-v2`（MIT，本地副本）：古明地觉、西行寺幽幽子的深度人格。
- `gensoquote`（Rust，MIT，本地副本）：东方角色台词库的整理思路（本应用未直接打包其英文语录）。

**检索记录**
- `docs/research/` 保留了歌姬卡与剧本的原始检索 JSON、抓取片段、来源可用性记录（roleplayst 模板化、chub.ai API、THBWiki 抓取方式、zeta-ai 纯 SPA 等）。

**歌姬卡**
- [roleplayst.com](https://roleplayst.com/) 与 `api.roleplay.st`：站点卡片页大量为模板占位，仅参考字段结构；
- [chub.ai](https://chub.ai/)：公开角色卡 API 提供了可核对的字段（如亚北留音的 2007-11-01、150cm、Fanloid 设定，Teto 的 159.5cm / Team Twindrill / 法棍梗）；
- 官方 / 百科侧（Crypton、Internet、上海禾念、Vocaloid Wiki）在抓取时多数不可达，歌姬卡以公开常识 + 检索到的字段重写，**未收录任何成人向内容**。

**剧本**
- [THBWiki](https://thbwiki.cc/)：《红魔乡》《妖妖梦》《永夜抄》《地灵殿》《风神录》剧情梗概（事实骨架）；
- [东方归言录 Wiki](https://wiki.biligame.com/touhoulostword/)：真实游戏脚本的排版范式（场景切换 / BGM 提示 / 选项插入点）；
- BOOTH 同人 TRPG 模组《本居小鈴の事件簿》《幻想夢遊譚》《諏訪の神風》的公开说明页：调查型结构、HO 制、经营与竞争设计参考；
- 喵玉殿《东方九头龙～红魔乡～》COC 模组汉化帖：恐怖模组的调查—遭遇—真相骨架；
- [zeta-ai.io](https://zeta-ai.io/)：Touhou plot 页仅能读到标题（SPA 不渲染正文），只参考了「单一异变 + 一句悬念」的定位。

以上剧本文本均为本项目重写，未整段复制；`scenarios.json` 的 `inspiration` 字段保留了各部剧本的具体参考链接。

**夜雀食堂（本次新增）**
- 本地安装《东方夜雀食堂》（Touhou Mystia Izakaya）的 Addressables 资源包：`SpecGuestLang`（角色档案）、`Kizuna_*`（羁绊剧情）、`Main_*`（主线/任务对话）、`DaySceneMapLang`（场景）、`FoodsLang/BeveragesLang/ItemsLang`（食材、料理、酒水）等。
- 游戏资源包使用单字节 XOR 0x53 混淆；`tools/extract_game_text.py` 会自动识别并提取 TextAsset。共提取 9473 条文本资产（中文 5081 / 英文 1958 / 其他 2434），整理后保留在 `docs/game/corpus/`。
- 5 张新卡与地图的角色头像来自游戏附带的「头像&表情包」目录；头像版权归游戏原作方，本项目仅本地同人使用。
- 角色档案与羁绊台词经过改写/节选，未整段搬运剧情；游戏剧本《夜雀食堂·今夜的客人》为同人再创作。
- 提取与整理方法见 [docs/game/README.md](docs/game/README.md)。

**美术**
- 原本的头像、剧本封面、首页主视觉为脚本生成的 SVG（`tools/build_data.py` / `cover_art.py` / `build_art.py`）。
- 夜雀食堂首批 5 张卡中的 4 张像素头像来自游戏素材，另 1 张（本居小铃）与后续 36 张为同风格生成 SVG；头像版权归游戏原作方，仅本地使用。

**参考产品**
- 安卓包 `H:\下载\shumeng.apk`（树梦 AI 平台 v2.0.47）仅用于了解产品结构：首页推荐、角色卡、剧本、酒馆会话、对话内朗读/选项、底部导航。其静态资源为广告 SDK 与远程 H5 壳，未复制。

---

## 常见问题

**Q：页面一直停在「正在点亮灯笼…」？**
A：服务没起来，或端口被占用。看启动窗口的报错；也可以手动 `python server.py --port 8770 --open`。

**Q：回复很慢 / 报 401、404、429？**
A：401 是 Key 无效；404 多半是 Base URL 少了 `/v1`；429 是额度或频率限制。设置页有「测试连接」。

**Q：角色还是有点像 AI 助手？**
A：把严格程度调到「严格」，并在对话里点一次「纠偏」；长对话记得「整理记忆」。小模型（7B 以下）本身很难稳定，建议至少 14B 或直接用 DeepSeek。

**Q：能多人一起用吗？**
A：服务只绑定 `127.0.0.1`，默认只给本机。要做局域网共享，需要自己改 `server.py` 的绑定地址，并注意 Key 与存档安全。

**Q：会保存我的对话吗？**
A：只保存在本机 `data/saves/` 和你浏览器的 localStorage。除了你配置的模型接口，不会向任何第三方发送内容。

**Q：为什么剧本里的角色和原作剧情不完全一样？**
A：这是同人再创作：事实骨架尽量贴原作，具体冲突、真凶与结局是为「可玩」重新设计的。每部剧本的参考来源都写在详情页底部。

---

## 免责声明

本项目是非商业同人作品，与上海爱丽丝幻乐团、Crypton Future Media、Internet Co.、上海禾念等权利方无关联。东方 Project 及角色版权归 ZUN / 上海爱丽丝幻乐团所有；VOCALOID 角色版权归各自权利方所有；《东方夜雀食堂》的游戏文本、角色档案与头像版权归其原作方所有。请勿用于商业用途；角色扮演内容请保持全年龄向。

代码以 MIT 方式提供；引用的角色设定文本遵循其原仓库的 Apache-2.0 / MIT 许可，详见 `THIRD_PARTY_NOTICES.md`。
