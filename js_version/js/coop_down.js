// 協力プレイのダウンと蘇生（mp_battle.js の CoopBattle に足す）
//
// - HP が 0 になると「ダウン」：その場に倒れる。とてもゆっくりなら動ける（攻撃・魔法・回避はできない）
//   ダウン中の体力（最大 HP の CoopBattle.DOWN.hpRate）があり、画面の下に真っ赤なゲージで出す。画面のふちも赤く脈打つ
//   ダウン中にやられて、この体力が 0 になると「戦闘不能」：生きている仲間の戦いを見る（◀ ▶ で見る人を変える）
//   2回目のダウンはこの体力が半分、3回目は4分の1から始まる（失った分はゲージの右に暗く出す）。4回目は、すぐ戦闘不能
//   この体力は、何もされなくても少しずつ減る（満タンから CoopBattle.DOWN.drainSec 秒で 0 → 戦闘不能）
// - 蘇生のゲージがたまっている間は、足元に治癒の魔法陣とヒールの十字の粒・星。起き上がる時はヒールの光（magic.js の HealEffect）
// - 蘇生：画面の下の蘇生ボタン（PC は R キー）を長く押し続けるとゲージがたまり、たまると HP 30% で起き上がる
//   ダウンしている仲間の近くに行くと、同じボタンが「手助け」になる。手助けしている間は、その仲間のゲージが速くたまる
//   （自分で押していなくても、仲間の手助けだけでもたまる）
// - 全員がダウンか戦闘不能になると、クエスト失敗（ホストが決める。mp_battle.js の checkAllDown）
//
// 通信：自分の様子（'c'・'h' の主人公の様子）に、ダウン（dn）・ダウン中の体力（dh）・蘇生のゲージ（rv）・手助けしている人（hv）
//   蘇生のゲージは、ダウンした人の端末が進める（手助けの人は「この人を手伝っている」と送るだけ。近くにいるかも、ダウンした人の端末が確かめる）
(function () {
    const P = CoopBattle.prototype;

    // ---------- 始める・やめる ----------
    // ダウン中・戦闘不能の時のダメージは、主人公の HP ではなくダウン中の体力へ
    P.attachDown = function () {
        const p = this.game.player;
        const orig = p.takeDamage;
        this._downPlayer = p;
        this._origTakeDamage = orig;
        const self = this;
        p.takeDamage = function (damage, from = null, opts = null) {
            if (self.game.coop === self && self.life === 'down') return self.hitWhileDown(damage, from);
            if (self.game.coop === self && self.life === 'dead') return 0;
            return orig.call(this, damage, from, opts);
        };
        CoopBattle.bindReviveButton();
    };

    P.stopDown = function () {
        if (this._downPlayer && this._origTakeDamage) this._downPlayer.takeDamage = this._origTakeDamage;
        this._downPlayer = null;
        this._origTakeDamage = null;
        CoopBattle.btnHeld = false;
        const u = CoopBattle.downUI();
        if (u.gauge) u.gauge.hidden = true;
        if (u.btn) u.btn.hidden = true;
        document.body.dataset.coopdown = '';
        document.body.classList.remove('coop-dead');
    };

    // ---------- ダウン・戦闘不能・蘇生 ----------
    // 自分の HP が 0（game.js が毎フレーム呼ぶ）
    P.onLocalDead = function () {
        if (this.spectator || this.ended || this.life !== 'alive') return;
        if (this.bb && this.bb.isOver) return;
        this.goDown();
    };

    // ダウンするたびに、ダウン中の体力の始めが減る（1回目 全部・2回目 半分・3回目 4分の1）。4回目はそのまま戦闘不能
    P.goDown = function () {
        const p = this.game.player, D = CoopBattle.DOWN;
        if (p.isChanting) p.cancelChant();
        p.cancelAttack();
        p.attackCancelled = false;
        p.isDodging = false;
        p.readyCast = null;
        p.currentHP = 0;
        this.downCount = (this.downCount || 0) + 1;
        this.downMax = Math.max(1, Math.round(p.maxHP * D.hpRate));
        const start = D.startRates[this.downCount - 1];
        if (start === undefined) { this.downStart = 0; this.goDead(); return; }
        this.life = 'down';
        this.downStart = start;
        this.downHP = Math.max(1, Math.round(this.downMax * start));
        this.revive = 0;
        this.fxBurst(p, 'down');
        playSE('damage');
        this.sendTick();
    };

    // ダウン中にやられた：ダウン中の体力が減る（回避はできない）。0 で戦闘不能
    P.hitWhileDown = function (damage) {
        const p = this.game.player;
        if (p.invincibleTime > 0 || p.justGuardTime > 0) return 0;
        const d = Math.max(1, Math.round((Number(damage) || 0) - p.defense));
        this.downHP = Math.max(0, this.downHP - d);
        p.hitFlash = Player.HIT_FLASH.time;
        this.downHit = 0.35;
        playSE('damage');
        if (this.downHP <= 0) this.goDead();
        return d;
    };

    P.goDead = function () {
        const p = this.game.player;
        this.life = 'dead';
        this.revive = 0;
        this.downHP = 0;
        this.fxBurst(p, 'dead');
        playSE('ui_cancel');
        this.sendTick();
        // 生きている仲間の戦いを見る（◀ ▶・←→ で見る人を変える）
        document.body.classList.add('coop-dead');
        if (window.WatchBar) WatchBar.show(this);
        this.followWatched(true);
    };

    P.reviveDone = function () {
        const p = this.game.player, D = CoopBattle.DOWN;
        this.life = 'alive';
        this.revive = 0;
        this.downHP = 0;
        p.currentHP = Math.max(1, Math.round(p.maxHP * D.reviveHP));
        p.invincibleTime = D.invincible;
        p.hitChain = 0;
        p.hitStun = 0;
        this.fxBurst(p, 'revive');
        playSE('heal');
        this.sendTick();
    };

    // 蘇生のボタン（または R キー）を押しているか
    P.reviveHeld = function () {
        const inp = this.game.input;
        return !!(CoopBattle.btnHeld || (inp && inp.isKeyDown && inp.isKeyDown('KeyR')));
    };

    // ダウン中の操作：移動だけ（とてもゆっくり）。攻撃・魔法・回避はできない（game.js が使う）
    P.downInput = function (input) {
        const k = CoopBattle.DOWN.moveMul;
        if (!this._downIn) this._downIn = {
            isKeyPressed: () => false,
            isDodgePressed: () => false,
            consumeMagicSelection: () => null,
            getMovementVector: () => this._downSrc.getMovementVector().mult(k)
        };
        this._downSrc = input;
        return this._downIn;
    };

    // ---------- 毎フレーム ----------
    P.updateDown = function (dt) {
        const p = this.game.player, D = CoopBattle.DOWN, now = performance.now();
        const fighting = !this.ended && this.bb && this.bb.state === 'fight' && !this.bb.isOver;
        const hold = fighting && this.reviveHeld();
        if (this.downHit > 0) this.downHit = Math.max(0, this.downHit - dt);
        // 戦闘不能：生きている仲間を見る（◀ ▶・←→）
        if (this.life === 'dead' && window.WatchBar) { WatchBar.handleKeys(this, this.game.input); this.followWatched(); }
        // 手伝える仲間：自分が戦っていて、近くでダウンしている人（いちばん近い人）
        this.helpT = null;
        if (fighting && this.life === 'alive' && !p.isDead()) {
            let bd = Infinity;
            for (const [id, r] of this.remotes) {
                if (!r.down || r.dead || r.p.gone) continue;
                const d = r.p.position.distance(p.position);
                if (d <= D.helpR && d < bd) { bd = d; this.helpT = id; }
            }
        }
        this.helping = !!(this.helpT && hold);
        // 手助けの光：自分 → 仲間
        if (this.helping) {
            const r = this.remotes.get(this.helpT);
            if (r) this.helpSparks(dt, p, r.p);
        }
        // ダウン中：蘇生のゲージ（自分で押す ＋ 手伝ってくれている仲間の数）
        if (this.life === 'down' && fighting) {
            let n = 0;
            for (const r of this.remotes.values()) {
                if (r.hv !== this.pid || now - (r.hvAt || 0) > D.helpFreshMs || r.dead || r.down || r.p.gone) continue;
                if (r.p.position.distance(p.position) > D.helpR + D.helpSlack) continue;
                n++;
            }
            this.helpers = n;
            const rate = (hold ? D.selfRate : 0) + CoopBattle.helpRate(n);
            this.reviveRate = rate;
            this.revive = Math.min(1, this.revive + rate * dt);
            if (rate > 0) this.reviveGlow = (this.reviveGlow || 0) + dt;
            if (this.revive >= 1) this.reviveDone();
            else {
                // ダウン中の体力は、いつも少しずつ減る（満タンから D.drainSec 秒で 0 → 戦闘不能）
                this.downHP = Math.max(0, this.downHP - this.downMax / D.drainSec * dt);
                if (this.downHP <= 0) this.goDead();
            }
        } else this.reviveRate = 0;
        this.updateDownUI(hold, fighting);
    };

    // 画面の下：真っ赤なダウン中の体力・蘇生のボタン（まわりの輪が蘇生のゲージ）・画面のふちの赤
    P.updateDownUI = function (hold, fighting) {
        const u = CoopBattle.downUI();
        const down = this.life === 'down' && fighting;
        const v = down ? '1' : '';
        if (document.body.dataset.coopdown !== v) document.body.dataset.coopdown = v;
        if (u.gauge) {
            if (u.gauge.hidden === down) u.gauge.hidden = !down;
            if (down) {
                const k = this.downMax ? this.downHP / this.downMax : 0;
                u.fill.style.width = (k * 100).toFixed(1) + '%';
                // 2回目・3回目のダウン：始めから失っている分（右側）は、暗いしま模様でふさぐ
                if (u.lock) {
                    const lost = 1 - (this.downStart ?? 1);
                    u.lock.hidden = lost <= 0;
                    u.lock.style.width = (lost * 100).toFixed(1) + '%';
                }
                u.gauge.classList.toggle('hit', this.downHit > 0);
                u.gauge.classList.toggle('low', k <= 0.35);
                if (u.fx) u.fx.style.setProperty('--danger', (1 - k).toFixed(2));
            }
        }
        if (!u.btn) return;
        const help = !down && !!this.helpT && fighting;
        const show = down || help;
        if (u.btn.hidden === show) u.btn.hidden = !show;
        if (!show) return;
        // スマホ：回避ボタンのすぐ左に置く（出た時と、0.5秒ごと：画面の向き・大きさが変わった時のため）
        const now = performance.now();
        if (!(now - (CoopBattle._placedAt || 0) < 500)) { CoopBattle._placedAt = now; CoopBattle.placeReviveButton(u.btn); }
        u.btn.classList.toggle('help', help);
        u.btn.classList.toggle('on', !!hold);
        u.btn.classList.toggle('helped', down && this.helpers > 0);
        // 手伝ってくれている人数（多いほど緑の光が強い・輪が速くたまる）
        const hn = down ? String(Math.min(3, this.helpers || 0)) : '0';
        if (u.btn.dataset.helpers !== hn) u.btn.dataset.helpers = hn;
        const r = help ? this.remotes.get(this.helpT) : null;
        const prog = down ? this.revive : r ? r.rv || 0 : 0;
        if (u.ring) u.ring.style.strokeDashoffset = (CoopBattle.RING_LEN * (1 - prog)).toFixed(1);
    };

    // ---------- 演出 ----------
    // who：主人公（Player）。位置はその人について動く
    P.fxBurst = function (who, kind) {
        if (!who) return;
        this.dfx.push({ kind, who, t: 0, life: kind === 'revive' ? 1.3 : kind === 'down' ? 0.9 : 1.4,
            seed: Math.random() * 10, x: who.position.x, y: who.position.y });
        // 起き上がった時：ヒールのエフェクトシートの光（魔法陣 → 光の柱 → 十字の光・十字の粒・星のきらめき。magic.js の HealEffect）
        if (kind === 'revive' && this.game.magicSystem) this.game.magicSystem.addHeal(who);
        if (this.dfx.length > 120) this.dfx.splice(0, this.dfx.length - 120);
    };

    // 蘇生のゲージがたまっている人から、ヒールの十字の粒（heal_plus）と星のきらめき（heal_star）を出す
    // rate：1秒にたまる量（手伝う人が多いほど速い → 粒も多い）
    P.chargeFx = function (dt, who, rate) {
        who._charge = Math.min(1, (who._charge || 0) + dt * 4);
        who._chargeRate = rate;
        who._chargeT = (who._chargeT || 0) + dt;
        const every = 1 / (3 + rate * 40);
        while (who._chargeT >= every) {
            who._chargeT -= every;
            const star = Math.random() < 0.22;
            this.dfx.push({ kind: star ? 'hstar' : 'hplus', who, t: 0, life: star ? 0.5 : 0.9,
                ox: (Math.random() - 0.5) * 56, oy: (Math.random() - 0.5) * 14, size: 0.7 + Math.random() * 0.5, seed: Math.random() * 6.28 });
        }
    };

    // 手助けの光の粒（from から to へ流れる）
    P.helpSparks = function (dt, from, to) {
        this._sparkT = (this._sparkT || 0) + dt;
        while (this._sparkT >= 0.05) {
            this._sparkT -= 0.05;
            this.dfx.push({ kind: 'spark', from, to, t: 0, life: 0.55, off: (Math.random() - 0.5) * 30, seed: Math.random() * 6.28 });
        }
    };

    P.updateDownFx = function (dt) {
        const now = performance.now();
        // 蘇生のゲージがたまっている人：ヒールの粒（自分は今の速さ、ほかの人は届いたゲージの増え方から）
        const fade = (who) => { if (who._charge) who._charge = Math.max(0, who._charge - dt * 2); who._chargeT = 0; };
        const me = this.spectator ? null : this.game.player;
        if (me) {
            if (this.life === 'down' && this.reviveRate > 0) this.chargeFx(dt, me, this.reviveRate);
            else fade(me);
        }
        for (const r of this.remotes.values()) {
            if (r.down && !r.dead && now - (r.rvUpAt || 0) < 450) this.chargeFx(dt, r.p, r.rvRate || CoopBattle.DOWN.selfRate);
            else fade(r.p);
        }
        // ほかの人の手助け（届いた hv）：その人 → 手伝っている人
        for (const r of this.remotes.values()) {
            if (!r.hv || now - (r.hvAt || 0) > CoopBattle.DOWN.helpFreshMs || r.down || r.dead) continue;
            const t = r.hv === this.pid && !this.spectator ? this.game.player : (this.remotes.get(r.hv) || {}).p;
            if (!t) continue;
            r._sparkT = (r._sparkT || 0) + dt;
            while (r._sparkT >= 0.07) { r._sparkT -= 0.07; this.dfx.push({ kind: 'spark', from: r.p, to: t, t: 0, life: 0.55, off: (Math.random() - 0.5) * 30, seed: Math.random() * 6.28 }); }
        }
        for (const f of this.dfx) f.t += dt;
        this.dfx = this.dfx.filter(f => f.t < f.life);
    };

    P.drawDownFx = function (ctx, cam) {
        if (!this.dfx.length) return;
        ctx.save();
        for (const f of this.dfx) {
            const k = f.t / f.life;
            if (f.kind === 'spark') {
                const a = f.from.position, b = f.to.position;
                const e = 1 - Math.pow(1 - k, 2);
                const x = a.x + (b.x - a.x) * e + Math.sin(f.seed + k * 6) * f.off * (1 - e) - cam.x;
                const y = a.y + (b.y - a.y) * e - Math.sin(k * Math.PI) * 26 - cam.y;
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = Math.min(1, (1 - k) * 1.6);
                ctx.fillStyle = k < 0.5 ? '#fff6c8' : '#9dffb8';
                const s = 3.5 * (1 - k * 0.5);
                ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
                continue;
            }
            const x = (f.who ? f.who.position.x : f.x) - cam.x, y = (f.who ? f.who.position.y : f.y) - cam.y;
            if (f.kind === 'hplus') {
                // ヒールの十字の粒：倒れた体のまわりから、ゆれながら立ちのぼって消える
                ctx.globalCompositeOperation = 'source-over';
                const a = Math.min(1, f.t / 0.12) * Math.min(1, (f.life - f.t) / 0.35);
                const px = x + f.ox + Math.sin(f.t * 7 + f.seed) * 3, py = y + 16 + f.oy - f.t * 62;
                ctx.globalAlpha = 1;
                if (hasMagicFx('heal_plus')) drawMagicFx(ctx, 'heal_plus', 0, px, py, magicFxScale('heal_plus', 15 * f.size, 'w'), 0, a);
                else {
                    ctx.globalAlpha = a;
                    ctx.fillStyle = '#9dffbe';
                    const s = Math.round(3 * f.size);
                    ctx.fillRect(Math.round(px - s * 1.5), Math.round(py - s / 2), s * 3, s);
                    ctx.fillRect(Math.round(px - s / 2), Math.round(py - s * 1.5), s, s * 3);
                }
                continue;
            }
            if (f.kind === 'hstar') {
                // ヒールの星のきらめき（2コマを一度だけ）
                if (!hasMagicFx('heal_star')) continue;
                const st = magicFxOnce('heal_star', f.t, 0.08, 0.25);
                if (!st) continue;
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 1;
                drawMagicFx(ctx, 'heal_star', st.frame, x + f.ox, y - 6 + f.oy - f.t * 20, magicFxScale('heal_star', 26 * f.size, 'w'), 0, st.alpha);
                continue;
            }
            ctx.globalCompositeOperation = 'lighter';
            if (f.kind === 'down') {
                // 赤い輪が広がって、赤いかけらが飛び散る
                ctx.globalAlpha = 1 - k;
                ctx.strokeStyle = '#ff2a3a';
                ctx.lineWidth = 5 * (1 - k) + 1;
                ctx.beginPath(); ctx.ellipse(x, y + 22, 20 + k * 80, (20 + k * 80) * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = '#ff6a6a';
                for (let i = 0; i < 10; i++) {
                    const ang = f.seed + i * 0.63, d = k * 60;
                    ctx.fillRect(x + Math.cos(ang) * d - 2, y + Math.sin(ang) * d * 0.6 - 10 - k * 20, 4, 4);
                }
            } else if (f.kind === 'revive') {
                // 光の柱は、ヒールのエフェクトシートの光（fxBurst の addHeal）。ここでは足元に広がる輪と、上る光の粒だけ
                ctx.globalAlpha = 1 - k;
                ctx.strokeStyle = '#ffe08a';
                ctx.lineWidth = 4;
                ctx.beginPath(); ctx.ellipse(x, y + 26, 18 + k * 90, (18 + k * 90) * 0.38, 0, 0, Math.PI * 2); ctx.stroke();
                ctx.strokeStyle = '#9dffb8';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.ellipse(x, y + 26, 10 + k * 60, (10 + k * 60) * 0.38, 0, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = '#fff6c8';
                for (let i = 0; i < 14; i++) {
                    const ang = f.seed + i * 0.45, r = 14 + (i % 4) * 9;
                    const py = y + 20 - ((k * 140 + i * 13) % 140);
                    ctx.fillRect(x + Math.cos(ang) * r - 1.5, py, 3, 3);
                }
            } else if (f.kind === 'dead') {
                // 暗い輪と、空へ上る白い光（たましい）
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = (1 - k) * 0.7;
                ctx.strokeStyle = '#5a5070';
                ctx.lineWidth = 4;
                ctx.beginPath(); ctx.ellipse(x, y + 24, 16 + k * 70, (16 + k * 70) * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 1 - k;
                const sy = y - 10 - k * 120;
                const gl = ctx.createRadialGradient(x, sy, 0, x, sy, 18);
                gl.addColorStop(0, 'rgba(230, 240, 255, 0.95)');
                gl.addColorStop(1, 'rgba(160, 190, 255, 0)');
                ctx.fillStyle = gl;
                ctx.beginPath(); ctx.arc(x + Math.sin(k * 9) * 6, sy, 18, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.restore();
    };

    // 倒れた主人公（ダウン：足元が赤く脈打つ / 戦闘不能：灰色でうすく）。revive：蘇生のゲージ（足元の金の輪）
    P.drawLying = function (ctx, cam, p, dead, revive = 0) {
        const t = performance.now() / 1000;
        const x = Math.round(p.position.x - cam.x), y = Math.round(p.position.y - cam.y);
        const gy = y + p.drawSize * 0.32;
        ctx.save();
        if (!dead) {
            // 足元：赤い光が心臓のように脈打つ
            const beat = Math.pow(Math.max(0, Math.sin(t * 6.5)), 6);
            ctx.globalCompositeOperation = 'lighter';
            const gl = ctx.createRadialGradient(x, gy, 0, x, gy, 52);
            gl.addColorStop(0, `rgba(255, 30, 50, ${0.35 + 0.35 * beat})`);
            gl.addColorStop(1, 'rgba(255, 0, 30, 0)');
            ctx.fillStyle = gl;
            ctx.beginPath(); ctx.ellipse(x, gy, 52, 22, 0, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = `rgba(255, 60, 70, ${0.55 + 0.4 * beat})`;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(x, gy, 36 + beat * 4, 14 + beat * 2, 0, 0, Math.PI * 2); ctx.stroke();
            // 蘇生のゲージがたまっている間：足元に治癒の魔法陣（ヒールと同じ）。速くたまるほど速く回り、たまるほど濃い
            const ch = p._charge || 0;
            if (ch > 0 && typeof drawMagicCircle === 'function') {
                const spin = (p._spin = (p._spin || 0) + 0.016 * (1.2 + (p._chargeRate || 0) * 14));
                const glow = ctx.createRadialGradient(x, gy, 0, x, gy, 60);
                glow.addColorStop(0, `rgba(120, 255, 170, ${0.32 * ch})`);
                glow.addColorStop(1, 'rgba(70, 217, 126, 0)');
                ctx.fillStyle = glow;
                ctx.globalCompositeOperation = 'lighter';
                ctx.beginPath(); ctx.ellipse(x, gy, 60, 26, 0, 0, Math.PI * 2); ctx.fill();
                ctx.globalCompositeOperation = 'source-over';
                drawMagicCircle(ctx, x, gy, 40 + revive * 10, '癒', spin, ch * (0.45 + 0.45 * revive), 0.45);
            }
            // 蘇生のゲージ：足元の金の輪が、たまった分だけつながる
            if (revive > 0) {
                ctx.strokeStyle = '#ffe08a';
                ctx.lineWidth = 4;
                ctx.shadowColor = 'rgba(255, 220, 120, 0.9)';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.ellipse(x, gy, 42, 17, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * revive);
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
        }
        // 体を横に倒して描く（向いている方へ倒れる）
        ctx.translate(x, y + p.drawSize * 0.2);
        ctx.rotate(p.direction === 'left' ? -Math.PI / 2 : Math.PI / 2);
        ctx.translate(-x, -y);
        if (dead) { ctx.globalAlpha = 0.5; ctx.filter = 'grayscale(1) brightness(0.8)'; }
        p.draw(ctx, cam);
        ctx.restore();
    };

    // ---------- ドットのハート（頭の上の印・蘇生のボタンで同じ形を使う） ----------
    // '#'：ハート。まわりの1マスに黒っぽいふちを付け、左上を明るく・右下を暗くする
    CoopBattle.HEART = [
        '.##...##.',
        '####.####',
        '#########',
        '#########',
        '.#######.',
        '..#####..',
        '...###...',
        '....#....'
    ];
    // c：'o' ふち / 'f' 赤 / 's' 影 / 'h' 光
    CoopBattle.HEART_COLORS = { o: '#3a0610', f: '#ff2a40', s: '#b0101f', h: '#ffd0d6' };
    CoopBattle.heartPixels = function () {
        if (CoopBattle._heart) return CoopBattle._heart;
        const H = CoopBattle.HEART, h = H.length, w = H[0].length;
        const on = (x, y) => y >= 0 && y < h && x >= 0 && x < w && H[y][x] === '#';
        const px = [];
        for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
            if (on(x, y)) {
                let c = 'f';
                if ((y === 1 && (x === 1 || x === 2)) || (y === 2 && x === 1)) c = 'h';
                else if (!on(x + 1, y) || !on(x, y + 1)) c = 's';
                px.push({ x: x + 1, y: y + 1, c });
            } else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) px.push({ x: x + 1, y: y + 1, c: 'o' });
        }
        CoopBattle._heart = { w: w + 2, h: h + 2, px };
        return CoopBattle._heart;
    };
    // (cx, cy) をまん中に、1マス s ピクセルで描く。bright：脈打った瞬間（赤を明るく）
    CoopBattle.drawPixelHeart = function (ctx, cx, cy, s, bright = 0) {
        const H = CoopBattle.heartPixels(), C = CoopBattle.HEART_COLORS;
        const x0 = Math.round(cx - H.w * s / 2), y0 = Math.round(cy - H.h * s / 2);
        const f = bright > 0.5 ? '#ff6a78' : C.f, sh = bright > 0.5 ? '#e0283a' : C.s;
        for (const p of H.px) {
            ctx.fillStyle = p.c === 'f' ? f : p.c === 's' ? sh : C[p.c];
            ctx.fillRect(x0 + p.x * s, y0 + p.y * s, s, s);
        }
    };

    // 頭の上の印：ドットの赤いハートが脈打つ（ダウン中の体力が少ないほど速く）。まわりの金の輪が蘇生のゲージ
    CoopBattle.drawReviveMark = function (ctx, x, y, revive, hpk) {
        const t = performance.now() / 1000;
        const speed = 5 + (1 - Math.max(0, Math.min(1, hpk))) * 7;
        const beat = Math.pow(Math.max(0, Math.sin(t * speed)), 4);
        const R = 18;
        ctx.save();
        ctx.translate(x, y);
        // 輪（たまっていない所はうすく）
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10, 6, 20, 0.75)';
        ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
        if (revive > 0) {
            ctx.strokeStyle = '#ffe08a';
            ctx.shadowColor = 'rgba(255, 220, 120, 0.9)';
            ctx.shadowBlur = 6;
            ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * revive); ctx.stroke();
            ctx.shadowBlur = 0;
        }
        // 赤い光（脈打つ）
        ctx.globalCompositeOperation = 'lighter';
        const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, R + 2);
        gl.addColorStop(0, `rgba(255, 40, 60, ${0.3 + 0.45 * beat})`);
        gl.addColorStop(1, 'rgba(255, 0, 30, 0)');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(0, 0, R + 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // ドットのハート（脈打つ時は明るく。大きさは変えない：ドットがにじまないように）
        CoopBattle.drawPixelHeart(ctx, 0, 0, 2, beat);
        ctx.restore();
    };

    // 蘇生のボタンのハートを、ドットで作る（index.html の <g class="cr-heart">）
    CoopBattle.buildButtonHeart = function (g) {
        if (!g || g._built) return;
        g._built = true;
        const H = CoopBattle.heartPixels(), C = CoopBattle.HEART_COLORS, s = 4;
        const x0 = 50 - H.w * s / 2, y0 = 52 - H.h * s / 2;
        const ns = 'http://www.w3.org/2000/svg';
        for (const p of H.px) {
            const r = document.createElementNS(ns, 'rect');
            r.setAttribute('x', x0 + p.x * s);
            r.setAttribute('y', y0 + p.y * s);
            // となりのマスとのすき間が見えないよう、少しだけ大きく
            r.setAttribute('width', s + 0.3);
            r.setAttribute('height', s + 0.3);
            r.setAttribute('class', 'ch-' + p.c);
            r.setAttribute('fill', C[p.c]);
            g.appendChild(r);
        }
    };

    // ---------- 画面の部品（index.html） ----------
    CoopBattle.downUI = function () {
        if (CoopBattle._ui) return CoopBattle._ui;
        const $ = (id) => document.getElementById(id);
        CoopBattle._ui = { gauge: $('coop-down'), fill: $('cd-fill'), lock: $('cd-lock'), fx: $('coop-down-fx'), btn: $('coop-revive'), ring: $('cr-ring') };
        return CoopBattle._ui;
    };

    // スマホ：蘇生のボタンを、右手の親指で届く所（回避ボタンのすぐ左・同じ高さ）に置く
    // ボタンは #game-container（1280×720 を画面に合わせて縮めたもの）の中、回避ボタンは画面そのものの中にあるので、
    // 画面の位置からゲーム画面の中の位置に直す。PC は CSS の位置のまま（ダウン中の体力のゲージの右）
    CoopBattle.placeReviveButton = function (btn) {
        if (!btn) return;
        const st = btn.style;
        if (!document.body.classList.contains('touch')) {
            if (btn._placed) { st.left = st.bottom = st.width = st.height = ''; btn._placed = false; }
            return;
        }
        const cont = document.getElementById('game-container'), dodge = document.getElementById('btn-dodge');
        if (!cont || !dodge) return;
        const cr = cont.getBoundingClientRect(), dr = dodge.getBoundingClientRect();
        if (!cr.width || !dr.width) return;
        const k = cr.width / 1280;              // ゲーム画面の 1px が、画面の何 px か
        const size = dr.width * 1.15;           // 回避ボタンより少し大きく
        const gap = dr.width * 0.22;
        const right = dr.left - gap, bottom = dr.bottom;
        let L = (right - size - cr.left) / k, B = (cr.bottom - bottom) / k;
        const S = size / k;
        L = Math.max(0, Math.min(1280 - S, L));
        B = Math.max(0, Math.min(720 - S, B));
        st.left = L.toFixed(1) + 'px';
        st.bottom = B.toFixed(1) + 'px';
        st.width = st.height = S.toFixed(1) + 'px';
        btn._placed = true;
    };

    // 蘇生のボタン：押している間だけ（指・マウスを離す・外へずらすと止まる）
    CoopBattle.bindReviveButton = function () {
        const b = CoopBattle.downUI().btn;
        if (!b || b._bound) return;
        b._bound = true;
        CoopBattle.buildButtonHeart(b.querySelector('.cr-heart'));
        const on = (e) => { e.preventDefault(); e.stopPropagation(); CoopBattle.btnHeld = true; try { b.setPointerCapture(e.pointerId); } catch (err) { /* できない時 */ } };
        const off = (e) => { if (e) e.stopPropagation(); CoopBattle.btnHeld = false; };
        b.addEventListener('pointerdown', on);
        b.addEventListener('pointerup', off);
        b.addEventListener('pointercancel', off);
        b.addEventListener('lostpointercapture', off);
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('blur', () => off());
    };

    // 手伝ってくれる仲間が n 人の時に、1秒にたまる量（仲間だけで：1人 10秒・2人 4秒・3人 約2.2秒）
    CoopBattle.helpRate = function (n) {
        const D = CoopBattle.DOWN;
        return n > 0 ? n * D.helpRate * (1 + D.helpBonus * (n - 1)) : 0;
    };

    CoopBattle.btnHeld = false;
    CoopBattle.RING_LEN = 276.5;   // 蘇生のボタンの輪の長さ（2π × 44）
    CoopBattle.DOWN = {
        hpRate: 0.5,         // ダウン中の体力：最大 HP のこの割合
        reviveHP: 0.3,       // 起き上がった時の HP：最大 HP のこの割合
        invincible: 2.0,     // 起き上がった後の無敵（秒）
        moveMul: 0.16,       // ダウン中の動く速さ（ふつうのこの割合）
        startRates: [1, 0.5, 0.25], // ダウンした回数ごとの、ダウン中の体力の始め（downMax に対する割合）。これより多いと戦闘不能
        selfRate: 1 / 18,    // 自分で押している時、1秒にたまる量（ひとりだと 18秒）
        helpRate: 1 / 10,    // 手伝ってくれる仲間 1人で、1秒にたまる量（仲間だけだと 10秒。自分＋1人で 約 6.4秒）
        helpBonus: 0.25,     // 手伝う人が多いほど、1人あたりも速くなる（2人：1人あたり 1.25倍・3人：1.5倍）
        drainSec: 50,        // ダウン中の体力は、何もされなくても満タンからこの秒数で 0 になる（いつも少しずつ減る）
        helpR: 95,           // この距離までの、ダウンしている仲間を手伝える（px）
        helpSlack: 40,       // 届くのが遅れる分、ダウンした人の端末では少し遠くまで数える
        helpFreshMs: 600     // 「手伝っている」が届いてから、この時間までは手伝っていることにする
    };
})();
