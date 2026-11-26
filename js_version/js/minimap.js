// 右上の小さな全体マップ（星の酒場・バトルモードのフィールド：闘技場・古代星紋遺跡・歴戦の跡地）
//
// - マップの絵は、フィールドに入った時に1回だけ全体を描いて小さくしておく（毎フレームは、その絵の上に印を描くだけ）
// - 主人公：丸っこい星の印。1P = 赤・2P = 青・3P = 緑・4P = 黄（ソロは 1P の赤）。自分の星は少し大きく、白い輪が光る
//   協力プレイ・PvP はバトルの参加の順（1P がリーダー）。酒場は同じパーティーの人だけ色つき（ほかの人は白い小さな星）
// - 敵：その敵の絵の形（赤いシルエット・暗いふち）だけ。地図で見た時の本当の大きさ（小さい敵は少しだけ大きく）。絵がない敵は色の丸
// - 主人公（酒場は近くの扉も）が地図と重なると、地図をうすくして後ろが見えるようにする
class Minimap {
    constructor(game) {
        this.game = game;
        this.el = document.getElementById('minimap');
        this.canvas = this.el ? this.el.querySelector('canvas') : null;
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.bgFor = null;       // 今の絵を作ったマップ
        this.bg = null;          // 小さくしたマップの絵
        this.fit = null;         // { k, ox, oy }：世界の座標 → 地図の座標
        this.icons = new Map();  // 敵の絵 → シルエット
        this.t = 0;
        this.shown = false;
    }

    // 今、地図を出す場面か。出すなら { map, cam, W, H, tavern }
    scene() {
        const g = this.game;
        if (document.body.classList.contains('battle-result-open') || g.paused) return null;
        if (g.gameState === 'tavern' && g.tavern && g.tavern.inScene && g.tavern.map && g.tavern.view === 'walk') {
            const m = g.tavern.map;
            return { map: m, cam: g.tavern.camera.position, W: m.width * m.tileSize, H: m.height * m.tileSize, tavern: g.tavern };
        }
        if (g.isArena && g.isArena() && g.map) {
            const m = g.map;
            return { map: m, cam: g.camera.position, W: m.width * m.tileSize, H: m.height * m.tileSize, tavern: null };
        }
        return null;
    }

    // 毎フレーム（game.js の gameLoop。描くのは 1秒に 30 回まで）
    update(dt) {
        if (!this.ctx) return;
        const s = this.scene();
        this.show(!!s);
        if (!s) return;
        this.t += dt;
        this._acc = (this._acc || 0) + dt;
        if (this._acc < 1 / 30) return;
        this._acc = 0;
        if (this.bgFor !== s.map) this.build(s);
        this.render(s);
        this.updateFade(s);
    }

    show(v) {
        if (this.shown === v) return;
        this.shown = v;
        this.el.classList.toggle('show', v);
        if (!v) this.el.classList.remove('thru');
    }

