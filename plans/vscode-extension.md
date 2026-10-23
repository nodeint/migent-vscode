# Plan: Migent cho VS Code

Mục tiêu: giúp dev quản lý và theo dõi session, chạy workflow trực tiếp trong VS Code mà không cần mở terminal.

Điều kiện tiên quyết: [`session-cancel.md`](./session-cancel.md) phải xong trước, vì nút Stop cần `migent session cancel` (Windows không có signal để hủy êm).

## 1. Nguyên tắc thiết kế

1. **Native trước, webview sau.** TreeView, Quick Pick, Input Box, status bar, notification và editor có sẵn lo 90% nhu cầu. Webview chỉ dùng cho sơ đồ workflow và dashboard metrics (giai đoạn sau).
2. **File là nguồn sự thật.** Extension đọc `.migent/sessions/**` và không giữ trạng thái riêng. Session chạy từ terminal hay từ agent khác vẫn hiện ra.
3. **Lệnh đi qua CLI.** Mọi thao tác ghi (run, continue, cancel, prepare) gọi `migent`. Extension không ghi vào `status.json`, `events.jsonl`, `manifest.yaml` hay `executions/` (docs/sessions.md cấm sửa tay các file này).
4. **Không import `@nodeint/migent-kernel`.** README nói các package nội bộ không có API ổn định. Contract duy nhất là: định dạng file được document, đầu ra `--json` và exit code.
5. **Logic thuần tách khỏi `vscode`.** Thư mục `core/` không import `vscode`, test được bằng vitest không cần khởi động VS Code.
6. **Từ chối đoán.** Gặp `schema_version` hoặc version CLI lạ thì chuyển sang chế độ chỉ-đọc và báo rõ, không suy diễn.

## 2. Repo, công cụ, phát hành

- Repo riêng: `nodeint/migent-vscode` (lý do: extension chỉ là consumer của contract công khai; toolchain, nhịp phát hành khác với CLI).
- TypeScript, build bằng esbuild (bundle một file `dist/extension.js`, `external: ["vscode"]`), test bằng vitest cho `core/` và `@vscode/test-electron` cho phần tích hợp.
- Package manager: pnpm (khớp migent). Lint/format theo cấu hình của migent nếu có.
- Phát hành: `vsce package` → VS Code Marketplace, đồng thời Open VSX. Publisher: cần xác nhận (xem câu hỏi mở).
- `engines.vscode`: `^1.90.0` (xác nhận lại khi scaffold, chỉ nâng khi cần API mới).
- Kích hoạt: `activationEvents: ["workspaceContains:.migent/config.yaml"]`, không dùng `*`.
- Hỗ trợ workspace nhiều thư mục (multi-root): mỗi folder có `.migent/` là một "project" riêng.

## 3. Contract với migent

Extension phụ thuộc vào những thứ sau. Thay đổi bất kỳ điều nào là thay đổi contract, phải tăng `schema_version` và báo cho repo extension.

| Nguồn | Dùng để | Ghi chú |
|---|---|---|
| `manifest.yaml` | id, title, workflow_id, created_at, `schema_version` | `schema_version: 2` hiện tại |
| `status.json` | trạng thái session | ghi nguyên tử |
| `session.lock` | session đang chạy | `{pid, host, started_at, heartbeat_at, nonce}`, stale sau 30 giây |
| `events.jsonl` | timeline | envelope `{v, seq, event, timestamp, execution_id, stage_id, summary, data}` |
| `executions/<id>/execution.json` | stage, attempt, provider, model, status, outcome, owner_pid, hostname | |
| `executions/<id>/{prompt.md,response.md,artifacts/,turns/*/verify.md}` | mở xem | chỉ đọc |
| `executions/<id>/stream.jsonl` | log provider chi tiết | chỉ đọc khi người dùng mở |
| `outputs/*` | kết quả đã publish | `status.json.outputs` có đường dẫn và provenance |
| `metrics.json` | token, chi phí, thời gian | chỉ có khi workflow session `completed` |
| `.migent/workflows/*.yaml` | danh sách workflow cho Run | đọc `id`/tên file và `stages` cho hiển thị |
| `migent --version` | kiểm tra tương thích | |
| `migent session list/show/metrics --json` | tải ban đầu, đối chiếu | |
| `migent session run/continue/prepare/cancel` | thao tác | exit code: 0 xong, 1 chưa xong, 3 stage_failed, 6 verify_exhausted, 7 verify, 8 quota, 130 cancelled |

