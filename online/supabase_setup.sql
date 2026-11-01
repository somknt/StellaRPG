-- 星の子：オンラインのアカウント（PC・スマホで同じアカウントを使う）
-- Supabase の SQL Editor に全部はりつけて Run する
--   何回 Run しても大丈夫。前の版を入れてあっても、アカウント・セーブデータ・ログイン中の端末はそのまま引きつぐ
--   途中でエラーになった時は、全部が元に戻る（1つのトランザクションで実行する）
--
-- しくみ
--   hk_private.hk_accounts   ：ユーザー名・パスワードのハッシュ（bcrypt）・セーブデータ
--   hk_private.hk_sessions   ：ログインの鍵（ゲームが持つ鍵の SHA-256 だけを保存。鍵そのものは保存しない）
--   hk_private.hk_rate_limits：回数制限のカウンター / hk_private.hk_rate_rules：回数制限の決まり（あとから変えられる）
--   表と中だけで使う関数は hk_private（API に出ない schema）に置く。ゲームの公開鍵（publishable / anon）からは見えない・呼べない
--   ゲームは public の関数（hk_register / hk_login / hk_load / hk_save / hk_logout）だけを呼ぶ。名前・引数・答えの形は最初の版と同じ
--   関数の答えは { "ok": true, ... } か { "ok": false, "error": "コード" }（エラーのコードは js/account.js の message）
--
-- 安全のしくみ
--   1. 回数制限（超えたら RATE_LIMIT）：登録・ログインは IP ごと（IP が分からない時は、分からない人みんなで1つの数）、
--      読み書きはアカウントごと、アカウントを作る数は全体でも。数は hk_private.hk_rate_rules で変えられる
--   2. ログイン：8回続けてまちがえたら5分ロック。同時にたくさん試しても数がずれない。知らないユーザー名でも答えるまでの時間をそろえる
--   3. hk_save は読んだ時の番号（p_version）が必須。ない時・ちがう時は CONFLICT（ゲームが読み直して当て直すので、データは消えない）
--   4. セーブデータの形と値のチェック（コイン・クリアの回数は減らない、コインはクリアした分しか増えない。おかしい時は BAD_DATA）
--   5. ゲームから呼べるのは上の5つの関数だけ（security definer。search_path は空、実行は anon・authenticated だけ）

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------- 中だけで使う schema（API に出さない） ----------
create schema if not exists hk_private;
revoke all on schema hk_private from public, anon, authenticated;
-- これから hk_private に作る表・関数も、anon・authenticated に渡さない
-- （関数の PUBLIC の実行権限は schema ごとには外せないので、下の「実行の権限」で関数ごとに外す。schema も使えないようにしてある）
alter default privileges in schema hk_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema hk_private revoke all on functions from public, anon, authenticated;
alter default privileges in schema hk_private revoke all on sequences from public, anon, authenticated;

-- ---------- 前の版からの引っ越し（データは消さない） ----------
-- 最初の版は表を public に作っていた。hk_private にまだ表がなければ、表ごと動かす（中身・番号・ログインの鍵はそのまま）
do $$
begin
    if to_regclass('public.hk_accounts') is not null and to_regclass('hk_private.hk_accounts') is null then
        alter table public.hk_accounts set schema hk_private;
    end if;
    if to_regclass('public.hk_sessions') is not null and to_regclass('hk_private.hk_sessions') is null then
        alter table public.hk_sessions set schema hk_private;
    end if;
end $$;

create table if not exists hk_private.hk_accounts (
    id           uuid primary key default gen_random_uuid(),
    username     text not null,
    username_key text not null unique,
    pass_hash    text not null,
    data         jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    failed_count integer not null default 0,
    locked_until timestamptz
);
-- セーブデータの番号（保存するたびに +1）。PC とスマホが同時に保存した時に、あとの方が前の分を消さないように使う
alter table hk_private.hk_accounts add column if not exists version bigint not null default 0;