    // ---------- マップの絵（1回だけ） ----------
    build(s) {
        const c = this.canvas, CW = c.width, CH = c.height, P = Minimap.PAD * Minimap.RES;
        const k = Math.min((CW - P * 2) / s.W, (CH - P * 2) / s.H);
        this.fit = { k, ox: Math.round((CW - s.W * k) / 2), oy: Math.round((CH - s.H * k) / 2) };
        this.bgFor = s.map;
        this.bg = null;
        try {
            // 全体を本当の大きさで描いて（床・置き物・手前の物）、小さくする
            const big = document.createElement('canvas');
            big.width = Math.ceil(s.W); big.height = Math.ceil(s.H);
            const g = big.getContext('2d');
            const cam = new Vector2(0, 0);
            s.map.draw(g, cam);
            const items = s.map.getDepthItems ? s.map.getDepthItems() : s.map.getDepthDrawables ? s.map.getDepthDrawables(null) : [];
            items.sort((a, b) => a.sortY - b.sortY);
            for (const it of items) it.draw(g, cam);
            if (s.map.drawAbove) s.map.drawAbove(g, cam);
            const small = document.createElement('canvas');
            small.width = Math.max(1, Math.round(s.W * k)); small.height = Math.max(1, Math.round(s.H * k));
            const sg = small.getContext('2d');
            sg.imageSmoothingEnabled = true;
            sg.imageSmoothingQuality = 'high';
            // 大きく縮める時は2回に分けて（細かい模様がざらつかないように）
            if (k < 0.25) {
                const mid = document.createElement('canvas');
                mid.width = Math.round(s.W * 0.25); mid.height = Math.round(s.H * 0.25);
                const mg = mid.getContext('2d');
                mg.imageSmoothingQuality = 'high';
                mg.drawImage(big, 0, 0, mid.width, mid.height);
                sg.drawImage(mid, 0, 0, small.width, small.height);
            } else sg.drawImage(big, 0, 0, small.width, small.height);
            this.bg = small;
            big.width = big.height = 0;
        } catch (e) {
            console.warn('全体マップの絵を作れませんでした:', e);
        }
    }

    // ---------- 描く ----------
    render(s) {
        const g = this.ctx, c = this.canvas, R = Minimap.RES, F = this.fit;
        g.clearRect(0, 0, c.width, c.height);
        g.fillStyle = 'rgba(8, 6, 20, 0.85)';
        g.fillRect(0, 0, c.width, c.height);
        if (this.bg) {
            g.imageSmoothingEnabled = true;
            g.drawImage(this.bg, F.ox, F.oy);
        }
        const X = (x) => F.ox + x * F.k, Y = (y) => F.oy + y * F.k;
        // 今見えている所（うすい白の四角）
        const gc = this.game.canvas;
        g.save();
        g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        g.lineWidth = 1 * R;
        g.strokeRect(Math.round(X(s.cam.x)) + 0.5, Math.round(Y(s.cam.y)) + 0.5, gc.width * F.k, gc.height * F.k);
        g.restore();
        // 酒場：自分のパーティーの扉が開いている時は光らせる
        if (s.tavern) this.drawDoors(g, s, X, Y);
        // ほかの人 → 敵 → 自分 の順（敵の印がほかの人の星にかくれないように。自分はいちばん手前）
        const list = this.players(s);
        for (const p of list) if (!p.me) this.drawStar(g, X(p.x), Y(p.y), p);
        if (!s.tavern) {
            const foes = this.game.enemySpawner.enemies.filter(e => !(e instanceof PvpOpponentRef()) && e.isAlive() && !e.dying);
            // ボスを最後に（いちばん上に）
            foes.sort((a, b) => (Minimap.isBig(a) ? 1 : 0) - (Minimap.isBig(b) ? 1 : 0));
            for (const e of foes) this.drawEnemy(g, e, X(e.position.x), Y(e.position.y));
        }
        for (const p of list) if (p.me) this.drawStar(g, X(p.x), Y(p.y), p);
    }

    drawDoors(g, s, X, Y) {
        const t = s.tavern, p = t.party;
        if (!p) return;
        for (const d of s.map.layers.doors) {
            const open = t.doorOpenFor(d) || (p.kind === d.kind && p.status === 'prep');
            if (!open) continue;
            const a = 0.55 + 0.45 * Math.sin(this.t * 5);
            g.save();
            g.globalAlpha = a;
            g.strokeStyle = d.color || '#ffd76a';
            g.lineWidth = 2 * Minimap.RES;
            g.strokeRect(X(d.x - d.w / 2) - 2, Y(d.doorTop) - 2, d.w * this.fit.k + 4, (d.y - d.doorTop) * this.fit.k + 4);
            g.restore();
        }
    }

