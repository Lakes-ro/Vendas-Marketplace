create extension if not exists pg_net with schema extensions;

-- Celulares/navegadores inscritos para receber push (um por aparelho)
create table if not exists public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    user_agent text,
    created_at timestamptz not null default now(),
    last_used_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists push_sub_select_own on public.push_subscriptions;
drop policy if exists push_sub_insert_own on public.push_subscriptions;
drop policy if exists push_sub_update_own on public.push_subscriptions;
drop policy if exists push_sub_delete_own on public.push_subscriptions;
create policy push_sub_select_own on public.push_subscriptions for select using (user_id = (select auth.uid()));
create policy push_sub_insert_own on public.push_subscriptions for insert with check (user_id = (select auth.uid()));
create policy push_sub_update_own on public.push_subscriptions for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_sub_delete_own on public.push_subscriptions for delete using (user_id = (select auth.uid()));

-- Configuração secreta (só o servidor lê: RLS ligado, sem policy, sem grant)
create table if not exists public.push_config (
    id int primary key default 1 check (id = 1),
    vapid_public text not null,
    vapid_private text not null,
    vapid_subject text not null,
    hook_secret text not null,
    function_url text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

insert into public.push_config (id, vapid_public, vapid_private, vapid_subject, hook_secret, function_url)
values (1, 'BHh--3pMyxKxd6P49gRpsotKuBYuSsF32JZTqY4gMDw2olImuD75WI1y4_tlwXc4XjU5J6qM2QY-TIAV34u9Pi0', '<CHAVE_PRIVADA_VAPID>', 'mailto:rogeralmeida15000@gmail.com', '<SEGREDO_DO_WEBHOOK>',
        'https://dkzbpevakiiwzuimzftz.supabase.co/functions/v1/send-push')
on conflict (id) do update set vapid_public = excluded.vapid_public, vapid_private = excluded.vapid_private,
    vapid_subject = excluded.vapid_subject, hook_secret = excluded.hook_secret, function_url = excluded.function_url;

-- Dispara a função de push (assíncrono: não atrasa nem derruba a compra)
create or replace function public.notify_order_push(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
    cfg record;
begin
    select function_url, hook_secret into cfg from public.push_config where id = 1;
    if cfg is null then return; end if;
    perform net.http_post(
        url := cfg.function_url,
        body := jsonb_build_object('order_id', p_order_id),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', cfg.hook_secret),
        timeout_milliseconds := 5000
    );
end;
$$;
revoke execute on function public.notify_order_push(uuid) from public, anon, authenticated;
