/* ===========================================================================
   0174 · 품목을 쓰는 제품을 손으로 지정한다 (사용자 2026-11-27)

   "PM-028 사용설명서는 인터넷 제공이라 없어도 되고, PM-029 차트 라벨, 무지라벨, BI 는 공통,
    EO멸균 CI 는 DX2402 전용 / PM-038 메디포젠 제품박스(단상자) 는 DX2401 전용임."

   재고 화면의 제품 탭은 그 제품 판의 공정 구성표 · 판의 원료 · 원액 원료로 품목을 나눈다.
   그런데 구성표는 서면 제조기록서 · 제품표준서를 그대로 옮긴 것이라, 서면에 없는 자재를 탭에
   넣으려고 구성표에 줄을 더하면 서면과 어긋난다 (DX2402 는 11-20 서면 R05 에 맞추며 BI 를
   구성표에서 뺐다). 그래서 구성표는 두고, 품목에 «쓰는 제품» 을 따로 적는다.

     product_codes  이 품목을 쓰는 제품 코드 (device_master.product_code). 구성표로 잡히는
                    제품은 적지 않아도 된다. 재고 화면의 제품 탭에만 쓴다 - 소요량 · 최소
                    재고선 셈에는 들지 않는다.
=========================================================================== */

alter table item add column if not exists product_codes text[];

alter table item drop constraint if exists item_product_codes_check;
alter table item add constraint item_product_codes_check check (
  product_codes is null
  or (cardinality(product_codes) > 0 and array_position(product_codes, null) is null)
);

comment on column item.product_codes is
  '이 품목을 쓰는 제품 코드 (손 지정, 0174). 구성표 · 판 원료로 잡히는 제품에 더해 재고 화면 제품 탭에 쓴다';