    // 主人公の一覧 [{ x, y, slot（0〜3。null = パーティーの外の人）, me, dim }]
    players(s) {
        const g = this.game, out = [];
        const add = (pl, slot, me = false, dim = false) => { if (pl && pl.position) out.push({ x: pl.position.x, y: pl.position.y + (pl.drawSize || 80) * 0.25, slot, me, dim }); };
        if (s.tavern) {
            const t = s.tavern, party = t.party;
            const mySlot = party ? Math.max(0, party.members.findIndex(m => m.me)) : 0;
            for (const r of t.remotes.values()) {
                const mk = r.mark;
                const same = party && mk && mk.p === party.id && Number.isInteger(mk.i);
                add(r.p, same ? mk.i : null);
            }
            add(t.player, mySlot, true);
            return out;
        }
        const coop = g.coop && g.activeBattle === g.bossBattle ? g.coop : null;
        if (coop) {
            coop.battle.members.forEach((id, i) => {
                if (id === coop.pid && !coop.spectator) { add(g.player, i, true, g.player.isDead()); return; }
                const r = coop.remotes.get(id);
                if (r && !r.left) add(r.p, i, false, !!(r.dead || r.p.gone));   // 離脱した人は出さない
            });
            return out;
        }
        const pvp = g.pvp && g.activeBattle === g.pvp ? g.pvp : null;
        if (pvp && pvp.spectator) {
            pvp.members.forEach((m, i) => { const o = pvp.puppets.get(m.pid); if (o) add(o.puppet, i, false, !o.isAlive()); });
            return out;
        }
        if (pvp) {
            const ids = pvp.battle.members;
            const mi = Math.max(0, ids.indexOf(pvp.pid));
            if (pvp.opp) add(pvp.opp.puppet, ids.indexOf(pvp.other.pid) >= 0 ? ids.indexOf(pvp.other.pid) : 1 - mi, false, !pvp.opp.isAlive());
            add(g.player, mi, true, g.player.isDead());
            return out;
        }
        add(g.player, 0, true, g.player.isDead());
        return out;
    }

    // 丸っこい星（角を丸めた五芒星）
    drawStar(g, x, y, p) {
        const R = Minimap.RES;
        const color = p.slot === null ? Minimap.OTHER : Minimap.COLORS[p.slot % 4];
        const r = (p.me ? 6.2 : p.slot === null ? 3.6 : 5.2) * R;
        g.save();
        g.translate(Math.round(x), Math.round(y));
        if (p.dim) g.globalAlpha = 0.45;
        // 自分：まわりに白い輪が広がる
        if (p.me) {
            const k = (this.t * 0.9) % 1;
            g.globalAlpha = (p.dim ? 0.3 : 0.75) * (1 - k);
            g.strokeStyle = '#ffffff';
            g.lineWidth = 1.5 * R;
            g.beginPath();
            g.arc(0, 0, r * (1.1 + k * 1.1), 0, Math.PI * 2);
            g.stroke();
            g.globalAlpha = p.dim ? 0.45 : 1;
        }
        const path = () => {
            g.beginPath();
            for (let i = 0; i < 10; i++) {
                const rr = i % 2 ? r * 0.52 : r;
                const a = -Math.PI / 2 + i * Math.PI / 5;
                g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
            }
            g.closePath();
        };
        g.lineJoin = 'round';
        // 外の黒いふち → 白いふち → 色（太い線の角が丸いので、丸っこい星になる）
        path();
        g.strokeStyle = 'rgba(10, 6, 20, 0.9)';
        g.lineWidth = r * 0.95;
        g.stroke();
        path();
        g.strokeStyle = '#ffffff';
        g.lineWidth = r * 0.62;
        g.stroke();
        path();
        g.strokeStyle = color;
        g.lineWidth = r * 0.3;
        g.stroke();
        g.fillStyle = color;
        g.fill();
        // つや
        g.fillStyle = 'rgba(255, 255, 255, 0.55)';
        g.beginPath();
        g.arc(-r * 0.18, -r * 0.22, r * 0.2, 0, Math.PI * 2);
        g.fill();
        g.restore();
    }

