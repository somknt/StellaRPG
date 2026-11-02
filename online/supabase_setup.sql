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

-- ==========================================================
-- マルチプレイ（星の酒場）：パーティー・扉・準備・協力プレイの戦い・報酬
-- ==========================================================
-- 酒場の中の動き（位置・向き・頭の上の印）と、戦いの中の動きは、Supabase の Realtime（broadcast・presence）で
-- 端末どうしが送り合う（データベースには書かない）。ここには「みんなが同じ結果にならないといけない物」だけを置く
--   hk_parties       ：パーティー（クエストを受けた人がリーダー。協力プレイは 4人まで・PvP は 2人まで）
--   hk_party_members ：パーティーの人（扉に入ったか・準備完了か・装備）。1人が入れるパーティーは1つだけ
--   hk_battles       ：始めた戦い（参加者・ボスの HP の倍率・始めた時刻・結果）。報酬はここから1回だけ配る
--   hk_boss_rewards  ：ボスのバトルコインと、勝ちにできる最短の秒数（それより早い勝ちは報酬なし）
-- 人数の上限・二重の受注・同時に参加した時の定員オーバー・リーダーだけの操作は、ここで行の鍵をかけて確かめる
create table if not exists hk_private.hk_parties (
    id         uuid primary key default gen_random_uuid(),
    kind       text not null check (kind in ('coop', 'pvp')),
    boss_id    text,
    leader_id  uuid not null references hk_private.hk_accounts(id) on delete cascade,
    room       text not null default '1',
    closed     boolean not null default false,
    status     text not null default 'open' check (status in ('open', 'prep', 'battle')),
    battle_id  uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
-- 最後に終わった戦い（戦いの後、パーティーの人が結果と報酬を見られるように）
alter table hk_private.hk_parties add column if not exists last_battle uuid;
-- PvP のフィールド（'arena'：星の闘技場 / 'ruins'：古代星紋遺跡 / 'battlefield'：歴戦の跡地。準備画面でリーダーが選ぶ）
alter table hk_private.hk_parties add column if not exists field text not null default 'arena';
create table if not exists hk_private.hk_party_members (
    party_id   uuid not null references hk_private.hk_parties(id) on delete cascade,
    account_id uuid not null references hk_private.hk_accounts(id) on delete cascade,
    joined_at  timestamptz not null default clock_timestamp(),
    entered    boolean not null default false,
    ready      boolean not null default false,
    loadout    jsonb not null default '{}'::jsonb,
    seen_at    timestamptz not null default now(),
    primary key (party_id, account_id)
);
create unique index if not exists hk_party_members_account on hk_private.hk_party_members(account_id);
create index if not exists hk_party_members_seen on hk_private.hk_party_members(seen_at);
create table if not exists hk_private.hk_battles (
    id          uuid primary key default gen_random_uuid(),
    party_id    uuid,
    boss_id     text not null,
    host_id     uuid not null,
    members     uuid[] not null,
    hp_mult     numeric not null,
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    result      text,
    reward      integer
);
-- PvP の勝った人（戦いが終わった時に書く。報酬はない）
alter table hk_private.hk_battles add column if not exists winner_id uuid;
create table if not exists hk_private.hk_boss_rewards (
    boss_id     text primary key,
    coins       integer not null,
    min_seconds integer not null
);
insert into hk_private.hk_boss_rewards(boss_id, coins, min_seconds) values
    ('giant_forest_boar', 10, 20), ('black_corrupted_wolf', 20, 20), ('magic_golem', 30, 25), ('grudge_armor', 40, 25)
on conflict (boss_id) do nothing;
insert into hk_private.hk_rate_rules(bucket, max_hits, win, note) values
    ('mp_account', 400, interval '1 minute', 'マルチプレイの呼び出し（1つのアカウント）')
on conflict (bucket) do nothing;
alter table hk_private.hk_parties enable row level security;
alter table hk_private.hk_party_members enable row level security;
alter table hk_private.hk_battles enable row level security;
alter table hk_private.hk_boss_rewards enable row level security;
revoke all on hk_private.hk_parties, hk_private.hk_party_members, hk_private.hk_battles, hk_private.hk_boss_rewards from public, anon, authenticated;

-- ほかの人に見せる、アカウントの名前の代わり（ユーザー名はログインに使うので見せない）
create or replace function hk_private.mp_pid(p_id uuid)
returns text language sql immutable set search_path = '' as $$
    select left(encode(extensions.digest('hoshinoko:' || p_id::text, 'sha256'), 'hex'), 12);
$$;

create or replace function hk_private.mp_cap(p_kind text)
returns integer language sql immutable set search_path = '' as $$
    select case when p_kind = 'pvp' then 2 else 4 end;
$$;

-- 全員が扉に入った（かつ、募集を締め切った・満員）なら準備画面へ。2人より少ない時は進まない
create or replace function hk_private.mp_try_prep(p_party uuid)
returns void language plpgsql set search_path = '' as $$
declare
    p hk_private.hk_parties;
    n integer;
    e integer;
begin
    select * into p from hk_private.hk_parties where id = p_party for update;
    if not found or p.status <> 'open' then
        return;
    end if;
    select count(*), count(*) filter (where m.entered) into n, e from hk_private.hk_party_members m where m.party_id = p_party;
    if n >= 2 and e = n and (p.closed or n >= hk_private.mp_cap(p.kind)) then
        update hk_private.hk_parties set status = 'prep', updated_at = now() where id = p_party;
        update hk_private.hk_party_members set ready = false where party_id = p_party;
    end if;
end $$;

-- 人が抜けた後：だれもいなければ解散。リーダーが抜けたら、いちばん先に入った人が新しいリーダー
-- 準備画面で抜けた時は、全員の準備完了を解除（人数が変わると、ボスの強さも変わるので）。2人より少なくなったら酒場へ戻る
create or replace function hk_private.mp_fix(p_party uuid)
returns void language plpgsql set search_path = '' as $$
declare
    p hk_private.hk_parties;
    n integer;
begin
    select * into p from hk_private.hk_parties where id = p_party for update;
    if not found then
        return;
    end if;
    select count(*) into n from hk_private.hk_party_members where party_id = p_party;
    if n = 0 then
        delete from hk_private.hk_parties where id = p_party;
        return;
    end if;
    if not exists (select 1 from hk_private.hk_party_members where party_id = p_party and account_id = p.leader_id) then
        update hk_private.hk_parties
        set leader_id = (select m.account_id from hk_private.hk_party_members m where m.party_id = p_party order by m.joined_at limit 1)
        where id = p_party;
    end if;
    if p.status = 'prep' then
        update hk_private.hk_party_members set ready = false where party_id = p_party;
        if n < 2 then
            update hk_private.hk_parties set status = 'open' where id = p_party;
            update hk_private.hk_party_members set entered = false where party_id = p_party;
        end if;
    end if;
    update hk_private.hk_parties set updated_at = now() where id = p_party;
    perform hk_private.mp_try_prep(p_party);
end $$;

-- 通信の切れた人をパーティーから外す（酒場・準備画面：30秒 / 戦いの中：120秒）。とても長く終わらない戦いは酒場へ戻す
-- 同時に何人もが片付けないように、1人だけが行う（advisory lock を取れなかった人は飛ばす）
create or replace function hk_private.mp_cleanup()
returns void language plpgsql set search_path = '' as $$
declare
    v uuid;
begin
    if not pg_try_advisory_xact_lock(hashtext('hk_mp_cleanup')) then
        return;
    end if;
    for v in update hk_private.hk_battles set finished_at = now(), result = 'abort'
             where finished_at is null and started_at < now() - interval '40 minutes' returning party_id loop
        update hk_private.hk_parties set status = 'open', battle_id = null, updated_at = now() where id = v and status = 'battle';
        update hk_private.hk_party_members set entered = false, ready = false where party_id = v;
    end loop;
    -- パーティーの行に先に鍵をかけてから人を消す（参加・扉の関数と同じ順番。お互いに待ち続けないように）
    for v in select distinct m.party_id from hk_private.hk_party_members m join hk_private.hk_parties p on p.id = m.party_id
             where m.seen_at < now() - case when p.status = 'battle' then interval '120 seconds' else interval '30 seconds' end loop
        perform 1 from hk_private.hk_parties where id = v for update;
        delete from hk_private.hk_party_members m using hk_private.hk_parties p
        where m.party_id = v and p.id = v
          and m.seen_at < now() - case when p.status = 'battle' then interval '120 seconds' else interval '30 seconds' end;
        perform hk_private.mp_fix(v);
    end loop;
end $$;

-- 自分から見たマルチプレイの様子（自分のパーティー・掲示板の募集）
create or replace function hk_private.mp_view(p_me uuid, p_board boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare
    p hk_private.hk_parties;
    b hk_private.hk_battles;
    v_party jsonb := null;
    v_board jsonb := null;
    v_members jsonb;
    v_battle jsonb := null;
    v_last jsonb := null;
    n integer;
    e integer;
begin
    select pt.* into p from hk_private.hk_party_members m join hk_private.hk_parties pt on pt.id = m.party_id where m.account_id = p_me;
    if found then
        select count(*), count(*) filter (where m.entered),
               jsonb_agg(jsonb_build_object(
                   'pid', hk_private.mp_pid(a.id),
                   'name', coalesce(a.data->'profile'->>'name', ''),
                   'gender', case when a.data->'profile'->>'gender' = 'female' then 'female' else 'male' end,
                   'entered', m.entered, 'ready', m.ready, 'loadout', m.loadout,
                   'leader', a.id = p.leader_id, 'me', a.id = p_me) order by m.joined_at)
          into n, e, v_members
          from hk_private.hk_party_members m join hk_private.hk_accounts a on a.id = m.account_id
         where m.party_id = p.id;
        if p.battle_id is not null then
            select * into b from hk_private.hk_battles where id = p.battle_id;
            if found then
                v_battle := jsonb_build_object('id', b.id, 'boss', b.boss_id, 'hp_mult', b.hp_mult,
                    'host', hk_private.mp_pid(b.host_id), 'host_is_me', b.host_id = p_me,
                    'members', (select jsonb_agg(hk_private.mp_pid(x)) from unnest(b.members) x),
                    'elapsed', extract(epoch from now() - b.started_at), 'result', b.result);
            end if;
        end if;
        if p.last_battle is not null then
            select * into b from hk_private.hk_battles where id = p.last_battle;
            if found then
                v_last := jsonb_build_object('id', b.id, 'boss', b.boss_id, 'result', b.result, 'reward', coalesce(b.reward, 0),
                    'secs', extract(epoch from coalesce(b.finished_at, now()) - b.started_at),
                    'winner', case when b.winner_id is null then null else hk_private.mp_pid(b.winner_id) end);
            end if;
        end if;
        v_party := jsonb_build_object('id', p.id, 'kind', p.kind, 'boss', p.boss_id, 'field', p.field, 'room', p.room, 'closed', p.closed,
            'status', p.status, 'leader_is_me', p.leader_id = p_me, 'leader', hk_private.mp_pid(p.leader_id),
            'cap', hk_private.mp_cap(p.kind), 'count', n, 'entered', e, 'all_entered', e = n,
            'members', v_members, 'battle', v_battle, 'last', v_last);
    end if;
    if p_board then
        select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) into v_board from (
            select pt.created_at, jsonb_build_object('id', pt.id, 'kind', pt.kind, 'boss', pt.boss_id, 'room', pt.room,
                'leader_name', coalesce(a.data->'profile'->>'name', ''), 'leader', hk_private.mp_pid(pt.leader_id),
                'count', (select count(*) from hk_private.hk_party_members m where m.party_id = pt.id),
                'cap', hk_private.mp_cap(pt.kind), 'status', pt.status, 'closed', pt.closed) as j
            from hk_private.hk_parties pt join hk_private.hk_accounts a on a.id = pt.leader_id
            order by pt.created_at desc limit 30) x;
    end if;
    return jsonb_build_object('ok', true, 'pid', hk_private.mp_pid(p_me), 'party', v_party, 'board', v_board);
end $$;

-- ---------- ゲームから呼ぶマルチプレイの関数（どれも答えは mp_view の形。だめな時は { ok: false, error }） ----------
-- 様子を読む（酒場にいる間、2秒くらいごとに呼ぶ。呼んだ人は「まだつながっている」ことになる）
create or replace function public.hk_mp_state(p_token text, p_board boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    perform hk_private.mp_cleanup();
    update hk_private.hk_party_members set seen_at = now() where account_id = v_me;
    return hk_private.mp_view(v_me, coalesce(p_board, false));
end $$;

-- クエストを受ける（マスターに話しかけて、協力プレイのボスを選んだ・PvP を選んだ）。受けた人がリーダー
create or replace function public.hk_mp_create(p_token text, p_kind text, p_boss text default null, p_room text default '1')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
    v_id uuid;
    v_room text := coalesce(p_room, '1');
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    if p_kind is null or p_kind not in ('coop', 'pvp') then
        return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
    end if;
    if p_kind = 'coop' and not exists (select 1 from hk_private.hk_boss_rewards r where r.boss_id = p_boss) then
        return jsonb_build_object('ok', false, 'error', 'BAD_BOSS');
    end if;
    if v_room !~ '^[A-Za-z0-9_-]{1,24}$' then
        v_room := '1';
    end if;
    perform hk_private.mp_cleanup();
    if exists (select 1 from hk_private.hk_party_members where account_id = v_me) then
        return jsonb_build_object('ok', false, 'error', 'IN_PARTY');
    end if;
    begin
        insert into hk_private.hk_parties(kind, boss_id, leader_id, room)
        values (p_kind, case when p_kind = 'coop' then p_boss end, v_me, v_room) returning id into v_id;
        insert into hk_private.hk_party_members(party_id, account_id) values (v_id, v_me);
    exception when unique_violation then
        return jsonb_build_object('ok', false, 'error', 'IN_PARTY');
    end;
    return hk_private.mp_view(v_me, true);
end $$;

-- 掲示板の募集に参加する（パーティーの行に鍵をかけてから人数を数える。同時に参加しても定員を超えない）
create or replace function public.hk_mp_join(p_token text, p_party uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
    v_cur uuid;
    p hk_private.hk_parties;
    n integer;
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    select party_id into v_cur from hk_private.hk_party_members where account_id = v_me;
    if v_cur = p_party then
        return hk_private.mp_view(v_me, true);
    elsif v_cur is not null then
        return jsonb_build_object('ok', false, 'error', 'IN_PARTY');
    end if;
    select * into p from hk_private.hk_parties where id = p_party for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'GONE');
    end if;
    if p.status <> 'open' or p.closed then
        return jsonb_build_object('ok', false, 'error', 'CLOSED');
    end if;
    select count(*) into n from hk_private.hk_party_members where party_id = p_party;
    if n >= hk_private.mp_cap(p.kind) then
        return jsonb_build_object('ok', false, 'error', 'FULL');
    end if;
    begin
        insert into hk_private.hk_party_members(party_id, account_id) values (p_party, v_me);
    exception when unique_violation then
        return jsonb_build_object('ok', false, 'error', 'IN_PARTY');
    end;
    update hk_private.hk_parties set updated_at = now() where id = p_party;
    perform hk_private.mp_try_prep(p_party);
    return hk_private.mp_view(v_me, true);
end $$;

-- パーティーを抜ける（リーダーが抜けたら、いちばん先に入った人がリーダー。だれもいなくなったら解散）
create or replace function public.hk_mp_leave(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
    v uuid;
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    select party_id into v from hk_private.hk_party_members where account_id = v_me;
    if v is not null then
        perform 1 from hk_private.hk_parties where id = v for update;
        delete from hk_private.hk_party_members where account_id = v_me;
        perform hk_private.mp_fix(v);
    end if;
    return hk_private.mp_view(v_me, true);
end $$;

-- リーダーだけ：メンバーを外す（酒場にいる間だけ）
create or replace function public.hk_mp_kick(p_token text, p_pid text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
    p hk_private.hk_parties;
    v uuid;
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    select * into p from hk_private.hk_parties
    where id = (select party_id from hk_private.hk_party_members where account_id = v_me) for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'NO_PARTY');
    end if;
    if p.leader_id <> v_me then
        return jsonb_build_object('ok', false, 'error', 'NOT_LEADER');
    end if;
    if p.status <> 'open' then
        return jsonb_build_object('ok', false, 'error', 'BUSY');
    end if;
    delete from hk_private.hk_party_members m
    where m.party_id = p.id and m.account_id <> v_me and hk_private.mp_pid(m.account_id) = p_pid
    returning m.account_id into v;
    if v is not null then
        perform hk_private.mp_fix(p.id);
    end if;
    return hk_private.mp_view(v_me, true);
end $$;

-- リーダーだけ：募集を締め切る（p_closed = true）・再び募集する（false）
create or replace function public.hk_mp_close(p_token text, p_closed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
    p hk_private.hk_parties;
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    select * into p from hk_private.hk_parties
    where id = (select party_id from hk_private.hk_party_members where account_id = v_me) for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'NO_PARTY');
    end if;
    if p.leader_id <> v_me then
        return jsonb_build_object('ok', false, 'error', 'NOT_LEADER');
    end if;
    if p.status <> 'open' then
        return jsonb_build_object('ok', false, 'error', 'BUSY');
    end if;
    update hk_private.hk_parties set closed = coalesce(p_closed, true), updated_at = now() where id = p.id;
    perform hk_private.mp_try_prep(p.id);
    return hk_private.mp_view(v_me, true);
end $$;

-- 扉に入る（p_entered = true）・待つのをやめる（false）。準備画面で「戻る」を押した時も false
create or replace function public.hk_mp_enter(p_token text, p_entered boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
    p hk_private.hk_parties;
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    select * into p from hk_private.hk_parties
    where id = (select party_id from hk_private.hk_party_members where account_id = v_me) for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'NO_PARTY');
    end if;
    if p.status = 'battle' then
        return jsonb_build_object('ok', false, 'error', 'BUSY');
    end if;
    if p.status = 'prep' then
        if not coalesce(p_entered, false) then
            -- 準備画面から1人が戻った：みんな酒場の扉の前に戻る（戻った人は扉の外）
            update hk_private.hk_parties set status = 'open', updated_at = now() where id = p.id;
            update hk_private.hk_party_members set ready = false, entered = entered and account_id <> v_me where party_id = p.id;
        end if;
    else
        update hk_private.hk_party_members set entered = coalesce(p_entered, false), ready = false where account_id = v_me;
        update hk_private.hk_parties set updated_at = now() where id = p.id;
        perform hk_private.mp_try_prep(p.id);
    end if;
    return hk_private.mp_view(v_me, true);
end $$;

-- 準備画面：準備完了（p_ready）と、今の装備（p_loadout。ほかの人の画面に出す）
create or replace function public.hk_mp_ready(p_token text, p_ready boolean, p_loadout jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
    p hk_private.hk_parties;
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    select * into p from hk_private.hk_parties
    where id = (select party_id from hk_private.hk_party_members where account_id = v_me) for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'NO_PARTY');
    end if;
    if p.status <> 'prep' then
        return jsonb_build_object('ok', false, 'error', 'NOT_PREP');
    end if;
    update hk_private.hk_party_members
    set ready = coalesce(p_ready, false),
        loadout = case when p_loadout is not null and jsonb_typeof(p_loadout) = 'object' and octet_length(p_loadout::text) <= 2000
                       then p_loadout else loadout end
    where account_id = v_me;
    update hk_private.hk_parties set updated_at = now() where id = p.id;
    return hk_private.mp_view(v_me, true);
end $$;

-- PvP の準備画面：リーダーだけがフィールドを選ぶ。変えたら、2人とも準備完了をやり直す（知らない所で戦わないように）
create or replace function public.hk_mp_field(p_token text, p_field text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
    p hk_private.hk_parties;
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    if p_field is null or p_field not in ('arena', 'ruins', 'battlefield') then
        return jsonb_build_object('ok', false, 'error', 'BAD_FIELD');
    end if;
    select * into p from hk_private.hk_parties
    where id = (select party_id from hk_private.hk_party_members where account_id = v_me) for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'NO_PARTY');
    end if;
    if p.kind <> 'pvp' then
        return jsonb_build_object('ok', false, 'error', 'BAD_FIELD');
    end if;
    if p.leader_id <> v_me then
        return jsonb_build_object('ok', false, 'error', 'NOT_LEADER');
    end if;
    if p.status = 'battle' then
        return jsonb_build_object('ok', false, 'error', 'BUSY');
    end if;
    if p.field is distinct from p_field then
        update hk_private.hk_parties set field = p_field, updated_at = now() where id = p.id;
        update hk_private.hk_party_members set ready = false where party_id = p.id;
    end if;
    return hk_private.mp_view(v_me, true);
end $$;

-- リーダーだけ：バトル開始（全員が準備完了の時だけ）。参加者とボスの HP の倍率（2人 1.5・3人 2.0・4人 2.5）をここで決める
-- 戦いを動かす人（ホスト）はリーダー。PvP は2人そろった時だけ、選んだフィールドで（ボスの代わりに 'pvp:フィールド'）
create or replace function public.hk_mp_start(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
    p hk_private.hk_parties;
    n integer;
    r integer;
    v_b uuid;
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    select * into p from hk_private.hk_parties
    where id = (select party_id from hk_private.hk_party_members where account_id = v_me) for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'NO_PARTY');
    end if;
    if p.leader_id <> v_me then
        return jsonb_build_object('ok', false, 'error', 'NOT_LEADER');
    end if;
    if p.status <> 'prep' then
        return jsonb_build_object('ok', false, 'error', 'NOT_PREP');
    end if;
    select count(*), count(*) filter (where ready) into n, r from hk_private.hk_party_members where party_id = p.id;
    if r < n then
        return jsonb_build_object('ok', false, 'error', 'NOT_READY');
    end if;
    if n < 2 then
        return jsonb_build_object('ok', false, 'error', 'NEED_TWO');
    end if;
    if p.kind = 'pvp' and n <> 2 then
        return jsonb_build_object('ok', false, 'error', 'NEED_TWO');
    end if;
    insert into hk_private.hk_battles(party_id, boss_id, host_id, members, hp_mult)
    values (p.id, case when p.kind = 'pvp' then 'pvp:' || coalesce(p.field, 'arena') else p.boss_id end, v_me,
            (select array_agg(m.account_id order by m.joined_at) from hk_private.hk_party_members m where m.party_id = p.id),
            case when p.kind = 'pvp' then 1 when n = 2 then 2 when n = 3 then 3 when n = 4 then 4 else 1 end)
    returning id into v_b;
    update hk_private.hk_parties set status = 'battle', battle_id = v_b, updated_at = now() where id = p.id;
    update hk_private.hk_party_members set seen_at = now() where party_id = p.id;
    return hk_private.mp_view(v_me, true);
end $$;

-- 戦いが終わった：ホスト（バトル開始を押したリーダー）だけが「勝ち」を知らせられる。ほかの人は「負け・中断」だけ
-- 勝ちなら、戦いに参加した全員のセーブデータに、バトルコイン（ボスの基本＋クリアタイムのランクのボーナス）とクリアの回数を足す
-- 1つの戦いの報酬は1回だけ（結果を書いた後は何もしない）。始めてから min_seconds 秒より早い勝ちは報酬なし
create or replace function public.hk_mp_finish(p_token text, p_battle uuid, p_win boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_me uuid := hk_private.session_account(p_token);
    b hk_private.hk_battles;
    v_secs numeric;
    v_fight numeric;
    v_base integer;
    v_min integer;
    v_reward integer := 0;
    v_result text;
begin
    if v_me is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if hk_private.over_limit('mp_account', v_me::text) then
        return jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
    end if;
    select * into b from hk_private.hk_battles where id = p_battle for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'GONE');
    end if;
    if not (v_me = any(b.members)) then
        return jsonb_build_object('ok', false, 'error', 'NOT_MEMBER');
    end if;
    if b.result is not null then
        return hk_private.mp_view(v_me, false) || jsonb_build_object('reward', coalesce(b.reward, 0), 'result', b.result,
            'winner', case when b.winner_id is null then null else hk_private.mp_pid(b.winner_id) end);
    end if;
    -- PvP：先に知らせた方の結果を使う（p_win = true：自分の勝ち / false：自分の負け / null：引き分け）。報酬はない
    if b.boss_id like 'pvp:%' then
        update hk_private.hk_battles
        set finished_at = now(), result = 'pvp', reward = 0,
            winner_id = case when p_win is null then null when p_win then v_me
                             else (select x from unnest(b.members) x where x <> v_me limit 1) end
        where id = b.id
        returning * into b;
        update hk_private.hk_parties set status = 'open', battle_id = null, last_battle = b.id, updated_at = now()
        where id = b.party_id and battle_id = b.id;
        update hk_private.hk_party_members set entered = false, ready = false where party_id = b.party_id;
        return hk_private.mp_view(v_me, false) || jsonb_build_object('reward', 0, 'result', 'pvp',
            'winner', case when b.winner_id is null then null else hk_private.mp_pid(b.winner_id) end);
    end if;
    if coalesce(p_win, false) and v_me <> b.host_id then
        return jsonb_build_object('ok', false, 'error', 'NOT_HOST');
    end if;
    v_secs := extract(epoch from now() - b.started_at);
    v_fight := greatest(0, v_secs - 4);   -- 開始の演出（約4秒）を引いたクリアタイム
    v_result := case when coalesce(p_win, false) then 'win' else 'lose' end;
    if coalesce(p_win, false) then
        select r.coins, r.min_seconds into v_base, v_min from hk_private.hk_boss_rewards r where r.boss_id = b.boss_id;
        if v_base is not null and v_secs >= v_min then
            v_reward := v_base + case when v_fight <= 30 then 5 when v_fight <= 60 then 4 when v_fight <= 90 then 3
                                      when v_fight <= 120 then 2 when v_fight <= 180 then 1 else 0 end;
            with x as (
                select a.id, coalesce(a.data->'battle', '{}'::jsonb) as bt from hk_private.hk_accounts a where a.id = any(b.members)
            )
            update hk_private.hk_accounts a
            set data = jsonb_set(coalesce(a.data, '{}'::jsonb), '{battle}',
                    x.bt || jsonb_build_object(
                        'coins', coalesce((x.bt->>'coins')::numeric, 0) + v_reward,
                        'clears', coalesce(x.bt->'clears', '{}'::jsonb)
                                  || jsonb_build_object(b.boss_id, coalesce((x.bt->'clears'->>b.boss_id)::numeric, 0) + 1))),
                version = a.version + 1,
                updated_at = now()
            from x where a.id = x.id;
        else
            v_result := 'win_fast';
        end if;
    end if;
    update hk_private.hk_battles set finished_at = now(), result = v_result, reward = v_reward where id = b.id;
    update hk_private.hk_parties set status = 'open', battle_id = null, last_battle = b.id, updated_at = now()
    where id = b.party_id and battle_id = b.id;
    update hk_private.hk_party_members set entered = false, ready = false where party_id = b.party_id;
    return hk_private.mp_view(v_me, false) || jsonb_build_object('reward', v_reward, 'result', v_result);
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
-- マルチプレイ（星の酒場）の関数
revoke all on function public.hk_mp_state(text, boolean) from public, anon, authenticated;
revoke all on function public.hk_mp_create(text, text, text, text) from public, anon, authenticated;
revoke all on function public.hk_mp_join(text, uuid) from public, anon, authenticated;
revoke all on function public.hk_mp_leave(text) from public, anon, authenticated;
revoke all on function public.hk_mp_kick(text, text) from public, anon, authenticated;
revoke all on function public.hk_mp_close(text, boolean) from public, anon, authenticated;
revoke all on function public.hk_mp_enter(text, boolean) from public, anon, authenticated;
revoke all on function public.hk_mp_ready(text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.hk_mp_field(text, text) from public, anon, authenticated;
revoke all on function public.hk_mp_start(text) from public, anon, authenticated;
revoke all on function public.hk_mp_finish(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.hk_mp_state(text, boolean) to anon, authenticated;
grant execute on function public.hk_mp_create(text, text, text, text) to anon, authenticated;
grant execute on function public.hk_mp_join(text, uuid) to anon, authenticated;
grant execute on function public.hk_mp_leave(text) to anon, authenticated;
grant execute on function public.hk_mp_kick(text, text) to anon, authenticated;
grant execute on function public.hk_mp_close(text, boolean) to anon, authenticated;
grant execute on function public.hk_mp_enter(text, boolean) to anon, authenticated;
grant execute on function public.hk_mp_ready(text, boolean, jsonb) to anon, authenticated;
grant execute on function public.hk_mp_field(text, text) to anon, authenticated;
grant execute on function public.hk_mp_start(text) to anon, authenticated;
grant execute on function public.hk_mp_finish(text, uuid, boolean) to anon, authenticated;

commit;

-- API に新しい関数を知らせる
notify pgrst, 'reload schema';