Kiểm tra khi khởi động: `migent --version` ≥ bản tối thiểu (cấu hình trong extension). Thiếu CLI hoặc quá cũ thì hiển thị welcome view hướng dẫn cài và chuyển sang chỉ-đọc. Thiếu `session cancel` thì ẩn nút Stop.

## 4. Trạng thái hiển thị

`status.json.status` không đủ. Session `active` mà không có lock chỉ là "dừng, có thể resume". Trạng thái hiển thị suy ra như sau:

| Hiển thị | Điều kiện | Icon (codicon) |
|---|---|---|
| Prepared | `status = prepared` | `circle-outline` |
| Running | lock còn sống (xem dưới) | `sync~spin` |
| Blocked | `status = blocked` | `warning` |
| Failed | `active`, không lock, `latest_execution_status = failed` | `error` |
| Stopped | `active`, không lock, execution cuối không failed | `debug-pause` |
| Cancelled | `status = cancelled` | `circle-slash` |
| Completed | `status = completed` | `pass` |
| Unknown | schema lạ, status.json hỏng | `question` |

**Lock còn sống:** file `session.lock` parse được, `host` trùng `os.hostname()`, `process.kill(pid, 0)` không ném `ESRCH`, và `heartbeat_at` trong vòng 30 giây. Lock của host khác hiển thị Running (không kiểm được pid) nhưng thao tác ghi bị khóa. Lock không parse được thì dựa vào mtime của file, giống `session-lock.ts`.

Hàm `deriveDisplayState(status, lock, now)` là hàm thuần, bảng quyết định ở trên là bộ test của nó.

## 5. Kiến trúc

```
migent-vscode/
  src/
    extension.ts               # activate/deactivate: chỉ nối các phần
    core/                      # KHÔNG import vscode
      paths.ts                 # đường dẫn trong .migent
      manifest.ts              # parse manifest.yaml (thư viện `yaml`)
      statusReader.ts          # đọc status.json an toàn (retry khi đang ghi)
      lockProbe.ts             # session.lock -> alive | stale | none
      displayState.ts          # deriveDisplayState
      eventTail.ts             # tail events.jsonl theo byte offset
      executions.ts            # đọc execution.json cho cây
      workflows.ts             # liệt kê và đọc .migent/workflows
      model.ts                 # kiểu SessionSnapshot, ExecutionSnapshot...
      store.ts                 # SessionStore: snapshot + sự kiện thay đổi
    cli/
      locate.ts                # tìm binary migent (setting, PATH, node_modules)
      invoke.ts                # chạy lệnh ngắn, parse --json
      runner.ts                # quản lý process dài: run/continue, cancel
      version.ts               # kiểm tra tương thích
    vscode/                    # lớp nối với API VS Code
      projects.ts              # theo dõi các workspace folder có .migent
      watcher.ts               # FileSystemWatcher -> store
      views/sessionsTree.ts
      views/welcome.ts
      statusBar.ts
      notifications.ts
      content/sessionDocs.ts   # TextDocumentContentProvider
      log/channels.ts          # LogOutputChannel theo session
      commands/*.ts            # mỗi lệnh một file
      pick.ts                  # Quick Pick workflow, session
  test/
    fixtures/sessions/         # session thật (đã ẩn dữ liệu) cho từng trạng thái
    core/*.test.ts
    integration/*.test.ts
  package.json  esbuild.mjs  tsconfig.json  .vscodeignore
```

Luồng dữ liệu một chiều: **watcher → store → view**. View không bao giờ tự đọc đĩa. Lệnh gọi CLI, kết quả quay lại qua watcher (file đổi), không cập nhật store trực tiếp, để tránh hai nguồn sự thật.