    static isBig(e) { return !!(e.isBoss || e.ai); }
    // 敵：その敵の絵の形（シルエット）だけ。大きさは、地図で見た時の本当の大きさ（小さすぎる敵は Minimap.ICON_MIN まで大きく）
    drawEnemy(g, e, x, y) {
        const icon = this.iconFor(e);
        x = Math.round(x); y = Math.round(y);
        if (icon) { g.drawImage(icon, x - icon.width / 2, y - icon.height / 2); return; }
        // 絵がない敵：色の丸
        const R = Minimap.RES;
        g.save();
        g.fillStyle = Minimap.ENEMY_EDGE;
        g.beginPath(); g.arc(x, y, 3.2 * R, 0, Math.PI * 2); g.fill();
        g.fillStyle = (e.getEnemyColor && e.getEnemyColor()) || Minimap.ENEMY_FILL;
        g.beginPath(); g.arc(x, y, 2.2 * R, 0, Math.PI * 2); g.fill();
        g.restore();
    }

    // シルエットの絵（敵の絵ごと・大きさごとに1回だけ作る）
    iconFor(e) {
        const img = Minimap.enemyArt(e);
        const iw = img && (img.naturalWidth || img.width);
        if (!iw) return null;
        // ゲームの画面に描く大きさ（enemy.js の draw：size × _drawMul。ボスの絵は look.sprite.draw）× 地図の縮み方
        const drawn = (e.size || 40) * (e._drawMul || 1.5);
        const k = Math.round(drawn * this.fit.k / iw * 1000) / 1000;
        let byK = this.icons.get(img);
        if (!byK) { byK = {}; this.icons.set(img, byK); }
        if (byK[k] === undefined) byK[k] = Minimap.silhouette(img, k, Minimap.ICON_MIN * Minimap.RES, Minimap.isBig(e));
        return byK[k];
    }

