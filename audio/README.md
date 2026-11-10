# 拼音点读音频

H5 / PC 共用的拼音标准发音文件。页面通过 `audio/sm/*.mp3`、`audio/ym/*.mp3`、`audio/tone/*.mp3` 播放；文件缺失或浏览器无法播放时，会自动回退到系统语音合成。

## 文件说明

- `sm/`：23 个声母（b p m f d t n l g k h j q x zh ch sh r z c s y w）。
- `ym/`：35 个韵母。文件名 `v.mp3` / `ve.mp3` / `vn.mp3` / `van.mp3` 分别对应 ü / üe / ün / üan。
- `tone/`：35 个韵母的四声录音，文件名 `<韵母><声调>.mp3`，例如 `un1.mp3` 是 un 的第一声（wēn）。ü 系列仍用 `v` 表示，即 `v1`–`v4`、`ve1`–`ve4`、`vn1`–`vn4`、`van1`–`van4`。声调卡播放这一组录音，不再用“村”这类带其他声母的汉字代读。
- `char/`：500 个字库用到的 400 个整音节录音，文件名是数字声调拼音，例如 `ma1.mp3`（妈，mā）、`nv3.mp3`（女，nǚ）、`lve4.mp3`（掠，lüè）。拼写练习点“确定”答对后、点击题目中的汉字或“拼一拼”时播放这一组录音，与声调卡同源，避免浏览器语音合成音色不一致、发音过短。

## 来源与许可

- 声母 23 个 + 标准韵母 24 个：来自 [vaebe/pinyin-audio](https://github.com/vaebe/pinyin-audio)，该仓库在 `package.json` 中声明 ISC License。
- 组合韵母 ua、uo、ian、iao、uan、iang、uang：来自 [davinfifield/mp3-chinese-pinyin-sound](https://github.com/davinfifield/mp3-chinese-pinyin-sound)，Unlicense（公有领域）；使用零声母音节 wa / wo / yan / yao / wan / yang / wang 的第一声录音。
- `tone/` 中 35 个韵母的四声：来自 [hanziguru/pinyin-audio](https://github.com/hanziguru/pinyin-audio)（仓库 README 注明音频供教育及非商业用途使用），使用其中的零声母音节录音，例如 un 用 wen1–wen4、ui 用 wei1–wei4、ü 用 yu1–yu4。新增的 ia、uai、iong、üan 分别使用 ya1–ya4、wai1–wai4、yong1–yong4、yuan1–yuan4；对应的 `ym/ia.mp3`、`ym/uai.mp3`、`ym/iong.mp3`、`ym/van.mp3` 取各自第一声录音。
- `char/` 中的整音节录音同样来自 [hanziguru/pinyin-audio](https://github.com/hanziguru/pinyin-audio) 的 `dist/<数字声调拼音>.mp3`，与声调卡使用同一套录音库；文件仅去除 ID3 元数据，音频内容未修改。
- `tone/ong1.mp3`、`tone/ong3.mp3`、`tone/ong4.mp3`：来自 [vibrantbyte/resources](https://gitee.com/vibrantbyte/resources) 的韵母四声录音，仓库为 Apache-2.0 License。ong 没有零声母音节，因此直接使用韵母录音。
- `tone/ong2-pure.mp3`：上述韵母录音缺少 ong 的第二声，改用 hanziguru 的 `tong2`（同，tóng），裁掉开头的声母 t（保留 0.285–0.68 秒的纯韵母部分），并把响度调整到与其他 ong 录音一致。
- 除 `ong2-pure.mp3` 外，音频文件仅重命名和整理，未修改音频内容；`ong2-pure.mp3` 做了去声母裁剪和响度匹配。

## 许可文本

- ISC：见 `LICENSE-isc.txt`
- Unlicense：见 `LICENSE-unlicense.txt`
- Apache-2.0：见 `LICENSE-apache.txt`
- hanziguru/pinyin-audio 未附正式许可证文件，使用条款见其 [README](https://github.com/hanziguru/pinyin-audio#readme)。

## 备注

国家中小学智慧教育平台目前没有提供单个声母/韵母 MP3 的直接下载入口（需登录或抓取媒体流），因此这里采用上述开放许可的标准拼音录音。如需替换为平台素材，保持文件名不变直接覆盖即可。