### 5.1 SessionStore

- `Map<projectRoot, Map<sessionId, SessionSnapshot>>`.
- `SessionSnapshot` gồm manifest, status, lock, displayState, danh sách execution (nhẹ: id, stage, attempt, status, decision), `lastEventSeq`.
- `onDidChange(event: {project, sessionId, kind})` để view refresh đúng phần cần.
- Tải ban đầu: quét `.migent/sessions/*/` (đọc trực tiếp, nhanh hơn spawn CLI). `migent session list --json` chỉ dùng để đối chiếu khi bật chế độ chẩn đoán.
- Nạp lười: danh sách ban đầu chỉ đọc manifest + status + lock. Danh sách execution chỉ đọc khi nút của session được mở rộng hoặc session đang chạy.
- Giới hạn: hiển thị N session mới nhất (mặc định 50), có "Hiện thêm". Thư mục sessions có thể lên hàng trăm mục.

### 5.2 Watcher

- Một `FileSystemWatcher` theo project: glob `.migent/sessions/*/{status.json,session.lock,cancel.requested}` và `.migent/sessions/*/executions/*/execution.json`. Thư mục `.migent` thường bị ẩn bởi `files.watcherExclude` của người dùng; dùng `RelativePattern` trên đường dẫn cụ thể và kiểm tra ở bước thử nghiệm Windows.
- Gom sự kiện bằng debounce 150ms theo session. Mỗi lần đọc lại session đó, không đọc cả thư mục.
- Timer 10 giây chỉ chạy khi có ít nhất một session Running: kiểm tra lại `lockProbe` để bắt lock chết không phát sinh sự kiện file (process bị kill cứng).
- `status.json` được ghi nguyên tử nên đọc được trọn vẹn. Khi parse lỗi (thấy trong lúc rename trên Windows), thử lại sau 100ms, tối đa 3 lần rồi đánh dấu Unknown.

### 5.3 Event tail

- Dùng cho Output Channel của session và thông báo thời gian thực. Giữ `offset` theo từng session; mỗi lần đọc từ `offset` đến hết file, chỉ xử lý các dòng đã có `\n` kết thúc, phần còn lại giữ cho lần sau (log có thể bị ghi dở; kernel có `sealTornTail`).
- `seq` dùng để loại trùng. Gặp `v` lạ thì hiển thị nguyên dòng, không bỏ.
- Chỉ bật tail cho session đang được mở log hoặc đang Running để tiết kiệm.

### 5.4 Thi hành lệnh (`cli/`)

- **Lệnh ngắn** (`--version`, `session show --json`, `prepare`): `execFile`, timeout, parse JSON, lỗi có kiểu.
- **Lệnh dài** (`session run`, `session continue`): `spawn` với `windowsHide: true`, `stdio` được đọc (stderr là log theo dòng), `detached: true` trên POSIX để sống qua việc reload cửa sổ. Trên Windows kiểm tra riêng việc process con còn chạy sau khi extension host thoát (xem rủi ro). Không dùng shell, truyền `argv` thẳng.
- Biến môi trường: kế thừa từ VS Code; cho phép thiết lập thêm qua setting `migent.env`.
- Kết quả: map exit code sang enum (`Completed | NotFinished | StageFailed | VerifyExhausted | Quota | Cancelled | ConfigError`), kèm `response:` hoặc `verify:` từ stderr để mở nhanh file liên quan.
- Chạy đồng thời: `SessionLock` đã chặn hai tiến trình cùng session, nhưng extension cũng kiểm tra trước (nút Run/Continue bị tắt khi Running) để tránh thông báo lỗi.
- `--max-dispatches` và các cờ tương tự lấy từ settings, không hỏi mỗi lần.

## 6. Giao diện

### 6.1 Activity Bar: container "Migent"

Một view container, hai view:

