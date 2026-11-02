// オンラインの通信（マルチプレイ）
//
// 2つのしくみを使い分ける
//   1. データベースの関数（Account.rpc。online/supabase_setup.sql の hk_mp_*）
//      パーティー・扉・準備完了・バトル開始・報酬など、みんなが同じ結果にならないといけない物。サーバーが人数や権限を確かめる
//   2. Supabase Realtime（WebSocket。js/vendor/supabase.js）
//      酒場の中の位置・向き、戦いの中の動きなど、すぐに届いてほしい物。端末どうしで送り合う（データベースには書かない）
//      presence：だれがチャンネルにいるか（つながった・切れた）/ broadcast：ほかの人へ送る知らせ
//
// 無料のプロジェクトの Realtime は「1秒に100回まで（送った数＋届いた数）」「1か月に200万回まで」なので、送る回数をしぼっている
//   酒場：動いている間だけ 1秒に4回。止まっている時は 2.5秒に1回 / 戦い：2人 8回・3人 6回・4人 5回（mp_battle.js）
const Net = {
    client: null,
    channels: new Set(),
    
    // オンラインの設定があり、オンラインのアカウントでログインしているか
    get available() {
        return !!(window.supabase && window.Account && Account.mode === 'cloud' && Account.loggedIn && Account.user.mode === 'cloud' && Account.token);
    },
    
    getClient() {
        if (this.client) return this.client;
        const c = window.ONLINE_CONFIG || {};
        this.client = window.supabase.createClient(String(c.url).replace(/\/+$/, ''), c.key, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            realtime: { params: { eventsPerSecond: 30 } }
        });
        return this.client;
    },
    
    // マルチプレイの関数を呼ぶ（ログインの鍵を付ける）。だめな時は AccountError（code）
    rpc(fn, args = {}) {
        return Account.rpc(fn, { p_token: Account.token, ...args });
    },
    
    // チャンネルに入る
    //   key：presence の名前（自分。端末ごとにちがう物）/ meta：presence に出す自分の情報（名前など）
    //   on：{ イベント名: (payload) => {} }。'presence' は (今いる人の一覧) => {}、'status' は ('SUBSCRIBED' など) => {}
    join(topic, key, meta, on = {}) {
        const ch = new NetChannel(this, topic, key, meta, on);
        this.channels.add(ch);
        return ch;
    },
    
    leaveAll() {
        for (const ch of [...this.channels]) ch.leave();
    }
};

class NetChannel {
    constructor(net, topic, key, meta, on) {
        this.net = net;
        this.topic = topic;
        this.key = key;
        this.meta = meta;
        this.on = on;
        this.status = 'joining';
        this.closed = false;
        this.sent = 0;            // 送った数（確認用）
        this.received = 0;
        const sb = net.getClient();
        this.ch = sb.channel(topic, { config: { broadcast: { self: false, ack: false }, presence: { key } } });
        this.ch.on('broadcast', { event: '*' }, (m) => {
            this.received++;
            const fn = this.on[m.event];
            if (fn) { try { fn(m.payload || {}); } catch (e) { console.error('受け取った知らせの処理でエラー:', m.event, e); } }
        });
        this.ch.on('presence', { event: 'sync' }, () => {
            if (this.on.presence) { try { this.on.presence(this.members()); } catch (e) { console.error(e); } }
        });
        this.ch.subscribe((status) => {
            if (this.closed) return;
            this.status = status;
            if (status === 'SUBSCRIBED' && this.meta) this.ch.track(this.meta).catch(() => {});
            if (this.on.status) { try { this.on.status(status); } catch (e) { console.error(e); } }
        });
    }
    
    get joined() { return this.status === 'SUBSCRIBED'; }
    
    // ほかの人へ送る（届いたかは確かめない。つながっていない時は捨てる）
    send(event, payload) {
        if (this.closed || !this.joined) return false;
        this.sent++;
        this.ch.send({ type: 'broadcast', event, payload }).catch(() => {});
        return true;
    }
    
    // presence の自分の情報を書きかえる（Realtime の決まりで 30秒に5回まで。よく変わる物は send で送る）
    track(meta) {
        this.meta = meta;
        if (this.joined) this.ch.track(meta).catch(() => {});
    }
    
    // 今チャンネルにいる人：[{ key, meta }]（同じ key で何度も入っていたら最後の物）
    members() {
        const st = this.ch.presenceState();
        return Object.entries(st).map(([key, list]) => ({ key, meta: list[list.length - 1] || {} }));
    }
    
    leave() {
        if (this.closed) return;
        this.closed = true;
        this.net.channels.delete(this);
        try { this.ch.untrack().catch(() => {}); } catch (e) { /* もう切れている */ }
        try { this.net.getClient().removeChannel(this.ch); } catch (e) { /* もう切れている */ }
    }
}

window.Net = Net;
window.NetChannel = NetChannel;
