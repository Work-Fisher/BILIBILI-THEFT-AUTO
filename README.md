# BILIBILI THEFT AUTO 1

在月湾大道步行、开车、听电台，或在海滨城区自由探索。这是项目的公开可分发版，网页版包含 4K 设置和武器轮盘修复。

[下载游戏](https://github.com/Work-Fisher/BILIBILI-THEFT-AUTO/releases/tag/v2026.11.18) · [制作教程（中文 PDF，21 页）](docs/tutorial.pdf) · [原项目在线试玩（B 站 TOY）](https://www.bilibili.com/toy/bilibili-theft-auto-1)

## 选择版本

| 下载文件 | 打开方式 |
| --- | --- |
| [BTA-Standalone.html](https://github.com/Work-Fisher/BILIBILI-THEFT-AUTO/releases/download/v2026.11.18/BTA-Standalone.html) | 下载后用桌面版 Edge 或 Chrome 打开。脚本、模型、贴图与声音都在这一个文件里。 |
| [BTA-Windows-x64.zip](https://github.com/Work-Fisher/BILIBILI-THEFT-AUTO/releases/download/v2026.11.18/BTA-Windows-x64.zip) | 解压整个 ZIP 并运行 BTA-DLSS5.exe。默认使用游戏原画，支持从本地导入可选神经渲染组件。 |
| [BTA-TOY-4K.zip](https://github.com/Work-Fisher/BILIBILI-THEFT-AUTO/releases/download/v2026.11.18/BTA-TOY-4K.zip) | 适合静态网页托管，解压到站点根目录，入口为 index.html。 |
| [BTA-Afterglow-Source.zip](https://github.com/Work-Fisher/BILIBILI-THEFT-AUTO/releases/download/v2026.11.18/BTA-Afterglow-Source.zip) | 另一套 Vice City Afterglow 目录版源码，已替换其中的专有素材。 |

**操作。** WASD 移动，F 上下车，U 切换时段。按住 Q 后滚轮预选武器，松开 Q 装备。车内滚轮切换已安装的电台，反斜杠开关电台。公开版附一个可离线播放的电台 Moonbay FM，使用开场曲《Midnight Explosion》。

## 运行与打包

[web](web) 是当前网页与 TOY 版的可编辑源码。在仓库根目录运行以下命令，启动器会打开浏览器。需要 Python 3。

~~~sh
python web/start-game.py
~~~

在仓库根目录运行下列命令即可在当前目录生成分享文件。单文件打包仅需 Python 标准库。TOY 打包还需要 Pillow 和命令行可用的 FFmpeg。

~~~sh
python tools/build_standalone.py
python tools/build_toy.py
~~~

[desktop/app](desktop/app) 是 Windows 版的 Electron 应用源码和实际加载的游戏。开发时可用它替换解压后的 Windows 包里的 resources/app。两套源码分别保留网页和桌面渲染逻辑。

## 导入自己的电台

把有使用权的 MP3 放在单独的文件夹里，文件名就是电台名。下面的命令将音频复制到网页源码并更新电台列表，重新打包后即可离线分享。导入 Windows 版时，将第二个参数换为解压目录里的 resources/app/game。请保留 Moonbay FM 作为内置台名。

~~~sh
python tools/import_radio.py "我的电台" web
~~~

[第三方组件、素材来源和可选本地导入说明](docs/素材来源.md) · [参考预告视觉笔记](docs/视觉风格笔记.md) · [下载文件 SHA-256 校验表](docs/SHA256SUMS.txt)