1. **Sessions** (TreeView). Phần tử:
   - Gốc nhóm (khi multi-root có nhiều project): tên project.
   - Nhóm theo trạng thái: **Running**, **Needs attention** (Blocked, Failed, Stopped), **Recent** (Completed, Cancelled, Prepared). Nhóm trống ẩn đi.
   - Session: nhãn = `title` (cắt ở ~60 ký tự, đầy đủ trong tooltip), `description` = `workflow · stage hiện tại · thời gian trôi qua`, icon theo displayState.
   - Con của session: execution theo `execution_order` (`plan · attempt 2`), `description` = `provider/model · decision`, icon theo status. Con của execution: `prompt.md`, `response.md`, `verify`, `artifacts/*` (mở file thật).
   - Mục "Outputs" liệt kê `outputs/*` khi session Completed.
2. **Workflows** (TreeView, giai đoạn 2). Liệt kê workflow trong `.migent/workflows/`, bấm để mở YAML, nút Run.

`contextValue` ghép từ displayState, ví dụ `session.running`, `session.blocked`, `session.stopped`, `session.completed`, `session.prepared`. Menu chuột phải dùng `when: viewItem =~ /^session\.(stopped|blocked|failed)$/`.

View có badge hiển thị số session Blocked + Failed cần chú ý (`TreeView.badge`).

Welcome view khi chưa có CLI, chưa có `.migent`, hoặc chưa có session: nút "Cài CLI", "Khởi tạo project" (`migent init` chạy qua bước hỏi trong Quick Pick), "Run workflow".

### 6.2 Lệnh (Command Palette và menu)

| Lệnh | Hành vi |
|---|---|
| `migent.session.run` | Quick Pick workflow → Input Box task (một dòng) → chạy. Có tùy chọn "Soạn task dài" tạo prepared session |
| `migent.session.prepare` | Nhập title, tạo session, mở `task.md` để viết, sau đó nút "Run" trên editor title |
| `migent.session.start` | Chạy prepared session đã chuẩn bị (`run --session --workflow`) |
| `migent.session.continue` | `session continue`; hỏi cờ `--refresh-workflow` nếu workflow đã đổi so với bản frozen |
| `migent.session.continueOnce` | `--once` |
| `migent.session.reply` | Chỉ cho session Blocked: mở editor tạm (hoặc Input Box nhiều dòng) viết reply, chọn stage nếu nhiều stage bị chặn, `continue --reply-file` |
| `migent.session.cancel` | `session cancel <id>`, hiện tiến trình chờ |
| `migent.session.repair` | `session repair` (xác nhận trước) |
| `migent.session.openTask` / `openPrompt` / `openResponse` / `openOutput` | Mở file |
| `migent.session.showLog` | Mở Output Channel của session |
| `migent.session.copyId` / `revealInExplorer` | Tiện ích |
| `migent.refresh` | Quét lại |
| `migent.doctor` | `migent doctor --json` hiển thị trong Output hoặc webview nhẹ |
| `migent.openSettings` | |

Mọi lệnh ghi đều kiểm tra: CLI đủ version, không có lock sống thuộc process khác, project không ở chế độ chỉ-đọc.

### 6.3 Xem nội dung

- `prompt.md`, `response.md`, `task.md`, `artifacts/*`, `outputs/*`: mở file thật trên đĩa (có sẵn tô màu, tìm kiếm, diff). Không tạo bản sao.
- **Log tổng hợp** của session (`migent-session:/<id>/timeline`): `TextDocumentContentProvider` render `events.jsonl` thành dòng dễ đọc (`10:15:30 plan#1 started · codex/gpt-5`), có `onDidChange` khi file đổi.
- **Output Channel** (`LogOutputChannel` theo session) cho dòng stderr của lệnh do extension chạy. Với session chạy từ nơi khác thì dùng event tail.
- Diff của execution sửa mã: dùng git (`vscode.git` API hoặc `git diff` theo tham chiếu); để giai đoạn sau.

### 6.4 Status bar và thông báo