    // 絵のまわりの透明を切って、k 倍の大きさのシルエットにする（長い方が min より小さい時は min に）
    // 明るい赤の中身に、暗いふち（どの地図の上でも見えるように）。ボスは少し濃い赤
    static silhouette(img, k, min, big) {
        try {
            const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, w, h).data;
            let x0 = w, y0 = h, x1 = -1, y1 = -1;
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                if (d[(y * w + x) * 4 + 3] > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
            }
            if (x1 < 0) return null;
            const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
            const kk = Math.max(k, min / Math.max(bw, bh));
            const tw = Math.max(2, Math.round(bw * kk)), th = Math.max(2, Math.round(bh * kk));
            const tint = (color) => {
                const t = document.createElement('canvas');
                t.width = tw; t.height = th;
                const tg = t.getContext('2d');
                tg.imageSmoothingQuality = 'high';
                tg.drawImage(img, x0, y0, bw, bh, 0, 0, tw, th);
                tg.globalCompositeOperation = 'source-in';
                tg.fillStyle = color;
                tg.fillRect(0, 0, tw, th);
                return t;
            };
            const body = tint(big ? Minimap.BOSS_FILL : Minimap.ENEMY_FILL), edge = tint(Minimap.ENEMY_EDGE);
            const o = 1.2 * Minimap.RES, pad = Math.ceil(o) + 1;
            const out = document.createElement('canvas');
            out.width = tw + pad * 2; out.height = th + pad * 2;
            const og = out.getContext('2d');
            for (let a = 0; a < 12; a++) og.drawImage(edge, pad + Math.cos(a * Math.PI / 6) * o, pad + Math.sin(a * Math.PI / 6) * o);
            og.drawImage(body, pad, pad);
            return out;
        } catch (e) {
            return null;
        }
    }
    // その敵の絵（立っている形の決まった1枚。向きや動きで形が変わってちらつかないように）
    static enemyArt(e) {
        const A = window.assetManager;
        if (!A) return null;
        const name = e.data && e.data.name;
        const look = Enemy.BEAST_LOOKS && Enemy.BEAST_LOOKS[name];
        const keys = [];
        // 獣（猪・狼・ウサギ）は横向きの方が形が分かりやすい。人の形（ゴーレム・鎧）とスライムは正面
        const front = !!(look && (look.golem || look.armor));
        if (look && look.key) {
            if (!front) keys.push(`${look.key}_right_1`);
            keys.push(`${look.key}_down_1`, `${look.key}_idle_down_1`, `${look.key}_walk_down_1`, `${look.key}_down_2`);
        }
        if (name === '角ウサギ') keys.push('horn_rabbit_right_1', 'horn_rabbit_down_1');
        if (e.isSlime) keys.push('starlight_slime_down_1');
        if (name === '草原狼') keys.push('wolf_1');
        for (const k of keys) { const im = A.get(k); if (im) return im; }
        try { return e.getEnemyImage ? e.getEnemyImage() : null; } catch (err) { return null; }
    }

    // 主人公（酒場は近くの扉も）が地図と重なっている時は、うすくする
    updateFade(s) {
        const el = this.el, gc = this.game.canvas;
        const cr = gc.getBoundingClientRect(), br = el.getBoundingClientRect();
        if (!cr.width || !br.width) return;
        const kx = cr.width / gc.width, ky = cr.height / gc.height;
        const toScreen = (x0, y0, x1, y1) => ({ l: cr.left + (x0 - s.cam.x) * kx, t: cr.top + (y0 - s.cam.y) * ky, r: cr.left + (x1 - s.cam.x) * kx, b: cr.top + (y1 - s.cam.y) * ky });
        const hit = (a) => a.l < br.right && a.r > br.left && a.t < br.bottom && a.b > br.top;
        const me = this.players(s).find(p => p.me);
        const pl = s.tavern ? s.tavern.player : this.game.player;
        const sz = (pl && pl.drawSize) || 80;
        let thru = !!me && hit(toScreen(pl.position.x - sz * 0.45, pl.position.y - sz * 0.6, pl.position.x + sz * 0.45, pl.position.y + sz * 0.5));
        if (!thru && s.tavern && pl) for (const d of s.map.layers.doors) {
            if (Math.hypot(pl.position.x - d.x, pl.position.y - d.y) > 300) continue;
            if (hit(toScreen(d.x - d.w / 2 - 20, d.doorTop, d.x + d.w / 2 + 20, d.top + 26))) { thru = true; break; }
        }
        if (el.classList.contains('thru') !== thru) el.classList.toggle('thru', thru);
    }
}
// PvP の相手（主人公なので、敵のシルエットではなく星で出す）
function PvpOpponentRef() { return window.PvpOpponent || Minimap; }

Minimap.RES = 2;                 // 地図の canvas は CSS の大きさの 2倍（くっきり描くため）
Minimap.PAD = 4;                 // 地図のまわりのすき間（CSS の px）
Minimap.COLORS = ['#ff4d5e', '#3d9bff', '#3fd866', '#ffd23f'];   // 1P 赤・2P 青・3P 緑・4P 黄
Minimap.OTHER = '#e8e2ff';       // 酒場の、ほかのパーティーの人
Minimap.ICON_MIN = 9;            // 敵のシルエットのいちばん小さい大きさ（長い方。CSS の px。本当の大きさがこれより小さい敵だけ）
Minimap.ENEMY_FILL = '#ff8a8a';  // 敵のシルエット（明るい赤）
Minimap.BOSS_FILL = '#ff5a4a';   // ボスのシルエット（少し濃い赤）
Minimap.ENEMY_EDGE = '#24060c'; // シルエットのふち（暗い色）

window.Minimap = Minimap;
