-- =====================================================================
-- 04 - Admin com controle total dos produtos + avisos para o vendedor
-- Rode UMA vez no Supabase -> SQL Editor (pode rodar de novo sem problema).
--
-- 1) O Admin Supremo pode criar produto em nome de qualquer vendedor,
--    editar, transferir e excluir qualquer produto (fotos e promoções
--    inclusive). As regras dos vendedores continuam iguais.
-- 2) Tabela vendor_notifications: avisos do Admin para o vendedor
--    ("alterei o preço do seu produto", "excluí tal produto"...).
-- =====================================================================

begin;

-- Função auxiliar: quem está logado é Admin Supremo?
create or replace function public.is_supreme_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'supreme'
    );
$$;
revoke all on function public.is_supreme_admin() from public, anon;
grant execute on function public.is_supreme_admin() to authenticated;

-- ---------------------------------------------------------------------
-- 1) Produtos
-- ---------------------------------------------------------------------
drop policy if exists products_supreme_insert on public.products;
drop policy if exists products_supreme_update on public.products;
drop policy if exists products_supreme_delete on public.products;

-- cria em nome de um vendedor existente (vendedor ou admin, não banido)
create policy products_supreme_insert on public.products for insert to authenticated
    with check (
        (select public.is_supreme_admin())
        and exists (select 1 from public.profiles p
                    where p.id = owner_id
                      and p.role in ('seller', 'supreme')
                      and coalesce(p.status, 'active') <> 'banned')
    );

create policy products_supreme_update on public.products for update to authenticated
    using ((select public.is_supreme_admin()))
    with check (
        (select public.is_supreme_admin())
        and exists (select 1 from public.profiles p
                    where p.id = owner_id
                      and p.role in ('seller', 'supreme'))
    );

create policy products_supreme_delete on public.products for delete to authenticated
    using ((select public.is_supreme_admin()));

-- Fotos e promoções de qualquer produto
drop policy if exists product_media_supreme_all on public.product_media;
create policy product_media_supreme_all on public.product_media for all to authenticated
    using ((select public.is_supreme_admin()))
    with check ((select public.is_supreme_admin()));

drop policy if exists product_bulk_tiers_supreme_all on public.product_bulk_tiers;
create policy product_bulk_tiers_supreme_all on public.product_bulk_tiers for all to authenticated
    using ((select public.is_supreme_admin()))
    with check ((select public.is_supreme_admin()));

-- ---------------------------------------------------------------------
-- 2) Avisos do Admin para o vendedor
-- ---------------------------------------------------------------------
create table if not exists public.vendor_notifications (
    id          uuid primary key default gen_random_uuid(),
    vendor_id   uuid not null references public.profiles(id) on delete cascade,
    product_id  uuid references public.products(id) on delete set null,
    title       text not null check (char_length(title) between 1 and 120),
    message     text not null check (char_length(message) between 1 and 1000),
    created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
    created_at  timestamptz not null default now(),
    read_at     timestamptz
);

create index if not exists vendor_notifications_vendor_unread_idx
    on public.vendor_notifications (vendor_id, read_at, created_at desc);
create index if not exists vendor_notifications_product_idx
    on public.vendor_notifications (product_id);
create index if not exists vendor_notifications_created_by_idx
    on public.vendor_notifications (created_by);

alter table public.vendor_notifications enable row level security;

drop policy if exists vendor_notifications_select on public.vendor_notifications;
drop policy if exists vendor_notifications_insert on public.vendor_notifications;
drop policy if exists vendor_notifications_update on public.vendor_notifications;
drop policy if exists vendor_notifications_delete on public.vendor_notifications;

create policy vendor_notifications_select on public.vendor_notifications for select to authenticated
    using (vendor_id = (select auth.uid()) or (select public.is_supreme_admin()));

create policy vendor_notifications_insert on public.vendor_notifications for insert to authenticated
    with check ((select public.is_supreme_admin()));

-- o vendedor só marca como lido
create policy vendor_notifications_update on public.vendor_notifications for update to authenticated
    using (vendor_id = (select auth.uid()))
    with check (vendor_id = (select auth.uid()));

create policy vendor_notifications_delete on public.vendor_notifications for delete to authenticated
    using ((select public.is_supreme_admin()));

revoke all on public.vendor_notifications from anon;
grant select, insert, update, delete on public.vendor_notifications to authenticated;

-- vendedor não pode mexer em nada além de read_at
revoke update on public.vendor_notifications from authenticated;
grant update (read_at) on public.vendor_notifications to authenticated;

commit;

-- Aviso em tempo real (aparece na hora para o vendedor que está com o app aberto)
do $$
begin
    alter publication supabase_realtime add table public.vendor_notifications;
exception when duplicate_object then null;
end $$;
