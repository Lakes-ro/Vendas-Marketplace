-- =====================================================================
-- CORREÇÕES DE SEGURANÇA NO BANCO — Ityrapuã Store (projeto Vendas fadminas)
-- Rode UMA VEZ no Supabase → SQL Editor. Pode rodar de novo sem problema.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Vitrine enxergar vendedor offline
--    Hoje só o próprio vendedor lê vendor_status, então a vitrine
--    sempre achava que todo mundo estava online.
-- ---------------------------------------------------------------------
drop policy if exists "vitrine le status dos vendedores" on public.vendor_status;
create policy "vitrine le status dos vendedores"
    on public.vendor_status for select
    using (true);

-- ---------------------------------------------------------------------
-- 2) Só vendedor/admin cadastra produto
--    A policy "vendor_manage_own_items" (ALL) deixava QUALQUER conta
--    logada (inclusive cliente) inserir produto.
-- ---------------------------------------------------------------------
drop policy if exists vendor_manage_own_items on public.products;
drop policy if exists products_insert_seller on public.products;
drop policy if exists products_update_owner on public.products;
drop policy if exists products_delete_owner on public.products;

create policy products_insert_seller on public.products for insert
    with check (
        owner_id = (select auth.uid())
        and exists (select 1 from public.profiles p
                    where p.id = (select auth.uid())
                      and p.role in ('seller', 'supreme')
                      and coalesce(p.status, 'active') <> 'banned')
    );

create policy products_update_owner on public.products for update
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));

create policy products_delete_owner on public.products for delete
    using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 3) Bloqueio manual da moderação não pode ser desfeito editando o produto
-- ---------------------------------------------------------------------
create or replace function public.check_product_moderation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_text  text;
    v_match text;
begin
    if current_setting('app.moderation_bypass', true) = 'true' then
        return new;
    end if;

    -- Produto bloqueado À MÃO pelo Admin: continua bloqueado até ele aprovar
    if tg_op = 'UPDATE' and old.flagged and old.moderated_by is not null then
        new.flagged      := true;
        new.flag_reason  := old.flag_reason;
        new.active       := false;
        new.moderated_at := old.moderated_at;
        new.moderated_by := old.moderated_by;
        return new;
    end if;

    v_text := lower(coalesce(new.name, '') || ' ' || coalesce(new.description, ''));

    select word into v_match
      from moderation_keywords
     where v_text like '%' || lower(word) || '%'
     order by length(word) desc
     limit 1;

    if v_match is not null then
        new.flagged     := true;
        new.flag_reason := v_match;
        new.active      := false;
    else
        -- estava retido só por palavra proibida e a palavra saiu → volta pra vitrine
        if tg_op = 'UPDATE' and old.flagged then
            new.active := true;
        end if;
        new.flagged     := false;
        new.flag_reason := null;
    end if;

    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Storage: fotos de produto
--    Hoje QUALQUER visitante anônimo pode enviar e APAGAR qualquer foto
--    do bucket product-images.
--    Novos uploads vão para a pasta "<id do usuário>/...".
-- ---------------------------------------------------------------------
drop policy if exists "Give anon users access to JPG images in folder 16wiy3a_1" on storage.objects;
drop policy if exists "Give anon users access to JPG images in folder 16wiy3a_2" on storage.objects;
drop policy if exists "Public Upload" on storage.objects;
drop policy if exists "product_images_seller_upload" on storage.objects;
drop policy if exists "product_images_owner_delete" on storage.objects;

create policy "product_images_seller_upload" on storage.objects for insert to authenticated
    with check (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (select 1 from public.profiles p
                    where p.id = (select auth.uid()) and p.role in ('seller', 'supreme'))
    );

create policy "product_images_owner_delete" on storage.objects for delete to authenticated
    using (
        bucket_id = 'product-images'
        and (
            (storage.foldername(name))[1] = (select auth.uid())::text
            or exists (select 1 from public.profiles p
                       where p.id = (select auth.uid()) and p.role = 'supreme')
        )
    );

-- ---------------------------------------------------------------------
-- 5) Storage: imagens de anúncio — só o Admin envia
-- ---------------------------------------------------------------------
drop policy if exists "Authenticated Upload" on storage.objects;
drop policy if exists "ad_images_supreme_upload" on storage.objects;
drop policy if exists "ad_images_supreme_delete" on storage.objects;

create policy "ad_images_supreme_upload" on storage.objects for insert to authenticated
    with check (
        bucket_id = 'ad-images'
        and exists (select 1 from public.profiles p
                    where p.id = (select auth.uid()) and p.role = 'supreme')
    );

create policy "ad_images_supreme_delete" on storage.objects for delete to authenticated
    using (
        bucket_id = 'ad-images'
        and exists (select 1 from public.profiles p
                    where p.id = (select auth.uid()) and p.role = 'supreme')
    );

-- ---------------------------------------------------------------------
-- 6) Comprovantes Pix: o vendedor vê o comprovante dos pedidos DELE
--    Caminho novo: "<id do pedido>/<id do vendedor>/arquivo"
-- ---------------------------------------------------------------------
drop policy if exists "payment_proofs_vendor_read" on storage.objects;
create policy "payment_proofs_vendor_read" on storage.objects for select to authenticated
    using (
        bucket_id = 'payment-proofs'
        and (storage.foldername(name))[2] = (select auth.uid())::text
    );

-- ---------------------------------------------------------------------
-- 7) O checkout (visitante sem login) precisa chamar essas funções
-- ---------------------------------------------------------------------
grant execute on function public.create_order(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.register_order_vendor_payments(uuid) to anon, authenticated;
grant execute on function public.attach_vendor_payment_proof(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.attach_payment_proof(uuid, text, text) to anon, authenticated;

commit;