create table if not exists hk_private.hk_sessions (
    token_hash text primary key,
    account_id uuid not null references hk_private.hk_accounts(id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);
create index if not exists hk_sessions_account on hk_private.hk_sessions(account_id);

-- 新しい版を入れた後に、まちがえて最初の版をもう一度 Run すると、public に空の表ができて、そこにアカウントが作られる
-- その時は、public の表のアカウントとログインの鍵を hk_private に合わせる（同じユーザー名がある時は hk_private の方を残す）
-- public の表は消さずに、hk_private.hk_accounts_backup_<日時>・hk_sessions_backup_<日時> という名前で残す
do $$
declare
    stamp text := to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS');
    tbl text;
    idx text;
begin
    if to_regclass('public.hk_accounts') is not null then
        insert into hk_private.hk_accounts (id, username, username_key, pass_hash, data, created_at, updated_at, failed_count, locked_until, version)
        select p.id, p.username, p.username_key, p.pass_hash, coalesce(p.data, '{}'::jsonb), p.created_at, p.updated_at,
               coalesce(p.failed_count, 0), p.locked_until, coalesce((to_jsonb(p)->>'version')::bigint, 0)
        from public.hk_accounts p
        on conflict do nothing;
        if to_regclass('public.hk_sessions') is not null then
            insert into hk_private.hk_sessions (token_hash, account_id, created_at, expires_at)
            select s.token_hash, s.account_id, s.created_at, s.expires_at
            from public.hk_sessions s
            where exists (select 1 from hk_private.hk_accounts a where a.id = s.account_id)
            on conflict do nothing;
        end if;
    end if;
    -- 残す表の索引の名前も変える（hk_private の表の索引と同じ名前だと、動かせないので）
    foreach tbl in array array['hk_sessions', 'hk_accounts'] loop
        if to_regclass('public.' || tbl) is null then
            continue;
        end if;
        for idx in select ic.relname from pg_index i
                   join pg_class ic on ic.oid = i.indexrelid
                   join pg_class tc on tc.oid = i.indrelid
                   join pg_namespace n on n.oid = tc.relnamespace
                   where n.nspname = 'public' and tc.relname = tbl loop
            execute format('alter index public.%I rename to %I', idx, left(idx, 40) || '_bk_' || stamp);
        end loop;
        execute format('alter table public.%I rename to %I', tbl, tbl || '_backup_' || stamp);
        execute format('alter table public.%I set schema hk_private', tbl || '_backup_' || stamp);
    end loop;
end $$;

-- ---------- 回数制限の表 ----------
-- bucket（何を数えるか）と key（IP・アカウント）ごとに、window の間に何回あったか
create table if not exists hk_private.hk_rate_limits (
    bucket       text not null,
    key          text not null,
    window_start timestamptz not null default now(),
    hits         integer not null default 0,
    primary key (bucket, key)
);
create index if not exists hk_rate_limits_window on hk_private.hk_rate_limits(window_start);

-- 回数制限の決まり：win の間に max_hits 回まで
-- 数を変えたい時は、この表の行を update する（もう一度 Run しても、変えた数は上書きしない）
-- *_ip：1つの IP ごと / *_noip：IP が分からない時（分からない人みんなで1つの数。ふつうは使われない）
create table if not exists hk_private.hk_rate_rules (
    bucket   text primary key,
    max_hits integer not null,
    win      interval not null,
    note     text
);
insert into hk_private.hk_rate_rules(bucket, max_hits, win, note) values
    ('register_try_ip',   40,  interval '10 minutes', '登録を試す回数（1つの IP）'),
    ('register_try_noip', 100, interval '10 minutes', '登録を試す回数（IP が分からない人みんなで）'),
    ('register_ok_ip',    20,  interval '1 hour',     '作れるアカウントの数（1つの IP）'),
    ('register_ok_noip',  30,  interval '1 hour',     '作れるアカウントの数（IP が分からない人みんなで）'),
    ('register_ok_all',   100, interval '10 minutes', '作れるアカウントの数（全体）'),
    ('login_ip',          100, interval '10 minutes', 'ログインを試す回数（1つの IP。成功も数える）'),
    ('login_noip',        300, interval '10 minutes', 'ログインを試す回数（IP が分からない人みんなで）'),
    ('login_fail_ip',     30,  interval '10 minutes', 'ログインの失敗の回数（1つの IP）'),
    ('login_fail_noip',   100, interval '10 minutes', 'ログインの失敗の回数（IP が分からない人みんなで）'),
    ('load_account',      240, interval '1 minute',   'セーブデータを読む回数（1つのアカウント）'),
    ('save_account',      120, interval '1 minute',   'セーブデータを書く回数（1つのアカウント）')
on conflict (bucket) do nothing;
-- 1つ前の版の数のままの行だけ、新しい数にする（学校などで同じ IP から大勢が使っても止まりにくいように。自分で変えた数はそのまま）
update hk_private.hk_rate_rules set max_hits = 40  where bucket = 'register_try_ip' and max_hits = 20 and win = interval '10 minutes';
update hk_private.hk_rate_rules set max_hits = 20  where bucket = 'register_ok_ip'  and max_hits = 5  and win = interval '1 hour';
update hk_private.hk_rate_rules set max_hits = 100, note = 'ログインを試す回数（1つの IP。成功も数える）'
    where bucket = 'login_ip' and max_hits = 30 and win = interval '10 minutes';

-- 表は API から読めない・書けない（RLS をかけて、ポリシーは作らない。権限も外す）。関数（security definer）だけが使う
alter table hk_private.hk_accounts enable row level security;
alter table hk_private.hk_sessions enable row level security;
alter table hk_private.hk_rate_limits enable row level security;
alter table hk_private.hk_rate_rules enable row level security;
revoke all on all tables in schema hk_private from public, anon, authenticated;
revoke all on all sequences in schema hk_private from public, anon, authenticated;

-- ---------- 中だけで使う関数（hk_private。ゲームからは呼べない） ----------
create or replace function hk_private.token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
    select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- 新しいログインの鍵を作る（90日有効。使うたびに90日先へのびる）
-- 1つのアカウントの鍵が 20 個より多い時は、30日より長く使っていない物から消す（ログインのくり返しで表がふくらまないように）
-- 30日以内に使った鍵は消さない（PC・スマホなど、ふだん使う端末はログアウトされない）
-- 消す時は、ほかの呼び出しが使っている最中の鍵を待たずに飛ばす（skip locked。hk_save と同時でも止まらないように）
create or replace function hk_private.new_session(p_account uuid)
returns text language plpgsql set search_path = '' as $$
declare
    t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
    delete from hk_private.hk_sessions
    where token_hash in (select s.token_hash from hk_private.hk_sessions s
                         where s.account_id = p_account and s.expires_at < now()
                         for update skip locked);
    insert into hk_private.hk_sessions(token_hash, account_id, expires_at)
    values (hk_private.token_hash(t), p_account, now() + interval '90 days');
    delete from hk_private.hk_sessions
    where token_hash in (select s.token_hash from hk_private.hk_sessions s
                         where s.account_id = p_account
                         order by s.expires_at desc offset 20
                         for update skip locked)
      and expires_at < now() + interval '60 days';
    -- ときどき、ほかのアカウントの期限切れの鍵も消す
    if random() < 0.02 then
        delete from hk_private.hk_sessions
        where token_hash in (select s.token_hash from hk_private.hk_sessions s
                             where s.expires_at < now() limit 1000
                             for update skip locked);
    end if;
    return t;
end $$;

-- 鍵からアカウントを探す（使うたびに期限を90日先へのばす）。なければ null
-- 鍵は 64 文字の16進（new_session が作る形。最初の版の鍵も同じ形）。ちがう形の物は探さない
create or replace function hk_private.session_account(p_token text)
returns uuid language plpgsql set search_path = '' as $$
declare
    a uuid;
begin
    if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
        return null;
    end if;
    update hk_private.hk_sessions set expires_at = now() + interval '90 days'
    where token_hash = hk_private.token_hash(p_token) and expires_at > now()
    returning account_id into a;
    return a;
end $$;

-- IP の文字を、回数制限で数える時の名前にする。IP として正しくない物は null
-- IPv6 は /64 ごとにまとめる（1つの家・端末が /64 の中の IP をいくつも使えるので）。IPv4（::ffff: の形も）は1つずつ
create or replace function hk_private.ip_key(p_ip text)
returns text language plpgsql immutable set search_path = '' as $$
declare
    a inet;
begin
    if p_ip is null or btrim(p_ip) = '' or char_length(p_ip) > 64 then
        return null;
    end if;
    begin
        a := btrim(p_ip)::inet;
    exception when others then
        return null;
    end;
    if family(a) = 6 and not (a <<= '::ffff:0.0.0.0/96'::inet) then
        return host(network(set_masklen(a, 64))) || '/64';
    end if;
    return host(a);
end $$;

-- 呼んだ人の IP（回数制限に使う）。分からない時は null
--   1. cf-connecting-ip：Supabase の前にある Cloudflare が、つないできた人の IP を入れる（呼ぶ側が書いても Cloudflare が上書きする）
--   2. x-forwarded-for の最後：Cloudflare を通らない時に、Supabase の入り口が足す IP（前の方は呼ぶ側が好きに書けるので使わない）
--   どちらも IP として正しい形の時だけ使う
create or replace function hk_private.client_ip()
returns text language plpgsql stable set search_path = '' as $$
declare
    h jsonb;
    ip text;
begin
    begin
        h := nullif(current_setting('request.headers', true), '')::jsonb;
    exception when others then
        h := null;
    end;
    if h is null or jsonb_typeof(h) <> 'object' then
        return null;
    end if;
    ip := hk_private.ip_key(h->>'cf-connecting-ip');
    if ip is null then
        ip := hk_private.ip_key(split_part(coalesce(h->>'x-forwarded-for', ''), ',', -1));
    end if;
    return ip;
end $$;

-- 回数制限：この bucket・key の数に p_add を足して、決まり（hk_rate_rules）を超えたら true
--   p_add = 0：数えずに、もう決まりの回数に届いているかだけ見る（失敗だけを数える時に、先に確かめる）
--   key がない時・決まりがない時は数えない
-- （1つ前の版の、引数が2つの over_limit は消す。残っていると、どちらを呼ぶか決められなくなる）
drop function if exists hk_private.over_limit(text, text);
create or replace function hk_private.over_limit(p_bucket text, p_key text, p_add integer default 1)
returns boolean language plpgsql set search_path = '' as $$
declare
    v_max integer;
    v_win interval;
    v_hits integer;
    v_start timestamptz;
    v_key text := left(p_key, 80);
begin
    if v_key is null or v_key = '' then
        return false;
    end if;
    select r.max_hits, r.win into v_max, v_win from hk_private.hk_rate_rules r where r.bucket = p_bucket;
    if v_max is null then
        return false;
    end if;
    if coalesce(p_add, 0) <= 0 then
        select l.hits, l.window_start into v_hits, v_start
        from hk_private.hk_rate_limits l where l.bucket = p_bucket and l.key = v_key;
        return v_hits is not null and v_start > now() - v_win and v_hits >= v_max;
    end if;
    insert into hk_private.hk_rate_limits as l (bucket, key, window_start, hits)
    values (p_bucket, v_key, now(), p_add)
    on conflict (bucket, key) do update
        set hits = case when l.window_start <= now() - v_win then p_add else l.hits + p_add end,
            window_start = case when l.window_start <= now() - v_win then now() else l.window_start end
    returning l.hits into v_hits;
    -- ときどき、古いカウンターを消す（使っている最中の行は飛ばす）
    if random() < 0.01 then
        delete from hk_private.hk_rate_limits
        where (bucket, key) in (select x.bucket, x.key from hk_private.hk_rate_limits x
                                where x.window_start < now() - interval '1 day' limit 1000
                                for update skip locked);
    end if;
    return v_hits > v_max;
end $$;

-- IP ごとの回数制限（p_bucket || '_ip'）。IP が分からない時は、分からない人みんなで1つの数（p_bucket || '_noip'。決まりの数は多め）
create or replace function hk_private.over_ip_limit(p_bucket text, p_add integer default 1)
returns boolean language plpgsql set search_path = '' as $$
declare
    ip text := hk_private.client_ip();
begin
    if ip is null then
        return hk_private.over_limit(p_bucket || '_noip', 'unknown', p_add);
    end if;
    return hk_private.over_limit(p_bucket || '_ip', ip, p_add);
end $$;

-- セーブデータの形と値のチェック。よければ null、だめならエラーのコード
--   p_new：これから保存するデータ / p_old：今サーバーにあるデータ（登録の時は null。形と値だけ見る）
--   ゲーム（js/account.js の normalize・applyEvent）が作るデータは、いつも通る。手で書きかえたおかしな値だけを止める
--   - コイン：0 以上の整数 / クリアの回数：ボスごとに 0 以上の整数 / マイベスト：ボスごとに 50 件まで、タイムは 0 以上の数
--   - 保存の時：コインとクリアの回数は減らない（今のゲームにはコインを使う所がない。使う所を作る時はここを直す）
--     コインが増えるのは、クリアの回数が増えた時だけ（1回のクリアで 500 枚まで。ボスは今 10〜40 枚＋ランクのボーナス5枚まで）
create or replace function hk_private.check_data(p_new jsonb, p_old jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
    b jsonb;
    ob jsonb;
    k text;
    v jsonb;
    r jsonb;
    n numeric;
    coins numeric := 0;
    old_coins numeric := 0;
    clears_sum numeric := 0;
    old_clears_sum numeric := 0;
begin
    if p_new is null or jsonb_typeof(p_new) <> 'object' or octet_length(p_new::text) > 65536 then
        return 'DATA_TOO_LARGE';
    end if;
    -- プレイヤー名（ゲームは10文字まで）
    if coalesce(jsonb_typeof(p_new->'profile'), 'null') not in ('object', 'null') then
        return 'BAD_DATA';
    end if;
    if jsonb_typeof(p_new->'profile') = 'object' and char_length(coalesce(p_new->'profile'->>'name', '')) > 20 then
        return 'BAD_DATA';
    end if;
    b := coalesce(p_new->'battle', '{}'::jsonb);
    if jsonb_typeof(b) = 'null' then
        b := '{}'::jsonb;
    end if;
    if jsonb_typeof(b) <> 'object' then
        return 'BAD_DATA';
    end if;
    -- バトルコイン
    if b ? 'coins' then
        if coalesce(jsonb_typeof(b->'coins'), '') <> 'number' then
            return 'BAD_DATA';
        end if;
        coins := (b->>'coins')::numeric;
        if coins < 0 or coins > 1000000000 or coins <> trunc(coins) then
            return 'BAD_DATA';
        end if;
    end if;
    -- クリアした回数
    if b ? 'clears' then
        if coalesce(jsonb_typeof(b->'clears'), '') <> 'object' then
            return 'BAD_DATA';
        end if;
        for k, v in select e.key, e.value from jsonb_each(b->'clears') e loop
            if k !~ '^[A-Za-z0-9_-]{1,64}$' or coalesce(jsonb_typeof(v), '') <> 'number' then
                return 'BAD_DATA';
            end if;
            n := (v #>> '{}')::numeric;
            if n < 0 or n > 10000000 or n <> trunc(n) then
                return 'BAD_DATA';
            end if;
            clears_sum := clears_sum + n;
        end loop;
    end if;
    -- マイベスト（クリアタイムの記録）
    if b ? 'records' then
        if coalesce(jsonb_typeof(b->'records'), '') <> 'object' then
            return 'BAD_DATA';
        end if;
        for k, v in select e.key, e.value from jsonb_each(b->'records') e loop
            if k !~ '^[A-Za-z0-9_-]{1,64}$' or coalesce(jsonb_typeof(v), '') <> 'array' or jsonb_array_length(v) > 50 then
                return 'BAD_DATA';
            end if;
            for r in select x.value from jsonb_array_elements(v) x loop
                if coalesce(jsonb_typeof(r), '') <> 'object' or coalesce(jsonb_typeof(r->'time'), '') <> 'number' then
                    return 'BAD_DATA';
                end if;
                n := (r->>'time')::numeric;
                if n < 0 or n > 1000000 then
                    return 'BAD_DATA';
                end if;
                if char_length(coalesce(r->>'rank', '')) > 4 or char_length(coalesce(r->>'hero', '')) > 10
                   or char_length(coalesce(r->>'date', '')) > 40 then
                    return 'BAD_DATA';
                end if;
            end loop;
        end loop;
    end if;
    -- 保存の時：今サーバーにあるデータと比べる（今のデータの値がおかしい所は比べない）
    if p_old is not null then
        ob := p_old->'battle';
        if coalesce(jsonb_typeof(ob), '') = 'object' then
            if coalesce(jsonb_typeof(ob->'coins'), '') = 'number' then
                old_coins := (ob->>'coins')::numeric;
            end if;
            if coalesce(jsonb_typeof(ob->'clears'), '') = 'object' then
                for k, v in select e.key, e.value from jsonb_each(ob->'clears') e loop
                    if coalesce(jsonb_typeof(v), '') <> 'number' then
                        continue;
                    end if;
                    n := (v #>> '{}')::numeric;
                    old_clears_sum := old_clears_sum + n;
                    if coalesce((b->'clears'->>k)::numeric, 0) < n then
                        return 'BAD_DATA';
                    end if;
                end loop;
            end if;
            if coins < old_coins then
                return 'BAD_DATA';
            end if;
            if coins - old_coins > greatest(clears_sum - old_clears_sum, 0) * 500 then
                return 'BAD_DATA';
            end if;
        end if;
    end if;
    return null;
end $$;

-- ---------- ゲームから呼ぶ関数（public。名前・引数・答えの形は最初の版と同じ） ----------
-- アカウントを作る：ユーザー名は半角英数字と _ で3〜16文字、パスワードは6〜64文字
create or replace function public.hk_register(p_username text, p_password text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    a hk_private.hk_accounts;
    v_err text;
begin
    if hk_private.over_ip_limit('register_try') then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,16}$' then
        return jsonb_build_object('ok', false, 'error', 'BAD_USERNAME');
    end if;
    if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 64 then
        return jsonb_build_object('ok', false, 'error', 'BAD_PASSWORD');
    end if;
    v_err := hk_private.check_data(coalesce(p_data, '{}'::jsonb), null);
    if v_err is not null then
        return jsonb_build_object('ok', false, 'error', v_err);
    end if;
    if exists (select 1 from hk_private.hk_accounts where username_key = lower(p_username)) then
        return jsonb_build_object('ok', false, 'error', 'USERNAME_TAKEN');
    end if;
    -- 作れるアカウントの数（同じ IP から・全体で）。名前が使われていた時などは数えない
    if hk_private.over_ip_limit('register_ok') or hk_private.over_limit('register_ok_all', 'all') then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    begin
        insert into hk_private.hk_accounts(username, username_key, pass_hash, data)
        values (p_username, lower(p_username), extensions.crypt(p_password, extensions.gen_salt('bf', 10)), coalesce(p_data, '{}'::jsonb))
        returning * into a;
    exception when unique_violation then
        return jsonb_build_object('ok', false, 'error', 'USERNAME_TAKEN');
    end;
    return jsonb_build_object('ok', true, 'token', hk_private.new_session(a.id), 'username', a.username,
                              'data', a.data, 'version', a.version, 'updated_at', a.updated_at);
end $$;

-- ログイン：8回続けてまちがえたら、5分間ログインできない（LOCKED。ロックの間は、正しいパスワードでも入れない）
--   失敗の回数は、正しくログインできた時と、ロックした時に 0 に戻る
--   同時にたくさん試しても数がずれないように、アカウントの行を押さえてから確かめる（for update）
--   知らないユーザー名でも、パスワードを確かめるのと同じくらい時間をかけて答える（あるユーザー名かどうかを、時間で知られないように）
--   IP ごとの回数制限：試す回数（成功も）と、失敗の回数（失敗だけ。ちがう名前を次々に試すのを止める）
create or replace function public.hk_login(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    a hk_private.hk_accounts;
begin
    if hk_private.over_ip_limit('login') or hk_private.over_ip_limit('login_fail', 0) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    -- ありえない形のユーザー名・パスワード（登録の時の決まりに合わない）は、確かめずに「ちがいます」
    if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,16}$'
       or p_password is null or char_length(p_password) < 1 or char_length(p_password) > 64 then
        perform hk_private.over_ip_limit('login_fail');
        return jsonb_build_object('ok', false, 'error', 'BAD_LOGIN');
    end if;
    select * into a from hk_private.hk_accounts where username_key = lower(p_username) for update;
    if not found then
        perform extensions.crypt(p_password, '$2a$10$HoshinoKoDummySaltXXXX');
        perform hk_private.over_ip_limit('login_fail');
        return jsonb_build_object('ok', false, 'error', 'BAD_LOGIN');
    end if;
    if a.locked_until is not null and a.locked_until > now() then
        return jsonb_build_object('ok', false, 'error', 'LOCKED');
    end if;
    if a.pass_hash <> extensions.crypt(p_password, a.pass_hash) then
        if a.failed_count + 1 >= 8 then
            update hk_private.hk_accounts set failed_count = 0, locked_until = now() + interval '5 minutes' where id = a.id;
        else
            update hk_private.hk_accounts set failed_count = a.failed_count + 1 where id = a.id;
        end if;
        perform hk_private.over_ip_limit('login_fail');
        return jsonb_build_object('ok', false, 'error', 'BAD_LOGIN');
    end if;
    update hk_private.hk_accounts set failed_count = 0, locked_until = null where id = a.id;
    return jsonb_build_object('ok', true, 'token', hk_private.new_session(a.id), 'username', a.username,
                              'data', a.data, 'version', a.version, 'updated_at', a.updated_at);
end $$;

-- セーブデータを読む（ログインの鍵のアカウントの物だけ）
create or replace function public.hk_load(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_id uuid := hk_private.session_account(p_token);
    a hk_private.hk_accounts;
begin
    if v_id is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('load_account', v_id::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    select * into a from hk_private.hk_accounts where id = v_id;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    return jsonb_build_object('ok', true, 'username', a.username, 'data', a.data, 'version', a.version, 'updated_at', a.updated_at);
end $$;

-- セーブデータを書く（ログインの鍵のアカウントの物だけ。64KB まで）
--   p_version：読んだ時の番号（必須）。そのあとにほかの端末が書いていた時・番号がない時は、書かずに CONFLICT を返す
--   （ゲームは読み直して、まだ送っていないできごとを当て直してから、もう一度保存する。どちらの変更も消えない）
--   引数の形は最初の版と同じ（p_version の default null も残す。null の時は CONFLICT）
drop function if exists public.hk_save(text, jsonb);
create or replace function public.hk_save(p_token text, p_data jsonb, p_version bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_id uuid := hk_private.session_account(p_token);
    a hk_private.hk_accounts;
    v_err text;
    v_version bigint;
    t timestamptz;
begin
    if v_id is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('save_account', v_id::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    if p_version is null then
        return jsonb_build_object('ok', false, 'error', 'CONFLICT');
    end if;
    -- 今のデータを押さえて（同時の保存は順番に）、番号を比べる
    select * into a from hk_private.hk_accounts where id = v_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if a.version <> p_version then
        return jsonb_build_object('ok', false, 'error', 'CONFLICT');
    end if;
    v_err := hk_private.check_data(p_data, a.data);
    if v_err is not null then
        return jsonb_build_object('ok', false, 'error', v_err);
    end if;
    update hk_private.hk_accounts
    set data = p_data, updated_at = now(), version = a.version + 1
    where id = v_id
    returning version, updated_at into v_version, t;
    return jsonb_build_object('ok', true, 'version', v_version, 'updated_at', t);
end $$;

-- ログアウト（その端末の鍵だけ消す）
create or replace function public.hk_logout(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
    if p_token is not null and p_token ~ '^[0-9a-f]{64}$' then
        delete from hk_private.hk_sessions where token_hash = hk_private.token_hash(p_token);
    end if;
    return jsonb_build_object('ok', true);
end $$;

-- ---------- 最初の版の、public にあった中の関数を消す（今は hk_private の物を使う） ----------
drop function if exists public.hk_token_hash(text);
drop function if exists public.hk_new_session(uuid);
drop function if exists public.hk_session_account(text);

-- ---------- 実行の権限 ----------
-- 中の関数：だれにも渡さない（関数はふつう PUBLIC に実行の権限がつくので、はっきり外す）
revoke all on all functions in schema hk_private from public, anon, authenticated;
-- ゲームから呼ぶ関数：ゲームの公開鍵（anon）とログインした人（authenticated）だけ
revoke all on function public.hk_register(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.hk_login(text, text) from public, anon, authenticated;
revoke all on function public.hk_load(text) from public, anon, authenticated;
revoke all on function public.hk_save(text, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.hk_logout(text) from public, anon, authenticated;
grant execute on function public.hk_register(text, text, jsonb) to anon, authenticated;
grant execute on function public.hk_login(text, text) to anon, authenticated;
grant execute on function public.hk_load(text) to anon, authenticated;
grant execute on function public.hk_save(text, jsonb, bigint) to anon, authenticated;
grant execute on function public.hk_logout(text) to anon, authenticated;

commit;

-- API に新しい関数を知らせる
notify pgrst, 'reload schema';
