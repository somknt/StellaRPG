// バトルモードの記録（バトルコイン・クリアしたボス・クリアタイムのマイベスト）
// ブラウザの localStorage に保存する（この端末だけの記録。保存できない時は、その間だけ覚えておく）
//
// - ボスを倒すとバトルコインがもらえる：ボスの基本のコイン（boss_data.js の coins）＋ ランクのボーナス
// - ランクはクリアタイムで決まる（BattleRecords.RANKS）
// - クリアタイムは、ボスごとに速い順に MAX_RECORDS 件まで残す（マイベストランキング）

const BattleRecords = {
    KEY: 'hoshinoko.battle.v1',
    MAX_RECORDS: 10,
    // クリアタイム（秒）のランクと、ボーナスのコイン。max 秒以内ならそのランク
    RANKS: [
        { rank: 'SS', max: 30,  bonus: 5 },
        { rank: 'S',  max: 60,  bonus: 4 },
        { rank: 'A',  max: 90,  bonus: 3 },
        { rank: 'B',  max: 120, bonus: 2 },
        { rank: 'C',  max: 180, bonus: 1 },
        { rank: 'D',  max: Infinity, bonus: 0 }
    ],
    
    data: null,
    
    load() {
        if (this.data) return this.data;
        let d = null;
        try {
            const raw = window.localStorage && localStorage.getItem(this.KEY);
            if (raw) d = JSON.parse(raw);
        } catch (e) { d = null; }
        this.data = {
            coins: (d && Number.isFinite(d.coins)) ? d.coins : 0,
            clears: (d && d.clears) || {},     // ボスの id → クリアした回数
            records: (d && d.records) || {}    // ボスの id → [{ time, rank, hero, date }]（速い順）
        };
        return this.data;
    },
    
    save() {
        try {
            if (window.localStorage) localStorage.setItem(this.KEY, JSON.stringify(this.data));
        } catch (e) { /* 保存できなくても遊べる */ }
    },
    
    // クリアタイムは 0.1秒単位にそろえる（表示とランクがずれないように）
    roundTime(sec) { return Math.round(Math.max(0, sec) * 10) / 10; },
    
    rankFor(sec) {
        const t = this.roundTime(sec);
        return this.RANKS.find(r => t <= r.max) || this.RANKS[this.RANKS.length - 1];
    },
    
    // ボスの基本のコイン（難易度★1 = 10枚、★2 = 20枚、★3 = 30枚）
    baseCoins(def) {
        return def && Number.isFinite(def.coins) ? def.coins : (def ? (def.difficulty || 1) * 10 : 0);
    },
    
    // 1:05.3 のような表示
    formatTime(sec) {
        const t = this.roundTime(sec);
        const m = Math.floor(t / 60);
        const s = t - m * 60;
        return `${m}:${s.toFixed(1).padStart(4, '0')}`;
    },
    
    formatDate(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    
    getCoins() { return this.load().coins; },
    clearCount(id) { return this.load().clears[id] || 0; },
    isCleared(id) { return this.clearCount(id) > 0; },
    getRecords(id) { return (this.load().records[id] || []).slice(); },
    getBest(id) { return this.getRecords(id)[0] || null; },
    
    // ボスを倒した：コインを足して、クリアタイムを記録する
    // 戻り値：{ time, rank, base, bonus, gained, coins（今の所持枚数）, place（ランキングの順位。圏外は null）, best（自己ベストか）, first（初めてのクリアか）}
    recordClear(def, sec, hero) {
        const d = this.load();
        const id = def.id;
        const time = this.roundTime(sec);
        const r = this.rankFor(time);
        const base = this.baseCoins(def);
        const gained = base + r.bonus;
        const first = !d.clears[id];
        const prevBest = d.records[id] && d.records[id][0] ? d.records[id][0].time : Infinity;
        d.coins += gained;
        d.clears[id] = (d.clears[id] || 0) + 1;
        const entry = { time, rank: r.rank, hero: hero || 'male', date: new Date().toISOString() };
        const list = (d.records[id] || []).concat([entry]);
        // 速い順（同じタイムなら先に出した記録が上）
        list.sort((a, b) => a.time - b.time || (a.date < b.date ? -1 : 1));
        d.records[id] = list.slice(0, this.MAX_RECORDS);
        const i = d.records[id].indexOf(entry);
        this.save();
        return { time, rank: r.rank, base, bonus: r.bonus, gained, coins: d.coins, place: i >= 0 ? i + 1 : null, best: time < prevBest, first };
    }
};

window.BattleRecords = BattleRecords;
