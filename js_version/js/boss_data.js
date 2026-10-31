// ボスのデータ（モンスター選択画面・ボス戦・ボスAIが使う）
// 新しいボスを足す時は、この配列に1つ追加して、boss_ai.js に AI のクラスを作り BOSS_AI_CLASSES に登録する
//
// status     : 'playable'（戦える） / 'coming'（カードだけ表示。今後実装予定）
// difficulty : ★の数（1〜4）。モンスター選択では左から difficulty の低い順に並ぶ
// enemy      : Enemy クラスに渡すステータス（hp / attack / defense / speed など）
// phases     : HP の割合で切り替わる3段階。hp 以下になったらそのフェーズ（一度進んだら戻らない）
//              HP は次のフェーズの区切り（hp）より下には減らない。区切りで止まって、形態が変わる演出の後に続きが減る（Enemy.takeDamage）
//              speedMul（移動速度の倍率）/ intervalMul（攻撃と攻撃の間の時間の倍率）/ recoverMul（攻撃後の隙の倍率）
//              attacks：そのフェーズで使う攻撃と、選ばれやすさ（重み）
//              opener：そのフェーズに変わった後（咆哮・遠吠えの後）に、最初に出す大技（attacks のキー）
//                      遠くて届かない時は近づいてから出す（BossAI.OPENER_WAIT 秒たっても届かなければ、そのまま出す）
// attacks    : 攻撃ごとの数値（damage は enemy.attack に掛ける倍率、range は使う距離 [最小, 最大]）
// motions    : 必要なモーションと今の状態（'temp' = コードで動かしている仮アニメーション / 'done' = 画像あり /
//              'alt' = 別のモーションの絵で代用）
//              画像は assets/enemies/<look.key>/<モーション>_<向き>_<1〜3>.png に置き、
//              assets.js の BOSS_MOTION_SPRITES_READY に足すと使われる
// look.sprite: 画像の出し方（Enemy.getBossSprite が使う）
//              draw  ：画面での大きさ（enemy.size の何倍の四角に描くか。画像は 320×320、足元は上から254px）
//              alias ：絵がないモーション → [代わりに使うモーション, 止めるコマ（null ならコマ送り）]。'walk' は歩きの絵
//              speed ：1コマの時間（秒）。書いていないモーションは 0.15
// playerLevel: バトルモードの主人公のレベル（このレベルのステータスで戦う。data/player_stats_table.json）
// elements   : 属性の相性（魔法のダメージ。game.js の Game.ELEMENT_MUL）
//              weak = 有利属性（よく効く：1.5倍） / resist = 不利属性（効きにくい：0.5倍） / 書いていない属性はふつう（1倍）
// bgm        : 戦いの BGM（assets/sounds/bgm/）。BATTLE START の文字が出てから流れる（boss_battle.js）
//              配列にすると形態ごとの曲（[第1形態, 第2形態, 第3形態]）。形態が変わる時は BGM を止めて、
//              ボスが吠え終わってから次の曲。同じ曲のボスは、止めた所から続きを流す
// introSE    : 名前が出た時の鳴き声（assets/sounds/se/。なければ共通の boss_intro）
// coins      : 倒した時のバトルコイン（難易度が上がるごとに10枚ずつ増える）。クリアタイムのランクで増える（battle_records.js）
// attackInterval: 1つの攻撃が終わってから次の攻撃までの待ち時間（大きいほどゆっくり。Enemy.SCALE.cooldown と BossAI.TUNING.interval がかかる）
// phaseBuff  : HP50%・25%を切った時の強化（[通常, HP50%以下, HP25%以下]）。書いていないボスは BossAI.PHASE_BUFF（全ボス共通）
//              attack = 攻撃力の倍率 / damageTaken = 受けるダメージの倍率（小さいほど硬い）
// ultimate   : そのボスでいちばん大きい大技（必殺技）の攻撃の名前（attacks のキー。いくつかある時は配列）
//              必殺技に当たった主人公は、少し飛ばされて1秒無敵になる（player.js の Player.ULT_HIT）。ほかの攻撃は無敵なし
// 攻撃の数値のうち windup2 = 2回目からの溜め / spread = 扇の広さ（ラジアン）/ radius = 当たりの丸の大きさ / body = 突進の体の当たりの大きさ

