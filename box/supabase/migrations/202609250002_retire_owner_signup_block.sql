begin;

drop trigger if exists before_auth_user_reject_unmanaged_owner on auth.users;
drop function if exists public.prevent_unmanaged_center_owner_signup();

commit;