- Status bar (trái): `$(sync~spin) Migent: 2 running` hoặc `$(warning) 1 blocked`, bấm để focus view Sessions. Ẩn khi không có gì đáng nói.
- Thông báo (có thể tắt từng loại trong settings): Blocked (nút "Reply"), Failed (nút "Continue" / "Xem log"), Quota (kèm `retry_at` và tự động nhắc lại khi hết hạn), Completed (nút "Mở kết quả"). Chỉ thông báo cho chuyển trạng thái xảy ra **sau** khi extension kích hoạt, tránh ngập khi mở cửa sổ.
- Tiến độ: `window.withProgress` (vị trí Notification, cancellable) cho một lệnh run do chính extension khởi chạy; hủy gọi `session cancel`.

### 6.5 Settings (`migent.*`)

| Key | Mặc định | Ý nghĩa |
|---|---|---|
| `migent.cli.path` | `""` | Đường dẫn binary; rỗng = tìm theo PATH rồi `node_modules/.bin` |
| `migent.cli.minVersion` | do extension đặt | không cho sửa trong UI, chỉ đọc |
| `migent.sessions.limit` | 50 | số session hiển thị |
| `migent.run.maxDispatches` | 20 | truyền `--max-dispatches` |
| `migent.run.progress` | true | truyền `--progress` |
| `migent.notifications.*` | true | blocked / failed / quota / completed |
| `migent.env` | `{}` | biến môi trường thêm cho CLI |

## 7. Webview (giai đoạn sau)

Chỉ cho hai thứ native không làm được:

1. **Workflow graph:** stage, `depends_on`, decision routes, tô màu theo tiến trình của session đang chọn. Dữ liệu do host gửi (JSON), webview không đọc file.
2. **Metrics dashboard:** token, chi phí, thời gian theo session và theo execution từ `metrics.json`.

Quy tắc: CSP `default-src 'none'` + `webview.cspSource`, script ngoài (không inline), `localResourceRoots` giới hạn thư mục `media/` của extension, nonce cho script, `getState/setState` thay vì `retainContextWhenHidden`, `WebviewPanelSerializer` để khôi phục sau khi reload. Dùng HTML thuần hoặc Preact và vẽ bằng SVG (xem skill `artifact-diagramming` cho cách vẽ graph), không kéo theo framework nặng. Host gửi state kèm số thứ tự tăng dần để webview bỏ gói cũ.

## 8. Lộ trình và tiêu chí hoàn thành

### Giai đoạn 0: Chuẩn bị (ngoài repo extension)
- Hoàn tất `session cancel` (plan riêng).
- Rà lại `docs/sessions.md` làm tài liệu contract; ghi nhận trong CONTRIBUTING của migent rằng đổi định dạng file là đổi contract.
- Chốt publisher và tên extension (`migent` / `nodeint.migent-vscode`).

### Giai đoạn 1: Khung và `core/` (đọc, chưa có UI)
- Scaffold repo, esbuild, vitest, CI (build + test + `vsce package` trên Windows và Linux).
- Cài `yaml`. Viết `paths`, `manifest`, `statusReader`, `lockProbe`, `displayState`, `eventTail`, `executions`, `store`.
- Tạo fixture từ session thật: completed, active-stopped, failed, blocked, cancelled, prepared, running (lock sống giả), lock stale, status.json hỏng, schema lạ.
- **Xong khi:** toàn bộ bảng trạng thái ở mục 4 có test; `eventTail` qua được ca dòng ghi dở; không file nào trong `core/` import `vscode`.

### Giai đoạn 2: Theo dõi (read-only MVP)
- Activation, `projects`, watcher, Sessions tree, welcome view, status bar, các lệnh mở file (`openTask/Prompt/Response/Output`), Output Channel, timeline document, `copyId`, `refresh`.
- Kiểm tra version CLI.
- **Xong khi:** mở repo migent này thấy đúng các session hiện có với đúng trạng thái; khi chạy `migent session run` ở terminal khác, session xuất hiện Running và đổi trạng thái đúng lúc mà không cần refresh; không chiếm CPU khi nghỉ.

