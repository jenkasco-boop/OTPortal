using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using OtPortal.Api.Data;
using OtPortal.Api.Domain;
using OtPortal.Api.Export;

var builder = WebApplication.CreateBuilder(args);

var dbPath = Path.Combine(builder.Environment.ContentRootPath, builder.Configuration["Database:Path"] ?? "App_Data/otportal.db");
Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite($"Data Source={dbPath}"));
var templateFile = Path.Combine(builder.Environment.ContentRootPath, builder.Configuration["Export:TemplatePath"] ?? "Templates/ot-template.xlsx");
builder.Services.AddSingleton(new ExcelExporter(templateFile));
builder.Services.AddProblemDetails();

// Login: cookie session. Keys live in App_Data so sessions survive app restarts and deploys (App_Data is never overwritten).
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(Path.GetDirectoryName(dbPath)!, "keys")));
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "otportal.auth";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Lax;
    o.ExpireTimeSpan = TimeSpan.FromDays(30);
    o.SlidingExpiration = true;
    // API only: answer 401/403 instead of redirecting to a login page
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
builder.Services.AddSingleton<IPasswordHasher<Employee>, PasswordHasher<Employee>>();
// Slow down password guessing: 10 login/register attempts per minute per IP.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    db.Database.EnsureCreated();
    // EnsureCreated never alters an existing database: add columns introduced after the first release.
    var entryColumns = db.Database.SqlQueryRaw<string>("SELECT name AS Value FROM pragma_table_info('Entries')").ToList();
    if (!entryColumns.Contains(nameof(OtEntry.Project)))
        db.Database.ExecuteSqlRaw("ALTER TABLE Entries ADD COLUMN Project TEXT NULL");
    var employeeColumns = db.Database.SqlQueryRaw<string>("SELECT name AS Value FROM pragma_table_info('Employees')").ToList();
    if (!employeeColumns.Contains(nameof(Employee.Username)))
        db.Database.ExecuteSqlRaw("""
            ALTER TABLE Employees ADD COLUMN Username TEXT NULL;
            ALTER TABLE Employees ADD COLUMN PasswordHash TEXT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_Employees_Username" ON "Employees" ("Username");
            """);
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "Places" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_Places" PRIMARY KEY AUTOINCREMENT,
            "EmployeeId" INTEGER NOT NULL,
            "PlaceId" TEXT NULL,
            "Lat" REAL NOT NULL,
            "Lng" REAL NOT NULL,
            "Name" TEXT NULL,
            "Project" TEXT NULL,
            "Address" TEXT NULL,
            "UpdatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_Places_Employees_EmployeeId" FOREIGN KEY ("EmployeeId") REFERENCES "Employees" ("Id") ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS "IX_Places_EmployeeId" ON "Places" ("EmployeeId");
        """);
}

app.UseExceptionHandler();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

// /api/auth/* is public; everything else needs a login and only ever sees the signed-in employee's data.
var auth = app.MapGroup("/api/auth").RequireRateLimiting("auth");
var api = app.MapGroup("/api").RequireAuthorization();

// ---------- Auth ----------
auth.MapPost("/register", async (RegisterDto dto, AppDb db, IPasswordHasher<Employee> hasher, HttpContext http) =>
{
    var username = NormalizeUsername(dto.Username);
    if (dto.Profile is null) return Results.BadRequest("กรุณาระบุชื่อ");
    if ((ValidateLogin(username, dto.Password) ?? Validate(dto.Profile)) is { } err) return err;
    if (await db.Employees.AnyAsync(x => x.Username == username))
        return Results.Problem($"ชื่อผู้ใช้ {username} มีคนใช้แล้ว", statusCode: 409);

    // An employee created before login existed (no password yet) is claimed by registering with the same NameEn.
    var nameEn = dto.Profile.NameEn.Trim().ToUpperInvariant();
    var e = await db.Employees.FirstOrDefaultAsync(x => x.NameEn == nameEn);
    if (e is { PasswordHash: not null })
        return Results.Problem($"ชื่อ EN {nameEn} มีผู้ใช้แล้ว", statusCode: 409);
    if (e is null) db.Employees.Add(e = new Employee { NameEn = nameEn, NameTh = "" });
    ApplyProfile(e, dto.Profile);
    e.Username = username;
    e.PasswordHash = hasher.HashPassword(e, dto.Password!);
    await db.SaveChangesAsync();
    await SignIn(http, e);
    return Results.Ok(e);
});

auth.MapPost("/login", async (LoginDto dto, AppDb db, IPasswordHasher<Employee> hasher, HttpContext http) =>
{
    var username = NormalizeUsername(dto.Username);
    var e = await db.Employees.FirstOrDefaultAsync(x => x.Username == username);
    var result = e?.PasswordHash is null ? PasswordVerificationResult.Failed : hasher.VerifyHashedPassword(e, e.PasswordHash, dto.Password ?? "");
    if (result == PasswordVerificationResult.Failed)
        return Results.Problem("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", statusCode: 401);
    if (result == PasswordVerificationResult.SuccessRehashNeeded)
    {
        e!.PasswordHash = hasher.HashPassword(e, dto.Password!);
        await db.SaveChangesAsync();
    }
    await SignIn(http, e!);
    return Results.Ok(e);
});

auth.MapPost("/logout", async (HttpContext http) =>
{
    await http.SignOutAsync();
    return Results.NoContent();
});

// ---------- My profile ----------
api.MapGet("/me", async (ClaimsPrincipal user, AppDb db) =>
    await db.Employees.FindAsync(Me(user)) is { } e ? Results.Ok(e) : Results.Unauthorized());

api.MapPut("/me", async (EmployeeDto dto, ClaimsPrincipal user, AppDb db) =>
{
    if (Validate(dto) is { } err) return err;
    var e = await db.Employees.FindAsync(Me(user));
    if (e is null) return Results.Unauthorized();
    var nameEn = dto.NameEn.Trim().ToUpperInvariant();
    if (await db.Employees.AnyAsync(x => x.NameEn == nameEn && x.Id != e.Id))
        return Results.Problem($"มีชื่อ {nameEn} อยู่แล้ว", statusCode: 409);
    ApplyProfile(e, dto);
    await db.SaveChangesAsync();
    return Results.Ok(e);
});

// ---------- Holidays ----------
api.MapGet("/holidays", (int? year, AppDb db) =>
    db.Holidays.Where(h => year == null || h.Date.Year == year).OrderBy(h => h.Date).ToListAsync());

api.MapPost("/holidays", async (List<Holiday> items, AppDb db) =>
{
    foreach (var h in items)
    {
        var existing = await db.Holidays.FindAsync(h.Date);
        if (existing is null) db.Holidays.Add(h);
        else existing.Name = h.Name;
    }
    await db.SaveChangesAsync();
    return Results.NoContent();
});

api.MapDelete("/holidays/{date}", async (DateOnly date, AppDb db) =>
{
    await db.Holidays.Where(h => h.Date == date).ExecuteDeleteAsync();
    return Results.NoContent();
});

// ---------- OT entries ----------
api.MapPost("/preview", async (EntryDto dto, AppDb db) =>
{
    var holidays = await HolidaySet(db, dto.Date, dto.Date.AddDays(1));
    return Results.Ok(Calculate(dto, holidays));
});

api.MapGet("/entries", async (string month, ClaimsPrincipal user, AppDb db) =>
{
    var employeeId = Me(user);
    if (!TryParsePeriod(month, out var from, out var to)) return Results.BadRequest("month must be yyyy-MM");
    var entries = await db.Entries.Where(e => e.EmployeeId == employeeId && e.Date >= from && e.Date < to)
        .OrderBy(e => e.Date).ThenBy(e => e.Start).ToListAsync();
    var holidays = await HolidaySet(db, from, to.AddDays(1));
    return Results.Ok(entries.Select(e => new
    {
        e.Id, e.Date, e.Start, e.End, e.BreakMinutes, e.Support, e.Project, e.Remark,
        Result = OtCalculator.Calculate(e.Date, e.Start, e.End, e.BreakMinutes, e.Support, holidays.Contains),
    }));
});

api.MapPost("/entries", async (EntryDto dto, ClaimsPrincipal user, AppDb db) =>
{
    var holidays = await HolidaySet(db, dto.Date, dto.Date.AddDays(1));
    if (!Calculate(dto, holidays).HasOt) return Results.Problem("ไม่พบ OT ในช่วงเวลาที่กำหนด", statusCode: 400);

    var entry = new OtEntry { EmployeeId = Me(user) };
    Apply(entry, dto);
    db.Entries.Add(entry);
    await db.SaveChangesAsync();
    return Results.Ok(entry);
});

api.MapPut("/entries/{id:int}", async (int id, EntryDto dto, ClaimsPrincipal user, AppDb db) =>
{
    var me = Me(user);
    var entry = await db.Entries.FirstOrDefaultAsync(e => e.Id == id && e.EmployeeId == me);
    if (entry is null) return Results.NotFound();
    var holidays = await HolidaySet(db, dto.Date, dto.Date.AddDays(1));
    if (!Calculate(dto, holidays).HasOt) return Results.Problem("ไม่พบ OT ในช่วงเวลาที่กำหนด", statusCode: 400);
    Apply(entry, dto);
    await db.SaveChangesAsync();
    return Results.Ok(entry);
});

api.MapDelete("/entries/{id:int}", async (int id, ClaimsPrincipal user, AppDb db) =>
{
    var me = Me(user);
    await db.Entries.Where(e => e.Id == id && e.EmployeeId == me).ExecuteDeleteAsync();
    return Results.NoContent();
});

// ---------- Saved places (names for Google Timeline places) ----------
api.MapGet("/places", (ClaimsPrincipal user, AppDb db) =>
{
    var me = Me(user);
    return db.Places.Where(p => p.EmployeeId == me).ToListAsync();
});

// Upsert: same place id, else the nearest saved place within SavedPlaces.MatchRadiusMeters. Clearing every field deletes it.
api.MapPut("/places", async (PlaceDto dto, ClaimsPrincipal user, AppDb db) =>
{
    var me = Me(user);
    var own = await db.Places.Where(p => p.EmployeeId == me).ToListAsync();
    var place = SavedPlaces.Match(own, dto.PlaceId, dto.Lat, dto.Lng);

    var name = Clean(dto.Name);
    var project = Clean(dto.Project);
    var address = Clean(dto.Address);
    if (name is null && project is null && address is null)
    {
        if (place is not null) db.Places.Remove(place);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    if (place is null) db.Places.Add(place = new SavedPlace { EmployeeId = me, Lat = dto.Lat, Lng = dto.Lng });
    place.PlaceId ??= dto.PlaceId;
    (place.Name, place.Project, place.Address, place.UpdatedAt) = (name, project, address, DateTime.UtcNow);
    await db.SaveChangesAsync();
    return Results.Ok(place);
});

// ---------- Report / export ----------
api.MapGet("/report", async (string month, ClaimsPrincipal user, AppDb db) =>
    await BuildReport(Me(user), month, db) is { } r ? Results.Ok(r) : Results.NotFound());

api.MapGet("/export", async (string month, ClaimsPrincipal user, AppDb db, ExcelExporter exporter) =>
{
    var report = await BuildReport(Me(user), month, db);
    if (report is null) return Results.NotFound();
    return Results.File(exporter.Export(report),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", report.FileName + ".xlsx");
});

// Unknown /api/... paths are 404, not the SPA page (which the client would try to read as JSON).
api.MapFallback(() => Results.NotFound());
app.MapFallbackToFile("index.html");
app.Run();

// ---------- helpers ----------
static int Me(ClaimsPrincipal user) => int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

static Task SignIn(HttpContext http, Employee e) =>
    http.SignInAsync(new ClaimsPrincipal(new ClaimsIdentity(
        [new Claim(ClaimTypes.NameIdentifier, e.Id.ToString()), new Claim(ClaimTypes.Name, e.Username!)],
        CookieAuthenticationDefaults.AuthenticationScheme)),
        new AuthenticationProperties { IsPersistent = true });

static string NormalizeUsername(string? username) => (username ?? "").Trim().ToLowerInvariant();

static IResult? ValidateLogin(string username, string? password) =>
    username.Length is < 3 or > 32 || !username.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-')
        ? Results.BadRequest("ชื่อผู้ใช้ 3-32 ตัว ใช้ได้เฉพาะ a-z, 0-9 และ . _ -")
    : (password?.Length ?? 0) < 8 ? Results.BadRequest("รหัสผ่านอย่างน้อย 8 ตัวอักษร")
    : null;

static void ApplyProfile(Employee e, EmployeeDto dto)
{
    e.NameEn = dto.NameEn.Trim().ToUpperInvariant();
    e.NameTh = dto.NameTh.Trim();
    e.DefaultBreakMinutes = dto.DefaultBreakMinutes;
}

static IResult? Validate(EmployeeDto dto) =>
    string.IsNullOrWhiteSpace(dto.NameEn) || string.IsNullOrWhiteSpace(dto.NameTh) ? Results.BadRequest("กรุณาระบุชื่อ")
    : !dto.NameEn.Trim().All(c => char.IsAsciiLetterOrDigit(c) || c == ' ') ? Results.BadRequest("ชื่อ EN ใช้ได้เฉพาะ A-Z และ 0-9")
    : dto.DefaultBreakMinutes < 0 ? Results.BadRequest("เวลาพักต้องไม่ติดลบ")
    : null;

static OtResult Calculate(EntryDto dto, HashSet<DateOnly> holidays) =>
    OtCalculator.Calculate(dto.Date, dto.Start, dto.End, Math.Max(0, dto.BreakMinutes), dto.Support, holidays.Contains);

static void Apply(OtEntry entry, EntryDto dto)
{
    entry.Date = dto.Date;
    entry.Start = dto.Start;
    entry.End = dto.End;
    entry.BreakMinutes = Math.Max(0, dto.BreakMinutes);
    entry.Support = dto.Support;
    entry.Project = string.IsNullOrWhiteSpace(dto.Project) ? null : dto.Project.Trim();
    entry.Remark = string.IsNullOrWhiteSpace(dto.Remark) ? null : dto.Remark.Trim();
}

static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

static async Task<HashSet<DateOnly>> HolidaySet(AppDb db, DateOnly from, DateOnly toInclusive) =>
    (await db.Holidays.Where(h => h.Date >= from && h.Date <= toInclusive).Select(h => h.Date).ToListAsync()).ToHashSet();

static bool TryParsePeriod(string month, out DateOnly from, out DateOnly toExclusive)
{
    (from, toExclusive) = (default, default);
    if (!DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", out var first)) return false;
    (from, toExclusive) = OtPeriod.Range(first.Year, first.Month);
    return true;
}

static async Task<OtMonthReport?> BuildReport(int employeeId, string month, AppDb db)
{
    if (!TryParsePeriod(month, out var from, out var to)) return null;
    var employee = await db.Employees.FindAsync(employeeId);
    if (employee is null) return null;
    var entries = await db.Entries.Where(e => e.EmployeeId == employeeId && e.Date >= from && e.Date < to).ToListAsync();
    var holidays = await HolidaySet(db, from, to.AddDays(1));
    return OtReport.Build(employee, to.Year, to.Month, entries, holidays.Contains);
}

public record PlaceDto(string? PlaceId, double Lat, double Lng, string? Name, string? Project, string? Address);
public record EmployeeDto(string NameEn, string NameTh, int DefaultBreakMinutes);
public record LoginDto(string? Username, string? Password);
public record RegisterDto(string? Username, string? Password, EmployeeDto? Profile);
public record EntryDto(DateOnly Date, TimeOnly Start, TimeOnly End, int BreakMinutes, bool Support, string? Project, string? Remark);
