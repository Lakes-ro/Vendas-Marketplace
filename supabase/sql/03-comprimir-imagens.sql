-- =====================================================================
-- 03 - Ferramenta "Comprimir fotos" do Admin
-- Rode UMA vez no Supabase -> SQL Editor.
--
-- O Admin precisa trocar o endereço da foto antiga pela versão leve em
-- produtos de QUALQUER vendedor. As regras de segurança só deixam cada
-- vendedor alterar os próprios produtos, então esta função faz a troca
-- e confere antes que quem chamou é o Admin Supremo.
-- =====================================================================

create or replace function public.admin_replace_image_url(p_old text, p_new text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_total integer := 0;
    v_rows  integer;
begin
    if not exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'supreme'
    ) then
        raise exception 'not_allowed';
    end if;

    if coalesce(p_old, '') = '' or coalesce(p_new, '') = '' then
        raise exception 'invalid_url';
    end if;

    -- só aceita endereço do próprio Storage do projeto
    if p_new not like '%/storage/v1/object/public/product-images/%'
       and p_new not like '%/storage/v1/object/public/ad-images/%' then
        raise exception 'invalid_url';
    end if;

    update public.product_media set media_url = p_new where media_url = p_old;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;

    update public.products set image_url = p_new where image_url = p_old;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;

    update public.ads set image_url = p_new where image_url = p_old;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;

    return v_total;
end;
$$;

revoke all on function public.admin_replace_image_url(text, text) from public, anon;
grant execute on function public.admin_replace_image_url(text, text) to authenticated;