const BOSS_DATA = [
    {
        id: 'giant_forest_boar',
        name: '巨大森イノシシ',
        difficulty: 1,
        level: '初心者向け',
        field: 'arena',
        fieldName: '星の闘技場',
        status: 'playable',
        features: ['巨大な森のイノシシ', '強力な突進攻撃', '近距離攻撃中心', '攻撃前の予備動作が分かりやすい', '初心者向けのボス'],
        ai: 'ForestBoarAI',
        theme: { color: '#ff8a5a', banner: 'boss' },
        bgm: 'bgm_boss_boar',   // 戦いの BGM（assets/sounds/bgm/。なければ共通の bgm_boss）
        introSE: 'boar_cry',    // 名前が出た時の鳴き声（assets/sounds/se/）
        coins: 10,              // 倒した時のバトルコイン（＋クリアタイムのランクのボーナス）
        playerLevel: 5,
        elements: { weak: ['炎', '雷', '土'], resist: [] },
        enemy: {
            enemyId: 'boss_001', name: '巨大森イノシシ', displayName: '巨大森イノシシ',
            hp: 850, attack: 16, defense: 3, exp: 120,
            size: 74, speed: 64, detectionRange: 4000, attackRange: 90,
            isBoss: true, knockbackScale: 0.35
        },
        look: { key: 'giant_forest_boar', body: '#6e4a2e', dark: '#43291a', outline: '#24150b', snout: '#a88063', eye: '#ff6a3a', head: 0.5, ear: 0.24, tusks: true, bigTusks: true, mane: true,
            sprite: {
                draw: 1.875,
                alias: { idle: ['walk', 0], detect: ['walk', 0], turn: ['walk', null], run: ['charge', null], chargeEnd: ['chargePrepare', 0],
                         stun: ['walk', 0], hit: ['walk', 0], death: ['walk', 0] },
                speed: { walk: 0.2, turn: 0.3, run: 0.1, charge: 0.075, chargePrepare: 0.12, roar: 0.16 }
            } },
        attackInterval: 3.2,   // 攻撃と攻撃の間をゆっくりに（前は 1.0）
        ultimate: 'bigStomp',  // 必殺技：最終強化の大踏みつけ（3回の大きな衝撃）
        phases: [
            { hp: 1.0, label: '通常', speedMul: 1.0, intervalMul: 1.0, recoverMul: 1.0,
              attacks: { tusk: 4, charge: 3 } },
            // 強化の大技：連続突進（3回）／最終強化の大技：必殺技の大踏みつけ
            { hp: 0.5, label: '強化', speedMul: 1.15, intervalMul: 0.9, recoverMul: 0.85, transition: 'roar', opener: 'doubleCharge',
              banner: '怒りの咆哮！', attacks: { tusk: 3, charge: 1, doubleCharge: 3, stomp: 3 } },
            { hp: 0.25, label: '最終強化', speedMul: 1.25, intervalMul: 0.8, recoverMul: 0.55, transition: 'roar', opener: 'bigStomp',
              banner: '暴走状態！', attacks: { tuskCombo: 4, tripleCharge: 3, bigStomp: 3, doubleCharge: 1 } }
        ],
        // 牙（近接）は特にゆっくり・範囲を小さく。突進・踏みつけも溜めを長く、範囲を小さく
        attacks: {
            tusk:         { range: [0, 100],  windup: 0.8,  windup2: 0.62, damage: 1.0, reach: 76, spread: 1.45, hits: 2, recover: 1.1 },
            tuskCombo:    { range: [0, 105],  windup: 0.62, windup2: 0.46, damage: 0.85, reach: 80, spread: 1.45, hits: 5, recover: 1.0 },
            charge:       { range: [170, 2000], prepare: 1.1, speed: 410, duration: 1.05, count: 1, damage: 1.4, body: 0.48, recover: 1.6 },
            doubleCharge: { range: [150, 2000], prepare: 1.0, speed: 430, duration: 0.95, count: 3, damage: 1.4, body: 0.48, recover: 1.45, between: 0.7 },
            tripleCharge: { range: [130, 2000], prepare: 0.85, speed: 460, duration: 0.9, count: 4, damage: 1.5, body: 0.48, recover: 1.25, between: 0.55 },
            stomp:        { range: [0, 200],  windup: 1.0,  windup2: 0.65, damage: 1.1, radius: 120, waves: 2, recover: 1.15 },
            bigStomp:     { range: [0, 240],  windup: 1.05, windup2: 0.65, damage: 1.5, radius: 165, waves: 3, recover: 1.05 }
        },
        motions: {
            // 下・上向き：歩き・牙・突進の溜め・突進・咆哮・踏みつけ の絵がある（ほかは横向きの絵を使う）
            idle: 'alt', walk: 'done', run: 'alt', turn: 'alt', detect: 'alt', tuskAttack: 'done',
            chargePrepare: 'done', charge: 'done', chargeEnd: 'alt', stomp: 'done', roar: 'done',
            hit: 'temp', stun: 'alt', death: 'temp'
        }
    },
    {
        id: 'black_corrupted_wolf',
        name: '黒蝕狼',
        reading: 'こくしょくろう',
        difficulty: 2,
        level: '中級者向け',
        field: 'arena',
        fieldName: '星の闘技場',
        status: 'playable',
        features: ['星喰いに侵された狼', '素早い移動', '連続攻撃', '暗紫色の侵蝕攻撃', '中級者向けのボス'],
        ai: 'BlackWolfAI',
        theme: { color: '#c58bff', banner: 'corrupt', arenaTint: 'rgba(70, 15, 110, 0.2)' },
        bgm: 'bgm_boss_wolf',
        introSE: 'wolf_howl',
        coins: 20,
        playerLevel: 10,
        elements: { weak: ['炎', '土', '風'], resist: ['雷'] },
        enemy: {
            enemyId: 'boss_002', name: '黒蝕狼', displayName: '黒蝕狼',
            hp: 1000, attack: 24, defense: 4, exp: 200,   // 攻撃力 34 → 24（ダメージを10下げた）
            size: 56, speed: 165, detectionRange: 4000, attackRange: 70,   // 歩く・走る速さ 150 → 165
            isBoss: true, knockbackScale: 0.5
        },
        look: { key: 'black_corrupted_wolf', body: '#2b2433', dark: '#16111c', outline: '#07050a', snout: '#3d3346', eye: '#d47bff', head: 0.42, ear: 0.44, tail: true, glowEyes: true, miasma: true, cracks: true,
            sprite: {
                draw: 1.875,
                alias: { idle: ['leapPrepare', 0], detect: ['leapPrepare', 0], dodge: ['leap', 1], shadowDash: ['run', null],
                         corruptionAttack: ['bite', null], stun: ['leapPrepare', 2], hit: ['leapPrepare', 0], death: ['leapPrepare', 0] },
                speed: { walk: 0.15, run: 0.09, shadowDash: 0.05, howl: 0.16 }
            } },
        attackInterval: 2.5,   // 攻撃と攻撃の間（2.0 → 2.5 でゆっくり）
        ultimate: 'corruptionWave', // 必殺技：最終強化の侵蝕波動（広がる紫の輪）
        phases: [
            { hp: 1.0, label: '通常', speedMul: 1.0, intervalMul: 1.0, recoverMul: 1.0, dodgeChance: 0.2, aura: 0,
              attacks: { bite: 3, claw: 3, leap: 3 } },
            // 強化の大技：侵蝕弾（扇形の5発）／最終強化の大技：必殺技の侵蝕波動
            { hp: 0.5, label: '強化', speedMul: 1.2, intervalMul: 0.86, recoverMul: 0.85, dodgeChance: 0.3, aura: 1, transition: 'howl', opener: 'corruptionShot',
              banner: '侵蝕の遠吠え！', attacks: { doubleBite: 3, claw: 2, leap: 2, shadowDash: 3, corruptionShot: 3 } },
            { hp: 0.25, label: '最終強化', speedMul: 1.35, intervalMul: 0.75, recoverMul: 0.65, dodgeChance: 0.45, aura: 2, transition: 'howl', opener: 'corruptionWave',
              banner: '星喰いの暴走！', attacks: { tripleClaw: 3, doubleBite: 2, shadowLeap: 3, corruptionShot: 2, corruptionWave: 2 } }
        ],
        // 範囲は小さめ。連続攻撃（噛みつき・爪）は前より2回少なく、攻撃は全体にゆっくり（溜め・隙を長く）
        // chain：2回目からの溜めの倍率（1回目の溜めに掛ける） / follow：噛みつき・ひっかいた後の動きの時間の倍率
        attacks: {
            bite:           { range: [0, 260], windup: 0.52, damage: 1.0, hits: 4, radius: 32, chain: 0.9, follow: 1.35, recover: 0.9 },
            doubleBite:     { range: [0, 280], windup: 0.46, damage: 0.9, hits: 5, radius: 32, chain: 0.9, follow: 1.35, recover: 0.9 },
            claw:           { range: [0, 260], windup: 0.55, damage: 1.1, hits: 4, reach: 68, spread: 1.6, chain: 0.85, follow: 1.35, recover: 0.95 },
            tripleClaw:     { range: [0, 280], windup: 0.48, damage: 0.9, hits: 7, reach: 72, spread: 1.6, chain: 0.85, follow: 1.35, recover: 0.95 },
            leap:           { range: [140, 460], prepare: 0.82, time: 0.52, damage: 1.3, radius: 52, recover: 1.0 },
            shadowDash:     { range: [0, 700], prepare: 0.42, time: 0.26, dist: 260, recover: 0.4 },
            shadowLeap:     { range: [0, 700], prepare: 0.4, time: 0.24, dist: 240, leapPrepare: 0.46, leapTime: 0.5, damage: 1.3, radius: 54, recover: 0.95 },
            corruptionShot: { range: [160, 900], windup: 0.85, damage: 0.9, count: 5, spread: 0.32, speed: 210, recover: 0.9 },
            corruptionWave: { range: [0, 400], windup: 1.3, damage: 1.3, maxRadius: 260, time: 0.85, band: 28, recover: 1.05 }
        },
        motions: {
            // 下・上向き：歩き・走り・噛みつき・跳びかかりの溜め・跳びかかり・遠吠え・ひっかき の絵がある（ほかは横向きの絵を使う）
            // 横向きの歩きは走りの絵と同じ
            idle: 'alt', walk: 'done', run: 'done', detect: 'alt', bite: 'done', claw: 'done',
            leapPrepare: 'done', leap: 'done', dodge: 'alt', shadowDash: 'alt', corruptionAttack: 'alt',
            howl: 'done', hit: 'temp', stun: 'alt', death: 'temp'
        }
    },
    {
        // 魔道ゴーレム：古代星紋遺跡の防衛装置（バトルモード用の暫定設定。ストーリーの歴史とは別）
        // AI は golem_ai.js（MagicGolemAI）、ステージは ruins_map.js（RuinsMap）
        id: 'magic_golem',
        name: '魔道ゴーレム',
        difficulty: 3,
        level: '上級者向け',
        field: 'ruins',
        fieldName: '古代星紋遺跡',
        status: 'playable',
        features: ['古代遺跡を守る魔導機械', '高い防御力', '強力な範囲攻撃', '魔法陣による特殊攻撃', '上級者向けのボス'],
        ai: 'MagicGolemAI',
        theme: { color: '#7fd6ff', banner: 'golem', flash: '#7fe6ff', arenaTint: 'rgba(20, 50, 120, 0.1)', vignette: 'rgba(5, 10, 40, 0.55)' },
        // 形態ごとに曲が変わる（[第1形態, 第2形態（HP50%以下）, 第3形態（HP25%以下）]）。機械の咆哮が終わってから次の曲
        bgm: ['bgm_boss_golem', 'bgm_boss_golem_p2', 'bgm_boss_golem_p3'],
        introSE: 'boss_intro',  // 名前が出た時の音（モンスター召喚）。この後に起動の音が鳴る
        coins: 30,
        playerLevel: 15,      // 推奨レベル：この戦いは主人公をこのレベルの強さで始める（data/player_stats_table.json）
        elements: { weak: ['水'], resist: ['炎', '風', '雷'] },
        enemy: {
            enemyId: 'boss_003', name: '魔道ゴーレム', displayName: '魔道ゴーレム',
            hp: 2200, attack: 40, defense: 30, magicDefense: 12, exp: 400,
            size: 80, speed: 52, detectionRange: 4000, attackRange: 110,   // 歩く速さ 40 → 52
            isBoss: true, knockbackScale: 0.15
        },
        // 画像は 360×360（足元は上から274px。イノシシ・狼の 320×320 と同じ1ドットの大きさで、まわりに 20px ずつ余白）
        // 画像が読めない時は Enemy.drawGolem（golem_ai.js）のコードで描く姿
        // front：正面の絵しかないモーション（どの向きでも正面の絵） / fallback：横向きの絵がない拳の2発目は、1発目の絵
        // コマは攻撃側で決める（MagicGolemAI.frame）。待機・歩きなどは時間でくり返す
        look: { key: 'magic_golem', golem: true,
            sprite: {
                draw: 2.109375,
                front: ['armSwing', 'magic', 'shield', 'activate', 'phaseChange'],
                fallback: { punch2: 'punch' },
                // 歩き：立つ → 手前の足 → 立つ → 奥の足（足が地面につく2・4コマ目で足音。MagicGolemAI.idleMove） / 待機：息をするように行って戻る
                cycle: { walk: [0, 1, 0, 2], idle: [0, 1, 2, 1] },
                alias: { detect: ['idle', null], turn: ['walk', null], magicCharge: ['magic', null], magicShot: ['magic', null],
                         shockwave: ['stomp', 2], breakdown: ['activate', null], stun: ['idle', 0], hit: ['idle', 0], death: ['activate', 0] },
                speed: { idle: 0.3, walk: 0.3, turn: 0.4, detect: 0.25 }
            } },
        attackInterval: 1.2,   // 前は 1.6（少し早く次の攻撃へ）
        ultimate: 'magicCannon', // 必殺技：最終強化の魔法陣砲撃（光の柱が次々に落ちる）
        // HP50%・25%を切った時、イノシシ・狼より大きく硬くなる（受けるダメージ 0.85→0.7、0.7→0.55）
        phaseBuff: [
            { attack: 1.0,  damageTaken: 1.0 },
            { attack: 1.0,  damageTaken: 0.7 },
            { attack: 1.25, damageTaken: 0.55 }
        ],
        // フェーズ：HP50%以下で2、25%以下で3（イノシシ・狼と同じ）
        // フェーズ1にも腕の振り回し（armSwing）と衝撃波を入れて、最初から手ごわく
        phases: [
            { hp: 1.0, label: '通常', speedMul: 1.0, intervalMul: 1.0, recoverMul: 1.0,
              attacks: { punch: 4, slam: 3, armSwing: 3, shockwave: 1 } },
            // 強化の大技：魔法陣の危険床（ステージが起動した直後に床が光る）／最終強化の大技：必殺技の魔法陣砲撃
            { hp: 0.5, label: '強化', speedMul: 1.15, intervalMul: 0.9, recoverMul: 0.9, transition: 'activate', opener: 'hazardFloor',
              attacks: { punch: 1, punchCombo: 3, slam: 2, armSwing: 2, magicShot: 3, shockwave: 3, hazardFloor: 3, shield: 1 } },
            { hp: 0.25, label: '最終強化', speedMul: 1.25, intervalMul: 0.8, recoverMul: 0.8, transition: 'activate', opener: 'magicCannon',
              attacks: { punchTriple: 3, slam: 1, armSwing: 2, magicCannon: 3, bigShockwave: 3, hazardBarrage: 3, magicShot: 2, shield: 1 } }
        ],
        // 距離（range・reach・radius・maxRadius・band）は Enemy.SCALE.range 倍、弾の速さは Enemy.SCALE.speed 倍される
        // 全体的に溜め・隙を短く、範囲攻撃（叩きつけ・衝撃波・危険床・砲撃・盾）を広く
        // 近接（拳・叩きつけ）は重くゆっくり：溜め・振り抜き（follow 倍）・隙を長く。chain：2発目からの溜めの倍率
        attacks: {
            punch:         { range: [0, 130],  windup: 0.82, damage: 1.0, reach: 90, hits: 2, chain: 0.85, follow: 1.45, recover: 1.0 },
            punchCombo:    { range: [0, 140],  windup: 0.72, damage: 0.9, reach: 92, hits: 3, chain: 0.85, follow: 1.45, recover: 0.95 },
            punchTriple:   { range: [0, 150],  windup: 0.66, damage: 0.9, reach: 95, hits: 5, chain: 0.85, follow: 1.4, recover: 0.85 },
            // 腕の振り回し：両腕を広げて体ごと回り、まわりをなぎ払いながら近づく（spins 回転。フェーズ3は1回多い）→ 目が回って隙
            // 1回転の速さは同じ（time / spins = 0.55秒）のまま、回る回数を 2 → 4 にして長く回る。回り終わりの隙も長く
            armSwing:      { range: [0, 150],  windup: 0.75, damage: 1.0, radius: 85, spins: 4, time: 2.2, dizzy: 1.2, recover: 0.6 },
            slam:          { range: [0, 200],  windup: 1.05, damage: 1.3, reach: 60, radius: 95, stuck: 0.7, recover: 0.95 },
            shockwave:     { range: [0, 260],  windup: 0.8,  damage: 1.2, maxRadius: 210, band: 28, time: 0.8, waves: 1, recover: 0.7 },
            bigShockwave:  { range: [0, 300],  windup: 0.78, damage: 1.3, maxRadius: 260, band: 30, time: 0.85, waves: 3, recover: 0.65 },
            magicShot:     { range: [110, 1200], windup: 0.65, damage: 0.9, count: 5, spread: 0.24, speed: 190, recover: 0.65 },
            hazardFloor:   { range: [0, 1200], windup: 0.85, damage: 1.1, count: 3, radius: 64, waves: 1, recover: 0.65 },
            hazardBarrage: { range: [0, 1200], windup: 0.85, damage: 1.1, count: 4, radius: 64, waves: 4, between: 0.55, recover: 0.6 },
            magicCannon:   { range: [0, 1200], windup: 1.0, damage: 1.6, count: 4, radius: 86, between: 0.42, breakdown: 1.6, recover: 0.5 },
            shield:        { range: [0, 200],  time: 1.1, damage: 0.8, maxRadius: 140, band: 26, recover: 0.6 }
        },
        // 4方向：歩き・待機・拳・叩きつけ・踏みつけ / 正面だけ：腕の振り回し・魔法・防御・起動・形態変化
        // 機能停止・倒れる＝起動の絵（うずくまる） / 衝撃波＝踏みつけの3コマ目 / 拳の2発目＝拳の左右反転（横向きは1発目の絵）
        motions: {
            idle: 'done', activate: 'done', walk: 'done', turn: 'alt', punch: 'done', punch2: 'done', armSwing: 'done', slam: 'done', stomp: 'done',
            magicCharge: 'done', magicShot: 'done', shockwave: 'alt', shield: 'done', phaseChange: 'done',
            hit: 'alt', stun: 'alt', breakdown: 'alt', death: 'alt'
        }
    },
    {
        // 怨嗟の鎧：戦争の遺物・星喰いの残響（バトルモード用の設定。ストーリーの歴史とは別）
        // AI は armor_ai.js（GrudgeArmorAI）、ステージは battlefield_map.js（BattlefieldMap）
        // 魔法の直接のダメージは効かない（物理だけ。第3形態は実体化している時だけ）。炎の魔法は消えた火を灯すのに使う
        id: 'grudge_armor',
        name: '怨嗟の鎧',
        reading: 'えんさのよろい',
        category: '戦争の遺物・星喰いの残響',
        difficulty: 4,
        level: '最上級者向け',
        field: 'battlefield',
        fieldName: '歴戦の跡地',
        status: 'playable',
        features: ['高速居合い', '亡霊分身', '暗闇戦闘', '魔法はほとんど効かない', '炎の魔法で火を灯せる'],
        ai: 'GrudgeArmorAI',
        theme: { color: '#b98aff', banner: 'armor', flash: '#8a5cff', arenaTint: 'rgba(40, 0, 25, 0.1)', vignette: 'rgba(25, 0, 20, 0.55)' },
        // 形態ごとの曲（ファイルがない間は sound.js の fallback：黒蝕狼 → ゴーレム第2・第3形態の曲）
        bgm: ['bgm_boss_armor', 'bgm_boss_armor_p2', 'bgm_boss_armor_p3'],
        introSE: 'armor_intro',
        coins: 40,
        playerLevel: 20,          // 推奨レベル：主人公をこのレベルの強さで始める（data/player_stats_table.json の Lv20）
        guaranteeMagic: ['magic_201'],  // バトルモードのこの戦いだけ、ファイヤーボールを必ずパレットに入れる（火を灯すため）
        magicImmune: true,        // 魔法の直接のダメージは効かない（モンスター選択のカードの表示にも使う）
        phaseNames: true,         // ボスの HP バーに形態の名前（phases[].label）を出す
        cardLabels: { field: 'ステージ', level: '推奨レベル' },
        // 勝ち・負けの画面の文字
        result: { win: 'VICTORY', winSub: '怨嗟の鎧を討伐！', lose: 'DEFEAT', loseSub: '怨嗟の鎧に敗北した……', retry: '再挑戦', coinLabel: '獲得コイン' },
        elements: { weak: [], resist: [] },
        enemy: {
            enemyId: 'boss_004', name: '怨嗟の鎧', displayName: '怨嗟の鎧',
            hp: 3800, attack: 65, defense: 38, exp: 600,
            size: 56, speed: 120, detectionRange: 4000, attackRange: 90,   // 速い（歩く速さ 120 × Enemy.SCALE.speed）
            isBoss: true, knockbackScale: 0.55
        },
        // 画像が届くまでは Enemy.drawGrudgeArmor（armor_ai.js）のコードで描く仮の姿
        // 画像を置いたら look.sprite（イノシシ・狼と同じ書き方）を足し、assets.js の BEAST_SPRITES_READY に 'grudge_armor' を足す
        look: { key: 'grudge_armor', armor: true, cardFit: 70 },
        attackInterval: 2.0,
        ultimate: ['focusIai', 'darkIai'],   // 必殺技：集中居合い・闇の居合い（当たると少し飛ばされて1秒無敵）
        phaseBuff: [
            { attack: 1.0,  damageTaken: 1.0 },
            { attack: 1.05, damageTaken: 0.9 },
            { attack: 1.15, damageTaken: 1.0 }   // 第3形態は斬れる時間が短いので、硬くしない
        ],
        phases: [
            { hp: 1.0, label: '亡霊剣士', speedMul: 1.0, intervalMul: 1.0, recoverMul: 1.0,
              attacks: { drawSlash: 3, stepSlash: 3, doubleSlash: 3, focusIai: 3 } },
            // 移行：刀を地面に突き立て、霧の中に6つの点 → 本体と分身5体。最初の大技は六影風刃
            { hp: 0.5, label: '六影の怨嗟', speedMul: 1.1, intervalMul: 0.9, recoverMul: 0.9, transition: 'sixShadows', opener: 'sixWind',
              attacks: { tripleSlash: 3, windSlash: 3, stepSlash: 2, cloneSummon: 3 } },
            // 移行：火をすべて斬り消す → 暗闇。最初の大技は闇の居合い
            { hp: 0.25, label: '常闇の剣鬼', speedMul: 1.15, intervalMul: 0.9, recoverMul: 0.9, transition: 'eternalDark', opener: 'darkIai',
              attacks: { darkIai: 3, shadowCombo: 3, mistRush: 3 } }
        ],
        // 距離（range・reach・radius・dist）は Enemy.SCALE.range 倍、速さ（speed）は Enemy.SCALE.speed 倍される
        // focus：居合いの集中（予告）の秒数 / over：主人公を通り過ぎて駆け抜ける距離 / windup2：2回目からの溜め
        // 風刃：warn = 撃つ前の線の予告の秒数 / gapMin〜gapMax = 6体が撃つ間隔 / volleyGap = 6体が撃ち終わってから次まで /
        //       shuffleEvery = この回数撃つごとに並び直す / dist = 飛ぶ距離
        attacks: {
            drawSlash:   { range: [90, 380], focus: 0.7, dist: 330, over: 80, speed: 950, radius: 30, damage: 0.9, recover: 1.1 },
            stepSlash:   { range: [0, 200], windup: 0.42, dist: 110, reach: 60, spread: 1.9, damage: 0.75, recover: 1.0 },
            doubleSlash: { range: [0, 125], windup: 0.48, windup2: 0.28, reach: 58, spread: 2.0, damage: 0.65, recover: 1.0 },
            focusIai:    { range: [130, 480], focus: 1.0, dist: 420, over: 90, speed: 1500, radius: 32, damage: 1.05, recover: 1.5 },
            tripleSlash: { range: [0, 130], windup: 0.45, windup2: 0.26, reach: 60, spread: 2.0, damage: 0.6, hits: 3, recover: 1.0 },
            windSlash:   { range: [110, 520], windup: 0.6, count: 3, spread: 0.24, speed: 300, radius: 18, dist: 520, damage: 0.6, recover: 0.9 },
            cloneSummon: { range: [0, 2000] },
            sixWind:     { range: [0, 2000], warn: 0.42, gapMin: 0.2, gapMax: 0.4, volleyGap: 1.2, shuffleEvery: 3, speed: 290, radius: 18, dist: 520, damage: 0.5 },
            darkIai:     { range: [0, 2000], eyes: 0.5, focus: 0.85, dist: 420, over: 100, speed: 1500, radius: 34, damage: 1.0, recover: 1.25 },
            shadowCombo: { range: [0, 2000], hits: 4, around: 85, windup: 0.62, windup2: 0.45, reach: 62, spread: 1.9, damage: 0.55, recover: 1.15 },
            mistRush:    { range: [0, 2000], focus: 0.75, dist: 430, over: 140, speed: 1100, radius: 36, damage: 0.85, recover: 1.1 },
            // 第3形態で火を消しに行く時の速さ（AI が時間で使う。phases の attacks には入れない）
            extinguishFire: { range: [0, 9999], speed: 420, slash: 0.3 }
        },
        // モーション（'temp' = コードで描いている仮の姿）。画像の名前は assets/enemies/grudge_armor/<モーション>_<向き>_<1〜3>.png
        motions: {
            idle: 'temp', walk: 'temp', run: 'temp', drawSword: 'temp', sheathSword: 'temp', slash1: 'temp', slash2: 'temp',
            doubleSlash: 'temp', tripleSlash: 'temp', iaiCharge: 'temp', iaiAttack: 'temp', hit: 'temp', knockback: 'temp', death: 'temp',
            phase2Start: 'temp', cloneSummon: 'temp', windSlash: 'temp', cloneDisappear: 'temp',
            phase3Start: 'temp', extinguishFire: 'temp', darkAura: 'temp', ghostMove: 'temp', glowingEyes: 'temp',
            materialize: 'temp', dematerialize: 'temp', darkIai: 'temp', shadowCombo: 'temp'
        }
    },
    {
        // まだ決まっていないボスの枠
        id: 'unknown',
        name: '？？？',
        difficulty: 5,
        level: '',
        field: '',
        fieldName: '？？？',
        status: 'coming',
        unknown: true,
        features: []
    }
];

// 難易度の低い順（左から）に並べる
BOSS_DATA.sort((a, b) => a.difficulty - b.difficulty);

function getBossData(id) {
    return BOSS_DATA.find(b => b.id === id) || null;
}

// ボスの仮の見た目（Enemy.drawBeastFallback が使う色と形）を登録
if (typeof Enemy !== 'undefined' && Enemy.BEAST_LOOKS) {
    for (const b of BOSS_DATA) {
        if (b.look && b.enemy) Enemy.BEAST_LOOKS[b.enemy.name] = b.look;
    }
}

window.BOSS_DATA = BOSS_DATA;
window.getBossData = getBossData;
