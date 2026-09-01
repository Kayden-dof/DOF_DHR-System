p = 'app/login/page.tsx'
s = open(p, encoding='utf-8').read()

old = '      <section className="band-dark relative hidden flex-col justify-between overflow-hidden p-14 lg:flex">'
new = """      {/*
        * justify-between 을 쓰지 않는다. 그러면 로고 자리가 아래에 무엇이
        * 있느냐에 딸려 다닌다 - 슬로건을 비웠더니 로고가 바닥으로 내려갔다
        * (사용자 지적 2026-09-01). 로고는 남는 자리 한가운데 두고, 슬로건 줄은
        * 글이 없어도 자리를 지킨다.
        */}
      <section className="band-dark relative hidden flex-col overflow-hidden p-14 lg:flex">"""
assert old in s
s = s.replace(old, new)

old = """        <div className="relative">
          <BrandMark className="w-[clamp(18rem,30vw,26rem)] text-[3.5rem]" dark />
        </div>"""
new = """        <div className="relative flex flex-1 items-center">
          <BrandMark className="w-[clamp(18rem,30vw,26rem)] text-[3.5rem]" dark />
        </div>"""
assert old in s
s = s.replace(old, new)

old = """        {brand.companyTagline && (
          <p className="relative text-[0.6875rem] font-medium tracking-[0.18em] text-on-dark-mute">
            {brand.companyTagline}
          </p>
        )}"""
new = """        {/*
          * 비어 있어도 줄을 그린다. 없애면 로고가 그만큼 내려앉는다. 높이는
          * 글자 크기와 줄 간격에서 그대로 셈한다.
          */}
        <p className="relative min-h-[calc(1.5*0.6875rem)] text-[0.6875rem]
                      font-medium tracking-[0.18em] text-on-dark-mute">
          {brand.companyTagline}
        </p>"""
assert old in s
s = s.replace(old, new)

s = s.replace("""          * 회사 슬로건도 설정에서 온다 (0073). 전에는 DOF 문구가 박혀
          * 있어, 다른 제조소가 받으면 자기 로고 아래에 남의 회사 설명이 붙었다.
          * 적어 두지 않은 제조소에서는 아무것도 나오지 않는다 - 지어내지 않는다.""",
"""          * 회사 슬로건도 설정에서 온다 (0073). 전에는 DOF 문구가 박혀
          * 있어, 다른 제조소가 받으면 자기 로고 아래에 남의 회사 설명이 붙었다.
          * 적어 두지 않은 제조소에서는 아무것도 나오지 않는다 - 지어내지 않는다.""", 1)
open(p, 'w', encoding='utf-8').write(s)
print('ok')
