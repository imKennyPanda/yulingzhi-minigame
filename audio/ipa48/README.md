# 英语音标标准录音（48 个）

音标表、发音练习共用的一套真人音标录音。

## 当前发音方式

- 音标表、发音练习中的**单个音标/音标段**全部播放本目录录音，不再用 TTS 拼读，避免不同设备把 `ih`、`aa` 等拼写读成字母。
- 完整英文单词仍用浏览器 **en-US 女声**（`speechSynthesis`）朗读；单词练习里的音标只显示、不发音。
- 音标表点击音标后，先播该音标录音，播完停 0.5 秒再读例词。

## 来源与许可

- 录音取自 <https://github.com/boommanpro/phonetic_symbol_web>（仓库许可 **MIT**），文件命名参考 <https://github.com/resetsix/english-ipa>。
- 本项目对录音做了以下处理：解码为 16 kHz 单声道 WAV，去除首尾静音，峰值归一化，加 5 ms 淡入淡出。
- 该仓库音频为第三方学习站点素材；如需商业发行，请自行确认音频版权。

## 文件与音标对应

| 文件 | 音标 | 说明 |
|---|---|---|
| `vowel-i-long.wav` | iː | 长元音 |
| `vowel-i-short.wav` | ɪ | 短元音 |
| `vowel-e-short.wav` | e / ɛ | 短元音 |
| `vowel-ae-short.wav` | æ | 短元音 |
| `vowel-er-long.wav` | ɜː | 长元音（美式 ɜːr 再拼 `consonant-r`） |
| `vowel-schwa-short.wav` | ə | 弱读元音 |
| `vowel-uh-short.wav` | ʌ | 短元音 |
| `vowel-a-long.wav` | ɑː | 长元音 |
| `vowel-o-short.wav` | ɒ | 短元音 |
| `vowel-aw-long.wav` | ɔː | 长元音 |
| `vowel-u-short.wav` | ʊ | 短元音 |
| `vowel-u-long.wav` | uː | 长元音 |
| `diphthong-ei/ai/oi/ou/au.wav` | eɪ / aɪ / ɔɪ / əʊ / aʊ | 双元音 |
| `diphthong-ear/air/ure.wav` | ɪə / eə / ʊə | 双元音（美式 ɪr/er/ʊr 再拼 `consonant-r`） |
| `consonant-*.wav` | 28 个辅音 | 含 tr、dr、ts、dz |

## 多音素音标怎么读

美式音标与这套国内教材常用的 48 音标体系不完全同名，页面按以下规则拼接，保证音色统一：

- `ɜːr` = `vowel-er-long` + `consonant-r`
- `ɝ` = `vowel-er-long` + `consonant-r`
- `ɚ` = `vowel-schwa-short` + `consonant-r`
- `oʊ` = `diphthong-ou`（əʊ）
- `ɪr / er / ʊr` = `diphthong-ear / air / ure` + `consonant-r`

## 实现位置

- `h5.html` / `pc.html` 中的 `IPA_CLIPS`、`IPA_LONG`、`ipaClips()`、`playIpa()`
- 完整单词与例词朗读：`speakEn()`、`speakEnSeq()`
