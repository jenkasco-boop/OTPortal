# OTPortal

เว็บบันทึก OT แทนโปรแกรมเดิม `KC_OT.exe` (Export OT Version 4.3) กรอกให้น้อยที่สุด คำนวณอัตรา OT อัตโนมัติ และ Export Excel ชื่อ `OT_[YYMM]_[NAME EN].xlsx`

- วิเคราะห์โปรแกรมเดิมและสิ่งที่เปลี่ยน: [docs/legacy-analysis.md](docs/legacy-analysis.md)
- วิธีทำ Excel template: [docs/excel-template.md](docs/excel-template.md)

## Stack

| ส่วน | เทคโนโลยี |
|---|---|
| Backend | ASP.NET Core 10 (Minimal API) + EF Core + SQLite |
| Frontend | React 19 + TypeScript + Vite (build เข้า `wwwroot` ของ backend → deploy เป็น site เดียว) |
| Excel | ClosedXML (ไม่ต้องติดตั้ง Excel บน server) |
| Deploy | IIS + ASP.NET Core Hosting Bundle, GitHub Actions self-hosted runner |

```
src/OtPortal.Api/
  Domain/OtCalculator.cs   กฎ OT ทั้งหมด (แยกช่วงเวลา + อัตรา)
  Domain/OtReport.cs       แปลงรายการเป็นแถวรายงาน + ชื่อไฟล์
  Export/ExcelExporter.cs  เขียน Excel / เติม template
  Program.cs               API
  Templates/               วาง ot-template.xlsx ที่นี่
web/                       React UI
tests/OtPortal.Tests/      unit tests
deploy/setup-iis.ps1       ตั้งค่า IIS ครั้งแรก
```

## รันบนเครื่อง

ต้องมี .NET SDK 10 และ Node 22 + pnpm

```bash
# terminal 1 — API ที่ http://localhost:5080
dotnet run --project src/OtPortal.Api

# terminal 2 — UI ที่ http://localhost:5173 (proxy /api ไปที่ 5080)
cd web && pnpm install && pnpm dev

# test
dotnet test
```

## CI/CD

| Workflow | Trigger | ทำอะไร |
|---|---|---|
| `ci.yml` | push `main`, PR | build + test บน GitHub-hosted runner |
| `deploy-iis.yml` | push `cicd-deploy` หรือกด Run | test → publish → robocopy ขึ้น IIS (self-hosted Windows runner) |

### ตั้งค่าครั้งแรก

1. **Server:** ติดตั้ง [ASP.NET Core 9 Hosting Bundle](https://dotnet.microsoft.com/download/dotnet/9.0) แล้ว `iisreset`
2. **IIS:** รันในฐานะ Administrator
   ```powershell
   .\deploy\setup-iis.ps1 -Path C:\inetpub\wwwroot\otportal -Port 8085 -RunnerAccount "NT AUTHORITY\NETWORK SERVICE"
   ```
   (หรือ `-ParentSite "Default Web Site"` เพื่อให้เป็น `http://server/otportal`)
3. **Runner:** GitHub repo → Settings → Actions → Runners → New self-hosted runner (Windows) ติดตั้งเป็น service บน server เดียวกับ IIS
4. **Variables:** Settings → Secrets and variables → Actions → Variables
   | ชื่อ | ตัวอย่าง | |
   |---|---|---|
   | `IIS_DEPLOY_PATH` | `C:\inetpub\wwwroot\otportal` | บังคับ — ต้องเป็นโฟลเดอร์ของ OT Portal เท่านั้น |
   | `IIS_APP_POOL` | `OTPortal` | ไม่บังคับ |
   | `IIS_SITE_URL` | `http://localhost:8085` | ไม่บังคับ ใช้ smoke test หลัง deploy |

### Deploy

```bash
git checkout cicd-deploy
git merge main
git push origin cicd-deploy     # ← deploy อัตโนมัติ
```

ฐานข้อมูลอยู่ที่ `<IIS_DEPLOY_PATH>\App_Data\otportal.db` — deploy จะไม่แตะโฟลเดอร์นี้ ควรตั้ง backup ไฟล์นี้เป็นระยะ