### Giai đoạn 3: Điều khiển
- `cli/` (locate, invoke, runner), các lệnh Run, Prepare + Start, Continue, ContinueOnce, Reply, Cancel, Repair.
- `withProgress`, thông báo Blocked/Failed/Quota/Completed.
- **Xong khi:** chạy workflow `plan` đầu-cuối từ Command Palette; hủy giữa chừng trên Windows cho exit 130 và Continue chạy lại được; Reply cho session Blocked hoạt động; hai nơi cùng bấm Run không tạo lỗi lạ.

### Giai đoạn 4: Hoàn thiện và phát hành 0.1
- Multi-root, settings, `migent doctor`, `migent init` trong UI, README, icon, ảnh chụp, CHANGELOG, đóng gói và đăng.
- Kiểm thử thủ công theo checklist (Windows, macOS, Linux, Remote-SSH/WSL).

### Giai đoạn 5 (0.2+): Workflow graph, metrics, diff execution, JSON schema + autocomplete cho `.migent/workflows/*.yaml`, danh sách workspace qua registry service.

## 9. Kiểm thử

- **Đơn vị (`core/`):** vitest, dựng thư mục tạm từ fixture, không cần VS Code.
- **CLI:** mock `child_process` kiểm tra tham số, map exit code, `windowsHide`, xử lý stderr theo dòng.
- **Tích hợp:** `@vscode/test-electron` mở workspace mẫu có `.migent`, kiểm tra tree xuất hiện, lệnh có đăng ký, trạng thái đổi khi sửa file fixture. Với chạy thật, dùng `fake-provider.mjs` kiểu như `integration/` trong migent.
- **Hợp đồng:** một test đọc các session do migent thật sinh ra (CI chạy một workflow với provider giả trong repo extension, hoặc cập nhật fixture bằng script khi migent đổi version) để phát hiện lệch định dạng.
- **Windows** là môi trường bắt buộc trong CI vì rủi ro chính nằm ở đó.

## 10. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Hủy session trên Windows | Chờ `session cancel`; nếu CLI chưa có thì ẩn nút Stop |
| Process con `detached` trên Windows mở cửa sổ console hoặc bị chết khi VS Code thoát | `windowsHide: true`; thử nghiệm sớm ở giai đoạn 3 và quyết định giữa detached và gắn vào extension host |
| Watcher của VS Code trễ, gộp hoặc bỏ sót sự kiện | Debounce, đọc lại theo trạng thái (không theo sự kiện), timer 10 giây khi có Running |
| `.migent/sessions` bị `files.watcherExclude` hoặc `.gitignore` che | Dùng `RelativePattern`; kiểm thử với cấu hình mặc định; ghi chú vào README |
| `status.json` bị đọc giữa lúc ghi | Ghi nguyên tử phía migent; đọc lại tối đa 3 lần |
| Hàng trăm session làm chậm | Nạp lười, giới hạn N, chỉ theo dõi session đang chạy |
| Migent đổi định dạng file | `schema_version`, fixture, test hợp đồng, chế độ chỉ-đọc |
| Lock của máy khác (thư mục chia sẻ) | Hiển thị Running, khóa thao tác ghi |
| Dữ liệu nhạy cảm trong fixture | Ẩn đường dẫn, hostname, prompt thật trước khi đưa vào repo |

## 11. Câu hỏi mở

1. Tên publisher trên Marketplace và Open VSX, và tên hiển thị của extension.
2. Bản `engines.vscode` tối thiểu cần hỗ trợ.
3. Có cần hỗ trợ Remote (SSH, WSL, Dev Containers) ngay từ 0.1 không? Extension chạy ở workspace host (`extensionKind: ["workspace"]`), nên về lý thuyết đã hoạt động; vấn đề là CLI phải cài ở máy từ xa.
4. Giai đoạn 3: process do extension chạy có phải sống sót khi đóng VS Code không? Quyết định này ảnh hưởng đến `detached` và đến việc người dùng có nhầm tưởng đã dừng khi thoát.
5. Telemetry: không thu thập (đề xuất).
6. Giấy phép: MIT như migent.
