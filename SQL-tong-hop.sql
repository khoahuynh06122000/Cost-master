
-- ============================================================
-- PHẦN 48 — KÝ SỐ PHIẾU ĐIỀU CHUYỂN (paperless) — 26/11/2026, bản 2611-04
-- Theo cách app BCSX-SKB ký phiếu nhập: chữ ký mẫu vẽ tay + nhập PIN lúc ký + mã băm SHA-256 nội dung phiếu.
-- (A) chu_ky_mau: mẫu chữ ký theo tài khoản, KHÔNG sửa / xoá (vẽ lại = thêm mẫu mới, phiếu cũ vẫn hiện nét ký cũ).
--     Chỉ cổng /api/ky (khoá service role) GHI được — vẽ lại phải qua PIN ở máy chủ. Người đăng nhập đọc được để hiện chữ ký.
-- (B) transfer_requests.chu_ky: { lap, giao, nhan, duyet } — chỉ cổng /api/ky ghi được (trigger chặn mọi đường khác).
--     Phiếu lập từ 27/11/2026: duyệt / nhận (sang Đã duyệt) phải có chữ ký người lập + chữ ký ô duyệt; quay về Chờ duyệt
--     (admin mở lại / bỏ từ chối) thì tự gỡ chữ ký giao · nhận · duyệt.
-- Chạy lại nhiều lần vẫn an toàn.
-- ============================================================
create table if not exists public.chu_ky_mau (
  id       text primary key,                 -- '<uid>_<yyyyMMddHHmmss>'
  user_id  uuid not null,
  ten      text,
  ma_nv    text,
  net      text not null,                    -- nét vẽ dạng đường SVG 'M x y L x y ...'
  rong     int,
  cao      int,
  bam      text,                             -- SHA-256 của 'ten|net'
  tao_luc  timestamptz not null default now()
);
create index if not exists chu_ky_mau_user_idx on public.chu_ky_mau (user_id, id desc);
alter table public.chu_ky_mau enable row level security;
alter table public.transfer_requests add column if not exists chu_ky jsonb;

do $$
begin
  execute 'drop policy if exists ckm_read on public.chu_ky_mau';
  execute 'create policy ckm_read on public.chu_ky_mau for select to authenticated using (true)';
  execute 'drop policy if exists pin_cong on public.chu_ky_mau';
  execute 'create policy pin_cong on public.chu_ky_mau as restrictive for all to authenticated using ((select public.pin_mo())) with check ((select public.pin_mo()))';
  execute 'drop policy if exists ver_cong on public.chu_ky_mau';
  execute 'create policy ver_cong on public.chu_ky_mau as restrictive for all to authenticated using ((select public.ver_ok())) with check ((select public.ver_ok()))';
end $$;

create or replace function public.dc_chu_ky_rao() returns trigger
language plpgsql as $fn$
declare
  may_chu boolean := coalesce(auth.role(), '') = 'service_role';
  moc timestamptz := '2026-11-27 00:00:00+07';
  o_duyet text;
begin
  if tg_op = 'INSERT' then
    if new.chu_ky is not null and not may_chu then raise exception 'CHU_KY_CHI_MAY_CHU' using errcode = '42501'; end if;
    return new;
  end if;
  if new.chu_ky is distinct from old.chu_ky and not may_chu then
    raise exception 'CHU_KY_CHI_MAY_CHU' using errcode = '42501';
  end if;
  -- Quay về Chờ duyệt: chữ ký duyệt / nhận cũ hết hiệu lực
  if new.status = 'Chờ duyệt' and old.status is distinct from 'Chờ duyệt' and new.chu_ky is not null then
    new.chu_ky := new.chu_ky - 'giao' - 'nhan' - 'duyet';
  end if;
  -- Duyệt / nhận phiếu lập từ ngày áp dụng: phải đủ chữ ký
  if new.status = 'Đã duyệt' and old.status is distinct from 'Đã duyệt' and not may_chu
     and coalesce(new.created_at, now()) >= moc then
    o_duyet := case new.kind when 'du' then 'nhan' when 'huy' then 'duyet' else 'giao' end;
    if new.chu_ky is null or (new.chu_ky -> 'lap') is null then
      raise exception 'CAN_KY_LAP: phiếu chưa có chữ ký người lập' using errcode = '42501';
    end if;
    if (new.chu_ky -> o_duyet) is null then
      raise exception 'CAN_KY_DUYET: phiếu chưa có chữ ký duyệt' using errcode = '42501';
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists dc_chu_ky_rao on public.transfer_requests;
create trigger dc_chu_ky_rao before insert or update on public.transfer_requests
  for each row execute function public.dc_chu_ky_rao();

