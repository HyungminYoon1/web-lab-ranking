# WEB LAB ranking

PARCEL PANIC의 최종 계약과 NEON TACTICS의 최종 방어선에만 적용하는 공개 기록 API입니다. 나머지 앱의 개인 기록은 보내지 않습니다.

[서비스 상태](https://web-lab-ranking.hyeongmin92.workers.dev/health) · [WEB LAB](https://hyungminyoon1.github.io/web-lab/)

프런트엔드는 기존 GitHub Pages, API와 저장은 Workers Free의 SQLite-backed Durable Object를 사용합니다. 계정·이메일 대신 브라우저별 익명 식별값을 사용합니다. 게시할 때 입력한 닉네임과 서버에서 재계산한 최고 기록만 공개합니다. 자동 게시하지 않습니다.

서버는 고정된 최초 상태에서 명령을 다시 실행합니다. 단순 점수 변조는 받지 않지만, 사람이 직접 플레이했는지 또는 다른 사람이 해답을 공유했는지는 검증하지 않습니다.

- [구조](architecture.md)
- [HTTP 계약](api-spec.md)
- [결정 기록](docs/decisions.md)
- [검증 기록](docs/verification.md)

## 개발

Node 22 이상. 고정된 Wrangler 개발 의존성 외 런타임 패키지는 없습니다.

```sh
npm ci
npm test
npm run check
npm run dev -- --var ALLOW_LOCAL:true
```

기본 개발 주소는 loopback입니다. 공개 배포는 Workers Free 확인 후에만 실행합니다. 유료 업그레이드·카드 등록·자동 과금 설정은 하지 않습니다. 제한 도달 시 랭킹 등록만 중단하고 Pages 게임 자체는 계속 작동합니다.

유효 기간: 도전 티켓 4시간, 익명 기록은 마지막 활동 후 180일. 만료 기록은 순위 조회에서 제외하며 기존 조회 캐시는 최대 30초입니다. 실제 삭제는 다음 요청 때 제한된 묶음으로 처리하므로 요청이 없으면 지연될 수 있습니다. 게임 내 ‘공개 기록 삭제’로 서버 기록과 이 브라우저의 익명 식별값을 삭제할 수 있습니다. 브라우저 기록만 먼저 지우면 삭제 권한도 잃을 수 있습니다. 여러 사람의 신원이나 사용자 수를 확인하는 서비스가 아닙니다.

개인 플레이·공개 서버·로컬 더블·workerd·실제 공개 검증 결과는 분리해 기록합니다. 비밀값이나 환경 파일은 커밋하지 않습니다.
