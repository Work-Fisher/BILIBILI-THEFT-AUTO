# audio/vo

配音已按用户要求清空（2026-11-17）：原有 170 条第一章台词录音、`manifest.json` 和 `_test/` 里的 7 条试音都是 `tools/tts.mjs` 生成的，已删除。

游戏里的台词也已全部去掉（`js/cnstory.js` 的 `DIALOG` 为空，`js/vo.js` 是不请求任何文件的空实现）。

等台词重写之后：
1. 把新台词写回 `js/cnstory.js` 的 `DIALOG`。
2. 运行 `node tools/tts.mjs` 重新生成 `audio/vo/<voice>.mp3` 和 `manifest.json`。
3. 恢复 `js/vo.js` 的加载逻辑（读取 `manifest.json`，接到 `GT.audio.voice`）。
