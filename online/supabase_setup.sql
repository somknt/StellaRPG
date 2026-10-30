-- 星の子：オンラインのアカウント（PC・スマホで同じアカウントを使う）
-- Supabase の SQL Editor に全部はりつけて、1回だけ Run する（もう一度 Run しても大丈夫）
--
-- しくみ
--   hk_accounts：ユーザー名・パスワードのハッシュ（bcrypt）・セーブデータ
--   hk_sessions：ログインの鍵（ゲームが持つ鍵の SHA-256 だけを保存。鍵そのものは保存しない）
--   ゲームは、下の関数（hk_register / hk_login / hk_load / hk_save / hk_logout）だけを呼ぶ
--   2つの表は、ゲームの公開鍵（publishable / anon）からは直接読めない・書けない（RLS をかけて、権限も外す）
--   関数の答えは { "ok": true, ... } か { "ok": false, "error": "コード" }（エラーのコードは js/account.js の message）

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.hk_accounts (
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

create table if not exists public.hk_sessions (
    token_hash text primary key,
    account_id uuid not null references public.hk_accounts(id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);
create index if not exists hk_sessions_account on public.hk_sessions(account_id);

-- セーブデータの番号（保存するたびに +1）。PC とスマホが同時に保存した時に、あとの方が前の分を消さないように使う
alter table public.hk_accounts add column if not exists version bigint not null default 0;

alter table public.hk_accounts enable row level security;
alter table public.hk_sessions enable row level security;
revoke all on table public.hk_accounts from anon, authenticated;
revoke all on table public.hk_sessions from anon, authenticated;

-- ---------- 中だけで使う関数（ゲームからは呼べない） ----------
create or replace function public.hk_token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
    select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- 新しいログインの鍵を作る（90日有効。期限が切れた古い鍵は消す）
create or replace function public.hk_new_session(p_account uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
    t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
    delete from public.hk_sessions where account_id = p_account and expires_at < now();
    insert into public.hk_sessions(token_hash, account_id, expires_at)
    values (public.hk_token_hash(t), p_account, now() + interval '90 days');
    return t;
end $$;

-- 鍵からアカウントを探す（使うたびに期限を90日先へのばす）。なければ null
create or replace function public.hk_session_account(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    a uuid;
begin
    update public.hk_sessions set expires_at = now() + interval '90 days'
    where token_hash = public.hk_token_hash(p_token) and expires_at > now()
    returning account_id into a;
    return a;
end $$;

revoke execute on function public.hk_token_hash(text) from public, anon, authenticated;
revoke execute on function public.hk_new_session(uuid) from public, anon, authenticated;
revoke execute on function public.hk_session_account(text) from public, anon, authenticated;

-- ---------- ゲームから呼ぶ関数 ----------
-- アカウントを作る：ユーザー名は半角英数字と _ で3〜16文字、パスワードは6〜64文字
create or replace function public.hk_register(p_username text, p_password text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    a public.hk_accounts;
begin
    if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,16}$' then
        return jsonb_build_object('ok', false, 'error', 'BAD_USERNAME');
    end if;
    if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 64 then
        return jsonb_build_object('ok', false, 'error', 'BAD_PASSWORD');
    end if;
    if octet_length(coalesce(p_data, '{}'::jsonb)::text) > 65536 then
        return jsonb_build_object('ok', false, 'error', 'DATA_TOO_LARGE');
    end if;
    if exists (select 1 from public.hk_accounts where username_key = lower(p_username)) then
        return jsonb_build_object('ok', false, 'error', 'USERNAME_TAKEN');
    end if;
    begin
        insert into public.hk_accounts(username, username_key, pass_hash, data)
        values (p_username, lower(p_username), extensions.crypt(p_password, extensions.gen_salt('bf', 10)), coalesce(p_data, '{}'::jsonb))
        returning * into a;
    exception when unique_violation then
        return jsonb_build_object('ok', false, 'error', 'USERNAME_TAKEN');
    end;
    return jsonb_build_object('ok', true, 'token', public.hk_new_session(a.id), 'username', a.username,
                              'data', a.data, 'version', a.version, 'updated_at', a.updated_at);
end $$;

-- ログイン：8回続けてまちがえたら、5分間ログインできない
create or replace function public.hk_login(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    a public.hk_accounts;
begin
    select * into a from public.hk_accounts where username_key = lower(coalesce(p_username, ''));
    if not found then
        return jsonb_build_object('ok', false, 'error', 'BAD_LOGIN');
    end if;
    if a.locked_until is not null and a.locked_until > now() then
        return jsonb_build_object('ok', false, 'error', 'LOCKED');
    end if;
    if a.pass_hash <> extensions.crypt(coalesce(p_password, ''), a.pass_hash) then
        if a.failed_count + 1 >= 8 then
            update public.hk_accounts set failed_count = 0, locked_until = now() + interval '5 minutes' where id = a.id;
        else
            update public.hk_accounts set failed_count = a.failed_count + 1 where id = a.id;
        end if;
        return jsonb_build_object('ok', false, 'error', 'BAD_LOGIN');
    end if;
    update public.hk_accounts set failed_count = 0, locked_until = null where id = a.id;
    return jsonb_build_object('ok', true, 'token', public.hk_new_session(a.id), 'username', a.username,
                              'data', a.data, 'version', a.version, 'updated_at', a.updated_at);
end $$;

-- セーブデータを読む
create or replace function public.hk_load(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_id uuid := public.hk_session_account(p_token);
    a public.hk_accounts;
begin
    if v_id is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    select * into a from public.hk_accounts where public.hk_accounts.id = v_id;
    return jsonb_build_object('ok', true, 'username', a.username, 'data', a.data, 'version', a.version, 'updated_at', a.updated_at);
end $$;

-- セーブデータを書く（64KB まで）
--   p_version：読んだ時の番号。そのあとにほかの端末が書いていたら書かずに CONFLICT を返す（ゲームが読み直して当て直す）
drop function if exists public.hk_save(text, jsonb);
create or replace function public.hk_save(p_token text, p_data jsonb, p_version bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_id uuid := public.hk_session_account(p_token);
    v_version bigint;
    t timestamptz;
begin
    if v_id is null then
        return jsonb_build_object('ok', false, 'error', 'SESSION');
    end if;
    if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 65536 then
        return jsonb_build_object('ok', false, 'error', 'DATA_TOO_LARGE');
    end if;
    update public.hk_accounts
    set data = p_data, updated_at = now(), version = public.hk_accounts.version + 1
    where public.hk_accounts.id = v_id
      and (p_version is null or public.hk_accounts.version = p_version)
    returning public.hk_accounts.version, public.hk_accounts.updated_at into v_version, t;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'CONFLICT');
    end if;
    return jsonb_build_object('ok', true, 'version', v_version, 'updated_at', t);
end $$;

-- ログアウト（その端末の鍵だけ消す）
create or replace function public.hk_logout(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
    delete from public.hk_sessions where token_hash = public.hk_token_hash(p_token);
    return jsonb_build_object('ok', true);
end $$;

grant execute on function public.hk_register(text, text, jsonb) to anon, authenticated;
grant execute on function public.hk_login(text, text) to anon, authenticated;
grant execute on function public.hk_load(text) to anon, authenticated;
grant execute on function public.hk_save(text, jsonb, bigint) to anon, authenticated;
grant execute on function public.hk_logout(text) to anon, authenticated;

-- API に新しい関数を知らせる
notify pgrst, 'reload schema';
