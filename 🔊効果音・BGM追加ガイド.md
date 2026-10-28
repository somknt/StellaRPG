# 🔊 効果音・BGM追加ガイド

音のファイルを決まった名前でフォルダに置くだけで、ゲームの中で鳴ります。コードを書きかえる必要はありません。

## 置き場所

```
js_version/assets/sounds/
├── se/    効果音（例：attack.mp3）
└── bgm/   BGM・ジングル（例：bgm_title.mp3）
```

- 名前の一覧（いつ鳴るか・おすすめの順番つき）：`js_version/assets/sounds/📋ここに音声ファイルを置いてください.txt`
- 形式：mp3（おすすめ）/ ogg / wav
- 置いていない音は鳴らないだけです。1つずつ足していけます
- 代わりの音がある物もあります（例：`bgm_boss` だけ置けば、3体のボス戦すべてで流れる）

## 確かめ方

1. ファイルを置いたら、ブラウザでページを読み直す（Ctrl+F5）
2. コンソール（F12）で `soundManager.status()` と打つと、読みこめた音・まだない音の一覧が出る
3. 最初に画面をさわった時から音が出ます（ブラウザ・スマホの決まりで、さわる前は音を出せません）

音量は、ゲームの「設定」の BGM 音量・効果音 音量で変えられます。一時停止中は BGM が小さくなります。

## 入手先の例

それぞれの利用規約（クレジット表記など）を確認してください。

- 魔王魂：https://maou.audio/ （BGM・効果音）
- 効果音ラボ：https://soundeffect-lab.info/ （効果音）
- DOVA-SYNDROME：https://dova-s.jp/ （BGM）
- 甘茶の音楽工房：https://amachamusic.chagasi.com/ （BGM）

## 音を足す・名前を変える

`js_version/js/sound.js` の `SoundManager.LIST` に1行足し、鳴らしたい所で `playSE('名前')`（BGM は `playBGM('名前')`）を呼びます。
