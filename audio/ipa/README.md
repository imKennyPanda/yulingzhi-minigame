# 英语音标点读音频

H5 / PC 共用的真人音标录音。音标表（`[iː]` 卡片）和英语单词游戏（点已选音标段、点选项）都调用同一套文件，因此两处发音完全一致。

## 来源与许可

- 原始录音来自 Wikipedia 的音标图表音频，经数据集 [cluesurf/wikipedia-ipa](https://huggingface.co/datasets/cluesurf/wikipedia-ipa) 整理，许可为 **CC BY-SA 4.0**。
- 本项目对录音做了以下处理：转单声道、去除首尾静音、统一响度、辅音截到 0.6 秒并加 8ms 淡入淡出。处理后的文件仍按 **CC BY-SA 4.0** 提供。
- 引用来源：<https://en.wikipedia.org/wiki/International_Phonetic_Alphabet_chart>、<https://en.wikipedia.org/wiki/IPA_pulmonic_consonant_chart_with_audio>、<https://en.wikipedia.org/wiki/IPA_vowel_chart_with_audio>

## 文件与音标对应

| 文件 | 音标 | 说明 |
|---|---|---|
| `i.wav` | iː / i | 前高元音 |
| `ih.wav` | ɪ | 次前高元音 |
| `eh.wav` | e / ɛ | 英语 bed 的元音，按美式读作 ɛ |
| `ae.wav` | æ | cat 的元音 |
| `er.wav` | ɜ / ɜː | 中元音 |
| `schwa.wav` | ə | 弱读元音 |
| `uh.wav` | ʌ | cup 的元音 |
| `u.wav` | uː / u | 后高元音 |
| `ups.wav` | ʊ | book 的元音 |
| `aw.wav` | ɔː / ɔ / ɒ | ball、hot 的元音 |
| `ah.wav` | ɑː / ɑ | father 的元音 |
| `a.wav` | a | 双元音 aɪ、aʊ 的起点 |
| `o.wav` | o / oʊ | 双元音 oʊ 的起点 |
| `p/t/k/f/s/θ/ʃ` | 对应清辅音 | θ→`th.wav`，ʃ→`sh.wav` |
| `b/d/g/v/z/ð/ʒ` | 对应浊辅音 | ð→`dh.wav`，ʒ→`zh.wav` |
| `ch.wav` | tʃ | 塞擦音 |
| `j.wav` | dʒ | 塞擦音 |
| `m/n/ŋ/l/r/w/j/h` | 对应辅音 | ŋ→`ng.wav`，r→`ɹ.wav`（英语 r 是近音，不是大舌颤音），j→`y.wav` |

## 多音素音标怎么读

双元音和带 r 的音标由两个录音依次播放（间隔 40ms）：

- `eɪ` = e + ɪ，`aɪ` = a + ɪ，`ɔɪ` = ɔ + ɪ，`oʊ` = o + ʊ，`aʊ` = a + ʊ
- `ɜːr` = ɜ + r，`ɚ` = ə + r，`ɪr` = ɪ + r，`er` = ɛ + r，`ʊr` = ʊ + r
- `tr/ts/dr/dz` = t+r、t+s、d+r、d+z

游戏里的音标段（如 `kæ`、`stɑː`、`t͡ʃɛə(ɹ)`）由 `ipaClips()` 按最长匹配拆成单音素后播放；与音标表卡片走的是同一个函数。

## 实现位置

- `h5.html` / `pc.html` 中的 `IPA_CLIPS`、`IPA_LONG`、`ipaClips()`、`playIpa()`
- 文件缺失或播放失败时回退到浏览器 TTS，不影响答题