-- Kiểm: bảng mẫu có 3 policy (ckm_read, pin_cong, ver_cong) · cột chu_ky có · trigger có
select (select count(*) from pg_policies where tablename = 'chu_ky_mau') as so_policy_mau,
       (select count(*) from information_schema.columns where table_name = 'transfer_requests' and column_name = 'chu_ky') as co_cot_chu_ky,
       (select count(*) from pg_trigger where tgname = 'dc_chu_ky_rao') as co_trigger;

-- ============================================================
-- PHẦN 49 — KÝ SỐ ĐIỀU CHUYỂN v2 + KẾ TOÁN CHỐT THÁNG — 26/11/2026, bản 2611-05 (thay trigger PHẦN 48)
-- Khoa: ai LẬP phiếu không quan trọng — chỉ cần chữ ký NGƯỜI XUẤT (giao) và NGƯỜI NHẬN (nhan); hủy: kho hủy (giao) + kế toán (duyet).
--   xin : giao (bên cho, lúc duyệt)  · nhan (bên xin, lúc nhận hàng)
--   du  : giao (bên chuyển, lúc lập) · nhan (bếp, lúc nhận = lúc duyệt)
--   huy : giao (kho hủy, lúc lập)    · duyet (kế toán, lúc duyệt)
-- Kế toán tải PDF phiếu cả tháng = CHỐT: ô 'kt' trong chu_ky. Phiếu đã chốt KHOÁ: không đổi trạng thái / số / chữ ký, không xoá.
-- Chạy lại nhiều lần vẫn an toàn.
-- ============================================================
create or replace function public.dc_chu_ky_rao() returns trigger
language plpgsql as $fn$
declare
  may_chu boolean := coalesce(auth.role(), '') = 'service_role';
  moc timestamptz := '2026-11-27 00:00:00+07';
  o_duyet text;
begin
  if tg_op = 'DELETE' then
    if old.chu_ky ? 'kt' then raise exception 'PHIEU_DA_CHOT: phiếu kế toán đã chốt, không xoá được' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.chu_ky is not null and not may_chu then raise exception 'CHU_KY_CHI_MAY_CHU' using errcode = '42501'; end if;
    return new;
  end if;
  -- Phiếu kế toán đã chốt: khoá mọi thay đổi nội dung
  if old.chu_ky ? 'kt' and (new.status is distinct from old.status or new.items is distinct from old.items
       or new.period is distinct from old.period or new.chu_ky is distinct from old.chu_ky) then
    raise exception 'PHIEU_DA_CHOT: phiếu kế toán đã chốt, không sửa được' using errcode = '42501';
  end if;
  if new.chu_ky is distinct from old.chu_ky and not may_chu then
    raise exception 'CHU_KY_CHI_MAY_CHU' using errcode = '42501';
  end if;
  -- Quay về Chờ duyệt (mở lại / bỏ từ chối): chữ ký lúc duyệt / nhận cũ hết hiệu lực; chữ ký người xuất lúc lập (hàng dư / hủy) giữ
  if new.status = 'Chờ duyệt' and old.status is distinct from 'Chờ duyệt' and new.chu_ky is not null then
    if new.kind in ('du', 'huy') then new.chu_ky := new.chu_ky - 'nhan' - 'duyet';
    else new.chu_ky := new.chu_ky - 'giao' - 'nhan'; end if;
  end if;
  -- Duyệt / nhận phiếu lập từ ngày áp dụng: phải có chữ ký ô duyệt (hàng dư / hủy: thêm chữ ký người xuất lúc lập)
  if new.status = 'Đã duyệt' and old.status is distinct from 'Đã duyệt' and not may_chu
     and coalesce(new.created_at, now()) >= moc then
    o_duyet := case new.kind when 'du' then 'nhan' when 'huy' then 'duyet' else 'giao' end;
    if new.kind in ('du', 'huy') and (new.chu_ky is null or (new.chu_ky -> 'giao') is null) then
      raise exception 'CAN_KY_XUAT: phiếu chưa có chữ ký người xuất' using errcode = '42501';
    end if;
    if new.chu_ky is null or (new.chu_ky -> o_duyet) is null then
      raise exception 'CAN_KY_DUYET: phiếu chưa có chữ ký duyệt' using errcode = '42501';
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists dc_chu_ky_rao on public.transfer_requests;
create trigger dc_chu_ky_rao before insert or update or delete on public.transfer_requests
  for each row execute function public.dc_chu_ky_rao();

-- Kiểm: trigger bắt cả DELETE (ra 1)
select count(*) as trigger_co_delete from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgname = 'dc_chu_ky_rao' and c.relname = 'transfer_requests' and (t.tgtype & 8) <> 0;
