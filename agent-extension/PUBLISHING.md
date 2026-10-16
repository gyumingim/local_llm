# 배포 · 게시 가이드

## A. 직접 배포 (가장 간단 — 지금 바로 가능)
1. `npx @vscode/vsce package` → `local-agent-0.0.1.vsix` 생성
2. 다른 컴퓨터에서: VSCode 확장 패널 → `⋯` → **"VSIX에서 설치"** → 파일 선택
3. 그 컴퓨터에도 **Python + Ollama + 모델**이 필요 (README 참고). codeact는 확장에 번들돼 있어 경로 설정 불필요.

## B. VS Code 마켓플레이스 게시 (상용 배포)
> 이 단계는 **당신의 계정**이 필요해 제가 대신 못 합니다. 아래 순서대로 하시면 됩니다.

1. **Publisher 계정 생성**
   - https://marketplace.visualstudio.com/manage 에서 publisher 등록
   - `package.json`의 `"publisher": "local"`을 등록한 이름으로 변경
2. **Personal Access Token(PAT)**
   - https://dev.azure.com → User settings → Personal Access Tokens
   - Scope: **Marketplace > Manage**
3. **아이콘 준비** (필수)
   - `icon.png` — **128x128 PNG**. (현재 `robot.svg`를 PNG로 변환해서 넣으세요. 예: 온라인 svg→png 변환기, 또는 `sharp`/`inkscape`)
4. **게시**
   ```bash
   npx @vscode/vsce login <publisher>   # PAT 입력
   npx @vscode/vsce publish
   ```

## 남은 상용화 과제 (솔직한 체크리스트)
- [ ] `icon.png` 128x128 (지금 svg만 있음)
- [ ] `repository` 필드에 실제 GitHub URL
- [ ] Ollama·모델 **자동 설치 스크립트** (지금은 사용자가 직접 `ollama pull`)
- [ ] Python 미설치 시 안내/유도
- [ ] 두뇌(로컬 35B)는 클라우드보다 약함 — 하드웨어 한계 (코드로 못 넘음)
